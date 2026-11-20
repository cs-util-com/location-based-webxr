// Travelling surface, round 1, prototype C - the model note. Throwaway prototype: not wired to the
// app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the foot, no scene, camera, renderer, frame loop or document access,
// words drawn on Canvas 2D textures. The page (model-note.js) owns the camera, the place decision,
// the flight and the HUD; it hands this part where the viewer stands.
//
// The part is a placed 3D model (a generic stone fountain built from primitives) with notes on
// it: a small disc at each note's point. The open note's card is ONE canvas: in the world it hangs
// beside its point (the plate), on the screen the page draws the same texture in the dock. Its
// button row sits under the text panel, so the world plate can show the card without its buttons
// (the page crops the plate) and the buttons grow out of it on the way to the dock.
import {
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The note card, in canvas pixels. The text measure (17 or 14 em) is the same on the plate and in
 * the box, so both break the lines at the same words; the narrower card gets one more row.
 * cropPx is where the text panel ends: the world plate may show only the canvas above it (no
 * buttons); the box always shows the whole canvas. setMeasure changes it; a part made before
 * keeps the old size, so the page makes a new one.
 */
export const CARD = {
  fontPx: 40,
  linePx: 52,
  padL: 30,
  padR: 30,
  padT: 14,
  headPx: 62,
  btnGap: 8,
  btnPx: 96,
  padB: 8,
};
export const MEASURES = [14, 17];
export function setMeasure(em) {
  const m = MEASURES.includes(em) ? em : 17;
  CARD.measureEm = m;
  CARD.rows = m >= 17 ? 4 : 5;
  CARD.canvasW = m * CARD.fontPx;
  CARD.cropPx = CARD.padT + CARD.headPx + CARD.rows * CARD.linePx + 18;
  CARD.btnTop = CARD.cropPx + CARD.btnGap;
  CARD.canvasH = CARD.btnTop + CARD.btnPx + CARD.padB;
  // the three buttons: Previous and Next at the sides, Back to its place in the middle
  const side = Math.round(CARD.canvasW * 0.27);
  const gap = 10;
  CARD.buttons = [
    { id: "prev", label: "‹ Previous", x: 0, w: side },
    {
      id: "back",
      label: "Back to its place",
      x: side + gap,
      w: CARD.canvasW - 2 * (side + gap),
    },
    { id: "next", label: "Next ›", x: CARD.canvasW - side, w: side },
  ];
}
setMeasure(17);

/**
 * How a note's marker shows with the viewer `facing` it (the cosine between the note's normal and
 * the direction to the viewer) and whether the model hides it: the app's rule for note markers
 * (a smooth fade from facing -0.2 to 0.3, dimmed to 0.45 behind the model).
 */
export function noteOpacity(facing, occluded) {
  return smooth(-0.2, 0.3, facing) * (occluded ? 0.45 : 1);
}

const MAX_TITLE = 40;
const vec3 = (a) =>
  Array.isArray(a) &&
  a.length === 3 &&
  a.every((x) => typeof x === "number" && Number.isFinite(x))
    ? new Vector3(a[0], a[1], a[2])
    : null;

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  let title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) {
    title = "Untitled model";
    problems.push("no title: shown as Untitled model");
  }
  const notes = [];
  (Array.isArray(r.notes) ? r.notes : []).forEach((n, i) => {
    const at = vec3(n && n.at);
    const normal = vec3(n && n.normal);
    if (!at) {
      problems.push(`note ${i + 1}: no point, left out`);
      return;
    }
    let t = typeof n.title === "string" ? n.title.trim() : "";
    if (!t) {
      t = `Note ${i + 1}`;
      problems.push(`note ${i + 1}: no title`);
    }
    if (t.length > MAX_TITLE) {
      t = `${t.slice(0, MAX_TITLE - 1)}…`;
      problems.push(`note ${i + 1}: title shortened`);
    }
    const text = typeof n.text === "string" ? n.text.trim() : "";
    if (!normal || normal.lengthSq() < 1e-6) {
      problems.push(`note ${i + 1}: no direction, faces the front`);
    }
    notes.push({
      title: t,
      text,
      at,
      normal: normal && normal.lengthSq() > 1e-6 ? normal.normalize() : new Vector3(0, 0, 1),
      side: ["left", "right"].includes(n.side) ? n.side : "right",
    });
  });
  if (!notes.length) {
    problems.push("no notes");
  }
  return { block: { title, notes }, problems };
}

