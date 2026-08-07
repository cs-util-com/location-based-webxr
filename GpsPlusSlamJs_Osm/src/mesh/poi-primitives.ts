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

/**
 * The six faces of a `box`, by the direction they face in ENU.
 *
 * NAMED RATHER THAN INDEXED, unlike the prototype's `FACE` table of vertex
 * ranges. A range is what you need when you paint an already-built geometry;
 * here the box is built face by face anyway, so a name is both safer and
 * readable at the call site — `{ top: SEAT }` says what it does and cannot
 * silently point at the wrong six vertices after an edit.
 */
export type BoxFace = "top" | "bottom" | "north" | "south" | "east" | "west";

/** White — the identity under `vertexColors`, so an unnamed face is unchanged. */
const UNPAINTED = 0xffffff;

/**
 * A box, base at `y = base`, centred on the origin in `x`/`z`.
 *
 * `faces` paints individual sides (§4, DEC-R6-15). **Passing it at all means
 * taking control of every face**: the ones not named are explicitly set to
 * white rather than left carrying whatever colour was last painted into the
 * builder. That is what makes `{ top: SEAT }` mean "the top, and nothing else"
 * regardless of what the model did before this call.
 */
export function box(
  builder: MeshBuilder,
  width: number,
  height: number,
  depth: number,
  base = 0,
  offsetX = 0,
  offsetZ = 0,
  faces?: Partial<Record<BoxFace, number>>,
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
    name: BoxFace,
    corners: readonly [number, number, number][],
    normal: readonly [number, number, number],
  ): void => {
    if (faces !== undefined) builder.paint(faces[name] ?? UNPAINTED);
    const [nx = 0, ny = 0, nz = 0] = normal;
    const indices = corners.map(([x, y, z]) =>
      builder.vertex(x, y, z, nx, ny, nz),
    );
    const [a, b, c, d] = indices as [number, number, number, number];
    // REVERSED, AND THIS WAS A BUG UNTIL §4. The corner lists below read
    // clockwise when seen from OUTSIDE the box, so emitting them in order wound
    // every face against its own normal — see the winding suite in
    // `poi-primitives.test.ts` for what that did to all fifty markers. The
    // corner lists are left as they are and the emission is reversed, because
    // rewriting six corner lists is six chances to get one wrong.
    builder.triangle(a, c, b);
    builder.triangle(a, d, c);
  };

  face(
    "top",
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 1, 0],
  );
  face(
    "bottom",
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y0, z0],
      [x0, y0, z0],
    ],
    [0, -1, 0],
  );
  face(
    "north",
    [
      [x0, y0, z1],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [0, 0, 1],
  );
  face(
    "south",
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
    ],
    [0, 0, -1],
  );
  face(
    "east",
    [
      [x1, y0, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    [1, 0, 0],
  );
  face(
    "west",
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
 * A flat horizontal n-gon at `y`, facing up or down.
 *
 * SHARED RIM VERTICES, which no other primitive here does and which is safe
 * only because a disc is FLAT: every vertex carries the same normal, so there
 * is no edge for sharing to smear across. `prism`'s caps do the same for the
 * same reason.
 */
export function disc(
  builder: MeshBuilder,
  radius: number,
  y: number,
  sides = 12,
  up = true,
  offsetX = 0,
  offsetZ = 0,
): void {
  const ny = up ? 1 : -1;
  const centre = builder.vertex(offsetX, y, offsetZ, 0, ny, 0);
  const rim: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    rim.push(
      builder.vertex(
        offsetX + Math.cos(a) * radius,
        y,
        offsetZ + Math.sin(a) * radius,
        0,
        ny,
        0,
      ),
    );
  }
  for (let i = 0; i < sides; i++) {
    const a = rim[i] as number;
    const b = rim[(i + 1) % sides] as number;
    // The order flips with the facing, so the winding agrees with the normal.
    // Disagreement is the "lit right, culled backwards" failure — a table top
    // that is a hole from above.
    if (up) builder.triangle(centre, b, a);
    else builder.triangle(centre, a, b);
  }
}

/**
 * An arbitrary planar quad over four corners, in ENU.
 *
 * THE ESCAPE HATCH the vocabulary needed. Everything else here is axis-aligned
 * or a solid of revolution, and the prototypes' detail comes largely from
 * panels at angles — a sign face, a pitched solar panel, a lectern. Without
 * this each of those would be a bespoke vertex list in the model.
 *
 * The normal is DERIVED from the corner order by default, `(p1 − p0) × (p3 −
 * p0)`, so a model cannot silently light a tilted panel as though it were flat.
 * Pass one to override for a deliberately faceted look.
 */
export function quad(
  builder: MeshBuilder,
  corners: readonly [number, number, number][],
  normal?: readonly [number, number, number],
): void {
  // `p2` is deliberately not read: the derived normal comes from `p0 → p1` and
  // `p0 → p3`, the two edges that meet at the first corner. Using `p2` instead
  // would fold the quad's far corner into the normal and give a non-planar quad
  // a direction that matches neither of its triangles.
  const [p0, p1, , p3] = corners as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  let [nx, ny, nz] = normal ?? [0, 0, 0];
  if (normal === undefined) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vy = p3[1] - p0[1];
    const vz = p3[2] - p0[2];
    nx = uy * vz - uz * vy;
    ny = uz * vx - ux * vz;
    nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // A degenerate quad has no direction to face. Emitting NaN here would
    // propagate into the instance transform and remove the whole marker.
    if (length > 1e-9) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
  }
  const indices = corners.map(([x, y, z]) =>
    builder.vertex(x, y, z, nx, ny, nz),
  );
  const [a, b, c, d] = indices as [number, number, number, number];
  // NOT reversed, unlike `box`'s faces, and the difference is the corner
  // convention rather than an inconsistency in the builder. This function's
  // contract is the natural one — **corners counter-clockwise as seen from the
  // direction the normal points** — which is also what the derived normal
  // assumes. `box`'s six corner lists predate that and run the other way, so
  // they need the reversal and this does not. Both are pinned by the winding
  // suite, which is the only reason either can be trusted.
  builder.triangle(a, b, c);
  builder.triangle(a, c, d);
}

/**
 * A rectangular pyramid — spires, tent roofs, obelisk caps.
 *
 * `prism(..., topRadius = 0)` already gives a CONE, but a square-based spire is
 * a different shape and `amenity=place_of_worship` needs the square one.
 */
export function pyramid(
  builder: MeshBuilder,
  width: number,
  depth: number,
  height: number,
  base = 0,
  offsetX = 0,
  offsetZ = 0,
): void {
  const x0 = offsetX - width / 2;
  const x1 = offsetX + width / 2;
  const z0 = offsetZ - depth / 2;
  const z1 = offsetZ + depth / 2;
  const y0 = base;
  const apex: [number, number, number] = [offsetX, base + height, offsetZ];

  const corners: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
  ];
  for (let i = 0; i < 4; i++) {
    const p = corners[i] as [number, number, number];
    const q = corners[(i + 1) % 4] as [number, number, number];
    // `(apex − p) × (q − p)`, in that order. The other order points the side
    // normals DOWN and inward, which shades a spire as though it were lit from
    // under the ground — and with the winding matching it, the whole cone of
    // sides is culled away from any camera that can see it.
    const ux = apex[0] - p[0];
    const uy = apex[1] - p[1];
    const uz = apex[2] - p[2];
    const vx = q[0] - p[0];
    const vy = q[1] - p[1];
    const vz = q[2] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const a = builder.vertex(p[0], p[1], p[2], nx, ny, nz);
    const b = builder.vertex(q[0], q[1], q[2], nx, ny, nz);
    const c = builder.vertex(apex[0], apex[1], apex[2], nx, ny, nz);
    builder.triangle(a, c, b);
  }
  // The base, wound the other way so it faces down and the solid is closed. An
  // open bottom reads as a hole the moment the camera drops below the marker,
  // which on a slope it does.
  quad(
    builder,
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [0, -1, 0],
  );
}

