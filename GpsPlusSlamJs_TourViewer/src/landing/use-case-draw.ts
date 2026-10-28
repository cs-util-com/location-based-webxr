/**
 * The drawing kit of the use-case pictures: the muted palette of the real
 * scene, the two looks of the augmented layer, and the small pieces the
 * pictures are built from. Every function returns an SVG fragment as a
 * string, so the pictures render and test in node without a DOM.
 *
 * @see use-case-draw.ts.md
 */
import { escapeHtml } from "gps-plus-slam-app-framework/utils/escape-html";

/**
 * How the augmented layer is set apart from the real scene.
 *
 * - `route-light`: the scene in paper tones; everything augmented drawn in
 *   the route's own colours, with a soft route glow and a thin light outline.
 * - `true-colour`: the scene dimmed further (desaturated, a paper veil);
 *   everything augmented in its own colours, with the same glow and outline.
 */
export type UseCaseTreatment = "route-light" | "true-colour";

export const USE_CASE_TREATMENTS: readonly UseCaseTreatment[] = [
  "route-light",
  "true-colour",
];

/** The phone screen's drawing size: 21:10, a phone held sideways. */
export const SCREEN_W = 210;
export const SCREEN_H = 100;

/**
 * The route ramp, deep to pale: index 1 is the route colour itself
 * (`--map-route`), the others are its darker and lighter steps.
 */
export const ROUTE_RAMP = [
  "#a8341d",
  "#cf4428",
  "#e2735b",
  "#f0a893",
  "#fadcd2",
] as const;

/** A step of {@link ROUTE_RAMP}. */
export type AugTone = 0 | 1 | 2 | 3 | 4;

/**
 * The real scene's palette: paper, stone, sage and slate tones, every one
 * with a chroma (largest minus smallest channel) of at most 48, against the
 * route colour's 167. `use-case-data.test.ts` holds every scene to it.
 */
export const REAL = {
  sky: "#e4e5dc",
  skyLow: "#eceae0",
  far: "#d4d3c0",
  farShade: "#c9c8b4",
  ground: "#dcd7c2",
  groundDark: "#d0cab2",
  groundLight: "#e5e1cf",
  path: "#efebe0",
  wall: "#ece6d8",
  wallShade: "#d8d1c1",
  roof: "#b9b1a3",
  roofShade: "#a9a194",
  window: "#a6a094",
  door: "#9b9387",
  trunk: "#a89c8a",
  leaf: "#b8b9a1",
  leafShade: "#a9ab93",
  leafDark: "#9ea088",
  leafLight: "#c4c4ad",
  water: "#c9d1cd",
  waterLight: "#d9dfdb",
  stone: "#cfc9bc",
  stoneShade: "#bcb5a7",
  wood: "#b0a490",
  ink: "#8c877e",
} as const;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function assertHex(colour: string): void {
  if (typeof colour !== "string" || !HEX.test(colour)) {
    throw new TypeError(`not a hex colour: ${String(colour)}`);
  }
}

function assertTreatment(t: UseCaseTreatment): void {
  if (!USE_CASE_TREATMENTS.includes(t)) {
    throw new RangeError(`unknown use-case look: ${String(t)}`);
  }
}

