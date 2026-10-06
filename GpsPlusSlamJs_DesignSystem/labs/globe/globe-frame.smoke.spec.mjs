// @ts-check
/**
 * The world frame at the target (F2 plan 2026-10-03-1922 F2a, M3).
 *
 * Why this file matters: the globe is drawn in a local frame at the target
 * (x east, y up) once the pin has a fix, so the framework's sky, haze and
 * cloud slab can work below the band. The frame switches at the press, at
 * a pose the camera already has; if any camera writer or reader still
 * assumed world = ECEF, the view would jump or the camera would land on
 * the far side of the Earth. Measured: the frame and the camera's ECEF
 * pose just before and just after a switch at a fixed pose, and the state
 * a whole dive leaves in the target's frame.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&relief=1&reliefHeights=synthetic&diveMs=6000&detail=0";
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];

function grid() {
  const g = [];
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 8; j++) g.push([0.05 + i * 0.065, 0.3 + j * 0.085]);
  }
  return g;
}

function compare(a, b) {
  const d = a.map((p, i) =>
    Math.max(
      Math.abs(p[0] - b[i][0]),
      Math.abs(p[1] - b[i][1]),
      Math.abs(p[2] - b[i][2]),
    ),
  );
  const sorted = [...d].sort((x, y) => x - y);
  return {
    mean: d.reduce((s, v) => s + v, 0) / d.length,
    p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
  };
}

const swept = (value, bound) =>
  `${value.toFixed(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

test("the world frame switches without moving the view, and a dive lands in the target's frame", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  expect(
    await page.evaluate(() => window.__globeLab.state().worldFrame),
  ).toBeNull();
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && (s.relief?.share ?? 0) >= 1 && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  const landed = await page.evaluate(() => window.__globeLab.state());
  // The pin moved the world into the target's frame.
  expect(landed.worldFrame).toEqual({
    lat: TARGET.latitude,
    lng: TARGET.longitude,
  });
  // At a held pose: the frame and the camera's ECEF pose, before and after.
  const read = () =>
    page.evaluate((g) => {
      const lab = window.__globeLab;
      lab.timeFrames(3);
      const s = lab.state();
      return {
        px: lab.readPixels(g),
        distanceM: s.cameraDistanceM,
        direction: s.cameraDirection,
        altitudeM: s.altitudeM,
      };
    }, grid());
  const inFrame = await read();
  await page.evaluate(() => window.__globeLab.reframe(null));
  const inEcef = await read();
  await page.evaluate((t) => window.__globeLab.reframe(t), {
    lat: TARGET.latitude,
    lng: TARGET.longitude,
  });
  const back = await read();
  const c = compare(inFrame.px, inEcef.px);
  const cBack = compare(inFrame.px, back.px);
  const dirDeg = (a, b) =>
    (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) /
    Math.PI;
  console.log(
    `world frame switch at the hold: frame against ECEF mean ${swept(c.mean, 0.5)}, p95 ${swept(c.p95, 4)}; back in the frame mean ${cBack.mean.toFixed(2)}; camera distance ${Math.abs(inFrame.distanceM - inEcef.distanceM).toFixed(3)} m apart, direction ${dirDeg(inFrame.direction, inEcef.direction).toExponential(2)} degrees apart, altitude ${(inFrame.altitudeM / 1000).toFixed(1)} km`,
  );
  expect(errors).toEqual([]);
  expect(c.mean).toBeLessThanOrEqual(0.5);
  expect(c.p95).toBeLessThanOrEqual(4);
  expect(cBack.mean).toBeLessThanOrEqual(0.5);
  // The ECEF pose is the same within 1 m and 0.01 degrees.
  expect(Math.abs(inFrame.distanceM - inEcef.distanceM)).toBeLessThan(1);
  expect(dirDeg(inFrame.direction, inEcef.direction)).toBeLessThan(0.01);
});

// WHY (owner, 2026-10-06, r785): "the touch controls stop working after
// about a second of moving the camera". Moving the frame under a camera
// flown far away (volume-cloud plan §14) releases the controls, which ends
// a drag in progress: flying at 10 to 20 km, a drag crosses the 20 km drift
// within a second, and the gesture died. The frame now moves only once the
// controls are idle (no pointer down, no glide). This holds a press while
// the camera is moved 50 km (a test hook that leaves the camera with the
// controls), and checks that the frame waits, that the drag still turns
// the view, and that the frame follows once the press ends.
test("the frame never moves under a drag in progress, and follows once the controls are idle", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 300_000 },
  );
  const frameOf = () =>
    page.evaluate(() => window.__globeLab.state().worldFrame);
  const before = await frameOf();
  const box = await page.locator("#globe-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy, { steps: 4 });
  await page.evaluate(() => window.__globeLab.shiftCamera(50_000, 0));
  await page.evaluate(() => window.__globeLab.timeFrames(5));
  const during = await frameOf();
  const atPress = await page.evaluate(
    () => window.__globeLab.state().cameraDirection,
  );
  await page.mouse.move(cx + 220, cy + 60, { steps: 10 });
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const afterDrag = await page.evaluate(
    () => window.__globeLab.state().cameraDirection,
  );
  const turned = Math.hypot(
    afterDrag[0] - atPress[0],
    afterDrag[1] - atPress[1],
    afterDrag[2] - atPress[2],
  );
  await page.mouse.up();
  await page.waitForFunction(
    (b) => {
      const f = window.__globeLab.state().worldFrame;
      return f && (f.lat !== b.lat || f.lng !== b.lng);
    },
    before,
    { timeout: 30_000 },
  );
  const after = await frameOf();
  console.log(
    `frame before ${JSON.stringify(before)}, during the press ${JSON.stringify(during)}, after it ${JSON.stringify(after)}; the drag turned the camera's direction by ${turned.toExponential(2)}`,
  );
  expect(errors).toEqual([]);
  expect(during).toEqual(before);
  expect(turned).toBeGreaterThan(1e-5);
  expect(after).not.toEqual(before);
});

// WHY (owner, 2026-10-06): the links sent back after a Debug export never
// put the owner where he was: a link could only name a place (`at=`), and
// the intro flew its own approach. A `view=` link opens at the export's
// pose, the intro skipped and the camera his; the export carries that link
// itself. This opens the owner's pose of 2026-10-06 (17.5 km over the
// Aosta valley, looking north) and holds that the camera is there (to a
// metre and 0.1 degree, the link's own precision; swept x0.5/x1/x2 on the
// angle), that the controls have it, and that the export's link reads
// back the same view.
test("a view= link opens at the Debug export's pose, the camera with the controls", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const view = "45.70106,7.54552,17.471,352.0,-25.4";
  const errors = await bootGlobe(page, `${BASE}&view=${view}`, {
    phase: "user",
  });
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const out = await page.evaluate(() => {
    const exported = JSON.parse(window.__globeLab.debug.exportText());
    return {
      live: exported.live,
      link: exported.link,
      owner: window.__globeLab.state().cameraOwner,
    };
  });
  const { live } = out;
  const angle = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  const headingErr = angle(live.headingDeg, 352);
  const pitchErr = Math.abs(live.pitchDeg - -25.4);
  const verdict = [0.5, 1, 2]
    .map(
      (k) => `x${k} ${Math.max(headingErr, pitchErr) <= 0.1 * k ? "ok" : "NO"}`,
    )
    .join(" ");
  console.log(
    `view link: at ${live.lat.toFixed(5)}, ${live.lng.toFixed(5)}, ${live.altitudeKm.toFixed(3)} km, heading ${live.headingDeg.toFixed(2)}, pitch ${live.pitchDeg.toFixed(2)} (angles within 0.1: ${verdict}); owner ${out.owner}; export link ${out.link}`,
  );
  expect(errors).toEqual([]);
  expect(Math.abs(live.lat - 45.70106)).toBeLessThan(1e-4);
  expect(Math.abs(live.lng - 7.54552)).toBeLessThan(1e-4);
  expect(Math.abs(live.altitudeKm - 17.471)).toBeLessThan(0.002);
  expect(headingErr).toBeLessThan(0.1);
  expect(pitchErr).toBeLessThan(0.1);
  expect(out.owner).toBe("controls");
  expect(out.link).toContain(`view=${view}`);
});
