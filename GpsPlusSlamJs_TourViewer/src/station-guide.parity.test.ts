/**
 * THE PRECISION PARITY ORACLE (shared position-precision plan
 * GpsPlusSlamJs_Docs/docs/2026-10-19-1345-shared-position-precision-plan.md,
 * §5 and §12, M2): everything the visitor's station guide shows and decides,
 * tick by tick, on simulated streams, frozen BEFORE the guide judges its
 * position by the framework's shared precision rule
 * (`gps-plus-slam-app-framework/state/position-precision`). The switch must
 * reproduce every tick: the line, the skip label, each find and done, the
 * present station, the wait for a heading, the HUD's targets and bands, the
 * prefetch's activation radii and the breadcrumbs' stop. An oracle frozen
 * first, not a test written with the change (CLAUDE.md: tests written with
 * the code confirm its bugs).
 *
 * The streams drive the guide through the page's own `visitorPosition`
 * (the store's GPS points, the alignment, the AR pose, the zero) and the
 * page's signals (a code lined up, tracking ready), and cover what the plan
 * names: a code's hold (votes still cast), its fade (votes stop, the trust
 * does not end by the clock, P-D6), an odometry-frame change and a veto
 * (the code's trust ends), codes-only, a GPS gap (a stale fix), lone fixes
 * (one outlier hiding behind the median), a tracking drop with and without
 * a code (the review's S2), GPS too weak to guide by, and leaving AR. A
 * code's synthetic readings are mixed into the store wherever a code
 * votes, so a rule that read them as device fixes would differ.
 *
 * The outputs live in `__golden__/station-guide-precision.golden.json`.
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

import { wireStationGuide } from "./station-guide";
import { visitorGuideReducer } from "./visitor-guide-slice";
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

/** Every tick of one stream through the guide as the page wires it. */
function runStream(s: Scenario): TickRecord[] {
  const rng = mulberry32(
    [...s.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
  );
  const store = configureStore({
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
      approach: [...approach],
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
];

/** The named exception (plan §12, S3): an aligned position the guide
 *  judges, no code holds, and no device fix states an accuracy. */
function isNamedException(
  input: TickInput,
  hasDeviceAccuracy: boolean,
): boolean {
  return (
    input.aligned &&
    input.pose &&
    (input.tracking || input.lined) &&
    !input.lined &&
    !hasDeviceAccuracy
  );
}

/** Which ticks of a stream are the named exception. */
function exceptionTicks(s: Scenario): number[] {
  let deviceAccuracy = false;
  const ticks: number[] = [];
  for (let t = 0; t < s.seconds; t += 1) {
    const input = s.input(t);
    if (input.fixAccuracyM !== null && Number.isFinite(input.fixAccuracyM)) {
      deviceAccuracy = true;
    }
    if (isNamedException(input, deviceAccuracy)) ticks.push(t);
  }
  return ticks;
}

describe("the station guide's precision parity oracle (frozen before M2's switch)", () => {
  const now = Object.fromEntries(PARITY.map((s) => [s.name, runStream(s)]));

  it("no parity stream contains the named exception", () => {
    for (const s of PARITY) expect(exceptionTicks(s), s.name).toEqual([]);
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
  });

  it(`reproduces every tick of ${String(PARITY.length)} frozen streams`, () => {
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
      PARITY.map((s) => s.name).sort(),
    );
    for (const s of PARITY) {
      const want = frozen[s.name]!;
      const got = now[s.name]!;
      expect(got).toHaveLength(want.length);
      for (let t = 0; t < want.length; t += 1) {
        expect(got[t], `${s.name} t=${String(t)}`).toEqual(want[t]);
      }
    }
  });
});
