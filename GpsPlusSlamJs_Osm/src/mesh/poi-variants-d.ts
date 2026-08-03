/**
 * The `D` variants — ported from `poi-markers-diorama (1)` (DEC-R6-30…33).
 *
 * Eighteen of the owner's 51 liked pairs come from this one file, more than any
 * other source, and it is the "constant plinth, varying vignette" idiom: a
 * painted low-poly diorama where every kind sits on the same 0.92 m plinth.
 *
 * THREE THINGS ARE STRIPPED OR CONVERTED, and each is a place a port goes wrong
 * silently:
 *
 * 1. **The plinth, and the `T = 0.10` offset on every part.** DEC-R6-8 keeps
 *    real-world scale, so the payload stands on the ground.
 * 2. **Centre-`y` to base-`y`.** three's `BoxGeometry` is centred and our `box`
 *    takes a base, so every `y` becomes `y − h/2`. The local helpers below do
 *    that conversion once rather than at 18 × n call sites.
 * 3. **Diorama scale to real scale (DEC-V5).** D's tiers are 0.35–0.7 m,
 *    0.8–1.2 m and 1.35–1.9 m ABOVE THE PLINTH regardless of what the object
 *    really is — its `place_of_worship` is ~1.9 m. Each model is therefore
 *    scaled uniformly to the height of the model already shipped for that kind,
 *    which preserves every internal proportion while putting it at a size the
 *    gallery can compare. `scaledToHeight` does that, and the registry applies
 *    it — not this file.
 *
 * **THE ARGUMENT ORDER TRAP, which no assertion can catch.** D's `cyl` is
 * three's `CylinderGeometry(radiusTop, radiusBottom, …)` — TOP first. Our
 * `prism(bottomRadius, topRadius, …)` is bottom first. A bin that tapers the
 * wrong way is still a bin. `cylD` below takes them in D's order and swaps them
 * once, so a port can be read straight off the source.
 *
 * @see poi-variants-d.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import {
  box,
  composed,
  disc,
  prism,
  pyramid,
  quad,
  sphere,
} from "./poi-primitives.js";

/**
 * D's palette, which is byte-identical to the house style's.
 *
 * Re-declared here rather than imported from `poi-models.ts` because those
 * constants are named for OUR material vocabulary (`TIMBER`, `DARK_STEEL`) and
 * these are named for the SOURCE's, so a port can be checked against the
 * prototype line by line. The values are asserted equal in the tests, which is
 * what keeps the duplication honest.
 */
const D = {
  stoneLight: 0x8894a0,
  stoneMid: 0x6e7b85,
  stoneDark: 0x4f5a64,
  metalGalv: 0xa6adb2,
  metalDark: 0x5a6167,
  woodMid: 0x8a6a4f,
  woodDark: 0x6b4e3d,
  windowDark: 0x2b3540,
  wallCream: 0xe8dcc8,
  wallDusty: 0xc99a94,
  trimWhite: 0xedede4,
  foliageTeal: 0x3e6b60,
  waterTeal: 0x2fb3b0,
  terracotta: 0xc97b62,
  mustard: 0xd9b64e,
  rust: 0xc4622a,
  ochre: 0xa8871f,
  roofTeal: 0x3e7a80,
  pavingDark: 0xa99e8c,
  wallSage: 0x9baf8e,
  paving: 0xc4b9a6,
  spireCopper: 0x4e8c86,
} as const;

/** The plinth thickness every D part is offset by. Stripped on port. */
const T = 0.1;

/**
 * Runs `build` rotated about a pivot given in **D's own coordinates**.
 *
 * WHY THIS EXISTS RATHER THAN A BARE `pushTransform`, and it is the fix for a
 * bug that produced two separate complaints from the owner. Every D coordinate
 * is written in the source's frame, where the plinth top is `T`, and `bx` and
 * friends strip that `T` as they emit. Six places also needed a rotation and
 * pushed the transform with the source's absolute `y` — `{ rotateX: 0.6,
 * y: T + 0.36 }` — while the part inside was STILL emitted through `bx`, which
 * stripped `T` a second time. The transform's own `T` was stripped nowhere, so
 * every tilted part in the file sat exactly `T` too high: the graveyard's
 * headstones floated, the playground's slide rode up, and the information
 * board's and shelter's roofs went with them.
 *
 * Routing every transform through here strips `T` in ONE place and lets each
 * call keep the source's own `T + …` reading, so a port stays checkable against
 * the prototype line by line. The pivot defaults to the plinth-top origin,
 * which is what the rotation-only sites want.
 */
