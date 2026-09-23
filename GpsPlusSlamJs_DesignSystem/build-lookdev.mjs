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
 * `<outDir>/vendor/three/…`, plus an `index.html` that opens `3d/`.
 *
 * Called by the workspace's `scripts/build-site.mjs`; returns the written
 * paths (relative to `outDir`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultRoutes, resolveRequest } from "./serve-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const ENTRY_HTML = "/3d/index.html";
/** Files the HTML references by <link>, which the import crawl cannot see. */
const STATIC_FILES = ["/3d/lookdev.css", "/design.css"];
/** Static `import … from "x"`, `import "x"` and `export … from "x"`. */
const SPECIFIER =
  /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?["']([^"']+)["']/g;

function readImportMap(html) {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`${ENTRY_HTML} has no import map`);
  return JSON.parse(match[1]).imports;
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
 * @param {{ outDir: string, base: string }} options
 * @returns {string[]} written paths, relative to `outDir`
 */
export function buildLookdev({ outDir, base }) {
  if (!base.startsWith("/") || !base.endsWith("/")) {
    throw new Error(`base must start and end with "/", got ${base}`);
  }
  const routes = defaultRoutes(repo);
  const load = (url) => {
    const target = resolveRequest(url, { packageRoot: here, routes });
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

  const html = load(ENTRY_HTML);
  const imports = readImportMap(html);
  emit(ENTRY_HTML, rebase(html, base));
  for (const url of STATIC_FILES) emit(url, load(url));

  const queue = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(
    (m) => resolveSpecifier(m[1], ENTRY_HTML, imports),
  );
  const seen = new Set();
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

  emit(
    "/index.html",
    '<!doctype html>\n<meta charset="utf-8" />\n' +
      '<meta http-equiv="refresh" content="0; url=./3d/" />\n' +
      '<title>Look-dev</title>\n<a href="./3d/">Open the 3D look-dev page</a>\n',
  );
  return written;
}
