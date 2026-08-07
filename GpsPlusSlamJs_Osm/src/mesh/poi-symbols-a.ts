/**
 * The eleven symbols ported from prototype gallery A (stage 0c, batch A).
 *
 * SOURCE: `GpsPlusSlamJs_Docs/docs/poi-prototypes/poi-symbol-gallery-a.html`,
 * checked in beside the plan so this file's provenance can be read rather than
 * guessed. The previous round's ports cite filenames in a Downloads folder that
 * no longer exists, which is the mistake this avoids.
 *
 * WHAT A SYMBOL IS HERE. Geometry only, at the source's own size and datum, with
 * its own colours. It is NOT a marker: `symbolModel` in `poi-models.ts` fits it
 * into the shared envelope and stands it on the shared column (DEC-S21). So
 * nothing here knows about 0.9 m, 2.5 m or the column — a symbol is drawn, and
 * sized somewhere else.
 *
 * A'S CONVENTIONS, LEARNED ONCE AND APPLIED ELEVEN TIMES. This is the cost §6c
 * of the variant plan measured, and it is why the port is batched by source file
 * rather than by kind:
 *
 *  - **`box(w, h, d)` is CENTRED on its placement `y`.** Ours takes a BASE, so
 *    every `y` below is the source's minus half its height. This is the single
 *    most common conversion and the first thing to check if a part sits wrong.
 *  - **`cyl(rTop, rBottom, h, sides)` is TOP-radius first** and also centred.
 *    Ours is `prism(bottom, top, …)` from a base. Both swapped, both silent: a
 *    bin that tapers the wrong way is still a bin, so no assertion catches it.
 *  - **`lathe` profile points are `[radius, y]`** and may be negative, with the
 *    whole profile then translated. Ours takes the same profile plus a `baseY`.
 *  - **`tor` is UPRIGHT in XY and every use here rotates it flat with `rx:90`.**
 *    Ours is authored flat already, so that rotation disappears rather than
 *    being repeated.
 *  - **`extr` outlines are absolute**, not centred: placing at `y` translates
 *    the outline rather than centring it.
 *  - **Rotations are DEGREES** in the source and radians in ours.
 *  - **Where two rotations are combined**, the source is a three.js `Euler` in
 *    `XYZ` order, which applies Z FIRST. Our transform stack applies the
 *    innermost push first, so those are NESTED with `rotateZ` inside to match.
 *    Flattening them into one push would apply X first, which differs by a
 *    second-order term — small at these angles, and wrong for a reason nobody
 *    would find later.
 *
 * @see poi-symbols-a.ts.md
 */

import type { MeshBuilder } from "./mesh-data.js";
import { box, prism, sphere } from "./poi-primitives.js";
import {
  dome,
  extrudedPolygon,
  lathe,
  sweptTube,
  torus,
  type OutlinePoint,
} from "./poi-symbol-primitives.js";

/** Degrees to radians — the source is written in degrees throughout. */
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * A's palette, verbatim.
 *
 * COPIED RATHER THAN MAPPED ONTO THE HOUSE CONSTANTS, and the reason is the
 * lesson from the last port: the invariant worth holding is that **no port
 * invents a colour**, not that every port stays inside a subset chosen for a
 * different source. A also states its own rule — mineral structure, at most one
 * saturated accent per symbol — which is the rule the owner was judging.
 */
const A = {
  stone: 0x9c988f,
  steel: 0xb4b8bc,
  dark: 0x35383d,
  slate: 0x555b63,
  white: 0xf1efe9,
  bone: 0xd8d3c6,
  wood: 0x8a6a44,
  walnut: 0x5d4229,
  red: 0xd0263c,
  gold: 0xd2a520,
  yellow: 0xf2c313,
  green: 0x2f8f4e,
  navy: 0x27354a,
  skyblue: 0x4a86c8,
  purple: 0x6c4b8c,
  crimson: 0xc02a2a,
  glass: 0xcfd8dc,
  water: 0x5f8ba8,
  deepwater: 0x4a7691,
  grass: 0x4f7a3a,
  soil: 0x53392a,
  noteGreen: 0x6f8f6a,
  noteGreenMid: 0x7d9a76,
  noteGreenLight: 0x8aa682,
} as const;

/** A knife blade: the outline the source extrudes 22 mm thick. */
const KNIFE_BLADE: readonly OutlinePoint[] = [
  [-0.04, 0],
  [0.04, 0],
  [0.05, 0.24],
  [0, 0.34],
  [-0.04, 0.28],
];

/** A trowel head. */
const TROWEL_BLADE: readonly OutlinePoint[] = [
  [-0.11, 0],
  [0.11, 0],
  [0.07, 0.22],
  [0, 0.28],
  [-0.07, 0.22],
];

