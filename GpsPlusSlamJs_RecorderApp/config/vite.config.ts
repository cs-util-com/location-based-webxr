import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

// The build stamp (commit, versions, build time) every recording's
// session.json carries: the framework's one define block, shared with the
// Tour Viewer, read in the page by its utils/build-info.
import { createBuildMetadataDefine } from '../../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs';
import { sentrySourceMapPlugins } from '../../GpsPlusSlamJs_AppFramework/scripts/sentry-vite-plugins.mjs';

/**
 * Uploads the source maps to the error service during a production build
 * (the commit becomes the release), gives each bundle a debug id so a
 * report's stack maps back to the source, then deletes the maps so they are
 * not deployed. Only when SENTRY_AUTH_TOKEN is set: a build without it
 * (local, CI, a contributor's) runs none of it and does not fail. The same
 * helper as the Tour Viewer and the map demo.
 */
const sentry = sentrySourceMapPlugins(sentryVitePlugin);

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    port: 5173,
    // Required for WebXR on Android via USB debugging
    host: true,
    https: false, // WebXR requires HTTPS in production, but localhost is allowed
  },
  build: {
    outDir: 'dist',
    // Maps are built for the error service, but no bundle points at them, so
    // a visitor's browser never fetches them.
    sourcemap: 'hidden',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('../index.html', import.meta.url)),
        arHittestTest: fileURLToPath(
          new URL('../ar-hittest-test.html', import.meta.url)
        ),
        // Dev-only on-device measurement page, linked from nothing (see
        // `alignment-timing.html.md`). It is an entry so that it is BUILT and
        // therefore reachable on a deployed branch preview; nothing in the
        // recorder imports it.
        alignmentTiming: fileURLToPath(
          new URL('../alignment-timing.html', import.meta.url)
        ),
        // On-phone WebXR anchors check, linked from nothing (see
        // `ar-anchors-check.html.md`); an entry so it is built and deployed.
        arAnchorsCheck: fileURLToPath(
          new URL('../ar-anchors-check.html', import.meta.url)
        ),
      },
    },
  },
  define: createBuildMetadataDefine(
    fileURLToPath(new URL('..', import.meta.url))
  ),
  plugins: [
    // TAILWIND, BUILT HERE RATHER THAN FETCHED AT RUNTIME. It used to come from
    // `cdn.tailwindcss.com`, which made every page load - including every e2e
    // `page.goto` - wait on a third-party host. See `styles/tailwind.css` for
    // what that cost and for the one behavioural difference the swap has.
    tailwindcss(),
    ...sentry.plugins,
  ],
  // The image-quality and occluder-mesh workers are bundled separately: they
  // need the plugin too for their debug ids (the page's instance uploads and
  // deletes their maps).
  worker: { plugins: sentry.workerPlugins },
});
