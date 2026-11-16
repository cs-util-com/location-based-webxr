// The bench's simplifier Worker: one mesh welded and ordered once by the
// progressive simplifier of the model LOD prototype, so the page itself
// never stalls. Afterwards any share of triangles is only an index list,
// made on the page in milliseconds. It then measures how far the shape
// moves at a ladder of shares (the distance levels' errors), one answer
// at a time, so the distance ruler fills in while the author works.
import {
  weldVertices,
  remapAttribute,
  buildProgressive,
  stepsFor,
  levelIndices,
  surfaceDistance,
  surfaceGrid,
} from "../model-lod-1/lod-simplify.js";

/** Shares of the full triangle count whose deviation is measured. */
const LADDER = [
  0.75, 0.5, 0.35, 0.25, 0.17, 0.12, 0.085, 0.06, 0.042, 0.03, 0.021, 0.015,
  0.01,
];
const SAMPLES = 2000;

function build({ id, attributes, index }) {
  const byName = Object.fromEntries(attributes.map((a) => [a.name, a]));
  const position = byName.position.data;
  const normal = byName.normal?.data ?? null;
  const uv = byName.uv?.data ?? null;
  const weld = weldVertices({ position, normal, uv }, index, 2);
  const remapped = attributes.map((a) => ({
    name: a.name,
    size: a.size,
    data: remapAttribute(a.data, a.size, weld.remap, weld.count),
  }));
  const P = remapped.find((a) => a.name === "position").data;
  const N = remapped.find((a) => a.name === "normal")?.data ?? null;
  const U = remapped.find((a) => a.name === "uv")?.data ?? null;
  const t0 = performance.now();
  const prog = buildProgressive(
    {
      positions: P,
      indices: weld.indices,
      attributes: U ? [{ data: U, size: 2, weight: 1 }] : [],
    },
    { normals: N },
  );
  const buildMs = performance.now() - t0;
  const copy = {
    order: prog.order.slice(),
    triDeath: prog.triDeath.slice(),
    indices: prog.indices.slice(),
    wParent: prog.wParent.slice(),
    wStep: prog.wStep.slice(),
    stepAlive: prog.stepAlive.slice(),
    minTriangles: prog.minTriangles,
    triangleCount: prog.triangleCount,
  };
  // Copies go to the page: the measuring below still reads the originals.
  const sent = remapped.map((a) => ({ ...a, data: a.data.slice() }));
  const transfer = [
    ...sent.map((a) => a.data.buffer),
    copy.order.buffer,
    copy.triDeath.buffer,
    copy.indices.buffer,
    copy.wParent.buffer,
    copy.wStep.buffer,
    copy.stepAlive.buffer,
  ];
  // The full level's index list, for the page's original-sized buffer.
  const full = weld.indices.slice();
  transfer.push(full.buffer);
  self.postMessage(
    {
      type: "built",
      id,
      attributes: sent,
      prog: copy,
      full,
      buildMs,
    },
    transfer,
  );
  measure(id, prog, P, weld.indices);
}

function measure(id, prog, P, full) {
  const grid = surfaceGrid(P, full);
  const total = full.length / 3;
  let worst = 0;
  for (const share of LADDER) {
    const target = Math.round(total * share);
    if (target < prog.minTriangles) {
      break;
    }
    const steps = stepsFor(prog, target);
    const ix = levelIndices(prog, steps);
    const d = surfaceDistance(P, full, P, ix, SAMPLES, grid).max;
    // Sampling noise must never make a coarser level read finer.
    worst = Math.max(worst, d);
    self.postMessage({
      type: "error",
      id,
      share: ix.length / 3 / total,
      error: worst,
    });
  }
  self.postMessage({ type: "measured", id });
}

self.addEventListener("message", (event) => {
  const message = event.data;
  try {
    if (message?.type === "build") {
      build(message);
    }
  } catch (error) {
    self.postMessage({
      type: "failed",
      id: message?.id,
      reason: String(error?.message ?? error),
    });
  }
});
