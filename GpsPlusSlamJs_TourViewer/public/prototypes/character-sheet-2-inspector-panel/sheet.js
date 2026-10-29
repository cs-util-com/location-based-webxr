/*
 * Throwaway prototype: the character-sheet import and the built-in sample
 * sheets. Plain browser JS, no dependencies, not wired into the app.
 *
 * importSheet(blob, { onStep, minStepMs, params }) runs five named steps
 * (read, background, poses, align, check) and either resolves with the four
 * cut frames or rejects with a SheetError naming the step that failed, so
 * the panel can always say WHICH step went wrong.
 */
(function (global) {
  "use strict";

  // Every threshold the import rests on, in one place (swept in the report).
  const P = {
    maxPixels: 40e6, // refuse larger pictures (phone memory)
    workMax: 2048, // analyse at most this many pixels on the long side
    bgTol: 32, // flood fill: max channel distance from the border colour
    alphaFg: 128, // alpha at or above = figure, when finding poses
    alphaSnap: 245, // alpha at or above snaps to opaque (one AI tops out at 253)
    minColFrac: 0.002, // a column counts when this share of the height is figure
    minGapFrac: 0.006, // empty gaps narrower than this share of the width are bridged
    minRunMassFrac: 0.03, // a shape with less of the figure mass is a speck
    headBand: 0.3, // steady body: the top share of the figure taken from the talk frame
    featherFrac: 0.05, // steady body: feather height as a share of the figure height
    diffT: 48, // a pixel "differs" when a colour channel moves more than this
    shiftR: 5, // best-shift search radius, in half-resolution pixels
    jitterWarn: 0.05, // body change share above which steady body is switched on
    cellH: 640, // height of one cut frame
  };

  const STEPS = [
    { id: "read", label: "Read the picture" },
    { id: "background", label: "Remove the background" },
    { id: "poses", label: "Find the four poses" },
    { id: "align", label: "Line up the feet" },
    { id: "check", label: "Check the talking frames" },
  ];

  class SheetError extends Error {
    constructor(step, code, info) {
      super(step + ":" + code);
      this.step = step;
      this.code = code;
      this.info = info || {};
    }
  }

  const tick = () =>
    new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function mk(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  const ctx2 = (c) => c.getContext("2d", { willReadFrequently: true });
  const median = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };

  /* ---------- step 1: read ---------- */
  async function readStep(blob, p) {
    if (!blob || typeof blob.size !== "number")
      throw new SheetError("read", "not-file");
    if (blob.type && !/^image\//.test(blob.type))
      throw new SheetError("read", "not-image", { type: blob.type });
    let bmp;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      throw new SheetError("read", "decode");
    }
    const w0 = bmp.width;
    const h0 = bmp.height;
    if (w0 * h0 > p.maxPixels) {
      bmp.close();
      throw new SheetError("read", "too-big", { w: w0, h: h0 });
    }
    if (Math.min(w0, h0) < 160) {
      bmp.close();
      throw new SheetError("read", "too-small", { w: w0, h: h0 });
    }
    const s = Math.min(1, p.workMax / Math.max(w0, h0));
    const W = Math.round(w0 * s);
    const H = Math.round(h0 * s);
    const c = mk(W, H);
    const x = ctx2(c);
    x.imageSmoothingQuality = "high";
    x.drawImage(bmp, 0, 0, W, H);
    bmp.close();
    const img = x.getImageData(0, 0, W, H);
    return {
      w0,
      h0,
      W,
      H,
      scale: s,
      img,
      type: blob.type || "unknown",
      name: blob.name || "",
    };
  }

  /* ---------- step 2: background ---------- */
  function borderIdx(W, H) {
    const out = [];
    for (let x = 0; x < W; x++) out.push(x, (H - 1) * W + x);
    for (let y = 1; y < H - 1; y++) out.push(y * W, y * W + W - 1);
    return out;
  }

  // A grey-and-white checkerboard painted as "fake transparency": two light
  // levels alternating along the border, many times.
  function isChecker(d, W, _H) {
    const lum = (i) => (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
    const row = [];
    for (let x = 0; x < W; x++) row.push(lum(x + 2 * W));
    const lo = Math.min(...row);
    const hi = Math.max(...row);
    if (hi - lo < 12 || lo < 120) return false;
    const mid = (lo + hi) / 2;
    let flips = 0;
    let nLo = 0;
    for (let x = 1; x < W; x++) {
      if (row[x] < mid !== row[x - 1] < mid) flips++;
      if (row[x] < mid) nLo++;
    }
    return flips >= W / 64 && nLo > W * 0.25 && nLo < W * 0.75;
  }

  function backgroundStep(R, p) {
    const { W, H, img } = R;
    const d = img.data;
    const n = W * H;
    const mask = new Uint8Array(n);
    let semi = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) semi++;
    if (semi > n * 0.02) {
      // Real transparency: trust alpha, ignore the colour under alpha 0.
      let fg = 0;
      for (let i = 0; i < n; i++) {
        const k = i * 4 + 3;
        let a = d[k];
        if (a >= p.alphaSnap) a = 255;
        else if (a < 8) a = 0;
        d[k] = a;
        if (a >= p.alphaFg) {
          mask[i] = 1;
          fg++;
        }
      }
      if (fg < n * 0.01) throw new SheetError("background", "empty");
      return { mask, mode: "alpha", fgShare: fg / n };
    }
    // Flat background: the border's median colour, then a flood fill from
    // the border (never a global colour key: eye whites and teeth stay).
    const border = borderIdx(W, H);
    const rs = [];
    const gs = [];
    const bs = [];
    const step = Math.max(1, Math.floor(border.length / 4000));
    for (let j = 0; j < border.length; j += step) {
      const k = border[j] * 4;
      rs.push(d[k]);
      gs.push(d[k + 1]);
      bs.push(d[k + 2]);
    }
    const bg = [median(rs), median(gs), median(bs)];
    const tol = p.bgTol;
    const near = (k) =>
      Math.abs(d[k] - bg[0]) <= tol &&
      Math.abs(d[k + 1] - bg[1]) <= tol &&
      Math.abs(d[k + 2] - bg[2]) <= tol;
    let flat = 0;
    for (const i of border) if (near(i * 4)) flat++;
    const flatShare = flat / border.length;
    if (flatShare < 0.85) {
      if (isChecker(d, W, H)) throw new SheetError("background", "checker");
      throw new SheetError("background", "busy", { flatShare });
    }
    const bgm = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    for (const i of border)
      if (!bgm[i] && near(i * 4)) {
        bgm[i] = 1;
        stack[sp++] = i;
      }
    while (sp) {
      const i = stack[--sp];
      const x = i % W;
      let j;
      if (x > 0 && !bgm[(j = i - 1)] && near(j * 4)) {
        bgm[j] = 1;
        stack[sp++] = j;
      }
      if (x < W - 1 && !bgm[(j = i + 1)] && near(j * 4)) {
        bgm[j] = 1;
        stack[sp++] = j;
      }
      if (i >= W && !bgm[(j = i - W)] && near(j * 4)) {
        bgm[j] = 1;
        stack[sp++] = j;
      }
      if (i < n - W && !bgm[(j = i + W)] && near(j * 4)) {
        bgm[j] = 1;
        stack[sp++] = j;
      }
    }
    let fg = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      if (bgm[i]) {
        d[k + 3] = 0;
        continue;
      }
      mask[i] = 1;
      fg++;
      const x = i % W;
      const edge =
        (x > 0 && bgm[i - 1]) ||
        (x < W - 1 && bgm[i + 1]) ||
        (i >= W && bgm[i - W]) ||
        (i < n - W && bgm[i + W]);
      if (edge) {
        // soften the cut edge and un-blend the background colour out of it
        const dist = Math.max(
          Math.abs(d[k] - bg[0]),
          Math.abs(d[k + 1] - bg[1]),
          Math.abs(d[k + 2] - bg[2]),
        );
        const a = Math.min(1, Math.max(0.3, dist / (tol * 3)));
        for (let c = 0; c < 3; c++)
          d[k + c] = Math.max(
            0,
            Math.min(255, (d[k + c] - bg[c] * (1 - a)) / a),
          );
        d[k + 3] = Math.round(a * 255);
      } else d[k + 3] = 255;
    }
    if (fg < n * 0.01) throw new SheetError("background", "empty");
    if (fg > n * 0.8) throw new SheetError("background", "busy", { flatShare });
    return { mask, mode: "flat", bg, fgShare: fg / n, flatShare };
  }

  /* ---------- step 3: poses (column runs, never quarters) ---------- */
  function findRuns(mask, W, H, p) {
    const col = new Uint32Array(W);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) col[x] += mask[o + x];
    }
    const minCol = Math.max(2, Math.round(H * p.minColFrac));
    const minGap = Math.max(3, Math.round(W * p.minGapFrac));
    const runs = [];
    let x = 0;
    while (x < W) {
      if (col[x] < minCol) {
        x++;
        continue;
      }
      const x0 = x;
      let last = x;
      let mass = 0;
      while (x < W) {
        if (col[x] >= minCol) {
          last = x;
          mass += col[x];
          x++;
          continue;
        }
        let g = x;
        while (g < W && col[g] < minCol) g++;
        if (g < W && g - x < minGap) {
          for (; x < g; x++) mass += col[x];
        } else break;
      }
      runs.push({ x0, x1: last, mass });
      x = last + 1;
    }
    const total = runs.reduce((s, r) => s + r.mass, 0) || 1;
    const kept = runs.filter((r) => r.mass >= total * p.minRunMassFrac);
    for (const r of kept) {
      let y0 = -1;
      let y1 = -1;
      for (let y = 0; y < H; y++) {
        let c = 0;
        const o = y * W;
        for (let xx = r.x0; xx <= r.x1; xx++) c += mask[o + xx];
        if (c >= 2) {
          if (y0 < 0) y0 = y;
          y1 = y;
        }
      }
      r.y0 = Math.max(0, y0);
      r.y1 = Math.max(r.y0, y1);
    }
    const gaps = [];
    for (let i = 1; i < kept.length; i++)
      gaps.push(kept[i].x0 - kept[i - 1].x1 - 1);
    return {
      runs: kept,
      ignored: runs.length - kept.length,
      gaps,
      minCol,
      minGap,
    };
  }

  function cutCanvas(R) {
    const c = mk(R.W, R.H);
    ctx2(c).putImageData(R.img, 0, 0);
    return c;
  }

  // A small picture of what the import saw: the cut-out on a dark checker,
  // each found shape as a numbered band, a suspicious one in red.
  function analysisCanvas(cut, runs, W, H, bad) {
    const s = Math.min(1, 640 / W);
    const c = mk(W * s, H * s);
    const x = c.getContext("2d");
    const t = 10;
    for (let yy = 0; yy < c.height; yy += t)
      for (let xx = 0; xx < c.width; xx += t) {
        x.fillStyle = ((xx + yy) / t) % 2 ? "#2b3142" : "#363d52";
        x.fillRect(xx, yy, t, t);
      }
    x.drawImage(cut, 0, 0, c.width, c.height);
    runs.forEach((r, i) => {
      const isBad = bad === i;
      x.fillStyle = isBad ? "rgba(239,68,68,0.28)" : "rgba(242,151,31,0.18)";
      x.fillRect(r.x0 * s, 0, (r.x1 - r.x0 + 1) * s, c.height);
      x.strokeStyle = isBad ? "#ef4444" : "#f2971f";
      x.lineWidth = 2;
      x.strokeRect(r.x0 * s + 1, 1, (r.x1 - r.x0 + 1) * s - 2, c.height - 2);
      x.fillStyle = isBad ? "#ef4444" : "#f2971f";
      x.beginPath();
      x.arc((r.x0 + r.x1) * 0.5 * s, 18, 13, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#000";
      x.font = "600 15px system-ui, sans-serif";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(String(i + 1), (r.x0 + r.x1) * 0.5 * s, 19);
    });
    return c;
  }

  function posesStep(R, B, p) {
    const found = findRuns(B.mask, R.W, R.H, p);
    const runs = found.runs;
    if (runs.length !== 4) {
      const ws = runs.map((r) => r.x1 - r.x0 + 1);
      let code = runs.length > 4 ? "extra" : "missing";
      let widest = -1;
      if (runs.length > 0 && runs.length < 4) {
        widest = ws.indexOf(Math.max(...ws));
        const others = ws.filter((_, i) => i !== widest);
        const ref = others.length ? median(others) : 0;
        if (ref && ws[widest] > 1.5 * ref) code = "joined";
        else if (runs.length === 1 && ws[0] > R.W * 0.6) code = "joined";
        else widest = -1;
      }
      throw new SheetError("poses", code, {
        count: runs.length,
        widest,
        analysis: analysisCanvas(R.cut, runs, R.W, R.H, widest),
      });
    }
    return { ...found, analysis: analysisCanvas(R.cut, runs, R.W, R.H, -1) };
  }

  /* ---------- step 4: align ---------- */
  function maskOf(c, k) {
    const w = Math.floor(c.width / k);
    const h = Math.floor(c.height / k);
    const t = mk(w, h);
    const x = ctx2(t);
    x.drawImage(c, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    return { m, w, h };
  }

  function bestShift(A, B, yFrom, yTo, r) {
    const { w, h } = A;
    let best = { dx: 0, dy: 0, v: Infinity };
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        let v = 0;
        for (let y = Math.max(0, yFrom); y < Math.min(h, yTo); y++) {
          const yb = y - dy;
          const rowA = y * w;
          const okB = yb >= 0 && yb < h;
          const rowB = yb * w;
          for (let x = 0; x < w; x++) {
            const xb = x - dx;
            const b = okB && xb >= 0 && xb < w ? B.m[rowB + xb] : 0;
            v += A.m[rowA + x] ^ b;
          }
        }
        const tie =
          v === best.v &&
          Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy);
        if (v < best.v || tie) best = { dx, dy, v };
      }
    return best;
  }

  function alignStep(R, B, runs, p) {
    const W = R.W;
    const m = B.mask;
    const figs = runs.map((r) => {
      const h = r.y1 - r.y0 + 1;
      const yA = Math.round(r.y1 - 0.35 * h);
      let sx = 0;
      let c = 0;
      for (let y = yA; y <= r.y1; y++) {
        const o = y * W;
        for (let x = r.x0; x <= r.x1; x++)
          if (m[o + x]) {
            sx += x;
            c++;
          }
      }
      return { ...r, h, ax: c ? sx / c : (r.x0 + r.x1) / 2 };
    });
    const hs = figs.map((f) => f.h);
    const maxH = Math.max(...hs);
    const halfW =
      Math.max(...figs.map((f) => Math.max(f.ax - f.x0, f.x1 + 1 - f.ax))) +
      0.03 * maxH;
    const s = Math.min(2, p.cellH / (maxH * 1.08));
    const cellH = p.cellH;
    const cellW = Math.ceil((2 * halfW * s) / 2) * 2;
    const base = Math.round(cellH - 0.02 * maxH * s);
    const draw = (f, dx, dy, mirror) => {
      const c = mk(cellW, cellH);
      const x = ctx2(c);
      x.imageSmoothingQuality = "high";
      if (mirror) {
        x.translate(cellW, 0);
        x.scale(-1, 1);
      }
      const w = f.x1 - f.x0 + 1;
      x.drawImage(
        R.cut,
        f.x0,
        f.y0,
        w,
        f.h,
        cellW / 2 - (f.ax - f.x0) * s + dx,
        base - f.h * s + dy,
        w * s,
        f.h * s,
      );
      return c;
    };
    const frames = figs.map((f) => draw(f, 0, 0, false));
    // geometry of the idle figure, in cell pixels
    const top = base - figs[0].h * s;
    const figH = figs[0].h * s;
    const bandEnd = top + p.headBand * figH;
    const feather = p.featherFrac * figH;
    // talking frames: best shift of the body against idle (AI placement noise)
    const k = 2;
    const A = maskOf(frames[0], k);
    const shifts = [null, null, null, null];
    for (const i of [1, 2]) {
      const Bm = maskOf(frames[i], k);
      const sh = bestShift(
        A,
        Bm,
        Math.round((bandEnd + feather / 2) / k),
        Math.round(base / k),
        p.shiftR,
      );
      shifts[i] = { dx: sh.dx * k, dy: sh.dy * k };
      if (sh.dx || sh.dy)
        frames[i] = draw(figs[i], sh.dx * k, sh.dy * k, false);
    }
    // beckon: the app expects the arm toward the viewer's right; flip if it is the left
    let mirrored = false;
    {
      const Bm = maskOf(frames[3], k);
      let left = 0;
      let right = 0;
      let idleMass = 0;
      const mid = A.w / 2;
      for (let i = 0; i < A.m.length; i++) {
        idleMass += A.m[i];
        if (Bm.m[i] && !A.m[i]) {
          if (i % A.w < mid) left++;
          else right++;
        }
      }
      if (left > 1.6 * right && left > 0.03 * idleMass) {
        mirrored = true;
        frames[3] = draw(figs[3], 0, 0, true);
      }
    }
    const sizeRatio = Math.min(...hs) / maxH;
    const smallest = hs.indexOf(Math.min(...hs));
    return {
      frames,
      cellW,
      cellH,
      base,
      top,
      figH,
      bandEnd,
      feather,
      shifts,
      mirrored,
      sizeRatio,
      smallest,
      scale: s,
      figs,
    };
  }

  /* ---------- step 5: check (jitter, mouth, beckon) + steady body ---------- */
  function diffStats(A, B, w, yFrom, yTo, T, maskOut) {
    let diff = 0;
    let uni = 0;
    for (
      let y = Math.max(0, Math.floor(yFrom));
      y < Math.min(yTo, A.length / 4 / w);
      y++
    )
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const a = A[k + 3] >= 128;
        const b = B[k + 3] >= 128;
        if (!a && !b) continue;
        uni++;
        let d = a !== b;
        if (!d)
          d =
            Math.max(
              Math.abs(A[k] - B[k]),
              Math.abs(A[k + 1] - B[k + 1]),
              Math.abs(A[k + 2] - B[k + 2]),
            ) > T;
        if (d) {
          diff++;
          if (maskOut) {
            maskOut[k] = 255;
            maskOut[k + 1] = 40;
            maskOut[k + 2] = 60;
            maskOut[k + 3] = 230;
          }
        }
      }
    return uni ? diff / uni : 0;
  }

  function steadyBlend(idle, talk, w, h, bandEnd, feather) {
    const out = new ImageData(w, h);
    const o = out.data;
    for (let y = 0; y < h; y++) {
      let t = (bandEnd + feather / 2 - y) / Math.max(1, feather);
      t = Math.max(0, Math.min(1, t));
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const at = (talk[k + 3] / 255) * t;
        const ai = (idle[k + 3] / 255) * (1 - t);
        const a = at + ai;
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++)
          o[k + c] = (talk[k + c] * at + idle[k + c] * ai) / a;
        o[k + 3] = Math.round(a * 255);
      }
    }
    return out;
  }

  function checkStep(G, p) {
    const { frames, cellW: w, cellH: h, base, top, bandEnd, feather } = G;
    const data = frames.map((c) => ctx2(c).getImageData(0, 0, w, h).data);
    const bodyFrom = bandEnd + feather / 2;
    const res = {
      body: [0, 0, 0, 0],
      head: [0, 0, 0, 0],
      diffMasks: [null, null, null, null],
      steady: [null, null, null, null],
    };
    for (const i of [1, 2]) {
      const mo = new ImageData(w, h);
      res.body[i] = diffStats(
        data[0],
        data[i],
        w,
        bodyFrom,
        base + 2,
        p.diffT,
        mo.data,
      );
      res.head[i] = diffStats(
        data[0],
        data[i],
        w,
        top - 2,
        bandEnd,
        p.diffT,
        null,
      );
      const mc = mk(w, h);
      ctx2(mc).putImageData(mo, 0, 0);
      res.diffMasks[i] = mc;
      const sc = mk(w, h);
      ctx2(sc).putImageData(
        steadyBlend(data[0], data[i], w, h, bandEnd, feather),
        0,
        0,
      );
      res.steady[i] = sc;
    }
    res.beckon = diffStats(data[0], data[3], w, 0, h, p.diffT, null);
    res.jitter = Math.max(res.body[1], res.body[2]);
    res.needsSteady = res.jitter > p.jitterWarn;
    res.noMouth = Math.max(res.head[1], res.head[2]) < 0.004;
    res.noBeckon = res.beckon < 0.03;
    return res;
  }

  /* ---------- the whole import ---------- */
  async function importSheet(blob, opts) {
    opts = opts || {};
    const p = Object.assign({}, P, opts.params || {});
    const on = opts.onStep || function () {};
    const minMs = opts.minStepMs || 0;
    const t00 = performance.now();
    const run = async (id, fn) => {
      const t0 = performance.now();
      on(id, "run");
      await tick();
      let r;
      try {
        r = await fn();
      } catch (e) {
        const err =
          e instanceof SheetError
            ? e
            : new SheetError(id, "internal", {
                message: String((e && e.message) || e),
              });
        on(id, "fail", err);
        throw err;
      }
      const dt = performance.now() - t0;
      if (dt < minMs) await sleep(minMs - dt);
      on(id, "ok", r);
      return r;
    };
    const R = await run("read", () => readStep(blob, p));
    const B = await run("background", () => {
      const b = backgroundStep(R, p);
      R.cut = cutCanvas(R);
      return b;
    });
    const F = await run("poses", () => posesStep(R, B, p));
    const G = await run("align", () => alignStep(R, B, F.runs, p));
    const C = await run("check", () => checkStep(G, p));
    return {
      read: R,
      bg: B,
      poses: F,
      geo: G,
      check: C,
      frames: G.frames,
      params: p,
      ms: Math.round(performance.now() - t00),
    };
  }

  // The canonical sheet: four equal cells in one row, alpha background.
  function buildSheet(frames) {
    const w = frames[0].width;
    const h = frames[0].height;
    const c = mk(w * 4, h);
    const x = c.getContext("2d");
    frames.forEach((f, i) => x.drawImage(f, i * w, 0));
    return c;
  }

  /* ================================================================
     Built-in samples, drawn procedurally (nothing external)
     ================================================================ */
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const OL = "#1d1915";
  function limb(x, x1, y1, x2, y2, w, fill, lw) {
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(x1, y1);
    x.lineTo(x2, y2);
    x.strokeStyle = OL;
    x.lineWidth = w + 2 * lw;
    x.stroke();
    x.beginPath();
    x.moveTo(x1, y1);
    x.lineTo(x2, y2);
    x.strokeStyle = fill;
    x.lineWidth = w;
    x.stroke();
  }
  function shape(x, path, fill, lw) {
    x.beginPath();
    path(x);
    x.fillStyle = fill;
    x.fill();
    x.lineJoin = "round";
    x.lineWidth = lw;
    x.strokeStyle = OL;
    x.stroke();
  }
  function circle(x, cx, cy, r, fill, lw) {
    shape(x, (c) => c.arc(cx, cy, r, 0, Math.PI * 2), fill, lw);
  }
  function openHand(x, hx, hy, u, skin, lw) {
    const ang = [-1.45, -1.05, -0.65, -0.25];
    for (const a of ang)
      limb(
        x,
        hx,
        hy,
        hx + Math.cos(a) * 5.2 * u,
        hy + Math.sin(a) * 5.2 * u,
        1.7 * u,
        skin,
        lw * 0.7,
      );
    limb(x, hx, hy, hx - 3.4 * u, hy - 3.2 * u, 1.8 * u, skin, lw * 0.7);
    circle(x, hx, hy, 3.6 * u, skin, lw * 0.8);
  }
  function mouthAt(x, mx, my, u, mouth, lw) {
    if (mouth === 0) {
      x.beginPath();
      x.arc(mx, my - 2 * u, 3.2 * u, 0.25 * Math.PI, 0.75 * Math.PI);
      x.strokeStyle = OL;
      x.lineWidth = lw * 0.8;
      x.lineCap = "round";
      x.stroke();
      return;
    }
    const ry = mouth === 1 ? 1.7 * u : 3.4 * u;
    const rx = mouth === 1 ? 3.2 * u : 3.6 * u;
    shape(
      x,
      (c) => c.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2),
      "#5e1a1c",
      lw * 0.7,
    );
    x.save();
    x.beginPath();
    x.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
    x.clip();
    x.fillStyle = "#d2575c";
    x.beginPath();
    x.ellipse(mx, my + ry * 0.7, rx * 0.7, ry * 0.55, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }

  // The keeper: flat cartoon, yellow raincoat and sou'wester, eye whites.
  function drawKeeper(x, u, o) {
    const lw = 1.4 * u;
    const skin = "#f1c6a0";
    const coat = "#f4c430";
    shape(
      x,
      (c) => c.roundRect(-8.5 * u, -31 * u, 6.5 * u, 28 * u, 2 * u),
      "#2f4a7a",
      lw,
    );
    shape(
      x,
      (c) => c.roundRect(2 * u, -31 * u, 6.5 * u, 28 * u, 2 * u),
      "#2f4a7a",
      lw,
    );
    shape(
      x,
      (c) => c.ellipse(-5.5 * u, -2.5 * u, 5.2 * u, 2.8 * u, 0, 0, Math.PI * 2),
      "#3b2f2a",
      lw,
    );
    shape(
      x,
      (c) => c.ellipse(5.5 * u, -2.5 * u, 5.2 * u, 2.8 * u, 0, 0, Math.PI * 2),
      "#3b2f2a",
      lw,
    );
    limb(x, -14 * u, -62 * u, -19 * u, -37 * u, 6.5 * u, coat, lw);
    circle(x, -19.5 * u, -35 * u, 3.4 * u, skin, lw * 0.8);
    shape(
      x,
      (c) => {
        c.moveTo(-14 * u, -66 * u);
        c.lineTo(14 * u, -66 * u);
        c.quadraticCurveTo(17 * u, -50 * u, 18.5 * u, -29 * u);
        c.lineTo(-18.5 * u, -29 * u);
        c.quadraticCurveTo(-17 * u, -50 * u, -14 * u, -66 * u);
      },
      coat,
      lw,
    );
    x.beginPath();
    x.moveTo(0, -64 * u);
    x.lineTo(0, -29.5 * u);
    x.strokeStyle = OL;
    x.lineWidth = lw * 0.7;
    x.stroke();
    for (const by of [-58, -48, -38])
      circle(x, 3 * u, by * u, 1.3 * u, "#7a5a12", lw * 0.5);
    if (o.beckon) {
      limb(x, 13 * u, -62 * u, 31 * u, -72 * u, 6.5 * u, coat, lw);
      openHand(x, 33 * u, -73.5 * u, u, skin, lw);
    } else {
      limb(x, 14 * u, -62 * u, 19 * u, -37 * u, 6.5 * u, coat, lw);
      circle(x, 19.5 * u, -35 * u, 3.4 * u, skin, lw * 0.8);
    }
    shape(x, (c) => c.roundRect(-4 * u, -71 * u, 8 * u, 7 * u, u), skin, lw);
    circle(x, 0, -81 * u, 12.5 * u, skin, lw);
    shape(
      x,
      (c) => c.ellipse(0, -89 * u, 18.5 * u, 4.2 * u, 0, 0, Math.PI * 2),
      coat,
      lw,
    );
    shape(
      x,
      (c) => {
        c.ellipse(0, -90 * u, 11.5 * u, 9.5 * u, 0, Math.PI, 0);
        c.closePath();
      },
      coat,
      lw,
    );
    for (const ex of [-4.8, 4.8]) {
      shape(
        x,
        (c) => c.ellipse(ex * u, -82 * u, 2.9 * u, 3.3 * u, 0, 0, Math.PI * 2),
        "#ffffff",
        lw * 0.6,
      );
      x.fillStyle = OL;
      x.beginPath();
      x.arc(ex * u + 0.4 * u, -81.5 * u, 1.5 * u, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "rgba(230,110,110,0.45)";
    for (const cx of [-8.5, 8.5]) {
      x.beginPath();
      x.arc(cx * u, -77 * u, 2.2 * u, 0, Math.PI * 2);
      x.fill();
    }
    mouthAt(x, 0, -74.5 * u, u, o.mouth, lw);
  }

  // The herbalist: painted, long robe, hood and beard. Talking frames are
  // deliberately redrawn with the body shifted and the brush texture changed.
  function drawHerbalist(x, u, o) {
    const lw = 1.3 * u;
    const skin = "#e9bf98";
    const robe = "#3f7a4a";
    const sleeve = "#346a40";
    const j = o.jit || { body: [0, 0], arms: [0, 0], hem: 0 };
    x.save();
    x.translate(j.body[0], j.body[1]);
    shape(
      x,
      (c) => c.ellipse(-6 * u, -2 * u, 5 * u, 2.4 * u, 0, 0, Math.PI * 2),
      "#3b2f2a",
      lw,
    );
    shape(
      x,
      (c) => c.ellipse(6 * u, -2 * u, 5 * u, 2.4 * u, 0, 0, Math.PI * 2),
      "#3b2f2a",
      lw,
    );
    const hem = 21 + j.hem;
    shape(
      x,
      (c) => {
        c.moveTo(-12 * u, -65 * u);
        c.lineTo(12 * u, -65 * u);
        c.quadraticCurveTo(16 * u, -30 * u, hem * u, -4 * u);
        c.quadraticCurveTo(0, -1.5 * u, -hem * u, -4 * u);
        c.quadraticCurveTo(-16 * u, -30 * u, -12 * u, -65 * u);
      },
      robe,
      lw,
    );
    limb(x, -14.5 * u, -44 * u, 14.5 * u, -44 * u, 3 * u, "#6b4a2b", lw * 0.6);
    x.restore();
    x.save();
    x.translate(j.arms[0], j.arms[1]);
    limb(x, -12 * u, -61 * u, -18 * u, -36 * u, 8.5 * u, sleeve, lw);
    circle(x, -18.5 * u, -33.5 * u, 3.3 * u, skin, lw * 0.8);
    if (o.beckon) {
      limb(x, 12 * u, -61 * u, 29 * u, -71 * u, 8.5 * u, sleeve, lw);
      openHand(x, 32 * u, -72.5 * u, u, skin, lw);
    } else {
      limb(x, 12 * u, -61 * u, 18 * u, -36 * u, 8.5 * u, sleeve, lw);
      circle(x, 18.5 * u, -33.5 * u, 3.3 * u, skin, lw * 0.8);
    }
    x.restore();
    shape(
      x,
      (c) => {
        c.moveTo(-15 * u, -66 * u);
        c.quadraticCurveTo(-17 * u, -92 * u, 3 * u, -106 * u);
        c.quadraticCurveTo(16 * u, -90 * u, 15 * u, -66 * u);
        c.closePath();
      },
      "#2c5a37",
      lw,
    );
    circle(x, 0, -80 * u, 11 * u, skin, lw);
    shape(
      x,
      (c) => {
        c.moveTo(-9.5 * u, -79 * u);
        c.quadraticCurveTo(-8 * u, -62 * u, 0, -55 * u);
        c.quadraticCurveTo(8 * u, -62 * u, 9.5 * u, -79 * u);
        c.quadraticCurveTo(0, -72 * u, -9.5 * u, -79 * u);
      },
      "#dcd8cc",
      lw * 0.8,
    );
    x.fillStyle = OL;
    for (const ex of [-4, 4]) {
      x.beginPath();
      x.arc(ex * u, -83 * u, 1.4 * u, 0, Math.PI * 2);
      x.fill();
    }
    limb(
      x,
      -6.5 * u,
      -87 * u,
      -2.5 * u,
      -86.5 * u,
      1.3 * u,
      "#cfcac0",
      lw * 0.4,
    );
    limb(x, 2.5 * u, -86.5 * u, 6.5 * u, -87 * u, 1.3 * u, "#cfcac0", lw * 0.4);
    mouthAt(x, 0, -73.5 * u, u * 0.9, o.mouth, lw);
  }

  function paintTexture(x, w, h, seed, u) {
    const r = rng(seed);
    x.save();
    x.globalCompositeOperation = "source-atop";
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(255,240,200,0.16)");
    g.addColorStop(1, "rgba(0,10,20,0.22)");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.lineCap = "round";
    for (let i = 0; i < 1400; i++) {
      const px = r() * w;
      const py = r() * h;
      const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      const l = (2 + r() * 6) * u;
      x.strokeStyle =
        r() < 0.5
          ? `rgba(255,250,225,${0.06 + r() * 0.1})`
          : `rgba(10,25,15,${0.07 + r() * 0.12})`;
      x.lineWidth = (0.5 + r() * 1.3) * u;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      x.stroke();
    }
    x.restore();
  }

  function figureCanvas(kind, h, o) {
    const u = h / 100;
    const c = mk(h * 0.9, h * 1.12);
    const x = c.getContext("2d");
    x.translate(c.width * 0.4, c.height - 0.03 * h);
    if (kind === "keeper") drawKeeper(x, u, o);
    else drawHerbalist(x, u, o);
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (o.painted) paintTexture(x, c.width, c.height, o.seed, u);
    return { c, ox: c.width * 0.4, oy: c.height - 0.03 * h };
  }

  const SAMPLES = {
    white: { label: "Cartoon on white", file: "sample-keeper-white.jpg" },
    painted: {
      label: "Painted, see-through",
      file: "sample-herbalist-alpha.png",
    },
    three: { label: "Only three poses", file: "sample-three-poses.jpg" },
    touching: { label: "Poses touching", file: "sample-touching.jpg" },
    checker: { label: "Fake see-through", file: "sample-checkerboard.png" },
  };

  async function makeSample(kind) {
    const W = 1536;
    const H = 1024;
    const c = mk(W, H);
    const x = c.getContext("2d");
    let h = 680;
    const base = 992;
    let ch = "keeper";
    let painted = false;
    let type = "image/jpeg";
    let figs = [
      [175, 0],
      [525, 1],
      [875, 2],
      [1225, 3],
    ];
    let bg = "white";
    const jit = [
      null,
      { body: [4, 1], arms: [-4, 3], hem: 1.5 },
      { body: [-3, 2], arms: [5, -2], hem: -1.2 },
      null,
    ];
    if (kind === "painted") {
      ch = "herbalist";
      painted = true;
      type = "image/png";
      bg = null;
      h = 660;
      figs = [
        [170, 0],
        [505, 1],
        [840, 2],
        [1190, 3],
      ];
    } else if (kind === "three") {
      figs = [
        [260, 0],
        [768, 1],
        [1276, 2],
      ];
    } else if (kind === "touching") {
      figs = [
        [175, 0],
        [525, 1],
        [875, 2],
        [1060, 3],
      ];
    } else if (kind === "checker") {
      bg = "checker";
      type = "image/png";
    }
    if (bg === "white") {
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, W, H);
    } else if (bg === "checker") {
      for (let yy = 0; yy < H; yy += 16)
        for (let xx = 0; xx < W; xx += 16) {
          x.fillStyle = ((xx + yy) / 16) % 2 ? "#cccccc" : "#ffffff";
          x.fillRect(xx, yy, 16, 16);
        }
    }
    for (const [cx, f] of figs) {
      const o = {
        mouth: f === 1 ? 1 : f === 2 ? 2 : 0,
        beckon: f === 3,
        painted,
        seed: 101 + f * 7919,
        jit: painted ? jit[f] : null,
      };
      const fc = figureCanvas(ch, h, o);
      x.drawImage(fc.c, cx - fc.ox, base - fc.oy);
    }
    const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
    return new File([blob], SAMPLES[kind].file, { type });
  }

  global.SheetImport = {
    P,
    STEPS,
    SheetError,
    importSheet,
    buildSheet,
    makeSample,
    SAMPLES,
  };
})(window);
