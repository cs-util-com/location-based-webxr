// @ts-check
/**
 * The globe lab's distance readout (round-4 plan 2026-09-28-2105
 * DEC-GL4-5).
 *
 * Why this file matters: the owner will name the altitudes where the
 * flight's cloud fade should start by reading this line on his phone. So it
 * must show the camera's REAL altitude (the number the page's own state
 * reports, not a stale or fitted one), it must follow the camera through a
 * dive and name the distance to the target there, and on a phone it must
 * be readable and clear of the pin, its status line and the lines below
 * it. The formatting and the throttle are unit-tested in the globe package
 * (`globe-readout.test.ts`); this checks the page wires them to the camera.
 */
import { expect, test } from "@playwright/test";

import { withPreRound4Look } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const VIEW = withPreRound4Look(
  "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0",
);
const COLOGNE = { latitude: 50.94128, longitude: 6.95817 };

/** The number of km in a readout text's altitude part ("Altitude 1,234 km"). */
const altitudeKm = (text) => {
  const m = /^Altitude ([\d,.]+) (km|m)/.exec(text);
  if (!m) return null;
  const value = Number(m[1].replaceAll(",", ""));
  return m[2] === "km" ? value : value / 1000;
};

async function boot(page, hash) {
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
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
    null,
    { timeout: 90_000 },
  );
  return errors;
}

// WHY: the line shows the camera's altitude, as the page measures it, to
// the km, and the page writes it (not only computes it).
test("the readout shows the camera's altitude above the ellipsoid", async ({
  page,
}) => {
  const errors = await boot(page, VIEW);
  await page.waitForFunction(() =>
    /^Altitude /.test(window.__globeLab.state().readoutShown),
  );
  const s = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `readout "${s.readoutShown}", altitude ${(s.altitudeM / 1000).toFixed(1)} km`,
  );
  expect(s.readoutShown).toMatch(/^Altitude [\d,]+ km$/);
  expect(
    Math.abs(altitudeKm(s.readoutShown) - s.altitudeM / 1000),
  ).toBeLessThanOrEqual(0.5);
  await expect(page.locator("#globe-readout")).toBeVisible();
  // Not a live region: four updates a second would flood a screen reader.
  await expect(page.locator("#globe-readout")).toHaveAttribute(
    "aria-live",
    "off",
  );
  expect(errors).toEqual([]);
});

// WHY: during the pin's dive the line follows the camera down and names
// the distance to the target; at the end it reads the hold altitude.
test("during a dive the readout follows the camera and names the distance to the target", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COLOGNE);
  const errors = await boot(
    page,
    `${VIEW}&diveMs=4000&handOver=0&handOverKm=50`,
  );
  const before = altitudeKm(
    await page.evaluate(() => window.__globeLab.state().readoutShown),
  );
  await page.locator("#globe-pin").click();
  // The line names the target from the dive's first frame, before the
  // camera has moved: wait, while the dive still flies, for a line that
  // names it AND reads lower than before (the first such line was once
  // taken as "during", at the start altitude: a race, 2026-09-30).
  await page.waitForFunction(
    (startKm) => {
      const s = window.__globeLab.state();
      const m = /^Altitude ([\d,.]+) (km|m) · .* to the target$/.exec(
        s.readoutShown,
      );
      if (!m || s.phase === "landed") return false;
      const value = Number(m[1].replaceAll(",", ""));
      return (m[2] === "km" ? value : value / 1000) < startKm;
    },
    before,
    { timeout: 60_000 },
  );
  const during = await page.evaluate(() => window.__globeLab.state());
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "landed",
    null,
    { timeout: 60_000 },
  );
  // The line is throttled: give it one interval to catch up.
  await page.waitForFunction(() => {
    const s = window.__globeLab.state();
    return s.readoutShown === s.readout;
  });
  const landed = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `dive readout: before ${before} km, during "${during.readoutShown}", landed "${landed.readoutShown}"`,
  );
  expect(before).not.toBeNull();
  expect(altitudeKm(landed.readoutShown)).toBeCloseTo(50, 0);
  expect(landed.readoutShown).toMatch(/ · 50\.\d km to the target$/);
  expect(/** @type {number} */ (altitudeKm(during.readoutShown))).toBeLessThan(
    /** @type {number} */ (before),
  );
  expect(errors).toEqual([]);
});

// WHY: on a phone the readout sits among the pin, its status line, the
// device line and the credits; it must overlap none of them and stay at a
// readable size.
test.describe("on a phone-width screen", () => {
  test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  test("the readout is readable and clear of the pin and the other lines", async ({
    page,
  }) => {
    const errors = await boot(page, VIEW);
    // A long status beside the pin, as while it locates.
    await page.evaluate(() => {
      document.getElementById("globe-pin-status").textContent =
        "Finding you... - tap to cancel";
    });
    await page.waitForFunction(() =>
      /^Altitude /.test(window.__globeLab.state().readoutShown),
    );
    const boxes = await page.evaluate(() => {
      const box = (id) =>
        document.getElementById(id).getBoundingClientRect().toJSON();
      return {
        readout: box("globe-readout"),
        others: [
          "globe-pin",
          "globe-pin-status",
          "globe-device",
          "globe-credits",
        ].map((id) => [id, box(id)]),
        fontPx: parseFloat(
          getComputedStyle(document.getElementById("globe-readout")).fontSize,
        ),
      };
    });
    const overlaps = (a, b) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;
    for (const [id, other] of boxes.others) {
      expect(overlaps(boxes.readout, other), `readout overlaps ${id}`).toBe(
        false,
      );
    }
    expect(boxes.readout.height).toBeGreaterThan(0);
    expect(boxes.fontPx).toBeGreaterThanOrEqual(12);
    expect(errors).toEqual([]);
  });
});
