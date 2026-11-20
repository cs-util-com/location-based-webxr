/**
 * The practice trainer's pictures: a made-up place per stretch (sky,
 * hills, a path, houses, trees), drawn from a seed, then softened and
 * covered in blobs by how far the "training" got. Nothing here is a
 * photo or a splat; it gives the practice run something that sharpens
 * the way a real preview does. Drawn on whatever 2D canvas the caller
 * gives; a canvas without a 2D context (a test DOM) is left untouched.
 *
 * @see practice-prints.ts.md
 */

/** A small, seeded xorshift generator: the same seed, the same place. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

type Hsl = readonly [number, number, number];
interface Palette {
  readonly sky: Hsl;
  readonly horizon: Hsl;
  readonly ground: Hsl;
}

const PALETTES: readonly Palette[] = [
  { sky: [205, 60, 72], horizon: [30, 70, 84], ground: [95, 22, 42] },
  { sky: [215, 45, 58], horizon: [200, 30, 82], ground: [40, 18, 46] },
  { sky: [28, 70, 66], horizon: [45, 80, 82], ground: [80, 20, 34] },
  { sky: [190, 35, 70], horizon: [180, 20, 88], ground: [120, 18, 38] },
];

const hsl = (h: number, s: number, l: number, a = 1): string =>
  `hsl(${h} ${s}% ${l}% / ${a})`;

type G = CanvasRenderingContext2D;

function drawSky(g: G, w: number, hy: number, pal: Palette): void {
  const sky = g.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, hsl(...pal.sky));
  sky.addColorStop(1, hsl(...pal.horizon));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hy + 2);
}

function drawHills(
  g: G,
  w: number,
  h: number,
  hy: number,
  r: () => number,
  pal: Palette,
): void {
  g.fillStyle = hsl(pal.ground[0] + 20, 15, pal.ground[2] + 18);
  g.beginPath();
  g.moveTo(0, hy);
  const a = r() * 6;
  for (let x = 0; x <= w; x += w / 40) {
    g.lineTo(x, hy - h * (0.05 + 0.04 * Math.sin(x / (w * 0.12) + a)));
  }
  g.lineTo(w, hy);
  g.fill();
}

function drawGround(
  g: G,
  w: number,
  h: number,
  hy: number,
  r: () => number,
  pal: Palette,
): void {
  const ground = g.createLinearGradient(0, hy, 0, h);
  ground.addColorStop(0, hsl(pal.ground[0], pal.ground[1], pal.ground[2] + 10));
  ground.addColorStop(1, hsl(pal.ground[0], pal.ground[1], pal.ground[2] - 12));
  g.fillStyle = ground;
  g.fillRect(0, hy, w, h - hy);
  const cx = w * (0.35 + r() * 0.3);
  g.fillStyle = hsl(35, 18, 70, 0.85);
  g.beginPath();
  g.moveTo(cx - w * 0.02, hy);
  g.lineTo(cx + w * 0.02, hy);
  g.lineTo(cx + w * 0.32, h);
  g.lineTo(cx - w * 0.3, h);
  g.fill();
}

function drawHouse(
  g: G,
  w: number,
  h: number,
  hy: number,
  r: () => number,
): void {
  const bw = w * (0.1 + r() * 0.16);
  const bh = h * (0.18 + r() * 0.3);
  const x = r() * (w - bw);
  const y = hy - bh + h * 0.04;
  const hue = 20 + r() * 40;
  const light = 55 + r() * 25;
  g.fillStyle = hsl(hue, 25, light);
  g.fillRect(x, y, bw, bh);
  g.fillStyle = hsl(hue + 340, 35, light - 25);
  g.beginPath();
  g.moveTo(x - bw * 0.05, y);
  g.lineTo(x + bw / 2, y - bh * 0.25);
  g.lineTo(x + bw * 1.05, y);
  g.fill();
  g.fillStyle = hsl(210, 25, 25, 0.8);
  for (let i = 0; i < 9; i++) {
    const wx = x + bw * (0.15 + (i % 3) * 0.27);
    const wy = y + bh * (0.15 + Math.floor(i / 3) * 0.25);
    g.fillRect(wx, wy, bw * 0.14, bh * 0.12);
  }
}

function drawTree(
  g: G,
  w: number,
  h: number,
  hy: number,
  r: () => number,
): void {
  const x = r() * w;
  const base = hy + r() * h * 0.25;
  const size = h * (0.07 + r() * 0.1);
  g.fillStyle = hsl(30, 30, 25);
  g.fillRect(x - size * 0.08, base - size, size * 0.16, size);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = hsl(90 + r() * 50, 35, 22 + r() * 22);
    g.beginPath();
    g.arc(
      x + (r() - 0.5) * size,
      base - size - r() * size * 0.9,
      size * (0.35 + r() * 0.3),
      0,
      Math.PI * 2,
    );
    g.fill();
  }
}

interface Scene {
  readonly canvas: HTMLCanvasElement;
  readonly pixels: Uint8ClampedArray;
}

const scenes = new Map<string, Scene>();

/** The sharp place for one seed and size; drawn once, then cached. */
function sceneFor(
  doc: Document,
  seed: number,
  w: number,
  h: number,
): Scene | null {
  const key = `${seed}:${w}x${h}`;
  const cached = scenes.get(key);
  if (cached !== undefined) return cached;
  const canvas = doc.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (g === null) return null;
  const r = seededRandom(seed * 7919 + 13);
  const pal = PALETTES[seed % PALETTES.length] ?? PALETTES[0];
  if (pal === undefined) return null;
  const hy = h * (0.4 + r() * 0.14);
  drawSky(g, w, hy, pal);
  drawHills(g, w, h, hy, r, pal);
  drawGround(g, w, h, hy, r, pal);
  const houses = 2 + Math.floor(r() * 3);
  for (let i = 0; i < houses; i++) drawHouse(g, w, h, hy, r);
  const trees = 3 + Math.floor(r() * 4);
  for (let i = 0; i < trees; i++) drawTree(g, w, h, hy, r);
  const scene = { canvas, pixels: g.getImageData(0, 0, w, h).data };
  scenes.set(key, scene);
  return scene;
}

