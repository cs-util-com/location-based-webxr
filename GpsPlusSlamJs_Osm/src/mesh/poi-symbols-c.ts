/**
 * The ten winners ported from prototype gallery C (stage 0c, batch C).
 *
 * SOURCE: `GpsPlusSlamJs_Docs/docs/poi-prototypes/poi-symbol-gallery-c.html`.
 * The most self-documenting of the five — every variant carries a `note`
 * explaining its own design intent, and those notes are quoted below where they
 * say something a reader of this file would otherwise have to guess.
 *
 * **THIS FILE EXPORTS TWO MAPS, because C won in both families.** Eight kinds
 * took a symbol from C's proposal rows. Three more came from its REFERENCE row —
 * C's own re-drawings of markers we already ship, which the owner saw beside the
 * shipped versions and preferred (DEC-S14). Of those three, `amenity=fast_food`
 * is a symbol (C draws it on a column, and "burger on a post" is the exemplar
 * the whole family is calibrated against) while `leisure=picnic_table` and
 * `amenity=bench` are **props**: real objects at real size, which is what family
 * L means. Putting a bench on a 1.6 m column would be absurd, and DEC-S3 says
 * family L keeps DEC-R6-8's real-world scale.
 *
 * C'S CONVENTIONS, and they differ from A's in three ways that would each be a
 * silent defect:
 *
 *  - **Rotations are RADIANS**, where A's are degrees. A file-wide `rad()` that
 *    got applied here would rotate everything by a factor of 57.
 *  - **`tor(r, t, arc, ts, rs)` takes its ARC THIRD**, where A's takes it fifth.
 *    A mis-read gives a full ring where a handle belongs — recognisable, wrong,
 *    and not something any assertion catches.
 *  - **C's torus is UPRIGHT in XY** (three's own orientation) and is laid flat
 *    with `r:[PI/2,0,0]`. Ours is authored flat, so that rotation DISAPPEARS for
 *    a flat hoop — but an upright one needs `rotateX(-PI/2)`, negative, because
 *    `+PI/2` sweeps our arc the opposite way round and puts a half-torus handle
 *    on the wrong side of the cup.
 *  - `box` and `cyl` are centred, and `cyl` is top-radius first, exactly as A's.
 *
 * @see poi-symbols-c.ts.md
 */

import type { MeshBuilder } from "./mesh-data.js";
import { box, prism, sphere } from "./poi-primitives.js";
import {
  dome,
  extrudedPolygon,
  torus,
  type OutlinePoint,
} from "./poi-symbol-primitives.js";

/** C's palette, verbatim — see `poi-symbols-a.ts` for why a source's own. */
const C = {
  stone: 0x9c968b,
  steel: 0x8d939a,
  dark: 0x4a4e54,
  white: 0xf1ede5,
  cream: 0xe7dcc4,
  paper: 0xdcd5c4,
  wood: 0x9a6b3f,
  woodDark: 0x6d4a2c,
  brown: 0x6b4a33,
  red: 0xd23b2e,
  amber: 0xef9f24,
  yellow: 0xf3c518,
  blue: 0x2f62b0,
  green: 0x3f9152,
  leaf: 0x5a8f46,
  orange: 0xe0702c,
  gold: 0xc9a227,
} as const;

/** C's `crossPts`: a plus sign as one outline, arms `arm` wide across `len`. */
function crossOutline(len: number, arm: number): OutlinePoint[] {
  const a = arm / 2;
  const l = len / 2;
  return [
    [-a, -l],
    [a, -l],
    [a, -a],
    [l, -a],
    [l, a],
    [a, a],
    [a, l],
    [-a, l],
    [-a, a],
    [-l, a],
    [-l, -a],
    [-a, -a],
  ];
}

/** C's `starPts`: an `n`-pointed star between radii `outer` and `inner`. */
function starOutline(outer: number, inner: number, points = 5): OutlinePoint[] {
  const out: OutlinePoint[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / points;
    const radius = i % 2 ? inner : outer;
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return out;
}

/**
 * C's `arcRing`: a flat annulus segment, as an outline.
 *
 * Traced rather than reproduced with a shape library — out along the outer
 * radius and back along the inner one — because the package has no curve
 * support and this is the only place a curved outline is needed.
 */
function arcRingOutline(
  outerRadius: number,
  innerRadius: number,
  from: number,
  to: number,
  segments = 10,
): OutlinePoint[] {
  const out: OutlinePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments;
    out.push([Math.cos(a) * outerRadius, Math.sin(a) * outerRadius]);
  }
  for (let i = segments; i >= 0; i--) {
    const a = from + ((to - from) * i) / segments;
    out.push([Math.cos(a) * innerRadius, Math.sin(a) * innerRadius]);
  }
  return out;
}

/**
 * `amenity=cafe` — C1, a cup and saucer.
 *
 * C's note: _"Wide low saucer + steam curl. Wide-and-flat is the anti-stein
 * silhouette."_ — which is how it stays clear of `amenity=pub`'s cask in the
 * hardest confusable group.
 */
