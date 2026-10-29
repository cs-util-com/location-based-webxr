// Throwaway prototype: cuts an image AI's four-pose sheet into four equal
// character frames, in plain browser JS. Not wired to the app.
//
// Steps (each named, so the page can say WHICH one failed):
//   read -> background -> find -> lineup -> check
//
// Background: alpha channel when the image has one (near-opaque alpha is
// snapped to opaque); otherwise a flood fill from the image border over
// the flat colour sampled at the corners (never a global colour key, which
// would punch holes in eye whites and highlights).
// Figures: runs of columns that contain figure pixels, separated by empty
// gaps; never fixed quarters.
// Line-up: one common scale, every figure's lowest row on one baseline,
// centred on its lower body (so the pointing arm does not shift the body).

export const DEFAULTS = {
  whiteTol: 24, // max channel distance from the corner colour that still counts as background
  alphaThr: 128, // alpha at or above this is figure
  minGapFrac: 0.004, // a gap narrower than this fraction of the width does not separate figures
  minColFrac: 0.004, // a column needs this fraction of the height in figure pixels to count
  wobbleThr: 0.05, // body difference (below the head band) above this suggests the steady body
  bandFrac: 0.3, // the head band: top 30 % of the figure
  featherFrac: 0.05, // feather of the head band, fraction of the figure height
  shift: 3, // best-shift search, +- px in the cell
  maxPx: 40e6, // refuse larger images
  workMax: 3000, // analyse at most this long side
  cellW: 400,
  cellH: 800,
};

export const STEP_NAMES = {
  read: "Reading the picture",
  background: "Removing the background",
  find: "Finding the four poses",
  lineup: "Lining them up on one ground line",
  check: "Checking the talking and pointing poses",
};