/**
 * A low-polygon UV sphere centred at `(offsetX, centreY, offsetZ)`, optionally
 * squashed along Y to `radiusY`.
 *
 * POLES ARE FANS, NOT QUADS, and that is the whole subtlety. A naive latitude
 * loop emits a quad per segment at the top and bottom rings, where one edge has
 * collapsed to a point — so each is a zero-area triangle, and `three` turns
 * those into NaN normals which remove the entire object from the scene with
 * nothing logged. `prism` already had to learn this for its cone case.
 *
 * `radiusY` EXISTS FOR THE PORTS. Four of the six prototypes build rounded parts
 * from an icosahedron under a non-uniform scale — tree canopies at `(1, .85, 1)`,
 * a sculpture blob at `(1, .7, 1)` — and a flattened canopy rebuilt as a round
 * one is precisely the kind of shape difference the gallery is being judged on.
 * Only Y is parameterised because only Y is ever squashed by the liked models;
 * a three-radius ellipsoid would have no caller.
 *
 * **The normal is the ELLIPSOID's, not the unit sphere's.** Under a `(1, k, 1)`
 * scale, positions scale by `k` but normals scale by the inverse transpose —
 * `1/k`, renormalised. Reusing the sphere direction leaves every normal tilted
 * toward the poles, which shades a flattened canopy as if it were still round:
 * no silhouette changes, so it survives a screenshot review.
 */
