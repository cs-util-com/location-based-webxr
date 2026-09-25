import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";

// Dev-only CORS proxy for Component 6, mirroring the production Cloudflare
// Worker's `?u=` interface so a demo `?tour=` URL is identical in both. The
// browser talks to same-origin localhost (no CORS), and this middleware fetches
// the target server-side (Node fetch ignores CORS), following redirects and
// forwarding the Range header so byte-range 206 reads pass straight through.
// Host-allowlisted to the everyday cloud providers so it is not an open relay.
// See src/components/cloud-loader/RECIPE.md.
//
// The `u=` target runs through the same share-link normalization as a direct
// `?tour=` URL, so a pasted share *page* link works through the proxy too.
// Share-page hosts (www.dropbox.com) are deliberately NOT allowlisted: anything
// normalization couldn't turn into a raw download URL (e.g. a folder link)
// 403s loudly here instead of quietly streaming an HTML preview page into
// zip.js as "corrupt".
const ALLOWED_PROXY_HOSTS = new Set([
  "dl.dropboxusercontent.com",
  // Key-less Google Drive: advertises CORS to plain clients but 403s any
  // browser request (Sec-Fetch-Site: cross-site), so it must come through
  // here, where Node's fetch carries no Sec-Fetch headers.
  "drive.usercontent.google.com",
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
]);

function tourProxyPlugin(): Plugin {
  return {
    name: "cloud-loader-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/tour-proxy", (req, res, next) => {
        const target = new URL(
          req.url ?? "",
          "http://localhost",
        ).searchParams.get("u");
        if (!target) {
          next();
          return;
        }
        let url: URL;
        try {
          url = new URL(normalizeShareUrl(target));
        } catch {
          res.statusCode = 400;
          res.end("bad ?u= url");
          return;
        }
        if (!ALLOWED_PROXY_HOSTS.has(url.hostname)) {
          res.statusCode = 403;
          res.end(`host not allowed: ${url.hostname}`);
          return;
        }

        const range = req.headers.range;
        void fetch(url, {
          method: req.method,
          headers: range ? { Range: range } : {},
          redirect: "follow",
        })
          .then((upstream) => {
            // A tour.zip is never HTML. An HTML final response after the
            // redirect chain is a login page (file not shared publicly) or a
            // virus-scan interstitial — fail loudly instead of streaming it
            // into zip.js as a mystery "corrupt".
            const contentType = upstream.headers.get("content-type") ?? "";
            if (contentType.startsWith("text/html")) {
              res.statusCode = 502;
              res.end(
                "upstream answered with an HTML page (login or interstitial), " +
                  "not the file — check the file's sharing settings " +
                  '(Google Drive: "Anyone with the link")',
              );
              return;
            }
            res.statusCode = upstream.status;
            // Never let the browser cache proxied responses: the same URL yields
            // 206 range reads and a 200 full warm download, and without this the
            // browser's range cache cross-contaminates them (a cached partial
            // served for a later range) → zip.js reads garbage → "not a readable
            // zip". Node's fetch has no such cache, so this only bites in-browser.
            res.setHeader("Cache-Control", "no-store");
            for (const h of [
              "content-type",
              "content-length",
              "content-range",
              "accept-ranges",
            ]) {
              const v = upstream.headers.get(h);
              if (v) res.setHeader(h, v);
            }
            if (!upstream.body) {
              res.end();
              return;
            }
            Readable.fromWeb(upstream.body).pipe(res);
          })
          .catch((err: unknown) => {
            res.statusCode = 502;
            res.end(`proxy fetch failed: ${String(err)}`);
          });
      });
    },
  };
}

// TourBuilder is a multi-page app: one runnable demo page per component under
// src/components/<name>/index.html, plus a root gallery that links to them. Vite's
// dev server auto-serves every nested index.html by path (e.g.
// /src/components/billboard/ runs the billboard demo alone); the build emits each
// as its own HTML entry. Add one line to `input` per new component.
//
// AppFramework resolves through the pnpm workspace symlink; three comes from
// node_modules. A distinct port keeps it runnable alongside the minimal example
// (5180), starter (5181) and recorder. 5182 collides with several other
// standalone demos in this repo (Landing, PhysicsDemo, QrTrackingDemo) that
// are never run alongside TourBuilder, and the whole 51xx range is unusable
// on some dev machines/tooling (Windows-excluded-port checks) — 8185 avoids
// both.
export default defineConfig({
  plugins: [tourProxyPlugin()],
  server: {
    port: 8185,
    host: true,
    // Dev-only: lets a localtunnel/cloudflared/etc. HTTPS tunnel through
    // Vite's Host-header allowlist (DNS-rebinding guard) for phone testing
    // over a secure context. Covers both tunnel providers' random subdomains.
    allowedHosts: [".loca.lt", ".trycloudflare.com"],
  },
  build: {
    rollupOptions: {
      input: {
        gallery: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "src/app/index.html"),
        billboard: resolve(__dirname, "src/components/billboard/index.html"),
        inWorldText: resolve(
          __dirname,
          "src/components/in-world-text/index.html",
        ),
        store: resolve(__dirname, "src/components/store/index.html"),
        proximity: resolve(__dirname, "src/components/proximity/index.html"),
        packaging: resolve(__dirname, "src/components/packaging/index.html"),
        cloudLoader: resolve(
          __dirname,
          "src/components/cloud-loader/index.html",
        ),
        map: resolve(__dirname, "src/components/map/index.html"),
        arScene: resolve(__dirname, "src/components/ar-scene/index.html"),
        onboarding: resolve(__dirname, "src/components/onboarding/index.html"),
        authoring: resolve(__dirname, "src/components/authoring/index.html"),
        desktopPreview: resolve(
          __dirname,
          "src/components/desktop-preview/index.html",
        ),
      },
    },
  },
});
