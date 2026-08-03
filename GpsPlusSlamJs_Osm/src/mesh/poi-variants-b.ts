/**
 * The `B` variants — ported from `poi-markers-plinth-and-payload`
 * (DEC-R6-30…33).
 *
 * Seven of the owner's 51 liked pairs come from this file. It is the terser of
 * the two plinth idioms: `bx/cy/cn/sp/qd/pr` constructors over a `prep()` that
 * composes one `Matrix4` per part.
 *
 * **THE PORT IS SIMPLER THAN `D`'s IN ONE IMPORTANT WAY, and knowing that is
 * what makes it quick.** B builds its payload from `y = 0` and translates the
 * whole thing up by `PLINTH_H` only at the end, in `marker()`. So the numbers in
 * each builder are ALREADY relative to the payload's own base — stripping the
 * plinth means simply not applying that final translate, and no per-part offset
 * has to be subtracted. D, by contrast, bakes `T` into every part.
 *
 * **WHAT STILL HAS TO BE CONVERTED:**
 *
 * - **`bx`, `cy`, `cn` and `pr` take `y` as the BASE** (each adds `h/2`
 *   internally), which happens to match our `box`/`prism`. **`sp` and `qd` take
 *   `y` as the CENTRE.** Two conventions in one file, and the helpers below keep
 *   them apart.
 * - **`cy(r, …)`'s `r` is the BOTTOM radius** and `o.rt` the top — the opposite
 *   way round from D's `cyl`, and the same way round as our `prism`. Two source
 *   files, two orders; this is why each port gets its own helper layer rather
 *   than a shared one.
 * - **Scale.** B is a diorama like D, so DEC-V5's uniform rescale to the shipped
 *   model's height applies. The registry does it.
 *
 * @see poi-variants-b.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import { box, composed, prism, pyramid, quad } from "./poi-primitives.js";

/** B's palette — the same values D and the house style use. */
const B = {
  stoneLight: 0x8894a0,
  stoneMid: 0x6e7b85,
  stoneDark: 0x4f5a64,
  metalGalv: 0xa6adb2,
  metalDark: 0x5a6167,
  woodMid: 0x8a6a4f,
  woodDark: 0x6b4e3d,
  windowDark: 0x2b3540,
  wallSlate: 0x8e9aa6,
  wallSage: 0x9baf8e,
  trimWhite: 0xedede4,
  pavingDark: 0xa99e8c,
  roofSlate: 0x55697c,
  waterTeal: 0x2fb3b0,
  terracotta: 0xc97b62,
  mustard: 0xd9b64e,
  ochre: 0xa8871f,
} as const;

