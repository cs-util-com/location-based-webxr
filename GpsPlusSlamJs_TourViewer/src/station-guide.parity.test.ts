/**
 * THE PRECISION PARITY ORACLE (shared position-precision plan
 * GpsPlusSlamJs_Docs/docs/2026-10-19-1345-shared-position-precision-plan.md,
 * §5 and §12, M2): everything the visitor's station guide shows and decides,
 * tick by tick, on simulated streams, frozen BEFORE the guide judges its
 * position by the framework's shared precision rule
 * (`gps-plus-slam-app-framework/state/position-precision`). The switch must
 * reproduce every tick: the line, the skip label, each find and done, the
 * present station, the wait for a heading, the HUD's targets and bands, the
 * prefetch's activation radii and the breadcrumbs' stop - except on the ONE
 * named exception of the plan (§12, S3, and the same rule for a lone fix):
 * a position no code holds and no stated accuracy speaks for. The shared
 * rule reads it as `'none'`: nothing is found there, presence holds (and a
 * station a code made present ends with the code), and the line asks for a
 * code. The exception streams are frozen too: they must match the old
 * guide on every tick outside their exception window, and inside it are
 * held to that rule. An oracle frozen first, not a test written with the
 * change (CLAUDE.md: tests written with the code confirm its bugs).
 *
 * The streams drive the guide through the page's own `visitorPosition`
 * (the store's GPS points, the alignment, the AR pose, the zero) and the
 * page's signals (a code lined up, tracking ready), and cover what the plan
 * names: a code's hold (votes still cast), its fade (votes stop, the trust
 * does not end by the clock, P-D6), an odometry-frame change and a veto
 * (the code's trust ends), codes-only, a GPS gap (a stale fix), lone fixes
 * (one outlier hiding behind the median), a tracking drop with and without
 * a code (the review's S2), GPS too weak to guide by, a code holding while
 * GPS is above the ceiling (a courtyard), and leaving AR. A code's
 * synthetic readings are mixed into the store wherever a code votes, so a
 * rule that read them as device fixes would differ.
 *
 * The outputs live in `__golden__/station-guide-precision.golden.json`.
 * Two streams came after the switch (`courtyard-code-weak-gps`,
 * `codes-only-trust-ended-early`); their outputs were recorded by running
 * this file against the guide's sources as they were before it (commit
 * 183f03d2), which reproduced every earlier stream exactly.
 * Regenerate ONLY when a guide output is meant to change, say why in the
 * commit, and never in CI:
 * `GOLDEN_UPDATE=1 pnpm run test:unit src/station-guide.parity.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it } from "vitest";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import {
  calcGpsCoords,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  type GpsPoint,
} from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import {
  gaussian,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { FIX_MAX_AGE_MS, wireStationGuide } from "./station-guide";
import { visitorGuideReducer } from "./visitor-guide-slice";
import { createTourViewerStore } from "./tour-viewer-session";
import { visitorPosition } from "./visitor-position";

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const GOLDEN = fileURLToPath(
  new URL("./__golden__/station-guide-precision.golden.json", import.meta.url),
);
const ZERO = { lat: 47.5, lon: 8.7 };
const T0 = 1_790_000_000_000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A code's synthetic reading: its fixed accuracy (m), far better than
 *  any fix in these streams, so mixing it in would show. */
const VOTE_ACCURACY_M = 0.5;

