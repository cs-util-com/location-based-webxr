import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";

import { globeAssetsRoute } from "./src/dev-server/globe-assets-route.js";
import { createBuildMetadataDefine } from "../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs";
import { sentrySourceMapPlugins } from "../GpsPlusSlamJs_AppFramework/scripts/sentry-vite-plugins.mjs";

/**
 * Uploads the source maps to the error service during a production build
 * (the commit becomes the release), gives each bundle a debug id so a
 * report's stack maps back to the source, then deletes the maps so they are
 * not deployed. Only when SENTRY_AUTH_TOKEN is set: a build without it
 * (local, CI, a contributor's) runs none of it and does not fail. Same
 * project as the Recorder; the reports carry an app tag.
 */
const sentry = sentrySourceMapPlugins(sentryVitePlugin);

// Tour-viewer Vite config. AppFramework resolves through the pnpm workspace
// symlink. Port allocation lives in ../docs/dev-server-ports.md — this
// package owns 5187.
export default defineConfig({
  // The globe package's imagery at /globe-assets/, for the editor on the
  // globe view (the dev server and the e2e; the deployed site serves the
  // site build's root copy, scripts/build-site.mjs; globe-assets-route.ts).
  plugins: [
    globeAssetsRoute(
      fileURLToPath(new URL("../GpsPlusSlamJs_Globe/assets", import.meta.url)),
    ),
    ...sentry.plugins,
  ],
  // The city build and the other workers are bundled separately: they need
  // the plugin too for their debug ids (the page's instance uploads the maps).
  worker: { plugins: sentry.workerPlugins },
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
    // Maps are built for the error service, but no bundle points at them, so
    // a visitor's browser never fetches them.
    sourcemap: "hidden",
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
        // Forwards old links to the site-wide legal page at /legal/
        // (`legal.html.md`).
        legal: fileURLToPath(new URL("legal.html", import.meta.url)),
        // The character maker and the on-device library of characters
        // (`characters.html.md`); the editor opens it in a dialog.
        characters: fileURLToPath(new URL("characters.html", import.meta.url)),
        // The splat trainer page (`splat/index.html.md`), linked from nothing
        // yet: an entry so that it is built and reachable on a branch preview.
        splat: fileURLToPath(new URL("splat/index.html", import.meta.url)),
        // On-device check of what a phone's browser lets the editor do with a
        // file it saves (`file-access-check.html.md`), linked from nothing:
        // an entry so that it is built and reachable on a branch preview.
        fileAccessCheck: fileURLToPath(
          new URL("file-access-check.html", import.meta.url),
        ),
        // A tour model in each world view without an AR session
        // (`model-views-check.html.md`), linked from nothing.
        modelViewsCheck: fileURLToPath(
          new URL("model-views-check.html", import.meta.url),
        ),
        // A tour character in each world view without an AR session
        // (`character-views-check.html.md`), linked from nothing.
        characterViewsCheck: fileURLToPath(
          new URL("character-views-check.html", import.meta.url),
        ),
        // A new kind of item in a story and in a station, side by side
        // (`item-lab.html.md`), linked from nothing.
        itemLab: fileURLToPath(new URL("item-lab.html", import.meta.url)),
        // A long text on its reading stand without an AR session
        // (`lectern-check.html.md`), linked from nothing.
        lecternCheck: fileURLToPath(
          new URL("lectern-check.html", import.meta.url),
        ),
        // Then and now's picture and its Swipe line without an AR session
        // (`then-now-check.html.md`), linked from nothing.
        thenNowCheck: fileURLToPath(
          new URL("then-now-check.html", import.meta.url),
        ),
        // A narration circle in its look without an AR session
        // (`narration-look-check.html.md`), linked from nothing.
        narrationLookCheck: fileURLToPath(
          new URL("narration-look-check.html", import.meta.url),
        ),
        // Keypoint extraction and matching timed per method on the device
        // (`feature-match-check.html.md`), linked from nothing.
        featureMatchCheck: fileURLToPath(
          new URL("feature-match-check.html", import.meta.url),
        ),
        // A long text in its reading sheet without an AR session
        // (`long-text-check.html.md`), linked from nothing.
        longTextCheck: fileURLToPath(
          new URL("long-text-check.html", import.meta.url),
        ),
        // The picture and sound optimizers at the chosen settings and one
        // step either side (`asset-optimizer-check.html.md`), linked from
        // the prototype gallery only.
        assetOptimizerCheck: fileURLToPath(
          new URL("asset-optimizer-check.html", import.meta.url),
        ),
      },
    },
  },
});
