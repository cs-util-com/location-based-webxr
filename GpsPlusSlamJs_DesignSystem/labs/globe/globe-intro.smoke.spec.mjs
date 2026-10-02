// @ts-check
/**
 * The fly-in (round-5 plan 2026-10-01-0945 §3.1, §5; decisions
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
/**
 * Space is black here (no stars, Milky Way, atmosphere or navy space), so
 * a lit pixel is the Earth and nothing else (review 2026-10-01-2124
 * Major 3: navy space 0.1 alone reads up to 21/32/59 near the limb).
 */
const BASE =
  "spinMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0";

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
      limitKm: s.zoomOutLimitM / 1000,
      fitKm: s.distance / 1000,
    };
  });

/** The library's own zoom-out limit (3d-tiles-renderer 0.5.3), km. */
const libraryKm = (fovYDeg, aspect) => {
  const tanV = Math.tan((fovYDeg * Math.PI) / 360);
  return (2 * 6378.137) / Math.min(tanV, tanV * aspect);
};

/**
 * Starts the fly-in, checks it starts at the zoom-out limit, then arrives
 * and zooms out with the wheel as far as the controls allow. Returns the
 * numbers; asserts the limit holds and the Earth is still drawn there
 * (the corner black, so the lit centre cannot be space).
 */
async function zoomOutToLimit(page) {
  await bootGlobe(page, `at=30,15&turnMs=60000&intro=distance&${BASE}`, {
    phase: "turning",
  });
  const early = await cameraNow(page);
  expect(early.phase).toBe("turning");
  expect(early.km).toBeGreaterThan(0.95 * early.limitKm);
  await applyHash(page, `at=30,15&turnMs=0&intro=distance&${BASE}`);
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
  );
  const box = await page.locator("#globe-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let now = await cameraNow(page);
  for (let i = 0; i < 80 && now.km < 0.99 * now.limitKm; i++) {
    await page.mouse.wheel(0, 2000);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
    now = await cameraNow(page);
  }
  const [centrePx, cornerPx] = await page.evaluate(() =>
    window.__globeLab.readPixels([
      [0.5, 0.5],
      [0.02, 0.02],
    ]),
  );
  const aspect = box.width / box.height;
  const result = {
    viewport: `${Math.round(box.width)}x${Math.round(box.height)}`,
    startKm: early.km,
    km: now.km,
    limitKm: now.limitKm,
    fitKm: now.fitKm,
    libraryKm: libraryKm(now.fov, aspect),
    centrePx: centrePx.slice(0, 3),
    cornerPx: cornerPx.slice(0, 3),
  };
  console.log(
    `zoom-out on ${result.viewport} at fovY ${now.fov}: limit ${result.limitKm.toFixed(0)} km (library ${result.libraryKm.toFixed(0)}, fit ${result.fitKm.toFixed(0)}, 2x fit ${(2 * result.fitKm).toFixed(0)}, maxKm 50000); the fly-in started at ${result.startKm.toFixed(0)} km; zoomed out to ${result.km.toFixed(0)} km; centre pixel ${result.centrePx}, corner ${result.cornerPx}`,
  );
  expect(now.km).toBeGreaterThan(0.99 * now.limitKm);
  expect(now.km).toBeLessThanOrEqual(now.limitKm * 1.001);
  expect(now.limitKm).toBeGreaterThanOrEqual(50_000);
  expect(now.limitKm).toBeGreaterThanOrEqual(result.libraryKm * 0.9999);
  expect(now.limitKm).toBeGreaterThanOrEqual(2 * now.fitKm * 0.9999);
  expect(Math.max(...result.cornerPx)).toBeLessThanOrEqual(3);
  expect(Math.max(...result.centrePx)).toBeGreaterThan(20);
  return result;
}

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
// the real controls, with the Earth still drawn there. On a landscape
// screen the decided 50,000 km is the largest term.
test("the intro starts far out, and the controls zoom out as far", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const r = await zoomOutToLimit(page);
  expect(r.limitKm).toBeCloseTo(50_000, 3);
});

