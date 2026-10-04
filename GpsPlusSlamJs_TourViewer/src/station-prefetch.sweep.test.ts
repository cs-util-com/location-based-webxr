/**
 * The sweeps behind `PREFETCH_LEAD_M`, the next-in-order prefetch and
 * `MAX_DECODE_SIDE_PX` (`station-prefetch.ts`; tour kit plan K4 "prefetch on
 * approach", K4 review R5 and R17).
 *
 * WHAT IS SIMULATED. The real `createStationPrefetch`, driven on a virtual
 * clock (1 s steps, the GPS fix rate): a visitor walks at a constant speed, the guide's
 * calls (`approach` every step, `ahead` while the current story plays) are
 * made as the page makes them, and each read takes `1 s + bytes x 8 /
 * bandwidth`, one at a time (the module reads one entry at a time). A story
 * is three assets (a figure, a voice clip, a picture) of equal size, and it
 * is READY when all three are held when the visitor reaches the found
 * radius. "MB ready" is the largest such story, to 0.25 MB.
 *
 * Two walks:
 * - APPROACH: from beyond the prefetch radius straight to a station (the
 *   first station, or the next after a skip). Swept: the lead 20-100 m,
 *   speed 0.8 / 1.4 / 1.8 m/s, 1 / 5 / 20 Mbit/s, the tightest station the
 *   bands allow at 3 m accuracy (activation 6 m, found 3 m) and a typical
 *   one (activation 30 m, found 5 m).
 * - CASTLE (R5): the visitor has found station k, its story plays for
 *   0 / 30 / 60 / 120 s, then they walk 30 m or 60 m to station k+1 (found
 *   radius 5 m) under a fixed order. With the K4 build only the offer of k+1
 *   (after k's story) started its prefetch; now the run names k+1 as soon
 *   as k is found, and the guide asks for it `ahead`.
 *
 * VERDICTS (asserted; full tables with `STATION_PREFETCH_SWEEP_OUT=<file>`):
 * - APPROACH at the 80 m lead: at least 5 MB ready in every cell at
 *   1 Mbit/s and 25 MB at 5 Mbit/s (the worst cell: the tightest station
 *   at 1.8 m/s). What reverses 80 m: 60 m leaves 3.75 MB in that cell, 40 m
 *   2 MB.
 * - CASTLE at 30 m spacing, 1 Mbit/s: the K4 build had 1-3 MB ready
 *   (1.75 MB at 1.4 m/s) whatever the story's length - the next station is
 *   offered 30 m away, inside any lead - so the K4 sidecar's "5 MB ready"
 *   did not hold there (the review's "about 2 MB"). Reading ahead adds
 *   the current story's playing time: 4.5-6.75 MB after a 30 s story,
 *   8-10.25 MB after 60 s, 15.25-17.5 MB after 120 s; at 5 Mbit/s 23 MB
 *   and more after 30 s. A story of 0 s gains nothing (only the walk
 *   counts), and reading ahead is never worse than the K4 build.
 * - MONOTONE (R17: the K4 test re-checked an inequality against itself):
 *   through the module, a longer lead never leaves a story less ready.
 *
 * Not simulated: a link slower than 1 Mbit/s, contention with the tour's
 * other reads, and the byte budget (64 MiB, above every story here).
 */

import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import {
  createStationPrefetch,
  MAX_DECODE_SIDE_PX,
  PREFETCH_LEAD_M,
} from "./station-prefetch";

const LEADS = [20, 40, 60, 80, 100];
const SPEEDS = [0.8, 1.4, 1.8];
const MBITS = [1, 5, 20];
const STORY_S = [0, 30, 60, 120];
const SPACINGS = [30, 60];
const LATENCY_S = 1;
const DT_S = 1;
const MB = 1024 * 1024;
/** [activateM, foundM]: the tightest bands at 3 m accuracy, and a typical station. */
const GEOMETRIES: readonly (readonly [number, number])[] = [
  [6, 3],
  [30, 5],
];
const OUT = process.env["STATION_PREFETCH_SWEEP_OUT"];
const table: string[] = [];

