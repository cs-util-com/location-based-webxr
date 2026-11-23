/**
 * The picture of one shot against the one before it: panel A, an arrow naming the
 * change, panel B, as one SVG string from constants only (no input text
 * reaches it). Colours come from the page's `--a`, `--b` and `--accent`.
 *
 * @see guided-diagram.ts.md
 */

export const DIAGRAM_KINDS = [
  "light-same",
  "light-dim",
  "light-dark",
  "rot-0",
  "rot-35",
  "dist-2x",
  "dist-3x",
  "side-flat",
  "side-same-deep",
  "side-deep",
  "other",
] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

const LINE = "#cfd6dc";
const DIM_TEXT = "#aab3bc";
const ACCENT = "var(--accent)";

function panel(
  x: number,
  label: "A" | "B",
  body: string,
  tint: string,
): string {
  const col = label === "A" ? "var(--a)" : "var(--b)";
  return `<g transform="translate(${String(x)} 0)"><rect x="1" y="1" width="128" height="98" rx="10" fill="${tint}" stroke="#3a434c"/>${body}<rect x="6" y="6" width="20" height="18" rx="4" fill="${col}"/><text x="16" y="19.5" text-anchor="middle" font-size="12" font-weight="800" fill="#111">${label}</text></g>`;
}

const caption = (text: string): string =>
  `<text x="65" y="92" text-anchor="middle" font-size="11" fill="${DIM_TEXT}">${text}</text>`;

