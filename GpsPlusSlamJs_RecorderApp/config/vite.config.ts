import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

// The build stamp (commit, versions, build time) every recording's
// session.json carries: the framework's one define block, shared with the
// Tour Viewer (DEC-H3), read in the page by its utils/build-info.
import { createBuildMetadataDefine } from '../../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs';

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
    sourcemap: true,
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
    // Upload source maps to Sentry during production builds.
    // Only loaded when SENTRY_AUTH_TOKEN is set - without it the plugin
    // errors during `vite build`. Local dev and public-repo contributors
    // build without the token and get no Sentry source-map upload.
    process.env.SENTRY_AUTH_TOKEN &&
      sentryVitePlugin({
        org: 'cs-util-com',
        project: 'js-gps-recorder',
      }),
  ],
});
