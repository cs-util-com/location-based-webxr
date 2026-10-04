/**
 * Builds the deployable 3D look-dev page (plan 2026-09-23-0048, DEC-SKY-2:
 * "a deploy copy step so PR previews work on phones").
 *
 * NO BUNDLER, ON PURPOSE. The page is no-build, and its dev server already
 * knows how to turn every import into a file (`serve-routes.mjs`). This
 * builder asks the SAME route table, follows the page's static import graph
 * from its module script, strips TypeScript with Node's built-in stripper,
 * and writes each module to the path the browser will request, so the
 * deployed page is file-for-file the page `pnpm run serve` shows. The only
 * rewrite is the base: the page uses absolute route prefixes (`/fw/`,
 * `/osm/`, `/vendor/`, one per route in the table), which move under
 * `base` (e.g. `/lookdev/fw/`). Module workers and `new URL(…,
 * import.meta.url)` references are followed too, a worker's graph without
 * the import map (browsers apply none inside a worker). Two things a crawl
 * cannot see are added
 * after it: a `copyAll` route's whole directory when a page references it
 * (runtime assets that are fetched, not imported), and a route's `notice`
 * file beside anything emitted from it (a library's LICENSE).
 *
 * Output layout mirrors the package: `<outDir>/3d/index.html`,
 * `<outDir>/design.css`, `<outDir>/fw/…`, `<outDir>/osm/…`,
 * `<outDir>/vendor/three/…`, plus an `index.html` that lists every page.
 *
 * LAB PAGES (programme plan 2026-09-26-0539, DEC-PRG-2): every
 * `labs/<name>/index.html` is a small prototype page, and every further
 * top-level `.html` in its folder (the terrain lab's `compare.html`) is
 * another, each deployed exactly like the main page. The builder DISCOVERS
 * them from the folder, so workstreams adding labs in parallel never edit
 * a shared list.
 *
 * Called by the workspace's `scripts/build-site.mjs`; returns the written
 * paths (relative to `outDir`).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultRoutes, resolveRequest } from "./serve-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const MAIN_HTML = "/3d/index.html";
const LABS_DIR = "labs";
/** Static `import … from "x"`, `import "x"` and `export … from "x"`. */
const SPECIFIER =
  /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?["']([^"']+)["']/g;
/** A stylesheet the page links (the import crawl cannot see links). */
const STYLESHEET = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g;
/**
 * A module Worker, `new Worker(new URL("x", import.meta.url), …)`: resolved
 * against the module that names it. Terrain plan 2026-09-27-0605 §9, finding 3.
 */
const WORKER_BY_URL =
  /new\s+(?:Shared)?Worker\s*\(\s*new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
/** A Worker named by a plain string: resolved against the PAGE, not the module. */
const WORKER_BY_STRING = /new\s+(?:Shared)?Worker\s*\(\s*["']([^"']+)["']/g;
/** Any other `new URL("x", import.meta.url)`: a module or a fetched asset. */
const META_URL =
  /new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
/**
 * A dynamic `import("x")` with a literal specifier: a module loaded later
 * (the globe's arrival prefetch at the pin press, round-5 plan
 * 2026-10-01-0945 §3.6). Shipped like a static import, resolved with the
 * same import map; left out when `followDynamic` is false, which is how a
 * test reads a page's BOOT graph. Only OUR sources' dynamic imports are
 * followed, never a vendored library's: 3d-tiles-renderer's chunks import
 * optional packages it never loads here (`@mapbox/vector-tile`), which
 * no route serves.
 */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
/**
 * Block comments, and line comments that start at a line's beginning or
 * after whitespace or a semicolon (so `https://` in a string survives):
 * removed from our own sources before both import scans, because a JSDoc
 * type such as `{import("./x.js").T}`, a comment naming an import, or
 * prose quoting a word after "export" (`and "The export"; ...`) is not an
 * import. A vendored library is scanned as it is: its strings (shader
 * source) may hold comment markers that are not comments.
 */
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[\s;])\/\/[^\n]*/gm;
/** What the crawl follows as a module rather than copying as an asset. */
const MODULE_FILE = /\.m?js$/;

/** The page's import map; a page without modules that need one has none. */
function readImportMap(html) {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return match ? JSON.parse(match[1]).imports : {};
}

/** The page's `<title>`, for the landing index. */
function readTitle(html, url) {
  const match = html.match(/<title>([^<]*)<\/title>/);
  return match ? match[1].trim() : url;
}

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The deployable pages under `packageRoot`, as URL paths: the main page
 * first (when present), then every `labs/<name>/index.html`, sorted, each
 * followed by its lab's further top-level pages (`*.html`, sorted; e.g.
 * the terrain lab's `compare.html`). A folder without an index page is not
 * a lab.
 *
 * @param {string} packageRoot
 * @returns {string[]}
 */
export function discoverEntries(packageRoot) {
  const entries = existsSync(join(packageRoot, "3d", "index.html"))
    ? [MAIN_HTML]
    : [];
  const labs = join(packageRoot, LABS_DIR);
  if (!existsSync(labs)) return entries;
  const names = readdirSync(labs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(labs, name, "index.html")))
    .sort();
  return [
    ...entries,
    ...names.flatMap((name) => [
      `/${LABS_DIR}/${name}/index.html`,
      ...readdirSync(join(labs, name))
        .filter((f) => f.endsWith(".html") && f !== "index.html")
        .sort()
        .map((f) => `/${LABS_DIR}/${name}/${f}`),
    ]),
  ];
}

