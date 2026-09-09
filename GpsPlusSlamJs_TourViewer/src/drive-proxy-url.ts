/**
 * Which Drive CORS proxy this page should call.
 *
 * WHY THIS EXISTS (second testing session, 2026-09-09, finding F3). The
 * value used to be one hard-coded absolute URL,
 * `https://gps.csutil.com/api/drive-proxy`, with the reasoning that
 * "production is same-origin with it, and dev servers are on the worker's
 * CORS allowlist, so one value serves both". That is true of exactly two
 * environments and false of the third: a **branch preview**
 * (`https://<branch>-gps-plus-slam.csutil.workers.dev`) is neither
 * production nor a dev host, so it called production cross-origin, the
 * proxy's allowlist refused it exactly as designed, and the viewer reported
 * "The host refused the browser access" for every hosted zip. Every test
 * build was therefore unable to open a Drive-hosted tour.
 *
 * THE FIX IS TO STOP CALLING PRODUCTION, not to widen the allowlist. Each
 * preview deploys the whole site, the site worker included, so it serves
 * this same proxy at its own `/api/drive-proxy`. A same-origin relative
 * path needs no CORS at all, and it keeps the proxy's allowlist as narrow
 * as it is - adding `*.workers.dev` would admit every Worker anyone
 * deploys on that shared domain.
 *
 * The absolute URL survives for local development only, where the page is
 * served by vite and there is no `/api` route to be relative to. Those
 * hosts are precisely the ones the worker's own `DEV_ORIGIN` allows, and
 * the pattern here mirrors it deliberately: if the two ever disagree, the
 * symptom is this same refusal, so they are kept legible side by side
 * rather than derived from one another across a repo boundary.
 */

/** Production, for dev hosts that have no `/api` of their own. */
export const PRODUCTION_DRIVE_PROXY_URL =
  "https://gps.csutil.com/api/drive-proxy";

/** The same-origin route every deployment of the site worker serves. */
export const RELATIVE_DRIVE_PROXY_PATH = "/api/drive-proxy";

/**
 * Mirrors the site worker's `DEV_ORIGIN` (`drive-proxy.ts`): localhost,
 * loopback, the two private LAN ranges vite serves with `host: true`, and
 * ngrok's HTTPS tunnels. Hostname only - the port is irrelevant here, and
 * the scheme is not ours to judge.
 */
function isDevHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^[\w-]+\.ngrok-free\.app$/.test(hostname)
  );
}

/**
 * The proxy base this page should use.
 *
 * @param hostname the page's `location.hostname`.
 * @returns a same-origin path on any deployment (production, and every
 *   branch preview); the absolute production URL on a dev host, which the
 *   worker's CORS allowlist admits.
 */
export function driveProxyBaseUrl(hostname: string): string {
  return isDevHost(hostname)
    ? PRODUCTION_DRIVE_PROXY_URL
    : RELATIVE_DRIVE_PROXY_PATH;
}
