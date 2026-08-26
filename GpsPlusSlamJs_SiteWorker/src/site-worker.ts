/**
 * The site worker's entry point: a route dispatcher in front of the static
 * multi-app site. With a `main` script present, Cloudflare invokes the
 * worker for EVERY request that matches no static asset — not only the
 * routes we mean to handle — so the dispatcher's first duty is delegating
 * everything outside `/api/` to the assets binding, byte-identical to the
 * assets-only deployment it replaced (plan Rev 2, review finding 1).
 *
 * The `/api/` prefix is reserved for worker routes (`wrangler.toml`
 * `run_worker_first`), today only the Drive proxy; the long-blocked `/S/`
 * QR short-link rewrite joins this dispatcher when it is built.
 */

import { handleDriveProxy, type FetchLike } from "./drive-proxy";

export interface SiteWorkerEnv {
  /** The `[assets] binding = "ASSETS"` from wrangler.toml. Declared
   *  minimally here instead of pulling @cloudflare/workers-types for one
   *  method. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export function routeRequest(
  request: Request,
  env: SiteWorkerEnv,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/drive-proxy") {
    return handleDriveProxy(request, { fetchImpl });
  }
  if (pathname.startsWith("/api/")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: `no such API route: ${pathname}` }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch: (request: Request, env: SiteWorkerEnv): Promise<Response> =>
    routeRequest(request, env),
};
