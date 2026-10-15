/**
 * The mesh cursor's rotation from the neighbourhood of the hit (mesh-cursor
 * smoothing plan 2026-10-15-0944): the owner's "sampling from the data
 * around the cursor position to average it a little bit stronger on the
 * rotation part".
 *
 * Why these tests matter: the ring lies flat to the normal it is given. One
 * triangle of a mesh built from noisy depth tilts by several degrees from
 * its neighbours, so the ring wobbled as the cursor crossed them; the
 * average over a small radius must calm that on a floor, must not tilt the
 * ring toward a wall at a corner (the angle gate), and must come out in
 * WORLD coordinates for a mesh hanging under the turned, moved world group.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Intersection,
} from "three";

import {
  DEFAULT_NEIGHBOURHOOD_NORMAL,
  neighbourhoodNormal,
} from "./mesh-neighbourhood-normal.js";

const CELL_M = 0.15;
const UP = new Vector3(0, 1, 0);

/** Deterministic noise in [-1, 1]: the sweeps must not flake. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * A floor of `n` x `n` cells of 0.15 m around the origin (the occupancy
 * grid's cell size), each vertex lifted by up to `noiseM`, wound to face
 * up; optional `wallAtX`: a wall in the plane x = wallAtX rising 1 m,
 * facing -x, the floor ending there.
 */