/** Every asset id the views may read: none, the model is built from primitives here. */
export function assets() {
  return [];
}

/** The editor's field for where a note's card shows, as data. */
export function fields() {
  return [
    {
      key: "notes.card",
      label: "An open note's card shows",
      type: "choice",
      options: [
        ["world", "Beside its point, while it can be read there"],
        ["screen", "On screen, in the box"],
      ],
      help: "Beside its point, the card moves into the box whenever the point is out of view, faces away, is hidden behind the model, or the card is too small to read, and back when it can be read again.",
    },
  ];
}

const FONT_UI =
  '"Corbel", "Noto Sans", ui-rounded, "Segoe UI", "Roboto", system-ui, sans-serif';
const FONT_TITLE = 'Georgia, "Noto Serif", "Times New Roman", serif';
const NOTE_COLOR = "#7dd3fc";

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Words on lines up to maxW; past maxLines the last line ends in an ellipsis. */
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
      let last = out[maxLines - 1];
      while (last && g.measureText(`${last}…`).width > maxW) {
        last = last.replace(/\s*\S+$/, "");
      }
      out[maxLines - 1] = `${last}…`;
      return { lines: out, cut: true };
    }
  }
  if (line) {
    out.push(line);
  }
  return { lines: out, cut: false };
}

/**
 * The card: one canvas texture. view: { note, index, count, tag, pressed, buttons }. tag replaces
 * the counter at the top right (where the point is when it cannot be seen, or a hint); pressed
 * names a button to draw lit for a moment; buttons false leaves the button row empty.
 */
