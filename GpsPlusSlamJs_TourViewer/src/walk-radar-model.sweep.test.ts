import { writeFileSync } from "node:fs";

import { nueBearingDeg } from "gps-plus-slam-app-framework/utils/nue-bearing";
import { describe, expect, it } from "vitest";

import {
  walkRadarAdaptiveRangeM,
  walkRadarModel,
  WALK_RADAR_RANGE_M,
  type WalkRadarBlip,
  type WalkRadarStation,
} from "./walk-radar-model";

/**
 * Why this sweep matters (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3 "sweep", §5 "Radar range", "Radar size"): W4 drew a 300 m range on a
 * square-root scale for one four-station tour. A range too short piles
 * every station on the rim; one too long crowds a museum's stations into
 * the centre. Overlapping blips hide the focus and the numbers, so the
 * range rule is chosen here, over generated tours, at every radar size in
 * the range, by the plan's criterion - not by the one picture W4 showed.
 *
 * - **Rules:** a fixed 150 / 300 / 600 m, and the adaptive range (the
 *   distance to the k-th nearest station still to find, k 3-6, times
 *   1.2-1.5, clamped 30-600 m).
 * - **Sizes:** 96-144 px (shipped 132 portrait, 108 landscape).
 * - **Tours:** a town walk (25-50 m between stations; 4, 12, 30 and 100
 *   stations, the 100 being the large tour) and a museum (3-6 m; 4, 12,
 *   30), each a random walk of stations (turns up to 60° in town, 120° in
 *   a museum), 8 seeds each, the visitor sampled at five points along
 *   every leg with the earlier stations found and the nearest unfound
 *   station the focus (any order: every unfound station drawn at full
 *   size, the crowded case).
 * - **Overlap:** two blips overlap when their centres are closer than
 *   the sum of their radii (a blip's diameter for two alike).
 * - **Pass (plan M3):** a rule passes a tour family when, in at least
 *   95 % of the sampled positions, the focus's blip overlaps no other
 *   blip, and at most 10 % of the visible unfound blips overlap any
 *   other. Judged per station count (every count of the family must
 *   pass), at the shipped sizes 132 and 108 px.
 * - **What ships:** the simplest passing rule (a fixed range before the
 *   adaptive one, and among fixed ranges W4's 300 m first); if none passes
 *   every family, the adaptive rule with the lowest overlap, its overlap
 *   named as a limit.
 *
 * The table goes to WALK_RADAR_SWEEP_OUT (a file path) when set; the
 * assertion pins the shipped rule's verdict, so a change to the radar's
 * geometry that breaks it fails here.
 */

const OUT = process.env["WALK_RADAR_SWEEP_OUT"];

/** A deterministic random source (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type P = readonly [north: number, east: number];

interface Family {
  readonly name: "town" | "museum";
  readonly spacing: readonly [number, number];
  readonly turnDeg: number;
  readonly counts: readonly number[];
}

const FAMILIES: readonly Family[] = [
  { name: "town", spacing: [25, 50], turnDeg: 60, counts: [4, 12, 30, 100] },
  { name: "museum", spacing: [3, 6], turnDeg: 120, counts: [4, 12, 30] },
];
const SEEDS = 8;
const SIZES = [96, 108, 120, 132, 144];
const SHIPPED_SIZES = [132, 108];

type Rule =
  | { readonly kind: "fixed"; readonly m: number }
  | { readonly kind: "adaptive"; readonly k: number; readonly factor: number };

const RULES: readonly Rule[] = [
  { kind: "fixed", m: 300 },
  { kind: "fixed", m: 150 },
  { kind: "fixed", m: 600 },
  ...[3, 4, 5, 6].flatMap((k) =>
    [1.2, 1.35, 1.5].map((factor): Rule => ({ kind: "adaptive", k, factor })),
  ),
];

function ruleName(rule: Rule): string {
  return rule.kind === "fixed"
    ? `fixed ${String(rule.m)} m`
    : `adaptive k${String(rule.k)} x${String(rule.factor)}`;
}

function tour(family: Family, count: number, seed: number): P[] {
  const rand = prng(seed * 7919 + count);
  const out: P[] = [[0, 0]];
  let dir = rand() * 2 * Math.PI;
  for (let i = 1; i < count; i += 1) {
    dir += ((rand() * 2 - 1) * family.turnDeg * Math.PI) / 180;
    const [lo, hi] = family.spacing;
    const step = lo + rand() * (hi - lo);
    const [n, e] = out[i - 1]!;
    out.push([n + Math.cos(dir) * step, e + Math.sin(dir) * step]);
  }
  return out;
}

/** One sampled position: every station's geometry from it, and states. */
interface Sample {
  readonly stations: WalkRadarStation[];
  readonly bearings: Map<string, number>;
  readonly distances: Map<string, number>;
  readonly unfoundDistances: number[];
}

