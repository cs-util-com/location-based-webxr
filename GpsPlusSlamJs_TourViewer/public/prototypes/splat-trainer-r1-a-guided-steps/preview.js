// Synthetic preview images for the splat trainer prototype. Everything is
// drawn in code from a seed: a made-up street corner of boxes, round trees
// and a path. No photo, place or recording is used. "Sharpness" 0..1 turns
// the clean scene into what an early, blurry training preview looks like:
// low resolution, soft blobs and a colour wash.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sceneCache = new Map();

function drawScene(ctx, w, h, seed) {
  const rnd = mulberry32(seed * 7919 + 13);
  const horizon = h * (0.42 + rnd() * 0.12);
  const hue = 195 + rnd() * 30;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${hue} 55% 62%)`);
  sky.addColorStop(1, `hsl(${hue + 10} 45% 86%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  const gh = 70 + rnd() * 50;
  ground.addColorStop(0, `hsl(${gh} 22% 52%)`);
  ground.addColorStop(1, `hsl(${gh} 26% 32%)`);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Boxes standing on the horizon: back row first.
  const boxes = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < boxes; i++) {
    const bw = w * (0.08 + rnd() * 0.16);
    const bh = h * (0.12 + rnd() * 0.3);
    const x = rnd() * (w - bw);
    const tone = 18 + rnd() * 40;
    ctx.fillStyle = `hsl(${(seed * 37 + i * 53) % 360} 18% ${tone + 30}%)`;
    ctx.fillRect(x, horizon - bh, bw, bh + 2);
    ctx.fillStyle = `hsl(${(seed * 37 + i * 53) % 360} 14% ${tone + 12}%)`;
    ctx.fillRect(x + bw * 0.78, horizon - bh, bw * 0.22, bh + 2);
    // windows
    ctx.fillStyle = `hsl(${hue} 30% ${tone + 52}%)`;
    const cols = 2 + Math.floor(rnd() * 3);
    const rows = 2 + Math.floor(rnd() * 4);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const ww = (bw * 0.6) / cols;
        const wh = (bh * 0.6) / rows;
        ctx.fillRect(
          x + bw * 0.08 + c * (ww / 0.62) * 0.7,
          horizon - bh + bh * 0.12 + r * (wh / 0.62) * 0.75,
          ww * 0.55,
          wh * 0.5,
        );
      }
    }
  }

  // A path running to the horizon.
  ctx.fillStyle = `hsl(35 18% 70%)`;
  const vx = w * (0.35 + rnd() * 0.3);
  ctx.beginPath();
  ctx.moveTo(vx - 4, horizon);
  ctx.lineTo(vx + 4, horizon);
  ctx.lineTo(w * 0.78, h);
  ctx.lineTo(w * 0.22, h);
  ctx.closePath();
  ctx.fill();

  // Round trees in front.
  const trees = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < trees; i++) {
    const tx = rnd() * w;
    const ty = horizon + rnd() * (h - horizon) * 0.5;
    const r = h * (0.06 + rnd() * 0.1) * (0.6 + (ty - horizon) / h);
    ctx.fillStyle = "hsl(30 30% 26%)";
    ctx.fillRect(tx - r * 0.1, ty - r * 0.2, r * 0.2, r * 1.1);
    ctx.fillStyle = `hsl(${100 + rnd() * 40} 35% ${28 + rnd() * 16}%)`;
    ctx.beginPath();
    ctx.arc(tx, ty - r * 0.6, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cleanScene(seed, w, h) {
  const key = `${seed}:${w}x${h}`;
  let entry = sceneCache.get(key);
  if (!entry) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    drawScene(ctx, w, h, seed);
    entry = { canvas, data: ctx.getImageData(0, 0, w, h).data };
    sceneCache.set(key, entry);
  }
  return entry;
}

const scratch = document.createElement("canvas");

/**
 * Draws the preview of one stretch at a given sharpness into `canvas`.
 * @param {HTMLCanvasElement} canvas target; its width/height are used
 * @param {number} seed per-stretch scene seed
 * @param {number} sharp 0 (a colour wash) .. 1 (the clean scene)
 * @param {number} frame a counter so the blob scatter changes per preview
 */
export function drawPreview(canvas, seed, sharp, frame = 0) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || w === 0 || h === 0) return;
  const s = Math.min(1, Math.max(0, sharp));
  const { canvas: clean, data } = cleanScene(seed, w, h);

  // Resolution: 1/24 of the size when blank, full at the end.
  const scale = 1 / 24 + (1 - 1 / 24) * s ** 2.6;
  const sw = Math.max(2, Math.round(w * scale));
  const sh = Math.max(2, Math.round(h * scale));
  scratch.width = sw;
  scratch.height = sh;
  const sctx = scratch.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(clean, 0, 0, sw, sh);

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.filter = s < 0.98 ? `blur(${((1 - s) * 7).toFixed(2)}px)` : "none";
  ctx.drawImage(scratch, 0, 0, w, h);
  ctx.filter = "none";

  // Soft splat blobs: many and large early, few and small late.
  const blobs = Math.round(260 * (1 - s));
  const rnd = mulberry32(seed * 31 + frame * 101);
  for (let i = 0; i < blobs; i++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    const idx = (y * w + x) * 4;
    const r = (2 + rnd() * 18) * (1.2 - s);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const rgb = `${data[idx]} ${data[idx + 1]} ${data[idx + 2]}`;
    g.addColorStop(0, `rgb(${rgb} / ${0.55 * (1 - s)})`);
    g.addColorStop(1, `rgb(${rgb} / 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.4 + rnd() * 0.8), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // A grey haze that lifts as the model learns the colours.
  ctx.fillStyle = `rgb(128 128 132 / ${0.45 * (1 - s) ** 2})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
