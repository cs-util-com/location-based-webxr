import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Minimal Vite config: gps-plus-slam-osm and the app framework both resolve
// through the pnpm workspace symlinks; Leaflet and three come from
// node_modules. No aliases.
export default defineConfig({
  server: {
    // Pinned to IPv4 rather than left as the `localhost` default: on Windows
    // `localhost` resolves to ::1 first, so Playwright's webServer poll of
    // 127.0.0.1 never sees the server and times out with no error to read.
    host: '127.0.0.1',
    port: 5186,
  },
  build: {
    rollupOptions: {
      // TWO ENTRIES SINCE W7. `index.html` is the demo; `gallery.html` shows all
      // fifty procedural POI models on neutral pads at true relative scale
      // (DEC-R5-5, closing F28). Declaring both is what keeps the gallery in the
      // production build — with the default single entry, Vite serves it in dev
      // and silently drops it from `dist`, which is the shape of bug where a
      // page works locally forever and 404s once deployed.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        gallery: resolve(import.meta.dirname, 'gallery.html'),
      },
    },
  },
});