export function sphere(
  builder: MeshBuilder,
  radius: number,
  centreY: number,
  segments = 12,
  rings = 6,
  offsetX = 0,
  offsetZ = 0,
  radiusY = radius,
): void {
  const point = (
    ring: number,
    segment: number,
  ): [number, number, number, number, number, number] => {
    const phi = (ring / rings) * Math.PI;
    const theta = (segment / segments) * Math.PI * 2;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);
    // Inverse-transpose of diag(radius, radiusY, radius), dropping the common
    // 1/radius factor that renormalising removes anyway.
    const gy = (ny * radius) / radiusY;
    const length = Math.hypot(nx, gy, nz);
    return [
      offsetX + nx * radius,
      centreY + ny * radiusY,
      offsetZ + nz * radius,
      nx / length,
      gy / length,
      nz / length,
    ];
  };

  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = point(ring, segment);
      const b = point(ring, segment + 1);
      const c = point(ring + 1, segment + 1);
      const d = point(ring + 1, segment);
      const ia = builder.vertex(...a);
      const ib = builder.vertex(...b);
      const ic = builder.vertex(...c);
      const id = builder.vertex(...d);
      // The top ring's a/b coincide at the pole and the bottom ring's c/d do,
      // so one triangle of each cap quad is degenerate and is skipped.
      if (ring > 0) builder.triangle(ia, ib, ic);
      if (ring < rings - 1) builder.triangle(ia, ic, id);
    }
  }
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
    // Reversed for the same reason as `box`'s faces — the four points below run
    // clockwise seen from outside, so emitting them in order wound every side
    // against its own normal.
    builder.triangle(v0, v2, v1);
    // A cone has no top edge, so its upper "quad" is degenerate — emitting the
    // second triangle anyway would add a zero-area face per side, which
    // `computeVertexNormals` turns into NaN normals downstream.
    if (topRadius > 0) builder.triangle(v0, v3, v2);
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
      if (ny > 0) builder.triangle(centre, b, a);
      else builder.triangle(centre, a, b);
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

/**
 * A ridged roof, its RIDGE ALONG Z, sitting on `base`.
 *
 * Two slopes facing ±x and two closing triangles at ±z. This was `hut`'s roof
 * half and is now a primitive of its own because the ports need a bare gable:
 * `poi-variants-l.ts` puts one on a church nave and a hip roof (`pyramid`) on
 * its tower, and the difference between the two IS the silhouette. `hut` calls
 * this, so the two cannot drift apart.
 */