/** The spread between a hex colour's largest and smallest channel (0-255). */
export function chroma(colour: string): number {
  assertHex(colour);
  const h = colour.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

/**
 * The colour of an augmented shape: the route ramp's `tone` in the
 * route-light look, the shape's own `natural` colour in the true-colour look.
 */
export function augColour(
  t: UseCaseTreatment,
  natural: string,
  tone: AugTone,
): string {
  assertTreatment(t);
  assertHex(natural);
  return t === "route-light" ? ROUTE_RAMP[tone] : natural;
}

/** A number written short and stable (no float noise in the markup). */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

const SERIF = "Georgia, 'Iowan Old Style', serif";
const SANS = "system-ui, sans-serif";
/** A card's text line, as a share of its title's size. */
const TEXT_SCALE = 0.86;
/**
 * Average glyph widths (em) the card sizes itself by: about the widest
 * common faces (a bold serif fallback, Verdana for the sans line), so a
 * card fits its text wherever the page is read.
 */
const SERIF_EM = 0.6;
const SANS_EM = 0.6;

export interface CardOptions {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly title: string;
  /** One short line under the title. */
  readonly text?: string;
  /** Grey bars standing for further lines of text. */
  readonly lines?: number;
  /** The title's font size (default 8). */
  readonly size?: number;
}

/** A card's colours per look: its ground, its title and its text bars. */
const CARD_INK: Readonly<
  Record<UseCaseTreatment, { fill: string; title: string; bar: string }>
> = {
  "route-light": { fill: "#fffaf6", title: ROUTE_RAMP[0], bar: ROUTE_RAMP[4] },
  "true-colour": { fill: "#ffffff", title: "#2a2824", bar: "#d6cdb8" },
};

const CARD_PAD = 4;

/**
 * Where a card sits and how wide it is. SVG text is not measured here (no
 * DOM), so a card is at least as wide as a generous estimate of its text,
 * for wide fallback faces too, and moves left rather than leave the screen.
 */
function cardBox(o: CardOptions, size: number): { x: number; w: number } {
  const need =
    CARD_PAD * 2 +
    Math.max(
      o.title.length * size * SERIF_EM,
      (o.text ?? "").length * size * TEXT_SCALE * SANS_EM,
    );
  const w = Math.max(o.w, need);
  return { x: Math.max(2, Math.min(o.x, SCREEN_W - 2 - w)), w };
}

/** Grey bars standing for further lines of text, the last one shorter. */
function cardBars(
  x: number,
  y: number,
  w: number,
  lines: number,
  fill: string,
): string {
  let out = "";
  for (let i = 0; i < lines; i += 1) {
    const share = i === lines - 1 && lines > 1 ? 0.62 : 0.9;
    out += `<rect x="${n(x + CARD_PAD)}" y="${n(y + 1.6 + i * 4.6)}" width="${n((w - CARD_PAD * 2) * share)}" height="2.4" rx="1.2" fill="${fill}"/>`;
  }
  return out;
}

/**
 * A white card with a route-coloured edge: a station's words floating at
 * the spot. Its height follows its content.
 */
export function card(t: UseCaseTreatment, o: CardOptions): string {
  assertTreatment(t);
  if (!(o.w > 0)) throw new RangeError("a card needs a width");
  const size = o.size ?? 8;
  const lines = o.lines ?? 0;
  const ink = CARD_INK[t];
  const textSize = size * TEXT_SCALE;
  const { x, w } = cardBox(o, size);
  const textH = o.text === undefined ? 0 : textSize * 1.25;
  const h = CARD_PAD * 2 + size + textH + Math.max(0, lines * 4.6 - 0.6);
  const top = o.y + CARD_PAD + size;
  const text =
    o.text === undefined
      ? ""
      : `<text x="${n(x + CARD_PAD)}" y="${n(top + textSize * 1.1)}" font-family="${SANS}" font-size="${n(textSize)}" fill="#57534a">${escapeHtml(o.text)}</text>`;
  return (
    `<rect x="${n(x)}" y="${n(o.y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${ink.fill}" stroke="${ROUTE_RAMP[1]}" stroke-width="0.7"/>` +
    `<text x="${n(x + CARD_PAD)}" y="${n(o.y + CARD_PAD + size * 0.82)}" font-family="${SERIF}" font-size="${n(size)}" font-weight="700" fill="${ink.title}">${escapeHtml(o.title)}</text>` +
    text +
    cardBars(x, top + textH, w, lines, ink.bar)
  );
}

export interface PhotoOptions {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Degrees, about the frame's centre. */
  readonly rot?: number;
  /** The picture, drawn in its own 60 x 44 box. */
  readonly inner: string;
}

/** A photo or a drawing in a white frame, floating at the spot. */
export function photo(t: UseCaseTreatment, o: PhotoOptions): string {
  assertTreatment(t);
  if (!(o.w > 6 && o.h > 6)) throw new RangeError("a photo needs a size");
  const rot = o.rot ?? 0;
  const frame = t === "route-light" ? "#fffaf6" : "#ffffff";
  const turn =
    rot === 0
      ? ""
      : ` transform="rotate(${n(rot)} ${n(o.x + o.w / 2)} ${n(o.y + o.h / 2)})"`;
  return (
    `<g${turn}>` +
    `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${frame}" stroke="${ROUTE_RAMP[1]}" stroke-width="0.6"/>` +
    `<svg x="${n(o.x + 2)}" y="${n(o.y + 2)}" width="${n(o.w - 4)}" height="${n(o.h - 4)}" viewBox="0 0 60 44" preserveAspectRatio="xMidYMid slice">${o.inner}</svg>` +
    `</g>`
  );
}

/** The dashed ring on the ground where a station stands. */
export function anchor(x: number, y: number, rx: number): string {
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(rx * 0.3)}" fill="none" stroke="${ROUTE_RAMP[1]}" stroke-width="0.9" stroke-dasharray="2.4 1.6"/>`;
}

