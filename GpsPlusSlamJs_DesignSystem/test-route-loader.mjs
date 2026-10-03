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
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, sep } from "node:path";
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

/**
 * The `.ts` source of a relative `./x.js` import made by a module inside a
 * TypeScript route's directory (the server serves `x.ts` as `x.js`; node
 * does not rewrite it), when `x.js` does not exist and `x.ts` does; null
 * for anything else.
 *
 * @param {string} specifier
 * @param {string | undefined} parentUrl
 * @param {readonly import("./serve-routes.mjs").Route[]} routes
 * @returns {string | null}
 */
export function siblingSourceUrl(specifier, parentUrl, routes) {
  if (!parentUrl?.startsWith("file:")) return null;
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!relative || !specifier.endsWith(".js")) return null;
  const parent = fileURLToPath(parentUrl);
  const inRoute = routes.some(
    (r) => r.typescript && parent.startsWith(r.dir + sep),
  );
  if (!inRoute) return null;
  const js = fileURLToPath(new URL(specifier, parentUrl));
  const ts = `${js.slice(0, -3)}.ts`;
  return !existsSync(js) && existsSync(ts) ? pathToFileURL(ts).href : null;
}

const routes = defaultRoutes(join(here, ".."));

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url =
      routeUrl(specifier, routes) ??
      siblingSourceUrl(specifier, context.parentURL, routes);
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});
