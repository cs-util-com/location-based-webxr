/**
 * The `H` variants — models the owner asked to be COMBINED from two sources.
 *
 * Every other source letter names a downloaded prototype. This one does not:
 * it is the small set of models where the verdict was not "this file's version"
 * but "this file's version, with one part from another".
 *
 * **One entry so far.** On `leisure=park`: _"Bei dem Park ist die Variante D am
 * besten. Am besten die Variante D mit dem, mit der Bank von Variante P."_ —
 * D's grass, path and trees, with P's bench instead of D's.
 *
 * WHY IT IS A VARIANT RATHER THAN AN EDIT TO `D`. The gallery's job is to
 * compare, and it can only do that if each row is honestly what it claims: if D's
 * park quietly gained P's bench, the D row would no longer be D and the next
 * verdict would be cast on a model nobody had judged. The hybrid stands as its
 * own row, and D's stays exactly as the owner saw it.
 *
 * @see poi-variants-hybrid.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import { composed } from "./poi-primitives.js";
import { parkGroundD } from "./poi-variants-d.js";
import { benchP } from "./poi-variants-p.js";

/**
 * How far P's bench is shrunk to belong in D's park.
 *
 * **NOT A TASTE DECISION — the two sources are at different scales.** D's park
 * is a 0.8 m plate carrying a bench 0.26 m long; P's bench is 0.78 m long, which
 * dropped in raw would span the entire plate. The registry then scales the park
 * to the shipped 4.56 m, a factor of about 6.4, so a raw P bench would come out
 * five metres wide. At 0.34 the seat lands at roughly 1.8 m in the world, which
 * is a bench.
 */
const BENCH_SCALE = 0.34;

/** Where D's grass plate tops out, and so where anything standing on it sits. */
const GRASS_TOP = 0.05;

/** Every hybrid model, keyed by kind. Built at D's scale; the registry rescales. */
export const H_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "leisure=park",
    (): MeshData =>
      composed((b: MeshBuilder) => {
        parkGroundD(b);
        // Placed where D's own bench stood, just clear of the smaller tree's
        // canopy at x = 0.02.
        benchP(b, GRASS_TOP, -0.26, 0.28, BENCH_SCALE);
      }),
  ],
]);
