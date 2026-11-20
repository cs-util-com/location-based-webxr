// Travelling surface, round 1, prototype E - the pin opens in place. Throwaway prototype: not
// wired to the app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the foot, no scene, camera, renderer, frame loop or document access,
// text drawn on Canvas 2D textures. The page (pin-opens.js) owns the camera, the taps and the
// HUD; it hands this part what to draw and where the viewer stands.
//
// The part is a short text in its pin view, measured as the app measures it: a tag on a thin
// stem over a ring on the ground, its letters sized by the reading distance. The tag's canvas is
// the travelling surface itself: a tap unfolds the description under the caption on the same
// canvas, and the page flies that one texture to the screen when it cannot be read. While it is
// away, a small dot marks the stem's top, so the pin is never drawn twice.
import {
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, f) => a + (b - a) * f;

/** The app's rule: a short text's caption letter is 0.066 m tall per 2.5 m of reading distance. */
export const LETTER_M_PER_READ_M = 0.066 / 2.5;
/** The app's description letters against the caption's. */
export const DESC_EM_APP = 0.62;
/** The app's reading distance range (m). */
const READ_MIN_M = 1;
const READ_MAX_M = 40;

/**
 * The card canvas, in canvas px. The description is always drawn at `descPx`; the caption at
 * `descPx / descEm`, so the line breaks never change between the world and the screen. One canvas
 * px is `measures().mPerPx` metres in the world.
 */
export const CARD = {
  W: 720,
  descPx: 40,
  descLine: 54,
  descMaxLines: 6,
  capMaxLines: 2,
  padX: 32,
  hintPx: 25,
  hintLine: 44,
};

const FILL = "rgba(17,21,27,0.95)";
const CAPTION_INK = "#f7f4ec";
const DESCRIPTION_INK = "#c3c8cf";
const ACCENT = "#f1d79c"; // the app's accent for a label
const FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A pin's measures for its reading distance and the description size (as in the app's pin). */
export function measures(readAtM, descEm) {
  const read = clamp(Number(readAtM) || 4, READ_MIN_M, READ_MAX_M);
  const em = read * LETTER_M_PER_READ_M;
  const de = clamp(Number(descEm) || DESC_EM_APP, 0.3, 1.5);
  return {
    read,
    em,
    descEm: de,
    descM: em * de,
    mPerPx: (em * de) / CARD.descPx,
    capPx: CARD.descPx / de,
    liftM: 1.7 + 0.1 * read,
    stemR: Math.max(0.011, em * 0.07),
    groundM: Math.max(0.22, em * 2.4),
  };
}

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  let caption = typeof r.caption === "string" ? r.caption.trim() : "";
  if (!caption) {
    caption = "Untitled";
    problems.push("no caption: shown as Untitled");
  }
  const description =
    typeof r.description === "string" ? r.description.trim() : "";
  const readAtM = Number.isFinite(r.readAtM) ? r.readAtM : 4;
  const at = Array.isArray(r.at) && r.at.length === 2 ? r.at.map(Number) : [0, 0];
  if (!at.every(Number.isFinite)) {
    problems.push("bad position: placed at the origin");
    at[0] = 0;
    at[1] = 0;
  }
  return { block: { caption, description, readAtM, at }, problems };
}

/** Every asset id the views may read: none. */
export function assets() {
  return [];
}

/** The editor's field for this choice, as data. */
export function fields() {
  return [
    {
      key: "description.opens",
      label: "When a visitor taps the pin, show the description",
      type: "choice",
      options: [
        ["pin", "Under the pin, while it can be read"],
        ["screen", "On the screen"],
      ],
      help: "Under the pin, the description moves to the screen whenever it is too small, out of view or seen too far from the side, and back when it can be read again. It is the same card in both places.",
    },
  ];
}

function wrap(g, text, maxW, maxLines) {
  const out = [];
  let line = "";
  const list = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const next = line ? `${line} ${list[i]}` : list[i];
    if (g.measureText(next).width <= maxW || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = list[i];
    if (out.length === maxLines) {
      // the last line ends in " ..." as the app's pin does
      let last = out[maxLines - 1];
      while (last && g.measureText(`${last} ...`).width > maxW) {
        last = last.replace(/\s*\S+$/, "");
      }
      out[maxLines - 1] = `${last} ...`;
      return out;
    }
  }
  if (line && out.length < maxLines) {
    out.push(line);
  }
  return out;
}

