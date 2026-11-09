/**
 * Where each wall vertex lies along its wall, which is what lets openings be
 * spaced to a wall instead of being cut by its corners. Node's runner.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { wallSpans } from "./v3-wall-span.js";

/** One wall quad 8 m long from (2, 3) towards +x, plus one flat roof triangle. */
const mesh = {
  positions: new Float32Array([
    2, 0, 3, 10, 0, 3, 10, 6, 3, 2, 6, 3, 0, 6, 0, 4, 6, 0, 0, 6, 4,
  ]),
  normals: new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 6, 5]),
};

// Why: both triangles of a quad must agree, or an opening would be sheared
// across the wall's diagonal.
test("every corner of a wall gets its place along the wall and the length", () => {
  const spans = wallSpans(mesh);
  const at = (v) => [spans[v * 2], spans[v * 2 + 1]];
  assert.deepEqual([at(0)[1], at(1)[1], at(2)[1], at(3)[1]], [8, 8, 8, 8]);
  assert.equal(Math.abs(at(1)[0] - at(0)[0]), 8);
  assert.equal(at(0)[0], at(3)[0]);
  assert.equal(at(1)[0], at(2)[0]);
});

// Why: a length of 0 is how the shader knows a face has no openings.
test("a face that is not a wall gets no span", () => {
  const spans = wallSpans(mesh);
  assert.deepEqual([...spans.slice(8)], [0, 0, 0, 0, 0, 0]);
});
