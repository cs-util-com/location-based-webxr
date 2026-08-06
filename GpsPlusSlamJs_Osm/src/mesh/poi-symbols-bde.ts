/**
 * The last six winners, from prototype galleries B, D and E (stage 0c).
 *
 * SOURCES: `poi-symbol-gallery-b.html` (4), `-d.html` (1), `-e.html` (1), all
 * checked in under `GpsPlusSlamJs_Docs/docs/poi-prototypes/`.
 *
 * **ONE FILE FOR THREE SOURCES, unlike A and C.** The batching rule exists
 * because the port cost is dominated by learning a file's conventions, and that
 * cost is paid once per source however many models come from it. Here two of the
 * three sources contribute a SINGLE model each, so three files plus three
 * sidecars would be more ceremony than content. The conventions are still learned
 * once — they are written down per section below — and the maps stay separate so
 * provenance is never in doubt.
 *
 * THREE MORE VOCABULARIES, AND THEY AGREE ON ALMOST NOTHING:
 *
 *  - **B** places with one array, `[x, y, z, rx, ry, rz, sx, sy, sz]` — position
 *    FIRST, rotation in radians, and an optional non-uniform SCALE that our
 *    transform stack has no equivalent for. See the bank's pediment for how that
 *    one case is handled.
 *  - **D** places with loose trailing arguments, `(…, x, y, z, rx, ry, rz)`, and
 *    its `SP` is an ICOSAHEDRON rather than a UV sphere — a different facet
 *    pattern at the same radius, which ours cannot reproduce and does not need
 *    to at a 0.1 m olive.
 *  - **E** places with `[x, y, z]` centre arrays and separate `size` arrays, and
 *    its rotations come last.
 *
 * All three centre their boxes and cylinders, and all three take the cylinder's
 * TOP radius first — the one convention every gallery shares and the one our
 * `prism` inverts.
 *
 * @see poi-symbols-bde.ts.md
 */

import type { MeshBuilder } from "./mesh-data.js";
import { box, prism, sphere } from "./poi-primitives.js";
import { extrudedPolygon, type OutlinePoint } from "./poi-symbol-primitives.js";

/** B's palette, verbatim. */
const B = {
  white: 0xe9e6df,
  offWhite: 0xd4d0c6,
  paper: 0xf0ece2,
  dark: 0x45494c,
  navy: 0x22355c,
  gold: 0xd6a23c,
  orange: 0xdf7a24,
  postYellow: 0xffcc00,
  parcel: 0xb08a5c,
} as const;

/** D's palette, verbatim. */
const D = {
  dark: 0x2d3137,
  violet: 0x895dad,
} as const;

/** E's palette, verbatim. */
const E = {
  yellow: 0xe4b93f,
  dark: 0x30363b,
  white: 0xf0eee7,
} as const;

/**
 * `amenity=school` — B1, a mortarboard with a tassel.
 *
 * B applies a whole-symbol tilt of `[-0.16, 0, 0.05]` radians in its `build()`
 * call, which is what stops the board reading as a flat plate seen edge-on from
 * the orbit camera. Reproduced as an outer transform rather than dropped.
 */
function school(b: MeshBuilder): void {
  b.pushTransform({ rotateX: -0.16, rotateZ: 0.05 });
  b.paint(B.navy);
  prism(b, 0.245, 0.2, 0.17, 10, -0.075);
  box(b, 0.74, 0.03, 0.74, 0.1);
  b.paint(B.gold);
  sphere(b, 0.045, 0.14, 8, 5);
  prism(b, 0.013, 0.013, 0.3, 4, -0.13, 0.3, 0.16);
  prism(b, 0.03, 0.055, 0.12, 6, -0.25, 0.3, 0.16);
  b.popTransform();
}

/**
 * `amenity=post_office` — B3, a parcel with a tied ribbon.
 *
 * The owner's original brief asked for a yellow letter; a parcel was chosen
 * after seeing both. The ribbon keeps the post-yellow accent, so the brief's
 * colour survives its shape being overruled.
 */
function postOffice(b: MeshBuilder): void {
  b.paint(B.parcel);
  box(b, 0.6, 0.52, 0.52, -0.26);
  b.paint(B.postYellow);
  box(b, 0.615, 0.1, 0.535, -0.07);
  box(b, 0.1, 0.535, 0.615, -0.2675, 0.1);
  b.paint(B.paper);
  box(b, 0.22, 0.16, 0.02, 0.08, -0.12, 0.265);
}

/**
 * `amenity=bank` — B1, the bank façade as a pictogram.
 *
 * The miniaturised front the owner asked for by name: a stepped base, four
 * columns, an entablature and a pediment.
 *
 * **THE PEDIMENT IS RE-EXPRESSED RATHER THAN REPLAYED, and that is the one
 * infidelity in this batch.** B draws it as a THREE-SIDED cylinder rotated a
 * quarter turn and then scaled non-uniformly, `[…, PI/2, PI, 0, 1.65, 1, 0.60]`
 * — a triangular prism stretched along one axis and squashed along another.
 * Our transform stack has no scale (adding one means an inverse-transpose for
 * the normals, which is real work for one part), and a triangular prism IS an
 * extruded triangle, so it is built as one directly, at the dimensions that
 * composition produces: 0.86 wide, 0.23 tall, 0.18 deep.
 *  - **It points UP**, which is what a pediment does and what B's rotation
 *    composition works out to. Stated because deriving it from the source's
 *    three chained transforms is exactly the kind of step that is easy to get
 *    mirrored and impossible to notice afterwards.
 */