/** Soft blobs over the picture: the "splats" still finding their place. */
function drawBlobs(
  g: G,
  base: Scene,
  w: number,
  h: number,
  sharp: number,
  seed: number,
): void {
  const r = seededRandom(seed * 104729 + 5);
  const k = w / 480;
  const radius = (2 + (1 - sharp) * 26) * k;
  const alpha = 0.06 + 0.55 * (1 - sharp);
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    const p = (y * w + x) * 4;
    const [cr, cg, cb] = [
      base.pixels[p],
      base.pixels[p + 1],
      base.pixels[p + 2],
    ];
    const grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgb(${cr} ${cg} ${cb} / ${alpha})`);
    grad.addColorStop(1, `rgb(${cr} ${cg} ${cb} / 0)`);
    g.fillStyle = grad;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Clamps a sharpness to 0..1; anything not a number is 0. */
export const clampSharpness = (x: number): number =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;

/**
 * Draws one practice print on `canvas` at a sharpness from 0 (blank
 * paper) to 1 (sharp). `ghost` adds a shifted double image, the look of a
 * stretch that did not come together.
 */
export function drawPracticePrint(
  canvas: HTMLCanvasElement,
  seed: number,
  sharpness: number,
  ghost: boolean,
  paper: string,
): void {
  const g = canvas.getContext("2d");
  if (g === null) return;
  const sharp = clampSharpness(sharpness);
  const w = canvas.width;
  const h = canvas.height;
  const k = w / 480;
  g.save();
  g.filter = "none";
  g.globalAlpha = 1;
  g.fillStyle = paper;
  g.fillRect(0, 0, w, h);
  const base = sceneFor(canvas.ownerDocument, seed, w, h);
  if (base !== null) {
    const developed = Math.min(1, 0.12 + sharp * 1.5);
    g.globalAlpha = developed;
    g.filter = `blur(${(1 - sharp) * 16 * k}px) saturate(${0.3 + 0.7 * sharp}) contrast(${0.7 + 0.3 * sharp})`;
    g.drawImage(base.canvas, 0, 0, w, h);
    if (ghost) {
      g.globalAlpha = developed * 0.45;
      g.drawImage(base.canvas, 14 * k, -4 * k, w, h);
    }
    g.filter = "none";
    g.globalAlpha = developed;
    drawBlobs(g, base, w, h, sharp, seed);
  }
  g.restore();
}
