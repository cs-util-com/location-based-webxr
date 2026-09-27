// @ts-check
/**
 * The globe lab's imagery depth (round-2 plan 2026-09-26-2055 M3c, round-3
 * plan 2026-09-27-0532 §4 F): level 4 of the imagery.
 *
 * Why this file matters: a committed level that is never served, or never
 * refined to, is weight without a picture. Kept out of `globe.smoke.spec.mjs` so the globe's streams merge in
 * small pieces (round-3 plan §4).
 */
import { expect, test } from "@playwright/test";

import { applyHash, arriveAt } from "./globe-smoke-helpers.mjs";

/** Boots the lab at a hash and waits for it to report ready (no settle). */
async function bootLab(page, hash) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  return errors;
}

// WHY (round-2 plan 2026-09-26-2055 DEC-FB2-4): level 4 of the Blue Marble
// pyramid is committed for closer views. It must actually be served and
// drawn where a level-3 texel is too coarse for the error target, without a
// tile error. On the fitted view a level-3 texel is about half a pixel, so
// the default 1 px target should not need level 4 at all (logged, not
// asserted: stream E's closer views change it); a 0.25 px target must.
test("level 4 of the imagery loads where level 3 is too coarse", async ({
  page,
}) => {
  // Two settled views of up to 120 s each (see arriveAt).
  test.setTimeout(300_000);
  const view = "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z";
  const errors = await bootLab(page, view);
  const fitted = await arriveAt(page, { lat: 30, lng: 15 });
  await applyHash(page, `${view}&errorTarget=0.25`);
  // Level 4 must be asked for before the settle wait starts: with the same
  // target and tile count, the wait would pass at once.
  await page.waitForFunction(
    () => window.__globeLab.state().tileRequestsByLevel[4] > 0,
    null,
    { timeout: 120_000 },
  );
  const fine = await arriveAt(page, { lat: 30, lng: 15 });
  const report = (s) =>
    `per level ${s.tileRequestsByLevel.join("/")}, ${s.loadedTiles} loaded, ${s.refusedTiles} refused, ${(s.cachedBytes / 2 ** 20).toFixed(1)} MiB cached`;
  console.log(
    `z4: at 1 px ${report(fitted)}; at 0.25 px ${report(fine)}; tile errors ${fine.tileErrors}`,
  );
  expect(fine.tileRequestsByLevel[4]).toBeGreaterThan(0);
  expect(fine.tileErrors).toBe(0);
  expect(errors).toEqual([]);
});
