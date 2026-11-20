// Travelling surface, round 1, variant A - the bubble travels. Throwaway prototype: not wired to
// the app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the station's centre, no scene, camera, renderer, frame loop or document
// access, every picture drawn on Canvas 2D textures. The page (bubble-travels.js) owns the voice's
// clock, the camera and the HUD; it hands this part what to draw and where the viewer stands.
//
// The part is one or two characters standing in a station: synthetic die-cut figures (drawn
// here, no photo of a person) that turn to the viewer, a name tag over each head, and ONE speech
// surface. The surface's canvas is the bubble in the world and, shown by the page at the bottom
// of the screen, the docked box: one object in two places, never two copies.
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A figure: 1.95 m tall with his hat, a 256 x 640 die-cut canvas. The face is a circle centred at
 * FIG.faceY of the height, FIG.faceR of the height in radius (the page keeps the bubble off it).
 * The bubble's tail tip hangs beside the head, at FIG.tipY of the height and FIG.tipSide of the
 * height to the side (the app hangs it 0.16 to the side).
 */
export const FIG = {
  heightM: 1.95,
  canvasW: 256,
  canvasH: 640,
  headY: 150,
  headR: 38,
  tipSide: 0.1,
};
FIG.faceY = 1 - FIG.headY / FIG.canvasH;
FIG.faceR = FIG.headR / FIG.canvasH;
FIG.tipY = FIG.faceY + 0.05;
FIG.widthM = (FIG.heightM * FIG.canvasW) / FIG.canvasH;

/**
 * The speech surface, in canvas px. One canvas px is SURF.metresPerPx in the world at the near
 * size, so the letters are as tall as the app's bubble letters (64 px of a 1024 px metre). The
 * line measure is 17 em, shared by the bubble and the docked box, so the lines break at the same
 * words in both places. Under the words: the choice buttons (a story step), then the tail strip.
 */
export const SURF = {
  fontPx: 40,
  linePx: 55,
  rows: 3,
  measureEm: 17,
  padL: 30,
  padR: 36,
  padT: 16,
  whoPx: 50,
  padB: 18,
  choiceGap: 16,
  btnH: 110,
  btnGap: 14,
  maxChoices: 2,
  tailH: 56,
  tailBase: [64, 128],
  tailTip: 26,
  radius: 30,
  grey: 0.5,
};
SURF.canvasW = SURF.measureEm * SURF.fontPx;
SURF.baseH =
  SURF.padT + SURF.whoPx + SURF.rows * SURF.linePx + SURF.padB;
SURF.choicesH = (n) =>
  n > 0 ? SURF.choiceGap + n * SURF.btnH + (n - 1) * SURF.btnGap : 0;
SURF.canvasH = SURF.baseH + SURF.choicesH(SURF.maxChoices) + SURF.tailH;
SURF.metresPerPx = 0.0625 / SURF.fontPx;

/** The body's height (no tail) with the choices `cAmt` (0 to 1) of the way open. */
export function bodyH(cAmt, n) {
  return Math.round(SURF.baseH + clamp(cAmt, 0, 1) * SURF.choicesH(n));
}

/** The name tag over a head, in canvas px. */
const TAG = { canvasW: 640, canvasH: 104 };

const FONT_UI =
  '"Corbel", "Noto Sans", ui-rounded, "Segoe UI", "Roboto", system-ui, sans-serif';
const HEX = /^#[0-9a-f]{6}$/i;
const STEP_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  let name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) {
    name = "Someone";
    problems.push("no name: shown as Someone");
  }
  const color = typeof r.color === "string" && HEX.test(r.color) ? r.color : "#f2b84b";
  if (color !== r.color) {
    problems.push("no colour: gold");
  }
  const hat = r.hat === "cap" ? "cap" : "tall";
  const at = Array.isArray(r.at) && r.at.length === 2 && r.at.every(Number.isFinite) ? r.at : [0, 0];
  const steps = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (!s || typeof s !== "object" || !STEP_ID.test(s.id) || typeof s.line !== "string" || !s.line.trim()) {
      problems.push("a step without an id or a line was left out");
      continue;
    }
    const choices = (Array.isArray(s.choices) ? s.choices : [])
      .filter((c) => c && typeof c.label === "string" && c.label.trim() && typeof c.next === "string")
      .slice(0, SURF.maxChoices)
      .map((c) => ({ label: c.label.trim(), next: c.next }));
    steps.push({ id: s.id, line: s.line.trim(), choices });
  }
  if (!steps.length) {
    steps.push({ id: "start", line: "...", choices: [] });
    problems.push("no line");
  }
  // a choice that names no step is dropped, so a tap can never lead nowhere
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    const kept = s.choices.filter((c) => ids.has(c.next));
    if (kept.length !== s.choices.length) {
      problems.push(`step ${s.id}: a choice leading nowhere was left out`);
    }
    s.choices = kept;
  }
  const n = r.narration && typeof r.narration === "object" ? r.narration : null;
  return {
    block: {
      name,
      color,
      hat,
      at,
      steps,
      pitch: Number.isFinite(r.pitch) ? clamp(r.pitch, 90, 330) : 170,
      voice: n && typeof n.audio === "string" && n.audio ? "ok" : "missing",
      synthetic: !n || n.synthetic !== false,
    },
    problems,
  };
}

