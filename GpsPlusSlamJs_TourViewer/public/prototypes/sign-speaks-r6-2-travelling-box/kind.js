// The sign speaks, round 6, variant 2 - one box that travels. Throwaway prototype: not wired to
// the app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the foot, no scene, camera, renderer, frame loop or document access,
// words drawn on Canvas 2D textures. The page (travelling-box.js) owns the voice's clock, the
// camera and the HUD; it hands this part what to draw and where the viewer stands.
//
// The part is a reading sign (as in the app) with a words plate hanging under it. The plate's
// canvas is the narration box itself: the page shows the same texture at the bottom edge of the
// screen when the plate cannot be read, so the box is one object in two places, never two copies.
import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The reading sign, as in the app: a 2.5 m plate, its centre 2.05 m up, a 1024 x 420 face. */
export const SIGN = { widthM: 2.5, centreM: 2.05, canvasW: 1024, canvasH: 420 };
SIGN.heightM = (SIGN.widthM * SIGN.canvasH) / SIGN.canvasW;

/**
 * The words plate, which is also the narration box. Canvas pixels; one canvas pixel is
 * WORDS.metresPerPx in the world, so the letters are 0.136 m tall on the plate (the size the
 * earlier sign prototype measured its legible distances with). The line measure is fixed at
 * 17 em, so the plate and the docked box break the lines at the same words.
 */
export const WORDS = {
  fontPx: 40,
  linePx: 55,
  rows: 3,
  measureEm: 17,
  padL: 30,
  padR: 36,
  padT: 16,
  whoPx: 50,
  padB: 18,
  grey: 0.55,
  tint: 0.8,
};
WORDS.canvasW = WORDS.measureEm * WORDS.fontPx;
WORDS.canvasH =
  WORDS.padT + WORDS.whoPx + WORDS.rows * WORDS.linePx + WORDS.padB;
WORDS.metresPerPx = 0.136 / WORDS.fontPx;
WORDS.widthM = WORDS.canvasW * WORDS.metresPerPx;
WORDS.heightM = WORDS.canvasH * WORDS.metresPerPx;
/** Gap between the sign's lower edge and the plate's upper edge. */
const PLATE_GAP_M = 0.07;
WORDS.centreM =
  SIGN.centreM - SIGN.heightM / 2 - PLATE_GAP_M - WORDS.heightM / 2;

const FONT_UI =
  '"Corbel", "Noto Sans", ui-rounded, "Segoe UI", "Roboto", system-ui, sans-serif';
const FONT_TITLE = 'Georgia, "Noto Serif", "Times New Roman", serif';
const SPEAKER = { name: "Narrator", color: "#f9a8d4" };
const STATE_WORDS = {
  idle: "Has a voice",
  playing: "Speaking",
  paused: "Paused",
  ended: "Heard to the end",
  missing: "No voice",
};

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  let title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) {
    title = "Untitled";
    problems.push("no title: shown as Untitled");
  }
  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!body) {
    problems.push("no text");
  }
  const n = r.narration && typeof r.narration === "object" ? r.narration : null;
  const words = n && n.words === "sign" ? "sign" : "screen";
  const voice = n && typeof n.audio === "string" && n.audio ? "ok" : "missing";
  if (n && voice === "missing") {
    problems.push("voice file missing: the text is read, not heard");
  }
  return {
    block: {
      title,
      body,
      narration: n ? { words, voice, synthetic: n.synthetic !== false } : null,
    },
    problems,
  };
}

/** Every asset id the views may read: none, the voice here is a generated tone. */
export function assets() {
  return [];
}

/** The editor's field for this choice, as data. */
export function fields() {
  return [
    {
      key: "narration.words",
      label: "While the voice plays, show the words",
      type: "choice",
      options: [
        ["screen", "On screen, in the box"],
        ["sign", "On the sign, while it can be read"],
      ],
      help: "On the sign, the words move into the box whenever the sign is too far, out of view or too far to the side, and back when it can be read again.",
    },
  ];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Words on a line, up to maxW; the rest is dropped (the app draws at most two title lines). */
function wrap(g, text, maxW, maxLines) {
  const out = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      out.push(line);
      line = w;
      if (out.length === maxLines) {
        return out;
      }
    }
  }
  if (line && out.length < maxLines) {
    out.push(line);
  }
  return out;
}

function minutesFor(body) {
  const n = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(n / 200));
}

