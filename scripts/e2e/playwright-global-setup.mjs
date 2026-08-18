// Playwright `globalSetup` shared by every package whose e2e suite may reuse an
// already-running dev server. One file, wired identically everywhere:
//
//   globalSetup: "../../scripts/e2e/playwright-global-setup.mjs"
//
// ORDERING, VERIFIED RATHER THAN ASSUMED (playwright 1.60,
// `lib/runner/index.js` — the webServer is pushed as a plugin and plugin setup
// tasks are created BEFORE global-setup tasks). So by the time this runs, the
// webServer has already been started or reused. That is the useful order: we
// inspect the server the suite is actually going to use.
//
// A consequence worth stating: "nothing is listening" is NOT the ordinary
// no-server case here, it means the webServer wedged — so the guard reports it
// instead of passing silently.
//
// @see dev-server-freshness.mjs.md

import { assertDevServerFresh, devServerUrlOf } from './dev-server-freshness.mjs';

/**
 * @param {import('@playwright/test').FullConfig} config
 */
export default async function globalSetup(config) {
  await assertDevServerFresh({
    baseUrl: devServerUrlOf(config),
    // pnpm runs package scripts with cwd = the package directory, which is what
    // makes one shared file able to resolve each package's own linked libraries.
    packageDir: process.cwd(),
  });
}
