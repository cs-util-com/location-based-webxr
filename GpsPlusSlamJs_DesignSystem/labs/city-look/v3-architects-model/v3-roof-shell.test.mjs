/**
 * The inferred roof's geometry: a thin sheet with an overhang. Node's runner.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { roofShell } from "./v3-roof-shell.js";

const box = {
  centre: { x: 10, y: -4 },
  axis: { x: Math.cos(0.4), y: Math.sin(0.4) },
  cross: { x: -Math.sin(0.4), y: Math.cos(0.4) },
  halfLength: 7,
  halfWidth: 4.5,
};
const base = { box, eaveY: 6, riseM: 3, overhangM: 0.4, thicknessM: 0.2 };

function faces(mesh) {
  const { positions: p, normals: n, indices: ix } = mesh;
  const at = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  const out = [];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [at(p, ix[t]), at(p, ix[t + 1]), at(p, ix[t + 2])];
    const u = a.map((v, i) => b[i] - v);
    const w = a.map((v, i) => c[i] - v);
    const cross = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const stored = at(n, ix[t]);
    out.push({
      dot: cross[0] * stored[0] + cross[1] * stored[1] + cross[2] * stored[2],
      area: Math.hypot(...cross) / 2,
    });
  }
  return out;
}

for (const shape of ["gabled", "hipped"]) {
  // Why: single-sided rendering. A face wound against its normal vanishes from
  // outside and is lit wrongly, and only some orientations would show it.
  test(`${shape}: every face is wound along its stored normal`, () => {
    for (const face of faces(roofShell({ ...base, shape }))) {
      assert.ok(face.area > 1e-6, "no degenerate triangle");
      assert.ok(face.dot > 0, "winding agrees with the normal");
    }
  });

  // Why: true heights. The roof is inferred, but its top is what the sum of
  // eave and rise says, and it must never exceed it.
  test(`${shape}: the top is exactly eave plus rise`, () => {
    const { positions } = roofShell({ ...base, shape });
    let top = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      top = Math.max(top, positions[i]);
    }
    assert.ok(Math.abs(top - 9) < 1e-4, String(top));
  });

  // Why: a reload must draw the same roof.
  test(`${shape}: the same input gives the same buffers`, () => {
    const a = roofShell({ ...base, shape });
    const b = roofShell({ ...base, shape });
    assert.deepEqual([...a.positions], [...b.positions]);
    assert.deepEqual([...a.indices], [...b.indices]);
  });
}

// Why: the mesh frame is east, up, MINUS north; this is the mirrored-city bug
// the library once had, so it is pinned against the box's own ENU centre.
test("the shell sits on the box in render axes (z is minus north)", () => {
  const { positions } = roofShell({ ...base, shape: "gabled" });
  let x = 0;
  let z = 0;
  const count = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    x += positions[i];
    z += positions[i + 2];
  }
  assert.ok(Math.abs(x / count - 10) < 1e-3);
  assert.ok(Math.abs(z / count - 4) < 1e-3);
});

// Why: gable walls must take the wall's look and storey lines, the sheet the
// roof's. The flag is what tells the shader; a hip has no gable at all.
test("only the gable ends are not roof", () => {
  const gabled = roofShell({ ...base, shape: "gabled" });
  assert.equal(gabled.roofFlags.filter((f) => f === 0).length, 6);
  assert.equal(gabled.roofFlags.length, gabled.positions.length / 3);
  const hipped = roofShell({ ...base, shape: "hipped" });
  assert.equal(hipped.roofFlags.filter((f) => f === 0).length, 0);
});

// Why: a square hip collapses its ridge to a point; two coincident vertices
// must not produce a degenerate triangle or a NaN normal.
test("a square hip closes to a pyramid without degenerate faces", () => {
  const square = { ...box, halfLength: 5, halfWidth: 5 };
  const shell = roofShell({ ...base, box: square, shape: "hipped" });
  for (const face of faces(shell)) assert.ok(face.area > 1e-6 && face.dot > 0);
});
