/**
 * The sweep behind `station-presence.ts`'s takeover margin (visitor plan
 * 2026-10-18-2349 M1, §8; cold review HIGH-3). A visitor walks a row of five
 * stations, stops at each, and walks on; the presence rule runs on every
 * judged position. Per cell it reports:
 * - **wrong**: the share of steps, while the TRUE position is inside some
 *   station's found radius, on which a DIFFERENT station is present (the
 *   wrong exhibit's content; truth is the nearest station whose circle
 *   holds the true position, so a previous exhibit kept while the visitor
 *   already stands nearer the next counts as wrong);
 * - **miss**: the share of those steps on which nothing is present;
 * - **extra switches**: changes of the present station per station
 *   visited, minus the true sequence's own changes: above 0 is flicker.
 *
 * WHAT IS SIMULATED.
 * - **Museum** (a code scanned, so production's band is the HUD's 1.5 m,
 *   swept 0.5-3 m): spacing 3/4/5/6 m, radius 1/1.5/2/2.5/3 m - tangent
 *   (spacing = 2R) and overlapping (spacing < 2R) circles included - and
 *   AR drift 0/0.5/1/1.5/2 m (a constant offset per walk, its direction
 *   random: the plan's "about a metre over a few dozen metres"), plus 5 cm
 *   white jitter of the AR position (swept separately 0.05/0.25/0.5 m at
 *   the production band). The visitor dwells 12 s at a random spot within
 *   half the radius of each centre, swaying 10 cm, and walks 0.8 m/s
 *   between. 4 Hz.
 * - **Outdoor** (no code, so production's band is the raw accuracy): R 25 m
 *   at spacing 25/30/40/50 m, accuracy 3/5/8/12/20 m under the `raw`
 *   Gauss-Markov model of `station-bands.sweep.test.ts` (wander 0.6, white
 *   0.3, 20 s), accuracy factor 0.5/1/2 for the band (1 in production).
 *   60 s dwells within 5 m of each centre, 1.4 m/s, 1 Hz.
 * - The margin `m` 0/0.5/1/1.5/2/3 m in both, and the shipped rule
 *   (`takeoverMarginM`: the judged accuracy, at least 1 m; 1 m for a
 *   code's position, the raw accuracy outdoors).
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

import { HUD_ARRIVAL_BAND_M } from "./station-bands";
import {
  nextPresentStation,
  takeoverMarginM,
  TAKEOVER_MARGIN_MIN_M,
  type PresenceCandidate,
} from "./station-presence";

type P = readonly [number, number];

const OUT = process.env["STATION_PRESENCE_SWEEP_OUT"];
const table: string[] = [];

const FIXED_MARGINS = [0, 0.5, 1, 1.5, 2, 3] as const;
type MarginKey = (typeof FIXED_MARGINS)[number] | "rule";
const MARGIN_KEYS: readonly MarginKey[] = [...FIXED_MARGINS, "rule"];

const STATIONS = 5;

interface Metrics {
  /** Steps with a true station. */
  inside: number;
  wrong: number;
  miss: number;
  switches: number;
  ideal: number;
  visits: number;
}

function emptyMetrics(): Metrics {
  return { inside: 0, wrong: 0, miss: 0, switches: 0, ideal: 0, visits: 0 };
}

function add(a: Metrics, b: Metrics): void {
  a.inside += b.inside;
  a.wrong += b.wrong;
  a.miss += b.miss;
  a.switches += b.switches;
  a.ideal += b.ideal;
  a.visits += b.visits;
}

function wrongRate(m: Metrics): number {
  return m.inside === 0 ? 0 : m.wrong / m.inside;
}