function floorMesh(
  options: {
    n?: number;
    noiseM?: number;
    seed?: number;
    wallAtX?: number;
  } = {},
): Mesh {
  const n = options.n ?? 16;
  const rand = noise(options.seed ?? 1);
  const half = (n * CELL_M) / 2;
  const positions: number[] = [];
  const index: number[] = [];
  const at = (i: number, j: number) => i * (n + 1) + j;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const x = Math.min(-half + i * CELL_M, options.wallAtX ?? Infinity);
      positions.push(x, (options.noiseM ?? 0) * rand(), -half + j * CELL_M);
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      index.push(at(i, j), at(i, j + 1), at(i + 1, j));
      index.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  if (options.wallAtX !== undefined) {
    const base = positions.length / 3;
    const x = options.wallAtX;
    for (let k = 0; k <= 6; k += 1) {
      for (let j = 0; j <= n; j += 1) {
        positions.push(x, k * CELL_M, -half + j * CELL_M);
      }
    }
    const w = (k: number, j: number) => base + k * (n + 1) + j;
    for (let k = 0; k < 6; k += 1) {
      for (let j = 0; j < n; j += 1) {
        // Facing -x: (b - a) x (c - a) along -x.
        index.push(w(k, j), w(k, j + 1), w(k + 1, j));
        index.push(w(k + 1, j), w(k, j + 1), w(k + 1, j + 1));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return new Mesh(geometry, new MeshBasicMaterial());
}

const raycaster = new Raycaster();

/** The hit straight down onto (x, z), as the cursor's raycast gives it. */
function hitDown(mesh: Mesh, x: number, z: number): Intersection {
  raycaster.set(new Vector3(x, 2, z), new Vector3(0, -1, 0));
  const [hit] = raycaster.intersectObject(mesh, false);
  if (hit === undefined)
    throw new Error(`no hit at ${String(x)}, ${String(z)}`);
  return hit;
}

function faceNormalWorld(hit: Intersection): Vector3 {
  return hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
}

/** Mean tilt from up, in degrees, of the face normals and of the averaged
 *  normals over a grid of hits on a noisy floor. */
function tilts(
  options: { radiusM: number; maxAngleDeg?: number },
  noiseM = 0.02,
): { face: number; averaged: number } {
  let face = 0;
  let averaged = 0;
  let count = 0;
  for (let seed = 1; seed <= 4; seed += 1) {
    const mesh = floorMesh({ noiseM, seed });
    mesh.updateMatrixWorld(true);
    for (let x = -0.6; x <= 0.6; x += 0.13) {
      for (let z = -0.6; z <= 0.6; z += 0.17) {
        const hit = hitDown(mesh, x, z);
        face += (faceNormalWorld(hit).angleTo(UP) * 180) / Math.PI;
        averaged +=
          (neighbourhoodNormal(hit, options)!.angleTo(UP) * 180) / Math.PI;
        count += 1;
      }
    }
  }
  return { face: face / count, averaged: averaged / count };
}

describe("neighbourhoodNormal", () => {
  it("gives the floor's world normal under a turned and moved world group", () => {
    const group = new Group();
    group.rotation.set(0.4, -1.1, 0.25);
    group.position.set(5, -2, 3);
    const mesh = floorMesh();
    group.add(mesh);
    group.updateMatrixWorld(true);
    raycaster.set(
      new Vector3(0.1, 2, 0.2).applyMatrix4(mesh.matrixWorld),
      new Vector3(0, -1, 0).transformDirection(mesh.matrixWorld),
    );
    const [hit] = raycaster.intersectObject(mesh, false);
    const expected = UP.clone().transformDirection(mesh.matrixWorld);
    expect(neighbourhoodNormal(hit!)!.angleTo(expected)).toBeLessThan(1e-6);
  });

  it("calms a noisy floor: the averaged normal tilts far less than one triangle", () => {
    const { face, averaged } = tilts({ radiusM: 0.3 });
    expect(face).toBeGreaterThan(5); // the noise is real: several degrees
    expect(averaged).toBeLessThan(face / 2);
  });

  it("does not tilt toward the wall at a corner (the angle gate)", () => {
    const mesh = floorMesh({ wallAtX: 0.3 });
    mesh.updateMatrixWorld(true);
    const hit = hitDown(mesh, 0.2, 0.05); // 10 cm from the wall
    const gated = neighbourhoodNormal(hit, { radiusM: 0.3, maxAngleDeg: 45 })!;
    expect((gated.angleTo(UP) * 180) / Math.PI).toBeLessThan(1);
    // Without the gate the wall's triangles pull the ring over.
    const ungated = neighbourhoodNormal(hit, {
      radiusM: 0.3,
      maxAngleDeg: 180,
    })!;
    expect((ungated.angleTo(UP) * 180) / Math.PI).toBeGreaterThan(10);
  });

  it("weights each triangle by its area: a sliver cannot tilt the ring", () => {
    // Why: a mesher leaves thin slivers whose normals are the noisiest; an
    // unweighted mean would give a 1 % sliver the vote of a whole cell.
    const geometry = new BufferGeometry();
    const tilt = Math.PI / 6;
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        [
          // A flat triangle of 0.02 m^2, facing up.
          -0.1,
          0,
          -0.1,
          -0.1,
          0,
          0.1,
          0.1,
          0,
          -0.1,
          // A sliver 30 degrees off, about 1 % of that area.
          0.05,
          0,
          0.05,
          0.05,
          0,
          0.07,
          0.05 + 0.02 * Math.cos(tilt),
          -0.02 * Math.sin(tilt),
          0.05,
        ],
        3,
      ),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const hit = hitDown(mesh, -0.05, -0.05);
    const n = neighbourhoodNormal(hit, { radiusM: 0.3, maxAngleDeg: 45 })!;
    expect((n.angleTo(UP) * 180) / Math.PI).toBeLessThan(1);
  });

  it("is the face normal when nothing lies within the radius", () => {
    const mesh = floorMesh({ noiseM: 0.02 });
    mesh.updateMatrixWorld(true);
    const hit = hitDown(mesh, 0.1, 0.1);
    expect(
      neighbourhoodNormal(hit, { radiusM: 0 })!.angleTo(faceNormalWorld(hit)),
    ).toBeLessThan(1e-9);
  });

  it("works on a mesh without an index", () => {
    const indexed = floorMesh({ noiseM: 0.02, n: 6 });
    const plain = new Mesh(indexed.geometry.toNonIndexed(), indexed.material);
    indexed.updateMatrixWorld(true);
    plain.updateMatrixWorld(true);
    const a = neighbourhoodNormal(hitDown(indexed, 0.05, 0.05))!;
    const b = neighbourhoodNormal(hitDown(plain, 0.05, 0.05))!;
    expect(a.angleTo(b)).toBeLessThan(1e-6);
  });

  it("is null for a hit without a face or a mesh without positions", () => {
    const mesh = floorMesh();
    expect(
      neighbourhoodNormal({ ...hitDown(mesh, 0, 0), face: null }),
    ).toBeNull();
    const empty = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    expect(
      neighbourhoodNormal({ ...hitDown(mesh, 0, 0), object: empty }),
    ).toBeNull();
    expect(
      neighbourhoodNormal({ ...hitDown(mesh, 0, 0), object: new Group() }),
    ).toBeNull();
  });

  it("refuses a negative or non-finite setting", () => {
    const hit = hitDown(floorMesh(), 0, 0);
    expect(() => neighbourhoodNormal(hit, { radiusM: -1 })).toThrow(RangeError);
    expect(() => neighbourhoodNormal(hit, { maxAngleDeg: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("keeps conservative defaults: two cells and half a right angle", () => {
    expect(DEFAULT_NEIGHBOURHOOD_NORMAL).toEqual({
      radiusM: 0.3,
      maxAngleDeg: 45,
    });
  });
});

describe("neighbourhoodNormal invariants (property)", () => {
  it("is a finite unit vector within the gate of the face normal, on any noisy floor at any hit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.double({ min: -0.9, max: 0.9, noNaN: true }),
        fc.double({ min: -0.9, max: 0.9, noNaN: true }),
        fc.double({ min: 0, max: 0.8, noNaN: true }),
        fc.double({ min: 1, max: 89, noNaN: true }),
        (seed, noiseM, x, z, radiusM, maxAngleDeg) => {
          const mesh = floorMesh({ noiseM, seed, n: 14 });
          mesh.updateMatrixWorld(true);
          const hit = hitDown(mesh, x, z);
          const n = neighbourhoodNormal(hit, { radiusM, maxAngleDeg })!;
          expect(n.toArray().every(Number.isFinite)).toBe(true);
          expect(Math.abs(n.length() - 1)).toBeLessThan(1e-9);
          // Every triangle that counts lies within the gate of the face, so
          // their area-weighted sum does too.
          expect(
            (n.angleTo(faceNormalWorld(hit)) * 180) / Math.PI,
          ).toBeLessThanOrEqual(maxAngleDeg + 1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("neighbourhoodNormal sweeps (owner rule 2026-09-13)", () => {
  it("calms the floor more with a larger radius, and at least halves the tilt from 0.2 m up", () => {
    // Verdict across 0.1 - 0.6 m: the tilt falls (within a tenth of a
    // degree) as the radius grows; from two cells (0.3 m, the default)
    // down to 0.2 m it is at most half a triangle's. Above 0.3 m the gain
    // is small and a bigger radius reaches farther onto neighbouring
    // surfaces (a kerb, a step), which is why the default stops there.
    const radii = [0.1, 0.15, 0.2, 0.3, 0.45, 0.6];
    const rows = radii.map((radiusM) => ({ radiusM, ...tilts({ radiusM }) }));
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.averaged).toBeLessThan(rows[i - 1]!.averaged + 0.1);
    }
    for (const row of rows.filter((r) => r.radiusM >= 0.2)) {
      expect(row.averaged, `radius ${String(row.radiusM)}`).toBeLessThan(
        row.face / 2,
      );
    }
  });

  it("holds a corner upright and a noisy floor calm for every gate from 30 to 60 degrees", () => {
    // The gate's trade: too narrow drops the floor's own noisy triangles,
    // too wide lets the wall in. For a 90-degree corner and the noise
    // here, the whole range 30 - 60 works; 45 is its middle.
    for (const maxAngleDeg of [30, 45, 60]) {
      const corner = floorMesh({ wallAtX: 0.3, noiseM: 0.01 });
      corner.updateMatrixWorld(true);
      for (const x of [0.05, 0.15, 0.25]) {
        const n = neighbourhoodNormal(hitDown(corner, x, 0.05), {
          radiusM: 0.3,
          maxAngleDeg,
        })!;
        expect(
          (n.angleTo(UP) * 180) / Math.PI,
          `gate ${String(maxAngleDeg)}, x ${String(x)}`,
        ).toBeLessThan(6);
      }
      const { face, averaged } = tilts({ radiusM: 0.3, maxAngleDeg });
      expect(averaged, `gate ${String(maxAngleDeg)}`).toBeLessThan(face / 2);
    }
  });
});