/** A light bulb: 0 off, 1 dim, 2 on. */
function bulb(level: 0 | 1 | 2): string {
  const fill = ["#2a2a2a", "#7a6524", "#f2c14e"][level]!;
  const rays = [0, 4, 8][level]!;
  let r = "";
  for (let i = 0; i < rays; i++) {
    const t = (i / rays) * Math.PI * 2;
    const p = (d: number, f: (x: number) => number, c: number): string =>
      (c + f(t) * d).toFixed(1);
    r += `<line x1="${p(16, Math.cos, 65)}" y1="${p(16, Math.sin, 40)}" x2="${p(24, Math.cos, 65)}" y2="${p(24, Math.sin, 40)}" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return `${r}<circle cx="65" cy="40" r="12" fill="${fill}" stroke="#555"/><rect x="60" y="51" width="10" height="7" rx="2" fill="#666"/>`;
}

/** A phone seen from the front, turned by `angle` degrees. */
const phone = (angle: number): string =>
  `<g transform="rotate(${String(angle)} 65 44)"><rect x="51" y="20" width="28" height="48" rx="5" fill="#2a3138" stroke="${LINE}" stroke-width="2"/><circle cx="65" cy="44" r="7" fill="none" stroke="${ACCENT}" stroke-width="2"/><path d="M60 26 L65 21 L70 26" fill="none" stroke="${LINE}" stroke-width="2"/></g>`;

/** Seen from above: the surface (with things in front when deep) and the phone. */
function topView(px: number, py: number, deep: boolean): string {
  const things = deep
    ? `<rect x="28" y="26" width="16" height="10" fill="#4b5560"/><rect x="82" y="36" width="14" height="12" fill="#4b5560"/><rect x="58" y="48" width="12" height="8" fill="#4b5560"/>`
    : "";
  return `<line x1="20" y1="14" x2="110" y2="14" stroke="${LINE}" stroke-width="3"/>${things}<line x1="${String(px)}" y1="${String(py)}" x2="65" y2="14" stroke="${ACCENT}" stroke-dasharray="3 3"/><path d="M${String(px - 6)} ${String(py + 6)} L${String(px)} ${String(py - 6)} L${String(px + 6)} ${String(py + 6)} Z" fill="${ACCENT}"/>`;
}

/** Seen from above: the surface, the field of view and the distance. */
const distView = (py: number, label: string): string =>
  `<line x1="25" y1="14" x2="105" y2="14" stroke="${LINE}" stroke-width="3"/><line x1="65" y1="${String(py)}" x2="25" y2="14" stroke="${ACCENT}" stroke-dasharray="3 3"/><line x1="65" y1="${String(py)}" x2="105" y2="14" stroke="${ACCENT}" stroke-dasharray="3 3"/><path d="M59 ${String(py + 6)} L65 ${String(py - 6)} L71 ${String(py + 6)} Z" fill="${ACCENT}"/><text x="100" y="${String(Math.min(py + 4, 80))}" text-anchor="end" font-size="11" fill="${DIM_TEXT}">${label}</text>`;

const arrow = (text: string): string =>
  `<g transform="translate(130 0)"><path d="M8 50 H32 M26 44 L32 50 L26 56" fill="none" stroke="${DIM_TEXT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="20" y="74" text-anchor="middle" font-size="10" fill="#7b858f">${text}</text></g>`;

interface Parts {
  readonly a: string;
  readonly b: string;
  readonly mid: string;
  readonly tintB?: string;
  readonly label: string;
}

const PANEL = "#14181c";

function parts(kind: DiagramKind): Parts {
  switch (kind) {
    case "light-same":
      return {
        a: bulb(2) + caption("light on"),
        b: bulb(2) + caption("same light"),
        mid: "nothing",
        label: "Photo A and photo B in the same light.",
      };
    case "light-dim":
      return {
        a: bulb(2) + caption("light on"),
        b: bulb(1) + caption("dimmed"),
        mid: "dim",
        tintB: "#0e1013",
        label: "Photo A with the light on, photo B dimmed.",
      };
    case "light-dark":
      return {
        a: bulb(2) + caption("light on"),
        b: bulb(0) + caption("very dim"),
        mid: "dim",
        tintB: "#08090a",
        label: "Photo A with the light on, photo B very dim.",
      };
    case "rot-0":
      return {
        a: phone(0) + caption("upright"),
        b: phone(0) + caption("upright"),
        mid: "nothing",
        label: "Both photos with the phone upright.",
      };
    case "rot-35":
      return {
        a: phone(0) + caption("upright"),
        b: phone(35) + caption("tilted 30-45"),
        mid: "tilt",
        label: "Photo A upright, photo B tilted 30 to 45 degrees.",
      };
    case "dist-2x":
      return {
        a: distView(48, "1.5 m"),
        b: distView(80, "3 m"),
        mid: "step back",
        label: "Photo A from 1.5 m, photo B from 3 m.",
      };
    case "dist-3x":
      return {
        a: distView(36, "1 m"),
        b: distView(80, "3 m"),
        mid: "step back",
        label: "Photo A from 1 m, photo B from 3 m.",
      };
    case "side-flat":
      return {
        a: topView(45, 72, false) + caption("flat"),
        b: topView(95, 72, false) + caption("1 m aside"),
        mid: "step aside",
        label: "Photo B of the flat surface from 1 m to the side.",
      };
    case "side-same-deep":
      return {
        a: topView(65, 76, true) + caption("deep"),
        b: topView(65, 76, true) + caption("same place"),
        mid: "stay",
        label: "Both photos of a deep scene from the same place.",
      };
    case "side-deep":
      return {
        a: topView(45, 72, true) + caption("deep"),
        b: topView(95, 72, true) + caption("1 m aside"),
        mid: "step aside",
        label: "Photo B of the deep scene from 1 m to the side.",
      };
    case "other":
      return {
        a: caption("your scene"),
        b: caption("one change"),
        mid: "then",
        label: "Your own photo A, then one change for photo B.",
      };
  }
}

/** The diagram of `kind`, 300 x 100 user units. */
export function diagramSvg(kind: DiagramKind): string {
  const p = parts(kind);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" role="img" aria-label="${p.label}">${panel(0, "A", p.a, PANEL)}${arrow(p.mid)}${panel(170, "B", p.b, p.tintB ?? PANEL)}</svg>`;
}