/** The sign's face: the over-line, the title, the hint, and one chip that says whether it speaks. */
function paintSign(g, block, state) {
  const { canvasW: W, canvasH: H } = SIGN;
  g.clearRect(0, 0, W, H);
  roundRect(g, 4, 4, W - 8, H - 8, 34);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "rgb(52 58 80 / 0.94)");
  bg.addColorStop(1, "rgb(20 24 36 / 0.94)");
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = "rgb(255 255 255 / 0.3)";
  g.stroke();

  g.fillStyle = "#f2971f";
  g.font = `700 30px ${FONT_UI}`;
  g.textBaseline = "alphabetic";
  g.letterSpacing = "4px";
  g.fillText(`READ  ·  ${minutesFor(block.body)} MIN`, 60, 92);
  g.letterSpacing = "0px";

  g.fillStyle = "#fff";
  g.font = `600 64px ${FONT_TITLE}`;
  wrap(g, block.title, 900, 2).forEach((line, i) =>
    g.fillText(line, 60, 178 + i * 76),
  );

  g.font = `500 30px ${FONT_UI}`;
  g.fillStyle = "rgb(255 255 255 / 0.72)";
  g.fillText("Tap to open the text", 60, 372);

  if (block.narration) {
    const words = STATE_WORDS[state] || STATE_WORDS.idle;
    g.font = `700 30px ${FONT_UI}`;
    const tw = g.measureText(words).width;
    const cw = tw + 82;
    const x = W - 60 - cw;
    roundRect(g, x, 326, cw, 64, 32);
    g.fillStyle =
      state === "playing"
        ? "rgb(249 168 212 / 0.22)"
        : "rgb(255 255 255 / 0.08)";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle =
      state === "missing" ? "rgb(255 255 255 / 0.3)" : SPEAKER.color;
    g.stroke();
    g.beginPath();
    g.arc(x + 34, 358, 10, 0, Math.PI * 2);
    g.fillStyle =
      state === "missing" ? "rgb(255 255 255 / 0.4)" : SPEAKER.color;
    g.fill();
    g.fillStyle = "#fff";
    g.fillText(words, x + 56, 369);
  }
}

/**
 * The words plate's text layout and drawing. Exposed so the page knows the lines (for scrolling
 * and scrubbing) and can map a touch to the badge.
 */
function makeWords(env) {
  const {
    canvasW: W,
    canvasH: H,
    fontPx,
    linePx,
    rows,
    padL,
    padR,
    padT,
    whoPx,
  } = WORDS;
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d");
  const texture = env.canvasTexture(canvas);
  const font = `500 ${fontPx}px ${FONT_UI}`;
  let words = []; // { text, start, end, x, line }
  let nLines = 1;
  const badge = { x: 0, y: 0, w: 0, h: 0 };
  const winTop = padT + whoPx;

  function setText(list) {
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
   * view: { t, s, hint, credit, scrubbing }. t is the voice's time in seconds; s the scroll in
   * lines; a word fades from grey to white over 0.55 s, starting 0.12 s after it is said.
   */
  function paint(view) {
    g.clearRect(0, 0, W, H);
    roundRect(g, 3, 3, W - 6, H - 6, 30);
    const bg = g.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, `rgb(52 58 80 / ${WORDS.tint})`);
    bg.addColorStop(1, `rgb(20 24 36 / ${WORDS.tint})`);
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "rgb(255 255 255 / 0.26)";
    g.stroke();

    // the speaker line: the speaker's dot, the name in bold, the AI voice badge, then the state
    const cy = padT + whoPx / 2 - 2;
    g.beginPath();
    g.arc(padL + 12, cy, 12, 0, Math.PI * 2);
    g.fillStyle = SPEAKER.color;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#fff";
    g.stroke();
    g.textBaseline = "middle";
    g.font = `700 34px ${FONT_UI}`;
    g.fillStyle = "#fff";
    g.fillText(SPEAKER.name, padL + 36, cy + 1);
    let x = padL + 36 + g.measureText(SPEAKER.name).width + 14;
    g.font = `700 24px ${FONT_UI}`;
    const label = view.credit
      ? "AI voice: generated for this demo"
      : "AI voice";
    const bw = g.measureText(label).width + 24;
    roundRect(g, x, cy - 17, bw, 34, 17);
    g.lineWidth = 2.5;
    g.strokeStyle = "rgb(255 255 255 / 0.55)";
    g.stroke();
    g.fillStyle = "rgb(255 255 255 / 0.85)";
    g.fillText(label, x + 12, cy + 1);
    Object.assign(badge, { x: x - 8, y: cy - 26, w: bw + 16, h: 52 });
    x += bw + 16;
    if (view.hint && !view.credit) {
      g.font = `600 26px ${FONT_UI}`;
      g.textAlign = "right";
      g.fillStyle = "rgb(255 255 255 / 0.7)";
      g.fillText(
        view.hint,
        W - padR + 8,
        cy + 1,
        Math.max(40, W - padR + 8 - x),
      );
      g.textAlign = "left";
    }

    // the words: at most three rows, the column moves, the window clips
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
      const a = WORDS.grey + (1 - WORDS.grey) * lit;
      g.fillStyle = `rgb(255 255 255 / ${a.toFixed(3)})`;
      g.fillText(
        w.text,
        padL + w.x,
        winTop + (w.line - view.s) * linePx + linePx * 0.74,
      );
    }
    g.restore();

    // the thin scrollbar on the right
    if (nLines > rows) {
      const trackH = rows * linePx - 8;
      const thumbH = Math.max(24, (trackH * rows) / nLines);
      const pos = clamp(view.s / (nLines - rows), 0, 1) * (trackH - thumbH);
      g.fillStyle = "rgb(255 255 255 / 0.12)";
      roundRect(g, W - 22, winTop + 4, 7, trackH, 4);
      g.fill();
      g.fillStyle = view.scrubbing
        ? "rgb(255 255 255 / 0.92)"
        : "rgb(255 255 255 / 0.5)";
      roundRect(g, W - 22, winTop + 4 + pos, 7, thumbH, 4);
      g.fill();
    }
    texture.needsUpdate = true;
  }

  return { texture, setText, paint, badge, dispose: () => texture.dispose() };
}

