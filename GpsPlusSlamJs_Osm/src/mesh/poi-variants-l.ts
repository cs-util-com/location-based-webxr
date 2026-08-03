/**
 * The `L` variants — ported from `poi-markers-gallery (2)` (DEC-R6-30…33).
 *
 * Thirteen of the owner's 51 liked pairs come from this file, second only to
 * `D`, and it is the house style: the §4 rebuild already ported seven of its
 * models as the SHIPPED ones, which the registry re-exposes with
 * `fromShipped(kind, "L")` rather than building twice. **This file holds the
 * remaining ten**, the ones with no shipped counterpart.
 *
 * L IS THE ONLY SOURCE WITH TWO CARRIERS, and that is the thing to get right:
 *
 * - **Tier A — street furniture at true life size**, standing on a 0.09 m
 *   plinth. Strip the plinth and the model is already real.
 * - **Tier B — a PLACE (a building or an area), modelled as a tabletop
 *   miniature**: a 0.70 m ground tile carried on a pedestal so the tile's top
 *   lands at `TB = 0.78`. A Tier B church is 0.7 m tall as built.
 *
 * **The tile is kept and the pedestal is not.** The tile is the miniature's own
 * ground plane — the forecourt of a filling station, the grass of a park, the
 * paving of a churchyard — and several models are unreadable without it. The
 * plinth and pedestal are display furniture for a gallery we are not building.
 *
 * **COORDINATES ARE TRANSCRIBED VERBATIM**, including `PL_H` and `TB`, and the
 * carrier is simply not emitted. The payload then floats at 0.09 m (Tier A) or
 * 0.71 m (Tier B) and the registry's `groundedMesh` re-datums it to zero
 * exactly. Rewriting every offset to a new origin would be ten models' worth of
 * chances to mistype one, for no gain.
 *
 * **`y` is a part's CENTRE**, except for `gable` and `pyr` whose source
 * geometries are built from `y = 0` upward — the same split `D` has, and the
 * same way to sink a roof by half its height.
 *
 * **Cylinders are top-radius-first** (as `D`, `P` and `M`; unlike `B`).
 *
 * @see poi-variants-l.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import type { BoxFace } from "./poi-primitives.js";
import {
  box,
  composed,
  disc,
  gable,
  prism,
  pyramid,
  quad,
} from "./poi-primitives.js";

/**
 * L's palette, in FULL and under the source's own names.
 *
 * The other ports declare only the colours they paint with; this one declares
 * all of it, because **L is the house style** — the §4 rebuild took the shipped
 * models from this same file, so this table is the authority the other five
 * palettes are checked against rather than a per-port subset.
 */
const L = {
  // structural / body
  stoneLight: 0x8894a0,
  stoneMid: 0x6e7b85,
  stoneDark: 0x4f5a64,
  metalGalv: 0xa6adb2,
  metalDark: 0x5a6167,
  woodMid: 0x8a6a4f,
  woodDark: 0x6b4e3d,
  windowDark: 0x2b3540,
  wallCream: 0xe8dcc8,
  wallSlate: 0x8e9aa6,
  wallDusty: 0xc99a94,
  wallSage: 0x9baf8e,
  trimWhite: 0xedede4,
  paving: 0xc4b9a6,
  pavingDark: 0xa99e8c,
  // identity accents
  roofTeal: 0x3e7a80,
  roofTealDark: 0x2f6167,
  roofSlate: 0x55697c,
  roofBrick: 0xa8543f,
  spireCopper: 0x4e8c86,
  foliageTeal: 0x3e6b60,
  waterTeal: 0x2fb3b0,
  waterDeep: 0x17878a,
  terracotta: 0xc97b62,
  salmon: 0xd98f6b,
  mustard: 0xd9b64e,
  ochre: 0xa8871f,
  rust: 0xc4622a,
  rustBright: 0xde7c3b,
} as const;

/** The carrier's dimensions, kept so every coordinate below reads as it does in
 * the source. Only `TILE_*` is ever emitted. */
const PL_H = 0.09;
const PED_H = 0.62;
const TILE_H = 0.07;
const TILE_W = 0.7;
/** The Tier B ground plane — plinth + pedestal + tile. */
const TB = PL_H + PED_H + TILE_H;