export class CutError extends Error {
  constructor(step, code, message, detail = {}) {
    super(message);
    this.step = step;
    this.code = code;
    this.detail = detail;
  }
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export async function cutSheet(blob, opt = {}, onStep = async () => {}) {
  const o = { ...DEFAULTS, ...opt };
  await onStep("read");
  if (!blob || !blob.size)
    throw new CutError("read", "empty-file", "The file is empty.");
  if (blob.type && !/^image\//.test(blob.type))
    throw new CutError(
      "read",
      "not-image",
      'This file is not a picture (it is "' + blob.type + '").',
    );
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch (e) {
    throw new CutError(
      "read",
      "decode",
      "This picture could not be opened. Use a PNG, JPEG or WebP file.",
    );
  }
  const W0 = bmp.width,
    H0 = bmp.height;
  if (W0 * H0 > o.maxPx)
    throw new CutError(
      "read",
      "too-big",
      `This picture is very large (${((W0 * H0) / 1e6).toFixed(0)} megapixels). Ask the AI for about 1536 x 1024.`,
    );
  if (W0 < 300 || H0 < 150)
    throw new CutError(
      "read",
      "too-small",
      `This picture is very small (${W0} x ${H0}). Save the full-size image from the AI, not a thumbnail.`,
    );
  const k = Math.min(1, o.workMax / Math.max(W0, H0));
  const W = Math.round(W0 * k),
    H = Math.round(H0 * k);
  const src = makeCanvas(W, H);
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, W, H);
  if (bmp.close) bmp.close();
  const img = sctx.getImageData(0, 0, W, H);
  try {
    return await analyse(src, sctx, img, W, H, W0, H0, k, o, onStep);
  } catch (e) {
    if (e instanceof CutError) e.source = src;
    throw e;
  }
}

async function analyse(src, sctx, img, W, H, W0, H0, k, o, onStep) {
  await onStep("background");
  const bg = removeBackground(img, W, H, o);
  sctx.putImageData(img, 0, 0);

  await onStep("find");
  const found = findFigures(bg.mask, W, H, o);

  await onStep("lineup");
  const lined = lineUp(src, found.figs, o);

  await onStep("check");
  const checks = checkFrames(lined.cells, lined.baseline, o);

  return {
    width: W0,
    height: H0,
    workScale: k,
    mode: bg.mode,
    bgInfo: bg.info,
    figs: found.figs,
    gaps: found.gaps,
    cells: lined.cells,
    scale: lined.scale,
    sizeSpread: lined.sizeSpread,
    checks,
    source: src,
    opts: o,
  };
}

// ---------------------------------------------------------------- background
export function removeBackground(img, W, H, o) {
  const d = img.data,
    n = W * H;
  let transp = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 128) transp++;
  const mask = new Uint8Array(n);
  let mode, info;
  if (transp > n * 0.01) {
    mode = "alpha";
    let snapped = 0;
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3];
      if (a >= 240 && a < 255) {
        d[i * 4 + 3] = 255;
        snapped++;
      }
      mask[i] = a >= o.alphaThr ? 1 : 0;
    }
    info = { transparentShare: transp / n, snapped };
  } else {
    mode = "flat";
    const bgc = cornerColour(d, W, H);
    const tol = o.whiteTol;
    const near = (i) =>
      Math.max(
        Math.abs(d[i * 4] - bgc[0]),
        Math.abs(d[i * 4 + 1] - bgc[1]),
        Math.abs(d[i * 4 + 2] - bgc[2]),
      ) <= tol;
    // border uniformity
    const border = [];
    for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
    for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
    let nearCount = 0;
    for (const i of border) if (near(i)) nearCount++;
    const share = nearCount / border.length;
    if (share < 0.9) {
      // is it a painted checkerboard (two light greys alternating)?
      const others = border.filter((i) => !near(i));
      const oc = medianColour(d, others);
      let oNear = 0;
      for (const i of others)
        if (
          Math.max(
            Math.abs(d[i * 4] - oc[0]),
            Math.abs(d[i * 4 + 1] - oc[1]),
            Math.abs(d[i * 4 + 2] - oc[2]),
          ) <= tol
        )
          oNear++;
      const light = (c) =>
        Math.min(c[0], c[1], c[2]) > 140 &&
        Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 24;
      if (oNear / others.length > 0.8 && light(oc) && light(bgc) && share > 0.2)
        throw new CutError(
          "background",
          "checker",
          "The background is a painted checkerboard, not real transparency.",
          { share },
        );
      throw new CutError(
        "background",
        "not-flat",
        "The background is not one flat colour (only " +
          Math.round(share * 100) +
          " % of the edge matches the corners).",
        { share },
      );
    }
    // flood fill from the border
    const isBg = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    for (const i of border)
      if (!isBg[i] && near(i)) {
        isBg[i] = 1;
        stack[sp++] = i;
      }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % W;
      if (x > 0 && !isBg[i - 1] && near(i - 1)) {
        isBg[i - 1] = 1;
        stack[sp++] = i - 1;
      }
      if (x < W - 1 && !isBg[i + 1] && near(i + 1)) {
        isBg[i + 1] = 1;
        stack[sp++] = i + 1;
      }
      if (i >= W && !isBg[i - W] && near(i - W)) {
        isBg[i - W] = 1;
        stack[sp++] = i - W;
      }
      if (i < n - W && !isBg[i + W] && near(i + W)) {
        isBg[i + W] = 1;
        stack[sp++] = i + W;
      }
    }
    let inner = 0;
    for (let i = 0; i < n; i++) {
      if (isBg[i]) {
        d[i * 4 + 3] = 0;
      } else {
        mask[i] = 1;
        if (near(i)) inner++;
      }
    }
    // soften the rim: figure pixels touching the background that are still
    // close to its colour become partly transparent (no white halo)
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = i % W;
      const touches =
        (x > 0 && isBg[i - 1]) ||
        (x < W - 1 && isBg[i + 1]) ||
        (i >= W && isBg[i - W]) ||
        (i < n - W && isBg[i + W]);
      if (!touches) continue;
      const dist = Math.max(
        Math.abs(d[i * 4] - bgc[0]),
        Math.abs(d[i * 4 + 1] - bgc[1]),
        Math.abs(d[i * 4 + 2] - bgc[2]),
      );
      if (dist < 4 * tol)
        d[i * 4 + 3] = Math.max(
          0,
          Math.min(255, Math.round((255 * (dist - tol)) / (3 * tol))),
        );
    }
    info = { bg: bgc, edgeShare: share, keptInside: inner };
  }
  let fg = 0;
  for (let i = 0; i < n; i++) fg += mask[i];
  if (fg < n * 0.004)
    throw new CutError(
      "background",
      "empty",
      "After removing the background almost nothing is left - the picture looks empty.",
    );
  if (fg > n * 0.9)
    throw new CutError(
      "background",
      "no-background",
      "No background could be found around the figures.",
    );
  return { mode, mask, info: { ...info, figureShare: fg / n } };
}

