/**
 * Browser-safe subset of the backend `config` module.
 *
 * The frontend generates reports client-side and has NO environment/dotenv/process.env access, so
 * this file deliberately mirrors only the pure, browser-safe helpers that the shared (backend-copied)
 * report builders import from `../config`. Do NOT add anything here that reads `process.env`.
 *
 * Currently that's just `envKey` — normalizes a unit/category name to its ENV-key form
 * (e.g. "CPP-575" -> "CPP_575", "DFCU (AU)" -> "DFCU_AU"), used only for in-memory unit filtering.
 */
export function envKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
