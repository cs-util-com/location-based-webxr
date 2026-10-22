/**
 * The design-system dev server's route table, kept pure so it is testable.
 *
 * The 3D look-dev page (`3d/`) imports the framework's TypeScript SOURCE
 * rather than its built dist, so the atmosphere is written once, in the
 * framework, and still iterates at save-and-reload speed (plan
 * 2026-09-23-0048 §4.1). This module decides which file a request maps to;
 * `serve.mjs` reads it and, for `typescript: true`, strips the types.
 *
 * SECURITY IS THE OTHER HALF. The server binds 0.0.0.0 for phone rounds, so
 * every mapping is contained: a request is decoded ONCE, any `..` segment or
 * NUL byte is refused outright, and the joined path must still sit inside the
 * directory it was mapped into. Refusing `..` rather than normalising it away
 * is deliberate: there is no legitimate reason for the page to ask for one.
 *
 * @see serve-routes.mjs.md
 */
import { extname, join, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/**
 * @typedef {{ prefix: string, dir: string, typescript: boolean, copyAll?: boolean, notice?: string }} Route
 *   `copyAll`: the deploy copies the whole directory (runtime assets that are
 *   fetched, which no import crawl can see) when any page references it.
 *   `notice`: a file (e.g. LICENSE) the deploy ships beside anything it
 *   emits from this route.
 * @typedef {{ kind: "file", file: string, typescript: boolean, worker?: true } | { kind: "forbidden" }} Resolution
 *   `worker`: the request came through the worker view (`/w/`), so a module
 *   is served through `workerModule`.
 */

/**
 * THE WORKER VIEW (globe city plan 2026-10-05-0040 §12.4 R1). Import maps do
 * not apply inside a worker, so a worker whose modules import packages by
 * their bare names cannot load through the plain routes. `/w/<path>` serves
 * the file `<path>` would, with its specifiers made URLs inside the view
 * (`workerModule`), so the whole graph a worker reaches stays in the view.
 */
export const WORKER_VIEW = "/w/";

/**
 * What a bare name means inside the worker view: the globe page's import map
 * for the same names (a test holds the two equal). Only names a worker graph
 * needs; a name missing here fails loudly in `workerModule`.
 */
export const WORKER_IMPORTS = Object.freeze({
  "h3-js": "/vendor/h3-js/dist/browser/h3-js.es.js",
  "gps-plus-slam-osm": "/osm-lib/index.js",
  "gps-plus-slam-app-framework/osm-bridge": "/fw/osm-bridge/index.js",
});

/** `import … from "x"`, `import "x"`, `export … from "x"`, `import("x")`. */
const MODULE_SPECIFIER =
  /((?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?|\bimport\s*\(\s*)(["'])([^"']+)\2/g;

/**
 * A module's source as the worker view serves it: every import specifier a
 * URL inside the view. A bare name goes through `imports` (an exact name, or
 * the longest `prefix/` entry), a route path (`/x/…`) moves under `/w/`,
 * and a relative one is left as it is (it resolves under the view by
 * itself). Other strings are untouched.
 *
 * @param {string} code  the module's JavaScript (TypeScript already stripped)
 * @param {string} fromUrl  the module's URL in the view, for the error
 * @param {Readonly<Record<string, string>>} [imports]
 * @returns {string}
 * @throws {Error} for a bare name `imports` does not map, naming it
 */
export function workerModule(code, fromUrl, imports = WORKER_IMPORTS) {
  const inView = (url) =>
    url.startsWith(WORKER_VIEW) ? url : WORKER_VIEW + url.slice(1);
  return code.replace(MODULE_SPECIFIER, (match, head, quote, specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return match;
    }
    if (specifier.startsWith("/")) {
      return `${head}${quote}${inView(specifier)}${quote}`;
    }
    let url = imports[specifier];
    if (url === undefined) {
      const prefix = Object.keys(imports)
        .filter((key) => key.endsWith("/") && specifier.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
      if (prefix) url = imports[prefix] + specifier.slice(prefix.length);
    }
    if (url === undefined) {
      throw new Error(
        `the worker view cannot resolve "${specifier}" imported by ${fromUrl}: add it to WORKER_IMPORTS`,
      );
    }
    return `${head}${quote}${inView(url)}${quote}`;
  });
}

/**
 * The 3D page's routes, relative to the workspace root. ONE table, used by
 * the dev server and by the deploy builder, so a page that works under
 * `pnpm run serve` is the page that gets deployed.
 *
 * @param {string} repo  the location-based-webxr checkout
 * @returns {Route[]}
 */
export function defaultRoutes(repo) {
  return [
    {
      prefix: "/fw/",
      dir: join(repo, "GpsPlusSlamJs_AppFramework", "src"),
      typescript: true,
    },
    {
      prefix: "/osm/",
      dir: join(repo, "GpsPlusSlamJs_OsmDemo", "src"),
      typescript: true,
    },
    // The terrain lab (terrain plan 2026-09-27-0605 §9, finding 2): the Osm
    // LIBRARY's source, for its Terrarium decoder and ENU frame. Its own
    // prefix, not a subpath of "/osm/", which is OsmDemo's.
    {
      prefix: "/osm-lib/",
      dir: join(repo, "GpsPlusSlamJs_Osm", "src"),
      typescript: true,
    },
    // H3 for the Osm library's source, which imports `h3-js` by its bare
    // name: a page that loads `/osm-lib/` source needing H3 maps that name
    // to `dist/browser/h3-js.es.js` here (no imports of its own). First
    // user: the globe's arrival prefetch (round-5 plan 2026-10-01-0945
    // §3.6).
    {
      prefix: "/vendor/h3-js/",
      dir: join(repo, "GpsPlusSlamJs_Osm", "node_modules", "h3-js"),
      typescript: false,
      notice: "LICENSE",
    },
    {
      prefix: "/vendor/three/",
      dir: join(repo, "GpsPlusSlamJs_AppFramework", "node_modules", "three"),
      typescript: false,
      notice: "LICENSE",
    },
    // The globe lab (W7 plan 2026-09-26-0539 §7.1): the globe package's
    // TypeScript source, its imagery (fetched at runtime, so copied whole),
    // and its one dependency, which ships its LICENSE beside its chunks.
    {
      prefix: "/globe/",
      dir: join(repo, "GpsPlusSlamJs_Globe", "src"),
      typescript: true,
    },
    {
      prefix: "/globe-assets/",
      dir: join(repo, "GpsPlusSlamJs_Globe", "assets"),
      typescript: false,
      copyAll: true,
    },
    {
      prefix: "/vendor/3d-tiles-renderer/",
      dir: join(
        repo,
        "GpsPlusSlamJs_Globe",
        "node_modules",
        "3d-tiles-renderer",
      ),
      typescript: false,
      notice: "LICENSE",
    },
  ];
}

/**
 * The file a request path maps to, or `forbidden`.
 *
 * - A path ending in `/` gets its directory's `index.html`.
 * - A `typescript` route maps `<prefix><p>.js` to `<dir>/<p>.ts`, matching the
 *   `.js` specifiers the framework's sources use for their siblings.
 * - Everything else is a static file under `packageRoot`.
 *
 * @param {string} pathname  the URL path, still percent-encoded
 * @param {{ packageRoot: string, routes: readonly Route[] }} config
 * @returns {Resolution}
 */
export function resolveRequest(pathname, { packageRoot, routes }) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: "forbidden" };
  }
  if (decoded.includes("\0")) return { kind: "forbidden" };
  const segments = decoded.split(/[/\\]/);
  if (segments.includes("..")) return { kind: "forbidden" };
  if (decoded.startsWith(WORKER_VIEW)) {
    const inner = resolveRequest(decoded.slice(WORKER_VIEW.length - 1), {
      packageRoot,
      routes,
    });
    return inner.kind === "file" ? { ...inner, worker: true } : inner;
  }

  const withIndex = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const route = routes.find((r) => withIndex.startsWith(r.prefix));
  const base = route ? route.dir : packageRoot;
  let rel = route ? withIndex.slice(route.prefix.length) : withIndex;
  const typescript = Boolean(route?.typescript) && rel.endsWith(".js");
  if (typescript) rel = `${rel.slice(0, -3)}.ts`;

  const file = join(base, rel);
  if (file !== base && !file.startsWith(base + sep))
    return { kind: "forbidden" };
  return { kind: "file", file, typescript };
}

/**
 * The content type for a resolved file. Stripped TypeScript is JavaScript.
 *
 * @param {string} file
 * @param {boolean} typescript
 */
export function contentType(file, typescript) {
  if (typescript) return TYPES[".js"];
  return TYPES[extname(file)] ?? "application/octet-stream";
}