function cornerColour(d, W, H) {
  const idx = [];
  const s = Math.max(2, Math.round(Math.min(W, H) * 0.01));
  for (const [cx, cy] of [
    [0, 0],
    [W - s, 0],
    [0, H - s],
    [W - s, H - s],
  ])
    for (let y = cy; y < cy + s; y++)
      for (let x = cx; x < cx + s; x++) idx.push(y * W + x);
  return medianColour(d, idx);
}
function medianColour(d, idx) {
  const out = [];
  for (let c = 0; c < 3; c++) {
    const v = idx.map((i) => d[i * 4 + c]).sort((a, b) => a - b);
    out.push(v[v.length >> 1] ?? 255);
  }
  return out;
}

// ---------------------------------------------------------------- figures
export function findFigures(mask, W, H, o) {
  const col = new Uint32Array(W);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) col[x] += mask[r + x];
  }
  const minCol = Math.max(2, Math.round(H * o.minColFrac));
  const minGap = Math.max(3, Math.round(W * o.minGapFrac));
  let runs = [];
  let start = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && col[x] >= minCol;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      runs.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.x0 - last.x1 - 1 < minGap) last.x1 = r.x1;
    else merged.push({ ...r });
  }
  for (const r of merged) {
    let m = 0;
    for (let x = r.x0; x <= r.x1; x++) m += col[x];
    r.mass = m;
  }
  const maxMass = Math.max(0, ...merged.map((r) => r.mass));
  runs = merged.filter((r) => r.mass >= 0.04 * maxMass);
  // bounding boxes and body centres
  for (const r of runs) {
    let top = H,
      bottom = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = r.x0; x <= r.x1; x++)
        if (mask[row + x]) {
          if (y < top) top = y;
          bottom = y;
          break;
        }
    }
    r.top = top;
    r.bottom = bottom;
    // body centre: median column of the lower 45 % of the figure
    const yLow = Math.round(top + 0.55 * (bottom - top));
    const hist = new Uint32Array(r.x1 - r.x0 + 1);
    let tot = 0;
    for (let y = yLow; y <= bottom; y++) {
      const row = y * W;
      for (let x = r.x0; x <= r.x1; x++)
        if (mask[row + x]) {
          hist[x - r.x0]++;
          tot++;
        }
    }
    let acc = 0,
      cx = (r.x0 + r.x1) / 2;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= tot / 2) {
        cx = r.x0 + i;
        break;
      }
    }
    r.cx = cx;
    r.w = r.x1 - r.x0 + 1;
    r.h = bottom - top + 1;
  }
  const gaps = [];
  for (let i = 1; i < runs.length; i++)
    gaps.push(runs[i].x0 - runs[i - 1].x1 - 1);
  const detail = { runs, gaps, W, H };
  if (runs.length === 4) return { figs: runs, gaps };
  if (runs.some((r) => r.w > 0.8 * W))
    throw new CutError(
      "find",
      "all-joined",
      "Everything in the picture is connected, so the poses cannot be told apart (a floor line, a frame or a shadow joins them).",
      detail,
    );
  if (runs.length < 4 && runs.length > 0) {
    const minW = Math.min(...runs.map((r) => r.w));
    const est = runs.map((r) => Math.max(1, Math.round(r.w / (minW * 1.05))));
    const joined = runs
      .map((r, i) => (r.w > 1.7 * minW ? i : -1))
      .filter((i) => i >= 0);
    detail.est = est;
    if (joined.length) {
      detail.joined = joined;
      throw new CutError(
        "find",
        "touching",
        `Found ${runs.length} pieces, but ${joined.length === 1 ? "one of them is" : "some are"} two poses drawn touching each other.`,
        detail,
      );
    }
    throw new CutError(
      "find",
      "too-few",
      `Found only ${runs.length} pose${runs.length === 1 ? "" : "s"}; the character needs 4.`,
      detail,
    );
  }
  if (runs.length === 0)
    throw new CutError(
      "find",
      "none",
      "No figure was found in the picture.",
      detail,
    );
  throw new CutError(
    "find",
    "too-many",
    `Found ${runs.length} separate pieces instead of 4 (text, numbers or a loose object count as pieces).`,
    detail,
  );
}