/**
 * A module specifier as the browser resolves it, as a URL path. Inside a
 * worker (`imports` is null) there is no import map, so a bare specifier
 * cannot resolve at all, and the error says why.
 */
function resolveSpecifier(specifier, fromUrl, imports) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(fromUrl), specifier));
  }
  if (specifier.startsWith("/")) return specifier;
  if (imports === null) {
    throw new Error(
      `cannot resolve "${specifier}" imported by ${fromUrl} (a worker: import maps do not apply there, use a route URL)`,
    );
  }
  if (imports[specifier]) return imports[specifier];
  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return imports[prefix] + specifier.slice(prefix.length);
  throw new Error(`cannot resolve "${specifier}" imported by ${fromUrl}`);
}

/**
 * A URL reference (`new URL(ref, base)`, `new Worker(ref)`) as a URL path:
 * relative to `baseUrl` unless absolute; null for another origin.
 */
function resolveUrlRef(ref, baseUrl) {
  if (/^[a-z][a-z\d+.-]*:/i.test(ref)) return null;
  if (ref.startsWith("/")) return posix.normalize(ref);
  return posix.normalize(posix.join(posix.dirname(baseUrl), ref));
}

/**
 * The rewrite that moves the page's absolute route prefixes under the deploy
 * base. The prefixes come from the ROUTE TABLE (their first path segment),
 * so a new route is rebased without a second list to keep in step.
 */
