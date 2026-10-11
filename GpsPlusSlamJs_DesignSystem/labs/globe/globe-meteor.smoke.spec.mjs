/**
 * The meteor approach (round-3 plan 2026-10-08-2345 F1, F1b; the owner on
 * r805: "like a meteor", on r807: "a continuous direction, already oblique
 * from far out; the camera must never bend abruptly"). A `flight=2` link
 * flies one straight line through space that meets its place at the entry
 * angle (`meteorDeg`, 30 by DEC-R3-8), looking along it all the way down
 * (DEC-R3-10) and landing at that angle (DEC-R3-9): the view's direction
 * in space never changes.
 */
import { expect, test } from "@playwright/test";

const R = 6_371_000;
const DEG = 180 / Math.PI;
/** The line's angle below the horizontal at h for a landing l and beta. */
const line = (h, l, beta) =>
  Math.acos(((R + l) * Math.cos(beta / DEG)) / (R + h)) * DEG;
const angle = (a, b) =>
  Math.acos(
    Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])),
  ) * DEG;

/** Records the camera every frame (altitude, depression, ECEF forward). */
async function recordLink(page, hash) {
  await page.addInitScript(() => {
    window.__meteor = [];
    const tick = () => {
      const lab = window.__globeLab;
      if (lab?.ready) {
        const s = lab.state();
        window.__meteor.push({
          t: performance.now(),
          h: s.altitudeM,
          d: s.cameraDepressionDeg,
          f: s.cameraForward,
          c: s.cameraDirection,
          r: s.cameraDistanceM,
          n: s.frameRecentres,
          p: s.phase,
          pin: s.pin?.phase,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(
    () =>
      window.__globeLab?.state?.().phase === "landed" &&
      window.__globeLab.state().pin?.phase === "idle",
    null,
    { timeout: 360_000, polling: 500 },
  );
  // The first frames read the camera at the Earth's centre, before it is
  // placed; the flight starts where the pin leaves idle.
  const all = await page.evaluate(() => window.__meteor);
  const from = all.findIndex((s) => s.pin && s.pin !== "idle" && s.h > 0);
  return all.slice(from).filter((s) => s.h > 0 && s.f);
}

/** How far (degrees) the view's centre ray passes from the target. */
function aimOff(s, target) {
  const pos = s.c.map((x) => x * s.r);
  const to = target.map((x, i) => x - pos[i]);
  const len = Math.hypot(...to);
  return angle(
    s.f,
    to.map((x) => x / len),
  );
}

/**
 * Bern's point on the WGS84 ellipsoid, ECEF (the target the link flies to;
 * a sphere put it about 21 km off, the milestone review).
 */
const BERN_ECEF = (() => {
  const a = 6_378_137;
  const e2 = 6.69437999014e-3;
  const lat = 46.948 / DEG;
  const lng = 7.4474 / DEG;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [
    n * Math.cos(lat) * Math.cos(lng),
    n * Math.cos(lat) * Math.sin(lng),
    n * (1 - e2) * Math.sin(lat),
  ];
})();

/** The flight's turn: the largest angle from its first view, and per second. */
function turn(samples) {
  const flying = samples.filter((s) => s.p !== "landed");
  const first = flying[0]?.f;
  let worst = 0;
  let rate = 0;
  for (let i = 1; i < flying.length; i++) {
    worst = Math.max(worst, angle(flying[i].f, first));
    const dt = (flying[i].t - flying[i - 1].t) / 1000;
    if (dt > 0) rate = Math.max(rate, angle(flying[i].f, flying[i - 1].f) / dt);
  }
  return { worst, rate, frames: flying.length };
}

const BERN = "at=46.948,7.4474";
const BASE = `time=2026-10-05T11:00:00Z&${BERN}&land=1&relief=0&cityWarm=0`;

// WHY: the owner's ask, measured on the flight itself, for two entry
// angles (the owner's rule: a one-value verdict is provisional): the view
// follows the line at every altitude (no horizon floor) and lands at beta,
// and the view's direction in space turns by under a degree over the whole
// flight. The positive control: the old dive (`flight=1`) bends from
// straight down to 45, which this measure must see.
for (const [beta, startKm] of [
  [30, 65_000],
  [45, 65_000],
  [30, 20_000],
]) {
  test(`a link flies the meteor at ${beta} degrees from ${startKm} km: one direction, landing at ${beta}`, async ({
    page,
  }) => {
    test.setTimeout(480_000);
    const samples = await recordLink(
      page,
      `${BASE}&flight=2&meteorDeg=${beta}&flightStartKm=${startKm}`,
    );
    const landing = 2_000;
    const near = (hKm) =>
      samples.reduce((best, s) =>
        Math.abs(Math.log(s.h / (hKm * 1000))) <
        Math.abs(Math.log(best.h / (hKm * 1000)))
          ? s
          : best,
      );
    const rows = [10_000, 4_000, 1_000, 300]
      .filter((hKm) => hKm < startKm * 0.8)
      .map((hKm) => {
        const s = near(hKm);
        return {
          hKm,
          at: s.h / 1000,
          d: s.d,
          expected: line(s.h, landing, beta),
        };
      });
    const last = samples[samples.length - 1];
    const t = turn(samples);
    const aims = [10_000, 1_000].map((hKm) => aimOff(near(hKm), BERN_ECEF));
    console.log(
      `meteor ${beta} from ${startKm} km: ${rows.map((r) => `${r.at.toFixed(0)} km ${r.d.toFixed(1)} deg (line ${r.expected.toFixed(1)})`).join(", ")}; last ${(last.h / 1000).toFixed(1)} km ${last.d.toFixed(1)} deg; the view turned at most ${t.worst.toFixed(2)} deg from its first, at most ${t.rate.toFixed(2)} deg/s, over ${t.frames} frames; aimed ${aims.map((a) => a.toFixed(2)).join(" / ")} deg off Bern at 10,000 / 1,000 km; ${last.n} frame recentres`,
    );
    for (const r of rows) {
      expect(Math.abs(r.d - r.expected), `${r.hKm} km`).toBeLessThan(2);
    }
    expect(Math.abs(last.d - beta)).toBeLessThan(2);
    expect(t.frames).toBeGreaterThan(10);
    // 0.01 measured; a tenth of the review's failure shapes (0.4-0.7).
    expect(t.worst).toBeLessThan(0.2);
    // The view's centre ray ends on Bern (WGS84): looking along the line.
    for (const aim of aims) expect(aim).toBeLessThan(0.3);
  });
}

test("the old dive (flight=1) bends, which the turn measure sees", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const samples = await recordLink(page, `${BASE}&flight=1`);
  const t = turn(samples);
  console.log(
    `old dive: the view turned at most ${t.worst.toFixed(1)} deg from its first, at most ${t.rate.toFixed(1)} deg/s, over ${t.frames} frames`,
  );
  expect(t.worst).toBeGreaterThan(20);
});
