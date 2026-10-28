import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Landing-page Vite config. The page is dependency-light (three.js +
// anime.js only, no framework/core packages), so no aliases are needed.
// A distinct port keeps it runnable alongside the minimal example (5180)
// and the anchor starter (5181).
export default defineConfig({
  server: {
    port: 5182,
    // Listen on all interfaces so 127.0.0.1 responds, not just the
    // `localhost` alias (on Windows `localhost` can resolve to IPv6 `::1`).
    // Mirrors the sibling apps.
    host: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        // The site-wide legal notice and privacy page (legal/index.html.md),
        // built into dist-site/legal/ and linked from every app.
        legal: fileURLToPath(new URL("legal/index.html", import.meta.url)),
      },
    },
  },
});
