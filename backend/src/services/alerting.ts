import { getAuthHeader, API_BASE, getAlertRecipients } from '../config';

/**
 * Operational alerting — emails a human the moment a scheduled run fails, so a failure is noticed in
 * minutes instead of when a plant asks why their report never arrived. This is the detection layer
 * that complements the cache (which removes the heavy-endpoint failure mode) and catches the two
 * things the cache can't: a full generation failure (endpoint outage, or a 401 from a
 * rotated/revoked PAT) and per-report send failures.
 *
 * Deliberately best-effort and FAIL-OPEN: an alert that can't be sent is logged and swallowed — it
 * must NEVER throw into (and thereby disrupt) the report pipeline that's already having a bad day.
 * Alerting is a no-op unless ALERT_RECIPIENTS is configured.
 */

/** True if an error looks like an auth failure (expired/rotated/revoked PAT) — surfaced specially in alerts. */
export function isAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('invalid authorization') || msg.includes('401') || msg.includes('unauthorized');
}

export interface OpsAlert {
  /** Short subject line, e.g. "Daily report generation FAILED". */
  subject: string;
  /** Body lines (joined with newlines). */
  lines: string[];
}

/**
 * Sends one ops alert via IOsense's sendEmail (no attachment — this is a notification, not a report).
 * Never throws: any failure is logged and swallowed.
 */
export async function sendOpsAlert(alert: OpsAlert): Promise<void> {
  const to = getAlertRecipients();
  if (to.length === 0) {
    console.warn(`[alert] (no ALERT_RECIPIENTS configured) ${alert.subject} — ${alert.lines.join(' | ')}`);
    return;
  }
  const subject = `⚠ HMEL Steam Trap ALERT: ${alert.subject}`;
  const message = [`Automated alert from the HMEL Steam Trap reporting service.`, '', ...alert.lines].join('\n');
  try {
    const response = await fetch(`${API_BASE}/account/sendEmail`, {
      method: 'PUT',
      headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        cc: [],
        subject,
        template: 'reports reportMail',
        attachments: [],
        additionalInfo: {
          reportTitle: 'Steam Trap Service Alert',
          reportGenerationTime: new Date().toISOString(),
          message,
        },
      }),
    });
    const body = (await response.json()) as { success?: boolean; errors?: string[] };
    if (!response.ok || !body.success) {
      console.error(`[alert] sendEmail rejected the alert (HTTP ${response.status}):`, JSON.stringify(body));
      return;
    }
    console.log(`[alert] Sent "${subject}" to ${to.join(', ')}`);
  } catch (err) {
    // The alert itself failed — if auth is the cause, the whole service is down anyway. Just log.
    console.error(`[alert] Failed to send ops alert "${subject}" (swallowed):`, err);
  }
}
