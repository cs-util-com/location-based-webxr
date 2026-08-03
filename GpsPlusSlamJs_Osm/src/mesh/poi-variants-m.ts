/**
 * The `M` variants — ported from `poi-markers.html` (DEC-R6-30…33).
 *
 * Four of the owner's 51 liked pairs come from this file. It is the most
 * self-documenting of the six: it states its own conventions in a header
 * comment — _"Convention: metres, Y-up, +Z front, origin on footprint centre.
 * For bx/cy/co the `y` argument is the BOTTOM of the part (before rotation);
 * for ic/qz/qy/dy it is the centre."_ — and those are what the helpers below
 * undo.
 *
 * **NOTHING IS SUBTRACTED**, as in `B` and unlike `D` and `P`. M builds each
 * payload from `y = 0` and translates the merged result by `PLINTH_H` at
 * assembly, so the payload coordinates are already ground-relative. Subtracting
 * a plinth height anyway would sink every model by 23 cm.
 *
 * **Cylinders are top-radius-first**, as in `D` and `P` and unlike `B`. `cyM`
 * swaps them once.
 *
 * **`y` is the BOTTOM *before* rotation.** M composes `T · R · S` with the
 * translation at `y + h/2`, so a rotated part turns about its own centre and
 * then has that centre placed. The helpers reproduce exactly that, which is why
 * they emit at `-h/2` under a transform rather than at `y`.
 *
 * **THE ACCENT IS RESOLVED HERE.** M's builders take an `accent` argument and
 * the renderer supplies it from a `FAMILY` table — `move` for transport, `green`
 * for open space, `food`, `culture`. Each port below bakes in the colour its
 * kind's family resolves to, named in a comment, because a variant is one fixed
 * mesh and there is no family to look up at build time.
 *
 * @see poi-variants-m.ts.md
 */

import type { MeshBuilder, MeshData } from "./mesh-data.js";
import { box, composed, prism, quad, sphere } from "./poi-primitives.js";

/** M's palette, under the source's own names, restricted to what it paints. */
const M = {
  stoneLight: 0x8894a0,
  stoneMid: 0x6e7b85,
  metalGalv: 0xa6adb2,
  metalDark: 0x5a6167,
  woodDark: 0x6b4e3d,
  wallCream: 0xe8dcc8,
  wallSage: 0x9baf8e,
  trimWhite: 0xedede4,
  paving: 0xc4b9a6,
  // The four FAMILY accents these kinds resolve to.
  roofSlate: 0x55697c,
  foliageTeal: 0x3e6b60,
  mustard: 0xd9b64e,
  terracotta: 0xc97b62,
} as const;

/** A turn about a part's own centre, in the source's terms. */
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

/**
 * `bx(w,h,d, c, x,y,z, rx,ry,rz)` — `y` is the BOTTOM.
 *
 * `top` paints the +Y face alone, which is M's `topFace` helper: it colours the
 * six vertices of the box's `+Y` side and leaves the rest, and `leisure=pitch`
 * needs it to make a paved slab read as a grass field.
 */
function bxM(
  b: MeshBuilder,
  w: number,
  h: number,
  d: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  o?: Turn & { readonly top?: number },
): void {
  b.paint(colour);
  const faces = o?.top === undefined ? undefined : { top: o.top };
  if (
    o === undefined ||
    (o.rx === undefined && o.ry === undefined && o.rz === undefined)
  ) {
    box(b, w, h, d, y, x, z, faces);
    return;
  }
  turned(b, x, y + h / 2, z, o, () => {
    box(b, w, h, d, -h / 2, 0, 0, faces);
  });
}

/** `cy(radiusTop, radiusBottom, h, seg, c, x,y,z, rx,ry,rz)` — `y` is the BOTTOM. */
function cyM(
  b: MeshBuilder,
  radiusTop: number,
  radiusBottom: number,
  h: number,
  seg: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  o?: Turn,
): void {
  b.paint(colour);
  // SWAPPED: M gives top first, `prism` takes bottom first.
  if (o === undefined) {
    prism(b, radiusBottom, radiusTop, h, seg, y, x, z);
    return;
  }
  turned(b, x, y + h / 2, z, o, () => {
    prism(b, radiusBottom, radiusTop, h, seg, -h / 2, 0, 0);
  });
}

/** `qy(w,d, c, x,y,z)` — a flush horizontal detail facing +Y, `y` the CENTRE. */
function qyM(
  b: MeshBuilder,
  w: number,
  d: number,
  colour: number,
  x: number,
  y: number,
  z: number,
): void {
  b.paint(colour);
  // Counter-clockwise seen from ABOVE, which is what `quad`'s derived normal
  // needs to come out as +y.
  quad(b, [
    [x - w / 2, y, z - d / 2],
    [x - w / 2, y, z + d / 2],
    [x + w / 2, y, z + d / 2],
    [x + w / 2, y, z - d / 2],
  ]);
}

/**
 * `ic(r, detail, c, x,y,z, sx,sy,sz)` — a blob, `y` the CENTRE.
 *
 * Only the Y squash is carried: every `ic` in these four kinds leaves `sx` and
 * `sz` at 1. The icosahedron itself becomes a low-ring UV sphere, the same read
 * at a marker's screen size.
 */
