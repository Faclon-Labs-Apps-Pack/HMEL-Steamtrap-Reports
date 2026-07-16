import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { OUTPUT_DIR, FILE_SERVER_PORT, FRONTEND_DIST_DIR } from './config';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Serves generated report files for IOsense's `sendEmail` API to pull, matching the reference
 * implementation's `GET /report/:fileName` contract exactly: streams the file, deletes it after
 * the first successful download (this is meant to be the ONE download — IOsense's fetch), and
 * rejects anything older than 24h with 410 Gone (a stale/never-collected file).
 *
 * MUST be reachable from the public internet for attachments to actually arrive — see
 * `getReportBaseUrl` in config.ts.
 *
 * ALSO serves the frontend's production build (if `frontend/dist` exists — run `npm run build`
 * in frontend/ first) as static files on this SAME port, with an SPA fallback to index.html for
 * any other GET route. This means REPORT_BASE_URL and the URL you point users at for the
 * dashboard can be the exact same origin — no separate reverse-proxy rule needed to route
 * frontend traffic to one port and /report/* traffic to another. If frontend/dist doesn't exist,
 * this is skipped and only /report/:fileName is served, same as before.
 */
export function startFileServer(): ReturnType<express.Express['listen']> {
  const app = express();

  app.get('/report/:fileName', async (req, res) => {
    const fileName = path.basename(req.params.fileName); // defend against path traversal
    const filePath = path.join(OUTPUT_DIR, fileName);

    const requester = req.ip ?? 'unknown';

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      console.log(`[fileServer] 404 ${fileName} requested by ${requester} (already downloaded or never generated)`);
      res.status(404).send('Not found (already downloaded or never generated).');
      return;
    }

    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs > MAX_AGE_MS) {
      await unlink(filePath).catch(() => {});
      console.log(`[fileServer] 410 ${fileName} requested by ${requester} (expired after 24h)`);
      res.status(410).send('Gone (report expired after 24h — regenerate it).');
      return;
    }

    console.log(`[fileServer] Serving ${fileName} to ${requester}…`);
    res.download(filePath, fileName, async (err) => {
      if (!err) {
        await unlink(filePath).catch(() => {});
        console.log(`[fileServer] Served and deleted ${fileName}`);
      } else {
        console.error(`[fileServer] Error streaming ${fileName}:`, err);
      }
    });
  });

  if (existsSync(FRONTEND_DIST_DIR)) {
    app.use(express.static(FRONTEND_DIST_DIR));
    // SPA fallback: any other GET (a client-side route, a browser refresh, etc.) gets index.html.
    app.get(/^(?!\/report\/).*/, (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
    });
    console.log(`[fileServer] Serving frontend build from ${FRONTEND_DIST_DIR}`);
  } else {
    console.log(`[fileServer] No frontend build found at ${FRONTEND_DIST_DIR} — serving /report/* only. Run "npm run build" in frontend/ to also serve the dashboard from this port.`);
  }

  return app.listen(FILE_SERVER_PORT, () => {
    console.log(`[fileServer] Listening on port ${FILE_SERVER_PORT}`);
  });
}
