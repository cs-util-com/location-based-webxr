import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  arNorthBearingDeg,
  bearingDeltaDeg,
  webxrToNUE,
} from "gps-plus-slam-app-framework/core";

import {
  alignmentNorthBearingDeg,
  fitGaussMarkov,
  type ResidualSample,
} from "./gps-noise-fit.js";

/** Seeded uniform [0, 1) (mulberry32). */
function uniform(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(seed: number): () => number {
  const u = uniform(seed);
  return () =>
    Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) *
    Math.cos(2 * Math.PI * u());
}

/** A per-axis Gauss-Markov series at `dtS` spacing, started stationary. */
function gaussMarkov(input: {
  sigmaM: number;
  tauS: number;
  n: number;
  seed: number;
  dtS?: number;
}): ResidualSample[] {
  const dtS = input.dtS ?? 1;
  const g = normal(input.seed);
  const phi = Math.exp(-dtS / input.tauS);
  const q = input.sigmaM * Math.sqrt(1 - phi * phi);
  let n = input.sigmaM * g();
  let e = input.sigmaM * g();
  const out: ResidualSample[] = [];
  for (let i = 0; i < input.n; i += 1) {
    out.push({ tMs: i * dtS * 1000, n, e });
    n = phi * n + q * g();
    e = phi * e + q * g();
  }
  return out;
}

