/**
 * The look-dev page's shared smoke boot (round-3 plan 2026-09-27-0532 §8):
 * every `3d/*.smoke.spec.mjs` boots through here, so a change of the page's
 * defaults cannot silently change what an unrelated test measures.
 *
 * WHY THE PINS. The page's defaults follow the owner (the dense city since
 * round 2; shadows, the catalog and the slab clouds planned in round 3), but
 * the tests were measured on the plain scene. One default flip in round 2
 * failed three unrelated tests and took the run from 8.5 to 20.9 min
 * (plan 2026-09-26-2055 §9). So a hash that does not name a pinned key gets
 * the plain value; a test about a default opts out with `pageDefaults`.
 * A stream that adds a default adds its key here in the same commit.
 */
import { expect } from "@playwright/test";

/** The plain scene every test was measured on, unless it names the key. */
export const SMOKE_PINS = {
  city: "0",
  shadows: "0",
  catalog: "0",
  cloudMode: "dome",
};

/** The hash with every pin the hash does not name appended. */
export function pinnedHash(hash, pins = SMOKE_PINS) {
  const named = new URLSearchParams(hash);
  let out = hash;
  for (const [key, value] of Object.entries(pins)) {
    if (!named.has(key)) out += `${out ? "&" : ""}${key}=${value}`;
  }
  return out;
}

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