// WHY (review 2026-10-01-2124 Major 1): on a portrait phone a fixed
// 50,000 km was LESS than the library's own limit (about 59,200 km on
// 390x844 at fovY 50) and only 1.5x the fit, so the override shrank the
// zoom-out. The limit is now the largest of 50,000 km, the library's and
// twice the fit: about 67,000 km there.
test("on a portrait phone the zoom-out is never less than the library's or twice the fit", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const r = await zoomOutToLimit(page);
  expect(r.libraryKm).toBeGreaterThan(50_000);
  expect(r.limitKm).toBeCloseTo(2 * r.fitKm, 0);
  await context.close();
});

/** How close the field of view must come back to the lab's fovY, degrees. */
const FOV_TOLERANCE_DEG = 0.01;

// WHY (§3.1): on a phone the globe gets touched while it
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
  // Every frame's field of view, from the press for 1.5 s (3x the ease),
  // with the ease's value for the moment that frame applied it. Sampling
  // starts BEFORE the press, so the page round trip after it costs no
  // early frames.
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__fovSamples = [];
    document.getElementById("globe-canvas")?.addEventListener(
      "pointerdown",
      () => {
        w.__pressAt = performance.now();
      },
      { capture: true, once: true },
    );
    const step = () => {
      if (w.__pressAt !== undefined) {
        const e = w.__globeLab.fovReturnAt(0);
        w.__fovSamples.push({
          ms: performance.now() - w.__pressAt,
          fov: w.__globeLab.state().cameraFov,
          sinceEase: e ? e.lastFrameAt - e.at : null,
          easeMs: e ? e.ms : null,
          expected: e
            ? w.__globeLab.fovReturnAt((e.lastFrameAt - e.at) / e.ms).fov
            : null,
        });
      }
      if (w.__pressAt === undefined || performance.now() - w.__pressAt < 1500)
        requestAnimationFrame(step);
      else w.__fovDone = true;
    };
    requestAnimationFrame(step);
  });
  const box = await page.locator("#globe-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 10, c.y);
  await page.mouse.up();
  await page.waitForFunction(() => /** @type {any} */ (window).__fovDone);
  const samples = await page.evaluate(
    () => /** @type {any} */ (window).__fovSamples,
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
  // The frames themselves (review 2026-10-01-2124 Minor 5): every frame
  // drawn inside the ease holds exactly the ease's value for its moment,
  // strictly between the start and fovY, so a snap that still records an
  // ease fails here. At least one such frame must have landed.
  const inEase = samples.filter(
    (s) => s.sinceEase !== null && s.sinceEase > 0 && s.sinceEase < s.easeMs,
  );
  console.log(
    `frames inside the ease: ${inEase.map((s) => `${s.sinceEase.toFixed(0)}ms ${s.fov.toFixed(2)} (ease ${s.expected.toFixed(2)})`).join(", ") || "none"}`,
  );
  expect(
    inEase.length,
    "at least one frame lands inside the ease (FOV_RETURN_MS)",
  ).toBeGreaterThan(0);
  for (const s of inEase) {
    expect(Math.abs(s.fov - s.expected)).toBeLessThan(1e-6);
    expect(s.fov).toBeLessThan(quarter.from);
    expect(s.fov).toBeGreaterThan(quarter.to);
  }
});

/**
 * Counts every position request the page makes (`getCurrentPosition`,
 * `watchPosition`), installed before the page's own scripts run.
 */
const countPositionRequests = () => {
  const w = /** @type {any} */ (window);
  w.__positionRequests = 0;
  const geo = navigator.geolocation;
  for (const name of ["getCurrentPosition", "watchPosition"]) {
    const own = geo[name].bind(geo);
    geo[name] = (...args) => {
      w.__positionRequests += 1;
      return own(...args);
    };
  }
};

