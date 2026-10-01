// @ts-check
/**
 * The fly-in (round-5 plan 2026-10-01-0945 §3.1, §5; owner decisions
 * DEC-GL5-1..3).
 *
 * Why this file matters: the intro now starts far out (50,000 km from the
 * centre, which is also how far the controls zoom out) and flies in to the
 * user in one of four variants. Each must END at the same pose and field
 * of view, or the hand-over to the controls jumps; the zoom-out limit
 * must hold in the real controls (it overrides a private library method);
 * and the permission rule must neither prompt nor wait when no position
 * can come, yet take a position that arrives late without a jump.
 */
import { expect, test } from "@playwright/test";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const COLOGNE = { latitude: 50.94, longitude: 6.96 };
const BASE =
  "spinMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0";

/** The camera's distance from the centre, km, and its field of view. */
const cameraNow = (page) =>
  page.evaluate(() => {
    const s = window.__globeLab.state();
    return {
      km: s.cameraDistanceM / 1000,
      fov: s.fovY,
      cameraFov: s.cameraFov,
      phase: s.phase,
      source: s.source,
      target: s.target,
      centre: s.centreLatLon,
      history: s.history,
    };
  });

// WHY: every variant hands the camera over at one pose and field of view
// (DEC-GL5-2), and the lab's fovY equals it, so applyLive never snaps back.
test("every variant ends at the same pose and field of view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ends = [];
  for (const intro of ["narrow", "distance", "fov", "dolly"]) {
    const hash = `at=30,15&turnMs=1500&intro=${intro}&${BASE}`;
    if (ends.length === 0) await bootGlobe(page, hash);
    else await applyHash(page, hash);
    await page.waitForFunction(
      (want) => {
        const s = window.__globeLab.state();
        return s.intro === want && s.phase === "arrived";
      },
      intro,
      { timeout: 60_000 },
    );
    ends.push({ intro, ...(await cameraNow(page)) });
  }
  console.log(
    `intro ends: ${ends.map((e) => `${e.intro} ${e.km.toFixed(1)} km, fov ${e.cameraFov}, centre ${e.centre?.lat.toFixed(3)},${e.centre?.lng.toFixed(3)}`).join("; ")}`,
  );
  for (const e of ends) {
    expect(Math.abs(e.km - ends[0].km), e.intro).toBeLessThan(0.01);
    expect(e.cameraFov, e.intro).toBe(50);
    expect(e.fov, e.intro).toBe(50);
    expect(Math.abs(e.centre.lat - 30), e.intro).toBeLessThan(0.01);
    expect(Math.abs(e.centre.lng - 15), e.intro).toBeLessThan(0.01);
  }
});

// WHY (DEC-GL5-1): the intro starts far out, and the controls zoom out as
// far: the limit overrides a private library method, so it is checked in
// the real controls, with the Earth still drawn there.
test("the intro starts far out, and the controls zoom out as far", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootGlobe(page, `at=30,15&turnMs=60000&intro=distance&${BASE}`, {
    phase: "turning",
  });
  const early = await cameraNow(page);
  expect(early.phase).toBe("turning");
  expect(early.km).toBeGreaterThan(40_000);
  // Arrive at once, then zoom out with the wheel as far as it goes.
  await applyHash(page, `at=30,15&turnMs=0&intro=distance&${BASE}`);
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
  );
  const box = await page.locator("#globe-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let km = 0;
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 2000);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
    km = (await cameraNow(page)).km;
    if (km > 49_000) break;
  }
  const [centrePx] = await page.evaluate(() =>
    window.__globeLab.readPixels([[0.5, 0.5]]),
  );
  console.log(
    `zoomed out to ${km.toFixed(0)} km from the centre; centre pixel ${centrePx.slice(0, 3)}`,
  );
  expect(km).toBeGreaterThan(49_000);
  expect(km).toBeLessThanOrEqual(50_000 * 1.001);
  expect(Math.max(...centrePx.slice(0, 3))).toBeGreaterThan(20);
});

/** How close the field of view must come back to the lab's fovY, degrees. */
const FOV_TOLERANCE_DEG = 0.01;