function rebaser(routes) {
  const heads = [
    ...new Set(routes.map((r) => r.prefix.split("/").filter(Boolean)[0])),
  ]
    .sort((a, b) => b.length - a.length)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(["'])\\/(${heads.join("|")})\\/`, "g");
  return (text, base) => text.replace(pattern, `$1${base}$2/`);
}

/** Every file under `dir`, as posix paths relative to it; links skipped. */
function walk(dir, rel = "") {
  const out = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/**
 * @param {{ outDir: string, base: string, packageRoot?: string,
 *   routes?: import("./serve-routes.mjs").Route[], entries?: string[],
 *   followDynamic?: boolean }} options
 *   `packageRoot` defaults to this package and `routes` to the dev server's
 *   table (tests pass fixtures). `entries` defaults to every page
 *   (`discoverEntries`); `followDynamic` (default true) follows literal
 *   dynamic `import("x")`s, false gives the static boot graph only.
 * @returns {string[]} written paths, relative to `outDir`
 */
export function buildLookdev({
  outDir,
  base,
  packageRoot = here,
  routes = defaultRoutes(repo),
  entries = discoverEntries(packageRoot),
  followDynamic = true,
}) {
  if (!base.startsWith("/") || !base.endsWith("/")) {
    throw new Error(`base must start and end with "/", got ${base}`);
  }
  const rebase = rebaser(routes);
  const load = (url) => {
    const target = resolveRequest(url, { packageRoot, routes });
    if (target.kind !== "file") throw new Error(`refused to read ${url}`);
    const raw = readFileSync(target.file, "utf8");
    return target.typescript ? stripTypeScriptTypes(raw) : raw;
  };
  const written = [];
  const emittedUrls = [];
  /** The raw text of every page and module, for the asset references. */
  const sources = [];
  const target = (url) => {
    const file = join(outDir, ...url.replace(/^\//, "").split("/"));
    const rel = relative(outDir, file);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`refusing to write outside ${outDir}: ${url}`);
    }
    mkdirSync(dirname(file), { recursive: true });
    emittedUrls.push(url);
    written.push(rel.split(sep).join("/"));
    return file;
  };
  const emit = (url, text) => writeFileSync(target(url), text);
  /** Binary-safe: runtime assets and notices are copied, never re-encoded. */
  const copy = (url) => {
    const source = resolveRequest(url, { packageRoot, routes });
    if (source.kind !== "file") throw new Error(`refused to read ${url}`);
    copyFileSync(source.file, target(url));
  };

  // One crawl over every page: a module or stylesheet shared by several
  // pages (three, the framework, design.css) is written once.
  const seen = new Set();
  const pages = [];
  for (const entry of entries) {
    const html = load(entry);
    sources.push(html);
    const imports = readImportMap(html);
    emit(entry, rebase(html, base));
    pages.push({ entry, title: readTitle(html, entry) });
    for (const match of html.matchAll(STYLESHEET)) {
      if (/^[a-z]+:/i.test(match[1])) continue; // an external font sheet
      const url = resolveSpecifier(match[1], entry, imports);
      if (seen.has(url)) continue;
      seen.add(url);
      emit(url, load(url));
    }
    // A queued module carries its context: a worker's graph has no import
    // map, so the same file is checked again when a worker reaches it.
    const queue = [
      ...html.matchAll(/<script type="module" src="([^"]+)"/g),
    ].map((m) => ({
      url: resolveSpecifier(m[1], entry, imports),
      worker: false,
    }));
    while (queue.length > 0) {
      const { url, worker } = queue.shift();
      const key = worker ? `worker:${url}` : url;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = load(url);
      sources.push(text);
      const scope = worker ? null : imports;
      const ours = !url.startsWith("/vendor/");
      const code = ours ? text.replace(COMMENTS, "$1") : text;
      for (const match of code.matchAll(SPECIFIER)) {
        queue.push({ url: resolveSpecifier(match[1], url, scope), worker });
      }
      if (followDynamic && ours) {
        for (const match of code.matchAll(DYNAMIC_IMPORT)) {
          queue.push({ url: resolveSpecifier(match[1], url, scope), worker });
        }
      }
      // WORKERS AND import.meta.url REFERENCES (terrain plan §9, finding 3):
      // not imports, so the specifier scan above cannot see them.
      const workers = [
        ...[...text.matchAll(WORKER_BY_URL)].map((m) =>
          resolveUrlRef(m[1], url),
        ),
        // A string names its worker relative to the PAGE.
        ...[...text.matchAll(WORKER_BY_STRING)].map((m) =>
          resolveUrlRef(m[1], entry),
        ),
      ];
      for (const ref of workers) {
        if (ref !== null) queue.push({ url: ref, worker: true });
      }
      for (const match of text.replace(WORKER_BY_URL, "").matchAll(META_URL)) {
        const ref = resolveUrlRef(match[1], url);
        if (ref === null) continue;
        if (MODULE_FILE.test(ref)) queue.push({ url: ref, worker });
        else if (!emittedUrls.includes(ref)) copy(ref);
      }
      if (!emittedUrls.includes(url)) emit(url, rebase(text, base));
    }
  }

  // RUNTIME ASSETS AND NOTICES: a copyAll route is copied whole when any
  // emitted page or module references its prefix (fetched tiles are invisible
  // to the crawl); a notice ships beside anything emitted from its route.
  const crawled = [...emittedUrls];
  for (const route of routes) {
    const used = crawled.some((u) => u.startsWith(route.prefix));
    const referenced = used || sources.some((t) => t.includes(route.prefix));
    if (route.copyAll && referenced) {
      for (const rel of walk(route.dir)) {
        const url = route.prefix + rel;
        if (!emittedUrls.includes(url)) copy(url);
      }
    }
    if (route.notice && used) {
      const url = route.prefix + route.notice;
      if (!emittedUrls.includes(url)) copy(url);
    }
  }

  // THE LANDING INDEX lists every page. It used to redirect to 3d/, which
  // would hide the labs. Relative links, so it works under any base.
  const items = pages
    .map(({ entry, title }) => {
      const href = "." + entry.replace(/index\.html$/, "");
      return `  <li><a href="${href}">${escapeHtml(title)}</a></li>`;
    })
    .join("\n");
  emit(
    "/index.html",
    '<!doctype html>\n<meta charset="utf-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      "<title>Look-dev</title>\n<h1>Look-dev pages</h1>\n<ul>\n" +
      items +
      "\n</ul>\n",
  );
  return written;
}
