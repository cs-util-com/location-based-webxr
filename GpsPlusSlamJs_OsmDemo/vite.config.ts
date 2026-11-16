import { defineConfig } from "vite";
import { resolve } from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";

/**
 * Uploads the source maps to the error service during a production build
 * (the commit becomes the release), and gives each bundle a debug id so a
 * report's stack maps back to the source. Only when SENTRY_AUTH_TOKEN is set:
 * a build without it (local, CI, a contributor's) uploads nothing and does
 * not fail. One upload failure does not fail the build either. Same project
 * as the Recorder; the reports carry an app tag.
 */
const sentryPlugins = () =>
  process.env.SENTRY_AUTH_TOKEN
    ? [
        sentryVitePlugin({
          org: "cs-util-com",
          project: "js-gps-recorder",
          errorHandler: (error) => {
            console.warn("Sentry source-map upload failed:", error.message);
          },
        }),
      ]
    : [];

// Minimal Vite config: gps-plus-slam-osm and the app framework both resolve
// through the pnpm workspace symlinks; Leaflet and three come from
// node_modules. No aliases.
export default defineConfig({
  plugins: sentryPlugins(),
  // The city build runs in a Web Worker, bundled separately: it needs the
  // plugin too for its debug id (the page's instance uploads its map).
  worker: { plugins: sentryPlugins },
  server: {
    // Pinned to IPv4 rather than left as the `localhost` default: on Windows
    // `localhost` resolves to ::1 first, so Playwright's webServer poll of
    // 127.0.0.1 never sees the server and times out with no error to read.
    host: "127.0.0.1",
    port: 5186,
  },
  build: {
    // Maps are built for the error service, but no bundle points at them, so
    // a visitor's browser never fetches them.
    sourcemap: "hidden",
    rollupOptions: {
      // TWO ENTRIES SINCE W7. `index.html` is the demo; `gallery.html` shows all
      // fifty procedural POI models on neutral pads at true relative scale
      // (DEC-R5-5, closing F28). Declaring both is what keeps the gallery in the
      // production build — with the default single entry, Vite serves it in dev
      // and silently drops it from `dist`, which is the shape of bug where a
      // page works locally forever and 404s once deployed.
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        gallery: resolve(import.meta.dirname, "gallery.html"),
      },
    },
  },
});