interface Turn {
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

/** Runs `build` under an optional rotation about the part's own position. */
function turned(
  b: MeshBuilder,
  x: number,
  y: number,
  z: number,
  o: Turn | undefined,
  build: () => void,
): void {
  if (o === undefined) {
    build();
    return;
  }
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

/** `bx(w,h,d,hex,x,y,z,o)` — `y` is the BASE. */
function bx(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  o?: Turn,
): void {
  b.paint(colour);
  if (o === undefined) {
    box(b, w, h, d, y, x, z);
    return;
  }
  turned(b, x, y, z, o, () => {
    box(b, w, h, d, 0, 0, 0);
  });
}

/** `cy(radiusBottom, h, seg, hex, x,y,z, {rt})` — `y` is the BASE. */
function cy(
  b: MeshBuilder,
  radiusBottom: number,
  h: number,
  seg: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  o?: Turn & { readonly rt?: number },
): void {
  b.paint(colour);
  const top = o?.rt ?? radiusBottom;
  if (o === undefined) {
    prism(b, radiusBottom, top, h, seg, y, x, z);
    return;
  }
  turned(b, x, y, z, o, () => {
    prism(b, radiusBottom, top, h, seg, 0, 0, 0);
  });
}

/** `cn(r,h,seg,hex, x,y,z)` — `y` is the BASE. */
function cn(
  b: MeshBuilder,
  r: number,
  h: number,
  seg: number,
  colour: number,
  x: number,
  y: number,
  z: number,
): void {
  b.paint(colour);
  prism(b, r, 0, h, seg, y, x, z);
}

/** `qd(w,h,hex, x,y,z, o)` — a panel facing +z; `y` is the CENTRE. */
function qd(
  b: MeshBuilder,
  w: number,
  h: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  o?: Turn,
): void {
  b.paint(colour);
  const corners: [number, number, number][] = [
    [-w / 2, -h / 2, 0],
    [w / 2, -h / 2, 0],
    [w / 2, h / 2, 0],
    [-w / 2, h / 2, 0],
  ];
  turned(b, x, y, z, o ?? {}, () => {
    quad(b, corners);
  });
}

/** `FLAT` — the source's "quad laid face-up". */
const FLAT: Turn = { rx: -Math.PI / 2 };

/**
 * `pr(w,h,d,hex, x,y,z)` — a triangular prism, ridge along z, `y` the BASE.
 *
 * Approximated by a square pyramid, as `D`'s `gable` is: our vocabulary has no
 * ridged prism. Recorded rather than hidden — it costs one ridge edge on a
 * roof, and every model using it is a small building at marker scale.
 */
function pr(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  colour: number,
  x: number,
  y: number,
  z: number,
): void {
  b.paint(colour);
  pyramid(b, w, d, h, y, x, z);
}

/** Every B model, keyed by kind. Built at B's own scale; the registry rescales. */
export const B_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "amenity=parking",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.74, 0.05, 0.72, B.stoneDark, 0, 0, 0);
        qd(b, 0.03, 0.56, B.trimWhite, -0.2, 0.055, -0.02, FLAT);
        qd(b, 0.03, 0.56, B.trimWhite, 0.02, 0.055, -0.02, FLAT);
        cy(b, 0.035, 0.6, 6, B.metalGalv, 0.28, 0.05, 0.24);
        bx(b, 0.3, 0.3, 0.06, B.roofSlate, 0.28, 0.6, 0.24);
        // The "P" on the sign, four strokes — the detail that says parking
        // rather than "a board on a post".
        qd(b, 0.045, 0.18, B.trimWhite, 0.215, 0.75, 0.272);
        qd(b, 0.11, 0.04, B.trimWhite, 0.29, 0.82, 0.272);
        qd(b, 0.11, 0.04, B.trimWhite, 0.29, 0.735, 0.272);
        qd(b, 0.045, 0.09, B.trimWhite, 0.34, 0.7775, 0.272);
      }),
  ],
  [
    "amenity=fast_food",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.46, 0.36, 0.34, B.wallSlate, -0.08, 0, -0.04);
        bx(b, 0.52, 0.06, 0.4, B.stoneDark, -0.08, 0.36, -0.04);
        qd(b, 0.3, 0.14, B.windowDark, -0.08, 0.26, 0.132);
        bx(b, 0.34, 0.04, 0.14, B.mustard, -0.08, 0.34, 0.2);
        cy(b, 0.04, 0.7, 6, B.stoneDark, 0.3, 0, 0.04);
        bx(b, 0.24, 0.26, 0.07, B.mustard, 0.3, 0.7, 0.04);
        qd(b, 0.12, 0.12, B.stoneDark, 0.3, 0.83, 0.076);
      }),
  ],
  [
    "amenity=post_box",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.12, 0.34, 0.12, B.stoneDark, 0, 0, 0);
        bx(b, 0.34, 0.4, 0.24, B.stoneMid, 0, 0.34, 0);
        bx(b, 0.37, 0.05, 0.27, B.stoneDark, 0, 0.74, 0);
        qd(b, 0.26, 0.28, B.ochre, 0, 0.51, 0.121);
        qd(b, 0.18, 0.03, B.windowDark, 0, 0.68, 0.121);
      }),
  ],
  [
    "leisure=picnic_table",
    (): MeshData =>
      composed((b) => {
        bx(b, 0.72, 0.05, 0.32, B.woodMid, 0, 0.42, 0);
        bx(b, 0.72, 0.04, 0.13, B.woodMid, 0, 0.26, -0.26);
        bx(b, 0.72, 0.04, 0.13, B.woodMid, 0, 0.26, 0.26);
        // SPLAYED A-FRAME LEGS — `rx: ±0.48`. Upright, this is a table with
        // two planks beside it rather than a picnic table.
        bx(b, 0.05, 0.5, 0.05, B.woodDark, -0.26, 0, -0.13, { rx: -0.48 });
        bx(b, 0.05, 0.5, 0.05, B.woodDark, -0.26, 0, 0.13, { rx: 0.48 });
        bx(b, 0.05, 0.5, 0.05, B.woodDark, 0.26, 0, -0.13, { rx: -0.48 });
        bx(b, 0.05, 0.5, 0.05, B.woodDark, 0.26, 0, 0.13, { rx: 0.48 });
      }),
  ],
  [
    "amenity=hunting_stand",
    (): MeshData =>
      composed((b) => {
        // FOUR LEGS SPLAYED ON TWO AXES AT ONCE (`rx` and `rz` together) — the
        // taper is the whole silhouette of a hunting stand.
        bx(b, 0.06, 0.7, 0.06, B.woodDark, -0.21, 0, -0.19, {
          rx: -0.06,
          rz: -0.07,
        });
        bx(b, 0.06, 0.7, 0.06, B.woodDark, 0.21, 0, -0.19, {
          rx: -0.06,
          rz: 0.07,
        });
        bx(b, 0.06, 0.7, 0.06, B.woodDark, -0.21, 0, 0.19, {
          rx: 0.06,
          rz: -0.07,
        });
        bx(b, 0.06, 0.7, 0.06, B.woodDark, 0.21, 0, 0.19, {
          rx: 0.06,
          rz: 0.07,
        });
        bx(b, 0.42, 0.32, 0.38, B.woodMid, 0, 0.7, -0.02);
        pr(b, 0.46, 0.14, 0.42, B.woodDark, 0, 1.02, -0.02);
        qd(b, 0.26, 0.13, B.windowDark, 0, 0.9, 0.171);
        bx(b, 0.03, 0.74, 0.03, B.woodDark, -0.1, 0, 0.28, { rx: -0.2 });
        bx(b, 0.03, 0.74, 0.03, B.woodDark, 0.1, 0, 0.28, { rx: -0.2 });
      }),
  ],
  [
    "historic=yes",
    (): MeshData =>
      composed((b) => {
        cy(b, 0.24, 0.74, 8, B.stoneMid, 0, 0, 0);
        cy(b, 0.28, 0.08, 8, B.stoneLight, 0, 0.74, 0);
        qd(b, 0.07, 0.15, B.windowDark, 0, 0.4, 0.223);
        qd(b, 0.06, 0.12, B.windowDark, 0, 0.16, 0.223);
        // A ring of six merlons around the top — what makes an unspecified
        // historic thing read as a tower rather than a bollard.
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + Math.PI / 6;
          bx(
            b,
            0.11,
            0.13,
            0.11,
            B.stoneLight,
            Math.sin(a) * 0.21,
            0.82,
            Math.cos(a) * 0.21,
            { ry: -a },
          );
        }
        bx(b, 0.02, 0.24, 0.02, B.stoneLight, 0, 0.82, 0);
        qd(b, 0.14, 0.09, B.terracotta, 0.08, 0.99, 0);
      }),
  ],
  [
    "amenity=fountain",
    (): MeshData =>
      composed((b) => {
        cy(b, 0.38, 0.14, 8, B.stoneLight, 0, 0, 0);
        cy(b, 0.32, 0.03, 6, B.waterTeal, 0, 0.12, 0);
        cy(b, 0.1, 0.26, 6, B.stoneLight, 0, 0.15, 0);
        cy(b, 0.2, 0.05, 6, B.stoneLight, 0, 0.41, 0);
        cy(b, 0.16, 0.03, 6, B.waterTeal, 0, 0.45, 0);
        cn(b, 0.06, 0.18, 6, B.waterTeal, 0, 0.48, 0);
      }),
  ],
]);

/** The palette values a B port may paint with. Pinned in the tests. */
export const B_PALETTE = B;