/** `amenity=restaurant` — A1, crossed knife and fork. */
function restaurant(b: MeshBuilder): void {
  b.pushTransform({ rotateZ: rad(15), x: -0.14, z: -0.02 });
  b.paint(A.dark);
  box(b, 0.05, 0.3, 0.022, 0);
  b.paint(A.steel);
  box(b, 0.1, 0.07, 0.022, 0.295);
  for (let i = 0; i < 4; i++) {
    box(b, 0.017, 0.22, 0.022, 0.35, -0.0375 + i * 0.025);
  }
  b.popTransform();

  b.pushTransform({ rotateZ: rad(-15), x: 0.14, z: 0.02 });
  b.paint(A.dark);
  box(b, 0.055, 0.28, 0.03, 0);
  b.paint(A.steel);
  extrudedPolygon(b, KNIFE_BLADE, 0.022, 0.26);
  b.popTransform();
}

/** `amenity=pub` — A3, a cask with a tap. The only vessel-free answer in its group. */
function pub(b: MeshBuilder): void {
  b.paint(A.walnut);
  lathe(
    b,
    [
      [0, -0.22],
      [0.155, -0.22],
      [0.2, -0.1],
      [0.215, 0],
      [0.2, 0.1],
      [0.155, 0.22],
      [0, 0.22],
    ],
    12,
    0.24,
  );
  b.paint(A.steel);
  torus(b, 0.205, 0.022, 0.14, 12, 4);
  torus(b, 0.205, 0.022, 0.34, 12, 4);
  b.paint(A.gold);
  // The tap: a cylinder laid along Z, then the spout hanging under it.
  b.pushTransform({ rotateX: rad(90), y: 0.16, z: 0.22 });
  prism(b, 0.03, 0.03, 0.14, 6, -0.07);
  b.popTransform();
  box(b, 0.03, 0.09, 0.03, 0.065, 0, 0.27);
}

/** `amenity=clinic` — A3, a syringe. */
function clinic(b: MeshBuilder): void {
  b.pushTransform({ rotateZ: rad(-26) });
  b.paint(A.steel);
  prism(b, 0.014, 0.014, 0.2, 6, 0);
  prism(b, 0.05, 0.05, 0.06, 8, 0.19);
  b.paint(A.glass);
  prism(b, 0.085, 0.085, 0.4, 10, 0.25);
  b.paint(A.skyblue);
  prism(b, 0.072, 0.072, 0.19, 10, 0.25);
  b.paint(A.white);
  prism(b, 0.05, 0.05, 0.18, 8, 0.63);
  box(b, 0.26, 0.035, 0.07, 0.7825);
  b.popTransform();
}

/** `amenity=pharmacy` — A1, a capsule, tilted. */
function pharmacy(b: MeshBuilder): void {
  b.pushTransform({ rotateZ: rad(38) });
  b.paint(A.red);
  dome(b, 0.145, 0.145, 12, 5, false);
  prism(b, 0.145, 0.145, 0.2, 12, 0.145);
  b.paint(A.white);
  prism(b, 0.142, 0.142, 0.2, 12, 0.345);
  dome(b, 0.142, 0.545, 12, 5);
  b.popTransform();
}

/** `amenity=atm` — A3, banknotes with a coin. */
function atm(b: MeshBuilder): void {
  // Three notes fanned out. Each carries TWO rotations, so they nest with
  // `rotateZ` innermost to match the source's `XYZ` Euler order.
  const note = (y: number, tilt: number, colour: number): void => {
    b.pushTransform({ rotateX: rad(8), y });
    b.pushTransform({ rotateZ: rad(tilt) });
    b.paint(colour);
    box(b, 0.58, 0.28, 0.015, -0.14);
    b.popTransform();
    b.popTransform();
  };
  note(0.3, -14, A.noteGreen);
  note(0.36, -4, A.noteGreenMid);
  note(0.42, 6, A.noteGreenLight);

  b.pushTransform({ rotateX: rad(8), y: 0.36, z: 0.03 });
  b.pushTransform({ rotateZ: rad(-4) });
  b.paint(A.stone);
  prism(b, 0.1, 0.1, 0.02, 12, -0.01);
  b.popTransform();
  b.popTransform();

  // The coin, on edge.
  b.pushTransform({ rotateX: rad(90), x: 0.28, y: 0.13 });
  b.pushTransform({ rotateZ: rad(12) });
  b.paint(A.gold);
  prism(b, 0.13, 0.13, 0.045, 14, -0.0225);
  b.popTransform();
  b.popTransform();
}

