import { FILE_SERVER_PORT, getReportBaseUrl } from '../config';
import { sendOpsAlert } from '../services/alerting';

/**
 * File-server watchdog. On 2026-10-08→12 the scheduler kept running and kept "sending" reports, but
 * its HTTP file server had silently lost its listening socket (nothing on port 9010). Delivery is
 * pull-based — IOsense fetches each attachment from our public /report URL — so with no file server
 * every report was accepted by IOsense (`success:true`) yet never fetched, and nothing was delivered.
 * `sendEmail` returning success is NOT proof of delivery, so the failure was invisible for days.
 *
 * This watchdog closes that gap. Every few minutes it checks that our own file server is actually
 * reachable:
 *   - LOCAL (http://127.0.0.1:PORT/api/health): authoritative for OUR process. Repeated failure means
 *     the socket is gone (the exact 2026-10 bug) — we ALERT and exit(1) so pm2 restarts us and the
 *     server rebinds. Exiting is the reliable rebind: an in-process server whose socket died can't be
 *     revived cleanly.
 *   - PUBLIC (REPORT_BASE_URL/api/health): what IOsense actually reaches. If LOCAL is healthy but the
 *     PUBLIC URL fails repeatedly, that's a platform/proxy problem a restart won't fix — we ALERT
 *     (no exit) so a human looks, rather than restart-looping.
 *
 * Consecutive-failure thresholds (not single blips) avoid false restarts from a transient hiccup.
 */

const CHECK_INTERVAL_MS = (() => {
  const raw = process.env.FILE_SERVER_HEALTHCHECK_MINUTES;
  const mins = raw ? Number(raw) : 5;
  return (Number.isFinite(mins) && mins > 0 ? mins : 5) * 60 * 1000;
})();

/** Consecutive failures before acting — rides out a transient blip but catches a real outage fast. */
const LOCAL_FAIL_THRESHOLD = 3;
const PUBLIC_FAIL_THRESHOLD = 3;
const REQUEST_TIMEOUT_MS = 10_000;

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok; // 2xx
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function startFileServerWatchdog(): void {
  const localUrl = `http://127.0.0.1:${FILE_SERVER_PORT}/api/health`;
  let publicUrl: string;
  try {
    publicUrl = `${getReportBaseUrl()}/api/health`;
  } catch {
    publicUrl = ''; // REPORT_BASE_URL not set — skip the public check rather than crash the watchdog
  }

  let localFails = 0;
  let publicFails = 0;
  let publicAlerted = false;

  console.log(
    `[watchdog] File-server watchdog armed — checking ${localUrl}${publicUrl ? ` and ${publicUrl}` : ''} every ${CHECK_INTERVAL_MS / 60000} min.`,
  );

  const timer = setInterval(async () => {
    // LOCAL — our own socket. This is the 2026-10 failure mode.
    if (await isReachable(localUrl)) {
      localFails = 0;
    } else {
      localFails++;
      console.error(`[watchdog] LOCAL file server unreachable (${localFails}/${LOCAL_FAIL_THRESHOLD}): ${localUrl}`);
      if (localFails >= LOCAL_FAIL_THRESHOLD) {
        await sendOpsAlert({
          subject: 'File server DOWN — auto-restarting',
          lines: [
            `The report file server stopped listening on port ${FILE_SERVER_PORT}.`,
            'Delivery is pull-based, so while it is down reports are accepted by IOsense but NEVER fetched/delivered.',
            'The watchdog is exiting the process so pm2 restarts it and the server rebinds. Verify the public URL returns 200 after restart.',
          ],
        });
        console.error('[watchdog] Exiting (code 1) so pm2 restarts and the file server rebinds.');
        clearInterval(timer);
        process.exit(1);
      }
      return; // don't bother with the public check while local is already failing
    }

    // PUBLIC — what IOsense reaches. Local-healthy + public-failing = proxy/platform issue (not ours to restart).
    if (!publicUrl) return;
    if (await isReachable(publicUrl)) {
      publicFails = 0;
      publicAlerted = false;
    } else {
      publicFails++;
      console.error(`[watchdog] PUBLIC URL unreachable (${publicFails}/${PUBLIC_FAIL_THRESHOLD}) while local is healthy: ${publicUrl}`);
      if (publicFails >= PUBLIC_FAIL_THRESHOLD && !publicAlerted) {
        publicAlerted = true; // alert once per outage, not every interval
        await sendOpsAlert({
          subject: 'Public report URL unreachable (attachments cannot be fetched)',
          lines: [
            `Our local file server is healthy, but the public URL IOsense fetches is failing: ${publicUrl}`,
            'This is a platform/proxy issue a restart will not fix — reports will "send" but not deliver until it is resolved.',
            'Check the platform port mapping / ingress for this service.',
          ],
        });
      }
    }
  }, CHECK_INTERVAL_MS);

  timer.unref?.(); // never keep the process alive just for the watchdog
}
