// @ts-check
/**
 * The cloud volume near the camera (volume-cloud plan 2026-10-05-0016, C2
 * and C4).
 *
 * Why this file matters: the owner asked for volume clouds with no "plop"
 * anywhere on the descent. The volume fades in by altitude (40 to 30 km)
 * while the shell opens a hole of the same size, so the clouds must never
 * jump. Measured with the bounds stated in the plan before building (each
 * swept x0.5/x1/x2):
 *
 * - **Continuity:** the camera held at dive times through 45 to 15 km; the
 *   frame-to-frame step with the volume (variant 2, the default) may
 *   exceed the worse of the shell alone (`cloudVolume=0`) and the volume
 *   alone (the shell hidden) by at most a mean 1 level: the plan's bound.
 *   Against the shell alone only, the volume's own legitimate change as the
 *   camera nears it (parallax, 0.7-1.5 levels a step once its share was
 *   already 0.91-1) read as a plop although the fade itself added 0.00 at
 *   every step (2026-10-05).
 * - **It is drawn:** at the 12 km hold the volume draws, without a console
 *   error, and the frame differs from the shell-only frame.
 * - **The cost** (SwiftShader relative, logged): frame time with the volume
 *   on against off at the hold.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe, meanOf } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
// A partly cloudy part of the map (56.5 N 9 E, Jutland: the map's mean
// 0.45 over a 0.3 degree box, a cover of 0.36 at gain 1), where a jump
// between the shell and the volume would show. Until 2026-10-06 these tests
// ran at 46.5 N 9 E, where the map is about 0.1 and the volume drew almost
// nothing, so their verdicts were hollow (volume-cloud plan §11).
const TARGET = { latitude: 56.5, longitude: 9.0 };
const HOLD_KM = 12;
const BASE = `spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0&detail=0&handOverKm=${HOLD_KM}`;
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];
const STEP = 1;

const verdict = (value, bound) =>
  `${value.toFixed(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

function grid() {
  const g = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 6; j++) g.push([0.05 + i * 0.1, 0.1 + j * 0.15]);
  }
  return g;
}

const meanDiff = (a, b) =>
  meanOf(
    a.map((p, i) =>
      Math.max(
        Math.abs(p[0] - b[i][0]),
        Math.abs(p[1] - b[i][1]),
        Math.abs(p[2] - b[i][2]),
      ),
    ),
  );

test("the cloud volume fades in on the descent without a jump, ending at the relief, its cost stated", async ({
  page,
  context,
}) => {
  // Three rows of 21 held frames (about 5 min each) plus the landing.
  test.setTimeout(1_500_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && s.pin.phase === "idle" && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  const times = await page.evaluate(() => {
    const at = (km) => {
      let lo = 0;
      let hi = 60_000;
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        if (window.__globeLab.diveAltitudeAt(m) > km * 1000) lo = m;
        else hi = m;
      }
      return lo;
    };
    const out = [];
    for (let i = 0; i <= 20; i++) out.push(at(45 * (15 / 45) ** (i / 20)));
    return out;
  });
  const g = grid();
  const rows = {};
  const cost = {};
  for (const [label, volume, shellHidden] of [
    ["volume", 2, false],
    ["shell only", 0, false],
    ["volume alone", 2, true],
  ]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, `${BASE}&cloudVolume=${volume}&bandFreeze=1`);
    await page.evaluate(
      (on) => window.__globeLab.hideCloudShell(on),
      shellHidden,
    );
    const frames = [];
    for (const ms of times) {
      await page.evaluate((t) => window.__globeLab.holdDiveAt(t), ms);
      await page.waitForFunction(
        () => window.__globeLab.state().groundSky?.rebuildPending === false,
        null,
        { timeout: 30_000 },
      );
      frames.push(
        await page.evaluate((pts) => {
          const lab = window.__globeLab;
          const px = lab.readPixels(pts);
          return { px, volume: lab.state().cloudVolume };
        }, g),
      );
    }
    rows[label] = frames;
    // The cost at the hold: the last time (the lowest), 20 frames.
    cost[label] = await page.evaluate(
      () => window.__globeLab.timeFrames(20) / 20,
    );
  }
  await page.evaluate(() => window.__globeLab.hideCloudShell(false));
  const on = rows["volume"];
  const off = rows["shell only"];
  const alone = rows["volume alone"];
  let worstStep = 0;
  const beyond = [];
  for (let i = 1; i < on.length; i++) {
    const stepOn = meanDiff(on[i].px, on[i - 1].px);
    const stepOff = Math.max(
      meanDiff(off[i].px, off[i - 1].px),
      meanDiff(alone[i].px, alone[i - 1].px),
    );
    beyond.push(stepOn - stepOff);
    worstStep = Math.max(worstStep, stepOn - stepOff);
  }
  const atHold = meanDiff(on.at(-1).px, off.at(-1).px);
  console.log(
    `cloud volume over 45-15 km: frame-to-frame step beyond the worse of the shell alone and the volume alone, worst ${verdict(worstStep, STEP)}; per step ${beyond.map((v) => v.toFixed(2)).join(" ")}; shares ${on.map((f) => f.volume.share.toFixed(2)).join(" ")}; at ${(15).toFixed(0)} km the volume against the shell only ${atHold.toFixed(2)} levels, drawn on ${on.at(-1).volume.drawn} frames; ${cost.volume.toFixed(1)} ms a frame with the volume against ${cost["shell only"].toFixed(1)} without (x${(cost.volume / cost["shell only"]).toFixed(2)}, SwiftShader)`,
  );
  expect(errors).toEqual([]);
  expect(on.at(-1).volume.share).toBe(1);
  expect(on.at(-1).volume.drawn).toBeGreaterThan(0);
  expect(on[0].volume.share).toBe(0);
  expect(worstStep).toBeLessThanOrEqual(STEP);
});

// WHY: the owner zoomed in on r777 and saw no volume clouds, while the test
// above was green ("the frame differs from the shell-only frame" held on a
// few distant pixels). One cause was the near plane: the volume was drawn
// with the camera's own, fitted to the GROUND (0.3 x the clearance), and
// once the deck is nearer than that (at 10.5 km, the deck's top 1.3 km
// below and the ground ~8 km: a 2.3 km near plane) every view down clipped
// the deck away (2026-10-06). This holds the view down just above the deck,
// over an OVERCAST part of the map (61 N 5.5 E, off western Norway: the
// map's least value over a 0.6 x 0.8 degree box is 0.83, so with the
// opacity 0.8 and gain 2 the cover saturates at 1). The noise patch under a
// landed camera is always the same one (the frame is centred on the target)
// and at a partial cover it can be clear (an offset sweep at cover 0.5 read
// 20-100 % in the lower half), so only a saturated cover makes the view
// down a test of the clipping and not of the patch. Without the fix the
// lower half read 1.8 % (100 % with it); the bound, swept x0.5/x1/x2, is
// half of it.
const OVERCAST = { latitude: 61.0, longitude: 5.5 };
const NEAR_DECK_KM = 10.5;
const LOWER_SHARE = 0.5;

test("the cloud volume is seen looking down from just above the deck, over an overcast part of the map", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(OVERCAST);
  const errors = await bootGlobe(
    page,
    `${BASE.replace(`handOverKm=${HOLD_KM}`, `handOverKm=${NEAR_DECK_KM}`)}&cloudVolumeCover=2`,
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && s.pin.phase === "idle" && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const { coverage, volume, near } = await page.evaluate(() => {
    const lab = window.__globeLab;
    const s = lab.state();
    return {
      coverage: lab.cloudVolumeCoverage(),
      volume: s.cloudVolume,
      near: s.planes.near,
    };
  });
  console.log(
    `the volume looking down at ${NEAR_DECK_KM} km over 61 N 5.5 E: it covers ${(coverage.share * 100).toFixed(1)} % of the frame and ${(coverage.lowerShare * 100).toFixed(1)} % of its lower half, ${verdict(-coverage.lowerShare, -LOWER_SHARE)} (negated: at least the bound), max alpha ${coverage.maxAlpha.toFixed(2)}; the camera's near plane ${near.toFixed(0)} m`,
  );
  expect(errors).toEqual([]);
  expect(volume.share).toBe(1);
  expect(coverage.lowerShare).toBeGreaterThanOrEqual(LOWER_SHARE);
});

// WHY (C3): the owner asked for the volume's shadows compared against the
// 2D layer's. The same ground pixels at the 12 km hold, looking down, with
// no cloud shadow, the shell's soft shadow (the default) and the volume's
// (cloudShadowFrom=1, from the same map through the volume's own clouds):
// each shadow's mean darkening and how alike the two patterns are (their
// correlation over the pixels). Logged for the owner's eye; asserted only
// that neither brightens the ground and that the volume's shadow darkens.
test("the volume's shadow on the relief against the shell's soft shadow", async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && s.pin.phase === "idle" && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  const g = [];
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 10; j++) g.push([0.04 + i * 0.06, 0.3 + j * 0.065]);
  }
  const read = async (extra) => {
    await page.evaluate((h) => {
      location.hash = h;
    }, `${BASE}${extra}&bandFreeze=1`);
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    return page.evaluate((pts) => {
      const lab = window.__globeLab;
      return { px: lab.readPixels(pts), volume: lab.state().cloudVolume };
    }, g);
  };
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const none = await read("&cloudShadow=0&cloudShadowFrom=0");
  const shell = await read("&cloudShadowFrom=0");
  const volume = await read("&cloudShadowFrom=1");
  const dShell = none.px.map((p, i) => lum(p) - lum(shell.px[i]));
  const dVolume = none.px.map((p, i) => lum(p) - lum(volume.px[i]));
  const mean = (a) => meanOf(a);
  const corr = (a, b) => {
    const ma = mean(a);
    const mb = mean(b);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += (a[i] - ma) * (b[i] - mb);
      aa += (a[i] - ma) ** 2;
      bb += (b[i] - mb) ** 2;
    }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
  };
  console.log(
    `cloud shadows at ${HOLD_KM} km: the shell's darkens the ground by a mean ${mean(dShell).toFixed(2)} levels (max ${Math.max(...dShell).toFixed(1)}), the volume's by ${mean(dVolume).toFixed(2)} (max ${Math.max(...dVolume).toFixed(1)}); their patterns correlate ${corr(dShell, dVolume).toFixed(2)}; the volume's shadow on: ${volume.volume?.shadow}`,
  );
  expect(errors).toEqual([]);
  expect(volume.volume?.shadow).toBe(true);
  expect(mean(dShell)).toBeGreaterThanOrEqual(-0.5);
  expect(mean(dVolume)).toBeGreaterThanOrEqual(-0.5);
  expect(Math.max(...dVolume)).toBeGreaterThan(1);
});
