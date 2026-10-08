/**
 * The worker's origin (`VITE_API_URL` at build time, e.g.
 * `http://localhost:8787` for `npm run worker:dev`), or null if this build
 * has no server, which leaves games against a friend switched off.
 */
export const API_URL: string | null = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || null;
