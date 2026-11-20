/**
 * The sign speaks, 6.1 - plate first, box as fallback. The world half of the
 * prototype, written to the item prototype rule: a reading sign with "Read"
 * and "Listen" halves, and a caption plate hanging under it that carries the
 * spoken words in the narration box's look (at most three lines, unread grey,
 * read white, the speaker's name inline in their colour, an "AI voice"
 * badge, a thin scrollbar on the right).
 *
 * - `read(record)` gives `{ block, problems }`.
 * - `assets(block)` lists the files the world may read (none: the voice is
 *   synthetic on this page).
 * - `world(block, env)` gives `{ object, tapTarget, update, dispose }` plus
 *   this kind's own `sign` and `caption` parts; in metres, Y up, origin at
 *   the foot. It never touches the scene, the camera, the renderer, the
 *   frame loop or `document`: its canvases are `OffscreenCanvas`, its
 *   textures come from `env.canvasTexture`.
 * - `fields(view)` lists the editor's fields as data.
 *
 * Imports: three only, by named import, no addons.
 */
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";

/** The sign plate and the caption plate share one width (m). */
export const SIGN_W_M = 2.4;
const SIGN_PX_W = 1024;
const SIGN_PX_H = 420;
const SIGN_H_M = (SIGN_W_M * SIGN_PX_H) / SIGN_PX_W;
const SIGN_CENTRE_Y_M = 2.36;

/** The caption plate's canvas (px) and its type, in canvas pixels. */
const CAP_PX_W = 1024;
const CAP_PX_H = 284;
export const CAP_FONT_PX = 54;
export const CAP_LINE_PX = 72;
export const CAP_ROWS = 3;
const CAP_PAD_X = 40;
const CAP_PAD_TOP = 34;
const CAP_BAR_W = 26; // room for the scrollbar on the right
const CAP_TEXT_W = CAP_PX_W - 2 * CAP_PAD_X - CAP_BAR_W;
const CAP_H_M = (SIGN_W_M * CAP_PX_H) / CAP_PX_W;
const CAP_GAP_M = 0.05;
const CAP_CENTRE_Y_M = SIGN_CENTRE_Y_M - SIGN_H_M / 2 - CAP_GAP_M - CAP_H_M / 2;

/** One canvas pixel in metres, on both plates. */
const M_PER_PX = SIGN_W_M / CAP_PX_W;
/** The caption's letter size and line height in the world (m), before growth. */
export const CAP_FONT_M = CAP_FONT_PX * M_PER_PX;
export const CAP_LINE_M = CAP_LINE_PX * M_PER_PX;

const FONT =
  '"Corbel", "Noto Sans", "Segoe UI", "Roboto", system-ui, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
const AMBER = "#f2971f";
const BADGE_TEXT = "AI VOICE";

/** Sign growth with distance: scale = distance / 4.5 m, between 1 and 1.6. */
export const GROWTH_PER_M = 1 / 4.5;
export const GROWTH_MAX = 1.6;

const TITLE_MAX = 80;
const BODY_MAX = 6000;

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  const title = readTitle(r.title, problems);
  let body = typeof r.body === "string" ? r.body.trim() : "";
  if (body.length > BODY_MAX) {
    body = body.slice(0, BODY_MAX);
    problems.push(`text cut to ${BODY_MAX} characters`);
  }
  const narration = readNarration(r.narration, problems);
  return { block: { title, body, narration }, problems };
}

function readTitle(raw, problems) {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title) {
    problems.push("no title: shown as Untitled");
    return "Untitled";
  }
  if (title.length > TITLE_MAX) {
    problems.push(`title cut to ${TITLE_MAX} characters`);
    return `${title.slice(0, TITLE_MAX - 1)}…`;
  }
  return title;
}

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function readNarration(n, problems) {
  if (!n || typeof n !== "object") {
    return null;
  }
  const voice = text(n.audio, 400);
  if (!voice) {
    problems.push("the voice file is missing");
  }
  return {
    audio: voice || null,
    synthetic: n.synthetic === true,
    voiceCredit: text(n.voiceCredit, 200),
    speaker: text(n.speaker, 40) || "Narrator",
    color: /^#[0-9a-f]{6}$/i.test(n.color ?? "") ? n.color : "#f9a8d4",
  };
}

/** Every asset id `world` may read: the synthetic voice needs none. */
export function assets() {
  return [];
}

/** The editor's fields for a view, as data. */
export function fields() {
  return [
    { key: "title", label: "Title", type: "text", max: TITLE_MAX },
    { key: "body", label: "Text", type: "text", max: BODY_MAX },
    {
      key: "words",
      label: "Spoken words",
      type: "choice",
      options: [
        {
          value: "sign",
          label: "On the sign (the box when the sign cannot be read)",
        },
        { value: "box", label: "In the box at the bottom" },
      ],
    },
  ];
}