/** A station whose story reads three assets, `prefix`-named. */
function stationOf(
  id: string,
  prefix: string,
  activateRadiusM: number,
  foundRadiusM: number,
): TourStation {
  return {
    id,
    anchor: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
    activateRadiusM,
    foundRadiusM,
    hint: "arrow",
    steps: ["figure", "voice", "picture"].map((kind, i) => ({
      id: `s${String(i)}`,
      block: { kind: "image", asset: `${prefix}-${kind}` },
      advance: { mode: "tap" },
    })),
  };
}

/** A virtual network and clock around one real prefetch. */
function rig(opts: { leadM: number; mbit: number; storyMb: number }) {
  let t = 0;
  const bytes = Math.round((opts.storyMb * MB) / 3);
  const assets = new Map<string, TourAsset>();
  for (const prefix of ["k", "n"]) {
    for (const kind of ["figure", "voice", "picture"]) {
      const id = `${prefix}-${kind}`;
      assets.set(id, { id, path: `content/${id}.png`, kind: "image" });
    }
  }
  const pending: { at: number; path: string; resolve: (b: Blob) => void }[] =
    [];
  const landed = new Set<string>();
  const prefetch = createStationPrefetch({
    assets: () => assets,
    tour: () => "tour",
    leadM: opts.leadM,
    budgetBytes: 1024 * MB,
    read: (path) =>
      new Promise((resolve) => {
        pending.push({
          at: t + LATENCY_S + (bytes * 8) / (opts.mbit * 1_000_000),
          path,
          resolve,
        });
      }),
  });
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  /** Advance the clock one step, landing every read due by then. */
  const step = async () => {
    t += DT_S;
    for (;;) {
      const due = pending.findIndex((p) => p.at <= t);
      if (due < 0) break;
      const [p] = pending.splice(due, 1);
      p!.resolve(new Blob([new Uint8Array(bytes)]));
      landed.add(p!.path);
      await settle();
    }
  };
  const ready = (prefix: string) =>
    ["figure", "voice", "picture"].every((k) =>
      landed.has(`content/${prefix}-${k}.png`),
    );
  return { prefetch, step, settle, ready };
}

/** APPROACH: whether a story of `storyMb` is ready on arrival. */
async function approachReady(
  leadM: number,
  speed: number,
  mbit: number,
  [activateM, foundM]: readonly [number, number],
  storyMb: number,
): Promise<boolean> {
  const r = rig({ leadM, mbit, storyMb });
  const target = stationOf("k", "k", activateM, foundM);
  let d = activateM + leadM + 2 * speed;
  while (d > foundM) {
    r.prefetch.approach(target, d, activateM);
    await r.settle();
    await r.step();
    d -= speed * DT_S;
  }
  return r.ready("k");
}

/** CASTLE: whether station k+1's story of `storyMb` is ready on arrival,
 *  after k's story played `storyS` seconds, with or without reading ahead. */
async function castleReady(
  ahead: boolean,
  storyS: number,
  spacingM: number,
  speed: number,
  mbit: number,
  storyMb: number,
): Promise<boolean> {
  const r = rig({ leadM: PREFETCH_LEAD_M, mbit, storyMb });
  const next = stationOf("n", "n", 30, 5);
  // k's story plays: the guide names k+1 every render.
  for (let s = 0; s < storyS; s += DT_S) {
    if (ahead) r.prefetch.ahead(next);
    await r.settle();
    await r.step();
  }
  // k is done; k+1 is offered, `spacingM` away, and approached.
  let d = spacingM;
  while (d > 5) {
    r.prefetch.approach(next, d, 30);
    await r.settle();
    await r.step();
    d -= speed * DT_S;
  }
  return r.ready("n");
}

/** The largest story (MB, to 0.25) for which `isReady` holds, up to 40. */
async function mbReady(
  isReady: (mb: number) => Promise<boolean>,
): Promise<number> {
  if (!(await isReady(0.25))) return 0;
  let lo = 1; // quarters of a MB
  let hi = 161;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (await isReady(mid / 4)) lo = mid;
    else hi = mid;
  }
  return lo / 4;
}