/**
 * The card: the caption folded, the caption and the description unfolded, on one canvas.
 * paint(view): view = { open (0..1), ring (0..1), hint }. shape(open) is the card's outline in
 * canvas px at that fold, for the page's hit test.
 */
function makeCard(block, m, env) {
  const { W, descPx, descLine, padX, hintPx, hintLine } = CARD;
  const capPx = m.capPx;
  const capFont = `650 ${capPx.toFixed(1)}px ${FONT}`;
  const descFont = `450 ${descPx}px ${FONT}`;
  const probe = new OffscreenCanvas(8, 8).getContext("2d");
  probe.font = capFont;
  const capLines = wrap(
    probe,
    block.caption,
    Math.min(W - 2 * padX, 9.5 * capPx),
    CARD.capMaxLines,
  );
  const capW = Math.max(...capLines.map((l) => probe.measureText(l).width));
  probe.font = descFont;
  const descLines = block.description
    ? wrap(probe, block.description, W - 2 * padX - 8, CARD.descMaxLines)
    : [];
  const capLineH = capPx * 1.16;
  const padY = 0.34 * capPx;
  const headH = 2 * padY + capLines.length * capLineH;
  const foldW = clamp(capW + capPx, 2 * capPx, W - 6);
  const pointerH = 0.42 * capPx;
  const bodyH = descLines.length
    ? 18 + descLines.length * descLine + 14 + hintLine + 10
    : 0;
  const H = Math.ceil(3 + headH + Math.max(bodyH, pointerH) + 3);
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d");
  const texture = env.canvasTexture(canvas);

  function shape(open) {
    const e = ease(clamp(open, 0, 1));
    const w = lerp(foldW, W - 6, e);
    const h = lerp(headH, headH + bodyH, e);
    return { x: (W - w) / 2, y: 3, w, h };
  }

  function paint(view) {
    const open = clamp(view.open, 0, 1);
    const r = shape(open);
    g.clearRect(0, 0, W, H);
    const rad = lerp(Math.min(headH / 2, 0.5 * capPx), 26, ease(open));
    // the pointer under the folded tag, toward the stem; it goes as the card opens
    const pa = clamp(1 - open * 4, 0, 1);
    if (pa > 0) {
      g.beginPath();
      g.moveTo(W / 2 - pointerH * 0.8, r.y + r.h - 2);
      g.lineTo(W / 2 + pointerH * 0.8, r.y + r.h - 2);
      g.lineTo(W / 2, r.y + r.h + pointerH);
      g.closePath();
      g.fillStyle = `rgba(17,21,27,${(0.95 * pa).toFixed(3)})`;
      g.fill();
    }
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, rad);
    g.fillStyle = FILL;
    g.fill();
    g.lineWidth = 3 + 7 * view.ring;
    g.strokeStyle =
      view.ring > 0
        ? `rgba(241,215,156,${(0.35 + 0.65 * view.ring).toFixed(3)})`
        : "rgba(255,255,255,0.22)";
    g.stroke();

    // the caption: centred while folded, moving to the left edge as the card opens
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.font = capFont;
    g.fillStyle = CAPTION_INK;
    g.textBaseline = "alphabetic";
    const capX = r.x + lerp((r.w - capW) / 2, padX, ease(open));
    capLines.forEach((line, i) => {
      g.fillText(line, capX, r.y + padY + (i + 0.82) * capLineH);
    });
    if (open > 0 && descLines.length) {
      const top = r.y + headH;
      g.globalAlpha = clamp((open - 0.25) / 0.75, 0, 1);
      g.fillStyle = ACCENT;
      g.fillRect(r.x + padX, top + 2, 64, 4);
      g.font = descFont;
      g.fillStyle = DESCRIPTION_INK;
      descLines.forEach((line, i) => {
        g.fillText(line, r.x + padX, top + 18 + (i + 0.76) * descLine);
      });
      if (view.hint) {
        g.font = `600 ${hintPx}px ${FONT}`;
        g.fillStyle = "rgba(255,255,255,0.55)";
        g.fillText(
          view.hint,
          r.x + padX,
          top + 18 + descLines.length * descLine + 14 + hintLine * 0.7,
        );
      }
      g.globalAlpha = 1;
    }
    g.restore();
    texture.needsUpdate = true;
  }

  return {
    texture,
    paint,
    shape,
    W,
    H,
    headH,
    foldW,
    canOpen: descLines.length > 0,
    descLines: descLines.length,
    dispose: () => texture.dispose(),
  };
}

