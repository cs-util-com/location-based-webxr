import { defineConfig } from 'vite';

// Minimal Vite config: default entry is index.html in this directory.
// gps-plus-slam-osm and the app framework both resolve through the pnpm
// workspace symlinks; Leaflet and three come from node_modules. No aliases.
export default defineConfig({
  server: {
    // Pinned to IPv4 rather than left as the `localhost` default: on Windows
    // `localhost` resolves to ::1 first, so Playwright's webServer poll of
    // 127.0.0.1 never sees the server and times out with no error to read.
    host: '127.0.0.1',
    port: 5186,
  },
});