describe("fitGaussMarkov", () => {
  // Why this test matters: the recalibration reports "the sigma and tau the
  // synthetic model should have used" from this fit. If it cannot recover a
  // known Gauss-Markov process, those two numbers mean nothing.
  it("recovers the sigma and tau of a known Gauss-Markov process", () => {
    for (const [sigmaM, tauS] of [
      [3, 20],
      [5, 60],
      [10, 30],
    ] as const) {
      const series = [1, 2, 3, 4].map((seed) =>
        gaussMarkov({ sigmaM, tauS, n: 4000, seed: seed * 31 + tauS }),
      );
      const fit = fitGaussMarkov(series)!;
      expect(fit.sigmaM / sigmaM).toBeGreaterThan(0.85);
      expect(fit.sigmaM / sigmaM).toBeLessThan(1.15);
      expect(fit.tauS! / tauS).toBeGreaterThan(0.75);
      expect(fit.tauS! / tauS).toBeLessThan(1.25);
      expect(fit.rho[0]).toBeCloseTo(1, 10);
    }
  });

  // Why this test matters: real fix streams are irregular (gaps, 0.5-2 s
  // spacing); the fit must not depend on a 1 Hz grid.
  it("reads the same tau from a stream sampled every 2 s", () => {
    const series = [1, 2, 3, 4].map((seed) =>
      gaussMarkov({ sigmaM: 4, tauS: 40, n: 3000, seed, dtS: 2 }),
    );
    const fit = fitGaussMarkov(series, { binS: 2 })!;
    expect(fit.tauS! / 40).toBeGreaterThan(0.75);
    expect(fit.tauS! / 40).toBeLessThan(1.25);
  });

  // Why this test matters: a time constant longer than the window must be
  // reported as unknown (censored), never as the window's length. (The
  // series must be long against tau: demeaning a short stretch of a slow
  // process removes most of its error, which is the fit's documented bias
  // on short real walks, not censoring.)
  it("is censored when rho stays above 1/e within the window", () => {
    const series = [gaussMarkov({ sigmaM: 5, tauS: 2000, n: 40000, seed: 3 })];
    const fit = fitGaussMarkov(series, { maxLagS: 60 })!;
    expect(fit.tauS).toBeNull();
    expect(fit.censored).toBe(true);
  });

  // Why this test matters: this is the fit's LIMIT on a real walk, measured
  // rather than asserted away. The corpus' median walk is 2.8 minutes (about
  // 170 fixes at 1 Hz). Demeaning a short stretch of a slow process removes
  // most of its error, so a 170 s walk of a sigma 10 m / tau 300 s process
  // (M5a's pessimistic cell) reads a sigma and tau that look like the
  // corpus' own numbers. A short real walk can therefore neither confirm nor
  // exclude a tau above about a minute, and a per-walk tau that is never
  // censored is NOT evidence of a short tau (the demeaned curve is forced
  // through zero within the walk). If this test starts reading the true
  // values, the estimator changed and the sidecar's limit must be
  // re-measured. A fast process is read well at the same length: the bias
  // is a property of tau against the walk's length.
  it("reads a slow process on a 170 s walk far too fast and too quiet (measured bias)", () => {
    const fitsAt = (sigmaM: number, tauS: number) =>
      Array.from({ length: 200 }, (_, k) =>
        fitGaussMarkov(
          [gaussMarkov({ sigmaM, tauS, n: 170, seed: 7 * k + 1 })],
          { maxLagS: 120 },
        )!,
      );
    const median = (v: readonly number[]) => {
      const s = [...v].sort((a, b) => a - b);
      return s[s.length >> 1]!;
    };
    const slow = fitsAt(10, 300);
    const t60 = median(fitsAt(5, 60).map((f) => f.tauS ?? Number.NaN));
    const t120 = median(fitsAt(5, 120).map((f) => f.tauS ?? Number.NaN));
    const fast = fitsAt(3, 10);
    // Measured 2026-10-02 (200 seeds each): sigma 3.56 m, tau 25.5 s;
    // tau 60 reads 21 s and tau 120 reads 23 s; sigma 3 / tau 10 reads
    // 2.78 m / 7.8 s. The bounds leave room for the seeds, not for a change
    // of estimator.
    expect(slow.filter((f) => f.censored)).toHaveLength(0);
    const slowSigma = median(slow.map((f) => f.sigmaM));
    const slowTau = median(slow.map((f) => f.tauS!));
    expect(slowSigma).toBeGreaterThan(3);
    expect(slowSigma).toBeLessThan(4.2);
    expect(slowTau).toBeGreaterThan(20);
    expect(slowTau).toBeLessThan(31);
    expect(t120 / t60).toBeLessThan(1.25);
    expect(median(fast.map((f) => f.sigmaM)) / 3).toBeGreaterThan(0.85);
    expect(median(fast.map((f) => f.tauS!)) / 10).toBeGreaterThan(0.7);
    // 800 fits: under a loaded gate this can outlast the default 5 s.
  }, 30_000);

  // Why this test matters: a constant per-session bias is a different
  // quantity (the cross-session pairs measure it); the fit demeans each
  // series so a bias does not inflate sigma or stretch tau.
  it("demeans each series on its own", () => {
    const base = gaussMarkov({ sigmaM: 3, tauS: 20, n: 3000, seed: 9 });
    const biased = base.map((s) => ({ ...s, n: s.n + 40, e: s.e - 25 }));
    const a = fitGaussMarkov([base])!;
    const b = fitGaussMarkov([biased])!;
    expect(b.sigmaM).toBeCloseTo(a.sigmaM, 9);
    expect(b.tauS).toBeCloseTo(a.tauS!, 9);
  });

  // Why this test matters: recordings are external data.
  it("skips non-finite samples, refuses disorder and bad options", () => {
    expect(fitGaussMarkov([])).toBeNull();
    expect(fitGaussMarkov([[{ tMs: 0, n: 1, e: 1 }]])).toBeNull();
    const zero = [0, 1, 2].map((i) => ({ tMs: i * 1000, n: 0, e: 0 }));
    expect(fitGaussMarkov([zero])).toBeNull();
    const ok = gaussMarkov({ sigmaM: 2, tauS: 10, n: 200, seed: 5 });
    const holed = [
      ...ok.slice(0, 50),
      { tMs: Number.NaN, n: 1, e: 1 },
      { tMs: ok[50]!.tMs, n: Number.POSITIVE_INFINITY, e: 0 },
      ...ok.slice(50),
    ];
    expect(fitGaussMarkov([holed])!.sigmaM).toBeCloseTo(
      fitGaussMarkov([ok])!.sigmaM,
      12,
    );
    expect(() =>
      fitGaussMarkov([[...ok.slice(0, 3), { tMs: 0, n: 0, e: 0 }]]),
    ).toThrow(RangeError);
    expect(() => fitGaussMarkov([ok], { maxLagS: 0 })).toThrow(RangeError);
    expect(() => fitGaussMarkov([ok], { binS: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

/** The rotation that maps AR (WebXR) vectors into ENU for an AR frame
 *  whose -Z points at bearing `bearingDeg` (clockwise from north). */
function arToEnu(bearingDeg: number): Quaternion {
  const b = (bearingDeg * Math.PI) / 180;
  const m = new Matrix4().makeBasis(
    new Vector3(Math.cos(b), -Math.sin(b), 0),
    new Vector3(0, 0, 1),
    new Vector3(-Math.sin(b), -Math.cos(b), 0),
  );
  return new Quaternion().setFromRotationMatrix(m);
}

describe("alignmentNorthBearingDeg", () => {
  // Why this test matters: the compass channel's error is the difference
  // between the core's compass bearing of the AR north axis and this
  // bearing of the same axis through the GPS alignment. A sign or axis slip
  // would turn every compass error into a function of the walk's heading.
  // This pins the convention against the core's own kernel: one AR frame,
  // seen by a compass and by an alignment, gives the same bearing.
  it("agrees with the core's arNorthBearingDeg for the same AR frame", () => {
    for (const bearing of [0, 37, 90, 181, 270, 333]) {
      // An alignment turning about Up (three's makeRotationY in NUE turns
      // north towards -east, hence the minus).
      const alignment = new Matrix4()
        .makeRotationY((-bearing * Math.PI) / 180)
        .setPosition(12, -3, 40);
      const viaAlignment = alignmentNorthBearingDeg(alignment.toArray())!;
      expect(Math.abs(bearingDeltaDeg(viaAlignment, bearing))).toBeLessThan(
        1e-9,
      );
      // The same frame through the AR-to-ENU rotation: every AR vector
      // lands where the alignment (via webxrToNUE) puts it.
      const qAe = arToEnu(bearing);
      for (const v of [
        [1, 0, 0],
        [0, 1, 0],
        [0.3, -0.5, 0.8],
      ] as const) {
        const nue = new Vector3(...webxrToNUE([v[0], v[1], v[2]])).applyMatrix4(
          new Matrix4().extractRotation(alignment),
        );
        const enu = new Vector3(v[0], v[1], v[2]).applyQuaternion(qAe);
        expect(enu.x).toBeCloseTo(nue.z, 9);
        expect(enu.y).toBeCloseTo(nue.x, 9);
        expect(enu.z).toBeCloseTo(nue.y, 9);
      }
      // A device held at some arbitrary attitude in that AR frame: the
      // core's compass kernel recovers the same bearing.
      const deviceToAr = new Quaternion()
        .setFromAxisAngle(new Vector3(0.2, 1, -0.4).normalize(), 1.1)
        .normalize();
      const deviceToEnu = qAe.clone().multiply(deviceToAr);
      const viaCompass = arNorthBearingDeg(
        [deviceToEnu.x, deviceToEnu.y, deviceToEnu.z, deviceToEnu.w],
        [deviceToAr.x, deviceToAr.y, deviceToAr.z, deviceToAr.w],
      )!;
      expect(Math.abs(bearingDeltaDeg(viaCompass, bearing))).toBeLessThan(1e-6);
    }
  });

  // Why this test matters: the alignment is store data.
  it("refuses anything but 16 finite numbers and a vertical axis", () => {
    expect(alignmentNorthBearingDeg([1, 0, 0])).toBeNull();
    const bad = new Matrix4().toArray();
    bad[7] = Number.NaN;
    expect(alignmentNorthBearingDeg(bad)).toBeNull();
    const vertical = new Matrix4().makeRotationZ(Math.PI / 2).toArray();
    expect(alignmentNorthBearingDeg(vertical)).toBeNull();
    expect(alignmentNorthBearingDeg(new Matrix4().toArray())).toBe(0);
  });
});
