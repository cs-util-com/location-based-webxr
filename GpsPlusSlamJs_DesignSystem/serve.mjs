/**
 * Tiny dependency-free static server for the phone round: serves this
 * package over the LAN so an Android phone on the same Wi-Fi can open
 * the design system live (owner decision 2026-08-27: LAN server, not a
 * hosted deploy - refresh-speed iteration beats HTTPS).
 *
 * Usage:  pnpm run serve   (then open the printed LAN URL on the phone)
 *         the 3D look-dev page is at /3d/
 *
 * Known, accepted limit: plain HTTP, so Android blocks getUserMedia -
 * the `live` camera background will fail with its normal error toast.
 * Every other background works; that trade was decided when the LAN
 * approach was picked over GitHub Pages.
 *
 * THE 3D PAGE'S ROUTES (plan 2026-09-23-0048 §4.1). The look-dev page
 * imports the framework's TypeScript source, so the atmosphere is written
 * once and still reloads without a build:
 *   /fw/<p>.js     -> GpsPlusSlamJs_AppFramework/src/<p>.ts, types stripped
 *   /osm/<p>.js    -> GpsPlusSlamJs_OsmDemo/src/<p>.ts, types stripped (the
 *                     page uses OsmDemo's own sun model, not a copy)
 *   /vendor/three/ -> the framework's own node_modules/three, the lockfile-
 *                     pinned copy every app uses; the page's import map
 *                     points here, so no CDN and no second version pin.
 * Types are stripped by Node's built-in `module.stripTypeScriptTypes`
 * (present in Node 24 and 26, flagged experimental), so the package gains
 * no dependency. It only ERASES syntax: a file using an enum or a
 * value-imported type fails here, loudly, as a module error on the page.
 *
 * Env: PORT (default 4173), HOST (default 0.0.0.0; the smoke test binds
 * 127.0.0.1 so it never exposes anything on the LAN).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

import { contentType, defaultRoutes, resolveRequest } from "./serve-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";

const routes = defaultRoutes(repo);

// stripTypeScriptTypes' experimental warning says nothing actionable about a
// dev server. Only THAT warning is dropped: every other one is still printed
// (the first version silenced all warnings; M1 milestone review).
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  const strip =
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("stripTypeScriptTypes");
  if (!strip) console.warn(warning);
});

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const target = resolveRequest(path, { packageRoot: here, routes });
  if (target.kind === "forbidden") {
    res.writeHead(403).end();
    return;
  }
  try {
    const raw = await readFile(target.file);
    const body = target.typescript
      ? stripTypeScriptTypes(raw.toString("utf8"))
      : raw;
    res.writeHead(200, {
      "content-type": contentType(target.file, target.typescript),
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (error) {
    // A strip failure (non-erasable syntax) is a 500 with the reason, so the
    // page's console names the file instead of a bare network error.
    const missing = error?.code === "ENOENT" || error?.code === "EISDIR";
    res
      .writeHead(missing ? 404 : 500, { "content-type": "text/plain" })
      .end(missing ? "not found" : String(error?.message ?? error));
  }
});

server.listen(port, host, () => {
  console.log(`design system served (Ctrl+C stops it):`);
  console.log(`  http://localhost:${port}/     HUD catalog`);
  console.log(`  http://localhost:${port}/3d/  3D look-dev page`);
  if (host !== "0.0.0.0") return;
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        console.log(`  http://${ni.address}:${port}/   <- phone, same Wi-Fi`);
      }
    }
  }
});