// ---------- caption layout: where each word goes on the plate ----------

let measureCtx = null;
function ctx2d() {
  if (!measureCtx) {
    measureCtx = new OffscreenCanvas(8, 8).getContext("2d");
  }
  return measureCtx;
}
const fontFor = (kind) => {
  if (kind === "name") {
    return `700 ${CAP_FONT_PX}px ${FONT}`;
  }
  if (kind === "badge") {
    return `700 26px ${FONT}`;
  }
  return `500 ${CAP_FONT_PX}px ${FONT}`;
};
function tokenWidth(g, tok) {
  g.font = fontFor(tok.kind);
  const w = g.measureText(tok.kind === "badge" ? BADGE_TEXT : tok.text).width;
  return tok.kind === "badge" ? w + 28 : w;
}

/**
 * Wraps the name, the badge and the words into the plate's lines.
 * `tokens` are `{ kind: "name" | "badge" | "word", text }`.
 * Gives `{ lines: [[{ i, x, w }]], lineOfToken }`.
 */
export function captionLayout(tokens) {
  const g = ctx2d();
  g.font = fontFor("word");
  const space = g.measureText(" ").width;
  const lines = [[]];
  const lineOfToken = [];
  let x = 0;
  tokens.forEach((tok, i) => {
    const w = tokenWidth(g, tok);
    if (x > 0 && x + w > CAP_TEXT_W) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1].push({ i, x, w });
    lineOfToken[i] = lines.length - 1;
    x += w + space;
  });
  return { lines, lineOfToken };
}

// ---------- painting ----------

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function paintPlateGround(g, w, h) {
  const grad = g.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, "#343a50");
  grad.addColorStop(1, "#141824");
  g.clearRect(0, 0, w, h);
  roundRect(g, 2, 2, w - 4, h - 4, 26);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = "rgba(255,255,255,0.32)";
  g.stroke();
}

function drawBadge(g, x, baseline) {
  const h = 38;
  const y = baseline - CAP_FONT_PX * 0.72 + (CAP_FONT_PX * 0.72 - h) / 2;
  g.font = fontFor("badge");
  const w = g.measureText(BADGE_TEXT).width + 28;
  roundRect(g, x, y, w, h, 10);
  g.fillStyle = "rgba(255,255,255,0.14)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.stroke();
  g.fillStyle = "#e9edf3";
  g.fillText(BADGE_TEXT, x + 14, y + 27);
  return { x, y, w, h };
}

function drawToken(g, tok, x, baseline, view) {
  if (tok.kind === "badge") {
    return drawBadge(g, x, baseline);
  }
  g.font = fontFor(tok.kind);
  if (tok.kind === "name") {
    g.fillStyle = view.speakerColor;
  } else {
    g.fillStyle = tok.on ? "#ffffff" : `rgba(255,255,255,${view.grey})`;
  }
  g.fillText(tok.text, x, baseline);
  return null;
}

function drawScrollbar(g, view) {
  if (view.nLines <= CAP_ROWS) {
    return;
  }
  const x = CAP_PX_W - CAP_PAD_X + 6;
  const top = CAP_PAD_TOP;
  const winH = CAP_ROWS * CAP_LINE_PX;
  g.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(g, x, top, 7, winH, 4);
  g.fill();
  const thumbH = Math.max(28, (winH * CAP_ROWS) / view.nLines);
  const maxS = Math.max(1, view.nLines - CAP_ROWS);
  const pos = Math.min(1, Math.max(0, view.scroll / maxS)) * (winH - thumbH);
  g.fillStyle = view.dragging
    ? "rgba(255,255,255,0.92)"
    : "rgba(255,255,255,0.55)";
  roundRect(g, x, top + pos, 7, thumbH, 4);
  g.fill();
}

/**
 * Paints the caption plate. `view`:
 * - `tokens` - `{ kind, text, on }`, `layout` - from `captionLayout`;
 * - `scroll` - the first visible line (float), `nLines`;
 * - `speakerColor`, `grey` (unread white share), `dragging`;
 * - or `notice` - one short message in place of the words.
 * Gives the badge's rectangle in canvas pixels (for a tap on it), or null.
 */