/** A part's placement, in the source's own option-object form. */
interface Place {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

const turns = (o: Place): boolean =>
  o.rx !== undefined || o.ry !== undefined || o.rz !== undefined;

/** Runs `build` at the origin under `o`'s rotation about `o`'s position. */
function turned(b: MeshBuilder, o: Place, build: () => void): void {
  b.pushTransform({
    ...(o.rx === undefined ? {} : { rotateX: o.rx }),
    ...(o.ry === undefined ? {} : { rotateY: o.ry }),
    ...(o.rz === undefined ? {} : { rotateZ: o.rz }),
    x: o.x ?? 0,
    y: o.y ?? 0,
    z: o.z ?? 0,
  });
  build();
  b.popTransform();
}

/**
 * L's face names mapped onto ours.
 *
 * L indexes a non-indexed `BoxGeometry`'s faces as `+X, -X, +Y, -Y, +Z, -Z` and
 * names them `right, left, top, bottom, front, back`. Ours are compass names in
 * ENU, so front (`+z`) is north and right (`+x`) is east. Getting this pair
 * backwards paints the wrong side of a filling-station canopy, which nothing
 * would flag.
 */
const FACE: Readonly<Record<string, BoxFace>> = Object.freeze({
  right: "east",
  left: "west",
  top: "top",
  bottom: "bottom",
  front: "north",
  back: "south",
});

type Faces = Partial<Record<string, number>>;

const mapped = (faces: Faces | undefined): Partial<Record<BoxFace, number>> => {
  const out: Partial<Record<BoxFace, number>> = {};
  for (const [name, hex] of Object.entries(faces ?? {})) {
    if (hex !== undefined) out[FACE[name] as BoxFace] = hex;
  }
  return out;
};

/** `p.box(w,h,d,hex,o)` — `y` is the CENTRE. `faces` is L's `face()` helper. */
function bxL(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  hex: number,
  o: Place = {},
  faces?: Faces,
): void {
  b.paint(hex);
  const painted = faces === undefined ? undefined : mapped(faces);
  if (!turns(o)) {
    box(b, w, h, d, (o.y ?? 0) - h / 2, o.x ?? 0, o.z ?? 0, painted);
    return;
  }
  turned(b, o, () => {
    box(b, w, h, d, -h / 2, 0, 0, painted);
  });
}

/** `p.cyl(radiusTop, radiusBottom, h, seg, hex, o)` — `y` is the CENTRE. */
function cyL(
  b: MeshBuilder,
  radiusTop: number,
  radiusBottom: number,
  h: number,
  seg: number,
  hex: number,
  o: Place = {},
): void {
  b.paint(hex);
  // SWAPPED: L gives top first, `prism` takes bottom first.
  if (!turns(o)) {
    prism(
      b,
      radiusBottom,
      radiusTop,
      h,
      seg,
      (o.y ?? 0) - h / 2,
      o.x ?? 0,
      o.z ?? 0,
    );
    return;
  }
  turned(b, o, () => {
    prism(b, radiusBottom, radiusTop, h, seg, -h / 2, 0, 0);
  });
}

/** `p.cone(r,h,seg,hex,o)` — `y` is the CENTRE, as three's `ConeGeometry` is. */
function coL(
  b: MeshBuilder,
  r: number,
  h: number,
  seg: number,
  hex: number,
  o: Place = {},
): void {
  cyL(b, 0, r, h, seg, hex, o);
}

/** `p.quad(w,h,hex,o)` — a plane facing +Z before `o`'s rotation, `y` CENTRE. */
function qdL(
  b: MeshBuilder,
  w: number,
  h: number,
  hex: number,
  o: Place = {},
): void {
  b.paint(hex);
  turned(b, o, () => {
    // Counter-clockwise seen from +z, so the derived normal comes out +z.
    quad(b, [
      [-w / 2, -h / 2, 0],
      [w / 2, -h / 2, 0],
      [w / 2, h / 2, 0],
      [-w / 2, h / 2, 0],
    ]);
  });
}

/** `p.disc(r,seg,hex,o)` — a flat n-gon facing +Y at `o.y`. */
function dcL(
  b: MeshBuilder,
  r: number,
  seg: number,
  hex: number,
  o: Place = {},
): void {
  b.paint(hex);
  disc(b, r, o.y ?? 0, seg, true, o.x ?? 0, o.z ?? 0);
}

/**
 * `p.gable(w,h,d,hex,o)` — ridge along X, `y` the BASE.
 *
 * **Our `gable` puts its ridge along Z**, so this turns it a quarter turn and
 * swaps the extents to match. Ridge along the wrong axis is a roof at ninety
 * degrees to its own building — visible, but only if you look.
 */
function gbL(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  hex: number,
  o: Place = {},
): void {
  b.paint(hex);
  b.pushTransform({
    rotateY: Math.PI / 2 + (o.ry ?? 0),
    x: o.x ?? 0,
    y: o.y ?? 0,
    z: o.z ?? 0,
  });
  gable(b, d, w, h, 0);
  b.popTransform();
}

/** `p.pyr(w,h,d,hex,o)` — a hip roof or spire, `y` the BASE. */
function pyL(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  hex: number,
  o: Place = {},
): void {
  b.paint(hex);
  pyramid(b, w, d, h, o.y ?? 0, o.x ?? 0, o.z ?? 0);
}

/**
 * The Tier B ground tile, and the datum every Tier B model measures from.
 *
 * The pedestal and plinth beneath it are NOT emitted — see the file header.
 */
function tierB(b: MeshBuilder, groundHex: number = L.paving): number {
  bxL(
    b,
    TILE_W,
    TILE_H,
    TILE_W,
    L.stoneLight,
    { y: PL_H + PED_H + TILE_H / 2 },
    { top: groundHex },
  );
  return TB;
}

/** `stripe(p,w,d,x,z,base,hex)` — a line painted on a model tile. */
function stripe(
  b: MeshBuilder,
  w: number,
  d: number,
  x: number,
  z: number,
  base: number,
  hex: number = L.trimWhite,
): void {
  qdL(b, w, d, hex, { x, z, y: base + 0.005, rx: -Math.PI / 2 });
}

/** `tree(p,x,z,base,s)` — L's shared trunk-and-cone sub-assembly. */
function tree(b: MeshBuilder, x: number, z: number, base: number, s = 1): void {
  bxL(b, 0.05 * s, 0.15 * s, 0.05 * s, L.woodDark, {
    x,
    z,
    y: base + 0.075 * s,
  });
  coL(b, 0.13 * s, 0.28 * s, 6, L.foliageTeal, {
    x,
    z,
    y: base + 0.15 * s + 0.14 * s,
  });
}

/** `doorQuad(p,base,z,w,h,x)` — a dark opening just proud of a wall. */
function doorQuad(
  b: MeshBuilder,
  base: number,
  z: number,
  w = 0.1,
  h = 0.16,
  x = 0,
): void {
  qdL(b, w, h, L.windowDark, { x, y: base + h / 2, z: z + 0.004 });
}

/**
 * The ten L models with no shipped counterpart, keyed by kind.
 *
 * The other three of the owner's thirteen — `amenity=bench`,
 * `tourism=information` and `historic=wayside_cross` — ARE the shipped models,
 * ported from this file by the §4 rebuild, and the registry re-exposes those
 * rather than building them twice.
 */
export const L_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "amenity=place_of_worship",
    (): MeshData =>
      composed((b) => {
        // Nave, tower, copper spire, cross. The nave takes a GABLE and the
        // tower a PYRAMID, and that contrast is the whole silhouette.
        const y = tierB(b, L.paving);
        bxL(b, 0.34, 0.22, 0.24, L.wallCream, { x: 0.06, y: y + 0.11 });
        gbL(b, 0.34, 0.1, 0.24, L.roofSlate, { x: 0.06, y: y + 0.22 });
        bxL(b, 0.16, 0.44, 0.16, L.wallCream, { x: -0.2, y: y + 0.22 });
        pyL(b, 0.18, 0.2, 0.18, L.spireCopper, { x: -0.2, y: y + 0.44 });
        bxL(b, 0.015, 0.09, 0.015, L.spireCopper, { x: -0.2, y: y + 0.68 });
        bxL(b, 0.055, 0.015, 0.015, L.spireCopper, { x: -0.2, y: y + 0.685 });
        qdL(b, 0.08, 0.13, L.windowDark, { x: -0.2, y: y + 0.075, z: 0.084 });
        qdL(b, 0.06, 0.1, L.windowDark, { x: 0, y: y + 0.13, z: 0.124 });
        qdL(b, 0.06, 0.1, L.windowDark, { x: 0.14, y: y + 0.13, z: 0.124 });
      }),
  ],
  [
    "leisure=park",
    (): MeshData =>
      composed((b) => {
        // Grass tile, a path, three trees at different sizes, a bench.
        const y = tierB(b, L.wallSage);
        stripe(b, 0.62, 0.09, 0, 0.06, y, L.paving);
        tree(b, -0.19, -0.14, y, 1.05);
        tree(b, 0.06, -0.19, y, 0.8);
        tree(b, 0.24, -0.06, y, 0.95);
        bxL(b, 0.16, 0.02, 0.05, L.woodMid, { z: 0.22, y: y + 0.05 });
        bxL(b, 0.16, 0.06, 0.02, L.woodMid, { z: 0.19, y: y + 0.09 });
      }),
  ],
  [
    "amenity=fuel",
    (): MeshData =>
      composed((b) => {
        // Canopy on two posts, two pumps, a kiosk. The canopy's four SIDES are
        // rust and its faces are not — `face()` on four names at once.
        const y = tierB(b, L.pavingDark);
        for (const s of [-1, 1]) {
          bxL(b, 0.04, 0.3, 0.04, L.metalGalv, {
            x: s * 0.22,
            z: 0.02,
            y: y + 0.15,
          });
        }
        bxL(
          b,
          0.62,
          0.05,
          0.34,
          L.trimWhite,
          { z: 0.02, y: y + 0.325 },
          { front: L.rust, back: L.rust, left: L.rust, right: L.rust },
        );
        for (const s of [-1, 1]) {
          bxL(b, 0.08, 0.17, 0.1, L.metalGalv, {
            x: s * 0.13,
            z: 0.02,
            y: y + 0.085,
          });
          qdL(b, 0.05, 0.06, L.windowDark, {
            x: s * 0.13,
            z: 0.072,
            y: y + 0.13,
          });
        }
        bxL(b, 0.2, 0.16, 0.14, L.wallCream, { x: 0, z: -0.26, y: y + 0.08 });
        qdL(b, 0.14, 0.08, L.windowDark, { z: -0.186, y: y + 0.1 });
      }),
  ],
  [
    "amenity=cafe",
    (): MeshData =>
      composed((b) => {
        // A shopfront dominated by a salmon parasol over a small round table.
        const y = tierB(b, L.paving);
        bxL(b, 0.34, 0.24, 0.22, L.wallCream, { z: -0.15, y: y + 0.12 });
        bxL(b, 0.36, 0.03, 0.24, L.roofSlate, { z: -0.15, y: y + 0.255 });
        qdL(b, 0.2, 0.11, L.windowDark, { x: 0.05, y: y + 0.15, z: -0.036 });
        doorQuad(b, y, -0.036, 0.08, 0.15, -0.11);
        bxL(b, 0.02, 0.3, 0.02, L.woodDark, { z: 0.14, y: y + 0.15 });
        coL(b, 0.17, 0.1, 6, L.salmon, { z: 0.14, y: y + 0.34 });
        dcL(b, 0.085, 6, L.woodMid, { z: 0.14, y: y + 0.13 });
        bxL(b, 0.02, 0.13, 0.02, L.woodDark, { z: 0.14, y: y + 0.065 });
        for (const s of [-1, 1]) {
          bxL(b, 0.05, 0.09, 0.05, L.woodDark, {
            x: s * 0.14,
            z: 0.14,
            y: y + 0.045,
          });
        }
      }),
  ],
  [
    "amenity=shelter",
    (): MeshData =>
      composed((b) => {
        // An open roof on four posts with a bench inside. The roof is PITCHED
        // by a rotation, not by a gable — one flat slab tilted 0.12 rad.
        const y = tierB(b, L.paving);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            bxL(b, 0.04, 0.28, 0.04, L.woodDark, {
              x: sx * 0.22,
              z: sz * 0.14,
              y: y + 0.14,
            });
          }
        }
        bxL(b, 0.52, 0.05, 0.36, L.roofTeal, { y: y + 0.305, rx: -0.12 });
        bxL(b, 0.44, 0.14, 0.03, L.woodMid, { z: -0.15, y: y + 0.14 });
        bxL(b, 0.4, 0.03, 0.09, L.woodMid, { z: -0.09, y: y + 0.11 });
      }),
  ],
  [
    "tourism=attraction",
    (): MeshData =>
      composed((b) => {
        // An octagonal pavilion with a pennant: eight-sided base and cap, four
        // columns placed round a circle, a cone roof.
        const y = tierB(b, L.paving);
        cyL(b, 0.24, 0.26, 0.05, 8, L.stoneLight, { y: y + 0.025 });
        for (const a of [0.25, 0.75, 1.25, 1.75]) {
          const t = a * Math.PI;
          bxL(b, 0.035, 0.26, 0.035, L.stoneMid, {
            x: Math.sin(t) * 0.19,
            z: Math.cos(t) * 0.19,
            y: y + 0.18,
          });
        }
        cyL(b, 0.28, 0.28, 0.03, 8, L.stoneLight, { y: y + 0.325 });
        coL(b, 0.28, 0.18, 8, L.terracotta, { y: y + 0.43 });
        bxL(b, 0.02, 0.16, 0.02, L.metalDark, { y: y + 0.6 });
        qdL(b, 0.11, 0.06, L.mustard, {
          x: 0.055,
          y: y + 0.65,
          ry: Math.PI / 2,
        });
      }),
  ],
  [
    "amenity=hunting_stand",
    (): MeshData =>
      composed((b) => {
        // A raised timber hide on four SPLAYED legs, with a ladder.
        const y = tierB(b, L.wallSage);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            // The only two-axis rotation in the ten. L composes Euler in `YXZ`
            // and we apply x-then-y-then-z; at 0.10 rad the orders differ in
            // the fourth decimal, far below the splay itself.
            bxL(b, 0.035, 0.34, 0.035, L.woodDark, {
              x: sx * 0.13,
              z: sz * 0.11,
              y: y + 0.17,
              rz: sx * 0.1,
              rx: -sz * 0.1,
            });
          }
        }
        bxL(b, 0.28, 0.22, 0.22, L.woodMid, { y: y + 0.45 });
        bxL(b, 0.3, 0.04, 0.24, L.woodDark, { y: y + 0.58, rx: -0.16 });
        qdL(b, 0.2, 0.07, L.windowDark, { y: y + 0.48, z: 0.114 });
        bxL(b, 0.1, 0.36, 0.02, L.woodDark, { z: 0.2, y: y + 0.2, rx: 0.22 });
        bxL(b, 0.14, 0.02, 0.02, L.woodDark, { z: 0.185, y: y + 0.14 });
      }),
  ],
  [
    "tourism=viewpoint",
    (): MeshData =>
      composed((b) => {
        // Tier A: a coin telescope behind a railing, at true life size.
        for (const s of [-1, 1]) {
          bxL(b, 0.05, 0.52, 0.05, L.metalGalv, {
            x: s * 0.36,
            z: 0.22,
            y: PL_H + 0.26,
          });
        }
        bxL(b, 0.78, 0.04, 0.04, L.metalGalv, { z: 0.22, y: PL_H + 0.5 });
        bxL(b, 0.78, 0.04, 0.04, L.metalGalv, { z: 0.22, y: PL_H + 0.3 });
        bxL(b, 0.1, 0.78, 0.1, L.metalDark, {
          x: -0.1,
          z: -0.1,
          y: PL_H + 0.39,
        });
        cyL(b, 0.09, 0.07, 0.46, 6, L.stoneLight, {
          x: -0.1,
          z: 0.02,
          y: PL_H + 0.9,
          rx: -0.55,
        });
        bxL(b, 0.06, 0.06, 0.1, L.metalDark, {
          x: -0.1,
          z: -0.14,
          y: PL_H + 0.8,
        });
        bxL(b, 0.1, 0.14, 0.05, L.mustard, {
          x: -0.1,
          z: -0.16,
          y: PL_H + 0.6,
        });
      }),
  ],
  [
    "amenity=waste_disposal",
    (): MeshData =>
      composed((b) => {
        // Tier A: a big wheeled container, lid ajar.
        bxL(b, 1.02, 0.72, 0.68, L.stoneMid, { y: PL_H + 0.4 });
        bxL(b, 1.06, 0.09, 0.72, L.metalDark, { y: PL_H + 0.8, rx: 0.06 });
        bxL(b, 1.08, 0.05, 0.05, L.metalDark, { z: 0.36, y: PL_H + 0.62 });
        for (const s of [-1, 1]) {
          bxL(b, 0.1, 0.16, 0.16, L.metalDark, {
            x: s * 0.42,
            z: 0.22,
            y: PL_H + 0.06,
          });
        }
        qdL(b, 0.44, 0.16, L.windowDark, { y: PL_H + 0.5, z: 0.344 });
      }),
  ],
  [
    "amenity=parking_entrance",
    (): MeshData =>
      composed((b) => {
        // Tier A: a boom barrier across the line, its far end painted rust.
        bxL(b, 0.22, 0.86, 0.22, L.metalDark, { x: -0.56, y: PL_H + 0.43 });
        qdL(b, 0.12, 0.2, L.mustard, { x: -0.56, y: PL_H + 0.6, z: 0.112 });
        bxL(
          b,
          1.26,
          0.09,
          0.09,
          L.metalGalv,
          { x: 0.1, y: PL_H + 0.8 },
          { right: L.rust },
        );
        bxL(b, 0.24, 0.1, 0.1, L.rust, { x: 0.06, y: PL_H + 0.8 });
        bxL(b, 0.24, 0.1, 0.1, L.rust, { x: 0.58, y: PL_H + 0.8 });
        bxL(b, 0.18, 0.16, 0.18, L.stoneMid, {
          x: 0.44,
          z: -0.22,
          y: PL_H + 0.08,
        });
      }),
  ],
]);

/** The palette values an L port may paint with. Pinned in the tests. */
export const L_PALETTE = L;
