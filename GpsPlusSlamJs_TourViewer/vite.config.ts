import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { createBuildMetadataDefine } from '../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs';

// Tour-viewer Vite config. AppFramework resolves through the pnpm workspace
// symlink. Port allocation lives in ../docs/dev-server-ports.md — this
// package owns 5187.
export default defineConfig({
  server: {
    port: 5187,
    // Listen on all interfaces so 127.0.0.1 (what the Playwright e2e config
    // polls) responds, not just the `localhost` alias — on Windows
    // `localhost` can resolve to IPv6 `::1` while Playwright probes IPv4.
    host: true,
  },
  // The build stamp a troubleshooting recording's session.json carries
  // (commit, versions, build time), read by the framework's
  // `utils/build-info`. The same block as the Recorder's.
  define: createBuildMetadataDefine(
    fileURLToPath(new URL('.', import.meta.url)),
  ),
});