// ---------------------------------------------------------------- line-up
export function lineUp(src, figs, o) {
  const maxH = Math.max(...figs.map((f) => f.h));
  const halfW = Math.max(
    ...figs.map((f) => Math.max(f.cx - f.x0, f.x1 - f.cx) + 1),
  );
  const scale = Math.min((o.cellH * 0.9) / maxH, (o.cellW * 0.48) / halfW);
  const baseline = Math.round(o.cellH * 0.97);
  const cells = figs.map((f) => {
    const c = makeCanvas(o.cellW, o.cellH);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(
      src,
      f.x0,
      f.top,
      f.w,
      f.h,
      o.cellW / 2 - (f.cx - f.x0) * scale,
      baseline - f.h * scale,
      f.w * scale,
      f.h * scale,
    );
    return c;
  });
  const hs = figs.map((f) => f.h);
  return {
    cells,
    scale,
    baseline,
    sizeSpread: 1 - Math.min(...hs) / Math.max(...hs),
  };
}

// ---------------------------------------------------------------- checks
function pixels(c) {
  return c
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, c.width, c.height).data;
}
// share of differing pixels over the union of both figures, rows [y0, y1)
function diffShare(A, B, W, H, y0, y1, dx, dy, stride = 2) {
  let uni = 0,
    dif = 0;
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y += stride) {
    const yb = y + dy;
    for (let x = 0; x < W; x += stride) {
      const ia = (y * W + x) * 4;
      const xb = x + dx;
      const inB = yb >= 0 && yb < H && xb >= 0 && xb < W;
      const ib = (yb * W + xb) * 4;
      const fa = A[ia + 3] >= 128,
        fb = inB && B[ib + 3] >= 128;
      if (!fa && !fb) continue;
      uni++;
      if (
        fa !== fb ||
        Math.max(
          Math.abs(A[ia] - B[ib]),
          Math.abs(A[ia + 1] - B[ib + 1]),
          Math.abs(A[ia + 2] - B[ib + 2]),
        ) > 48
      )
        dif++;
    }
  }
  return uni ? dif / uni : 0;
}
function bestShift(A, B, W, H, y0, y1, s) {
  let best = { share: 2, dx: 0, dy: 0 };
  for (let dy = -s; dy <= s; dy++)
    for (let dx = -s; dx <= s; dx++) {
      const v = diffShare(A, B, W, H, y0, y1, dx, dy);
      if (v < best.share) best = { share: v, dx, dy };
    }
  return best;
}
function extents(P, W, y0, y1) {
  let l = W,
    r = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++)
      if (P[(y * W + x) * 4 + 3] >= 128) {
        if (x < l) l = x;
        if (x > r) r = x;
      }
  return { l, r };
}

