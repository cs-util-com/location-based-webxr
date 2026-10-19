/**
 * The sweep behind `station-presence.ts`'s takeover margin (visitor plan
 * 2026-10-18-2349 M1, §8; cold review HIGH-3; PR review S2-S4, N3, N6). A
 * visitor walks a row of five stations, stops at each, and walks on; the
 * presence rule runs on every judged position. Per cell it reports, per
 * station visited:
 * - **wrong**: the share of steps, while the TRUE position is inside some
 *   station's found radius, on which a DIFFERENT station is present (the
 *   wrong exhibit's content; truth is the nearest station whose circle
 *   holds the true position, so a previous exhibit kept while the visitor
 *   already stands nearer the next counts as wrong);
 * - **miss**: the share of those steps on which nothing is present;
 * - **flicker**: switches of the present station while the TRUE station
 *   has not changed since the previous switch (A to B and back while the
 *   visitor stands at A counts twice, and so does a blink to nothing and
 *   back). Counted directly, not net of the true sequence: a rule that
 *   misses a station must not hide a flicker elsewhere (review S2);
 * - **returns within N s**: switches back to a station left at most N s
 *   before (N 2/5/10 s): the flicker a visitor sees as content coming back.
 *
 * WHAT IS SIMULATED.
 * - **Museum, a code scanned** (production's band is the HUD's 1.5 m, the
 *   margin the floor): spacing 3/4/5/6 m, radius 1/1.5/2/2.5/3 m - tangent
 *   (spacing = 2R) and overlapping (spacing < 2R) circles included - AR
 *   drift 0/1/2 m (a constant offset per walk, its direction random: the
 *   plan's "about a metre over a few dozen metres") and white jitter of the
 *   aligned position 0.05/0.25/0.5 m (no field figure exists, so it is the
 *   parameter that decides the floor). The visitor dwells 12 s at a random
 *   spot within half the radius of each centre, swaying 10 cm, and walks
 *   0.8 m/s between. 4 Hz.
 * - **Museum, GPS only** (review S4: no code, the raw accuracy judges):
 *   the same rooms at accuracy 5/8/12/20 m under the `raw` Gauss-Markov
 *   model of `station-bands.sweep.test.ts` (wander 0.6, white 0.3, 20 s),
 *   1 Hz. The margin can exceed the spacing there, which makes a takeover
 *   impossible (the triangle inequality: `d_A - d_B <= |AB|`).
 * - **Outdoor** (no code): R 25 m at spacing 25/30/40/50 m, accuracy
 *   3/5/8/12/20 m, and 25 m (the ceiling) at spacing 25/30 m, under the
 *   same `raw` model; the REPORTED accuracy 0.5x/1x/2x the generator's
 *   (review S3: the rule reads what the phone reports, which need not be
 *   its true error). The band, the margin and the too-weak gate read the
 *   reported accuracy, as in production; above the ceiling only the exit
 *   applies (`presentAfterWeakFix`). 60 s dwells within 5 m of each
 *   centre, 1.4 m/s, 1 Hz.
 * - The margin: fixed 0/0.5/1/1.5/2/3 m; the shipped rule (`takeoverMarginM`:
 *   the reported accuracy, at least 1 m, at most 25 m; the floor for a
 *   code) and that rule times 0.5/0.75/1.5/2 (review S3); and the rule
 *   capped at half the spacing (review S4: a cap below the pair's centre
 *   distance keeps a takeover possible).
 *
 * WHAT IS MEASURED: `station-presence.ts.md`, Evidence, has the table; the
 * assertions below pin the verdict. `STATION_PRESENCE_SWEEP_OUT=<file>`
 * writes every cell.
 */

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  gaussian,
  gaussMarkovGpsErrors,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";

import {
  ACCURACY_CEILING_M,
  HUD_ARRIVAL_BAND_M,
  tooWeakToGuide,
} from "./station-bands";
import {
  nextPresentStation,
  presentAfterWeakFix,
  takeoverMarginM,
  TAKEOVER_MARGIN_MIN_M,
  type PresenceCandidate,
} from "./station-presence";