export function gable(
  builder: MeshBuilder,
  width: number,
  depth: number,
  height: number,
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
  const slope = Math.hypot(height, width / 2);
  const ny = width / 2 / slope;
  const nx = height / slope;

  for (const side of [1, -1]) {
    const eaveX = side > 0 ? x1 : x0;
    const a = builder.vertex(eaveX, y0, z0, side * nx, ny, 0);
    const b = builder.vertex(eaveX, y0, z1, side * nx, ny, 0);
    const c = builder.vertex(offsetX, y1, z1, side * nx, ny, 0);
    const d = builder.vertex(offsetX, y1, z0, side * nx, ny, 0);
    // Reversed on both branches, for the same reason as `box`'s faces. The
    // GABLE triangles below are NOT reversed and are already correct — they
    // were written with the opposite corner order, which is why only half of
    // `hut` was wrong and why `amenity=place_of_worship` was the one model the
    // registry-wide winding guard still flagged after the primitives were
    // fixed.
    if (side > 0) {
      builder.triangle(a, c, b);
      builder.triangle(a, d, c);
    } else {
      builder.triangle(a, b, c);
      builder.triangle(a, c, d);
    }
  }
  // The two closing triangles, so the roof is closed rather than a tent with
  // open ends — which from a low camera is a hole straight through the
  // building.
  for (const z of [z0, z1]) {
    const facing = z > offsetZ ? 1 : -1;
    const a = builder.vertex(x0, y0, z, 0, 0, facing);
    const b = builder.vertex(x1, y0, z, 0, 0, facing);
    const c = builder.vertex(offsetX, y1, z, 0, 0, facing);
    if (facing > 0) builder.triangle(a, b, c);
    else builder.triangle(a, c, b);
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
  gable(builder, width, depth, ridgeHeight, base + wallHeight);
}

/** Builds one mesh from a composition function. */
export function composed(build: (builder: MeshBuilder) => void): MeshData {
  const builder = new MeshBuilder();
  build(builder);
  return builder.build();
}

/**
 * The same mesh lifted so its lowest point sits at `y = 0`.
 *
 * WHY THE PORTED MODELS NEED IT, and it was found by the contract test rather
 * than by reading. Several `D`-sourced models have parts that extend DOWN INTO
 * the diorama plinth they were drawn on — `leisure=picnic_table`'s A-frames are
 * 0.50 m tall centred 0.22 m above the plinth top, so they reach 3 cm below it.
 * That is invisible in the source, where the plinth hides them. Strip the plinth
 * and they hang below ground.
 *
 * Grounding rather than clamping: the model is correct, its datum is not, so
 * moving it is right and truncating it would silently shorten a leg.
 *
 * MOVED HERE FROM `poi-variants.ts` when the gallery verdict was adopted
 * (DEC-R7b-2a). It is a mesh transform with no opinion about variants, and the
 * registry that now needs it cannot import the file it used to live in without
 * a cycle.
 */
export function groundedMesh(mesh: MeshData): MeshData {
  let lowest = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    lowest = Math.min(lowest, mesh.positions[i] as number);
  }
  if (!Number.isFinite(lowest) || Math.abs(lowest) < 1e-9) return mesh;
  const positions = new Float32Array(mesh.positions);
  for (let i = 1; i < positions.length; i += 3) {
    positions[i] = (positions[i] as number) - lowest;
  }
  return { ...mesh, positions };
}

/**
 * The same mesh scaled UNIFORMLY so its height becomes `targetHeightM`.
 *
 * WHY ANY SCALING AT ALL (DEC-V5). The `D` prototype is a diorama — every kind
 * fits one display envelope, whatever the thing really is; its
 * `place_of_worship` is ~1.9 m where a church is 12 m. Uniform scaling
 * preserves every internal proportion while putting the model at real-world
 * scale, which DEC-R6-8 requires.
 *
 * **Normals are NOT touched.** A uniform scale turns no direction, so scaling
 * them would be a no-op at best and a denormalisation at worst — and a
 * denormalised normal shades wrong without changing any silhouette, which is an
 * invisible defect.
 *
 * A mesh with no height is returned unchanged rather than divided by zero: a
 * ground marking is flat on purpose, and Infinity in a position removes the
 * object from the scene with nothing reported.
 */