const step = {
  id: "s",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

function station(
  id: string,
  north: number,
  east: number,
  foundRadiusM: number,
): TourStation {
  const geo = calcGpsCoords(ZERO, [north, 0, east]);
  return {
    id,
    title: id.toUpperCase(),
    geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
    activateRadiusM: foundRadiusM * 4,
    foundRadiusM,
    hint: "arrow",
    steps: [step],
    items: [],
  };
}

/** The spots a visitor walks between. */
const MUSEUM_SPOTS = [0, 1, 2, 3, 4].map((k): readonly [number, number] => [
  10,
  4 * k,
]);
const TOWN_SPOTS = [0, 1, 2, 3].map((k): readonly [number, number] => [
  30 * k,
  0,
]);
/** A museum row: five exhibits 4 m apart, found within 1.5 m, and one the
 *  visitor never reaches, so the run never completes and the line keeps
 *  speaking of the position to the end of every stream. */
const MUSEUM = [
  ...MUSEUM_SPOTS.map(([n, e], k) => station(`m${String(k)}`, n, e, 1.5)),
  station("far", 200, 200, 1.5),
];
/** A town walk: four stations 30 m apart, found within 10 m, and one far
 *  away (as above). */
const TOWN = [
  ...TOWN_SPOTS.map(([n, e], k) => station(`t${String(k)}`, n, e, 10)),
  station("far", 600, 0, 10),
];

type NE = readonly [number, number];

/** Dwell `dwellS` at each spot in turn, walking `walkS` between them. */
function tourPath(spots: readonly NE[], dwellS: number, walkS: number) {
  const segment = dwellS + walkS;
  return (t: number): NE => {
    const k = Math.floor(t / segment) % spots.length;
    const within = t % segment;
    const [n0, e0] = spots[k]!;
    if (within < dwellS) return [n0 + 0.05 * Math.sin(t), e0];
    const [n1, e1] = spots[(k + 1) % spots.length]!;
    const f = (within - dwellS) / walkS;
    return [n0 + (n1 - n0) * f, e0 + (e1 - e0) * f];
  };
}

const museumPath = tourPath(MUSEUM_SPOTS, 10, 4);
const townPath = tourPath(TOWN_SPOTS, 20, 25);

/** One second of a stream: what the page would see. */
interface TickInput {
  /** The visitor's true spot (the AR pose follows it exactly). */
  readonly at: NE;
  /** The AR pose is there (false: a tracking drop). */
  readonly pose: boolean;
  /** The session holds an alignment (the library aligns from a first fix
   *  or a code's first readings). */
  readonly aligned: boolean;
  /** A device fix arrives this second with this reported accuracy (m;
   *  null: no fix; NaN: a fix stating no accuracy). Its error is drawn
   *  from that accuracy. */
  readonly fixAccuracyM: number | null;
  /** A code casts this many synthetic readings this second. */
  readonly votes: number;
  /** The page's signals: a code lined the alignment up, tracking ready. */
  readonly lined: boolean;
  readonly tracking: boolean;
  /** The AR session ends before this tick (and starts again on it). */
  readonly endSession?: boolean;
}

interface Scenario {
  readonly name: string;
  readonly stations: readonly TourStation[];
  readonly seconds: number;
  readonly input: (t: number) => TickInput;
}

/** What one tick showed and decided. Numbers exact: the same arithmetic
 *  must give the same doubles. */
interface TickRecord {
  readonly t: number;
  readonly line: string;
  readonly skip: string;
  readonly found: readonly string[];
  readonly done: readonly string[];
  readonly present: string | null;
  readonly pending: boolean;
  readonly hud: readonly string[];
  readonly approach: readonly string[];
  readonly crumbs: string | null;
}

/**
 * Every tick of one stream through the guide as the page wires it.
 * `reenter` (visitor walk W4 build plan 2026-10-21-1105, M1): the page's
 * own store, whose subscription ticks the guide on every dispatch as
 * `ar-entry.ts` does, so the guide's own dispatches re-enter it; the
 * prefetch's approach is then recorded once per station and tick (an
 * extra tick at the same instant repeats the same approach).
 */
function runStream(s: Scenario, reenter = false): TickRecord[] {
  const rng = mulberry32(
    [...s.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
  );
  const store = reenter
    ? createTourViewerStore()
    : configureStore({
        reducer: { visitorGuide: visitorGuideReducer },
      });
  const points: GpsPoint[] = [];
  let now = T0;
  let current: TickInput = s.input(0);
  /** The HUD's target source while one runs. */
  const hud: { targets: (() => WayfindingTarget[]) | null } = {
    targets: null,
  };
  const found: string[] = [];
  /** When each station was last found (s). */
  const foundAt = new Map<string, number>();
  const done: string[] = [];
  const approach: string[] = [];
  let crumbs: string | null = null;
  const dom = {
    line: { textContent: "", hidden: true },
    skip: { textContent: "", hidden: true },
  };
  const guide = wireStationGuide({
    dom,
    tour: () => ({ stations: s.stations, order: "any" }),
    placementAllowed: () => true,
    zero: () => ZERO,
    visitor: () =>
      visitorPosition({
        alignment: current.aligned ? IDENTITY : null,
        // WebXR: x east, y up, z south.
        arPose: current.pose
          ? { position: { x: current.at[1], y: 1.5, z: -current.at[0] } }
          : null,
        gpsPositions: points,
        zero: ZERO,
      }),
    codeLinedUp: () => current.lined,
    alignmentReady: () => current.tracking || current.lined,
    trackingReady: () => current.tracking,
    startHud: (getTargets) => {
      hud.targets = getTargets;
      return { dispose: () => (hud.targets = null) };
    },
    now: () => now,
    guideStore: store,
    onFound: (st) => found.push(st.id),
    onDone: (id) => done.push(id),
    onApproach: (st, d, activateM) =>
      approach.push(`${st.id}:${d.toFixed(3)}:${String(activateM)}`),
    onGuide: (from, target) => {
      crumbs =
        target === null
          ? null
          : `${from === null ? "-" : "v"}>${target.id}/${String(target.stopM)}`;
    },
  });
  if (reenter) store.subscribe(() => guide.tick());
  const out: TickRecord[] = [];
  for (let t = 0; t < s.seconds; t += 1) {
    current = s.input(t);
    now = T0 + t * 1000;
    if (current.endSession === true) guide.endSession();
    const [n, e] = current.at;
    for (let v = 0; v < current.votes; v += 1) {
      points.push(
        gpsPoint(`v${String(t)}-${String(v)}`, n, e, VOTE_ACCURACY_M, true),
      );
    }
    if (current.fixAccuracyM !== null) {
      const acc = current.fixAccuracyM;
      const sigma = Number.isFinite(acc) ? acc * 0.6 : 3;
      points.push(
        gpsPoint(
          `f${String(t)}`,
          n + sigma * gaussian(rng),
          e + sigma * gaussian(rng),
          acc,
          false,
        ),
      );
    }
    found.length = 0;
    done.length = 0;
    approach.length = 0;
    // A story plays 4 s, then ends (its station is done).
    for (const [id, at] of foundAt) {
      if (at === t - 4) guide.storyEnded(id);
    }
    guide.tick();
    for (const id of found) foundAt.set(id, t);
    const targets = hud.targets?.() ?? [];
    out.push({
      t,
      line: dom.line.textContent,
      skip: dom.skip.textContent,
      found: [...found],
      done: [...done],
      present: store.getState().visitorGuide.presentStationId,
      pending: store.getState().visitorGuide.headingPending,
      hud: targets.map(
        (x) =>
          `${x.id ?? "?"}:${String(x.distanceMin)}:${String(x.distanceMax)}`,
      ),
      approach: reenter ? [...new Set(approach)] : [...approach],
      crumbs,
    });
  }
  return out;

  function gpsPoint(
    id: string,
    north: number,
    east: number,
    accuracyM: number,
    synthetic: boolean,
  ): GpsPoint {
    const geo = calcGpsCoords(ZERO, [north, 0, east]);
    return {
      id,
      latitude: geo.lat,
      longitude: geo.lon,
      altitude: 400,
      latLongAccuracy: Number.isNaN(accuracyM) ? undefined : accuracyM,
      timestamp: now,
      ...(synthetic ? { source: GPS_POINT_SOURCE_SYNTHETIC_QR } : {}),
      zeroRef: ZERO,
      coordinates: [north, 400, east],
      weight: 1,
    };
  }
}

const base = (at: NE): TickInput => ({
  at,
  pose: true,
  aligned: true,
  fixAccuracyM: 6,
  votes: 0,
  lined: false,
  tracking: true,
});

/** The parity streams: no tick of these is the named exception. */
const PARITY: readonly Scenario[] = [
  {
    // A code holds the museum: votes cast with each fix, the device fixes
    // ±20 m (a museum's indoor GPS), tracking not ready at first.
    name: "hold",
    stations: MUSEUM,
    seconds: 150,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: 20,
      votes: t >= 3 ? 2 : 0,
      lined: t >= 3,
      tracking: t >= 40,
    }),
  },
  {
    // The hold ends and the fade runs out: no more votes after 40 s, the
    // trust stays (P-D6: never by the clock or a count of fixes).
    name: "fade",
    stations: MUSEUM,
    seconds: 180,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: 12,
      votes: t >= 3 && t < 40 ? 2 : 0,
      lined: t >= 3,
    }),
  },
  {
    // An odometry-frame change ends the code's trust at 60 s; GPS ±6 m
    // judges from then on, outdoors.
    name: "frame-change",
    stations: TOWN,
    seconds: 200,
    input: (t) => ({
      ...base(townPath(t)),
      votes: t >= 2 && t < 60 ? 2 : 0,
      lined: t >= 2 && t < 60,
    }),
  },
  {
    // A veto takes the code's votes back at 50 s; tracking is not ready
    // until 90 s, so lone fixes stand in between.
    name: "veto",
    stations: TOWN,
    seconds: 200,
    input: (t) => ({
      ...base(townPath(t)),
      fixAccuracyM: 10,
      votes: t >= 2 && t < 50 ? 2 : 0,
      lined: t >= 2 && t < 50,
      tracking: t >= 90,
    }),
  },
  {
    // Without location: no device fix ever. A code holds until 70 s, then
    // its trust ends with tracking not ready: no position at all.
    name: "codes-only",
    stations: MUSEUM,
    seconds: 120,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: null,
      aligned: t >= 3,
      votes: t >= 3 && t < 70 ? 2 : 0,
      lined: t >= 3 && t < 70,
      tracking: false,
    }),
  },
  {
    // No code, tracking never ready: lone fixes; a 12 s gap leaves the
    // last fix stale, and during a second gap the fixes were ±40 m.
    name: "gps-gap",
    stations: TOWN,
    seconds: 200,
    input: (t) => ({
      ...base(townPath(t)),
      fixAccuracyM:
        (t >= 30 && t < 42) || (t >= 130 && t < 145)
          ? null
          : t >= 110 && t < 130
            ? 40
            : 5,
      tracking: false,
    }),
  },
  {
    // Lone fixes at ±5 m with single outliers (±40 m, and one stating no
    // accuracy): a lone fix is judged by the worse of the median and its
    // own.
    name: "lone-outliers",
    stations: TOWN,
    seconds: 120,
    input: (t) => ({
      ...base(townPath(t)),
      fixAccuracyM: t % 17 === 9 ? 40 : t % 23 === 11 ? Number.NaN : 5,
      tracking: false,
    }),
  },
  {
    // Aligned and ready, the AR pose drops for stretches: with no code,
    // with weak GPS (±30 m) during one drop, and with a code holding.
    name: "tracking-drop",
    stations: TOWN,
    seconds: 200,
    input: (t) => ({
      ...base(townPath(t)),
      pose: !(
        (t >= 25 && t < 33) ||
        (t >= 70 && t < 80) ||
        (t >= 150 && t < 160)
      ),
      fixAccuracyM: t >= 60 && t < 85 ? 30 : 6,
      votes: t >= 120 && t < 170 ? 2 : 0,
      lined: t >= 120 && t < 170,
    }),
  },
  {
    // GPS too weak to guide by while aligned: ±8 m at a station, then ±40
    // m that places the visitor far away (presence ends past the exit by
    // its accuracy), then good again.
    name: "weak-gps",
    stations: TOWN,
    seconds: 160,
    input: (t) => ({
      ...base(t >= 50 && t < 70 ? [120, 0] : townPath(t)),
      fixAccuracyM: t >= 40 && t < 75 ? 40 : 8,
    }),
  },
  {
    // Leaving AR and coming back: a code held the first entry; the second
    // entry has GPS only and earns its heading again.
    name: "re-entry-gps",
    stations: TOWN,
    seconds: 160,
    input: (t) => ({
      ...base(townPath(t)),
      votes: t >= 2 && t < 60 ? 2 : 0,
      lined: t >= 2 && t < 60,
      tracking: t < 60 || t >= 90,
      endSession: t === 60,
    }),
  },
  {
    // A courtyard: a code holds the museum while every device fix reads
    // ±35 m, above the ceiling. The code's position is trusted and guides
    // (the device fixes never make it too weak); when its trust ends (an
    // odometry-frame change at 100 s) the same GPS is too weak to guide by.
    name: "courtyard-code-weak-gps",
    stations: MUSEUM,
    seconds: 140,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: 35,
      votes: t >= 3 && t < 100 ? 2 : 0,
      lined: t >= 3 && t < 100,
      tracking: t >= 20,
    }),
  },
];