// WHY (§3.1, the permission rule): no position without a granted
// permission, and no prompt at load, so the intro must not wait for one;
// with one granted, the fix is the target. "No prompt at load" is held by
// counting the page's position requests without a grant: any request
// would prompt (review 2026-10-01-2124 Minor 6).
test("without a granted position the intro does not wait; with one it flies to it", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const noGrant = await browser.newContext();
  await noGrant.addInitScript(countPositionRequests);
  const a = await noGrant.newPage();
  await bootGlobe(a, `spinMs=5000&turnMs=0&${BASE.replace("spinMs=0&", "")}`);
  const noFix = await cameraNow(a);
  console.log(
    `no permission: ${JSON.stringify(noFix.history.map((h) => [h.phase, h.source, h.atMs]))}`,
  );
  expect(noFix.source).toBe("fallback");
  expect(noFix.history[1].atMs).toBeLessThan(2000);
  expect(
    await a.evaluate(() => /** @type {any} */ (window).__positionRequests),
  ).toBe(0);
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

/** A geodetic place's direction from the Earth's centre (WGS84, ECEF). */
const ecefDirection = ({ latitude, longitude }) => {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const lat = (latitude * Math.PI) / 180;
  const lng = (longitude * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const v = [
    n * Math.cos(lat) * Math.cos(lng),
    n * Math.cos(lat) * Math.sin(lng),
    n * (1 - e2) * Math.sin(lat),
  ];
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
};
const angleBetween = (a, b) => {
  const len = Math.hypot(...a) * Math.hypot(...b);
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / len;
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
};
/** Midnight UTC at the equinox: Cologne is about 128 degrees from the sun. */
const NIGHT_BASE =
  "time=2026-03-20T00:00:00Z&turnMs=6000&intro=distance&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0";
const CAP_DEG = 90;
/** How far off the cap the settled start may read (the angles above). */
const CAP_TOLERANCE_DEG = 1;

/**
 * The fly-in's first frame and its settled start, for a target on the
 * night side. Asserts the first frame is on the sun side of the capped
 * start (the spin over the sub-solar point, or the capped start itself)
 * and the start settles within the cap of the target.
 */
async function checkSunSideStart(page, label) {
  // The start blends from the spin over 1.5 s: read it once that is over,
  // while the fly-in (6 s) still runs.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "turning" && s.firstTurn && s.flyInSettled;
    },
    null,
    { timeout: 60_000 },
  );
  const s = await page.evaluate(() => window.__globeLab.state());
  const target = ecefDirection(COLOGNE);
  const toSun = angleBetween(target, s.sunEcef);
  const first = {
    toTarget: angleBetween(s.firstTurn, target),
    toSun: angleBetween(s.firstTurn, s.sunEcef),
  };
  const settled = {
    toTarget: angleBetween(s.flyInStart, target),
    toSun: angleBetween(s.flyInStart, s.sunEcef),
  };
  console.log(
    `${label} (start blend ${s.flyInBlendMs} ms): target ${toSun.toFixed(1)} deg from the sun; first fly-in frame ${first.toTarget.toFixed(1)} deg from the target, ${first.toSun.toFixed(1)} from the sun; settled start ${settled.toTarget.toFixed(2)} deg from the target (cap ${CAP_DEG}, tolerance ${CAP_TOLERANCE_DEG}: ${[0.5, 1, 2].map((k) => `x${k} ${Math.abs(settled.toTarget - CAP_DEG) <= CAP_TOLERANCE_DEG * k ? "ok" : "NO"}`).join(" ")}), ${settled.toSun.toFixed(1)} from the sun; history ${JSON.stringify(s.history.map((h) => [h.phase, h.source, h.atMs]))}`,
  );
  expect(toSun).toBeGreaterThan(CAP_DEG + 10);
  expect(first.toSun).toBeLessThanOrEqual(toSun - CAP_DEG + CAP_TOLERANCE_DEG);
  expect(Math.abs(settled.toTarget - CAP_DEG)).toBeLessThanOrEqual(
    CAP_TOLERANCE_DEG,
  );
  expect(settled.toSun).toBeLessThan(toSun);
  return { first, settled, toSun, blendMs: s.flyInBlendMs };
}

