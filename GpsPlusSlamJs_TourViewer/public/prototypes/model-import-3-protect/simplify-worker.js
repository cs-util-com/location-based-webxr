// The protect prototype's simplifier Worker. Each part of a model is
// welded and ordered once by the progressive simplifier of the model LOD
// prototype ("plain" ordering). When the author marks a region, the part
// is ordered again with the protection attribute of protect-mask.js
// ("protected" ordering), so the page never stalls; any share of
// triangles is then only an index list, made on the page. On request it
// measures how far the saved distance levels move the shape.
import {
  weldVertices,
  remapAttribute,
  buildProgressive,
  stepsFor,
  levelIndices,
  surfaceDistance,
  surfaceGrid,
} from "../model-lod-1/lod-simplify.js";
import { protectionAttribute } from "./protect-mask.js";

const SAMPLES = 2000;
/** part index -> { P, N, U, full, grid, progs: { plain, protected } } */
const parts = new Map();

function progCopy(prog) {
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
  const transfer = [
    copy.order.buffer,
    copy.triDeath.buffer,
    copy.indices.buffer,
    copy.wParent.buffer,
    copy.wStep.buffer,
    copy.stepAlive.buffer,
  ];
  return { copy, transfer };
}

function order(part, id, extra, ticket, variant) {
  const total = part.full.length / 3;
  const attributes = part.U ? [{ data: part.U, size: 2, weight: 1 }] : [];
  if (extra) {
    attributes.push(extra);
  }
  const t0 = performance.now();
  const prog = buildProgressive(
    { positions: part.P, indices: part.full, attributes },
    {
      normals: part.N,
      onProgress(alive) {
        self.postMessage({
          type: "progress",
          id,
          ticket,
          variant,
          done: Math.min(0.99, (total - alive) / total),
        });
      },
    },
  );
  const buildMs = performance.now() - t0;
  part.progs[variant] = prog;
  const { copy, transfer } = progCopy(prog);
  self.postMessage(
    { type: "ordered", id, ticket, variant, prog: copy, buildMs },
    transfer,
  );
}

function weld({ id, attributes, index }) {
  const byName = Object.fromEntries(attributes.map((a) => [a.name, a]));
  const w = weldVertices(
    {
      position: byName.position.data,
      normal: byName.normal?.data ?? null,
      uv: byName.uv?.data ?? null,
    },
    index,
    2,
  );
  const remapped = attributes.map((a) => ({
    name: a.name,
    size: a.size,
    data: remapAttribute(a.data, a.size, w.remap, w.count),
  }));
  const get = (name) => remapped.find((a) => a.name === name)?.data ?? null;
  const part = {
    P: get("position"),
    N: get("normal"),
    U: get("uv"),
    full: w.indices,
    grid: null,
    progs: {},
  };
  parts.set(id, part);
  const sent = remapped.map((a) => ({ ...a, data: a.data.slice() }));
  const full = w.indices.slice();
  self.postMessage(
    { type: "welded", id, attributes: sent, full, remap: w.remap },
    [...sent.map((a) => a.data.buffer), full.buffer],
  );
  order(part, id, null, 0, "plain");
}

function protect({ id, ticket, weights, strength }) {
  const part = parts.get(id);
  if (!part) {
    throw new Error("the part is not loaded");
  }
  order(
    part,
    id,
    protectionAttribute(part.P, part.U, weights, strength),
    ticket,
    "protected",
  );
}

function measure({ id, ticket, variant, targets }) {
  const part = parts.get(id);
  const prog = part?.progs[variant];
  if (!prog) {
    return;
  }
  part.grid ??= surfaceGrid(part.P, part.full);
  let worst = 0;
  const errors = [];
  for (const target of targets) {
    const ix = levelIndices(prog, stepsFor(prog, target));
    const d = surfaceDistance(part.P, part.full, part.P, ix, SAMPLES, part.grid)
      .max;
    // Sampling noise must never make a coarser level read finer.
    worst = Math.max(worst, d);
    errors.push(worst);
  }
  self.postMessage({ type: "measured", id, ticket, variant, errors });
}

self.addEventListener("message", (event) => {
  const m = event.data;
  try {
    if (m?.type === "weld") {
      weld(m);
    } else if (m?.type === "protect") {
      protect(m);
    } else if (m?.type === "measure") {
      measure(m);
    }
  } catch (error) {
    self.postMessage({
      type: "failed",
      id: m?.id,
      ticket: m?.ticket,
      reason: String(error?.message ?? error),
    });
  }
});