function extraSwitches(m: Metrics): number {
  return (m.switches - m.ideal) / m.visits;
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

/** Run the rule along one walk: true and observed positions per step. */
function runWalk(
  stations: readonly P[],
  truth: readonly P[],
  observed: readonly P[],
  foundR: number,
  bandM: number,
  marginM: number,
): Metrics {
  const out = emptyMetrics();
  out.visits = stations.length;
  let present: string | null = null;
  let lastTrue: number | null = null;
  for (let i = 0; i < truth.length; i += 1) {
    const o = observed[i]!;
    const candidates: PresenceCandidate[] = stations.map((s, k) => ({
      id: String(k),
      distanceM: Math.hypot(s[0] - o[0], s[1] - o[1]),
      foundM: foundR,
      foundExitM: foundR + bandM,
    }));
    const next = nextPresentStation(present, candidates, marginM);
    if (next !== present) out.switches += 1;
    present = next;
    const t = trueStation(stations, truth[i]!, foundR);
    if (t !== lastTrue) out.ideal += 1;
    lastTrue = t;
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

const MUSEUM_SPACINGS = [3, 4, 5, 6];
const MUSEUM_RADII = [1, 1.5, 2, 2.5, 3];
const MUSEUM_DRIFTS = [0, 0.5, 1, 1.5, 2];
const MUSEUM_BANDS = [0.5, 1, 1.5, 2, 3];
const MUSEUM_JITTERS = [0.05, 0.25, 0.5];
const MUSEUM_SEEDS = 10;
const MUSEUM_HZ = 4;

/** One museum cell, every margin, the same walks for each margin. A code
 *  lined the position up, so the rule's margin is its floor. */
function museumCell(
  spacing: number,
  radius: number,
  drift: number,
  band: number,
  jitter: number,
): Cell {
  const stations = row(spacing);
  const out = emptyCell();
  for (let seed = 0; seed < MUSEUM_SEEDS; seed += 1) {
    const rng = mulberry32(
      seed * 7919 + Math.round(spacing * 131 + radius * 17 + drift * 7),
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
    for (const key of MARGIN_KEYS) {
      const m = key === "rule" ? takeoverMarginM(null) : key;
      add(out.get(key)!, runWalk(stations, truth, observed, radius, band, m));
    }
  }
  return out;
}

const OUTDOOR_R = 25;
const OUTDOOR_SPACINGS = [25, 30, 40, 50];
const OUTDOOR_ACCURACIES = [3, 5, 8, 12, 20];
const OUTDOOR_FACTORS = [0.5, 1, 2];
const OUTDOOR_SEEDS = 24;
const RAW = { wanderFrac: 0.6, whiteFrac: 0.3, tauS: 20 } as const;

/** One outdoor cell: no code, the raw accuracy judges (the rule's margin
 *  is that accuracy). */
function outdoorCell(spacing: number, accuracy: number, factor: number): Cell {
  const stations = row(spacing);
  const band = Math.max(factor * accuracy, HUD_ARRIVAL_BAND_M);
  const out = emptyCell();
  for (let seed = 0; seed < OUTDOOR_SEEDS; seed += 1) {
    const rng = mulberry32(seed * 104729 + spacing * 31 + accuracy);
    const truth = walkPath(
      stations,
      spacing,
      { s: 60, spotM: 5, swayM: 0.3 },
      1.4,
      1,
      rng,
    );
    const errors = gaussMarkovGpsErrors(rng, truth.length, accuracy, RAW);
    const observed = truth.map((p, i): P => [
      p[0] + errors[i]![0],
      p[1] + errors[i]![1],
    ]);
    for (const key of MARGIN_KEYS) {
      const m = key === "rule" ? takeoverMarginM(accuracy) : key;
      add(
        out.get(key)!,
        runWalk(stations, truth, observed, OUTDOOR_R, band, m),
      );
    }
  }
  return out;
}

function line(label: string, key: MarginKey, m: Metrics): string {
  return `${label} m ${String(key)}: wrong ${pct(wrongRate(m))}, miss ${pct(m.inside === 0 ? 0 : m.miss / m.inside)}, extra switches/visit ${extraSwitches(m).toFixed(2)}`;
}

/** Results by cell label, computed once for every test below. */
interface Row {
  readonly kind: "museum" | "jitter" | "outdoor";
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
    for (const key of MARGIN_KEYS)
      table.push(line(label, key, r.cell.get(key)!));
  };
  for (const spacing of MUSEUM_SPACINGS) {
    for (const radius of MUSEUM_RADII) {
      const geo = geometry(spacing, radius);
      for (const drift of MUSEUM_DRIFTS) {
        for (const band of MUSEUM_BANDS) {
          push({
            kind: "museum",
            geometry: geo,
            params: { spacing, radius, drift, band },
            cell: museumCell(spacing, radius, drift, band, 0.05),
          });
        }
      }
      for (const drift of [0, 1, 2]) {
        for (const jitter of MUSEUM_JITTERS) {
          push({
            kind: "jitter",
            geometry: geo,
            params: { spacing, radius, drift, jitter },
            cell: museumCell(
              spacing,
              radius,
              drift,
              HUD_ARRIVAL_BAND_M,
              jitter,
            ),
          });
        }
      }
    }
  }
  for (const spacing of OUTDOOR_SPACINGS) {
    for (const accuracy of OUTDOOR_ACCURACIES) {
      for (const factor of OUTDOOR_FACTORS) {
        push({
          kind: "outdoor",
          geometry: geometry(spacing, OUTDOOR_R),
          params: { spacing, accuracy, factor },
          cell: outdoorCell(spacing, accuracy, factor),
        });
      }
    }
  }
}

/** A margin's metrics summed over the rows a filter keeps. */
function total(keep: (r: Row) => boolean, key: MarginKey): Metrics {
  const out = emptyMetrics();
  for (const r of rows) if (keep(r)) add(out, r.cell.get(key)!);
  return out;
}

describe(
  "station presence sweep (the takeover margin)",
  { timeout: 120_000 },
  () => {
    afterAll(() => {
      if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
    });

    // Why this test matters: it is the evidence for the shipped floor. A
    // code's AR position wanders little, so indoors a small margin already
    // stops the flicker where circles overlap, and every larger margin
    // keeps the previous exhibit longer (the wrong-station rate grows with
    // m). The floor is 1 m, not the 0.5 m that wins at 5 cm of jitter, for
    // the jitter test below.
    it("museum (a code): 0 flickers where circles overlap; the 1 m floor stops it, within 2 points of 0.5 m's wrong-station rate and below every larger margin's", () => {
      computeAll();
      const overlap = (r: Row) => r.kind === "museum" && r.geometry !== "apart";
      const at0 = total(overlap, 0);
      const rule = total(overlap, "rule");
      for (const key of MARGIN_KEYS) {
        table.push(
          line("SUMMARY museum overlap+tangent", key, total(overlap, key)),
        );
      }
      expect(TAKEOVER_MARGIN_MIN_M).toBe(1);
      expect(extraSwitches(at0)).toBeGreaterThan(0.2);
      expect(extraSwitches(rule)).toBeLessThanOrEqual(0);
      // The cell where 0.5 m wins, by how much: under 2 points.
      const half = total(overlap, 0.5);
      expect(wrongRate(half)).toBeLessThan(wrongRate(rule));
      expect(wrongRate(rule) - wrongRate(half)).toBeLessThan(0.02);
      for (const m of [1.5, 2, 3] as const) {
        expect(wrongRate(rule)).toBeLessThan(wrongRate(total(overlap, m)));
      }
    });

    // Why this test matters: the aligned position's jitter is the parameter
    // that reverses the indoor verdict, and no field figure exists for it
    // (the alignment re-solves on every fix). 0.5 m flickers from 0.25 m
    // of jitter; the 1 m floor holds to 0.25 m and flickers at 0.5 m,
    // where 1.5 m would win.
    it("museum jitter: the 1 m floor holds to 0.25 m of AR jitter, 0.5 m does not; at 0.5 m of jitter 1.5 m would win", () => {
      computeAll();
      const jitter = (j: number) => (r: Row) =>
        r.kind === "jitter" &&
        r.geometry !== "apart" &&
        r.params["jitter"] === j;
      for (const j of MUSEUM_JITTERS) {
        for (const key of MARGIN_KEYS) {
          table.push(
            line(
              `SUMMARY jitter ${String(j)} overlap+tangent`,
              key,
              total(jitter(j), key),
            ),
          );
        }
      }
      expect(extraSwitches(total(jitter(0.05), "rule"))).toBeLessThanOrEqual(0);
      expect(extraSwitches(total(jitter(0.25), "rule"))).toBeLessThanOrEqual(0);
      expect(extraSwitches(total(jitter(0.25), 0.5))).toBeGreaterThan(0.05);
      expect(extraSwitches(total(jitter(0.5), "rule"))).toBeGreaterThan(0.2);
      expect(extraSwitches(total(jitter(0.5), 1.5))).toBeLessThan(
        extraSwitches(total(jitter(0.5), "rule")),
      );
    });

    // Why this test matters: outdoors the position's noise is metres, and
    // no fixed margin in 0-3 m stops a raw fix of 8 m and more from
    // switching neighbours several times per visit. One band (the
    // accuracy, the shipped rule) does, at a wrong-station rate no worse.
    it("outdoor (raw fixes): every fixed margin flickers at 8-20 m accuracy; the accuracy as margin stops it at no worse wrong-station rate", () => {
      computeAll();
      for (const acc of OUTDOOR_ACCURACIES) {
        const keep = (r: Row) =>
          r.kind === "outdoor" &&
          r.params["accuracy"] === acc &&
          r.params["factor"] === 1;
        for (const key of MARGIN_KEYS) {
          table.push(
            line(
              `SUMMARY outdoor acc ${String(acc)} factor 1`,
              key,
              total(keep, key),
            ),
          );
        }
        const rule = total(keep, "rule");
        expect(extraSwitches(rule)).toBeLessThan(acc >= 20 ? 1.5 : 0.3);
      }
      // At 8 m and worse, against every fixed margin: the fixed one
      // flickers, the rule does less, at no worse a wrong-station rate
      // (half a point).
      for (const acc of OUTDOOR_ACCURACIES.filter((a) => a >= 8)) {
        const keep = (r: Row) =>
          r.kind === "outdoor" &&
          r.params["accuracy"] === acc &&
          r.params["factor"] === 1;
        const rule = total(keep, "rule");
        const beaten = FIXED_MARGINS.filter((m) => {
          const fixed = total(keep, m);
          return (
            extraSwitches(fixed) > 0.5 &&
            extraSwitches(rule) < extraSwitches(fixed) &&
            wrongRate(rule) <= wrongRate(fixed) + 0.005
          );
        });
        expect(beaten).toEqual([...FIXED_MARGINS]);
      }
    });
  },
);