function turnedD(
  b: MeshBuilder,
  turn: { rotateX?: number; rotateY?: number; rotateZ?: number },
  pivot: { x?: number; y?: number; z?: number },
  build: () => void,
): void {
  b.pushTransform({
    ...turn,
    x: pivot.x ?? 0,
    y: (pivot.y ?? T) - T,
    z: pivot.z ?? 0,
  });
  build();
  b.popTransform();
}

/** `box(w,h,d, x,y,z, colour)` in D's order, with `y` as the CENTRE. */
function bx(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  box(b, w, h, d, y - T - h / 2, x, z);
}

/** `cyl(radiusTop, radiusBottom, h, seg, x,y,z, colour)` — D's order. */
function cylD(
  b: MeshBuilder,
  radiusTop: number,
  radiusBottom: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  // SWAPPED: D gives top first, `prism` takes bottom first.
  prism(b, radiusBottom, radiusTop, h, seg, y - T - h / 2, x, z);
}

/** `cone(r,h,seg, x,y,z, colour)` — a prism with a zero top radius. */
function coneD(
  b: MeshBuilder,
  r: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  prism(b, r, 0, h, seg, y - T - h / 2, x, z);
}

/** `disc(r,seg, x,y,z, colour)` — flat, facing +y. */
function discD(
  b: MeshBuilder,
  r: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  disc(b, r, y - T, seg, true, x, z);
}

/** `quad(w,h, x,y,z, colour)` — a flush detail panel facing +z. */
function quadD(
  b: MeshBuilder,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  const y0 = y - T;
  quad(b, [
    [x - w / 2, y0 - h / 2, z],
    [x + w / 2, y0 - h / 2, z],
    [x + w / 2, y0 + h / 2, z],
    [x - w / 2, y0 + h / 2, z],
  ]);
}

/**
 * `gable(w,h,d, x,y,z, colour)` — a ridged prism, ridge along z.
 *
 * **`y` is the BASE here, not the centre**, unlike every other D primitive —
 * the source builds it from `y = 0` upward. Getting that wrong sinks the part
 * by half its height, which on a weather hood reads as a design choice.
 */
function gableD(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  // Approximated with a square pyramid: our vocabulary has no ridged prism, and
  // at a weather hood's size the difference is one edge. Recorded rather than
  // hidden — if a later model needs a true gable it is `hut`'s roof half.
  pyramid(b, w, d, h, y - T, x, z);
}

/** `flat(w,d, x,y,z, colour)` — a ground-flat panel, facing +y. */
function flatD(
  b: MeshBuilder,
  w: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  b.paint(colour);
  const y0 = y - T;
  // Counter-clockwise seen from ABOVE, which is what `quad`'s derived normal
  // needs to come out as +y.
  quad(b, [
    [x - w / 2, y0, z - d / 2],
    [x - w / 2, y0, z + d / 2],
    [x + w / 2, y0, z + d / 2],
    [x + w / 2, y0, z - d / 2],
  ]);
}

/** `tree(x, z, s)` — D's shared trunk-and-canopy sub-assembly. */
function treeD(b: MeshBuilder, x: number, z: number, s: number): void {
  b.paint(D.woodDark);
  prism(b, 0.045, 0.035, 0.3 * s, 6, 0.15 * s - 0.15 * s, x, z);
  b.paint(D.foliageTeal);
  // The source uses two overlapping icosahedra for a lumpy canopy; `sphere` at
  // a low segment count is the same read and we have no icosahedron.
  sphere(b, 0.2 * s, 0.42 * s, 6, 3, x, z);
  sphere(b, 0.13 * s, 0.3 * s, 5, 3, x + 0.1 * s, z - 0.05 * s);
}