// WHY (review 2026-10-01-2124 Major 2): the sun-side start and the 90
// degree cap applied only to a target known on the very first frame; a
// granted position, arriving after the spin had begun, started from the
// spin's fixed place (30N 15E) instead. Read by the fly-in's first frame
// and its settled start, for a link and for a position, at midnight UTC
// so the target is on the night side and the cap decides the start.
test("the fly-in starts on the sun side within the cap, for a link and for a position", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const linked = await browser.newContext();
  const a = await linked.newPage();
  await bootGlobe(a, `at=50.94,6.96&spinMs=0&${NIGHT_BASE}`, {
    phase: "turning",
  });
  await checkSunSideStart(a, "a link (at=)");
  await linked.close();
  const located = await browser.newContext();
  await located.grantPermissions(["geolocation"], { origin: ORIGIN });
  await located.setGeolocation(COLOGNE);
  const b = await located.newPage();
  await bootGlobe(b, `spinMs=5000&${NIGHT_BASE}`, { phase: "turning" });
  const r = await checkSunSideStart(b, "a granted position");
  expect((await cameraNow(b)).source).toBe("fix");
  // When a spin frame was drawn first (the position arrived after it,
  // as on a phone) the fly-in began over the sub-solar point and blended
  // to the capped start; otherwise it began at the capped start itself.
  if (r.blendMs > 0) expect(r.first.toSun).toBeLessThan(10);
  else expect(Math.abs(r.first.toTarget - CAP_DEG)).toBeLessThan(1);
  await located.close();
});

