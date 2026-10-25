import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { createBuildMetadataDefine } from "../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs";

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
    fileURLToPath(new URL(".", import.meta.url)),
  ),
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        // On-device measurement page, linked from nothing
        // (`write-probe.html.md`). An entry so that it is built and therefore
        // reachable on a deployed branch preview; nothing imports it.
        writeProbe: fileURLToPath(new URL("write-probe.html", import.meta.url)),
        // The desktop editor (M6 E1, `edit.html.md`): its own page, linked
        // from the setup page's "You already have a tour?" box and step 5
        // on a device without AR.
        edit: fileURLToPath(new URL("edit.html", import.meta.url)),
        // The legal notice and the privacy page (tour editor plan
        // 2026-10-17-1816, W6, `legal.html.md`): one static page, two
        // sections.
        legal: fileURLToPath(new URL("legal.html", import.meta.url)),
        // On-device check of what a phone's browser lets the editor do with a
        // file it saves (`file-access-check.html.md`), linked from nothing:
        // an entry so that it is built and reachable on a branch preview.
        fileAccessCheck: fileURLToPath(
          new URL("file-access-check.html", import.meta.url),
        ),
      },
    },
  },
});
