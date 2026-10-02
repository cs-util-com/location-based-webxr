/**
 * A node module hook for `node --test`: resolves the dev server's
 * TypeScript routes (`/globe/…`, `/osm-lib/…`) the way the server does, so
 * a lab's pure module can import another package's source by its page path
 * and still run under node's own test runner. Node strips the types.
 *
 * `test:unit` passes `--import ./test-route-loader.mjs` and the Playwright
 * config imports it; registering is the import's side effect.
 *
 * @see test-route-loader.mjs.md
 */
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defaultRoutes, resolveRequest } from "./serve-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The file URL a page path maps to under a TypeScript route, or null for
 * anything else (relative, bare, protocol-relative, unrouted, a route the
 * server serves as is, or a path the server refuses).
 *
 * @param {string} specifier
 * @param {readonly import("./serve-routes.mjs").Route[]} routes
 * @returns {string | null}
 */
export function routeUrl(specifier, routes) {
  if (!specifier.startsWith("/") || specifier.startsWith("//")) return null;
  const route = routes.find(
    (r) => r.typescript && specifier.startsWith(r.prefix),
  );
  if (!route) return null;
  const target = resolveRequest(specifier, {
    packageRoot: here,
    routes: [route],
  });
  return target.kind === "file" && target.typescript
    ? pathToFileURL(target.file).href
    : null;
}

const routes = defaultRoutes(join(here, ".."));

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = routeUrl(specifier, routes);
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});