// WHY (§3.1; review 2026-10-01-2124 Minor 6): a position that arrives
// while the fallback is HELD (turnMs 0) moves the view over 1.5 s, never
// in one jump. Every frame's camera direction is recorded from the page's
// start, with the time the lab's frame loop drew it (`frameAt`: a
// sampler's own clock lags a long frame, and under the CPU rasteriser a
// frame that streams new tiles can take 0.5 s); once the fallback is held,
// no frame may move faster than the blend's steepest slope (1.5 x the
// angle over 1.5 s, smoothstep) allows, and the move must span several
// frames.
test("a late position moves the held view without a jump, frame by frame", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COLOGNE);
  await context.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__dirs = [];
    const step = () => {
      const lab = w.__globeLab;
      if (lab?.ready) {
        const s = lab.state();
        if (w.__dirs.at(-1)?.t !== s.frameAt)
          w.__dirs.push({
            t: s.frameAt,
            dir: s.cameraDirection,
            held: s.source === "fallback" && s.phase === "arrived",
            source: s.source,
          });
      }
      if (w.__dirs.length < 2000) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const page = await context.newPage();
  await bootGlobe(page, `turnMs=0&${BASE}`);
  await page.waitForFunction(
    () => window.__globeLab.state().source === "fix",
    null,
    { timeout: 60_000 },
  );
  // Past the blend: 1.5 s after the fix, plus margin.
  await page.waitForFunction(() => {
    const d = /** @type {any} */ (window).__dirs;
    const first = d.findIndex((x) => x.source === "fix");
    return first >= 0 && d.at(-1).t - d[first].t > 2000;
  });
  const dirs = await page.evaluate(() => /** @type {any} */ (window).__dirs);
  const from = dirs.findIndex((x) => x.held);
  expect(
    from,
    "the fallback was held before the position came",
  ).toBeGreaterThanOrEqual(0);
  const run = dirs.slice(from);
  const total = angleBetween(run[0].dir, run.at(-1).dir);
  const maxRatePerMs = (1.5 * total) / 1500;
  const steps = run.slice(1).map((x, i) => ({
    deg: angleBetween(run[i].dir, x.dir),
    dt: x.t - run[i].t,
  }));
  const moving = steps.filter((x) => x.deg > 0.01);
  const worst = Math.max(...steps.map((x) => x.deg / (maxRatePerMs * x.dt)));
  console.log(
    `late fix while held: ${total.toFixed(1)} deg over ${moving.length} moving frames; largest step ${Math.max(...steps.map((x) => x.deg)).toFixed(2)} deg; worst step against the blend's steepest slope x${worst.toFixed(2)} (bound 1.25: ${[0.5, 1, 2].map((k) => `x${k} ${worst <= 1.25 * k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(total).toBeGreaterThan(30);
  expect(moving.length).toBeGreaterThanOrEqual(3);
  expect(worst).toBeLessThanOrEqual(1.25);
  await context.close();
});

// WHY (review 2026-10-01-2124 Minor 7): the cap and the length were
// checked at one value each. Swept at x0.5, x1, x2 of the defaults in the
// browser: the settled start is min(cap, the sun's angle) from the target
// (Cologne at midnight UTC, about 128 degrees from the sun, so 45 and 90
// bind and 180 starts at the sun), and the fly-in arrives after turnMs
// (within a few frames) at the same target.
test("the turn cap and the fly-in's length, swept", async ({ page }) => {
  test.setTimeout(120_000);
  const at = "at=50.94,6.96&spinMs=0&intro=distance";
  const night =
    "time=2026-03-20T00:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0";
  await bootGlobe(page, `${at}&turnMs=60000&${night}`, { phase: "turning" });
  const target = ecefDirection(COLOGNE);
  const caps = [];
  for (const cap of [45, 90, 180]) {
    await applyHash(page, `${at}&turnMs=60000&turnCap=${cap}&${night}`);
    await page.waitForFunction(() => {
      const s = window.__globeLab.state();
      return s.phase === "turning" && s.flyInSettled;
    });
    const s = await page.evaluate(() => window.__globeLab.state());
    const toSun = angleBetween(target, s.sunEcef);
    caps.push({
      cap,
      want: Math.min(cap, toSun),
      got: angleBetween(s.flyInStart, target),
    });
  }
  const lengths = [];
  for (const turnMs of [2500, 5000, 10000]) {
    await applyHash(page, `${at}&turnMs=${turnMs}&${night}`);
    await page.waitForFunction(
      (ms) => {
        const s = window.__globeLab.state();
        return s.turnMs === ms && s.phase === "arrived";
      },
      turnMs,
      { timeout: 60_000 },
    );
    const s = await page.evaluate(() => window.__globeLab.state());
    const turning = s.history.find((h) => h.phase === "turning");
    const arrived = s.history.find((h) => h.phase === "arrived");
    lengths.push({
      turnMs,
      tookMs: arrived.atMs - turning.atMs,
      centreOff: angleBetween(s.cameraDirection, target),
    });
  }
  console.log(
    `turn cap sweep: ${caps.map((c) => `${c.cap}: start ${c.got.toFixed(2)} deg from the target (want ${c.want.toFixed(2)})`).join(", ")}; length sweep: ${lengths.map((l) => `${l.turnMs} ms took ${l.tookMs} ms, ends ${l.centreOff.toFixed(3)} deg off`).join(", ")}`,
  );
  for (const c of caps) expect(Math.abs(c.got - c.want)).toBeLessThan(1);
  for (const l of lengths) {
    // Arrival is noticed on the first frame after turnMs: up to a few
    // frames late on the CPU rasteriser, never early.
    expect(l.tookMs).toBeGreaterThanOrEqual(l.turnMs - 1);
    expect(l.tookMs).toBeLessThan(l.turnMs + 1000);
    expect(l.centreOff).toBeLessThan(0.5);
  }
});
