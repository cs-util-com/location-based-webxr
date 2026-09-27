/**
 * The look-dev page's shared smoke boot (round-3 plan 2026-09-27-0532 §8):
 * every look-dev (`/3d/`) smoke boots the page through here, so a change of
 * the page's defaults cannot silently change what an unrelated test measures.
 * The pins themselves live in `smoke-pins.mjs`, free of Playwright, with
 * their own unit test. (`design-atoms.smoke.spec.mjs` opens a fixture page,
 * not the look-dev page, and does not use it.)
 */
import { expect } from "@playwright/test";

import { pinnedHash } from "./smoke-pins.mjs";

export { pinnedHash, SMOKE_PINS } from "./smoke-pins.mjs";

/**
 * Boot the page, wait for it to report ready (or an error), and return the
 * list the page's console errors collect into. `{ pageDefaults: true }`
 * keeps the page's own defaults (the opening-state test).
 */
export async function boot(
  page,
  hash = "preset=golden&tone=agx",
  { pageDefaults = false } = {},
) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/3d/#${pageDefaults ? hash : pinnedHash(hash)}`);
  await page.waitForFunction(
    () => window.__lookdev?.ready || window.__lookdev?.error,
    null,
    {
      timeout: 90_000,
    },
  );
  expect(await page.evaluate(() => window.__lookdev.error)).toBeNull();
  return errors;
}