/**
 * The world view: { object, tapTarget, tap, plate, words, setState, update, dispose }.
 * - plate: the words plate mesh; the page shows or hides it and reads its matrix to fly it.
 * - words: { texture, setText, paint, badge } of the shared canvas.
 * - setState(state): idle | playing | paused | ended | missing, said on the sign.
 * - update(frame): frame.viewer is the viewer's position in the part's parent frame;
 *   frame.growth scales the far sign up (distance / 4.5 m, 1 to 1.6); frame.turns turns the sign
 *   and its plate to the viewer about the upright axis.
 */
export function world(block, env) {
  const object = new Group();
  object.name = "sign-speaks";
  const yaw = new Group();
  object.add(yaw);
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };

  const ring = new Mesh(
    keep(new RingGeometry(1.05, 1.2, 48)),
    keep(
      new MeshBasicMaterial({
        color: 0xf2971f,
        transparent: true,
        opacity: 0.75,
        side: DoubleSide,
      }),
    ),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  object.add(ring);

  const signBottom = SIGN.centreM - SIGN.heightM / 2;
  const stem = new Mesh(
    keep(new CylinderGeometry(0.045, 0.05, signBottom, 10)),
    keep(new MeshBasicMaterial({ color: 0x2a2f3a })),
  );
  stem.position.y = signBottom / 2;
  yaw.add(stem);

  const signCanvas = new OffscreenCanvas(SIGN.canvasW, SIGN.canvasH);
  const sg = signCanvas.getContext("2d");
  const signTex = keep(env.canvasTexture(signCanvas));
  let signState = "";
  const sign = new Mesh(
    keep(new PlaneGeometry(SIGN.widthM, SIGN.heightM)),
    keep(
      new MeshBasicMaterial({
        map: signTex,
        transparent: true,
        fog: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    ),
  );
  sign.name = "sign-plate";
  sign.position.set(0, SIGN.centreM, 0.06);
  yaw.add(sign);

  const words = makeWords(env);
  const plateMat = keep(
    new MeshBasicMaterial({
      map: words.texture,
      transparent: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  const plate = new Mesh(
    keep(new PlaneGeometry(WORDS.widthM, WORDS.heightM)),
    plateMat,
  );
  plate.name = "words-plate";
  plate.position.set(0, WORDS.centreM, 0.1);
  plate.renderOrder = 2;
  yaw.add(plate);

  function setState(state) {
    if (state !== signState) {
      signState = state;
      paintSign(sg, block, state);
      signTex.needsUpdate = true;
    }
  }
  setState(
    block.narration
      ? block.narration.voice === "missing"
        ? "missing"
        : "idle"
      : "idle",
  );

  return {
    object,
    tapTarget: sign,
    plate,
    yaw,
    words,
    setState,
    update(frame) {
      if (env.mode === "edit" || !frame || !frame.viewer) {
        return;
      }
      const dx = frame.viewer.x - object.position.x;
      const dz = frame.viewer.z - object.position.z;
      const d = Math.hypot(dx, dz);
      object.scale.setScalar(frame.growth ? clamp(d / 4.5, 1, 1.6) : 1);
      yaw.rotation.y = frame.turns ? Math.atan2(dx, dz) : 0;
    },
    dispose() {
      object.removeFromParent();
      words.dispose();
      for (const x of made) {
        x.dispose();
      }
    },
  };
}