/** `tourism=hotel` — A1, a bed. */
function hotel(b: MeshBuilder): void {
  b.paint(A.walnut);
  box(b, 0.7, 0.1, 0.44, 0);
  box(b, 0.1, 0.34, 0.44, 0.03, -0.3);
  b.paint(A.white);
  box(b, 0.62, 0.1, 0.42, 0.1);
  b.paint(A.skyblue);
  box(b, 0.4, 0.09, 0.42, 0.16, 0.13);
  b.paint(A.white);
  b.pushTransform({ rotateZ: rad(6), x: -0.2, y: 0.205 });
  box(b, 0.2, 0.09, 0.32, -0.045);
  b.popTransform();
}

/**
 * `tourism=guest_house` — A3, a house outline with a bed inside it.
 *
 * The outline-plus-bed composition is what separates it from `tourism=hotel`'s
 * plain bed and from A1's plain little house. Hotel and guest house are a
 * stated confusable pair, and this pick is the one that resolves it.
 */
function guestHouse(b: MeshBuilder): void {
  // The source spells each outline bar as `[w, h, x, y, rz?]`.
  const bar = (
    width: number,
    height: number,
    x: number,
    y: number,
    tilt = 0,
  ): void => {
    if (tilt === 0) {
      box(b, width, height, 0.1, y - height / 2, x);
      return;
    }
    b.pushTransform({ rotateZ: rad(tilt), x, y });
    box(b, width, height, 0.1, -height / 2);
    b.popTransform();
  };
  b.paint(A.green);
  bar(0.62, 0.08, 0, 0.04);
  bar(0.08, 0.36, -0.27, 0.22);
  bar(0.08, 0.36, 0.27, 0.22);
  bar(0.42, 0.08, -0.16, 0.52, 32);
  bar(0.42, 0.08, 0.16, 0.52, -32);
  b.paint(A.white);
  box(b, 0.3, 0.06, 0.1, 0.13);
  b.paint(A.skyblue);
  box(b, 0.22, 0.05, 0.1, 0.19, 0.04);
  b.paint(A.white);
  box(b, 0.1, 0.05, 0.1, 0.19, -0.11);
}

/**
 * `leisure=garden` — A1 AND A2 COMBINED (DEC-S10), at the owner's suggestion.
 *
 * The tools stand IN the bed, which is what makes it a composition rather than
 * a pile: A2 occupies y 0…0.4 as a disc, A1 is vertical strokes through
 * y 0…0.78. It also removes each one's ambiguity — crossed tools alone read as
 * a hardware shop, a flower bed alone reads as generic greenery, which the park
 * and the region slabs already own.
 *
 * **It degrades in the right order**: at 300 m the flowers go first and the
 * rake's vertical stroke survives, so the far silhouette is A1's and the near
 * reading is A2's.
 */
function garden(b: MeshBuilder): void {
  // A2 — the bed.
  b.paint(A.stone);
  prism(b, 0.41, 0.39, 0.05, 14, 0);
  b.paint(A.soil);
  prism(b, 0.4, 0.38, 0.1, 14, 0);
  const flower = (
    x: number,
    z: number,
    height: number,
    colour: number,
  ): void => {
    b.paint(A.grass);
    prism(b, 0.016, 0.016, height, 5, 0.1, x, z);
    b.paint(colour);
    prism(b, 0.085, 0.085, 0.03, 8, 0.1 + height - 0.015, x, z);
    b.paint(A.yellow);
    sphere(b, 0.035, 0.115 + height, 6, 5, x, z);
  };
  flower(-0.16, 0.1, 0.3, A.red);
  flower(0.02, -0.14, 0.4, A.yellow);
  flower(0.17, 0.12, 0.34, A.purple);
  b.paint(A.grass);
  sphere(b, 0.17, 0.24, 10, 7, -0.02, 0.24, 0.17 * 0.85);
  b.paint(A.crimson);
  sphere(b, 0.035, 0.32, 6, 5, -0.12, 0.3);
  sphere(b, 0.035, 0.28, 6, 5, 0.08, 0.32);

  // A1 — the tools, planted in it.
  b.pushTransform({ rotateZ: rad(16), x: -0.1 });
  b.paint(A.wood);
  prism(b, 0.026, 0.026, 0.62, 6, 0);
  b.paint(A.steel);
  box(b, 0.34, 0.05, 0.05, 0.615);
  for (let i = 0; i < 5; i++) {
    box(b, 0.028, 0.13, 0.028, 0.635, -0.14 + i * 0.07);
  }
  b.popTransform();

  b.pushTransform({ rotateZ: rad(-22), x: 0.14 });
  b.paint(A.wood);
  prism(b, 0.026, 0.026, 0.4, 6, 0);
  b.paint(A.green);
  prism(b, 0.03, 0.03, 0.08, 6, 0.38);
  b.paint(A.steel);
  b.pushTransform({ rotateX: rad(-14), y: 0.46 });
  extrudedPolygon(b, TROWEL_BLADE, 0.03);
  b.popTransform();
  b.popTransform();
}