export function scaledToHeight(
  mesh: MeshData,
  targetHeightM: number,
): MeshData {
  // THE EXTENT, NOT THE PEAK. These are the same number for a grounded mesh —
  // which is every caller today, because `adopted()` runs `groundedMesh` first —
  // and they are not the same for a mesh sitting off the ground. Reading the
  // peak of a mesh spanning y = 10…12 as "height 12" scales a 2 m object to a
  // sixth of its target. Now that this is exported rather than private to the
  // variant registry, a caller that has not grounded its mesh is reachable.
  let lowest = Infinity;
  let peak = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i] as number;
    if (y < lowest) lowest = y;
    if (y > peak) peak = y;
  }
  const extent = peak - lowest;
  // Non-finite guards, not just positivity. `Infinity * 0` is `NaN`, and one
  // NaN position removes the whole object from the scene with nothing reported
  // — the failure mode `poi-models.test.ts` has a dedicated assertion for.
  if (!Number.isFinite(extent) || !(extent > 0)) return mesh;
  if (!Number.isFinite(targetHeightM) || !(targetHeightM > 0)) return mesh;
  const factor = targetHeightM / extent;
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    positions[i] = (mesh.positions[i] as number) * factor;
  }
  return { ...mesh, positions };
}

/**
 * The stand every family-S marker shares, and the height of its top.
 *
 * THE PROFILE IS THE PROTOTYPES' OWN, not a new design. All five galleries drew
 * the same three-part column — a splayed foot, a slightly tapered shaft and a
 * small cap — and the owner picked 27 symbols while looking at symbols standing
 * on it. Re-proportioning it here would change every one of those judgements
 * after the fact.
 */
export const POI_COLUMN_HEIGHT_M = 1.605;

/**
 * The box every family-S symbol is fitted into (DEC-S21).
 *
 * **THIS REPLACES DEC-S17, WHICH WAS BUILT ON A FALSE READING OF THE SOURCES.**
 * That decision said the 2.5 m is composed and asserted, never scaled: a column
 * plus the symbol as its author drew it, so a source that authored too tall
 * would fail by name rather than be silently squashed. The premise was that the
 * five galleries author their symbols at the envelope. **None of them does.**
 * Every one FITS at render time, and to different numbers — A to 0.90 m tall
 * and 1.10 m across, B to 0.92, C to ~0.88 / 1.15, E to 0.88 / 0.94.
 *
 * The consequence is not academic. `tourism=hotel`'s bed is authored 0.37 m
 * tall and 0.70 m wide; what the owner picked was that mesh scaled 1.57x by A's
 * own `prepare()`. Composing it as authored yields a 1.98 m marker whose
 * proportions against its neighbours are nothing like the row that was judged.
 *
 * SO THE FIT IS REPRODUCED, ONCE, HOUSE-WIDE. One envelope for all 27 rather
 * than each source's own: the five targets differ by less than the eye can
 * resolve (0.88–0.92), so every pick survives essentially as seen, while five
 * different envelopes would make a C symbol systematically shorter and wider
 * than an E symbol for no reason a viewer could see. That is the cross-file
 * coherence risk the adoption sheet named, and this is where it is paid off.
 *
 * **THE WIDTH CLAMP IS LOAD-BEARING AND CHANGES DEC-S3.** The smaller of the
 * two factors wins, so a wide flat symbol hits the span limit first and ends up
 * SHORTER than `POI_SYMBOL_HEIGHT_M`. Marker totals therefore range roughly
 * 2.1–2.5 m rather than being flat at 2.5. DEC-S3's "one fixed height, no
 * exceptions" is properly "one fixed ENVELOPE" — and the alternative, scaling
 * to height alone, turns the bed into a 1.70 m billboard wider than the column
 * is tall.
 */
export const POI_SYMBOL_HEIGHT_M = 0.9;

/** The symbol's largest permitted footprint, either horizontal axis. */
export const POI_SYMBOL_SPAN_M = 1.1;

/** The tallest a family-S marker can be: column plus a full-height symbol. */
export const POI_MARKER_MAX_HEIGHT_M =
  POI_COLUMN_HEIGHT_M + POI_SYMBOL_HEIGHT_M;

/**
 * The shared column: splayed foot, tapered shaft, capped top.
 *
 * Painted here rather than left to the model's `colour`, because a marker is
 * two materials by design — a mineral stand and an accented symbol — and an
 * unpainted column would take the symbol's accent for the whole stand.
 *
 * Ten sides, which is the prototypes' own count. It is a silhouette seen from
 * 300 m and from 2 m; eight facets read as faceted at the near distance and
 * twelve buys nothing at the far one.
 */
