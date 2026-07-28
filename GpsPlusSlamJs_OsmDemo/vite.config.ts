import { defineConfig } from 'vite';

// Minimal Vite config: default entry is index.html in this directory.
// gps-plus-slam-osm and the app framework both resolve through the pnpm
// workspace symlinks; Leaflet and three come from node_modules. No aliases.
export default defineConfig({
  server: {
    port: 5186,
  },
});
