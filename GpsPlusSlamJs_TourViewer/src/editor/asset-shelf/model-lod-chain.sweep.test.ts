/**
 * The level-of-detail chain's spacing and length, swept on the three
 * scanned models (opt-in, not a gate).
 *
 * Run with `LOD_CHAIN_SWEEP=1`, the rows going to `LOD_CHAIN_SWEEP_OUT`
 * (the runner keeps a test's console to itself):
 *   LOD_CHAIN_SWEEP=1 LOD_CHAIN_SWEEP_OUT=<file> pnpm run test:unit src/editor/asset-shelf/model-lod-chain.sweep.test.ts
 *
 * Why this exists: `LOD_CHAIN_RATIO` (4) and `LOD_CHAIN_LEVELS` (2) trade
 * the bytes a chain adds to the file against the triangles a renderer
 * draws when the model is small on screen. This sweep is the evidence for
 * the choice in model-lod.ts.md ("Choosing the chain") and re-runs it:
 * ratios 2, 3 and 4 against 1 to 4 levels, at the default level and at
 * share 1.
 *
 * WHAT IS MEASURED, per model, mode, ratio and level count:
 * - each level's triangles and error: level k of a chain is the author's
 *   level cut to `1 / ratio^k` of its triangles (the pass's own rule),
 *   found by the pass at that share, under 64 triangles or where the
 *   order allows no coarser level the chain stops;
 * - the file, as a share of the original: the made file's bytes without
 *   its coarser levels (`REST`, below) plus the coarser levels' 16-bit
 *   indices;
 * - the drawing cost: the triangles the renderer's `pickLevel` draws at
 *   each screen size of the box diagonal (25 to 800 px), at pixel budgets
 *   of 1 and 2, weighted by how often a size occurs (P^-2, P^-1, flat)
 *   and relative to halving with 4 levels; and the triangles drawn in the
 *   200 to 400 px band against halving with 4 levels.
 *
 * The one assertion is the verdict's premise: the chosen chain makes no
 * file larger than halving with 4 levels does.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pickLevel } from "../../glb-lod.js";
import { type GltfObject, readGlb } from "./glb-file.js";
import {
  LOD_CHAIN_LEVELS,
  LOD_CHAIN_RATIO,
  simplifyModel,
} from "./model-lod.js";
import { realModel } from "./test-support/glb-fixtures.js";

const RUN = process.env["LOD_CHAIN_SWEEP"] === "1";
const OUT = process.env["LOD_CHAIN_SWEEP_OUT"];

/** The made files, measured once by the optimizer in a browser (1 024 px
 *  textures, a chain of halving with 4 levels): the whole file's bytes
 *  and the chain view's (the author's level and its coarser levels, 16-bit
 *  indices), at the default level and at share 1, and the original's. A
 *  file without its coarser levels is the first less the second plus the
 *  author's level's own indices. */
const MADE = {
  rock: { original: 679492, def: [610780, 92256], one: [649976, 115440] },
  "coast-rock": {
    original: 1275096,
    def: [323940, 94710],
    one: [1120824, 553170],
  },
  boulder: { original: 1617364, def: [644516, 224496], one: [1415528, 667776] },
} as const;

const PIXELS = [25, 50, 100, 200, 400, 800] as const;
const WEIGHTS = {
  "P^-2": (px: number) => px ** -2,
  "P^-1": (px: number) => px ** -1,
  flat: () => 1,
} as const;
const RATIOS = [2, 3, 4] as const;
const MAX_LEVELS = 4;
const CHAIN_MIN_TRIANGLES = 64;

interface Level {
  readonly count: number;
  readonly error: number;
}

/** The author's level of `name` at `share` (the budget's when undefined):
 *  its triangles and error, and the model's triangles before. */