/**
 * The named exception (plan §12, S3, and the same rule for a lone fix): a
 * position the guide judges that no code holds and no stated accuracy
 * speaks for - no stored device fix states one and, for a lone fix,
 * neither does the fix itself. The shared rule reads it as `'none'`; the
 * guide before it judged such a position with an unknown accuracy, by the
 * radius alone and with the widest bands.
 */
function exceptionTicks(s: Scenario): number[] {
  let deviceAccuracy = false;
  let lastFixAt = Number.NEGATIVE_INFINITY;
  const ticks: number[] = [];
  for (let t = 0; t < s.seconds; t += 1) {
    const input = s.input(t);
    if (input.fixAccuracyM !== null) {
      lastFixAt = t;
      if (Number.isFinite(input.fixAccuracyM)) deviceAccuracy = true;
    }
    if (deviceAccuracy) continue;
    const ready = input.aligned && (input.tracking || input.lined);
    const alignedNoCode = ready && input.pose && !input.lined;
    // A fresh fix stands in only while the session counts as unaligned.
    const loneFix = !ready && (t - lastFixAt) * 1000 <= FIX_MAX_AGE_MS;
    if (alignedNoCode || loneFix) ticks.push(t);
  }
  return ticks;
}

/** The exception streams: each reaches the named exception (plan §12, S3)
 *  and is frozen too, so the ticks before it are held to parity and the
 *  ticks on it show what the old judgement did there. */
