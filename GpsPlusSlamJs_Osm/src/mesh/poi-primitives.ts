/**
 * The low-polygon shapes the POI models are composed from (W16, DEC-R4-7).
 *
 * WHY PRIMITIVES AND NOT FIFTY HAND-WRITTEN VERTEX LISTS. The owner asked for
 * fifty bespoke models, and each one still gets its own composition,
 * proportions and colour — but "bespoke" does not have to mean "written out
 * vertex by vertex". A bench is a slab on legs; a bin is a tapered cylinder; a
 * lamp is a post with a head. Fifty compositions of a dozen primitives is fifty
 * distinguishable objects with one place for each shape's arithmetic to be
 * wrong, instead of fifty.
 *
 * **This is not the "shape families" option the owner rejected.** That one would
 * have given a bench and a picnic table the *same* shape at different sizes.
 * Here each kind composes its own arrangement — a picnic table is a slab with
 * two benches beside it, a bench is not.
 *
 * EVERYTHING IS BUILT AT REAL-WORLD SIZE, base at `y = 0`, centred on `x`/`z`.
 * That is what lets the consumer place an instance with a translation alone: the
 * per-kind size is baked into the geometry, because it varies per KIND rather
 * than per instance. A uniform 6 m pin for a bench was the previous state, and
 * scale is most of what makes a bench read as a bench.
 *
 * COORDINATES ARE ENU HERE (`+y` up, `+z` north) because `MeshBuilder.vertex`
 * reflects into the render frame itself. Emitting render-frame coordinates would
 * double-apply that reflection.
 *
 * @see poi-primitives.ts.md
 */

import { MeshBuilder, type MeshData } from "./mesh-data.js";

/** A box, base at `y = base`, centred on the origin in `x`/`z`. */
export function box(
  builder: MeshBuilder,
  width: number,
  height: number,
  depth: number,
  base = 0,
  offsetX = 0,
  offsetZ = 0,
): void {
  const x0 = offsetX - width / 2;
  const x1 = offsetX + width / 2;
  const z0 = offsetZ - depth / 2;
  const z1 = offsetZ + depth / 2;
  const y0 = base;
  const y1 = base + height;

  // Six faces, each with its own four vertices, so the normals stay flat rather
  // than being averaged across an edge — the low-polygon look depends on it.
  const face = (
    corners: readonly [number, number, number][],
    normal: readonly [number, number, number],
  ): void => {
    const [nx = 0, ny = 0, nz = 0] = normal;
    const indices = corners.map(([x, y, z]) =>
      builder.vertex(x, y, z, nx, ny, nz),
    );
    const [a, b, c, d] = indices as [number, number, number, number];
    builder.triangle(a, b, c);
    builder.triangle(a, c, d);
  };

  face(
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 1, 0],
  );
  face(
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y0, z0],
      [x0, y0, z0],
    ],
    [0, -1, 0],
  );
  face(
    [
      [x0, y0, z1],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [0, 0, 1],
  );
  face(
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
    ],
    [0, 0, -1],
  );
  face(
    [
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    [1, 0, 0],
  );
  face(
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z1],
    ],
    [-1, 0, 0],
  );
}

/**
 * A prism of `sides` sides — a cylinder at 8+, a cone when `topRadius` is 0.
 *
 * Low side counts are the point rather than a compromise: this is an AR overlay
 * and a marker is a few metres of screen space, so 6 or 8 sides reads as
 * deliberate low-poly rather than as a coarse cylinder.
 */
export function prism(
  builder: MeshBuilder,
  bottomRadius: number,
  topRadius: number,
  height: number,
  sides = 8,
  base = 0,
  offsetX = 0,
  offsetZ = 0,
): void {
  const y0 = base;
  const y1 = base + height;
  const angle = (i: number): number => (i / sides) * Math.PI * 2;

  for (let i = 0; i < sides; i++) {
    const a0 = angle(i);
    const a1 = angle(i + 1);
    const nx = Math.cos((a0 + a1) / 2);
    const nz = Math.sin((a0 + a1) / 2);
    const points: [number, number, number][] = [
      [
        offsetX + Math.cos(a0) * bottomRadius,
        y0,
        offsetZ + Math.sin(a0) * bottomRadius,
      ],
      [
        offsetX + Math.cos(a1) * bottomRadius,
        y0,
        offsetZ + Math.sin(a1) * bottomRadius,
      ],
      [
        offsetX + Math.cos(a1) * topRadius,
        y1,
        offsetZ + Math.sin(a1) * topRadius,
      ],
      [
        offsetX + Math.cos(a0) * topRadius,
        y1,
        offsetZ + Math.sin(a0) * topRadius,
      ],
    ];
    const [p0, p1, p2, p3] = points;
    const v0 = builder.vertex(...(p0 as [number, number, number]), nx, 0, nz);
    const v1 = builder.vertex(...(p1 as [number, number, number]), nx, 0, nz);
    const v2 = builder.vertex(...(p2 as [number, number, number]), nx, 0, nz);
    const v3 = builder.vertex(...(p3 as [number, number, number]), nx, 0, nz);
    builder.triangle(v0, v1, v2);
    // A cone has no top edge, so its upper "quad" is degenerate — emitting the
    // second triangle anyway would add a zero-area face per side, which
    // `computeVertexNormals` turns into NaN normals downstream.
    if (topRadius > 0) builder.triangle(v0, v2, v3);
  }

  // Caps, as fans. The bottom is included even though it is usually against the
  // ground: a marker on a slope shows its underside, and an open shell reads as
  // a hole rather than as a saving.
  const cap = (radius: number, y: number, ny: number): void => {
    if (radius <= 0) return;
    const centre = builder.vertex(offsetX, y, offsetZ, 0, ny, 0);
    const rim: number[] = [];
    for (let i = 0; i < sides; i++) {
      rim.push(
        builder.vertex(
          offsetX + Math.cos(angle(i)) * radius,
          y,
          offsetZ + Math.sin(angle(i)) * radius,
          0,
          ny,
          0,
        ),
      );
    }
    for (let i = 0; i < sides; i++) {
      const a = rim[i] as number;
      const b = rim[(i + 1) % sides] as number;
      if (ny > 0) builder.triangle(centre, a, b);
      else builder.triangle(centre, b, a);
    }
  };
  cap(bottomRadius, y0, -1);
  cap(topRadius, y1, 1);
}