function paintCaption(canvas, view) {
  const g = canvas.getContext("2d");
  paintPlateGround(g, CAP_PX_W, CAP_PX_H);
  if (view.notice) {
    g.fillStyle = "#ffffff";
    g.font = `500 44px ${FONT}`;
    view.notice
      .split("\n")
      .forEach((line, k) =>
        g.fillText(line, CAP_PAD_X, CAP_PAD_TOP + 56 + k * 62),
      );
    return null;
  }
  g.save();
  g.beginPath();
  g.rect(0, CAP_PAD_TOP - 4, CAP_PX_W, CAP_ROWS * CAP_LINE_PX + 8);
  g.clip();
  let badge = null;
  const first = Math.max(0, Math.floor(view.scroll) - 1);
  const last = Math.min(
    view.layout.lines.length - 1,
    Math.ceil(view.scroll) + CAP_ROWS,
  );
  for (let k = first; k <= last; k++) {
    const baseline =
      CAP_PAD_TOP + (k - view.scroll) * CAP_LINE_PX + CAP_FONT_PX * 0.98;
    for (const item of view.layout.lines[k]) {
      badge =
        drawToken(g, view.tokens[item.i], CAP_PAD_X + item.x, baseline, view) ??
        badge;
    }
  }
  g.restore();
  drawScrollbar(g, view);
  return badge;
}

/**
 * Paints the sign: the over-line, the title and the two halves.
 * `face`: `{ title, minutes, listen: { label, sub, state } }`, where `state`
 * is "idle" | "speaking" | "paused" | "ended" | "far" | "missing".
 */