/** `crossPlate(w,t,h, x,y,z, c)` — two boxes forming a cross. */
function crossPlateD(
  b: MeshBuilder,
  w: number,
  t: number,
  h: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): void {
  bx(b, w, t, t * 0.9, x, y, z, colour);
  bx(b, t, h, t * 0.9, x, y, z, colour);
}

/**
 * Every D model, keyed by kind. Built at D's own scale; the registry rescales.
 *
 * **TWO ENTRIES ARE NOT IN THE OWNER'S LIKED LIST FOR D** — `amenity=post_box`
 * (liked from B) and `amenity=waste_basket` (liked from G). They are kept
 * deliberately: for both kinds the SHIPPED model is one the owner has not
 * endorsed either, so a row showing only the incumbent offers no choice at all,
 * and D's version at least gives one. The gallery labels every variant with its
 * source, so nothing is ambiguous. The progress readout counts only liked pairs,
 * so these do not inflate it. Reversible in one commit if the extra rows are
 * noise (DEC-V2).
 */
export const D_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "amenity=bench",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.76, 0.06, 0.24, 0, T + 0.3, 0.03, D.woodMid);
        bx(b, 0.76, 0.18, 0.05, 0, T + 0.44, -0.09, D.woodMid);
        bx(b, 0.06, 0.3, 0.24, -0.32, T + 0.15, 0.03, D.metalDark);
        bx(b, 0.06, 0.3, 0.24, 0.32, T + 0.15, 0.03, D.metalDark);
        bx(b, 0.05, 0.22, 0.05, -0.32, T + 0.4, -0.09, D.metalDark);
        bx(b, 0.05, 0.22, 0.05, 0.32, T + 0.4, -0.09, D.metalDark);
      }),
  ],
  [
    "leisure=picnic_table",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.74, 0.06, 0.32, 0, T + 0.42, 0, D.woodMid);
        bx(b, 0.74, 0.05, 0.14, 0, T + 0.26, 0.3, D.woodMid);
        bx(b, 0.74, 0.05, 0.14, 0, T + 0.26, -0.3, D.woodMid);
        bx(b, 0.06, 0.5, 0.72, -0.3, T + 0.22, 0, D.woodDark);
        bx(b, 0.06, 0.5, 0.72, 0.3, T + 0.22, 0, D.woodDark);
        bx(b, 0.66, 0.05, 0.06, 0, T + 0.2, 0, D.woodDark);
      }),
  ],
  [
    "amenity=drinking_water",
    (): MeshData =>
      composed((b) => {
        cylD(b, 0.075, 0.095, 0.44, 6, 0, T + 0.22, 0, D.stoneMid);
        cylD(b, 0.16, 0.13, 0.1, 8, 0, T + 0.49, 0, D.stoneLight);
        discD(b, 0.135, 8, 0, T + 0.535, 0, D.waterTeal);
        bx(b, 0.05, 0.16, 0.05, 0, T + 0.6, -0.1, D.stoneMid);
        bx(b, 0.05, 0.05, 0.1, 0, T + 0.66, -0.05, D.stoneMid);
        cylD(b, 0.21, 0.21, 0.05, 8, 0, T + 0.025, 0, D.stoneLight);
      }),
  ],
  [
    "historic=wayside_cross",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.34, 0.07, 0.3, 0, T + 0.035, 0, D.stoneMid);
        bx(b, 0.26, 0.07, 0.24, 0, T + 0.105, 0, D.stoneMid);
        bx(b, 0.13, 0.3, 0.12, 0, T + 0.28, 0, D.stoneLight);
        crossPlateD(b, 0.3, 0.1, 0.34, 0, T + 0.53, 0, D.stoneLight);
        gableD(b, 0.36, 0.09, 0.2, 0, T + 0.7, 0, D.stoneDark);
      }),
  ],
  [
    "amenity=cafe",
    (): MeshData =>
      composed((b) => {
        cylD(b, 0.19, 0.19, 0.045, 8, 0, T + 0.29, 0.02, D.wallCream);
        bx(b, 0.06, 0.28, 0.06, 0, T + 0.15, 0.02, D.metalDark);
        cylD(b, 0.17, 0.17, 0.03, 6, 0, T + 0.005, 0.02, D.metalDark);
        bx(b, 0.15, 0.04, 0.15, -0.3, T + 0.22, 0.16, D.metalDark);
        bx(b, 0.15, 0.16, 0.04, -0.3, T + 0.32, 0.09, D.metalDark);
        bx(b, 0.15, 0.04, 0.15, 0.3, T + 0.22, -0.1, D.metalDark);
        bx(b, 0.15, 0.16, 0.04, 0.3, T + 0.32, -0.17, D.metalDark);
        cylD(b, 0.045, 0.035, 0.06, 6, 0, T + 0.34, 0.02, D.wallCream);
        bx(b, 0.045, 0.86, 0.045, 0.02, T + 0.43, -0.02, D.metalDark);
        coneD(b, 0.4, 0.2, 8, 0.02, T + 0.94, -0.02, D.wallCream);
        cylD(b, 0.395, 0.4, 0.05, 8, 0.02, T + 0.865, -0.02, D.terracotta);
      }),
  ],
  [
    "amenity=post_box",
    (): MeshData =>
      composed((b) => {
        cylD(b, 0.15, 0.16, 0.5, 8, 0, T + 0.25, 0, D.wallDusty);
        cylD(b, 0.175, 0.175, 0.032, 8, 0, T + 0.516, 0, D.rust);
        coneD(b, 0.16, 0.075, 8, 0, T + 0.57, 0, D.rust);
        quadD(b, 0.17, 0.045, 0, T + 0.42, 0.152, D.windowDark);
        quadD(b, 0.15, 0.1, 0, T + 0.28, 0.152, D.windowDark);
        cylD(b, 0.19, 0.19, 0.05, 8, 0, T + 0.025, 0, D.stoneDark);
      }),
  ],
  [
    "amenity=vending_machine",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.44, 0.66, 0.26, 0, T + 0.33, 0, D.metalGalv);
        quadD(b, 0.28, 0.44, -0.06, T + 0.42, 0.132, D.windowDark);
        for (let i = 0; i < 3; i++) {
          quadD(b, 0.24, 0.05, -0.06, T + 0.26 + i * 0.14, 0.134, D.mustard);
        }
        quadD(b, 0.1, 0.26, 0.14, T + 0.46, 0.132, D.windowDark);
        quadD(b, 0.3, 0.07, -0.06, T + 0.14, 0.134, D.windowDark);
        bx(b, 0.46, 0.05, 0.28, 0, T + 0.02, 0, D.metalDark);
        bx(b, 0.46, 0.05, 0.28, 0, T + 0.685, 0, D.metalDark);
      }),
  ],
  [
    "amenity=recycling",
    (): MeshData =>
      composed((b) => {
        // Three colour-coded banks, exactly as the source composes them.
        const bank = (x: number, z: number, colour: number): void => {
          cylD(b, 0.115, 0.145, 0.52, 6, x, T + 0.26, z, D.metalGalv);
          cylD(b, 0.125, 0.125, 0.05, 6, x, T + 0.545, z, colour);
          quadD(b, 0.1, 0.045, x, T + 0.44, z + 0.128, D.windowDark);
        };
        bank(-0.26, 0.14, D.roofTeal);
        bank(0.02, -0.14, D.mustard);
        bank(0.3, 0.14, D.rust);
        bx(b, 0.86, 0.05, 0.86, 0, T + 0.025, 0, D.pavingDark);
      }),
  ],
  [
    "amenity=fuel",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.11, 0.7, 0.11, -0.28, T + 0.35, -0.1, D.trimWhite);
        bx(b, 0.11, 0.7, 0.11, 0.28, T + 0.35, -0.1, D.trimWhite);
        bx(b, 0.88, 0.14, 0.62, 0, T + 0.77, -0.06, D.trimWhite);
        quadD(b, 0.88, 0.07, 0, T + 0.82, 0.251, D.rust);
        // The rear fascia is the same band turned to face the other way. The
        // source spells it `ry: Math.PI`; ours is a transform around the part.
        turnedD(b, { rotateY: Math.PI }, {}, () => {
          quadD(b, 0.88, 0.07, 0, T + 0.82, 0.371, D.rust);
        });
        bx(b, 0.26, 0.44, 0.2, 0, T + 0.22, 0.02, D.metalGalv);
        quadD(b, 0.16, 0.14, 0, T + 0.32, 0.122, D.windowDark);
        bx(b, 0.05, 0.16, 0.05, 0.17, T + 0.44, 0.02, D.metalGalv);
        bx(b, 0.3, 0.05, 0.24, 0, T + 0.025, 0.02, D.pavingDark);
      }),
  ],
  [
    "tourism=information",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.06, 0.56, 0.06, -0.24, T + 0.28, 0, D.woodMid);
        bx(b, 0.06, 0.56, 0.06, 0.24, T + 0.28, 0, D.woodMid);
        bx(b, 0.66, 0.42, 0.07, 0, T + 0.72, 0, D.woodMid);
        quadD(b, 0.56, 0.32, 0, T + 0.72, 0.038, D.trimWhite);
        quadD(b, 0.22, 0.26, -0.14, T + 0.72, 0.041, D.windowDark);
        quadD(b, 0.24, 0.05, 0.14, T + 0.82, 0.041, D.windowDark);
        quadD(b, 0.24, 0.05, 0.14, T + 0.74, 0.041, D.windowDark);
        quadD(b, 0.24, 0.05, 0.14, T + 0.66, 0.041, D.windowDark);
        // The little roof is tilted, `rx: -0.24` in the source — an information
        // board's roof that is flat reads as a shelf.
        turnedD(b, { rotateX: -0.24 }, { y: T + 0.96, z: 0.02 }, () => {
          bx(b, 0.7, 0.07, 0.16, 0, T, 0, D.roofTeal);
        });
      }),
  ],
  [
    "historic=memorial",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.54, 0.09, 0.54, 0, T + 0.045, 0, D.stoneMid);
        bx(b, 0.42, 0.09, 0.42, 0, T + 0.135, 0, D.stoneMid);
        // A four-sided prism turned 45 degrees is the obelisk's diamond plan.
        turnedD(b, { rotateY: Math.PI / 4 }, {}, () => {
          cylD(b, 0.1, 0.15, 0.7, 4, 0, T + 0.53, 0, D.stoneLight);
          coneD(b, 0.145, 0.16, 4, 0, T + 0.96, 0, D.stoneLight);
        });
        quadD(b, 0.14, 0.2, 0, T + 0.5, 0.112, D.ochre);
        bx(b, 0.3, 0.08, 0.14, 0, T + 0.22, 0.26, D.stoneMid);
      }),
  ],
  [
    "amenity=fountain",
    (): MeshData =>
      composed((b) => {
        cylD(b, 0.4, 0.4, 0.16, 8, 0, T + 0.08, 0, D.stoneLight);
        discD(b, 0.4, 8, 0, T + 0.135, 0, D.waterTeal);
        cylD(b, 0.42, 0.42, 0.05, 8, 0, T + 0.185, 0, D.stoneMid);
        cylD(b, 0.13, 0.16, 0.3, 8, 0, T + 0.31, 0, D.stoneLight);
        discD(b, 0.2, 8, 0, T + 0.475, 0, D.stoneMid);
        cylD(b, 0.05, 0.05, 0.34, 6, 0, T + 0.63, 0, D.waterTeal);
        // The source's `ico` — a faceted blob at the top of the jet. `sphere`
        // at a low segment count is the same read; we have no icosahedron.
        b.paint(D.waterTeal);
        sphere(b, 0.1, T + 0.82 - T, 6, 3);
      }),
  ],
  [
    "leisure=park",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.8, 0.05, 0.8, 0, T + 0.025, 0, D.wallSage);
        flatD(b, 0.2, 0.76, 0.24, T + 0.056, 0, D.paving);
        treeD(b, -0.16, -0.06, 1.15);
        treeD(b, 0.02, 0.26, 0.72);
        bx(b, 0.26, 0.05, 0.09, -0.3, T + 0.1, 0.28, D.woodDark);
        bx(b, 0.05, 0.1, 0.09, -0.3, T + 0.1, 0.24, D.woodDark);
      }),
  ],
  [
    "leisure=playground",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.8, 0.05, 0.8, 0, T + 0.025, 0, D.pavingDark);
        bx(b, 0.3, 0.06, 0.28, -0.2, T + 0.6, -0.1, D.metalGalv);
        for (const x of [-0.33, -0.07]) {
          for (const z of [-0.21, 0.01]) {
            bx(b, 0.06, 0.58, 0.06, x, T + 0.31, z, D.metalGalv);
          }
        }
        bx(b, 0.3, 0.05, 0.3, -0.2, T + 0.44, -0.1, D.metalGalv);
        // THE SLIDE IS THE MODEL. Its bed and rails are pitched `rx: 0.60`;
        // flat, a playground is a deck with three bars beside it.
        turnedD(b, { rotateX: 0.6 }, { y: T + 0.36, z: 0.06 }, () => {
          bx(b, 0.24, 0.05, 0.72, 0.14, T, 0, D.mustard);
        });
        turnedD(b, { rotateX: 0.6 }, { y: T + 0.4, z: 0.06 }, () => {
          bx(b, 0.05, 0.15, 0.72, 0.25, T, 0, D.metalGalv);
          bx(b, 0.05, 0.15, 0.72, 0.03, T, 0, D.metalGalv);
        });
      }),
  ],
  [
    "amenity=grave_yard",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.8, 0.05, 0.8, 0, T + 0.025, 0, D.wallSage);
        bx(b, 0.8, 0.1, 0.06, 0, T + 0.05, -0.37, D.stoneLight);
        // EACH HEADSTONE LEANS, and the lean is why this reads as a graveyard
        // rather than a car park. `rotateZ` was added for exactly this.
        const stone = (x: number, z: number, h: number, tilt: number): void => {
          turnedD(b, { rotateZ: tilt }, { x, y: T + 0.05 + h / 2, z }, () => {
            bx(b, 0.16, h, 0.06, 0, T, 0, D.stoneLight);
          });
          bx(b, 0.2, 0.05, 0.1, x, T + 0.06, z, D.stoneLight);
        };
        stone(-0.26, 0.1, 0.34, 0.05);
        stone(0.02, -0.08, 0.28, -0.04);
        stone(0.28, 0.16, 0.3, 0.02);
        crossPlateD(b, 0.16, 0.05, 0.3, -0.26, T + 0.46, 0.1, D.stoneLight);
        coneD(b, 0.11, 0.32, 6, 0.3, T + 0.21, -0.26, D.foliageTeal);
      }),
  ],
  [
    "amenity=bar",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.78, 0.46, 0.22, 0, T + 0.23, -0.12, D.woodDark);
        bx(b, 0.84, 0.06, 0.3, 0, T + 0.49, -0.1, D.stoneDark);
        bx(b, 0.66, 0.44, 0.1, 0, T + 0.68, -0.36, D.woodDark);
        bx(b, 0.62, 0.04, 0.12, 0, T + 0.62, -0.32, D.stoneDark);
        for (let i = 0; i < 3; i++) {
          bx(
            b,
            0.05,
            0.16,
            0.05,
            -0.16 + i * 0.16,
            T + 0.72,
            -0.34,
            D.roofTeal,
          );
        }
        for (const x of [-0.24, 0.04, 0.32]) {
          bx(b, 0.05, 0.42, 0.05, x, T + 0.21, 0.24, D.stoneDark);
          cylD(b, 0.1, 0.1, 0.05, 6, x, T + 0.44, 0.24, D.woodDark);
        }
      }),
  ],
  [
    "amenity=place_of_worship",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.46, 0.72, 0.66, 0.14, T + 0.36, 0, D.wallCream);
        gableD(b, 0.5, 0.21, 0.7, 0.14, T + 0.72, 0, D.roofTeal);
        bx(b, 0.34, 1.16, 0.34, -0.26, T + 0.58, 0, D.wallCream);
        bx(b, 0.38, 0.07, 0.38, -0.26, T + 1.19, 0, D.wallCream);
        // A four-sided cone turned 45 degrees is the spire's diamond plan.
        turnedD(b, { rotateY: Math.PI / 4 }, {}, () => {
          coneD(b, 0.26, 0.42, 4, -0.26, T + 1.44, 0, D.spireCopper);
        });
        crossPlateD(b, 0.11, 0.035, 0.15, -0.26, T + 1.72, 0, D.spireCopper);
        quadD(b, 0.12, 0.24, -0.26, T + 0.42, 0.172, D.windowDark);
        quadD(b, 0.1, 0.16, -0.26, T + 1.0, 0.172, D.windowDark);
        quadD(b, 0.14, 0.28, 0.14, T + 0.4, 0.332, D.windowDark);
      }),
  ],
  [
    "amenity=bank",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.8, 0.14, 0.62, 0, T + 0.07, -0.02, D.stoneMid);
        bx(b, 0.72, 0.1, 0.54, 0, T + 0.19, -0.02, D.stoneMid);
        bx(b, 0.56, 0.7, 0.34, 0, T + 0.59, -0.16, D.wallCream);
        quadD(b, 0.2, 0.4, 0, T + 0.44, 0.012, D.windowDark);
        // The colonnade — four columns is what makes this a bank rather than a
        // shed, and it is the one detail the shipped model has none of.
        for (let i = 0; i < 4; i++) {
          cylD(
            b,
            0.055,
            0.06,
            0.66,
            6,
            -0.27 + i * 0.18,
            T + 0.57,
            0.16,
            D.trimWhite,
          );
        }
        bx(b, 0.74, 0.12, 0.46, 0, T + 0.96, -0.02, D.trimWhite);
        gableD(b, 0.78, 0.24, 0.46, 0, T + 1.02, -0.02, D.trimWhite);
      }),
  ],
  [
    "amenity=shelter",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.06, 0.72, 0.06, -0.36, T + 0.36, 0.26, D.metalDark);
        bx(b, 0.06, 0.72, 0.06, 0.36, T + 0.36, 0.26, D.metalDark);
        bx(b, 0.06, 0.76, 0.06, -0.36, T + 0.38, -0.26, D.metalDark);
        bx(b, 0.06, 0.76, 0.06, 0.36, T + 0.38, -0.26, D.metalDark);
        // The roof panels are pitched `rx: 0.14` — a shelter with a flat roof
        // is a table.
        turnedD(b, { rotateX: 0.14 }, { y: T + 0.8, z: -0.16 }, () => {
          bx(b, 0.86, 0.09, 0.32, 0, T, 0, D.metalGalv);
        });
        turnedD(b, { rotateX: 0.14 }, { y: T + 0.72, z: 0.16 }, () => {
          bx(b, 0.86, 0.09, 0.32, 0, T, 0, D.metalGalv);
        });
        quadD(b, 0.86, 0.06, 0, T + 0.7, 0.325, D.roofTeal);
        bx(b, 0.74, 0.54, 0.05, 0, T + 0.35, -0.3, D.windowDark);
        bx(b, 0.62, 0.05, 0.16, 0, T + 0.26, -0.2, D.metalGalv);
        bx(b, 0.06, 0.24, 0.14, 0, T + 0.14, -0.2, D.metalDark);
      }),
  ],
  [
    "amenity=waste_basket",
    (): MeshData =>
      composed((b) => {
        cylD(b, 0.15, 0.115, 0.34, 8, 0, T + 0.34, 0, D.metalDark);
        discD(b, 0.145, 8, 0, T + 0.505, 0, D.windowDark);
        cylD(b, 0.155, 0.155, 0.022, 8, 0, T + 0.522, 0, D.rust);
        bx(b, 0.08, 0.34, 0.08, 0, T + 0.17, -0.02, D.metalDark);
      }),
  ],
]);

/** The palette values a D port may paint with. Pinned in the tests. */
export const D_PALETTE = D;