/** A flat slab held up by four legs — the bench/table family's skeleton. */
export function slabOnLegs(
  builder: MeshBuilder,
  width: number,
  depth: number,
  seatHeight: number,
  slabThickness = 0.06,
  legThickness = 0.06,
): void {
  box(builder, width, slabThickness, depth, seatHeight - slabThickness);
  const insetX = width / 2 - legThickness;
  const insetZ = depth / 2 - legThickness / 2;
  for (const sx of [-insetX, insetX]) {
    for (const sz of [-insetZ, insetZ]) {
      box(
        builder,
        legThickness,
        seatHeight - slabThickness,
        legThickness,
        0,
        sx,
        sz,
      );
    }
  }
}

/** A slender post carrying something at the top — lamps, signs, meters. */
export function postWithHead(
  builder: MeshBuilder,
  postHeight: number,
  postRadius: number,
  headWidth: number,
  headHeight: number,
): void {
  prism(builder, postRadius, postRadius, postHeight, 6);
  box(builder, headWidth, headHeight, headWidth, postHeight);
}

/** A roof on four corner posts — shelters, bandstands, fuel canopies. */
export function canopy(
  builder: MeshBuilder,
  width: number,
  depth: number,
  height: number,
  roofThickness = 0.15,
  postThickness = 0.14,
): void {
  box(builder, width, roofThickness, depth, height - roofThickness);
  const insetX = width / 2 - postThickness;
  const insetZ = depth / 2 - postThickness;
  for (const sx of [-insetX, insetX]) {
    for (const sz of [-insetZ, insetZ]) {
      box(
        builder,
        postThickness,
        height - roofThickness,
        postThickness,
        0,
        sx,
        sz,
      );
    }
  }
}

/** A pitched roof over a box — the "small building" family. */
export function hut(
  builder: MeshBuilder,
  width: number,
  depth: number,
  wallHeight: number,
  ridgeHeight: number,
  /** Where the walls start. Non-zero for a cabin raised on legs. */
  base = 0,
): void {
  box(builder, width, wallHeight, depth, base);
  const x0 = -width / 2;
  const x1 = width / 2;
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const y0 = base + wallHeight;
  const y1 = base + wallHeight + ridgeHeight;
  const slope = Math.hypot(ridgeHeight, width / 2);
  const ny = width / 2 / slope;
  const nx = ridgeHeight / slope;

  for (const side of [1, -1]) {
    const eaveX = side > 0 ? x1 : x0;
    const a = builder.vertex(eaveX, y0, z0, side * nx, ny, 0);
    const b = builder.vertex(eaveX, y0, z1, side * nx, ny, 0);
    const c = builder.vertex(0, y1, z1, side * nx, ny, 0);
    const d = builder.vertex(0, y1, z0, side * nx, ny, 0);
    if (side > 0) {
      builder.triangle(a, b, c);
      builder.triangle(a, c, d);
    } else {
      builder.triangle(a, d, c);
      builder.triangle(a, c, b);
    }
  }
  // The two gable triangles, so the roof is closed rather than a tent with open
  // ends — which from a low camera is a hole straight through the building.
  for (const z of [z0, z1]) {
    const facing = z > 0 ? 1 : -1;
    const a = builder.vertex(x0, y0, z, 0, 0, facing);
    const b = builder.vertex(x1, y0, z, 0, 0, facing);
    const c = builder.vertex(0, y1, z, 0, 0, facing);
    if (facing > 0) builder.triangle(a, b, c);
    else builder.triangle(a, c, b);
  }
}

/** Builds one mesh from a composition function. */
export function composed(build: (builder: MeshBuilder) => void): MeshData {
  const builder = new MeshBuilder();
  build(builder);
  return builder.build();
}
