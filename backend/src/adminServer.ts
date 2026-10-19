import './setTimezone'; // MUST be first — pins the process to IST before any Date is created
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ADMIN_PORT, FRONTEND_DIST_DIR } from './config';
import { createAdminApiRouter } from './api/adminApi';

/**
 * STANDALONE admin/test server: the admin REST API + the frontend build, and NOTHING else.
 * Deliberately does NOT import the scheduler — this process never registers cron jobs, never
 * generates on a timer, and never sends email, so it can run side-by-side with the production
 * scheduler process without any risk of duplicate sends. Used for the test deployment
 * (e.g. https://app-XXXXXXXX.iocompute.ai → this port).
 *
 * In production the same API is served by the scheduler process itself (fileServer.ts mounts the
 * same router), so the admin UI works on the live URL too once republished.
 */
const app = express();

app.use('/api', createAdminApiRouter());

if (existsSync(FRONTEND_DIST_DIR)) {
  // index.html must NEVER be cached: it references content-hashed bundles that vanish on each
  // rebuild — a cached index means 404'd scripts and a blank white page (seen 2026-10-19).
  // The hashed assets themselves are immutable and may cache forever.
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
  });
  console.log(`[adminServer] Serving frontend build from ${FRONTEND_DIST_DIR}`);
} else {
  console.log(`[adminServer] No frontend build at ${FRONTEND_DIST_DIR} — API only. Run "npm run build" in frontend/ first.`);
}

app.listen(ADMIN_PORT, () => {
  console.log(`[adminServer] Admin/test server listening on port ${ADMIN_PORT} (no scheduler, no email).`);
});