// About 8 s alone; the simulation runs the real module on a virtual clock.
describe("prefetch sweeps (K4, review R5 and R17)", { timeout: 60_000 }, () => {
  afterAll(() => {
    if (OUT !== undefined) writeFileSync(OUT, table.join("\n") + "\n");
  });

  it("APPROACH: the table, and a longer lead never makes a story less ready (through the module)", async () => {
    const byLead = new Map<number, number[]>();
    for (const lead of LEADS) {
      const cells: number[] = [];
      for (const speed of SPEEDS) {
        for (const mbit of MBITS) {
          for (const geometry of GEOMETRIES) {
            const mb = await mbReady((s) =>
              approachReady(lead, speed, mbit, geometry, s),
            );
            cells.push(mb);
            table.push(
              `approach lead ${lead} m, ${speed} m/s, ${mbit} Mbit/s, activate ${geometry[0]} found ${geometry[1]}: ${mb} MB ready`,
            );
          }
        }
      }
      byLead.set(lead, cells);
    }
    // The shipped lead (the cells of 80 m, all speeds and geometries).
    const at80 = byLead.get(PREFETCH_LEAD_M)!;
    const cellsAt = (mbit: number, cells: number[]) =>
      cells.filter((_, k) => MBITS[Math.floor(k / 2) % 3] === mbit);
    expect(Math.min(...cellsAt(1, at80))).toBeGreaterThanOrEqual(4.75);
    expect(Math.min(...cellsAt(5, at80))).toBeGreaterThanOrEqual(24);
    // What reverses it: shorter leads in the worst cell.
    expect(Math.min(...cellsAt(1, byLead.get(60)!))).toBeLessThan(4.5);
    expect(Math.min(...cellsAt(1, byLead.get(40)!))).toBeLessThan(3);
    for (let i = 1; i < LEADS.length; i += 1) {
      const shorter = byLead.get(LEADS[i - 1]!)!;
      const longer = byLead.get(LEADS[i]!)!;
      longer.forEach((mb, k) => {
        expect(mb).toBeGreaterThanOrEqual(shorter[k]!);
      });
    }
  });

  it("CASTLE (R5): the table, and reading ahead is never worse than the K4 build", async () => {
    for (const spacing of SPACINGS) {
      for (const storyS of STORY_S) {
        for (const speed of SPEEDS) {
          for (const mbit of MBITS) {
            const before = await mbReady((s) =>
              castleReady(false, storyS, spacing, speed, mbit, s),
            );
            const after = await mbReady((s) =>
              castleReady(true, storyS, spacing, speed, mbit, s),
            );
            table.push(
              `castle ${spacing} m, story ${storyS} s, ${speed} m/s, ${mbit} Mbit/s: K4 ${before} MB, ahead ${after} MB`,
            );
            expect(after).toBeGreaterThanOrEqual(before);
          }
        }
      }
    }
    // The review's case: 30 m, 1.4 m/s, 1 Mbit/s.
    const k4 = await mbReady((s) => castleReady(false, 60, 30, 1.4, 1, s));
    expect(k4).toBeLessThanOrEqual(2.5);
    const ahead30 = await mbReady((s) => castleReady(true, 30, 30, 1.4, 1, s));
    expect(ahead30).toBeGreaterThanOrEqual(4.5);
    const ahead60 = await mbReady((s) => castleReady(true, 60, 30, 1.4, 1, s));
    expect(ahead60).toBeGreaterThanOrEqual(8);
  });
});

/** Screen pixels a 1.7 m figure covers at distance d (60 degree vertical
 *  view, a 2400 px tall screen). */
function figurePx(d: number): number {
  return ((2 * Math.atan(0.85 / d)) / (Math.PI / 3)) * 2400;
}

describe("decode cap sweep (K4)", () => {
  it("2048 px covers what a phone shows of a figure from 2 m on; 1024 would not closer than about 3.7 m", () => {
    for (const d of [2, 3, 5, 10])
      expect(figurePx(d)).toBeLessThanOrEqual(MAX_DECODE_SIDE_PX);
    expect(figurePx(1.5)).toBeGreaterThan(MAX_DECODE_SIDE_PX);
    expect(figurePx(3.6)).toBeGreaterThan(1024);
    expect(figurePx(3.8)).toBeLessThan(1024);
  });
});