type P = readonly [number, number];

const OUT = process.env["STATION_PRESENCE_SWEEP_OUT"];
const table: string[] = [];

const STATIONS = 5;
const RETURN_WINDOWS_S = [2, 5, 10] as const;

const FIXED_MARGINS = [0, 0.5, 1, 1.5, 2, 3] as const;
const RULE_FACTORS = [0.5, 0.75, 1, 1.5, 2] as const;
/** A margin by name: a fixed value, the rule times a factor, or the rule
 *  capped at half the spacing. */
type MarginKey = `m ${string}` | `rule x${string}` | "rule capped";
const fixedKey = (m: number): MarginKey => `m ${String(m)}`;
const ruleKey = (f: number): MarginKey => `rule x${String(f)}`;
const RULE: MarginKey = ruleKey(1);
const MARGIN_KEYS: readonly MarginKey[] = [
  ...FIXED_MARGINS.map(fixedKey),
  ...RULE_FACTORS.map(ruleKey),
  "rule capped",
];

/** The margin a key gives for a walk: the reported accuracy (null for a
 *  code's position) and the row's spacing. */
function marginOf(
  key: MarginKey,
  reportedM: number | null,
  spacing: number,
): number {
  const rule = takeoverMarginM(reportedM, reportedM === null);
  if (key === "rule capped") return Math.min(rule, spacing / 2);
  if (key.startsWith("rule x")) return rule * Number(key.slice(6));
  return Number(key.slice(2));
}

interface Metrics {
  /** Steps with a true station. */
  inside: number;
  wrong: number;
  miss: number;
  flicker: number;
  returns: number[];
  visits: number;
}

function emptyMetrics(): Metrics {
  return {
    inside: 0,
    wrong: 0,
    miss: 0,
    flicker: 0,
    returns: RETURN_WINDOWS_S.map(() => 0),
    visits: 0,
  };
}

function add(a: Metrics, b: Metrics): void {
  a.inside += b.inside;
  a.wrong += b.wrong;
  a.miss += b.miss;
  a.flicker += b.flicker;
  for (const [i, r] of b.returns.entries()) a.returns[i]! += r;
  a.visits += b.visits;
}

function wrongRate(m: Metrics): number {
  return m.inside === 0 ? 0 : m.wrong / m.inside;
}

function missRate(m: Metrics): number {
  return m.inside === 0 ? 0 : m.miss / m.inside;
}

function flickerPerVisit(m: Metrics): number {
  return m.flicker / m.visits;
}

function returnsPerVisit(m: Metrics, windowS: number): number {
  return m.returns[RETURN_WINDOWS_S.indexOf(windowS as 2 | 5 | 10)]! / m.visits;
}

