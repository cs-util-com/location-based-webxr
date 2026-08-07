import { defineConfig } from 'vite';

// Wayfinding-HUD demo Vite config. AppFramework resolves through the pnpm
// workspace symlink; the published gps-plus-slam-js comes from node_modules.
// The port is allocated in docs/dev-server-ports.md, which is the ONLY place
// that knows the whole set. This comment used to name the sibling apps it was
// distinct from, including "the physics demo (5182)" — which was true when it
// was written and had since become ambiguous between three packages.
export default defineConfig({
  server: {
    port: 5183,
    // Listen on all interfaces so 127.0.0.1 (what the Playwright e2e config
    // polls) responds, not just the `localhost` alias — mirrors the sibling
    // apps (Windows `localhost` can resolve to IPv6 ::1 while Playwright
    // probes IPv4 127.0.0.1, hanging the webServer wait otherwise).
    host: true,
  },
});