function samples(points: readonly P[]): Sample[] {
  const out: Sample[] = [];
  for (let leg = 0; leg + 1 < points.length; leg += 1) {
    const [n0, e0] = points[leg]!;
    const [n1, e1] = points[leg + 1]!;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const at: P = [n0 + (n1 - n0) * t, e0 + (e1 - e0) * t];
      const bearings = new Map<string, number>();
      const distances = new Map<string, number>();
      let focus = -1;
      let focusD = Infinity;
      points.forEach(([n, e], i) => {
        const dn = n - at[0];
        const de = e - at[1];
        const d = Math.hypot(dn, de);
        distances.set(`s${String(i)}`, d);
        bearings.set(`s${String(i)}`, nueBearingDeg(dn, de) ?? 0);
        if (i > leg && d < focusD) {
          focusD = d;
          focus = i;
        }
      });
      const stations = points.map((_, i): WalkRadarStation => ({
        id: `s${String(i)}`,
        number: i + 1,
        state: i <= leg ? "found" : i === focus ? "next" : "left",
      }));
      const unfoundDistances = points
        .map((_, i) => i)
        .filter((i) => i > leg)
        .map((i) => distances.get(`s${String(i)}`)!);
      out.push({ stations, bearings, distances, unfoundDistances });
    }
  }
  return out;
}

/** One cell of the sweep: a rule at a size, and two informational knobs
 *  (what would reverse the verdict): the blips' scale and the adaptive
 *  range's floor. */
interface Variant {
  readonly rule: Rule;
  readonly sizePx: number;
  readonly blipScale: number;
  readonly floorM: number;
}

function variantName(v: Variant): string {
  const extra = [
    v.blipScale === 1 ? "" : ` blips x${String(v.blipScale)}`,
    v.floorM === 30 ? "" : ` floor ${String(v.floorM)} m`,
  ].join("");
  return `${ruleName(v.rule)} @${String(v.sizePx)}px${extra}`;
}

/** The range a variant shows at this sample, after the one it showed at
 *  the previous sample of the same walk (the adaptive rule's hysteresis). */
function rangeOf(v: Variant, sample: Sample, previousM: number | null): number {
  if (v.rule.kind === "fixed") return v.rule.m;
  return walkRadarAdaptiveRangeM(sample.unfoundDistances, previousM, {
    k: v.rule.k,
    factor: v.rule.factor,
    minM: v.floorM,
  });
}

/** Per position: whether the focus is clear, and how many unfound blips
 *  overlap another of how many. Two blips overlap when their centres are
 *  closer than the sum of their radii (times the variant's scale). A grid
 *  of 17 px cells (the two largest radii) keeps it linear. */