function bank(b: MeshBuilder): void {
  b.paint(B.offWhite);
  box(b, 0.9, 0.07, 0.52, -0.375);
  box(b, 0.8, 0.07, 0.44, -0.305);
  b.paint(B.white);
  for (const x of [-0.26, -0.09, 0.09, 0.26]) {
    prism(b, 0.055, 0.055, 0.38, 8, -0.23, x, 0.06);
  }
  box(b, 0.78, 0.09, 0.36, 0.145, 0, 0.02);
  const pediment: readonly OutlinePoint[] = [
    [-0.43, 0],
    [0.43, 0],
    [0, 0.23],
  ];
  extrudedPolygon(b, pediment, 0.18, 0.19, 0, 0.02);
}

/** `leisure=sports_centre` — B1, a dumbbell. */
function sportsCentre(b: MeshBuilder): void {
  b.pushTransform({ rotateX: 0.12, rotateZ: 0.42 });
  b.paint(B.dark);
  // The bar and the plates all lie along X, which B spells as `rz: PI/2` on a
  // cylinder that is otherwise vertical.
  b.pushTransform({ rotateZ: Math.PI / 2 });
  prism(b, 0.05, 0.05, 0.78, 8, -0.39);
  b.popTransform();
  for (const s of [-1, 1]) {
    b.pushTransform({ rotateZ: Math.PI / 2, x: s * 0.28 });
    prism(b, 0.25, 0.25, 0.09, 12, -0.045);
    b.popTransform();
    b.pushTransform({ rotateZ: Math.PI / 2, x: s * 0.37 });
    prism(b, 0.19, 0.19, 0.08, 12, -0.04);
    b.popTransform();
    b.paint(B.orange);
    b.pushTransform({ rotateZ: Math.PI / 2, x: s * 0.2 });
    prism(b, 0.1, 0.1, 0.05, 10, -0.025);
    b.popTransform();
    b.paint(B.dark);
  }
  b.popTransform();
}

/**
 * `amenity=bar` — D1, a tilted cocktail (DEC-S11).
 *
 * **The owner picked D1 AND D3 and only D1 is built**, which is the one place
 * the pick list is not followed as written. They are the same idea twice — a
 * violet martini bowl and a magenta tall tumbler — so combining them puts two
 * 0.7 m glass shapes side by side, which is a blob at orbit distance. It would
 * also destroy the thing D3 was drawn for: D's own note calls it _"a rectangular
 * profile distinct from the pub mug"_, a profile that only exists while it is
 * alone in the silhouette. `bar` is in the hardest confusable group, where the
 * symbol needs to get simpler rather than busier.
 *
 * **Overrulable in one line** if the owner wants D3 instead. What is not
 * recommended is shipping both in one mesh.
 */
function bar(b: MeshBuilder): void {
  b.paint(D.violet);
  // The bowl is a cone turned upside down — `rz: PI` in the source.
  b.pushTransform({ rotateZ: Math.PI, y: 0.55 });
  prism(b, 0.45, 0, 0.48, 8, -0.24);
  b.popTransform();
  b.paint(D.dark);
  prism(b, 0.055, 0.055, 0.55, 6, -0.095);
  prism(b, 0.3, 0.3, 0.07, 8, -0.115);
  sphere(b, 0.1, 0.66, 8, 6, 0.18, 0.02);
  b.pushTransform({ rotateZ: 0.35, x: 0.03, y: 0.68, z: 0.02 });
  box(b, 0.55, 0.035, 0.035, -0.0175);
  b.popTransform();
}

/**
 * `amenity=post_box` — E1, a German yellow box.
 *
 * **NOT the British pillar box the owner asked for in the voice note** — E2 is,
 * and the pick stands as written. Worth knowing when it is seen in the scene,
 * because it is the one winner that contradicts an explicit spoken request.
 */
function postBox(b: MeshBuilder): void {
  b.paint(E.yellow);
  box(b, 0.52, 0.66, 0.34, 0.06);
  b.paint(E.dark);
  box(b, 0.34, 0.07, 0.04, 0.505, 0, 0.18);
  b.paint(E.yellow);
  extrudedPolygon(
    b,
    [
      [0, 0.76],
      [-0.26, 0.65],
      [0.26, 0.65],
    ],
    0.34,
  );
  b.paint(E.white);
  box(b, 0.22, 0.13, 0.03, 0.245, 0, 0.18);
}

/** The four winners from B. */
export const B_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map(
  [
    ["amenity=school", school],
    ["amenity=post_office", postOffice],
    ["amenity=bank", bank],
    ["leisure=sports_centre", sportsCentre],
  ],
);

/** The single winner from D. */
export const D_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map(
  [["amenity=bar", bar]],
);

/** The single winner from E. */
export const E_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map(
  [["amenity=post_box", postBox]],
);
