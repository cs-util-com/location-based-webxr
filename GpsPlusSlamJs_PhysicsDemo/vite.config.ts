import { defineConfig } from 'vite';

// Physics-demo Vite config. AppFramework resolves through the pnpm workspace
// symlink; the published gps-plus-slam-js comes from node_modules. Rapier ships
// as `@dimforge/rapier3d-compat` (WASM inlined, async RAPIER.init()) so no Vite
// WASM plugin is needed. A distinct port keeps it runnable alongside the minimal
// example (5180), the anchor starter (5181) and the recorder.
export default defineConfig({
  server: {
    port: 5182,
    // Listen on all interfaces so 127.0.0.1 (what the Playwright e2e config
    // polls) responds, not just the `localhost` alias — mirrors the sibling
    // apps (Windows `localhost` can resolve to IPv6 ::1 while Playwright probes
    // IPv4 127.0.0.1, hanging the webServer wait otherwise).
    host: true,
  },
});