function paintSign(canvas, face) {
  const g = canvas.getContext("2d");
  const W = SIGN_PX_W;
  const H = SIGN_PX_H;
  paintPlateGround(g, W, H);
  g.fillStyle = AMBER;
  g.fillRect(W - 14, 30, 6, H - 60);
  g.fillStyle = "rgba(255,255,255,0.72)";
  g.font = `700 30px ${FONT}`;
  g.fillText(`READ OR LISTEN  ·  ${face.minutes} MIN`, 48, 66);
  g.fillStyle = "#ffffff";
  g.font = `600 64px ${SERIF}`;
  g.fillText(fitText(g, face.title, W - 120), 48, 150);
  const y = 214;
  const h = H - y - 30;
  paintHalf(
    g,
    { x: 30, y, w: W / 2 - 40, h },
    "Read",
    "the whole text",
    false,
    "read",
  );
  paintHalf(
    g,
    { x: W / 2 + 10, y, w: W / 2 - 40, h },
    face.listen.label,
    face.listen.sub,
    true,
    face.listen.state,
  );
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) {
    return text;
  }
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t.trimEnd()}…`;
}

function paintHalf(g, r, label, sub, amber, state) {
  roundRect(g, r.x, r.y, r.w, r.h, 22);
  const muted = state === "missing" || state === "far";
  g.fillStyle = amber && !muted ? AMBER : "rgba(255,255,255,0.1)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle =
    amber && !muted ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.35)";
  g.stroke();
  const ink = amber && !muted ? "#000000" : "#ffffff";
  paintGlyph(g, state, r.x + 62, r.y + r.h / 2, ink);
  g.fillStyle = ink;
  g.font = `700 50px ${FONT}`;
  g.fillText(label, r.x + 116, r.y + r.h / 2 + 4);
  g.globalAlpha = 0.78;
  g.font = `500 30px ${FONT}`;
  g.fillText(sub, r.x + 116, r.y + r.h / 2 + 44);
  g.globalAlpha = 1;
}

/** The half's glyph: a book, a speaker, pause bars or a play triangle. */
function paintGlyph(g, state, cx, cy, ink) {
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 5;
  g.lineCap = "round";
  if (state === "read") {
    roundRect(g, cx - 30, cy - 22, 27, 44, 4);
    g.stroke();
    roundRect(g, cx + 3, cy - 22, 27, 44, 4);
    g.stroke();
    return;
  }
  if (state === "speaking") {
    g.fillRect(cx - 18, cy - 22, 12, 44);
    g.fillRect(cx + 6, cy - 22, 12, 44);
    return;
  }
  if (state === "paused" || state === "ended") {
    g.beginPath();
    g.moveTo(cx - 14, cy - 24);
    g.lineTo(cx + 22, cy);
    g.lineTo(cx - 14, cy + 24);
    g.closePath();
    g.fill();
    return;
  }
  paintSpeaker(g, cx, cy, state === "missing");
}

function paintSpeaker(g, cx, cy, crossed) {
  g.beginPath();
  g.moveTo(cx - 28, cy - 10);
  g.lineTo(cx - 16, cy - 10);
  g.lineTo(cx, cy - 24);
  g.lineTo(cx, cy + 24);
  g.lineTo(cx - 16, cy + 10);
  g.lineTo(cx - 28, cy + 10);
  g.closePath();
  g.fill();
  g.beginPath();
  if (crossed) {
    g.moveTo(cx + 10, cy - 14);
    g.lineTo(cx + 34, cy + 14);
    g.moveTo(cx + 34, cy - 14);
    g.lineTo(cx + 10, cy + 14);
  } else {
    g.arc(cx + 4, cy, 16, -0.9, 0.9);
    g.moveTo(cx + 14, cy - 24);
    g.arc(cx + 4, cy, 28, -0.9, 0.9);
  }
  g.stroke();
}

// ---------- the world view ----------

/**
 * The reading sign with its caption plate. `env.canvasTexture(canvas)` makes
 * a texture; `env.mode` is "play" or "edit".
 * Returns, besides the contract's halves:
 * - `sign.mesh`, `sign.paint(face)`, `sign.half(uv)` ("read" | "listen" | "title");
 * - `caption.mesh`, `caption.paint(view)`, `caption.onBadge(uv)`,
 *   `caption.show(on)`;
 * - `scale()` - the current growth factor.
 */
export function world(block, env) {
  const object = new Group();
  const turner = new Group();
  object.add(turner);

  const stemMat = new MeshLambertMaterial({ color: 0x3b4250 });
  const stem = new Mesh(
    new CylinderGeometry(0.045, 0.05, SIGN_CENTRE_Y_M, 10),
    stemMat,
  );
  // behind the plates: the stem is 0.05 m thick, so -0.04 put its front through them
  stem.position.set(0, SIGN_CENTRE_Y_M / 2, -0.08);
  turner.add(stem);

  const ringMat = new MeshBasicMaterial({
    color: 0xf2971f,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const ring = new Mesh(new RingGeometry(0.62, 0.72, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  object.add(ring);

  const signCanvas = new OffscreenCanvas(SIGN_PX_W, SIGN_PX_H);
  const signTex = env.canvasTexture(signCanvas);
  const signMat = new MeshBasicMaterial({ map: signTex, transparent: true });
  const signMesh = new Mesh(new PlaneGeometry(SIGN_W_M, SIGN_H_M), signMat);
  signMesh.position.y = SIGN_CENTRE_Y_M;
  signMesh.name = "reading-sign-plate";
  turner.add(signMesh);

  const capCanvas = new OffscreenCanvas(CAP_PX_W, CAP_PX_H);
  const capTex = env.canvasTexture(capCanvas);
  const capMat = new MeshBasicMaterial({ map: capTex, transparent: true });
  const capMesh = new Mesh(new PlaneGeometry(SIGN_W_M, CAP_H_M), capMat);
  capMesh.position.y = CAP_CENTRE_Y_M;
  capMesh.name = "caption-plate";
  capMesh.visible = false;
  turner.add(capMesh);

  let badgeRect = null;
  let growth = 1;

  return {
    object,
    tapTarget: signMesh,
    sign: {
      mesh: signMesh,
      paint(face) {
        paintSign(signCanvas, face);
        signTex.needsUpdate = true;
      },
      half(uv) {
        const yPx = (1 - uv.y) * SIGN_PX_H;
        if (yPx < 214) {
          return "title";
        }
        return uv.x < 0.5 ? "read" : "listen";
      },
    },
    caption: {
      mesh: capMesh,
      paint(view) {
        badgeRect = paintCaption(capCanvas, view);
        capTex.needsUpdate = true;
      },
      onBadge(uv) {
        if (!badgeRect) {
          return false;
        }
        const x = uv.x * CAP_PX_W;
        const y = (1 - uv.y) * CAP_PX_H;
        const pad = 14;
        return (
          x > badgeRect.x - pad &&
          x < badgeRect.x + badgeRect.w + pad &&
          y > badgeRect.y - pad &&
          y < badgeRect.y + badgeRect.h + pad
        );
      },
      show(on) {
        capMesh.visible = on;
      },
    },
    scale: () => growth,
    /**
     * `frame.viewer` - the viewer's position in the object's parent frame;
     * `frame.turn` - whether the plates turn to the viewer;
     * `frame.grow` - whether the sign grows with distance.
     */
    update(frame) {
      const dx = frame.viewer.x - object.position.x;
      const dz = frame.viewer.z - object.position.z;
      const turn = env.mode !== "edit" && frame.turn;
      turner.rotation.y = turn ? Math.atan2(dx, dz) - object.rotation.y : 0;
      const d = Math.hypot(dx, dz);
      growth = frame.grow
        ? Math.min(GROWTH_MAX, Math.max(1, d * GROWTH_PER_M))
        : 1;
      object.scale.setScalar(growth);
    },
    dispose() {
      for (const m of [stem, ring, signMesh, capMesh]) {
        m.geometry.dispose();
        m.material.dispose();
      }
      signTex.dispose();
      capTex.dispose();
    },
  };
}