function judge(
  blips: readonly WalkRadarBlip[],
  scale: number,
): { focusClear: boolean | null; unfound: number; overlapping: number } {
  const cell = 17;
  const grid = new Map<number, WalkRadarBlip[]>();
  const key = (cx: number, cy: number): number => cx * 4096 + cy;
  for (const b of blips) {
    const k = key(Math.floor(b.x / cell), Math.floor(b.y / cell));
    const list = grid.get(k);
    if (list === undefined) grid.set(k, [b]);
    else list.push(b);
  }
  const touches = (b: WalkRadarBlip): boolean => {
    const cx = Math.floor(b.x / cell);
    const cy = Math.floor(b.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const o of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (
            o !== b &&
            Math.hypot(o.x - b.x, o.y - b.y) < (o.r + b.r) * scale
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };
  let focusClear: boolean | null = null;
  let unfound = 0;
  let overlapping = 0;
  for (const b of blips) {
    if (b.look === "focus") focusClear = !touches(b);
    if (b.look === "focus" || b.look === "left") {
      unfound += 1;
      if (touches(b)) overlapping += 1;
    }
  }
  return { focusClear, unfound, overlapping };
}

interface Cell {
  focusPositions: number;
  focusClear: number;
  unfound: number;
  overlapping: number;
}

const passes = (c: Cell): boolean =>
  c.focusClear >= 0.95 * c.focusPositions && c.overlapping <= 0.1 * c.unfound;

const pct = (a: number, b: number): string =>
  b === 0 ? "-" : `${((100 * a) / b).toFixed(1)}%`;

const TOURS = FAMILIES.flatMap((f) =>
  f.counts.map((count) => ({
    family: f,
    count,
    key: `${f.name}${String(count)}`,
  })),
);

const VARIANTS: readonly Variant[] = [
  ...RULES.flatMap((rule) =>
    SIZES.map((sizePx): Variant => ({
      rule,
      sizePx,
      blipScale: 1,
      floorM: 30,
    })),
  ),
  // What would reverse it: smaller blips, a lower floor for a museum.
  ...[0.5, 0.75].flatMap((blipScale) =>
    SHIPPED_SIZES.flatMap((sizePx) =>
      [RULES[0]!, RULES[3]!].map((rule): Variant => ({
        rule,
        sizePx,
        blipScale,
        floorM: 30,
      })),
    ),
  ),
  ...SHIPPED_SIZES.map((sizePx): Variant => ({
    rule: RULES[3]!,
    sizePx,
    blipScale: 1,
    floorM: 10,
  })),
];

describe("walk radar range sweep - overlapping blips over generated tours", () => {
  it("reports every rule at every size and ships the simplest rule that passes, else the adaptive one with the least overlap", () => {
    const results = new Map<string, Map<string, Cell>>();
    for (const v of VARIANTS) results.set(variantName(v), new Map());
    for (const t of TOURS) {
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const shown = new Map<Variant, number>();
        for (const sample of samples(tour(t.family, t.count, seed))) {
          const live = {
            bearings: sample.bearings,
            distances: sample.distances,
            headingDeg: 0,
          };
          for (const v of VARIANTS) {
            const m = walkRadarModel({
              stations: sample.stations,
              order: "any",
              kind: "gps",
              accuracyM: 5,
              live,
              snapshot: null,
              fovDeg: 64,
              sizePx: v.sizePx,
              rangeM: rangeOf(v, sample, shown.get(v) ?? null),
            });
            shown.set(v, m.rangeM);
            const j = judge(m.blips, v.blipScale);
            const byTour = results.get(variantName(v))!;
            const c = byTour.get(t.key) ?? {
              focusPositions: 0,
              focusClear: 0,
              unfound: 0,
              overlapping: 0,
            };
            byTour.set(t.key, c);
            if (j.focusClear !== null) {
              c.focusPositions += 1;
              if (j.focusClear) c.focusClear += 1;
            }
            c.unfound += j.unfound;
            c.overlapping += j.overlapping;
          }
        }
      }
    }
    const cell = (v: Variant, key: string): Cell =>
      results.get(variantName(v))!.get(key)!;
    const shippedOf = (rule: Rule): Variant[] =>
      SHIPPED_SIZES.map((sizePx) => ({
        rule,
        sizePx,
        blipScale: 1,
        floorM: 30,
      }));
    const passesAll = (rule: Rule): boolean =>
      shippedOf(rule).every((v) => TOURS.every((t) => passes(cell(v, t.key))));
    /** What a rule leaves overlapping at the shipped sizes, each tour
     *  weighing the same (a pooled share would be the 100-station tour's
     *  alone): the mean of the share of positions whose focus overlaps
     *  and the share of unfound blips overlapping. */
    const overlapOf = (
      rule: Rule,
    ): { focus: number; unfound: number; score: number } => {
      let focus = 0;
      let unfound = 0;
      let n = 0;
      for (const v of shippedOf(rule)) {
        for (const t of TOURS) {
          const c = cell(v, t.key);
          focus += 1 - c.focusClear / c.focusPositions;
          unfound += c.overlapping / c.unfound;
          n += 1;
        }
      }
      return {
        focus: focus / n,
        unfound: unfound / n,
        score: (focus + unfound) / (2 * n),
      };
    };

    const lines = [
      "walk radar range sweep: focus clear / unfound overlapping per tour (a ! fails)",
      ...VARIANTS.map((v) => {
        const cells = TOURS.map((t) => {
          const c = cell(v, t.key);
          return `${t.key} ${pct(c.focusClear, c.focusPositions)}/${pct(c.overlapping, c.unfound)}${passes(c) ? "" : "!"}`;
        });
        return `${variantName(v)}: ${cells.join("  ")}`;
      }),
    ];
    const passing = RULES.find(passesAll);
    const adaptive = RULES.filter((r) => r.kind === "adaptive");
    const best = [...adaptive].sort(
      (a, b) => overlapOf(a).score - overlapOf(b).score,
    )[0]!;
    lines.push(
      ...RULES.map((r) => {
        const o = overlapOf(r);
        return `at 132 and 108 px, each tour alike: ${ruleName(r)} focus overlapped ${(100 * o.focus).toFixed(1)}%, unfound overlapping ${(100 * o.unfound).toFixed(1)}%`;
      }),
      passing === undefined
        ? `ships: none passes every family; the adaptive rule with the least overlap is ${ruleName(best)}`
        : `ships: ${ruleName(passing)}`,
    );
    if (OUT !== undefined) writeFileSync(OUT, `${lines.join("\n")}\n`);

    // The verdict the radar ships (see the sidecar): no rule passes, so
    // the adaptive rule with the least overlap, a named limit.
    expect(passing).toBeUndefined();
    expect(ruleName(best)).toBe("adaptive k3 x1.2");
    expect(WALK_RADAR_RANGE_M).toBe(300);
  }, 300_000);
});