export function checkFrames(cells, baseline, o) {
  const W = o.cellW,
    H = o.cellH;
  const P = cells.map(pixels);
  let figTop = H;
  for (const p of P)
    for (let y = 0; y < H; y++) {
      let hit = false;
      for (let x = 0; x < W; x++)
        if (p[(y * W + x) * 4 + 3] >= 128) {
          hit = true;
          break;
        }
      if (hit) {
        figTop = Math.min(figTop, y);
        break;
      }
    }
  const figH = baseline - figTop;
  const bandEnd = Math.round(figTop + o.bandFrac * figH);
  const feather = Math.max(4, Math.round(o.featherFrac * figH));
  const below0 = bandEnd + Math.round(feather / 2);
  const a = bestShift(P[0], P[1], W, H, below0, baseline, o.shift);
  const b = bestShift(P[0], P[2], W, H, below0, baseline, o.shift);
  const mouthA = diffShare(P[0], P[1], W, H, figTop, bandEnd, a.dx, a.dy);
  const mouthB = diffShare(P[0], P[2], W, H, figTop, bandEnd, b.dx, b.dy);
  const beckonDiff = diffShare(P[0], P[3], W, H, figTop, baseline, 0, 0);
  // pointing direction: compare how far the arms region reaches each side
  const armY0 = figTop + Math.round(0.15 * figH),
    armY1 = figTop + Math.round(0.65 * figH);
  const ei = extents(P[0], W, armY0, armY1),
    eb = extents(P[3], W, armY0, armY1);
  const gainL = ei.l - eb.l,
    gainR = eb.r - ei.r;
  const wobble = Math.max(a.share, b.share);
  return {
    figTop,
    figH,
    bandEnd,
    feather,
    wobble,
    wobbleA: a.share,
    wobbleB: b.share,
    shiftA: [a.dx, a.dy],
    shiftB: [b.dx, b.dy],
    mouth: Math.max(mouthA, mouthB),
    mouthA,
    mouthB,
    beckonDiff,
    gainL,
    gainR,
    pointsLeft: gainL > gainR + 0.03 * W,
    suggestSteady: wobble > o.wobbleThr,
    noMouth: Math.max(mouthA, mouthB) < 0.002,
  };
}

// ---------------------------------------------------------------- fixes
// the idle body with the talking frame's head band, feathered
export function steadyBody(cells, checks, o) {
  const W = o.cellW,
    H = o.cellH;
  const idle = pixels(cells[0]);
  const out = [cells[0]];
  for (const [k, sh] of [
    [1, checks.shiftA],
    [2, checks.shiftB],
  ]) {
    const t = pixels(cells[k]);
    const c = makeCanvas(W, H);
    const x = c.getContext("2d", { willReadFrequently: true });
    const im = x.createImageData(W, H);
    const d = im.data;
    const f0 = checks.bandEnd - checks.feather / 2,
      f1 = checks.bandEnd + checks.feather / 2;
    for (let y = 0; y < H; y++) {
      const w = y <= f0 ? 1 : y >= f1 ? 0 : 1 - (y - f0) / (f1 - f0);
      for (let xx = 0; xx < W; xx++) {
        const i = (y * W + xx) * 4;
        const ys = y + sh[1],
          xs = xx + sh[0];
        const j = (ys * W + xs) * 4;
        const okT = ys >= 0 && ys < H && xs >= 0 && xs < W;
        const ta = okT ? t[j + 3] / 255 : 0,
          ia = idle[i + 3] / 255;
        const oa = ta * w + ia * (1 - w);
        d[i + 3] = Math.round(oa * 255);
        if (oa > 0)
          for (let ch = 0; ch < 3; ch++)
            d[i + ch] = Math.round(
              ((okT ? t[j + ch] : 0) * ta * w + idle[i + ch] * ia * (1 - w)) /
                oa,
            );
      }
    }
    x.putImageData(im, 0, 0);
    out.push(c);
  }
  out.push(cells[3]);
  return out;
}

export function mirrored(cell) {
  const c = makeCanvas(cell.width, cell.height);
  const x = c.getContext("2d");
  x.translate(cell.width, 0);
  x.scale(-1, 1);
  x.drawImage(cell, 0, 0);
  return c;
}

// the canonical sheet: four equal cells in one row
export function canonicalSheet(cells) {
  const W = cells[0].width,
    H = cells[0].height;
  const c = makeCanvas(W * 4, H);
  const x = c.getContext("2d");
  cells.forEach((cell, i) => x.drawImage(cell, i * W, 0));
  return c;
}