const EXCEPTION: readonly Scenario[] = [
  {
    // Without location, the tracking report reads ready on the code's
    // synthetic readings: when the code's trust ends (an odometry-frame
    // change at 70 s) the aligned position has no code and no accuracy.
    // A rescan at 100 s brings the code back.
    name: "codes-only-trust-ended",
    stations: MUSEUM,
    seconds: 130,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: null,
      aligned: t >= 3,
      votes: (t >= 3 && t < 70) || t >= 100 ? 2 : 0,
      lined: (t >= 3 && t < 70) || t >= 100,
    }),
  },
  {
    // Without location, leaving AR at 60 s: the next entry's report reads
    // ready on the earlier entry's synthetic readings before any code
    // locked in it; a lock at 85 s lines it up again.
    name: "codes-only-re-entry",
    stations: MUSEUM,
    seconds: 110,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: null,
      aligned: t >= 3,
      votes: (t >= 3 && t < 60) || t >= 85 ? 2 : 0,
      lined: (t >= 3 && t < 60) || t >= 85,
      endSession: t === 60,
    }),
  },
  {
    // Device fixes that state no accuracy at all, aligned and ready, no
    // code: nothing speaks for the position's precision.
    name: "gps-without-accuracy",
    stations: TOWN,
    seconds: 60,
    input: (t) => ({ ...base(townPath(t)), fixAccuracyM: Number.NaN }),
  },
  {
    // A GPS-only session before tracking is ready, its fixes stating no
    // accuracy (injected points: a phone always states one): the lone fix
    // stands in with nothing to judge it by.
    name: "lone-fix-without-accuracy",
    stations: TOWN,
    seconds: 60,
    input: (t) => ({
      ...base(townPath(t)),
      fixAccuracyM: Number.NaN,
      tracking: false,
    }),
  },
  {
    // As `codes-only-trust-ended`, but the code's trust ends at 30 s with
    // exhibits still unfound (m3, m4): a guide that judged the position
    // nothing vouches for would find them by the radius alone.
    name: "codes-only-trust-ended-early",
    stations: MUSEUM,
    seconds: 90,
    input: (t) => ({
      ...base(museumPath(t)),
      fixAccuracyM: null,
      aligned: t >= 3,
      votes: t >= 3 && t < 30 ? 2 : 0,
      lined: t >= 3 && t < 30,
    }),
  },
];