function icM(
  b: MeshBuilder,
  radius: number,
  colour: number,
  x: number,
  y: number,
  z: number,
  sy = 1,
): void {
  b.paint(colour);
  sphere(b, radius, y, 8, 4, x, z, radius * sy);
}

/** Every M model, keyed by kind. Built at M's own scale; the registry rescales. */
export const M_VARIANTS: ReadonlyMap<string, () => MeshData> = new Map<
  string,
  () => MeshData
>([
  [
    "leisure=pitch",
    (): MeshData =>
      composed((b) => {
        // A marked field with two goals. The slab is paved on its sides and
        // GRASS ON TOP — one box, two colours, which is what `topFace` is for.
        bxM(b, 0.66, 0.16, 0.46, M.foliageTeal, 0, 0, 0, { top: M.wallSage });
        qyM(b, 0.02, 0.42, M.trimWhite, 0, 0.162, 0);
        qyM(b, 0.12, 0.02, M.trimWhite, -0.24, 0.162, 0);
        qyM(b, 0.12, 0.02, M.trimWhite, 0.24, 0.162, 0);
        bxM(b, 0.03, 0.12, 0.18, M.trimWhite, -0.32, 0.16, 0);
        bxM(b, 0.03, 0.12, 0.18, M.trimWhite, 0.32, 0.16, 0);
      }),
  ],
  [
    "amenity=bicycle_parking",
    (): MeshData =>
      composed((b) => {
        // Two Sheffield hoops, each two uprights and a crossbar.
        for (const x of [-0.27, 0.27]) {
          bxM(b, 0.04, 0.34, 0.04, M.metalGalv, x, 0, -0.14);
          bxM(b, 0.04, 0.34, 0.04, M.metalGalv, x, 0, 0.14);
          bxM(b, 0.04, 0.05, 0.32, M.metalGalv, x, 0.34, 0);
        }
        // A bike between them: two wheels turned onto their edge, a frame and a
        // tilted saddle in the family accent.
        cyM(b, 0.1, 0.1, 0.03, 6, M.metalDark, -0.14, 0.085, 0, {
          rx: Math.PI / 2,
        });
        cyM(b, 0.1, 0.1, 0.03, 6, M.metalDark, 0.14, 0.085, 0, {
          rx: Math.PI / 2,
        });
        bxM(b, 0.3, 0.04, 0.03, M.metalDark, 0, 0.15, 0);
        bxM(b, 0.1, 0.14, 0.03, M.roofSlate, -0.06, 0.19, 0, { rz: -0.5 });
      }),
  ],
  [
    "amenity=fast_food",
    (): MeshData =>
      composed((b) => {
        // A burger on a tray on a post.
        bxM(b, 0.09, 0.4, 0.09, M.metalDark, 0, 0, 0);
        bxM(b, 0.36, 0.05, 0.28, M.trimWhite, 0, 0.4, 0);
        cyM(b, 0.15, 0.14, 0.06, 6, M.wallCream, 0, 0.45, 0);
        cyM(b, 0.16, 0.16, 0.05, 6, M.woodDark, 0, 0.51, 0);
        // The bun, squashed to 62 % — a round ball here reads as a gumball.
        icM(b, 0.16, M.mustard, 0, 0.6, 0, 0.62);
      }),
  ],
  [
    "historic=archaeological_site",
    (): MeshData =>
      composed((b) => {
        // A survey grid strung over a dig: the stakes rise to 0.32 and the
        // strings hang at 0.30, which is why they are not floating.
        bxM(b, 0.62, 0.14, 0.62, M.paving, 0, 0, 0);
        qyM(b, 0.44, 0.015, M.trimWhite, 0, 0.3, -0.22);
        qyM(b, 0.44, 0.015, M.trimWhite, 0, 0.3, 0.22);
        qyM(b, 0.015, 0.44, M.trimWhite, -0.22, 0.3, 0);
        qyM(b, 0.015, 0.44, M.trimWhite, 0.22, 0.3, 0);
        // The finds, one turned off-axis so the dig does not read as a grid.
        bxM(b, 0.2, 0.1, 0.07, M.stoneLight, -0.05, 0.14, -0.05, { ry: 0.22 });
        bxM(b, 0.07, 0.13, 0.17, M.stoneLight, 0.13, 0.14, 0.07);
        cyM(b, 0.08, 0.08, 0.11, 6, M.stoneLight, -0.17, 0.14, 0.15);
        for (const x of [-0.22, 0.22]) {
          for (const z of [-0.22, 0.22]) {
            bxM(b, 0.03, 0.18, 0.03, M.terracotta, x, 0.14, z);
          }
        }
        // M jitters this last blob by 1.2 cm through a seeded RNG. The jitter is
        // NOISE rather than structure — 1.2 cm on a 6 cm stone — and porting a
        // `mulberry32` to reproduce it would buy nothing a reader could see, so
        // the stone is emitted unjittered. Recorded rather than hidden.
        icM(b, 0.06, M.stoneMid, 0.24, 0.19, -0.2);
      }),
  ],
]);

/** The palette values an M port may paint with. Pinned in the tests. */
export const M_PALETTE = M;