/** A thin line tying a floating card to its spot on the ground. */
export function stalk(x: number, y1: number, y2: number): string {
  return `<path d="M${n(x)} ${n(y1)}V${n(y2)}" stroke="${ROUTE_RAMP[0]}" stroke-width="0.7"/>`;
}

/**
 * The filters a look needs, once per document: the glow with the thin
 * light outline for the augmented layer (both looks) and, in the
 * true-colour look, the desaturation of the scene.
 */
export function treatmentDefs(t: UseCaseTreatment): string {
  assertTreatment(t);
  const glow =
    `<filter id="uc-glow-${t}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="0.8" result="edge"/>` +
    `<feFlood flood-color="#ffffff" flood-opacity="0.95"/>` +
    `<feComposite in2="edge" operator="in" result="outline"/>` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="1.4" result="wide"/>` +
    `<feGaussianBlur in="wide" stdDeviation="2.6" result="soft"/>` +
    `<feFlood flood-color="${ROUTE_RAMP[1]}" flood-opacity="0.6"/>` +
    `<feComposite in2="soft" operator="in" result="glow"/>` +
    `<feMerge><feMergeNode in="glow"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>`;
  const mute =
    t === "true-colour"
      ? `<filter id="uc-mute-${t}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.15"/></filter>`
      : "";
  return glow + mute;
}

/**
 * One screen's drawing: the real scene, then the augmented overlay on top
 * of it (AR content is drawn over the camera image), the overlay lit by the
 * look's glow.
 */
export function screenLayers(
  t: UseCaseTreatment,
  scene: string,
  overlay: string,
): string {
  assertTreatment(t);
  const real =
    t === "true-colour"
      ? `<g class="uc-real" filter="url(#uc-mute-${t})">${scene}</g>` +
        `<rect class="uc-veil" width="${SCREEN_W}" height="${SCREEN_H}" fill="#f4eedf" opacity="0.3"/>`
      : `<g class="uc-real">${scene}</g>`;
  return `${real}<g class="uc-aug" filter="url(#uc-glow-${t})">${overlay}</g>`;
}

// ---- pieces of the real scene (always the muted palette) ----

/** A deciduous tree: trunk and a faceted crown of radius `r`. */
export function tree(x: number, base: number, r: number): string {
  const cy = base - r * 1.9;
  const p = (dx: number, dy: number) => `${n(x + dx * r)},${n(cy + dy * r)}`;
  const c = p(0, 0);
  const rim = [
    p(-1, -0.15),
    p(-0.45, -0.95),
    p(0.5, -0.9),
    p(1, -0.1),
    p(0.6, 0.75),
    p(-0.55, 0.8),
  ];
  const tones = [
    REAL.leafLight,
    REAL.leaf,
    REAL.leafShade,
    REAL.leafDark,
    REAL.leafShade,
    REAL.leaf,
  ];
  const facets = rim
    .map(
      (a, i) =>
        `<polygon points="${c} ${a} ${rim[(i + 1) % rim.length]}" fill="${tones[i]}"/>`,
    )
    .join("");
  return (
    `<polygon points="${n(x - r * 0.12)},${n(base)} ${n(x + r * 0.12)},${n(base)} ${n(x + r * 0.08)},${n(cy)} ${n(x - r * 0.08)},${n(cy)}" fill="${REAL.trunk}"/>` +
    facets
  );
}

/** A conifer of height `h` standing at (x, base). */
export function conifer(x: number, base: number, h: number): string {
  const w = h * 0.32;
  return (
    `<polygon points="${n(x - w)},${n(base)} ${n(x)},${n(base - h)} ${n(x)},${n(base)}" fill="${REAL.leafShade}"/>` +
    `<polygon points="${n(x)},${n(base - h)} ${n(x + w)},${n(base)} ${n(x)},${n(base)}" fill="${REAL.leafDark}"/>`
  );
}

/** A gabled house: lit front, shaded side, roof and windows. */
export function house(x: number, base: number, w: number, h: number): string {
  const top = base - h;
  const ridge = top - w * 0.42;
  const side = w * 0.45;
  return (
    `<polygon points="${n(x)},${n(base)} ${n(x)},${n(top)} ${n(x + w / 2)},${n(ridge)} ${n(x + w)},${n(top)} ${n(x + w)},${n(base)}" fill="${REAL.wall}"/>` +
    `<polygon points="${n(x + w)},${n(base)} ${n(x + w)},${n(top)} ${n(x + w + side)},${n(top + 2)} ${n(x + w + side)},${n(base)}" fill="${REAL.wallShade}"/>` +
    `<polygon points="${n(x + w / 2)},${n(ridge)} ${n(x + w / 2 + side)},${n(ridge + 2)} ${n(x + w + side)},${n(top + 2)} ${n(x + w)},${n(top)}" fill="${REAL.roofShade}"/>` +
    `<path d="M${n(x - 1.5)} ${n(top + 1)}L${n(x + w / 2)} ${n(ridge - 1)}L${n(x + w + 1.5)} ${n(top + 1)}" fill="none" stroke="${REAL.roof}" stroke-width="2"/>` +
    `<rect x="${n(x + w * 0.18)}" y="${n(top + h * 0.18)}" width="${n(w * 0.22)}" height="${n(h * 0.24)}" fill="${REAL.window}"/>` +
    `<rect x="${n(x + w * 0.6)}" y="${n(top + h * 0.18)}" width="${n(w * 0.22)}" height="${n(h * 0.24)}" fill="${REAL.window}"/>` +
    `<rect x="${n(x + w * 0.4)}" y="${n(base - h * 0.42)}" width="${n(w * 0.2)}" height="${n(h * 0.42)}" fill="${REAL.door}"/>`
  );
}

/** A park bench, seen from the front, its seat at height y. */
export function bench(x: number, y: number, w: number): string {
  return (
    `<rect x="${n(x)}" y="${n(y - 6)}" width="${n(w)}" height="2.4" fill="${REAL.wood}"/>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="2.6" fill="${REAL.wood}"/>` +
    `<rect x="${n(x + 2)}" y="${n(y + 2.6)}" width="2" height="6" fill="${REAL.ink}"/>` +
    `<rect x="${n(x + w - 4)}" y="${n(y + 2.6)}" width="2" height="6" fill="${REAL.ink}"/>`
  );
}

/** A range of faceted hills along `y`, the far ground of an outdoor scene. */
export function hills(y: number): string {
  const tops = [
    [0, 4],
    [34, -6],
    [70, 0],
    [112, -9],
    [150, -2],
    [186, -7],
    [210, -3],
  ] as const;
  const ridge = tops.map(([x, dy]) => `${x},${n(y + dy)}`).join(" ");
  const shades = tops
    .slice(1, -1)
    .map(([x, dy], i) =>
      i % 2 === 0
        ? `<polygon points="${x},${n(y + dy)} ${x + 18},${n(y + dy + 5)} ${x + 6},${n(y + 10)}" fill="${REAL.farShade}"/>`
        : "",
    )
    .join("");
  return `<polygon points="${ridge} 210,${n(y + 10)} 0,${n(y + 10)}" fill="${REAL.far}"/>${shades}`;
}

/** The sky (top to `horizon`) and the ground below it. */
export function land(horizon: number): string {
  return (
    `<rect width="${SCREEN_W}" height="${n(horizon + 2)}" fill="${REAL.sky}"/>` +
    `<rect y="${n(horizon)}" width="${SCREEN_W}" height="${n(SCREEN_H - horizon)}" fill="${REAL.ground}"/>`
  );
}