describe("the station guide's precision parity oracle (frozen before M2's switch)", () => {
  const now = Object.fromEntries(
    [...PARITY, ...EXCEPTION].map((s) => [s.name, runStream(s)]),
  );

  it("no parity stream contains the named exception", () => {
    for (const s of PARITY) expect(exceptionTicks(s), s.name).toEqual([]);
  });

  it("every exception stream reaches the named exception", () => {
    for (const s of EXCEPTION) {
      expect(exceptionTicks(s).length, s.name).toBeGreaterThan(0);
    }
  });

  // Why this test matters: an oracle over streams that never reach the
  // branches it is meant to guard proves nothing. Each stream is checked
  // for the situation it claims to cover.
  it("each stream reaches the situation it is named for", () => {
    const lines = (name: string) => now[name]!.map((r) => r.line);
    const finds = (name: string) => now[name]!.flatMap((r) => r.found);
    // A code finds museum exhibits 4 m apart with ±20 m GPS.
    expect(finds("hold").length).toBeGreaterThanOrEqual(3);
    expect(finds("fade").length).toBeGreaterThanOrEqual(3);
    // GPS judges after the code's trust ended, and finds a station.
    expect(
      now["frame-change"]!.slice(60).flatMap((r) => r.found).length,
    ).toBeGreaterThan(0);
    const anyMatch = (ls: readonly string[], re: RegExp) =>
      ls.some((l) => re.test(l));
    // Without location and without the code's trust there is no position.
    expect(
      anyMatch(lines("codes-only").slice(75), /waiting for your position/),
    ).toBe(true);
    // A stale fix waits; a ±40 m fix is too weak.
    expect(
      anyMatch(lines("gps-gap").slice(36, 42), /waiting for your position/),
    ).toBe(true);
    expect(anyMatch(lines("gps-gap").slice(110, 130), /GPS too weak/)).toBe(
      true,
    );
    expect(
      anyMatch(lines("lone-outliers"), /GPS too weak to guide you \(±40 m\)/),
    ).toBe(true);
    // A tracking drop with weak GPS still says so, with no position.
    expect(anyMatch(lines("tracking-drop").slice(70, 80), /GPS too weak/)).toBe(
      true,
    );
    // ... and with a code holding never calls it too weak.
    expect(anyMatch(lines("tracking-drop").slice(150, 160), /too weak/)).toBe(
      false,
    );
    // A weak fix far away ends presence.
    const weak = now["weak-gps"]!;
    expect(weak.slice(30, 45).some((r) => r.present !== null)).toBe(true);
    expect(weak.slice(55, 70).every((r) => r.present === null)).toBe(true);
    // A code guides through GPS above the ceiling (a courtyard): it finds
    // exhibits and never calls the GPS too weak; once its trust ends the
    // same GPS is too weak to guide by.
    const courtyard = now["courtyard-code-weak-gps"]!;
    expect(
      courtyard.slice(3, 100).flatMap((r) => r.found).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      anyMatch(lines("courtyard-code-weak-gps").slice(3, 100), /too weak/),
    ).toBe(false);
    expect(
      lines("courtyard-code-weak-gps")
        .slice(100)
        .every((l) => /GPS too weak to guide you \(±35 m\)/.test(l)),
    ).toBe(true);
  });

  it(`reproduces every tick of ${String(PARITY.length + EXCEPTION.length)} frozen streams`, () => {
    if (process.env["GOLDEN_UPDATE"] === "1") {
      // A regeneration absorbs whatever changed: never unattended.
      if (process.env["CI"]) {
        throw new Error("GOLDEN_UPDATE is refused in CI.");
      }
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    }
    const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<
      string,
      TickRecord[]
    >;
    expect(Object.keys(frozen).sort()).toEqual(
      [...PARITY, ...EXCEPTION].map((s) => s.name).sort(),
    );
    let afterWindow = 0;
    for (const s of [...PARITY, ...EXCEPTION]) {
      const want = frozen[s.name]!;
      const got = now[s.name]!;
      expect(got).toHaveLength(want.length);
      // An exception stream is held to the old guide up to its first
      // exception tick; the window itself is the next test's.
      const ticks = exceptionTicks(s);
      const until = ticks[0] ?? want.length;
      for (let t = 0; t < until; t += 1) {
        expect(got[t], `${s.name} t=${String(t)}`).toEqual(want[t]);
      }
      if (ticks.length === 0) continue;
      // After the window every tick is the old guide's again, presence
      // included. Presence is the one field the window could carry over:
      // the old guide kept a station a code made present through it, the
      // shared rule ends that station there. On these streams the code's
      // return (a rescan, a new entry's lock) re-judges both from the same
      // position at once, so they meet on the first tick after the window;
      // a stream where they did not would need its own named exception.
      for (let t = ticks.at(-1)! + 1; t < want.length; t += 1) {
        expect(got[t], `${s.name} t=${String(t)} (after the window)`).toEqual(
          want[t],
        );
        afterWindow += 1;
      }
    }
    // Two streams come back from the exception (a rescan, a new entry's
    // lock): the comparison after the window is not vacuous.
    expect(afterWindow).toBeGreaterThan(0);
  });

  // Why this test matters (visitor walk W4 build plan 2026-10-21-1105, M1,
  // the cold review's blocker): the page ticks the guide from its store's
  // subscription (`ar-entry.ts`), so every dispatch of the guide's own
  // re-enters it mid-way; the bare store above never shows that. Through
  // the page's store with that subscription, every stream must give the
  // same golden on every tick it is held to, and the same as the bare run
  // on every tick (the exception windows included).
  it("reproduces the same golden through the page's store, re-entered by its subscription", () => {
    const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<
      string,
      TickRecord[]
    >;
    for (const s of [...PARITY, ...EXCEPTION]) {
      const got = runStream(s, true);
      expect(got, s.name).toEqual(now[s.name]);
      // Held to the golden outside the exception window, as above.
      const ticks = exceptionTicks(s);
      const want = frozen[s.name]!;
      for (let t = 0; t < want.length; t += 1) {
        if (ticks.length > 0 && t >= ticks[0]! && t <= ticks.at(-1)!) continue;
        expect(got[t], `${s.name} t=${String(t)}`).toEqual(want[t]);
      }
    }
  });

  // Why this test matters (plan §12, S3): it is the ONE place the shared
  // rule changes what a visitor gets, so it is pinned tick by tick. Before
  // it, the old guide judged a position nothing vouched for with an
  // unknown accuracy - the widest bands and a 25 m takeover margin - and
  // without location, once a code's trust ended, kept showing one exhibit
  // for 30 s while the visitor stood at others (the golden file's
  // `codes-only-trust-ended`, 70-99 s). Its arrows, distances, approach,
  // trail and "nearest" name went on pointing by that same alignment while
  // the line refused to give a distance; none of them is shown now.
  it("on the named exception finds nothing, holds or ends presence, points at nothing, and asks for a code", () => {
    const frozen = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<
      string,
      TickRecord[]
    >;
    for (const s of EXCEPTION) {
      const ticks = exceptionTicks(s);
      const got = now[s.name]!;
      const first = ticks[0]!;
      // Up to here the old guide's ticks hold (the test above).
      expect(got[first - 1] ?? null, s.name).toEqual(
        frozen[s.name]![first - 1] ?? null,
      );
      for (const t of ticks) {
        const at = `${s.name} t=${String(t)}`;
        const tick = got[t]!;
        // Nothing points or measures on an alignment nothing vouches for:
        // no HUD target (arrows, distances), no prefetch approach, no
        // breadcrumb trail from the visitor (a target with no visitor
        // draws none), and the line names no "nearest" station.
        expect(tick.hud, at).toEqual([]);
        expect(tick.approach, at).toEqual([]);
        expect(tick.crumbs === null || tick.crumbs.startsWith("->"), at).toBe(
          true,
        );
        expect(tick.line, at).not.toMatch(/nearest/);
        expect(tick.found, at).toEqual([]);
        // Presence never enters or moves: it holds, or ends.
        const before = got[t - 1]?.present ?? null;
        expect([before, null], at).toContain(tick.present);
        expect(tick.line, at).toMatch(
          /- scan one of the tour's codes so the guide knows where you are\.$/,
        );
      }
    }
    // "Finds nothing" can fail: when the early stream's trust ends two
    // exhibits are still unfound, and the old guide found both on the
    // position nothing vouched for, by the radius alone.
    const early = EXCEPTION.find(
      (s) => s.name === "codes-only-trust-ended-early",
    )!;
    expect(
      exceptionTicks(early).flatMap((t) => frozen[early.name]![t]!.found),
    ).toEqual(["m3", "m4"]);
    // A station a code made present ends with the code; a rescan (100 s)
    // brings guidance back.
    const ended = now["codes-only-trust-ended"]!;
    expect(ended[69]!.present).not.toBeNull();
    expect(ended.slice(70, 100).every((r) => r.present === null)).toBe(true);
    expect(ended.slice(100).some((r) => r.present !== null)).toBe(true);
    // Leaving AR clears presence; the next entry judges nothing until its
    // own code locks (85 s).
    const reentry = now["codes-only-re-entry"]!;
    expect(reentry.slice(60, 85).every((r) => r.present === null)).toBe(true);
    expect(reentry.slice(85).some((r) => r.present !== null)).toBe(true);
    // Fixes that state no accuracy, aligned or alone, judge nothing.
    for (const name of ["gps-without-accuracy", "lone-fix-without-accuracy"]) {
      expect(
        now[name]!.every((r) => r.found.length === 0),
        name,
      ).toBe(true);
      expect(
        now[name]!.every((r) => r.present === null),
        name,
      ).toBe(true);
    }
  });
});
