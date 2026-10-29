// Throwaway prototype: the character-sheet import, plain browser JS.
// decode -> background (alpha or border flood fill) -> poses (column gaps)
// -> align (common scale, one baseline, equal cells) -> check (body
// movement below the head band, mouth, pointing arm) -> steady body.
// Runs on the main thread here; the real build moves it to a Worker.
(function () {
  "use strict";

  const DEFAULTS = {
    whiteTol: 28, // max channel distance from the border colour that still counts as background
    alphaThr: 32, // alpha below this is background
    minGapFrac: 0.004, // empty column run narrower than this (of the width) does not split figures
    specFrac: 0.02, // a column group with less than this share of the biggest one's pixels is a speck
    cellW: 512,
    cellH: 1024,
    headBand: 0.3, // top share of the figure height taken from the talking frame
    featherFrac: 0.05, // feather of the head band, as a share of the figure height
    diffThr: 48, // a pixel "differs" when a channel differs by more than this
    jitterWarn: 0.05, // body difference above this share means the body jumps (real images: flat 1.9-3.2 %, painted 6.9-18 %)
    mouthMin: 0.0015, // head difference below this means the mouth hardly moves
    maxShift: 3, // shift search, in half-resolution pixels (about 6 px at full size)
    maxPixels: 40e6,
    minPhaseMs: 160, // keep every phase on screen long enough to be read
  };

  class ImportError extends Error {
    constructor(phase, code, message, detail) {
      super(message);
      this.phase = phase;
      this.code = code;
      this.detail = detail || {};
    }
  }

  const PHASES = [
    { id: "read", label: "Reading the picture" },
    { id: "background", label: "Removing the background" },
    { id: "poses", label: "Finding the four poses" },
    { id: "align", label: "Lining them up on one ground line" },
    { id: "check", label: "Checking the talking poses" },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  async function decode(blob, o) {
    const name = (blob && blob.name) || "";
    const type = (blob && blob.type) || "";
    if (
      !blob ||
      !(type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(name))
    ) {
      throw new ImportError(
        "read",
        "not-image",
        "This file is not a picture.",
        { name, type },
      );
    }
    let bmp;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      throw new ImportError(
        "read",
        "decode",
        "This picture could not be opened. PNG, JPEG and WebP work.",
        { name },
      );
    }
    const w = bmp.width;
    const h = bmp.height;
    if (w * h > o.maxPixels) {
      bmp.close && bmp.close();
      throw new ImportError(
        "read",
        "too-big",
        "This picture is too big to cut on this device.",
        { w, h },
      );
    }
    if (w < 240 || h < 120) {
      bmp.close && bmp.close();
      throw new ImportError(
        "read",
        "too-small",
        "This picture is too small to hold four poses.",
        { w, h },
      );
    }
    const c = makeCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    return ctx.getImageData(0, 0, w, h);
  }

  function median(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 0;
  }

  // Returns { alpha: Uint8Array (0..255 per pixel), rgb: Uint8ClampedArray (decontaminated), mode }
  function cutBackground(img, o) {
    const { width: w, height: h, data: d } = img;
    const n = w * h;
    let sampled = 0;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4 * 7) {
      sampled++;
      if (d[i] < 250) transparent++;
    }
    const alpha = new Uint8Array(n);
    const rgb = new Uint8ClampedArray(d); // copy, may be decontaminated below
    let fg = 0;
    if (transparent / sampled > 0.01) {
      for (let i = 0; i < n; i++) {
        const a = d[i * 4 + 3];
        // the figures' alpha can top out just under 255 (253 in a real AI output): snap it
        const v = a < o.alphaThr ? 0 : a >= 240 ? 255 : a;
        alpha[i] = v;
        if (v) fg++;
      }
      checkForeground(fg, n);
      return { alpha, rgb, mode: "alpha" };
    }

    // flat background: sample the whole border
    const br = [];
    const bgc = [];
    const bb = [];
    const borderIdx = [];
    for (let x = 0; x < w; x++) borderIdx.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) borderIdx.push(y * w, y * w + w - 1);
    for (const i of borderIdx) {
      br.push(d[i * 4]);
      bgc.push(d[i * 4 + 1]);
      bb.push(d[i * 4 + 2]);
    }
    const bg = [median(br), median(bgc), median(bb)];
    const tol = o.whiteTol;
    const near = (i) => {
      const p = i * 4;
      return (
        Math.max(
          Math.abs(d[p] - bg[0]),
          Math.abs(d[p + 1] - bg[1]),
          Math.abs(d[p + 2] - bg[2]),
        ) <= tol
      );
    };
    let nearBorder = 0;
    for (const i of borderIdx) if (near(i)) nearBorder++;
    const share = nearBorder / borderIdx.length;
    if (share < 0.7) {
      // two light colours alternating along the border: a checkerboard painted as fake transparency
      const others = borderIdx.filter((i) => !near(i));
      const lum = (i) =>
        0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
      const otherLum = median(others.map(lum));
      const bgLum = 0.3 * bg[0] + 0.59 * bg[1] + 0.11 * bg[2];
      if (
        others.length / borderIdx.length > 0.2 &&
        otherLum > 140 &&
        bgLum > 140
      ) {
        throw new ImportError(
          "background",
          "checkerboard",
          "The background is a grey and white checkerboard drawn into the picture, not real transparency.",
          {},
        );
      }
      throw new ImportError(
        "background",
        "busy",
        "The background is not one flat colour, so the figures cannot be cut out.",
        { share },
      );
    }

    // flood fill from the border: near-white pixels INSIDE the figures (eyes, teeth) stay
    const bgMask = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0;
    let qt = 0;
    const push = (i) => {
      if (bgMask[i]) return;
      if (near(i)) {
        bgMask[i] = 1;
        q[qt++] = i;
      }
    };
    for (const i of borderIdx) push(i);
    while (qh < qt) {
      const i = q[qh++];
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
    for (let i = 0; i < n; i++) {
      if (bgMask[i]) continue;
      alpha[i] = 255;
      fg++;
    }
    // soften the cut edge and take the background colour out of edge pixels (no white halo)
    for (let i = 0; i < n; i++) {
      if (!alpha[i]) continue;
      const x = i % w;
      const edge =
        (x > 0 && bgMask[i - 1]) ||
        (x < w - 1 && bgMask[i + 1]) ||
        (i >= w && bgMask[i - w]) ||
        (i < n - w && bgMask[i + w]);
      if (!edge) continue;
      const p = i * 4;
      const dist = Math.max(
        Math.abs(d[p] - bg[0]),
        Math.abs(d[p + 1] - bg[1]),
        Math.abs(d[p + 2] - bg[2]),
      );
      const a = Math.min(1, Math.max(0.08, (dist - tol * 0.5) / 96));
      alpha[i] = Math.round(a * 255);
      for (let c = 0; c < 3; c++) rgb[p + c] = (d[p + c] - bg[c] * (1 - a)) / a;
    }
    checkForeground(fg, n);
    return { alpha, rgb, mode: "white", bg };
  }

  function checkForeground(fg, n) {
    if (fg / n < 0.005) {
      throw new ImportError(
        "background",
        "empty",
        "No figure was found in this picture.",
        {},
      );
    }
    if (fg / n > 0.85) {
      throw new ImportError(
        "background",
        "busy",
        "The background could not be separated from the figures.",
        {},
      );
    }
  }

  function findFigures(alpha, w, h, o) {
    const col = new Uint32Array(w);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) if (alpha[row + x] >= 128) col[x]++;
    }
    const minCol = Math.max(1, Math.round(h * 0.002));
    let runs = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && col[x] >= minCol;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x0: start, x1: x - 1 });
        start = -1;
      }
    }
    const minGap = Math.max(2, Math.round(w * o.minGapFrac));
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
    runs = merged.filter((r) => r.mass >= o.specFrac * maxMass);
    for (const r of runs) {
      // rows with at least 2 figure pixels in this column range (ignores single specks)
      let y0 = -1;
      let y1 = -1;
      for (let y = 0; y < h; y++) {
        let c = 0;
        const row = y * w;
        for (let x = r.x0; x <= r.x1 && c < 2; x++)
          if (alpha[row + x] >= 128) c++;
        if (c >= 2) {
          if (y0 < 0) y0 = y;
          y1 = y;
        }
      }
      r.y0 = y0;
      r.y1 = y1;
    }
    const gaps = [];
    for (let i = 1; i < runs.length; i++)
      gaps.push(runs[i].x0 - runs[i - 1].x1 - 1);
    return { runs, gaps, minGap };
  }

  function diagnoseCount(runs) {
    const n = runs.length;
    if (n === 0) return { code: "empty", joined: [] };
    if (n > 4) return { code: "extra", joined: [] };
    const widths = runs.map((r) => r.x1 - r.x0 + 1);
    const narrow = Math.min(...widths);
    const joined = [];
    widths.forEach((wd, i) => {
      if (wd > 1.6 * narrow) joined.push(i);
    });
    return { code: joined.length ? "joined" : "missing", joined };
  }

  function alignFrames(img, cut, runs, o) {
    const { width: w, height: h } = img;
    const src = makeCanvas(w, h);
    const sctx = src.getContext("2d");
    const out = sctx.createImageData(w, h);
    const od = out.data;
    for (let i = 0, n = w * h; i < n; i++) {
      const p = i * 4;
      od[p] = cut.rgb[p];
      od[p + 1] = cut.rgb[p + 1];
      od[p + 2] = cut.rgb[p + 2];
      od[p + 3] = cut.alpha[i];
    }
    sctx.putImageData(out, 0, 0);
    // horizontal anchor: the median figure column in the bottom quarter (the legs),
    // so an outstretched arm does not push the body off centre
    for (const r of runs) {
      const yFrom = Math.round(r.y1 - 0.25 * (r.y1 - r.y0));
      const hist = new Uint32Array(r.x1 - r.x0 + 1);
      let total = 0;
      for (let y = yFrom; y <= r.y1; y++) {
        const row = y * w;
        for (let x = r.x0; x <= r.x1; x++)
          if (cut.alpha[row + x] >= 128) {
            hist[x - r.x0]++;
            total++;
          }
      }
      let acc = 0;
      let ax = (r.x0 + r.x1) / 2;
      for (let i = 0; i < hist.length; i++) {
        acc += hist[i];
        if (acc >= total / 2) {
          ax = r.x0 + i;
          break;
        }
      }
      r.ax = ax;
    }
    const figH = Math.max(...runs.map((r) => r.y1 - r.y0 + 1));
    const halfExt = Math.max(
      ...runs.map((r) => Math.max(r.ax - r.x0, r.x1 - r.ax) + 1),
    );
    const s = Math.min((o.cellH * 0.92) / figH, (o.cellW * 0.47) / halfExt);
    const baseline = Math.round(o.cellH * 0.96);
    const frames = runs.map((r) => {
      const c = makeCanvas(o.cellW, o.cellH);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const bw = r.x1 - r.x0 + 1;
      const bh = r.y1 - r.y0 + 1;
      ctx.drawImage(
        src,
        r.x0,
        r.y0,
        bw,
        bh,
        o.cellW / 2 - (r.ax - r.x0) * s,
        baseline - bh * s,
        bw * s,
        bh * s,
      );
      return c;
    });
    return { frames, scale: s };
  }

  function getData(canvas, scale) {
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const c = makeCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  // share of figure pixels (union of both masks, rows yFrom..yTo) that differ between
  // a(x, y) and b(x + dx, y + dy)
  function diffShare(a, b, dx, dy, yFrom, yTo, thr) {
    const w = a.width;
    const h = a.height;
    const A = a.data;
    const B = b.data;
    let union = 0;
    let differ = 0;
    for (let y = Math.max(0, yFrom); y <= Math.min(h - 1, yTo); y++) {
      const yb = y + dy;
      for (let x = 0; x < w; x++) {
        const pa = (y * w + x) * 4;
        const xb = x + dx;
        const inB = xb >= 0 && xb < w && yb >= 0 && yb < h;
        const pb = (yb * w + xb) * 4;
        const aa = A[pa + 3];
        const ab = inB ? B[pb + 3] : 0;
        if (aa < 128 && ab < 128) continue;
        union++;
        if (aa >= 128 !== ab >= 128) {
          differ++;
          continue;
        }
        if (
          Math.abs(A[pa] - B[pb]) > thr ||
          Math.abs(A[pa + 1] - B[pb + 1]) > thr ||
          Math.abs(A[pa + 2] - B[pb + 2]) > thr
        )
          differ++;
      }
    }
    return union ? differ / union : 0;
  }

  function bestShift(a, b, yFrom, yTo, o) {
    let best = { dx: 0, dy: 0, share: Infinity };
    for (let dy = -o.maxShift; dy <= o.maxShift; dy++)
      for (let dx = -o.maxShift; dx <= o.maxShift; dx++) {
        const s = diffShare(a, b, dx, dy, yFrom, yTo, o.diffThr);
        if (s < best.share) best = { dx, dy, share: s };
      }
    return best;
  }

  function extents(img) {
    const { width: w, height: h, data: d } = img;
    let top = h;
    let bottom = -1;
    let left = w;
    let right = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] >= 128) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
    return { top, bottom, left, right };
  }

  function checkFrames(frames, opts) {
    const o = { ...DEFAULTS, ...opts };
    const k = 0.5;
    const D = frames.map((f) => getData(f, k));
    const ext = D.map(extents);
    const idle = ext[0];
    const figH = idle.bottom - idle.top + 1;
    const bandEnd = Math.round(idle.top + o.headBand * figH);
    const talk = [1, 2].map((i) => {
      const body = bestShift(D[0], D[i], bandEnd, idle.bottom, o);
      const head = bestShift(D[0], D[i], idle.top, bandEnd, o);
      return {
        body: body.share,
        head: head.share,
        headShift: { dx: head.dx / k, dy: head.dy / k },
      };
    });
    const bodyDiff = Math.max(talk[0].body, talk[1].body);
    const headDiff = Math.max(talk[0].head, talk[1].head);
    const beckonDiff = diffShare(
      D[0],
      D[3],
      0,
      0,
      idle.top,
      idle.bottom,
      o.diffThr,
    );
    const W = D[0].width;
    const cx = W / 2;
    const idleR = idle.right - cx;
    const idleL = cx - idle.left;
    const bR = ext[3].right - cx;
    const bL = cx - ext[3].left;
    const warnings = [];
    if (headDiff < o.mouthMin) warnings.push("mouth");
    if (beckonDiff < 0.04) warnings.push("beckon-same");
    else if (bL - idleL > bR - idleR + 0.03 * W && bL - idleL > 0.05 * W)
      warnings.push("beckon-left");
    const heights = ext.map((e) => e.bottom - e.top + 1);
    if (Math.min(...heights) < 0.85 * Math.max(...heights))
      warnings.push("sizes");
    return {
      bodyDiff,
      headDiff,
      beckonDiff,
      talk,
      jitter: bodyDiff > o.jitterWarn,
      figTop: idle.top / k,
      figH: figH / k,
      bandEnd: bandEnd / k,
      warnings,
    };
  }

  // idle body + the talking frame's head band (aligned by the head's best shift), feathered
  function steadyBody(frames, check, opts) {
    const o = { ...DEFAULTS, ...opts };
    const w = frames[0].width;
    const h = frames[0].height;
    const ctx0 = frames[0].getContext("2d", { willReadFrequently: true });
    const I = ctx0.getImageData(0, 0, w, h).data;
    const feather = Math.max(4, o.featherFrac * check.figH);
    const y0 = check.bandEnd - feather / 2;
    const y1 = check.bandEnd + feather / 2;
    const out = [frames[0]];
    for (const t of [1, 2]) {
      const T = frames[t]
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, w, h).data;
      const { dx, dy } = check.talk[t - 1].headShift;
      const c = makeCanvas(w, h);
      const cctx = c.getContext("2d");
      const img = cctx.createImageData(w, h);
      const O = img.data;
      for (let y = 0; y < h; y++) {
        let wt = y <= y0 ? 1 : y >= y1 ? 0 : 1 - (y - y0) / (y1 - y0);
        wt = wt * wt * (3 - 2 * wt);
        const yt = Math.round(y + dy);
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          const xt = Math.round(x + dx);
          const inT = wt > 0 && xt >= 0 && xt < w && yt >= 0 && yt < h;
          const q = (yt * w + xt) * 4;
          const ai = I[p + 3] / 255;
          const at = inT ? T[q + 3] / 255 : 0;
          const a = at * wt + ai * (1 - wt);
          O[p + 3] = Math.round(a * 255);
          if (a > 0)
            for (let ch = 0; ch < 3; ch++)
              O[p + ch] =
                ((inT ? T[q + ch] * at : 0) * wt + I[p + ch] * ai * (1 - wt)) /
                a;
        }
      }
      cctx.putImageData(img, 0, 0);
      out.push(c);
    }
    out.push(frames[3]);
    return out;
  }

  async function analyze(blob, opts, onPhase) {
    const o = { ...DEFAULTS, ...opts };
    const report = onPhase || (() => {});
    const phase = async (id, fn) => {
      report(id, "running");
      const t0 = performance.now();
      await sleep(20); // let the in-progress state paint
      try {
        const r = await fn();
        const left = o.minPhaseMs - (performance.now() - t0);
        if (left > 0) await sleep(left);
        report(id, "done", r && r.note);
        return r;
      } catch (e) {
        report(id, "failed", e.message);
        throw e;
      }
    };
    const t0 = performance.now();
    const img = await phase("read", async () => {
      const im = await decode(blob, o);
      im.note = im.width + " x " + im.height;
      return im;
    });
    const cut = await phase("background", async () => {
      const c = cutBackground(img, o);
      c.note =
        c.mode === "alpha"
          ? "it was already transparent"
          : "flat background cut away";
      return c;
    });
    const found = await phase("poses", async () => {
      const f = findFigures(cut.alpha, img.width, img.height, o);
      if (f.runs.length !== 4) {
        const dg = diagnoseCount(f.runs);
        const msg =
          dg.code === "joined"
            ? "Found " + f.runs.length + " instead of 4: two poses touch"
            : dg.code === "extra"
              ? "Found " + f.runs.length + " shapes instead of 4"
              : dg.code === "empty"
                ? "Found no pose"
                : "Found only " + f.runs.length + " poses";
        throw new ImportError("poses", dg.code, msg, {
          runs: f.runs,
          joined: dg.joined,
          w: img.width,
          h: img.height,
          img,
          cut,
        });
      }
      f.note = "gaps of " + f.gaps.join(", ") + " px";
      return f;
    });
    const al = await phase("align", async () => {
      const a = alignFrames(img, cut, found.runs, o);
      a.note = "4 frames of " + o.cellW + " x " + o.cellH;
      return a;
    });
    const check = await phase("check", async () => {
      const c = checkFrames(al.frames, o);
      c.note = c.jitter
        ? "the body moves while talking"
        : "the body stays still";
      return c;
    });
    return {
      frames: al.frames,
      check,
      mode: cut.mode,
      runs: found.runs,
      gaps: found.gaps,
      size: { w: img.width, h: img.height },
      ms: Math.round(performance.now() - t0),
    };
  }

  // parameter probe for the self-check (no delays)
  async function probe(blob, opts) {
    const o = { ...DEFAULTS, ...opts, minPhaseMs: 0 };
    const img = await decode(blob, o);
    const cut = cutBackground(img, o);
    const f = findFigures(cut.alpha, img.width, img.height, o);
    const res = {
      mode: cut.mode,
      count: f.runs.length,
      gaps: f.gaps,
      minGap: f.minGap,
    };
    if (f.runs.length === 4) {
      const al = alignFrames(img, cut, f.runs, o);
      const c = checkFrames(al.frames, o);
      res.bodyDiff = +c.bodyDiff.toFixed(4);
      res.headDiff = +c.headDiff.toFixed(4);
      res.beckonDiff = +c.beckonDiff.toFixed(4);
      res.jitter = c.jitter;
      res.warnings = c.warnings;
      if (c.jitter) {
        const st = steadyBody(al.frames, c, o);
        const c2 = checkFrames(st, o);
        res.bodyDiffSteady = +c2.bodyDiff.toFixed(4);
      }
    }
    return res;
  }

  window.CharImport = {
    DEFAULTS,
    PHASES,
    ImportError,
    analyze,
    checkFrames,
    steadyBody,
    probe,
    makeCanvas,
  };
})();
