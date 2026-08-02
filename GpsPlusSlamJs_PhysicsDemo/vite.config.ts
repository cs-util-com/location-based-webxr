import { defineConfig } from 'vite';

// Physics-demo Vite config. AppFramework resolves through the pnpm workspace
// symlink; the published gps-plus-slam-js comes from node_modules. Rapier ships
// as `@dimforge/rapier3d-compat` (WASM inlined, async RAPIER.init()) so no Vite
// WASM plugin is needed.
//
// The port is allocated in docs/dev-server-ports.md, which is the ONLY place
// that knows the whole set. This comment used to name the sibling apps it was
// distinct from — a claim about OTHER packages, made in a file with no way to
// notice when one of them changes — and three packages ended up on 5182 with all
// three comments still asserting distinctness.
export default defineConfig({
  server: {
    port: 5184,
    // Listen on all interfaces so 127.0.0.1 (what the Playwright e2e config
    // polls) responds, not just the `localhost` alias — mirrors the sibling
    // apps (Windows `localhost` can resolve to IPv6 ::1 while Playwright probes
    // IPv4 127.0.0.1, hanging the webServer wait otherwise).
    host: true,
  },
});
