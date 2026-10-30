/**
 * The dev server's `/globe-assets/` route (the e2e runs on the same
 * server): the globe package's `assets/` folder, which the globe's surface
 * asks for by these absolute paths. Only the editor on the globe view
 * (`editor3d-globe.ts`, behind its link switch) loads them; the built site
 * does not carry them.
 *
 * @see globe-assets-route.ts.md
 */
import { readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

import type { Plugin } from "vite";

export const GLOBE_ASSETS_PREFIX = "/globe-assets/";

const TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
});

/**
 * The file under `dir` a request URL names, or null: for a URL outside the
 * prefix, the bare prefix, a path that cannot be decoded, holds a NUL, or
 * leaves `dir` (plain or percent-encoded `..`). The query is ignored.
 */
export function globeAssetFile(url: string, dir: string): string | null {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith(GLOBE_ASSETS_PREFIX)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(path.slice(GLOBE_ASSETS_PREFIX.length));
  } catch {
    return null;
  }
  if (rest === "" || rest.includes("\0")) return null;
  const file = join(dir, rest);
  const inside = relative(dir, file);
  if (inside === "" || inside.startsWith("..") || inside.includes(`..${sep}`))
    return null;
  return file;
}

/** The parts of a response the route writes. */
interface AssetResponse {
  setHeader(name: string, value: string): void;
  statusCode: number;
  end(chunk?: Buffer): void;
}

/**
 * Answers one request: the file with its type (200), 404 for a file that
 * is not there, 403 for a refused path under the prefix; `next()` for a URL
 * outside the prefix.
 */
export function serveGlobeAsset(
  req: { readonly url?: string | undefined },
  res: AssetResponse,
  dir: string,
  next: () => void,
): void {
  const url = req.url ?? "";
  if (!url.startsWith(GLOBE_ASSETS_PREFIX)) {
    next();
    return;
  }
  const file = globeAssetFile(url, dir);
  if (file === null) {
    res.statusCode = 403;
    res.end();
    return;
  }
  let isFile: boolean;
  try {
    isFile = statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader(
    "Content-Type",
    TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
  );
  // The tiles are small (about 6 KB each): read whole.
  res.end(readFileSync(file));
}

/** The route as a Vite plugin, serving `dir` (the dev server only). */
export function globeAssetsRoute(dir: string): Plugin {
  return {
    name: "tour-viewer-globe-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        serveGlobeAsset(req, res, dir, next);
      });
    },
  };
}