/**
 * `amenity=fountain` — A1, a two-tier basin.
 *
 * The owner's complaint about the shipped fountain was colour, not shape: grey
 * stone with WATER-BLUE horizontals, against a model that was "sehr türkis"
 * throughout. A's palette answers exactly that — `stone` for the structure and
 * a grey-blue `water` for the two flat surfaces.
 */
function fountain(b: MeshBuilder): void {
  b.paint(A.stone);
  prism(b, 0.44, 0.42, 0.14, 16, 0);
  b.paint(A.water);
  prism(b, 0.375, 0.375, 0.02, 16, 0.115);
  b.paint(A.stone);
  prism(b, 0.11, 0.09, 0.22, 10, 0.13);
  prism(b, 0.16, 0.22, 0.07, 14, 0.35);
  b.paint(A.water);
  prism(b, 0.185, 0.185, 0.015, 14, 0.4125);
  b.paint(A.deepwater);
  prism(b, 0.05, 0.04, 0.18, 8, 0.42);
  b.paint(A.water);
  sphere(b, 0.055, 0.62, 8, 6);
}

/** `historic=yes` — A1, a crenellated tower. */
function historic(b: MeshBuilder): void {
  b.paint(A.stone);
  b.pushTransform({ rotateY: rad(45) });
  prism(b, 0.19, 0.15, 0.56, 4, 0);
  b.popTransform();
  b.paint(A.bone);
  b.pushTransform({ rotateY: rad(45) });
  prism(b, 0.2, 0.2, 0.06, 4, 0.56);
  b.popTransform();
  for (let i = 0; i < 4; i++) {
    const a = rad(i * 90);
    box(b, 0.06, 0.1, 0.06, 0.62, Math.cos(a) * 0.12, Math.sin(a) * 0.12);
    const d = a + rad(45);
    box(b, 0.06, 0.1, 0.06, 0.62, Math.cos(d) * 0.17, Math.sin(d) * 0.17);
  }
  b.paint(A.dark);
  box(b, 0.09, 0.13, 0.03, 0.005, 0, 0.145);
  box(b, 0.05, 0.08, 0.03, 0.3, 0, 0.15);
}

/**
 * `amenity=doctors` — A1, a stethoscope.
 *
 * Not in the owner's pick list. Chosen because all five galleries independently
 * made their variant 1 a stethoscope, and taking it from A adds no sixth
 * vocabulary to the port.
 *
 * **The two tubes are where `sweptTube`'s polyline approximation shows**, and
 * the arc is why it is acceptable: 15 samples across a semicircle leaves under a
 * millimetre of chord error at symbol scale. The shorter drop has four control
 * points and is the one to look at if this reads as kinked.
 */
function doctors(b: MeshBuilder): void {
  b.paint(A.navy);
  const arc: [number, number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI * (i / 14);
    arc.push([
      Math.cos(a) * 0.3,
      0.86 - Math.sin(a) * 0.16 - Math.pow(Math.cos(a), 2) * 0.12,
      0,
    ]);
  }
  sweptTube(b, arc, 0.028, 5);
  sweptTube(
    b,
    [
      [0, 0.6, 0],
      [0.02, 0.44, 0.03],
      [-0.02, 0.28, 0.02],
      [0, 0.16, 0],
    ],
    0.028,
    5,
  );
  b.paint(A.steel);
  prism(b, 0.13, 0.13, 0.05, 12, 0.085);
  b.paint(A.dark);
  prism(b, 0.1, 0.1, 0.04, 12, 0.055);
  b.paint(A.steel);
  sphere(b, 0.04, 0.84, 6, 5, -0.3);
  sphere(b, 0.04, 0.84, 6, 5, 0.3);
}

/**
 * The eleven winners from A, keyed by the kind each was picked for.
 *
 * A map rather than eleven exports, so `poi-models.ts` can look one up by kind
 * and FAIL LOUDLY when a key is missing — a silently absent symbol is a marker
 * that quietly falls back, which is the failure mode this repo keeps meeting.
 */
export const A_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void> = new Map(
  [
    ["amenity=restaurant", restaurant],
    ["amenity=pub", pub],
    ["amenity=clinic", clinic],
    ["amenity=pharmacy", pharmacy],
    ["amenity=atm", atm],
    ["tourism=hotel", hotel],
    ["tourism=guest_house", guestHouse],
    ["leisure=garden", garden],
    ["amenity=fountain", fountain],
    ["historic=yes", historic],
    ["amenity=doctors", doctors],
  ],
);