/** The nearest station whose found radius holds `p`, else null. */
function trueStation(
  stations: readonly P[],
  p: P,
  foundR: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const [i, s] of stations.entries()) {
    const d = Math.hypot(s[0] - p[0], s[1] - p[1]);
    if (d <= foundR && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** One walk, measured once: the candidates at every observed position and
 *  the true station at every step (shared by every margin). */
interface Walk {
  readonly candidates: readonly (readonly PresenceCandidate[])[];
  readonly truth: readonly (number | null)[];
  readonly dtS: number;
  readonly visits: number;
}

function measureWalk(
  stations: readonly P[],
  truth: readonly P[],
  observed: readonly P[],
  foundR: number,
  bandM: number,
  dtS: number,
): Walk {
  const ids = stations.map((_, k) => String(k));
  return {
    candidates: observed.map((o) =>
      stations.map((s, k) => ({
        id: ids[k]!,
        distanceM: Math.hypot(s[0] - o[0], s[1] - o[1]),
        foundM: foundR,
        foundExitM: foundR + bandM,
      })),
    ),
    truth: truth.map((p) => trueStation(stations, p, foundR)),
    dtS,
    visits: stations.length,
  };
}

/** A switch back to `next`, left `nowS - leftAtS` before: counted in every
 *  return window it falls inside. */
function countReturn(
  out: Metrics,
  leftAtS: ReadonlyMap<string, number>,
  next: string | null,
  nowS: number,
): void {
  const left = next === null ? undefined : leftAtS.get(next);
  if (left === undefined) return;
  for (const [k, w] of RETURN_WINDOWS_S.entries()) {
    if (nowS - left <= w) out.returns[k]! += 1;
  }
}

/** Run the rule along one measured walk. `weakAccuracyM`: the reported
 *  accuracy when it is too weak to guide by (only the exit applies). */
function runWalk(
  walk: Walk,
  marginM: number,
  weakAccuracyM: number | null,
): Metrics {
  const out = emptyMetrics();
  out.visits = walk.visits;
  let present: string | null = null;
  let truthChangedSinceSwitch = true;
  let lastTrue: number | null = null;
  const leftAtS = new Map<string, number>();
  for (const [i, candidates] of walk.candidates.entries()) {
    const t = walk.truth[i]!;
    if (t !== lastTrue) truthChangedSinceSwitch = true;
    lastTrue = t;
    const next: string | null =
      weakAccuracyM === null
        ? nextPresentStation(present, candidates, marginM)
        : presentAfterWeakFix(present, candidates, weakAccuracyM);
    if (next !== present) {
      const nowS = i * walk.dtS;
      if (!truthChangedSinceSwitch) out.flicker += 1;
      truthChangedSinceSwitch = false;
      if (present !== null) leftAtS.set(present, nowS);
      countReturn(out, leftAtS, next, nowS);
      present = next;
    }
    if (t === null) continue;
    out.inside += 1;
    if (present === null) out.miss += 1;
    else if (present !== String(t)) out.wrong += 1;
  }
  return out;
}

/** A walk along the row: in from one spacing before the first station, a
 *  dwell at a spot near each centre, out one spacing past the last. */
function walkPath(
  stations: readonly P[],
  spacing: number,
  dwell: { readonly s: number; readonly spotM: number; readonly swayM: number },
  speedMps: number,
  hz: number,
  rng: () => number,
): P[] {
  const first = stations[0]!;
  const last = stations[stations.length - 1]!;
  const waypoints: { p: P; dwell: boolean }[] = [
    { p: [first[0] - spacing, first[1]], dwell: false },
  ];
  for (const s of stations) {
    const a = rng() * 2 * Math.PI;
    const r = Math.sqrt(rng()) * dwell.spotM;
    waypoints.push({
      p: [s[0] + r * Math.cos(a), s[1] + r * Math.sin(a)],
      dwell: true,
    });
  }
  waypoints.push({ p: [last[0] + spacing, last[1]], dwell: false });
  const out: P[] = [];
  const step = speedMps / hz;
  let at = waypoints[0]!.p;
  out.push(at);
  for (const w of waypoints.slice(1)) {
    const d = Math.hypot(w.p[0] - at[0], w.p[1] - at[1]);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k += 1) {
      out.push([
        at[0] + ((w.p[0] - at[0]) * k) / n,
        at[1] + ((w.p[1] - at[1]) * k) / n,
      ]);
    }
    at = w.p;
    if (w.dwell) {
      for (let k = 0; k < dwell.s * hz; k += 1) {
        out.push([
          at[0] + dwell.swayM * gaussian(rng),
          at[1] + dwell.swayM * gaussian(rng),
        ]);
      }
    }
  }
  return out;
}

function row(spacing: number): P[] {
  return Array.from({ length: STATIONS }, (_, i) => [i * spacing, 0] as P);
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

function geometry(spacing: number, radius: number): string {
  if (Math.abs(spacing - 2 * radius) < 1e-9) return "tangent";
  return spacing < 2 * radius ? "overlap" : "apart";
}

type Cell = Map<MarginKey, Metrics>;

function emptyCell(): Cell {
  return new Map(MARGIN_KEYS.map((k) => [k, emptyMetrics()]));
}

const RAW = { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 } as const;

const MUSEUM_SPACINGS = [3, 4, 5, 6];
const MUSEUM_RADII = [1, 1.5, 2, 2.5, 3];
const MUSEUM_DRIFTS = [0, 1, 2];
const MUSEUM_JITTERS = [0.05, 0.25, 0.5];
const MUSEUM_SEEDS = 10;
const MUSEUM_HZ = 4;
const GPS_MUSEUM_ACCURACIES = [5, 8, 12, 20];

/** One museum cell with a code: every margin on the same walks. The band
 *  is the HUD's (a code's position), the rule's margin the floor. */
function museumCell(
  spacing: number,
  radius: number,
  drift: number,
  jitter: number,
): Cell {
  const stations = row(spacing);
  const out = emptyCell();
  for (let seed = 0; seed < MUSEUM_SEEDS; seed += 1) {
    const rng = mulberry32(
      seed * 7919 +
        Math.round(spacing * 131 + radius * 17 + drift * 7 + jitter * 1000),
    );
    const truth = walkPath(
      stations,
      spacing,
      { s: 12, spotM: radius / 2, swayM: 0.1 },
      0.8,
      MUSEUM_HZ,
      rng,
    );
    const a = rng() * 2 * Math.PI;
    const bias: P = [drift * Math.cos(a), drift * Math.sin(a)];
    const observed = truth.map((p): P => [
      p[0] + bias[0] + jitter * gaussian(rng),
      p[1] + bias[1] + jitter * gaussian(rng),
    ]);
    const walk = measureWalk(
      stations,
      truth,
      observed,
      radius,
      HUD_ARRIVAL_BAND_M,
      1 / MUSEUM_HZ,
    );
    for (const key of MARGIN_KEYS) {
      add(out.get(key)!, runWalk(walk, marginOf(key, null, spacing), null));
    }
  }
  return out;
}

/** A walk under raw GPS noise, judged by a reported accuracy (`ratio` x
 *  the generator's): the band, the margin and the too-weak gate read it. */
function gpsCell(
  spacing: number,
  radius: number,
  accuracy: number,
  ratio: number,
  walkShape: {
    readonly dwell: {
      readonly s: number;
      readonly spotM: number;
      readonly swayM: number;
    };
    readonly speedMps: number;
    readonly seeds: number;
  },
): Cell {
  const stations = row(spacing);
  const reported = ratio * accuracy;
  const band = Math.max(
    Math.min(reported, ACCURACY_CEILING_M),
    HUD_ARRIVAL_BAND_M,
  );
  const weak = tooWeakToGuide(reported) ? reported : null;
  const out = emptyCell();
  for (let seed = 0; seed < walkShape.seeds; seed += 1) {
    const rng = mulberry32(
      seed * 104729 + Math.round(spacing * 31 + radius * 7 + accuracy * 3),
    );
    const truth = walkPath(
      stations,
      spacing,
      walkShape.dwell,
      walkShape.speedMps,
      1,
      rng,
    );
    const errors = gaussMarkovGpsErrors(rng, truth.length, accuracy, RAW);
    const observed = truth.map((p, i): P => [
      p[0] + errors[i]![0],
      p[1] + errors[i]![1],
    ]);
    const walk = measureWalk(stations, truth, observed, radius, band, 1);
    for (const key of MARGIN_KEYS) {
      add(out.get(key)!, runWalk(walk, marginOf(key, reported, spacing), weak));
    }
  }
  return out;
}

const OUTDOOR_R = 25;
const OUTDOOR_SPACINGS = [25, 30, 40, 50];
const OUTDOOR_ACCURACIES = [3, 5, 8, 12, 20];
const OUTDOOR_CEILING_SPACINGS = [25, 30];
const REPORTED_RATIOS = [0.5, 1, 2];
const OUTDOOR_WALK = {
  dwell: { s: 60, spotM: 5, swayM: 0.3 },
  speedMps: 1.4,
  seeds: 16,
} as const;
const GPS_MUSEUM_WALK = {
  dwell: { s: 12, spotM: 0.5, swayM: 0.1 },
  speedMps: 0.8,
  seeds: MUSEUM_SEEDS,
} as const;

function line(label: string, key: MarginKey, m: Metrics): string {
  const returns = RETURN_WINDOWS_S.map(
    (w) => `${String(w)} s ${returnsPerVisit(m, w).toFixed(2)}`,
  ).join(" ");
  return `${label} | ${key}: wrong ${pct(wrongRate(m))}, miss ${pct(missRate(m))}, flicker/visit ${flickerPerVisit(m).toFixed(2)}, returns/visit ${returns}`;
}

/** Results by cell, computed once for every test below. */
interface Row {
  readonly kind: "museum" | "gps-museum" | "outdoor";
  readonly geometry: string;
  readonly params: Readonly<Record<string, number>>;
  readonly cell: Cell;
}
const rows: Row[] = [];

function computeAll(): void {
  if (rows.length > 0) return;
  const push = (r: Row): void => {
    rows.push(r);
    const label = `${r.kind} ${r.geometry} ${Object.entries(r.params)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(" ")}`;
    for (const key of MARGIN_KEYS) {
      table.push(line(label, key, r.cell.get(key)!));
    }
  };
  for (const spacing of MUSEUM_SPACINGS) {
    for (const radius of MUSEUM_RADII) {
      const geo = geometry(spacing, radius);
      for (const drift of MUSEUM_DRIFTS) {
        for (const jitter of MUSEUM_JITTERS) {
          push({
            kind: "museum",
            geometry: geo,
            params: { spacing, radius, drift, jitter },
            cell: museumCell(spacing, radius, drift, jitter),
          });
        }
      }
      for (const accuracy of GPS_MUSEUM_ACCURACIES) {
        push({
          kind: "gps-museum",
          geometry: geo,
          params: { spacing, radius, accuracy },
          cell: gpsCell(spacing, radius, accuracy, 1, {
            ...GPS_MUSEUM_WALK,
            dwell: { ...GPS_MUSEUM_WALK.dwell, spotM: radius / 2 },
          }),
        });
      }
    }
  }
  const outdoor: [number, number][] = [
    ...OUTDOOR_SPACINGS.flatMap((s) =>
      OUTDOOR_ACCURACIES.map((a): [number, number] => [s, a]),
    ),
    ...OUTDOOR_CEILING_SPACINGS.map((s): [number, number] => [
      s,
      ACCURACY_CEILING_M,
    ]),
  ];
  for (const [spacing, accuracy] of outdoor) {
    for (const ratio of REPORTED_RATIOS) {
      push({
        kind: "outdoor",
        geometry: geometry(spacing, OUTDOOR_R),
        params: { spacing, accuracy, ratio },
        cell: gpsCell(spacing, OUTDOOR_R, accuracy, ratio, OUTDOOR_WALK),
      });
    }
  }
}

/** A margin's metrics summed over the rows a filter keeps. */
function total(keep: (r: Row) => boolean, key: MarginKey): Metrics {
  const out = emptyMetrics();
  for (const r of rows) if (keep(r)) add(out, r.cell.get(key)!);
  return out;
}

function summary(label: string, keep: (r: Row) => boolean): void {
  for (const key of MARGIN_KEYS) {
    table.push(line(`SUMMARY ${label}`, key, total(keep, key)));
  }
}

describe(
  "station presence sweep (the takeover margin)",
  { timeout: 120_000 },
  () => {
    afterAll(() => {
      if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
    });

    const near = (r: Row) => r.geometry !== "apart";
    const museum = (j: number) => (r: Row) =>
      r.kind === "museum" && near(r) && r.params["jitter"] === j;
    const outdoor = (acc: number, ratio: number) => (r: Row) =>
      r.kind === "outdoor" &&
      r.params["accuracy"] === acc &&
      r.params["ratio"] === ratio;
    /** A margin HOLDS when content comes back within N s at most once in
     *  20 visits, for every N swept (2/5/10 s). */
    const holds = (m: Metrics) =>
      RETURN_WINDOWS_S.every((w) => returnsPerVisit(m, w) <= 0.05);

    // Why this test matters: it is the evidence for the shipped floor, by
    // the flicker counted directly (review S2). A code's AR position
    // wanders little, so a small margin already stops the flicker where
    // circles overlap, and every larger margin keeps the previous exhibit
    // longer (the wrong-station rate grows with m). The aligned position's
    // jitter decides it, and no field figure exists for it: the 1 m floor
    // holds to 0.25 m of jitter, where 0.5 m does not; at 0.5 m of jitter
    // it flickers too, and 1.5-2 m would win.
    it("museum (a code): 0 flickers where circles overlap; the 1 m floor holds to 0.25 m of jitter, 0.5 m only to 5 cm, and neither at 0.5 m", () => {
      computeAll();
      for (const j of MUSEUM_JITTERS) {
        summary(`museum jitter ${String(j)} overlap+tangent`, museum(j));
      }
      // For the record (no assertion): drift, and circles apart.
      for (const d of MUSEUM_DRIFTS) {
        summary(
          `museum drift ${String(d)} jitter 0.05 all geometries`,
          (r) =>
            r.kind === "museum" &&
            r.params["jitter"] === 0.05 &&
            r.params["drift"] === d,
        );
      }
      summary(
        "museum apart jitter 0.05",
        (r) => r.kind === "museum" && !near(r) && r.params["jitter"] === 0.05,
      );
      const at = (j: number, m: number) => total(museum(j), fixedKey(m));
      expect(TAKEOVER_MARGIN_MIN_M).toBe(1);
      expect(total(museum(0.05), RULE)).toEqual(at(0.05, 1));
      // 5 cm: 0 flickers; 0.5 m and 1 m hold, 0.5 m's wrong rate lower by
      // under 2 points; every larger margin's higher than 1 m's.
      expect(holds(at(0.05, 0))).toBe(false);
      expect(holds(at(0.05, 0.5))).toBe(true);
      expect(holds(at(0.05, 1))).toBe(true);
      expect(wrongRate(at(0.05, 0.5))).toBeLessThan(wrongRate(at(0.05, 1)));
      expect(wrongRate(at(0.05, 1)) - wrongRate(at(0.05, 0.5))).toBeLessThan(
        0.02,
      );
      for (const m of [1.5, 2, 3]) {
        expect(wrongRate(at(0.05, 1))).toBeLessThan(wrongRate(at(0.05, m)));
      }
      // 0.25 m: the floor holds, 0.5 m does not.
      expect(holds(at(0.25, 1))).toBe(true);
      expect(holds(at(0.25, 0.5))).toBe(false);
      // 0.5 m: the floor flickers; 1.5 m halves it.
      expect(holds(at(0.5, 1))).toBe(false);
      expect(flickerPerVisit(at(0.5, 1.5))).toBeLessThan(
        flickerPerVisit(at(0.5, 1)) / 2,
      );
    });

    // Why this test matters (review S4): without a code a museum's stations
    // sit closer than the raw fixes' error, and the margin (the accuracy)
    // exceeds the spacing, so a takeover is impossible. The sweep shows the
    // margin is not what fails there: no margin, a cap at half the spacing
    // included, moves the wrong-station rate by more than about a point,
    // and the cap adds flicker for under a point fewer wrong stations at best
    // (0.7 at 5 m, 1.1 more at 8 m); the right station shows under half the
    // time whatever the margin (the found radius is not widened, D16). So
    // no cap ships; a GPS-only museum waits for V-D2 (the precision
    // judgement), not for a margin.
    it("museum, GPS only: no margin and no cap shows the right station half the time; the cap adds flicker for under a point fewer wrong stations at best", () => {
      computeAll();
      for (const a of GPS_MUSEUM_ACCURACIES) {
        const keep = (r: Row) =>
          r.kind === "gps-museum" && r.params["accuracy"] === a;
        summary(`gps-museum acc ${String(a)}`, keep);
        const rule = total(keep, RULE);
        const capped = total(keep, "rule capped");
        for (const key of MARGIN_KEYS) {
          const m = total(keep, key);
          expect(1 - wrongRate(m) - missRate(m)).toBeLessThan(0.5);
          expect(Math.abs(wrongRate(m) - wrongRate(rule))).toBeLessThan(0.02);
        }
        expect(wrongRate(capped)).toBeGreaterThan(wrongRate(rule) - 0.01);
        expect(flickerPerVisit(capped)).toBeGreaterThan(flickerPerVisit(rule));
      }
    });

    // Why this test matters: outdoors the position's noise is metres, and
    // no fixed margin in 0-3 m stops a raw fix of 8 m and more from
    // switching neighbours. The accuracy as margin (the shipped rule)
    // reduces the flicker at least twofold against every fixed margin,
    // within half a point of its wrong-station rate (review N2, N3: a
    // ratio to the rule, so no cell hinges on one value near a threshold).
    it("outdoor (raw fixes, honest accuracy): the rule flickers at most half as often as any fixed margin at 8-25 m, within half a point of its wrong-station rate", () => {
      computeAll();
      for (const a of [...OUTDOOR_ACCURACIES, ACCURACY_CEILING_M]) {
        for (const ratio of REPORTED_RATIOS) {
          summary(
            `outdoor acc ${String(a)} ratio ${String(ratio)}`,
            outdoor(a, ratio),
          );
        }
      }
      for (const a of [8, 12, 20, ACCURACY_CEILING_M]) {
        const rule = total(outdoor(a, 1), RULE);
        for (const m of FIXED_MARGINS) {
          const fixed = total(outdoor(a, 1), fixedKey(m));
          expect(flickerPerVisit(rule)).toBeLessThan(
            flickerPerVisit(fixed) / 2,
          );
          expect(wrongRate(rule)).toBeLessThan(wrongRate(fixed) + 0.005);
        }
      }
    });

    // Why this test matters (review S3): the rule reads the REPORTED
    // accuracy, and its factor 1 is right only while the report is honest.
    // Swept 0.5-2x on reports 0.5/1/2x the true error, at 8-25 m: honest,
    // 0.75x flickers more and 1.5x shows more wrong stations; a phone that
    // reports half its error wants 2x (a third less flicker or better,
    // within a point of the wrong rate); one that reports double wants
    // 0.5x (2 points fewer wrong stations). Above the ceiling the gate
    // judges nothing in.
    it("outdoor margin factor: 1x wins on an honest report; a report of half the error reverses it to 2x, one of double to 0.5x", () => {
      computeAll();
      for (const a of [8, 12, 20, ACCURACY_CEILING_M]) {
        const honest = (f: number) => total(outdoor(a, 1), ruleKey(f));
        expect(flickerPerVisit(honest(0.75))).toBeGreaterThan(
          flickerPerVisit(honest(1)),
        );
        expect(wrongRate(honest(1.5))).toBeGreaterThan(wrongRate(honest(1)));
        const optimistic = (f: number) => total(outdoor(a, 0.5), ruleKey(f));
        expect(flickerPerVisit(optimistic(2))).toBeLessThan(
          flickerPerVisit(optimistic(1)) * 0.67,
        );
        expect(wrongRate(optimistic(2))).toBeLessThan(
          wrongRate(optimistic(1)) + 0.01,
        );
      }
      for (const a of [8, 12]) {
        const pessimistic = (f: number) => total(outdoor(a, 2), ruleKey(f));
        expect(wrongRate(pessimistic(0.5))).toBeLessThan(
          wrongRate(pessimistic(1)) - 0.02,
        );
      }
      for (const a of [20, ACCURACY_CEILING_M]) {
        expect(missRate(total(outdoor(a, 2), RULE))).toBe(1);
      }
    });
  },
);