function makeCard(env) {
  const { canvasW: W, canvasH: H, padL, padR, padT, headPx, fontPx, linePx } =
    CARD;
  const rows = CARD.rows;
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d");
  const texture = env.canvasTexture(canvas);
  let cut = false;

  function paint(view) {
    g.clearRect(0, 0, W, H);
    // the text panel
    roundRect(g, 3, 3, W - 6, CARD.cropPx - 6, 28);
    const bg = g.createLinearGradient(0, 0, W * 0.6, CARD.cropPx);
    bg.addColorStop(0, "rgb(44 52 74 / 0.9)");
    bg.addColorStop(1, "rgb(18 22 34 / 0.92)");
    g.fillStyle = bg;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "rgb(255 255 255 / 0.28)";
    g.stroke();
    // the note's colour edge on the left, so the card reads as the note's own
    g.fillStyle = NOTE_COLOR;
    roundRect(g, 3, 22, 7, CARD.cropPx - 50, 4);
    g.fill();

    const cy = padT + headPx / 2;
    g.textBaseline = "middle";
    g.font = `600 26px ${FONT_UI}`;
    const right = view.tag || `${view.index + 1} of ${view.count}`;
    const rw = g.measureText(right).width;
    g.textAlign = "right";
    g.fillStyle = view.tag ? NOTE_COLOR : "rgb(255 255 255 / 0.6)";
    g.fillText(right, W - padR, cy + 2);
    g.textAlign = "left";
    g.beginPath();
    g.arc(padL + 10, cy, 10, 0, Math.PI * 2);
    g.fillStyle = NOTE_COLOR;
    g.fill();
    g.fillStyle = "#fff";
    g.font = `600 38px ${FONT_TITLE}`;
    g.fillText(view.note.title, padL + 32, cy + 2, W - padL - 32 - padR - rw - 18);

    g.font = `500 ${fontPx}px ${FONT_UI}`;
    g.textBaseline = "alphabetic";
    g.fillStyle = "rgb(255 255 255 / 0.95)";
    const wrapped = wrap(g, view.note.text, W - padL - padR - 8, rows);
    cut = wrapped.cut;
    wrapped.lines.forEach((line, i) =>
      g.fillText(line, padL + 8, padT + headPx + i * linePx + linePx * 0.74),
    );

    if (view.buttons) {
      g.textBaseline = "middle";
      g.textAlign = "center";
      g.font = `600 ${CARD.measureEm >= 17 ? 30 : 27}px ${FONT_UI}`;
      for (const b of CARD.buttons) {
        const lit = view.pressed === b.id;
        roundRect(g, b.x + 3, CARD.btnTop + 3, b.w - 6, CARD.btnPx - 6, 30);
        g.fillStyle = lit ? "rgb(125 211 252 / 0.55)" : "rgb(30 36 52 / 0.9)";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = lit ? NOTE_COLOR : "rgb(255 255 255 / 0.3)";
        g.stroke();
        g.fillStyle = "#fff";
        g.fillText(b.label, b.x + b.w / 2, CARD.btnTop + CARD.btnPx / 2 + 1);
      }
      g.textAlign = "left";
    }
    texture.needsUpdate = true;
  }

  /** Which button a point in canvas px is on, or null. */
  function buttonAt(cx, cy) {
    if (cy < CARD.btnTop || cy > CARD.btnTop + CARD.btnPx) {
      return null;
    }
    const b = CARD.buttons.find((x) => cx >= x.x && cx <= x.x + x.w);
    return b ? b.id : null;
  }

  return {
    texture,
    paint,
    buttonAt,
    get cut() {
      return cut;
    },
    dispose: () => texture.dispose(),
  };
}

/** A marker face: a ring and a dot; "open" fills it, "waiting" adds a second ring. */
function markerFace(env, state) {
  const c = new OffscreenCanvas(96, 96);
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fillStyle = state === "idle" ? "rgb(20 24 36 / 0.6)" : NOTE_COLOR;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "#fff";
  g.stroke();
  g.beginPath();
  g.arc(48, 48, 12, 0, Math.PI * 2);
  g.fillStyle = state === "idle" ? NOTE_COLOR : "#fff";
  g.fill();
  if (state === "waiting") {
    g.beginPath();
    g.arc(48, 48, 26, 0, Math.PI * 2);
    g.lineWidth = 5;
    g.strokeStyle = "rgb(20 24 36 / 0.85)";
    g.stroke();
  }
  return env.canvasTexture(c);
}

/**
 * The world view: { object, solids, notes, plate, card, setPlateSize, setMarker, update, dispose }.
 * - solids: the model's meshes, for the page's occlusion test.
 * - notes: [{ title, text, at, normal, side, marker }]; at and normal in the part's frame.
 * - plate: the card plate mesh, its origin at the card's top centre; the page places it.
 * - setPlateSize(metresPerPx, frac): the plate's size for one canvas px, showing the top frac of
 *   the canvas (CARD.cropPx / canvasH without buttons, 1 with them).
 * - setMarker(i, opacity, state, radiusM): state idle | open | waiting.
 * - update(frame): frame.cameraQuaternion turns the markers to the viewer.
 */