function authorOf(name: keyof typeof MADE, share?: number) {
  const read = readGlb(realModel(name));
  if (!read.ok) throw new Error(read.reason);
  const report = simplifyModel(read.parts, {
    lodBudget: 0.0025,
    lodMinTriangles: 2000,
    ...(share === undefined ? {} : { detailShare: share }),
  });
  const prim = (
    (read.parts.json["meshes"] as GltfObject[])[0]![
      "primitives"
    ] as GltfObject[]
  )[0]!;
  const lod = (prim["extras"] as GltfObject)["lod"] as { levels: Level[] };
  return { level: lod.levels[0]!, before: report.trianglesBefore };
}

const drawn = (levels: readonly Level[], px: number, budget: number) =>
  levels[
    pickLevel(
      levels.map((l) => ({ start: 0, ...l })),
      px,
      budget,
    )
  ]!.count / 3;

describe.runIf(RUN)(
  "level-of-detail chain sweep (opt-in, LOD_CHAIN_SWEEP=1)",
  () => {
    it("reports the file and the drawing cost of each chain", () => {
      const out = (line: string) =>
        OUT ? appendFileSync(OUT, line + "\n") : undefined;
      if (OUT) writeFileSync(OUT, "");
      for (const name of Object.keys(MADE) as (keyof typeof MADE)[]) {
        for (const mode of ["def", "one"] as const) {
          const author = authorOf(name, mode === "one" ? 1 : undefined);
          const top = author.level.count / 3;
          const cache = new Map<number, Level>();
          const levelAt = (target: number) => {
            let l = cache.get(target);
            if (l === undefined) {
              l = authorOf(name, target / author.before).level;
              cache.set(target, l);
            }
            return l;
          };
          const chainOf = (ratio: number, n: number) => {
            const levels: Level[] = [author.level];
            for (let k = 1; k <= n; k++) {
              const target = Math.floor(top / ratio ** k);
              if (target < CHAIN_MIN_TRIANGLES) break;
              const l = levelAt(target);
              if (l.count >= levels.at(-1)!.count) break;
              levels.push({
                count: l.count,
                error: Math.max(l.error, levels.at(-1)!.error),
              });
            }
            return levels;
          };
          const [bytes, chainView] = MADE[name][mode];
          const rest = bytes - chainView + author.level.count * 2;
          const fileOf = (levels: readonly Level[]) =>
            (rest + levels.slice(1).reduce((s, l) => s + l.count * 2, 0)) /
            MADE[name].original;
          const costOf = (
            levels: readonly Level[],
            budget: number,
            w: (px: number) => number,
          ) =>
            PIXELS.reduce((s, px) => s + w(px) * drawn(levels, px, budget), 0);
          const reference = chainOf(2, 4);
          const rows: { ratio: number; n: number; file: number }[] = [];
          out(
            `${name} ${mode}: author ${top} of ${author.before} triangles, no chain file ${fileOf([author.level]).toFixed(3)}`,
          );
          for (const ratio of RATIOS) {
            for (let n = 1; n <= MAX_LEVELS; n++) {
              const levels = chainOf(ratio, n);
              const file = fileOf(levels);
              rows.push({ ratio, n, file });
              const costs = [1, 2].flatMap((budget) =>
                Object.entries(WEIGHTS).map(
                  ([label, w]) =>
                    `${budget}px ${label} ${(costOf(levels, budget, w) / costOf(reference, budget, w)).toFixed(2)}`,
                ),
              );
              const band = [200, 400].map(
                (px) => `${drawn(levels, px, 1)} vs ${drawn(reference, px, 1)}`,
              );
              out(
                `  ratio ${ratio} levels ${n}: ${levels.map((l) => `${l.count / 3}@${l.error.toFixed(4)}`).join(" / ")}; file ${file.toFixed(3)}; drawn ${costs.join(", ")}; 200/400 px at 1px: ${band.join(", ")}`,
              );
            }
          }
          const chosen = rows.find(
            (r) => r.ratio === LOD_CHAIN_RATIO && r.n === LOD_CHAIN_LEVELS,
          )!;
          const halving = rows.find((r) => r.ratio === 2 && r.n === 4)!;
          expect(chosen.file).toBeLessThanOrEqual(halving.file);
        }
      }
    }, 3_600_000);
  },
);
