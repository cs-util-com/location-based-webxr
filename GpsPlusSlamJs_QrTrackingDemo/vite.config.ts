import { defineConfig } from 'vite';

// QR-tracking demo Vite config. AppFramework resolves through the pnpm
// workspace symlink; the published gps-plus-slam-js comes from node_modules.
// The port is allocated in docs/dev-server-ports.md, which is the ONLY place
// that knows the whole set. This comment used to name the sibling apps it was
// distinct from — a claim about OTHER packages, made in a file with no way to
// notice when one of them changes. It said 5182, so did the landing and so did
// the physics demo, and all three still asserted distinctness. What that cost:
// `reuseExistingServer` meant this package's e2e suite silently ran against the
// LANDING PAGE, five tests failing on a missing start screen.
//
// `host: true` mirrors the sibling apps so 127.0.0.1 (what the Playwright e2e
// polls) responds, not just the `localhost` alias.
export default defineConfig({
  server: {
    port: 5185,
    host: true,
  },
});