export function poiColumn(
  builder: MeshBuilder,
  stone = 0x9c988f,
  concrete = 0xaba79e,
): void {
  builder.paint(stone);
  prism(builder, 0.165, 0.145, 0.07, 10, 0);
  builder.paint(concrete);
  prism(builder, 0.095, 0.075, 1.5, 10, 0.07);
  builder.paint(stone);
  prism(builder, 0.082, 0.095, 0.06, 10, 1.545);
}

/**
 * The same mesh translated along Y.
 *
 * The symbol half of a family-S marker is authored with its own base at zero —
 * that is what DEC-S4 requires, so the identical geometry can float over a
 * building's roof with no column under it. Composing the standalone marker
 * therefore means lifting that mesh onto the column rather than re-authoring it
 * at a different datum, which would be two sources of truth for one shape.
 *
 * **Normals are untouched**, and deliberately: a translation turns nothing.
 * Transforming them would be a no-op at best and a denormalisation at worst,
 * and a denormalised normal shades wrong without changing any silhouette.
 */
export function liftedMesh(mesh: MeshData, byM: number): MeshData {
  if (!Number.isFinite(byM) || byM === 0) return mesh;
  const positions = new Float32Array(mesh.positions);
  for (let i = 1; i < positions.length; i += 3) {
    positions[i] = (positions[i] as number) + byM;
  }
  return { ...mesh, positions };
}

/**
 * A symbol recentred, floored and scaled into the shared envelope (DEC-S21).
 *
 * Reproduces what all five prototype galleries do to a symbol before drawing
 * it, which is the only way the ported mesh is the thing the owner picked. The
 * steps are theirs and the order matters:
 *
 *  1. **Recentre on X and Z, and floor Y to zero.** The sources author from
 *     whatever origin suited the drawing; the marker needs its base on the
 *     column top and its mass over the shaft.
 *  2. **Scale UNIFORMLY by the smaller of** `height / bounds.height` and
 *     `span / max(width, depth)`. Uniform because anything else re-proportions
 *     a shape that was chosen for its proportions.
 *
 * Translating before scaling is what keeps the base at zero: scaling about the
 * origin of an already-floored mesh cannot lift or sink it. The reverse order
 * scales the offset too and puts the symbol somewhere above or below its stand.
 *
 * **A degenerate mesh is returned unchanged rather than divided by zero.** A
 * symbol with no extent is a build that produced nothing, and `Infinity` in a
 * position removes the whole object from the scene with nothing reported —
 * the silent-absence failure this file keeps meeting.
 *
 * **Normals are untouched.** The recentre is a translation and the scale is
 * uniform, so no direction turns; transforming them would be a no-op at best
 * and a denormalisation at worst.
 */
/** Axis-aligned bounds of a mesh, as `[min, max]` per axis. */
function boundsOf(
  mesh: MeshData,
): readonly [[number, number], [number, number], [number, number]] {
  const bounds: [[number, number], [number, number], [number, number]] = [
    [Infinity, -Infinity],
    [Infinity, -Infinity],
    [Infinity, -Infinity],
  ];
  for (let i = 0; i < mesh.positions.length; i++) {
    const axis = bounds[i % 3] as [number, number];
    const value = mesh.positions[i] as number;
    axis[0] = Math.min(axis[0], value);
    axis[1] = Math.max(axis[1], value);
  }
  return bounds;
}

export function fittedSymbol(mesh: MeshData): MeshData {
  const [[minX, maxX], [minY, maxY], [minZ, maxZ]] = boundsOf(mesh);
  const height = maxY - minY;
  const span = Math.max(maxX - minX, maxZ - minZ);
  if (!Number.isFinite(height) || !Number.isFinite(span)) return mesh;
  if (!(height > 0) || !(span > 0)) return mesh;

  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const factor = Math.min(
    POI_SYMBOL_HEIGHT_M / height,
    POI_SYMBOL_SPAN_M / span,
  );
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i] = ((mesh.positions[i] as number) - centreX) * factor;
    positions[i + 1] = ((mesh.positions[i + 1] as number) - minY) * factor;
    positions[i + 2] = ((mesh.positions[i + 2] as number) - centreZ) * factor;
  }
  return { ...mesh, positions };
}
