/**
 * Tiny dependency-free static server for the phone round: serves this
 * package over the LAN so an Android phone on the same Wi-Fi can open
 * the design system live (owner decision 2026-08-27: LAN server, not a
 * hosted deploy - refresh-speed iteration beats HTTPS).
 *
 * Usage:  pnpm run serve   (then open the printed LAN URL on the phone)
 *
 * Known, accepted limit: plain HTTP, so Android blocks getUserMedia -
 * the `live` camera background will fail with its normal error toast.
 * Every other background works; that trade was decided when the LAN
 * approach was picked over GitHub Pages.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  // resolve inside the package dir only - normalize strips ../ escapes
  const rel = normalize(path).replace(/^([/\\]|\.\.)+/, "");
  const file = join(here, rel === "" || rel === "." ? "index.html" : rel);
  if (!file.startsWith(here)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`design system served (Ctrl+C stops it):`);
  console.log(`  http://localhost:${port}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        console.log(`  http://${ni.address}:${port}/   <- phone, same Wi-Fi`);
      }
    }
  }
});