/**
 * The world view: { object, plate, dot, card, m, update, setFade, dispose }.
 * - plate: the card's mesh (full canvas, its top fixed, so the description unfolds downward and
 *   the folded tag's pointer touches the stem's top); the page shows or hides it and reads its
 *   matrix to fly it.
 * - dot: the stem's top while the card is on the screen.
 * - update(frame): frame.viewer is the viewer's position in the part's parent frame; frame.turns
 *   turns the tag toward the viewer about the stem (the app's "upright").
 */
export function world(block, env) {
  const m = measures(block.readAtM, env.descEm);
  const object = new Group();
  object.name = "short-text-pin";
  object.position.set(block.at[0], 0, block.at[1]);
  const yaw = new Group();
  object.add(yaw);
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };
  const fadeable = [];
  const mat = (opts, share) => {
    const x = keep(new MeshBasicMaterial({ transparent: true, depthWrite: false, ...opts }));
    fadeable.push([x, share]);
    return x;
  };

  const disc = new Mesh(
    keep(new CircleGeometry(m.groundM, 40)),
    mat({ color: 0x14181e, opacity: 0.5 }, 0.5),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.008;
  const ring = new Mesh(
    keep(new RingGeometry(m.groundM * 0.86, m.groundM, 48)),
    mat({ color: 0xf1d79c, opacity: 0.95, side: DoubleSide }, 0.95),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  object.add(disc, ring);

  const stem = new Mesh(
    keep(new CylinderGeometry(m.stemR, m.stemR, m.liftM, 10)),
    mat({ color: 0x20262e, opacity: 0.92 }, 0.92),
  );
  stem.position.y = m.liftM / 2;
  yaw.add(stem);

  const card = makeCard(block, m, env);
  const plateMat = keep(
    new MeshBasicMaterial({
      map: card.texture,
      transparent: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const plate = new Mesh(
    keep(new PlaneGeometry(card.W * m.mPerPx, card.H * m.mPerPx)),
    plateMat,
  );
  plate.name = "pin-card";
  // the folded tag's pointer tip (canvas y = 3 + headH + pointer) sits on the stem's top
  const tipPx = 3 + card.headH + 0.42 * m.capPx;
  plate.position.set(0, m.liftM + (tipPx - card.H / 2) * m.mPerPx, m.stemR + 0.01);
  plate.renderOrder = 2;
  yaw.add(plate);

  const dot = new Mesh(
    keep(new CircleGeometry(Math.max(0.05, m.em * 0.45), 24)),
    mat({ color: 0xf1d79c, opacity: 0.9, fog: false }, 0.9),
  );
  dot.name = "pin-dot";
  dot.position.set(0, m.liftM + Math.max(0.05, m.em * 0.45), m.stemR + 0.01);
  dot.visible = false;
  yaw.add(dot);

  return {
    object,
    plate,
    dot,
    card,
    m,
    tipPx,
    update(frame) {
      if (env.mode === "edit" || !frame || !frame.viewer) {
        return;
      }
      const dx = frame.viewer.x - object.position.x;
      const dz = frame.viewer.z - object.position.z;
      yaw.rotation.y = frame.turns ? Math.atan2(dx, dz) : 0;
    },
    /** The station fade (0..1) for every part but the card, whose opacity the page sets. */
    setFade(f) {
      for (const [x, share] of fadeable) {
        x.opacity = share * f;
      }
      object.visible = f > 0;
    },
    dispose() {
      object.removeFromParent();
      card.dispose();
      for (const x of made) {
        x.dispose();
      }
    },
  };
}