function cafe(b: MeshBuilder): void {
  b.paint(C.white);
  prism(b, 0.28, 0.34, 0.045, 14, 0.0025);
  prism(b, 0.155, 0.2, 0.3, 12, 0.05);
  b.paint(C.brown);
  prism(b, 0.175, 0.175, 0.02, 12, 0.325);
  // The handle: C's torus is upright in XY, so ours turns by MINUS a quarter
  // turn — the positive one sweeps the arc round the other way and hangs the
  // handle off the far side of the cup.
  b.paint(C.white);
  b.pushTransform({ rotateZ: -Math.PI / 2 });
  b.pushTransform({ rotateX: -Math.PI / 2, x: 0.21, y: 0.2 });
  torus(b, 0.1, 0.028, 0, 8, 5, Math.PI);
  b.popTransform();
  b.popTransform();
  b.paint(C.paper);
  b.pushTransform({ rotateZ: 0.35, x: -0.06, y: 0.46 });
  box(b, 0.045, 0.16, 0.045, -0.08);
  b.popTransform();
  b.pushTransform({ rotateZ: -0.3, x: 0.05, y: 0.5 });
  box(b, 0.045, 0.2, 0.045, -0.1);
  b.popTransform();
}

/**
 * `amenity=fast_food` — C's reference burger (DEC-S14).
 *
 * The exemplar the entire family is calibrated against, re-drawn by C and
 * preferred by the owner over the shipped 4.3 m version. **DEC-S8 is discharged
 * by this rather than cancelled**: it asked for the shipped burger to be
 * re-scaled to 2.5 m, and adopting a symbol-scale drawing does the same job.
 */
function fastFood(b: MeshBuilder): void {
  b.paint(C.amber);
  prism(b, 0.32, 0.3, 0.14, 12, 0);
  b.paint(C.leaf);
  prism(b, 0.34, 0.34, 0.05, 12, 0.135);
  b.paint(C.yellow);
  b.pushTransform({ rotateY: Math.PI / 4, y: 0.2 });
  box(b, 0.5, 0.045, 0.5, -0.0225);
  b.popTransform();
  b.paint(C.woodDark);
  prism(b, 0.31, 0.31, 0.09, 12, 0.215);
  b.paint(C.amber);
  dome(b, 0.32, 0.31, 12, 5);
}

/** `amenity=kindergarten` — C2, a ring stacker. */
function kindergarten(b: MeshBuilder): void {
  b.paint(C.white);
  prism(b, 0.38, 0.34, 0.07, 12, 0);
  prism(b, 0.05, 0.035, 0.72, 8, 0.06);
  const colours = [C.red, C.amber, C.green, C.blue];
  const radii = [0.3, 0.25, 0.2, 0.15];
  const heights = [0.13, 0.29, 0.43, 0.55];
  for (let i = 0; i < 4; i++) {
    b.paint(colours[i] as number);
    // Already flat in ours, so C's `r:[PI/2,0,0]` disappears rather than being
    // repeated — the hoop is symmetric about its own axis, so the direction the
    // arc sweeps cannot matter here.
    torus(b, radii[i] as number, 0.075, heights[i] as number, 12, 5);
  }
  b.paint(C.yellow);
  sphere(b, 0.09, 0.72, 8, 6);
}

/** `amenity=community_centre` — C2, three figures shoulder to shoulder. */
function communityCentre(b: MeshBuilder): void {
  const figure = (x: number, height: number, colour: number): void => {
    b.paint(colour);
    prism(b, 0.17, 0.13, height, 8, 0, x);
    b.paint(C.cream);
    sphere(b, 0.115, height + 0.13, 9, 6, x);
  };
  figure(-0.28, 0.44, C.orange);
  figure(0, 0.52, C.blue);
  figure(0.28, 0.44, C.green);
}

/** `amenity=hospital` — C1, a bold medic cross. */
function hospital(b: MeshBuilder): void {
  b.paint(C.red);
  extrudedPolygon(b, crossOutline(0.86, 0.3), 0.22, 0.43);
  b.paint(C.white);
  extrudedPolygon(b, crossOutline(0.7, 0.19), 0.02, 0.43, 0, 0.12);
  extrudedPolygon(b, crossOutline(0.7, 0.19), 0.02, 0.43, 0, -0.12);
}

/** `amenity=toilets` — C2, two pictogram figures. */
function toilets(b: MeshBuilder): void {
  b.paint(C.blue);
  sphere(b, 0.115, 0.78, 9, 6, -0.24);
  box(b, 0.26, 0.3, 0.1, 0.37, -0.24);
  box(b, 0.09, 0.28, 0.1, 0.06, -0.31);
  box(b, 0.09, 0.28, 0.1, 0.06, -0.17);
  b.paint(C.red);
  sphere(b, 0.115, 0.78, 9, 6, 0.24);
  extrudedPolygon(
    b,
    [
      [-0.11, 0.16],
      [0.11, 0.16],
      [0.22, -0.2],
      [-0.22, -0.2],
    ],
    0.1,
    0.46,
    0.24,
  );
  box(b, 0.09, 0.24, 0.1, 0.02, 0.17);
  box(b, 0.09, 0.24, 0.1, 0.02, 0.31);
}