export function world(block, env) {
  const object = new Group();
  object.name = "model-note";
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };
  const stone = keep(new MeshLambertMaterial({ color: 0xcfc6b6 }));
  const stoneDark = keep(new MeshLambertMaterial({ color: 0xa79d8c }));
  const solids = [];
  const add = (geo, mat, x, y, z) => {
    const m = new Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    object.add(m);
    solids.push(m);
    return m;
  };
  // the step, the eight-sided basin with a flat face to the front, the water, the column, the
  // lion's head, the upper bowl, the pinecone
  add(new CylinderGeometry(2.15, 2.25, 0.2, 8, 1, false, Math.PI / 8), stoneDark, 0, 0.1, 0);
  add(new CylinderGeometry(1.9, 1.9, 0.65, 8, 1, false, Math.PI / 8), stone, 0, 0.525, 0);
  const water = new Mesh(
    keep(new CircleGeometry(1.7, 24)),
    keep(new MeshBasicMaterial({ color: 0x6aa7c4 })),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.86;
  object.add(water);
  add(new CylinderGeometry(0.28, 0.36, 1.9, 14), stone, 0, 1.8, 0);
  const head = add(new SphereGeometry(0.16, 14, 10), stoneDark, 0.13, 1.46, 0.26);
  head.scale.set(1, 0.95, 1.1);
  add(new CylinderGeometry(0.95, 0.34, 0.32, 16), stone, 0, 2.24, 0);
  add(new CylinderGeometry(0.12, 0.16, 0.5, 10), stone, 0, 2.65, 0);
  const cone = add(new SphereGeometry(0.2, 14, 10), stoneDark, 0, 3.1, 0);
  cone.scale.set(1, 1.6, 1);

  // the note markers: one small disc each, turned to the viewer by the page's frame
  const faces = {
    idle: keep(markerFace(env, "idle")),
    open: keep(markerFace(env, "open")),
    waiting: keep(markerFace(env, "waiting")),
  };
  const discGeo = keep(new CircleGeometry(1, 24));
  const notes = block.notes.map((n) => {
    const mat = keep(
      new MeshBasicMaterial({
        map: faces.idle,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    const marker = new Mesh(discGeo, mat);
    marker.position.copy(n.at);
    marker.renderOrder = 3;
    object.add(marker);
    return { ...n, marker, state: "idle" };
  });

  const card = makeCard(env);
  const plateGeo = keep(new BufferGeometry());
  plateGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(12), 3));
  plateGeo.setAttribute("uv", new Float32BufferAttribute(new Float32Array(8), 2));
  plateGeo.setIndex([0, 2, 1, 2, 3, 1]);
  const plate = new Mesh(
    plateGeo,
    keep(
      new MeshBasicMaterial({
        map: card.texture,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    ),
  );
  plate.name = "note-card-plate";
  plate.renderOrder = 4;
  plate.visible = false;
  object.add(plate);

  function setPlateSize(metresPerPx, frac) {
    const w = CARD.canvasW * metresPerPx;
    const h = CARD.canvasH * frac * metresPerPx;
    const p = plateGeo.attributes.position;
    p.setXYZ(0, -w / 2, 0, 0);
    p.setXYZ(1, w / 2, 0, 0);
    p.setXYZ(2, -w / 2, -h, 0);
    p.setXYZ(3, w / 2, -h, 0);
    p.needsUpdate = true;
    const uv = plateGeo.attributes.uv;
    uv.setXY(0, 0, 1);
    uv.setXY(1, 1, 1);
    uv.setXY(2, 0, 1 - frac);
    uv.setXY(3, 1, 1 - frac);
    uv.needsUpdate = true;
    plateGeo.computeBoundingSphere();
    plateGeo.computeBoundingBox();
  }

  function setMarker(i, opacity, state, radiusM) {
    const n = notes[i];
    n.marker.material.opacity = opacity;
    n.marker.visible = opacity > 0.01;
    n.marker.scale.setScalar(radiusM);
    if (state !== n.state) {
      n.state = state;
      n.marker.material.map = faces[state] || faces.idle;
    }
  }

  return {
    object,
    solids,
    notes,
    plate,
    card,
    setPlateSize,
    setMarker,
    update(frame) {
      if (env.mode === "edit" || !frame || !frame.cameraQuaternion) {
        return;
      }
      for (const n of notes) {
        n.marker.quaternion.copy(frame.cameraQuaternion);
      }
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
