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

import {
  plainGlobe,
  routeCityData,
  withPreRound4Look,
} from "./globe-smoke-helpers.mjs";

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
  // A pin press starts the arrival prefetch: its city data is answered here.
  await routeCityData(page);
  await page.goto(`/labs/globe/#${plainGlobe(hash)}`);
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
  // The dive holds obliquely since F1 (45 degrees down at 50 km), so the
  // line names the straight-line distance to the target's ground point:
  // the chord from the camera (the local radius plus the altitude) along
  // the view ray, at the depression, to the ground at the local radius
  // (WGS84 at Cologne's latitude). Within 0.5 % (review 2026-10-03-1835
  // nit 1: 71.0 km shown, 70.7 by altitude over sine).
  const toTarget = Number(
    / · ([\d.]+) km to the target$/.exec(landed.readoutShown)?.[1],
  );
  const lat = (COLOGNE.latitude * Math.PI) / 180;
  const a = 6378.137;
  const b = 6356.752314245;
  const radiusKm = Math.sqrt(
    ((a * a * Math.cos(lat)) ** 2 + (b * b * Math.sin(lat)) ** 2) /
      ((a * Math.cos(lat)) ** 2 + (b * Math.sin(lat)) ** 2),
  );
  const camera = radiusKm + altitudeKm(landed.readoutShown);
  const gamma = ((90 - landed.cameraDepressionDeg) * Math.PI) / 180;
  const chord =
    camera * Math.cos(gamma) -
    Math.sqrt(radiusKm ** 2 - (camera * Math.sin(gamma)) ** 2);
  console.log(
    `dive readout: ${toTarget} km to the target against the chord ${chord.toFixed(2)} km`,
  );
  expect(Math.abs(toTarget - chord)).toBeLessThan(0.005 * chord);
  expect(/** @type {number} */ (altitudeKm(during.readoutShown))).toBeLessThan(
    /** @type {number} */ (before),
  );
  expect(errors).toEqual([]);
});

// WHY: on a phone the readout sits among the pin, its status line, the
// device line and the credits; it must overlap none of them, and none of
// them another, and stay at a readable size. The lines wrap on a narrow
// screen or with a wider font (the r760 CI run on Linux: "readout overlaps
// globe-credits" at 412 px, while it passed here), so three phone widths,
// each with a long status beside the pin.
for (const width of [360, 390, 412]) {
  test.describe(`on a ${width} px phone screen`, () => {
    test.use({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
    test("the readout and the bottom lines are readable and clear of each other", async ({
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
      const ids = [
        "globe-readout",
        "globe-pin",
        "globe-pin-status",
        "globe-device",
        "globe-credits",
      ];
      const boxes = await page.evaluate(
        (list) =>
          list.map((id) => [
            id,
            document.getElementById(id).getBoundingClientRect().toJSON(),
          ]),
        ids,
      );
      const fontPx = await page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.getElementById("globe-readout")).fontSize,
        ),
      );
      const overlaps = (a, b) =>
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom;
      const clashes = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [idA, a] = boxes[i];
          const [idB, b] = boxes[j];
          if (a.height > 0 && b.height > 0 && overlaps(a, b)) {
            clashes.push(`${idA} overlaps ${idB}`);
          }
        }
      }
      console.log(
        `${width} px: ${boxes.map(([id, b]) => `${id} ${Math.round(b.top)}-${Math.round(b.bottom)}`).join(", ")}`,
      );
      expect(clashes).toEqual([]);
      for (const [, b] of boxes) expect(b.bottom).toBeLessThanOrEqual(800);
      expect(boxes[0][1].height).toBeGreaterThan(0);
      expect(fontPx).toBeGreaterThanOrEqual(12);
      expect(errors).toEqual([]);
    });
  });
}