// WHY (§3.1): the owner tests on a phone by touching the globe while it
// flies in. The narrow variant widens the view to 80 degrees on the way;
// a press must not leave it there. The view eases back to the lab's fovY
// over about 0.5 s, then holds it. "No snap" is read by TIME, from the
// lab's `fovReturnAt` hook (the same ease the frame loop applies), because
// under the CPU rasteriser no frame may land early in the ease: a quarter
// of the way in, the view must be strictly between where it was and fovY.
test("a press during the fly-in eases the field of view back to fovY", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootGlobe(page, `at=30,15&turnMs=60000&intro=narrow&${BASE}`, {
    phase: "turning",
  });
  const before = await cameraNow(page);
  expect(before.cameraFov).toBeGreaterThan(before.fov + 10);
  await page.evaluate(() => {
    document.getElementById("globe-canvas")?.addEventListener(
      "pointerdown",
      () => {
        /** @type {any} */ (window).__pressAt = performance.now();
      },
      { capture: true, once: true },
    );
  });
  const box = await page.locator("#globe-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 10, c.y);
  await page.mouse.up();
  // Every frame's field of view for 1.5 s after the press (3x the ease).
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        const step = () => {
          const ms = performance.now() - /** @type {any} */ (window).__pressAt;
          out.push({ ms, fov: window.__globeLab.state().cameraFov });
          if (ms < 1500) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
  );
  const after = await cameraNow(page);
  const ease = await page.evaluate(() =>
    [0.1, 0.25, 0.5, 0.75, 1].map((f) => window.__globeLab.fovReturnAt(f)),
  );
  console.log(
    `fov after a press at ${before.cameraFov.toFixed(1)} deg: ${samples.map((s) => `${s.ms.toFixed(0)}ms ${s.fov.toFixed(2)}`).join(", ")}; end ${after.cameraFov} vs fovY ${after.fov} (tolerance ${FOV_TOLERANCE_DEG}: ${[0.5, 1, 2].map((k) => `x${k} ${Math.abs(after.cameraFov - after.fov) <= FOV_TOLERANCE_DEG * k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(after.phase).toBe("user");
  expect(Math.abs(after.cameraFov - after.fov)).toBeLessThanOrEqual(
    FOV_TOLERANCE_DEG,
  );
  console.log(
    `the ease by time: ${ease[0] ? `${ease[0].from.toFixed(2)} -> ${ease[0].to} over ${ease[0].ms} ms; at 0.1/0.25/0.5/0.75/1: ${ease.map((e) => e.fov.toFixed(2)).join("/")}` : "none recorded"}`,
  );
  const quarter = ease[1];
  expect(quarter, "an ease back to fovY was recorded").not.toBeNull();
  // It started from the variant's interim value, not from fovY.
  expect(quarter.from).toBeGreaterThan(after.fov + 10);
  expect(quarter.to).toBe(after.fov);
  expect(quarter.fov).toBeLessThan(quarter.from - FOV_TOLERANCE_DEG);
  expect(quarter.fov).toBeGreaterThan(quarter.to + FOV_TOLERANCE_DEG);
});

// WHY (§3.1, the permission rule): no position without a granted
// permission, and no prompt at load, so the intro must not wait for one;
// with one granted, the fix is the target.
test("without a granted position the intro does not wait; with one it flies to it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const noGrant = await browser.newContext();
  const a = await noGrant.newPage();
  await bootGlobe(a, `spinMs=5000&turnMs=0&${BASE.replace("spinMs=0&", "")}`);
  const noFix = await cameraNow(a);
  console.log(
    `no permission: ${JSON.stringify(noFix.history.map((h) => [h.phase, h.source, h.atMs]))}`,
  );
  expect(noFix.source).toBe("fallback");
  expect(noFix.history[1].atMs).toBeLessThan(2000);
  await noGrant.close();
  const granted = await browser.newContext();
  await granted.grantPermissions(["geolocation"], { origin: ORIGIN });
  await granted.setGeolocation(COLOGNE);
  const b = await granted.newPage();
  await bootGlobe(b, `spinMs=5000&turnMs=0&${BASE.replace("spinMs=0&", "")}`);
  const withFix = await cameraNow(b);
  console.log(
    `granted: ${JSON.stringify(withFix.history.map((h) => [h.phase, h.source, h.atMs]))}, target ${withFix.target?.lat},${withFix.target?.lng}`,
  );
  // The target, not the drawn centre: at arrival (turnMs 0) the tiles that
  // the centre is read from may not have loaded yet.
  expect(withFix.source).toBe("fix");
  expect(Math.abs(withFix.target.lat - COLOGNE.latitude)).toBeLessThan(0.05);
  expect(Math.abs(withFix.target.lng - COLOGNE.longitude)).toBeLessThan(0.05);
  await granted.close();
});

// WHY (§3.1): a fix that arrives after the fallback was chosen (spinMs 0)
// becomes the target over 1.5 s while the intro flies: the fly-in ends at
// the fix, the history names it, and nothing jumps (each frame's target
// moves less than the blend allows).
test("a late position blends in while the intro flies, and the intro ends there", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COLOGNE);
  await bootGlobe(page, `turnMs=6000&intro=distance&${BASE}`);
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
    null,
    { timeout: 60_000 },
  );
  const s = await cameraNow(page);
  console.log(
    `late fix: ${JSON.stringify(s.history.map((h) => [h.phase, h.source, h.atMs]))}, centre ${s.centre?.lat.toFixed(3)},${s.centre?.lng.toFixed(3)}`,
  );
  expect(s.history.map((h) => h.source)).toContain("fallback");
  expect(s.source).toBe("fix");
  expect(Math.abs(s.centre.lat - COLOGNE.latitude)).toBeLessThan(0.05);
  expect(Math.abs(s.centre.lng - COLOGNE.longitude)).toBeLessThan(0.05);
});