/**
 * `amenity=place_of_worship` — C3, a bell in an arch.
 *
 * **Deliberately NOT the miniature church** C1 offers, and that is the point: a
 * church-shaped marker standing next to a real church is precisely what this
 * whole plan exists to stop drawing.
 */
function placeOfWorship(b: MeshBuilder): void {
  b.paint(C.stone);
  box(b, 0.09, 0.6, 0.1, 0, -0.34);
  box(b, 0.09, 0.6, 0.1, 0, 0.34);
  extrudedPolygon(b, arcRingOutline(0.385, 0.295, 0, Math.PI, 10), 0.1, 0.6);
  b.paint(C.dark);
  prism(b, 0.03, 0.03, 0.1, 6, 0.57);
  b.paint(C.gold);
  prism(b, 0.22, 0.1, 0.3, 10, 0.29);
  prism(b, 0.24, 0.24, 0.05, 10, 0.255);
  b.paint(C.dark);
  sphere(b, 0.055, 0.23, 7, 5);
}

/**
 * `tourism=attraction` — C3, a star (DEC-S13).
 *
 * C's note: _"Two nested extruded stars. Cheapest marker in the set at 132
 * triangles."_ The owner chose it over C1, the little house that matched the
 * older brief. **The recorded risk is that a star says "notable" rather than
 * "attraction"**, so it is the one to check against `tourism=viewpoint`,
 * `historic=memorial` and `tourism=artwork` once rendered.
 */
function attraction(b: MeshBuilder): void {
  b.paint(C.amber);
  extrudedPolygon(b, starOutline(0.46, 0.19), 0.14, 0.46);
  b.paint(C.yellow);
  extrudedPolygon(b, starOutline(0.3, 0.12), 0.16, 0.46);
}

/** `leisure=picnic_table` — C's reference re-drawing (DEC-S14), at real size. */
function picnicTable(b: MeshBuilder): void {
  b.paint(C.wood);
  box(b, 1.7, 0.07, 0.8, 0.705);
  box(b, 1.7, 0.06, 0.3, 0.42, 0, 0.72);
  box(b, 1.7, 0.06, 0.3, 0.42, 0, -0.72);
  b.paint(C.woodDark);
  for (const s of [-1, 1]) {
    b.pushTransform({ rotateX: -0.55, x: s * 0.7, y: 0.42, z: 0.5 });
    box(b, 0.08, 0.9, 0.08, -0.45);
    b.popTransform();
    b.pushTransform({ rotateX: 0.55, x: s * 0.7, y: 0.42, z: -0.5 });
    box(b, 0.08, 0.9, 0.08, -0.45);
    b.popTransform();
    box(b, 0.08, 0.06, 1.6, 0.41, s * 0.7);
  }
}

/** `amenity=bench` — C's reference re-drawing (DEC-S14), at real size. */
function bench(b: MeshBuilder): void {
  b.paint(C.wood);
  for (let i = 0; i < 3; i++) {
    box(b, 1.6, 0.05, 0.14, 0.425, 0, -0.1 + i * 0.17);
  }
  for (let i = 0; i < 3; i++) {
    b.pushTransform({ rotateX: -0.18, y: 0.62 + i * 0.17, z: -0.24 });
    box(b, 1.6, 0.14, 0.05, -0.07);
    b.popTransform();
  }
  b.paint(C.dark);
  for (const s of [-1, 1]) {
    box(b, 0.07, 0.45, 0.07, -0.005, s * 0.72, 0.2);
    box(b, 0.07, 0.45, 0.07, -0.005, s * 0.72, -0.2);
    box(b, 0.07, 0.06, 0.55, 0.42, s * 0.72);
    b.pushTransform({ rotateX: -0.18, x: s * 0.72, y: 0.7, z: -0.26 });
    box(b, 0.07, 0.55, 0.07, -0.275);
    b.popTransform();
  }
}

/** The eight family-S winners from C, keyed by kind. */
export const C_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map(
  [
    ["amenity=cafe", cafe],
    ["amenity=fast_food", fastFood],
    ["amenity=kindergarten", kindergarten],
    ["amenity=community_centre", communityCentre],
    ["amenity=hospital", hospital],
    ["amenity=toilets", toilets],
    ["amenity=place_of_worship", placeOfWorship],
    ["tourism=attraction", attraction],
  ],
);

/**
 * The two family-L props from C's reference row, at REAL-WORLD size.
 *
 * Separate from `C_SYMBOLS` because they take a different route into the
 * registry: `model()` derives their height from geometry drawn at true scale,
 * where a symbol is fitted into the 0.9 m envelope first. Mixing them into one
 * map would make the call site decide which treatment applies, which is exactly
 * the sort of per-entry judgement that eventually gets one wrong.
 */
export const C_PROPS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map([
  ["leisure=picnic_table", picnicTable],
  ["amenity=bench", bench],
]);
