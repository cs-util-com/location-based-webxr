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
 * rewrite is the base: the page uses absolute `/fw/`, `/osm/` and
 * `/vendor/` specifiers, which move under `base` (e.g. `/lookdev/fw/`).
 *
 * Output layout mirrors the package: `<outDir>/3d/index.html`,
 * `<outDir>/design.css`, `<outDir>/fw/…`, `<outDir>/osm/…`,
 * `<outDir>/vendor/three/…`, plus an `index.html` that lists every page.
 *
 * LAB PAGES (programme plan 2026-09-26-0539, DEC-PRG-2): every
 * `labs/<name>/index.html` is a small prototype page, deployed exactly like
 * the main page. The builder DISCOVERS them from the folder, so workstreams
 * adding labs in parallel never edit a shared list.
 *
 * Called by the workspace's `scripts/build-site.mjs`; returns the written
 * paths (relative to `outDir`).
 */
import {
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
 * first (when present), then every `labs/<name>/index.html`, sorted.
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
    ...names.map((name) => `/${LABS_DIR}/${name}/index.html`),
  ];
}

/** A module specifier as the browser resolves it, as a URL path. */
function resolveSpecifier(specifier, fromUrl, imports) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(fromUrl), specifier));
  }
  if (specifier.startsWith("/")) return specifier;
  if (imports[specifier]) return imports[specifier];
  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return imports[prefix] + specifier.slice(prefix.length);
  throw new Error(`cannot resolve "${specifier}" imported by ${fromUrl}`);
}

/** Move the page's absolute prefixes under the deploy base. */
function rebase(text, base) {
  return text.replace(/(["'])\/(fw|osm|vendor)\//g, `$1${base}$2/`);
}

/**
 * @param {{ outDir: string, base: string, packageRoot?: string }} options
 *   `packageRoot` defaults to this package (tests pass a fixture).
 * @returns {string[]} written paths, relative to `outDir`
 */
export function buildLookdev({ outDir, base, packageRoot = here }) {
  if (!base.startsWith("/") || !base.endsWith("/")) {
    throw new Error(`base must start and end with "/", got ${base}`);
  }
  const routes = defaultRoutes(repo);
  const load = (url) => {
    const target = resolveRequest(url, { packageRoot, routes });
    if (target.kind !== "file") throw new Error(`refused to read ${url}`);
    const raw = readFileSync(target.file, "utf8");
    return target.typescript ? stripTypeScriptTypes(raw) : raw;
  };
  const written = [];
  const emit = (url, text) => {
    const file = join(outDir, ...url.replace(/^\//, "").split("/"));
    const rel = relative(outDir, file);
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`refusing to write outside ${outDir}: ${url}`);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    written.push(rel.split(sep).join("/"));
  };

  // One crawl over every page: a module or stylesheet shared by several
  // pages (three, the framework, design.css) is written once.
  const seen = new Set();
  const pages = [];
  for (const entry of discoverEntries(packageRoot)) {
    const html = load(entry);
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
    const queue = [
      ...html.matchAll(/<script type="module" src="([^"]+)"/g),
    ].map((m) => resolveSpecifier(m[1], entry, imports));
    while (queue.length > 0) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      const text = load(url);
      for (const match of text.matchAll(SPECIFIER)) {
        queue.push(resolveSpecifier(match[1], url, imports));
      }
      emit(url, rebase(text, base));
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
