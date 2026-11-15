/**
 * Small triangle meshes for the simplifier's and the level-of-detail
 * pass's tests: a height field over a square (an open border, as a terrain
 * patch or a cliff face) and a sphere (closed, as a scanned rock), each
 * with smooth normals and texture coordinates.
 */

export interface TestMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/** An `n` x `n` cell grid over [0, size]^2 with heights `height(u, v)`,
 *  u and v in [0, 1]. */
export function heightField(
  n: number,
  height: (u: number, v: number) => number,
  size = 1,
): TestMesh {
  const side = n + 1;
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const uvs = new Float32Array(side * side * 2);
  const h = (u: number, v: number) => height(u, v) * size;
  const e = 1 / (4 * n);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const u = i / n;
      const v = j / n;
      const k = j * side + i;
      positions.set([u * size, h(u, v), v * size], 3 * k);
      const dx = (h(u + e, v) - h(u - e, v)) / (2 * e * size);
      const dz = (h(u, v + e) - h(u, v - e)) / (2 * e * size);
      const l = Math.hypot(dx, 1, dz);
      normals.set([-dx / l, 1 / l, -dz / l], 3 * k);
      uvs.set([u, v], 2 * k);
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { positions, normals, uvs, indices };
}

/** A closed sphere of `radius`: an octahedron subdivided `depth` times and
 *  pushed out, with `bump(x, y, z)` (on the unit sphere) added to the
 *  radius. Texture coordinates are a planar projection, so there is no
 *  seam to lock. */
export function sphere(
  depth: number,
  radius = 1,
  bump: (x: number, y: number, z: number) => number = () => 0,
): TestMesh {
  const verts: number[][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let faces: number[][] = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  for (let d = 0; d < depth; d++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const known = mid.get(key);
      if (known !== undefined) return known;
      const p = verts[a]!.map((x, k) => (x + verts[b]![k]!) / 2);
      const l = Math.hypot(p[0]!, p[1]!, p[2]!);
      verts.push(p.map((x) => x / l));
      mid.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a!, b!);
      const bc = midpoint(b!, c!);
      const ca = midpoint(c!, a!);
      next.push([a!, ab, ca], [ab, b!, bc], [ca, bc, c!], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);
  verts.forEach(([x, y, z], k) => {
    const r = radius * (1 + bump(x!, y!, z!));
    positions.set([x! * r, y! * r, z! * r], 3 * k);
    normals.set([x!, y!, z!], 3 * k);
    uvs.set([(x! + 1) / 2, (z! + 1) / 2], 2 * k);
  });
  return { positions, normals, uvs, indices: Uint32Array.from(faces.flat()) };
}
