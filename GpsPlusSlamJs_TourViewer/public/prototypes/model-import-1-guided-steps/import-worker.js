// The guided model import's helper thread: everything slow runs here, so
// the page never freezes. Three jobs:
// - "build": join split points and order every collapse once (the
//   progressive simplifier of the model-lod-1 prototype), with progress;
// - "chain": the author's level and its two coarser levels, each with its
//   largest deviation from the full model, for the distance step;
// - "encode": one picture made smaller in the shelf's format, its bytes
//   returned so the page shows the real size.
import {
  weldVertices,
  remapAttribute,
  buildProgressive,
  stepsFor,
  levelIndices,
  surfaceDistance,
  surfaceGrid,
} from "../model-lod-1/lod-simplify.js";

const SHARES = [1, 1 / 4, 1 / 16];
const ERROR_SAMPLES = 2500;

/** The model this helper holds, after "build". */
let held = null;

const post = (message, transfer = []) => self.postMessage(message, transfer);

function build(m) {
  const t0 = performance.now();
  post({ type: "progress", id: m.id, f: 0.02, label: "Joining split points" });
  const weld = weldVertices(
    { position: m.position, normal: m.normal, uv: m.uv },
    m.index,
    2,
  );
  const P = remapAttribute(m.position, 3, weld.remap, weld.count);
  const N = m.normal
    ? remapAttribute(m.normal, 3, weld.remap, weld.count)
    : null;
  const U = m.uv ? remapAttribute(m.uv, 2, weld.remap, weld.count) : null;
  const T = weld.indices.length / 3;
  post({ type: "progress", id: m.id, f: 0.06, label: "Studying the shape" });
  const prog = buildProgressive(
    {
      positions: P,
      indices: weld.indices,
      attributes: U ? [{ data: U, size: 2, weight: 1 }] : [],
    },
    {
      normals: N,
      onProgress: (alive) =>
        post({
          type: "progress",
          id: m.id,
          f: 0.06 + 0.84 * Math.min(1, (T - alive) / T),
          label: "Ordering the triangles",
        }),
    },
  );
  post({
    type: "progress",
    id: m.id,
    f: 0.94,
    label: "Preparing the comparison",
  });
  held = {
    P,
    lod0: weld.indices,
    prog,
    grid: surfaceGrid(P, weld.indices),
    errors: new Map(),
  };
  const progCopy = {
    order: prog.order.slice(),
    triDeath: prog.triDeath.slice(),
    indices: prog.indices.slice(),
    wParent: prog.wParent.slice(),
    wStep: prog.wStep.slice(),
    stepAlive: prog.stepAlive.slice(),
    minTriangles: prog.minTriangles,
  };
  const out = {
    type: "built",
    id: m.id,
    position: P.slice(),
    normal: N,
    uv: U,
    lod0: weld.indices.slice(),
    prog: progCopy,
    ms: performance.now() - t0,
  };
  const transfer = [
    out.position.buffer,
    out.lod0.buffer,
    ...Object.values(progCopy)
      .filter((v) => v?.buffer)
      .map((v) => v.buffer),
  ];
  if (N) {
    transfer.push(N.buffer);
  }
  if (U) {
    transfer.push(U.buffer);
  }
  post(out, transfer);
}

function errorOf(steps, indices) {
  if (steps === 0) {
    return 0;
  }
  if (!held.errors.has(steps)) {
    const d = surfaceDistance(
      held.P,
      held.lod0,
      held.P,
      indices,
      ERROR_SAMPLES,
      held.grid,
    );
    held.errors.set(steps, d.max);
  }
  return held.errors.get(steps);
}

function chain(m) {
  if (held === null) {
    throw new Error("the shape is not ready yet");
  }
  const parts = [];
  const levels = [];
  let start = 0;
  for (const share of SHARES) {
    const steps = stepsFor(held.prog, Math.round(m.top * share));
    const ix = levelIndices(held.prog, steps);
    if (levels.length && ix.length >= levels[levels.length - 1].count) {
      continue;
    }
    levels.push({ start, count: ix.length, error: errorOf(steps, ix) });
    parts.push(ix);
    start += ix.length;
  }
  const all = new Uint32Array(start);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  post({ type: "chain", id: m.id, top: m.top, levels, indices: all }, [
    all.buffer,
  ]);
}

/** The largest size within `limit` on the longest side, never enlarged. */
function fit(width, height, limit) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encode(m) {
  const bitmap = await createImageBitmap(new Blob([m.bytes], { type: m.mime }));
  try {
    const size = fit(bitmap.width, bitmap.height, m.side);
    const resized =
      size.width !== bitmap.width || size.height !== bitmap.height;
    const base = {
      type: "encoded",
      id: m.id,
      key: m.key,
      width: size.width,
      height: size.height,
      sourceSide: Math.max(bitmap.width, bitmap.height),
    };
    if (!resized && m.format.type === m.mime && m.mime === "image/png") {
      post({ ...base, kept: true, size: m.bytes.length });
      return;
    }
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob(m.format);
    if (blob.type !== m.format.type) {
      throw new Error(`this browser cannot write ${m.format.type} pictures`);
    }
    if (!resized && blob.size >= m.bytes.length) {
      post({ ...base, kept: true, size: m.bytes.length });
      return;
    }
    post({ ...base, kept: false, size: blob.size, blob });
  } finally {
    bitmap.close();
  }
}

const JOBS = { build, chain, encode };

self.onmessage = async (event) => {
  const m = event.data;
  try {
    const job = JOBS[m?.type];
    if (!job) {
      throw new Error(`unknown job ${m?.type}`);
    }
    await job(m);
  } catch (error) {
    post({
      type: "error",
      id: m?.id,
      message: String(error?.message ?? error),
    });
  }
};
