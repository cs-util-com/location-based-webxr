/**
 * The `P` variants — ported from `procedural-poi-marker-gallery(1)`
 * (DEC-R6-30…33).
 *
 * Four of the owner's 51 liked pairs come from this file. Its own header calls
 * it "civic maquettes — literal miniature payloads on one shared display
 * plinth", and every kind is fitted to the same 1.46 × 1.10 × 2.65 m envelope
 * with no real-world scale, so DEC-V5's rescale applies as it does to `D`.
 *
 * WHAT HAS TO BE UNDONE, and each is a place a port goes wrong silently:
 *
 * 1. **The plinth, and the `T = 0.18` its top sits at.** P's parts are placed in
 *    ABSOLUTE coordinates that include the plinth, so every `y` loses `T`.
 *    Its own sub-assemblies round that to `+.20` — `headstone` and `treeParts`
 *    both build from `.20` — a 2 cm embed that `groundedMesh` absorbs.
 * 2. **Centre-`y` to base-`y`**, three's `BoxGeometry`/`CylinderGeometry` being
 *    centred where our `box`/`prism` take a base.
 * 3. **Top-radius-first cylinders**, as in `D` and unlike `B`. `cylP` swaps them
 *    once so a port reads straight off the source. A cup that tapers the wrong
 *    way is still a cup, which is why no assertion catches this one.
 *
 * **Rotations transfer unchanged.** P composes `T · R · S` about each part's own
 * centre, which is what `pushTransform`'s offset-plus-rotation does, and its `rz`
 * turns +x toward +y exactly as ours does. All four kinds here use `rz` only.
 *
 * @see poi-variants-p.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import { box, composed, sphere } from "./poi-primitives.js";

/**
 * P's palette, under the source's own names, restricted to what these four
 * models paint with. Byte-identical to `D`'s where they overlap — the two files
 * share one palette — and pinned against it in `poi-variants.test.ts`.
 */
const P = {
  stoneLight: 0x8894a0,
  wallCream: 0xe8dcc8,
  wallSage: 0x9baf8e,
  woodMid: 0x8a6a4f,
  woodDark: 0x6b4e3d,
  roofTeal: 0x3e7a80,
} as const;

/** The height of P's shared plinth, whose top every part is measured from. */
const T = 0.18;

/** An `rz`-style turn about a part's own centre, in the source's terms. */
interface Turn {
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

/** Runs `build` at the origin under a turn about `(x, y, z)`. */
function turned(
  b: MeshBuilder,
  x: number,
  y: number,
  z: number,
  o: Turn,
  build: () => void,
): void {
  b.pushTransform({
    ...(o.rx === undefined ? {} : { rotateX: o.rx }),
    ...(o.ry === undefined ? {} : { rotateY: o.ry }),
    ...(o.rz === undefined ? {} : { rotateZ: o.rz }),
    x,
    y,
    z,
  });
  build();
  b.popTransform();
}

/** `box(w,h,d, x,y,z, colour, rz)` in P's order, with `y` as the CENTRE. */
function bxP(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
  o?: Turn,
): void {
  b.paint(colour);
  if (o === undefined) {
    box(b, w, h, d, y - T - h / 2, x, z);
    return;
  }
  turned(b, x, y - T, z, o, () => {
    box(b, w, h, d, -h / 2, 0, 0);
  });
}

/**
 * `ico(radius, x,y,z, colour, 1, sy, 1)` — a rounded blob, squashed along Y.
 *
 * P's blobs are icosahedra under a non-uniform scale and we have no
 * icosahedron, so a low-ring UV sphere stands in — the same read at a marker's
 * screen size. The SQUASH, though, is carried faithfully: `sphere`'s `radiusY`
 * exists for this, because a canopy flattened to 85 % rebuilt as a round ball
 * is exactly the kind of shape difference this gallery is being judged on.
 */
function icoP(
  b: MeshBuilder,
  radius: number,
  x: number,
  y: number,
  z: number,
  colour: number,
  sy = 1,
): void {
  b.paint(colour);
  sphere(b, radius, y - T, 8, 4, x, z, radius * sy);
}

/**
 * P's park bench — a seat on two legs — grounded and centred on its own
 * footprint so any model can place it.
 *
 * **EXPORTED FOR THE HYBRID.** The owner chose D's park _"mit der Bank von
 * Variante P"_, so this one sub-assembly has two consumers: P's own park, where
 * it reproduces the source exactly, and `poi-variants-hybrid.ts`. Factoring it
 * out rather than copying it is what stops the two benches drifting into
 * different shapes under the same name.
 *
 * `baseY` is where the legs stand, `s` scales the whole bench — the hybrid needs
 * it at about a third of P's size because D's park is a much tighter vignette.
 */
export function benchP(
  b: MeshBuilder,
  baseY: number,
  x: number,
  z: number,
  s = 1,
): void {
  b.paint(P.woodMid);
  box(b, 0.78 * s, 0.1 * s, 0.28 * s, baseY + 0.27 * s, x, z);
  b.paint(P.woodDark);
  for (const side of [-1, 1]) {
    box(b, 0.08 * s, 0.3 * s, 0.08 * s, baseY, x + side * 0.26 * s, z);
  }
}

/** Every P model, keyed by kind. Built at P's own scale; the registry rescales. */
export const P_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "leisure=picnic_table",
    (): MeshData =>
      composed((b) => {
        bxP(b, 1.24, 0.14, 0.62, 0, 0.84, 0, P.woodMid);
        bxP(b, 1.24, 0.12, 0.26, 0, 0.55, -0.64, P.woodMid);
        bxP(b, 1.24, 0.12, 0.26, 0, 0.55, 0.64, P.woodMid);
        // The splayed A-frame legs, which is the whole read of a picnic table.
        bxP(b, 0.12, 0.62, 0.12, -0.36, 0.48, 0, P.woodDark, { rz: 0.3 });
        bxP(b, 0.12, 0.62, 0.12, 0.36, 0.48, 0, P.woodDark, { rz: -0.3 });
      }),
  ],
  [
    "tourism=artwork",
    (): MeshData =>
      composed((b) => {
        // Three stone shafts leaning at different angles, topped by a blob.
        bxP(b, 0.2, 1.42, 0.2, -0.28, 0.94, 0, P.stoneLight, { rz: 0.38 });
        bxP(b, 0.2, 1.18, 0.2, 0.18, 0.88, 0, P.stoneLight, { rz: -0.48 });
        bxP(b, 0.2, 0.88, 0.2, 0.4, 0.94, 0, P.stoneLight, { rz: 0.68 });
        icoP(b, 0.24, -0.02, 1.78, 0, P.roofTeal, 0.7);
      }),
  ],
]);