/** Every asset id the views may read: none, the figures are drawn and the voice is a tone. */
export function assets() {
  return [];
}

/** The editor's field for the one choice this round adds, as data. */
export function fields() {
  return [
    {
      key: "words",
      label: "While he speaks, show the words",
      type: "choice",
      options: [
        ["speaker", "In his bubble, while it can be read"],
        ["box", "In the box at the bottom"],
      ],
      help: "In his bubble, the words move into the box whenever the bubble is too small to read, its buttons too small to tap, out of view, or he is farther than the open distance; they come back when it can be read again.",
    },
  ];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}

/** A synthetic die-cut figure: a stand-in, not a person. `open` paints the mouth open. */
function paintFigure(g, spec, open) {
  const { canvasW: W, canvasH: H, headY, headR } = FIG;
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  const tall = spec.hat === "tall";
  const shapes = (fill) => {
    const f = (c) => (fill ? c : "#fff");
    g.fillStyle = f("#2d3340");
    roundRect(g, cx - 40, 370, 34, 248, 14);
    g.fill();
    roundRect(g, cx + 6, 370, 34, 248, 14);
    g.fill();
    g.fillStyle = f("#1b1e25");
    roundRect(g, cx - 52, 606, 48, 26, 10);
    g.fill();
    roundRect(g, cx + 4, 606, 48, 26, 10);
    g.fill();
    g.fillStyle = f(tall ? "#e9e3d6" : "#3c5a78");
    g.beginPath();
    g.moveTo(cx - 56, 200);
    g.lineTo(cx + 56, 200);
    g.lineTo(cx + 72, 410);
    g.lineTo(cx - 72, 410);
    g.closePath();
    g.fill();
    roundRect(g, cx - 86, 206, 30, 150, 14);
    g.fill();
    roundRect(g, cx + 56, 206, 30, 150, 14);
    g.fill();
    g.fillStyle = f("#d9a47e");
    g.beginPath();
    g.arc(cx - 71, 360, 16, 0, Math.PI * 2);
    g.arc(cx + 71, 360, 16, 0, Math.PI * 2);
    g.fill();
    // the speaker's colour: an apron or a scarf
    g.fillStyle = f(spec.color);
    if (tall) {
      roundRect(g, cx - 42, 250, 84, 150, 12);
    } else {
      roundRect(g, cx - 48, 190, 96, 34, 15);
    }
    g.fill();
    g.fillStyle = f("#d9a47e");
    roundRect(g, cx - 14, headY + headR - 8, 28, 30, 8);
    g.fill();
    g.beginPath();
    g.arc(cx, headY, headR, 0, Math.PI * 2);
    g.fill();
    if (tall) {
      g.fillStyle = f("#fbfaf6");
      roundRect(g, cx - 38, headY - headR - 44, 76, 56, 16);
      g.fill();
      g.beginPath();
      g.arc(cx - 22, headY - headR - 46, 24, 0, Math.PI * 2);
      g.arc(cx + 2, headY - headR - 58, 27, 0, Math.PI * 2);
      g.arc(cx + 25, headY - headR - 44, 22, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = f("#26384d");
      roundRect(g, cx - 42, headY - headR - 8, 84, 32, 13);
      g.fill();
      roundRect(g, cx - 4, headY - headR + 14, 68, 12, 6);
      g.fill();
    }
  };
  // the die-cut edge: the same shapes in white, stroked wide, under the coloured ones
  g.save();
  g.lineJoin = "round";
  g.strokeStyle = "#fff";
  g.lineWidth = 16;
  const fill = g.fill.bind(g);
  g.fill = () => {
    fill();
    g.stroke();
  };
  shapes(false);
  g.fill = fill;
  g.restore();
  shapes(true);
  // the face: two eyes and a mouth, closed or open
  g.fillStyle = "#2b2118";
  g.beginPath();
  g.arc(cx - 13, headY - 4, 4.5, 0, Math.PI * 2);
  g.arc(cx + 13, headY - 4, 4.5, 0, Math.PI * 2);
  g.fill();
  if (open) {
    g.beginPath();
    g.ellipse(cx, headY + 17, 9, 7, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.lineWidth = 3.5;
    g.strokeStyle = "#2b2118";
    g.beginPath();
    g.arc(cx, headY + 9, 10, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  }
}

/** The name tag: the speaker's dot and name in their colour, then a short state. */
function paintTag(g, spec, state) {
  const { canvasW: W, canvasH: H } = TAG;
  g.clearRect(0, 0, W, H);
  g.font = `700 30px ${FONT_UI}`;
  g.letterSpacing = "3px";
  const nameW = g.measureText(spec.name.toUpperCase()).width;
  g.letterSpacing = "0px";
  g.font = `600 24px ${FONT_UI}`;
  const stW = state ? g.measureText(state).width + 22 : 0;
  const w = Math.min(W - 8, 64 + nameW + stW + 26);
  const x = (W - w) / 2;
  roundRect(g, x, 8, w, H - 16, (H - 16) / 2);
  g.fillStyle = "rgb(20 24 36 / 0.86)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = withAlpha(spec.color, 0.7);
  g.stroke();
  g.beginPath();
  g.arc(x + 36, H / 2, 11, 0, Math.PI * 2);
  g.fillStyle = spec.color;
  g.fill();
  g.textBaseline = "middle";
  g.font = `700 30px ${FONT_UI}`;
  g.letterSpacing = "3px";
  g.fillStyle = spec.color;
  g.fillText(spec.name.toUpperCase(), x + 58, H / 2 + 1, W - 80);
  g.letterSpacing = "0px";
  if (state) {
    g.font = `600 24px ${FONT_UI}`;
    g.fillStyle = "rgb(255 255 255 / 0.78)";
    g.fillText(state, x + 58 + nameW + 18, H / 2 + 1);
  }
}

/**
 * The speech surface: the bubble in the world and the docked box, one canvas. Exposed so the page
 * knows the lines (scrolling and scrubbing) and can map a touch to the badge and the buttons.
 */
function makeSurface(env) {
  const { canvasW: W, canvasH: H, fontPx, linePx, rows, padL, padR, padT, whoPx } = SURF;
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d");
  const texture = env.canvasTexture(canvas);
  const font = `500 ${fontPx}px ${FONT_UI}`;
  let words = [];
  let nLines = 1;
  let speaker = { name: "", color: "#ffffff" };
  let labels = [];
  const badge = { x: 0, y: 0, w: 0, h: 0 };
  /** The choice buttons' rectangles in canvas px, while they show. */
  const buttons = [];
  const winTop = padT + whoPx;

  /** Binds the speaker, the line's words (with times) and the step's choice labels. */
  function setText(list, who, choiceLabels) {
    speaker = who;
    labels = choiceLabels.slice(0, SURF.maxChoices);
    g.font = font;
    const space = g.measureText(" ").width;
    const maxW = W - padL - padR;
    let x = 0;
    let line = 0;
    words = list.map((w) => {
      const ww = g.measureText(w.text).width;
      if (x > 0 && x + ww > maxW) {
        line++;
        x = 0;
      }
      const placed = { ...w, x, line };
      x += ww + space;
      return placed;
    });
    nLines = words.length ? words[words.length - 1].line + 1 : 1;
    return { lineOf: words.map((w) => w.line), nLines };
  }

  /**
   * The body (a rounded rectangle `bh` tall) and, when `tail` > 0, the tail under it, drawn as one
   * path so the outline runs round both. tail 1 is the full tail, its tip at canvas x `tipX` (the
   * head); as tail goes to 0 the tip moves up into the middle of its base: it shrinks into the edge.
   */
  function outline(bh, tail, side, tipX) {
    const r = SURF.radius;
    const x0 = 3;
    const x1 = W - 3;
    const y0 = 3;
    const y1 = bh - 3;
    const [d0, d1] = SURF.tailBase.map((d) => d - SURF.tailTip);
    const lo = x0 + r + 2;
    const hi = x1 - r - 2;
    const b0 = clamp(side === "left" ? tipX - d1 : tipX + d0, lo, hi - (d1 - d0));
    const b1 = b0 + (d1 - d0);
    const mid = (b0 + b1) / 2;
    const tx = mid + (tipX - mid) * tail;
    const ty = y1 + (SURF.tailH - 4) * tail;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.lineTo(x1 - r, y0);
    g.arcTo(x1, y0, x1, y0 + r, r);
    g.lineTo(x1, y1 - r);
    g.arcTo(x1, y1, x1 - r, y1, r);
    if (tail > 0.02) {
      // the bottom edge runs right to left
      g.lineTo(b1, y1);
      g.lineTo(tx, ty);
      g.lineTo(b0, y1);
    }
    g.lineTo(x0 + r, y1);
    g.arcTo(x0, y1, x0, y1 - r, r);
    g.lineTo(x0, y0 + r);
    g.arcTo(x0, y0, x0 + r, y0, r);
    g.closePath();
  }

  /**
   * view: { t, s, hint, credit, scrubbing, cAmt, nChoices, tail, side, tipX, pressed }. t is the voice's
   * time in seconds (-1 before it started); s the scroll in lines; a word fades from grey to white
   * over 0.55 s, starting 0.12 s after it is said. cAmt opens the choices (0 to 1).
   */
  function paint(view) {
    const bh = bodyH(view.cAmt, view.nChoices);
    g.clearRect(0, 0, W, H);
    outline(bh, view.tail, view.side, view.tipX);
    const bg = g.createLinearGradient(0, 0, W * 0.6, bh);
    bg.addColorStop(0, "rgb(52 58 80 / 0.9)");
    bg.addColorStop(1, "rgb(20 24 36 / 0.9)");
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = withAlpha(speaker.color, 0.6);
    g.stroke();

    // who speaks: the speaker's dot, the name in their colour, the AI voice badge, then the hint
    const cy = padT + whoPx / 2 - 2;
    g.beginPath();
    g.arc(padL + 12, cy, 12, 0, Math.PI * 2);
    g.fillStyle = speaker.color;
    g.fill();
    g.textBaseline = "middle";
    g.font = `700 32px ${FONT_UI}`;
    g.letterSpacing = "2px";
    g.fillStyle = speaker.color;
    const nm = speaker.name.toUpperCase();
    g.fillText(nm, padL + 34, cy + 1);
    let x = padL + 34 + g.measureText(nm).width + 14;
    g.letterSpacing = "0px";
    g.font = `700 22px ${FONT_UI}`;
    const label = view.credit ? "AI voice: generated for this demo" : "AI voice";
    const bw = g.measureText(label).width + 22;
    roundRect(g, x, cy - 16, bw, 32, 16);
    g.lineWidth = 2.5;
    g.strokeStyle = "rgb(255 255 255 / 0.5)";
    g.stroke();
    g.fillStyle = "rgb(255 255 255 / 0.85)";
    g.fillText(label, x + 11, cy + 1);
    Object.assign(badge, { x: x - 8, y: cy - 26, w: bw + 16, h: 52 });
    x += bw + 14;
    if (view.hint && !view.credit) {
      g.font = `600 24px ${FONT_UI}`;
      g.textAlign = "right";
      g.fillStyle = "rgb(255 255 255 / 0.7)";
      g.fillText(view.hint, W - padR + 8, cy + 1, Math.max(40, W - padR + 8 - x));
      g.textAlign = "left";
    }

    // the words: three rows, the column moves, the window clips
    g.save();
    g.beginPath();
    g.rect(0, winTop, W, rows * linePx);
    g.clip();
    g.font = font;
    g.textBaseline = "alphabetic";
    const first = Math.max(0, Math.floor(view.s) - 1);
    const last = Math.ceil(view.s) + rows;
    for (const w of words) {
      if (w.line < first || w.line > last) {
        continue;
      }
      const lit = view.scrubbing
        ? clamp((view.t - w.start) / 0.12, 0, 1)
        : clamp((view.t - w.start - 0.12) / 0.55, 0, 1);
      const a = SURF.grey + (1 - SURF.grey) * lit;
      g.fillStyle = `rgb(255 255 255 / ${a.toFixed(3)})`;
      g.fillText(w.text, padL + w.x, winTop + (w.line - view.s) * linePx + linePx * 0.74);
    }
    g.restore();

    if (nLines > rows) {
      const trackH = rows * linePx - 8;
      const thumbH = Math.max(24, (trackH * rows) / nLines);
      const pos = clamp(view.s / (nLines - rows), 0, 1) * (trackH - thumbH);
      g.fillStyle = "rgb(255 255 255 / 0.12)";
      roundRect(g, W - 22, winTop + 4, 7, trackH, 4);
      g.fill();
      g.fillStyle = view.scrubbing ? "rgb(255 255 255 / 0.92)" : "rgb(255 255 255 / 0.5)";
      roundRect(g, W - 22, winTop + 4 + pos, 7, thumbH, 4);
      g.fill();
    }

    // the choices, inside the same surface: tap targets, so the page gates on their size too
    buttons.length = 0;
    if (view.cAmt > 0.01 && labels.length) {
      g.save();
      g.beginPath();
      g.rect(0, 0, W, bh - 6);
      g.clip();
      g.globalAlpha = clamp(view.cAmt * 1.4 - 0.4, 0, 1);
      let y = SURF.baseH - SURF.padB + SURF.choiceGap;
      labels.forEach((text, i) => {
        const r = { x: padL - 6, y, w: W - padL - padR + 18, h: SURF.btnH };
        buttons.push(r);
        roundRect(g, r.x, r.y, r.w, r.h, 22);
        g.fillStyle =
          view.pressed === i ? withAlpha(speaker.color, 0.42) : "rgb(255 255 255 / 0.1)";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = withAlpha(speaker.color, 0.8);
        g.stroke();
        g.fillStyle = "#fff";
        g.font = `700 36px ${FONT_UI}`;
        g.textBaseline = "middle";
        g.fillText(text, r.x + 30, r.y + r.h / 2 + 1, r.w - 90);
        g.font = `700 44px ${FONT_UI}`;
        g.fillStyle = withAlpha(speaker.color, 0.95);
        g.textAlign = "right";
        g.fillText("›", r.x + r.w - 26, r.y + r.h / 2 - 2);
        g.textAlign = "left";
        y += SURF.btnH + SURF.btnGap;
      });
      g.restore();
    }
    texture.needsUpdate = true;
  }

  return { texture, setText, paint, badge, buttons, dispose: () => texture.dispose() };
}

/**
 * The world view: { object, figures, plate, surface, tipPoint, update, dispose }.
 * - figures[i]: { root, body, tag, setTalk(open), setTag(state) } per character.
 * - plate: the surface's mesh in the world (a unit plane the update scales); the page shows or
 *   hides it and reads its matrix to fly it.
 * - surface: { texture, setText, paint, badge, buttons } of the shared canvas.
 * - tipPoint(i, side, out): where the tail's tip hangs beside figure i's head.
 * - update(frame): frame.viewer (the camera position), frame.camQuat (its orientation),
 *   frame.grow (the bubble keeps its size on screen past 2.4 m, as in the app), frame.holder (the
 *   figure the surface belongs to, -1 none), frame.side ("left" | "right"), frame.tipX (the
 *   canvas x of the tail's tip: the page slides the bubble along it to keep it on the screen),
 *   frame.visH (the surface's shown height in canvas px), frame.tagAlpha[i].
 */
export function world(block, env) {
  const object = new Group();
  object.name = "travelling-bubble";
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };

  const ring = new Mesh(
    keep(new RingGeometry(1.6, 1.75, 48)),
    keep(new MeshBasicMaterial({ color: 0xf2971f, transparent: true, opacity: 0.6, side: DoubleSide })),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  object.add(ring);

  const figGeo = keep(new PlaneGeometry(FIG.widthM, FIG.heightM));
  figGeo.translate(0, FIG.heightM / 2, 0);
  const tagGeo = keep(new PlaneGeometry(1, 1));
  const figures = block.figures.map((spec) => {
    const root = new Group();
    root.position.set(spec.at[0], 0, spec.at[1]);
    object.add(root);
    const frames = [false, true].map((open) => {
      const c = new OffscreenCanvas(FIG.canvasW, FIG.canvasH);
      paintFigure(c.getContext("2d"), spec, open);
      return keep(env.canvasTexture(c));
    });
    const bodyMat = keep(
      new MeshBasicMaterial({ map: frames[0], transparent: true, alphaTest: 0.4, side: DoubleSide }),
    );
    const body = new Mesh(figGeo, bodyMat);
    body.name = `figure-${spec.id}`;
    root.add(body);
    const shadow = new Mesh(
      keep(new RingGeometry(0, 0.42, 24)),
      keep(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    root.add(shadow);

    const tc = new OffscreenCanvas(TAG.canvasW, TAG.canvasH);
    const tg = tc.getContext("2d");
    const tagTex = keep(env.canvasTexture(tc));
    const tag = new Mesh(
      tagGeo,
      keep(
        new MeshBasicMaterial({
          map: tagTex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      ),
    );
    tag.name = `tag-${spec.id}`;
    tag.renderOrder = 19;
    object.add(tag);
    let tagState = null;
    let talking = false;
    return {
      spec,
      root,
      body,
      tag,
      setTalk(open) {
        if (open !== talking) {
          talking = open;
          bodyMat.map = frames[open ? 1 : 0];
        }
      },
      /** Repaints the tag only when its state changes; returns true when it did. */
      setTag(state) {
        if (state === tagState) {
          return false;
        }
        tagState = state;
        paintTag(tg, spec, state);
        tagTex.needsUpdate = true;
        return true;
      },
    };
  });

  const surface = makeSurface(env);
  const plateMat = keep(
    new MeshBasicMaterial({
      map: surface.texture,
      transparent: true,
      fog: false,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const plate = new Mesh(keep(new PlaneGeometry(1, 1)), plateMat);
  plate.name = "speech-surface";
  plate.renderOrder = 20;
  object.add(plate);

  const right = new Vector3();
  const up = new Vector3();
  const tmp = new Vector3();

  /** The camera's right along the ground, and its up, from the frame's orientation. */
  function axes(frame) {
    right.set(1, 0, 0).applyQuaternion(frame.camQuat);
    right.y = 0;
    if (right.lengthSq() < 1e-6) {
      right.set(1, 0, 0);
    }
    right.normalize();
    up.set(0, 1, 0).applyQuaternion(frame.camQuat);
  }

  const growAt = (frame, p) =>
    frame.grow ? Math.max(1, Math.hypot(frame.viewer.x - p.x, frame.viewer.y - p.y, frame.viewer.z - p.z) / 2.4) : 1;

  function tipPoint(i, side, out) {
    const f = figures[i];
    out.copy(f.root.position);
    out.y += FIG.tipY * FIG.heightM;
    out.addScaledVector(right, (side === "left" ? -1 : 1) * FIG.tipSide * FIG.heightM);
    return out;
  }

  return {
    object,
    figures,
    plate,
    surface,
    tipPoint,
    /** The point a finger taps on figure i: his chest. */
    chestPoint(i, out) {
      return out.copy(figures[i].root.position).setY(FIG.heightM * 0.62);
    },
    update(frame) {
      if (env.mode === "edit" || !frame || !frame.viewer) {
        return;
      }
      axes(frame);
      figures.forEach((f, i) => {
        const dx = frame.viewer.x - f.root.position.x;
        const dz = frame.viewer.z - f.root.position.z;
        f.root.rotation.y = Math.atan2(dx, dz);
        const a = frame.tagAlpha ? frame.tagAlpha[i] : 1;
        f.tag.visible = a > 0.01;
        f.tag.material.opacity = a;
        tmp.copy(f.root.position);
        tmp.y = FIG.heightM + 0.16;
        const m = SURF.metresPerPx * growAt(frame, tmp) * 0.7;
        f.tag.quaternion.copy(frame.camQuat);
        f.tag.scale.set(TAG.canvasW * m, TAG.canvasH * m, 1);
        f.tag.position.copy(tmp).addScaledVector(up, (TAG.canvasH / 2) * m);
      });
      if (frame.holder < 0) {
        return;
      }
      tipPoint(frame.holder, frame.side, tmp);
      const m = SURF.metresPerPx * growAt(frame, tmp);
      const tipX = frame.tipX;
      plate.quaternion.copy(frame.camQuat);
      plate.scale.set(SURF.canvasW * m, frame.visH * m, 1);
      plate.position
        .copy(tmp)
        .addScaledVector(right, (SURF.canvasW / 2 - tipX) * m)
        .addScaledVector(up, (frame.visH / 2) * m);
      const crop = frame.visH / SURF.canvasH;
      surface.texture.repeat.set(1, crop);
      surface.texture.offset.set(0, 1 - crop);
    },
    dispose() {
      object.removeFromParent();
      surface.dispose();
      for (const x of made) {
        x.dispose();
      }
    },
  };
}
