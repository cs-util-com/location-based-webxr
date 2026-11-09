// A quiz whose four answers are four small scenes. Throwaway; not wired to the app.
//
// Each answer stands on its own plinth: a picture, a model built from primitives and a few
// words, composed by the creator like a station's free items. The visitor walks round the
// four, compares them as things, taps one and chooses it in the card. Then a consequence plays
// instead of a bare "Correct!": the chosen scene shows what its answer would have meant (it
// falls, fades, comes alive or grows), and the right one grows to its true size where it stood.
//
// Cost: one 1024 px canvas holds every picture, caption and label. A scene is three draw calls
// (its turntable and stands, its model, its painted panels); the four plinths are one.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";

const NAME = "answer-scenes";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';
const DEG = Math.PI / 180;

/* ---------- what the look rests on, in metres ---------- */
const PLINTH_W = 0.9;
const PLINTH_H = 1.15; // a pedestal: the scene stands near the eye, above the story card
const TOP = PLINTH_H + 0.03; // the turntable's surface: where items stand
const DISC_R = 0.44;
const LABEL_W = 0.8;
const LABEL_H = 0.11;
const LABEL_TILT = 35 * DEG;
const PIC_W = 0.4;
const PIC_H = 0.3;
const PIC_TILT = 12 * DEG;
const WORDS_W = 0.34;
const WORDS_H = 0.13;
const WORDS_TILT = 8 * DEG;
const WORDS_LIFT = 0.44; // a caption is a small sign on a post, over the picture and the label
const PIC_LIFT = 0.06; // a picture stands on its easel over the label in front
const HIT_R = 0.62;
const SPACING = 1.5; // between two default scenes
const FACE_TAU = 0.6; // seconds: a turntable turns to the visitor, slowly
const FAR = 5; // metres: past this the card asks the visitor to come closer
const REVEAL_AFTER = 2.6; // seconds between a wrong scene's consequence and the right one's

const SPOTS = {
  left: [-0.22, -0.04],
  middle: [0, -0.02],
  right: [0.22, -0.04],
  back: [0, -0.24],
  front: [0, 0.14],
};
const SPOT_OPTIONS = [
  ["left", "Left"],
  ["middle", "Middle"],
  ["right", "Right"],
  ["back", "Back"],
  ["front", "Front"],
];

const EFFECTS = {
  grow: { label: "Grows to its true size where it stood", dur: 2.4 },
  alive: { label: "Comes alive on its plinth", dur: 1.2 },
  fall: { label: "Falls over", dur: 1.1 },
  fade: { label: "Fades and sinks into its plinth", dur: 1.4 },
};

/* ---------- the atlas: one 1024 px canvas, a 512 px cell per scene ---------- */
const ATLAS = 1024;
const CELL = 512;
const BAND = { x: 0, y: 0, w: 512, h: 70 }; // LABEL_W : LABEL_H
const PIC = { x: 0, y: 80, w: 288, h: 216 }; // PIC_W : PIC_H
const WORDS = { x: 0, y: 306, w: 512, h: 196 }; // WORDS_W : WORDS_H

/* ---------- stock models, made from primitives at the plinth's scale ---------- */
// The same parts format as the primitives block: shape, dims, pose (y is the part's foot),
// colour. "own" in the record means the creator's own parts.
const STONE = "#9a958c";
const WOOD = "#6b4a2f";
const BRONZE = "#5f8f7a";
const STOCK = {
  well: [
    {
      shape: "cylinder",
      dims: { r: 0.13, h: 0.14 },
      pose: { x: 0, y: 0, z: 0 },
      colour: STONE,
    },
    {
      shape: "cylinder",
      dims: { r: 0.105, h: 0.006 },
      pose: { x: 0, y: 0.14, z: 0 },
      colour: "#24303c",
    },
    {
      shape: "box",
      dims: { w: 0.02, h: 0.3, d: 0.02 },
      pose: { x: -0.12, y: 0, z: 0 },
      colour: WOOD,
    },
    {
      shape: "box",
      dims: { w: 0.02, h: 0.3, d: 0.02 },
      pose: { x: 0.12, y: 0, z: 0 },
      colour: WOOD,
    },
    {
      shape: "box",
      dims: { w: 0.27, h: 0.02, d: 0.02 },
      pose: { x: 0, y: 0.27, z: 0 },
      colour: WOOD,
    },
    {
      shape: "cone",
      dims: { r: 0.2, h: 0.12, sides: 4 },
      pose: { x: 0, y: 0.3, z: 0, yaw: 45 },
      colour: "#5a3b26",
    },
    {
      shape: "cylinder",
      dims: { r: 0.028, h: 0.04 },
      pose: { x: 0, y: 0.17, z: 0 },
      colour: "#7a5a3a",
    },
  ],
  cross: [
    {
      shape: "box",
      dims: { w: 0.3, h: 0.05, d: 0.3 },
      pose: { x: 0, y: 0, z: 0 },
      colour: "#a29c90",
    },
    {
      shape: "box",
      dims: { w: 0.2, h: 0.05, d: 0.2 },
      pose: { x: 0, y: 0.05, z: 0 },
      colour: "#a29c90",
    },
    {
      shape: "box",
      dims: { w: 0.05, h: 0.36, d: 0.05 },
      pose: { x: 0, y: 0.1, z: 0 },
      colour: "#8c867b",
    },
    {
      shape: "box",
      dims: { w: 0.2, h: 0.045, d: 0.045 },
      pose: { x: 0, y: 0.36, z: 0 },
      colour: "#8c867b",
    },
  ],
  tree: [
    {
      shape: "cylinder",
      dims: { r: 0.028, h: 0.26 },
      pose: { x: 0, y: 0, z: 0 },
      colour: WOOD,
    },
    {
      shape: "sphere",
      dims: { r: 0.17 },
      pose: { x: 0, y: 0.22, z: 0 },
      colour: "#4f7d3a",
    },
    {
      shape: "sphere",
      dims: { r: 0.11 },
      pose: { x: 0.1, y: 0.3, z: 0.04 },
      colour: "#5d8d43",
    },
  ],
  statue: [
    {
      shape: "box",
      dims: { w: 0.16, h: 0.16, d: 0.16 },
      pose: { x: 0, y: 0, z: 0 },
      colour: "#b9b2a3",
    },
    {
      shape: "cylinder",
      dims: { r: 0.045, h: 0.15 },
      pose: { x: 0, y: 0.16, z: 0 },
      colour: BRONZE,
    },
    {
      shape: "box",
      dims: { w: 0.13, h: 0.025, d: 0.025 },
      pose: { x: 0, y: 0.26, z: 0 },
      colour: BRONZE,
    },
    {
      shape: "sphere",
      dims: { r: 0.035 },
      pose: { x: 0, y: 0.31, z: 0 },
      colour: BRONZE,
    },
  ],
  stall: [
    {
      shape: "box",
      dims: { w: 0.32, h: 0.12, d: 0.18 },
      pose: { x: 0, y: 0, z: 0 },
      colour: "#8a6a48",
    },
    {
      shape: "box",
      dims: { w: 0.015, h: 0.3, d: 0.015 },
      pose: { x: -0.15, y: 0, z: -0.08 },
      colour: WOOD,
    },
    {
      shape: "box",
      dims: { w: 0.015, h: 0.3, d: 0.015 },
      pose: { x: 0.15, y: 0, z: -0.08 },
      colour: WOOD,
    },
    {
      shape: "box",
      dims: { w: 0.36, h: 0.02, d: 0.24 },
      pose: { x: 0, y: 0.3, z: 0 },
      colour: "#c0503a",
    },
    {
      shape: "sphere",
      dims: { r: 0.03 },
      pose: { x: -0.06, y: 0.12, z: 0.03 },
      colour: "#d9a13a",
    },
    {
      shape: "sphere",
      dims: { r: 0.03 },
      pose: { x: 0.02, y: 0.12, z: 0.03 },
      colour: "#b8452c",
    },
  ],
};
const STOCK_OPTIONS = [
  ["none", "No model"],
  ["well", "A well"],
  ["cross", "A market cross"],
  ["tree", "A tree"],
  ["statue", "A statue"],
  ["stall", "A market stall"],
  ["own", "Own parts (from the record)"],
];
// A picture item in the app names an asset file. This stage has no files, so a picture here
// names one of a few drawings painted on the spot, standing in for the creator's photo.
const ART_OPTIONS = [
  ["none", "No picture"],
  ["well", "Drawing: a well"],
  ["cross", "Drawing: a cross"],
  ["tree", "Drawing: a tree"],
  ["statue", "Drawing: a statue"],
  ["market", "Drawing: a market day"],
];
const SHAPES = ["box", "cylinder", "cone", "sphere"];

const WHY =
  "Why 3D here: each answer is something to look at, not a word to read. A picture, a small " +
  "model and a caption stand where the question is about, and you compare them as things. " +
  "After you choose, the right answer grows to its true size on the spot where it stood, so the " +
  "answer is seen at its real scale against the real place, which a card cannot show.";
const AGAINST =
  "The strongest case against: it is the most work for a creator, four small scenes for one " +
  "question, and most creators will type four words, which the card shows faster and all at " +
  "once. A phone also shows only one or two plinths at a time, so comparing means turning and " +
  "walking.";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d, a, b) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, a, b) : d;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const turn = (a, b) => {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};
const text = (v, max) =>
  typeof v === "string" ? [...v.trim()].slice(0, max).join("") : "";
const HEX = /^#[0-9a-f]{6}$/i;

/** What the visitor already did on a quiz. The seam has no saved progress, so it lives here. */
const kept = new Map();
/** One open of the kind: world() makes it, card() finds it by the block both of them get. */
const sessions = new WeakMap();

/* ---------- painting ---------- */
function wrap(g, words, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of words.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fit(g, words, w, h, sizes, weight = 700) {
  for (const size of sizes) {
    g.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(g, words, w);
    if (
      lines.length * size * 1.12 <= h &&
      lines.every((l) => g.measureText(l).width <= w)
    )
      return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  g.font = `${weight} ${size}px ${FONT}`;
  return {
    size,
    lines: wrap(g, words, w).slice(0, Math.floor(h / (size * 1.12))),
  };
}

function drawLines(g, box, cx, cy, maxW) {
  const lead = box.size * 1.12;
  const y0 = cy - ((box.lines.length - 1) * lead) / 2;
  box.lines.forEach((l, i) => g.fillText(l, cx, y0 + i * lead, maxW));
}

function plate(g, r, fill, edge) {
  g.beginPath();
  g.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 14);
  g.fillStyle = fill;
  g.fill();
  if (edge) {
    g.lineWidth = 5;
    g.strokeStyle = edge;
    g.stroke();
  }
}

/** A small ink drawing on old paper, standing in for the creator's photo. */
function drawArt(g, art, r) {
  g.save();
  g.fillStyle = "#efe4cc";
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = "#5b4630";
  g.lineWidth = 6;
  g.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  g.translate(r.x + r.w / 2, r.y + r.h - 34);
  g.strokeStyle = "#3b2f22";
  g.fillStyle = "#3b2f22";
  g.lineWidth = 4;
  g.lineCap = "round";
  g.lineJoin = "round";
  const line = (pts) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  line([
    [-120, 10],
    [120, 10],
  ]); // the ground
  for (let i = -110; i < 120; i += 14)
    line([
      [i, 16],
      [i + 8, 24],
    ]);
  if (art === "well") {
    g.strokeRect(-36, -40, 72, 50);
    for (let y = -30; y < 10; y += 12)
      line([
        [-36, y],
        [36, y],
      ]);
    line([
      [-30, -40],
      [-30, -110],
    ]);
    line([
      [30, -40],
      [30, -110],
    ]);
    line([
      [-52, -100],
      [0, -140],
      [52, -100],
      [-52, -100],
    ]);
    line([
      [0, -104],
      [0, -70],
    ]);
    g.strokeRect(-9, -70, 18, 16);
  } else if (art === "cross") {
    g.strokeRect(-46, -12, 92, 22);
    g.strokeRect(-30, -30, 60, 18);
    line([
      [0, -30],
      [0, -140],
    ]);
    line([
      [-30, -112],
      [30, -112],
    ]);
  } else if (art === "tree") {
    line([
      [0, 10],
      [0, -60],
    ]);
    line([
      [0, -40],
      [-22, -66],
    ]);
    line([
      [0, -50],
      [20, -74],
    ]);
    for (const [x, y, rr] of [
      [0, -98, 44],
      [-34, -78, 28],
      [34, -84, 30],
    ]) {
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (art === "statue") {
    g.strokeRect(-28, -40, 56, 50);
    line([
      [0, -40],
      [0, -96],
    ]);
    line([
      [-24, -80],
      [24, -80],
    ]);
    line([
      [0, -96],
      [-14, -40],
    ]);
    g.beginPath();
    g.arc(0, -110, 13, 0, Math.PI * 2);
    g.stroke();
  } else if (art === "market") {
    for (const x of [-80, 0, 80]) {
      line([
        [x - 30, 10],
        [x - 30, -50],
      ]);
      line([
        [x + 30, 10],
        [x + 30, -50],
      ]);
      line([
        [x - 38, -50],
        [x, -76],
        [x + 38, -50],
        [x - 38, -50],
      ]);
      g.strokeRect(x - 26, -24, 52, 18);
    }
  }
  g.restore();
}

function paintCell(g, scene, look) {
  // The answer's own words, on the label in front of its turntable.
  const ink =
    look === "right" ? "#04201c" : look === "picked" ? "#2a1104" : "#ffffff";
  const fill =
    look === "right" ? "#2dd4bf" : look === "picked" ? "#fb923c" : "#141a20";
  plate(g, BAND, fill, look === "open" ? "#ffffff" : null);
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const label = fit(
    g,
    scene.label,
    BAND.w - 40,
    BAND.h - 10,
    [44, 38, 32, 27, 23],
  );
  drawLines(
    g,
    label,
    BAND.x + BAND.w / 2,
    BAND.y + BAND.h / 2 + 1,
    BAND.w - 40,
  );
  if (scene.picture) drawArt(g, scene.picture.art, PIC);
  if (scene.words) {
    plate(g, WORDS, "#fbf8f0", null);
    g.fillStyle = "#1c2128";
    const box = fit(
      g,
      scene.words.text,
      WORDS.w - 48,
      WORDS.h - 30,
      [64, 54, 46, 40, 34, 29],
      600,
    );
    drawLines(
      g,
      box,
      WORDS.x + WORDS.w / 2,
      WORDS.y + WORDS.h / 2,
      WORDS.w - 48,
    );
  }
}

/* ---------- geometry: primitives merged into one mesh per part of a scene ---------- */
const tmpM = new Matrix4();
const tmpC = new Color();

function partGeometry(p) {
  const d = p.dims;
  if (p.shape === "box")
    return new BoxGeometry(d.w, d.h, d.d).translate(0, d.h / 2, 0);
  if (p.shape === "cone")
    return new ConeGeometry(d.r, d.h, d.sides ?? 14).translate(0, d.h / 2, 0);
  if (p.shape === "sphere")
    return new SphereGeometry(d.r, 12, 8).translate(0, d.r, 0);
  return new CylinderGeometry(d.r, d.r, d.h, d.sides ?? 14).translate(
    0,
    d.h / 2,
    0,
  );
}

/** Pieces of { geo, colour? } into one non-indexed geometry, the pieces freed. */
function merge(pieces, withUv) {
  let count = 0;
  const flat = pieces.map(({ geo, colour }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    count += g.attributes.position.count;
    return { g, colour };
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = withUv ? null : new Float32Array(count * 3);
  const uv = withUv ? new Float32Array(count * 2) : null;
  let o = 0;
  for (const { g, colour } of flat) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    if (col) {
      tmpC.set(colour);
      for (let i = 0; i < n; i++) {
        col[(o + i) * 3] = tmpC.r;
        col[(o + i) * 3 + 1] = tmpC.g;
        col[(o + i) * 3 + 2] = tmpC.b;
      }
    }
    o += n;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  if (col) out.setAttribute("color", new Float32BufferAttribute(col, 3));
  if (uv) out.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/** A board standing on its bottom edge, leaning back by `tilt`, at (x, y, z). */
function standing(geo, x, y, z, tilt) {
  return geo
    .applyMatrix4(tmpM.makeRotationX(-tilt))
    .applyMatrix4(tmpM.makeTranslation(x, y, z));
}

/** A plane that shows one region of the atlas. */
function panel(w, h, cell, r, front) {
  const geo = new PlaneGeometry(w, h).translate(0, h / 2, front);
  const ox = (cell % 2) * CELL;
  const oy = Math.floor(cell / 2) * CELL;
  const u0 = (ox + r.x) / ATLAS;
  const u1 = (ox + r.x + r.w) / ATLAS;
  const v1 = 1 - (oy + r.y) / ATLAS;
  const v0 = 1 - (oy + r.y + r.h) / ATLAS;
  const uv = geo.attributes.uv;
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  return geo;
}

/* ---------- the record ---------- */
function readPart(p) {
  const shape = SHAPES.includes(p?.shape) ? p.shape : "box";
  const d = p?.dims ?? {};
  const dims =
    shape === "box"
      ? {
          w: num(d.w, 0.1, 0.01, 0.6),
          h: num(d.h, 0.1, 0.01, 0.6),
          d: num(d.d, 0.1, 0.01, 0.6),
        }
      : shape === "sphere"
        ? { r: num(d.r, 0.05, 0.01, 0.3) }
        : {
            r: num(d.r, 0.05, 0.01, 0.3),
            h: num(d.h, 0.1, 0.005, 0.6),
            sides: Math.round(num(d.sides, 14, 3, 24)),
          };
  return {
    shape,
    dims,
    pose: {
      x: num(p?.pose?.x, 0, -0.4, 0.4),
      y: num(p?.pose?.y, 0, 0, 0.6),
      z: num(p?.pose?.z, 0, -0.4, 0.4),
      yaw: num(p?.pose?.yaw, 0, -360, 360),
    },
    colour: HEX.test(p?.colour ?? "") ? p.colour : "#8d8a84",
  };
}

function readScene(o, i, n, rightId) {
  const sc = o.scene ?? {};
  const spot = (v, d) => SPOTS[v in SPOTS ? v : d];
  const art = ART_OPTIONS.some(([a]) => a === sc.picture?.art)
    ? sc.picture.art
    : "none";
  const stock = STOCK_OPTIONS.some(([s]) => s === sc.model?.stock)
    ? sc.model.stock
    : "none";
  const parts =
    stock === "own"
      ? (Array.isArray(sc.model?.parts) ? sc.model.parts : [])
          .slice(0, 12)
          .map(readPart)
      : stock === "none"
        ? []
        : STOCK[stock].map(readPart);
  const words = text(sc.words?.text, 40);
  const right = o.id === rightId;
  const out = o.outcome ?? {};
  const effect = out.effect in EFFECTS ? out.effect : right ? "alive" : "fade";
  const mid = (n - 1) / 2;
  return {
    id: o.id,
    label: o.label,
    right,
    at: {
      x: num(sc.at?.x, (i - mid) * SPACING, -18, 18),
      z: num(sc.at?.z, 0.3 * (i - mid) ** 2, -18, 18),
    },
    picture:
      art === "none"
        ? null
        : {
            art,
            spot: spot(sc.picture.spot, "left"),
            size: num(sc.picture.size, 1, 0.6, 1.4),
          },
    model: parts.length
      ? {
          parts,
          spot: spot(sc.model.spot, "right"),
          size: num(sc.model.size, 1, 0.5, 1.5),
        }
      : null,
    words: words ? { text: words, spot: spot(sc.words.spot, "front") } : null,
    outcome: {
      effect,
      says:
        text(out.says, 220) || (right ? "That is the one." : "Not this one."),
      at: { x: num(out.at?.x, 0, -20, 20), z: num(out.at?.z, -6, -20, 20) },
      scale: num(out.scale, 8, 2, 14),
    },
  };
}

/* ---------- the world part ---------- */
function scenesWorld(block, env) {
  const edit = env.mode === "edit";
  const was = edit ? null : (kept.get(block.key) ?? null);
  const q = {
    edit,
    whole: !!was, // reopened after it was answered: shown as it ended, nothing to do
    selected: was ? was.picked : -1,
    picked: was ? was.picked : -1,
    result: was?.result ?? null,
    earned: was?.earned ?? 0,
    sync: null,
    line: null,
    where: "", // after the pick: where a scene that grows can be seen
    choose: null,
    select: null,
  };
  sessions.set(block, q);
  const n = block.scenes.length;

  // Always one 1024 px canvas: the stage multiplies by the screen's density, so ask for less.
  const probe = env.paintText({ width: 8, height: 8 });
  const logical = ATLAS / (probe.image.width / 8);
  probe.dispose();
  const looks = block.scenes.map(() => "open");
  const atlas = env.paintText({
    width: logical,
    height: logical,
    draw(g, w) {
      const k = w / ATLAS;
      for (let i = 0; i < n; i++) {
        g.save();
        g.scale(k, k);
        g.translate((i % 2) * CELL, Math.floor(i / 2) * CELL);
        paintCell(g, block.scenes[i], looks[i]);
        g.restore();
      }
    },
  });

  const object = new Group();
  const geos = [];
  const mats = [];
  const keep = (x, list) => (list.push(x), x);

  // The four plinths never move: one mesh.
  const plinthMat = keep(new MeshLambertMaterial({ vertexColors: true }), mats);
  const plinthGeo = keep(
    merge(
      block.scenes.flatMap((s) => [
        {
          geo: new BoxGeometry(PLINTH_W, PLINTH_H - 0.04, PLINTH_W).translate(
            s.at.x,
            (PLINTH_H - 0.04) / 2,
            s.at.z,
          ),
          colour: "#cfc8bb",
        },
        {
          geo: new BoxGeometry(
            PLINTH_W + 0.06,
            0.04,
            PLINTH_W + 0.06,
          ).translate(s.at.x, PLINTH_H - 0.02, s.at.z),
          colour: "#b4ac9e",
        },
      ]),
    ),
    geos,
  );
  object.add(new Mesh(plinthGeo, plinthMat));

  const ringGeo = keep(
    new RingGeometry(0.74, 0.86, 40).rotateX(-Math.PI / 2),
    geos,
  );
  const markPick = new Mesh(
    ringGeo,
    keep(
      new MeshBasicMaterial({
        color: "#fb923c",
        transparent: true,
        depthWrite: false,
      }),
      mats,
    ),
  );
  const markRight = new Mesh(
    ringGeo,
    keep(
      new MeshBasicMaterial({
        color: "#2dd4bf",
        transparent: true,
        depthWrite: false,
      }),
      mats,
    ),
  );
  markPick.visible = markRight.visible = false;
  markPick.position.y = markRight.position.y = 0.02;
  object.add(markPick, markRight);

  const pulseMat = keep(
    new MeshBasicMaterial({
      color: "#ffd391",
      transparent: true,
      depthWrite: false,
    }),
    mats,
  );
  const pulse = new Mesh(ringGeo, pulseMat);
  pulse.visible = false;
  object.add(pulse);

  const MOTES = 24;
  const motePos = new Float32Array(MOTES * 3);
  const moteGeo = keep(new BufferGeometry(), geos);
  moteGeo.setAttribute("position", new Float32BufferAttribute(motePos, 3));
  const moteMat = keep(
    new PointsMaterial({
      color: "#ffd391",
      size: 0.05,
      transparent: true,
      depthWrite: false,
    }),
    mats,
  );
  const motes = new Points(moteGeo, moteMat);
  motes.visible = false;
  motes.frustumCulled = false;
  object.add(motes);
  const moteAt = new Vector3();

  const ghostMat = keep(
    new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    mats,
  );

  const scenes = block.scenes.map((s, i) => {
    const group = new Group();
    group.position.set(s.at.x, 0, s.at.z);
    group.name = `scene-${i}`;
    const mat = keep(new MeshLambertMaterial({ vertexColors: true }), mats);
    const panelMat = keep(new MeshBasicMaterial({ map: atlas }), mats);

    // The turntable, the label's stand and the stands of a picture and a caption.
    const solid = [
      {
        geo: new CylinderGeometry(DISC_R, DISC_R, 0.03, 32).translate(
          0,
          PLINTH_H + 0.015,
          0,
        ),
        colour: "#7c6a55",
      },
      {
        geo: standing(
          new BoxGeometry(LABEL_W + 0.02, LABEL_H + 0.02, 0.012).translate(
            0,
            LABEL_H / 2,
            0,
          ),
          0,
          TOP - 0.01,
          DISC_R - 0.06,
          LABEL_TILT,
        ),
        colour: "#2b2f35",
      },
    ];
    const boards = [panel(LABEL_W, LABEL_H, i, BAND, 0.008)];
    standing(boards[0], 0, TOP - 0.01, DISC_R - 0.06, LABEL_TILT);
    if (s.picture) {
      const [x, z] = s.picture.spot;
      const w = PIC_W * s.picture.size;
      const h = PIC_H * s.picture.size;
      solid.push(
        {
          geo: standing(
            new BoxGeometry(w + 0.03, h + 0.03, 0.014).translate(
              0,
              (h + 0.03) / 2,
              0,
            ),
            x,
            TOP + PIC_LIFT,
            z,
            PIC_TILT,
          ),
          colour: "#4a3424",
        },
        {
          geo: standing(
            new BoxGeometry(0.016, h * 0.85, 0.016).translate(
              0,
              (h * 0.85) / 2,
              0,
            ),
            x,
            TOP,
            z - 0.12 * s.picture.size,
            -18 * DEG,
          ),
          colour: "#4a3424",
        },
      );
      boards.push(
        standing(
          panel(w, h, i, PIC, 0.009).translate(0, 0.015, 0),
          x,
          TOP + PIC_LIFT,
          z,
          PIC_TILT,
        ),
      );
    }
    if (s.words) {
      const [x, z] = s.words.spot;
      solid.push(
        {
          geo: standing(
            new BoxGeometry(WORDS_W, WORDS_H, 0.008).translate(
              0,
              WORDS_H / 2,
              0,
            ),
            x,
            TOP + WORDS_LIFT,
            z,
            WORDS_TILT,
          ),
          colour: "#d8d2c4",
        },
        {
          geo: new BoxGeometry(0.016, WORDS_LIFT + 0.02, 0.016).translate(
            x,
            TOP + (WORDS_LIFT + 0.02) / 2,
            z - 0.012,
          ),
          colour: "#4a3424",
        },
      );
      boards.push(
        standing(
          panel(WORDS_W, WORDS_H, i, WORDS, 0.006),
          x,
          TOP + WORDS_LIFT,
          z,
          WORDS_TILT,
        ),
      );
    }
    const solidGeo = keep(merge(solid), geos);
    const panelGeo = keep(
      merge(
        boards.map((geo) => ({ geo })),
        true,
      ),
      geos,
    );
    const turntable = new Group();
    turntable.add(new Mesh(solidGeo, mat), new Mesh(panelGeo, panelMat));

    let model = null;
    let ghost = null;
    if (s.model) {
      const modelGeo = keep(
        merge(
          s.model.parts.map((p) => ({
            geo: partGeometry(p)
              .applyMatrix4(tmpM.makeRotationY((p.pose.yaw ?? 0) * DEG))
              .applyMatrix4(tmpM.makeTranslation(p.pose.x, p.pose.y, p.pose.z)),
            colour: p.colour,
          })),
        ),
        geos,
      );
      model = new Mesh(modelGeo, mat);
      const [x, z] = s.model.spot;
      model.position.set(x, TOP, z);
      model.scale.setScalar(s.model.size);
      turntable.add(model);
      if (s.outcome.effect === "grow") {
        // The same geometry at its true size, a ghost on the spot where it stood.
        ghost = new Mesh(modelGeo, ghostMat);
        ghost.position.set(s.outcome.at.x, 0, s.outcome.at.z);
        ghost.visible = false;
        object.add(ghost);
      }
    }
    group.add(turntable);
    group.add(
      env.hitArea({
        radius: HIT_R,
        at: new Vector3(0, TOP + 0.12, 0),
        name: `scene-${i}`,
      }),
    );
    object.add(group);
    return {
      s,
      group,
      turntable,
      model,
      ghost,
      mat,
      panelMat,
      face: 0,
      start: Infinity, // when this scene's consequence began
      dim: false,
    };
  });

  const right = block.scenes.findIndex((s) => s.right);
  let revealAt = Infinity;
  let revealed = false;
  let snap = true;
  let farCode = -1;
  let lastLook = "";

  const repaint = () => {
    for (let i = 0; i < n; i++) {
      looks[i] = q.result
        ? i === right
          ? "right"
          : i === q.picked
            ? "picked"
            : "dim"
        : i === q.selected
          ? "picked"
          : "open";
    }
    const key = looks.join();
    if (key !== lastLook) {
      lastLook = key;
      atlas.repaint();
    }
  };

  // The scene whose pulse and motes show: the last one that came alive or grew.
  let active = -1;
  const lively = (i) => {
    const e = scenes[i].s.outcome.effect;
    return e === "alive" || e === "grow";
  };
  /** Start scene i's consequence at time t. */
  const play = (i, t) => {
    scenes[i].start = t;
    if (lively(i)) active = i;
  };
  // Shown as it ended: after ten rounds, or in Edit when the creator previews an outcome.
  const ended = (i) => {
    scenes[i].start = -1000;
    if (lively(i)) active = i;
  };
  if (q.whole) {
    for (let i = 0; i < n; i++) scenes[i].dim = i !== q.picked && i !== right;
    if (q.picked >= 0 && q.picked !== right) ended(q.picked);
    if (right >= 0) ended(right);
    revealed = true;
  }
  if (edit && block.edit.preview === "outcome") ended(block.edit.scene);

  /** Where a scene that grows will stand, said from where the visitor looks now. */
  const whereTo = (i) => {
    const sc = scenes[i];
    if (!sc.ghost) return "";
    const v = env.frame.viewer;
    const at = sc.s.outcome.at;
    const off = turn(env.frame.viewYaw, Math.atan2(at.x - v.x, at.z - v.z));
    const abs = Math.abs(off);
    if (abs < 0.5) return "It grows where it stood, ahead of you.";
    if (abs > 2.3) return "It grows where it stood, behind you.";
    return off > 0
      ? "It grows where it stood: look to your left."
      : "It grows where it stood: look to your right.";
  };

  q.select = (i) => {
    if (q.result || edit || i < 0 || i >= n) return;
    q.selected = i;
    env.sound("tap").play();
    repaint();
    q.sync?.();
  };
  q.choose = () => {
    if (q.result || q.selected < 0) return;
    const t = env.frame.time;
    q.picked = q.selected;
    const ok = q.picked === right;
    q.result = ok ? "right" : "wrong";
    q.earned = ok ? block.points : 0;
    kept.set(block.key, {
      picked: q.picked,
      result: q.result,
      earned: q.earned,
    });
    for (let i = 0; i < n; i++) scenes[i].dim = i !== q.picked && i !== right;
    play(q.picked, t);
    env.sound(ok ? "right" : "wrong").play();
    env.say(block.scenes[q.picked].outcome.says, {
      mood: ok ? "happy" : "doubt",
      eyebrow: ok ? "Right" : "Not this one",
    });
    q.where = whereTo(q.picked);
    if (ok) {
      revealed = true;
      env.done();
    } else revealAt = t + REVEAL_AFTER;
    repaint();
    q.sync?.();
  };
  repaint();

  const grey = new Color("#7d838b");
  const white = new Color("#ffffff");
  const MARK = {
    edit: new Color("#ffffff"),
    wrong: new Color("#f87171"),
    pick: new Color("#fb923c"),
  };

  return {
    object,
    update(frame) {
      const t = frame.time;
      const v = frame.viewer;
      const soft = frame.dt > 0 ? 1 - Math.exp(-frame.dt / FACE_TAU) : 1;
      let nearest = Infinity;

      if (!revealed && t >= revealAt) {
        revealed = true;
        play(right, t);
        env.sound("done").play();
        env.say(block.scenes[right].outcome.says, {
          mood: "happy",
          eyebrow: "The right answer",
        });
        q.where = whereTo(right) || q.where;
        q.sync?.();
        env.done();
      }

      let ghostOpacity = 0;
      for (let i = 0; i < n; i++) {
        const sc = scenes[i];
        const { at, outcome } = sc.s;
        const dx = v.x - at.x;
        const dz = v.z - at.z;
        const d = Math.hypot(dx, dz);
        if (d < nearest) nearest = d;

        // A turntable turns to the visitor, so its picture and words always read.
        const face = Math.atan2(dx, dz);
        sc.face =
          snap || soft === 1 ? face : sc.face + turn(sc.face, face) * soft;
        sc.group.rotation.y = sc.face;

        const on = sc.start !== Infinity;
        const k = on
          ? clamp((t - sc.start) / EFFECTS[outcome.effect].dur, 0, 1)
          : 0;
        const fade = on && outcome.effect === "fade" ? easeOut(k) : 0;
        const g = Math.max(fade, sc.dim ? 0.6 : 0);
        sc.mat.color.copy(white).lerp(grey, g);
        sc.panelMat.color.copy(white).lerp(grey, g * 0.8);
        sc.turntable.position.y = -0.34 * fade;
        sc.turntable.visible = fade < 0.99;

        if (sc.model) {
          const m = sc.model;
          if (on && outcome.effect === "fall") {
            m.rotation.set((Math.PI / 2) * easeBack(k), 0, 0);
          } else if (on && outcome.effect === "alive") {
            const since = Math.max(0, t - sc.start);
            m.rotation.set(0, since * 1.4, 0);
            m.position.y = TOP + Math.abs(Math.sin(since * 5)) * 0.05 * k;
          } else {
            m.rotation.set(0, 0, 0);
            m.position.y = TOP;
          }
          if (sc.ghost) {
            const gk = easeOut(k);
            sc.ghost.visible = gk > 0.01;
            sc.ghost.scale.setScalar(sc.s.model.size * outcome.scale * gk);
            ghostOpacity = Math.max(ghostOpacity, 0.55 * gk);
          }
        }
      }
      ghostMat.opacity = ghostOpacity;
      snap = false;

      // Where the visitor picked, and, once it shows, which one was right.
      const markOn = edit ? block.edit.scene : q.result ? q.picked : q.selected;
      markPick.visible = markOn >= 0 && !(q.result && q.picked === right);
      if (markPick.visible) {
        const at = block.scenes[markOn].at;
        markPick.position.set(at.x, 0.02, at.z);
        markPick.material.color.copy(
          edit ? MARK.edit : q.result ? MARK.wrong : MARK.pick,
        );
      }
      markRight.visible = !edit && revealed && right >= 0;
      if (markRight.visible) {
        const at = block.scenes[right].at;
        markRight.position.set(at.x, 0.02, at.z);
      }

      // A pulse at the foot of what came alive or grew, and motes rising from it for a while.
      const sa = active >= 0 ? scenes[active] : null;
      const since = sa ? t - sa.start : Infinity;
      const moteFade = edit ? 1 : clamp((7 - since) / 1.5, 0, 1);
      pulse.visible = !!sa && since < 1.6;
      motes.visible = !!sa && moteFade > 0;
      if (sa && (pulse.visible || motes.visible)) {
        const big = !!sa.ghost;
        const pa = big ? sa.s.outcome.at : sa.s.at;
        const pk = clamp(since / 1.6, 0, 1);
        pulse.position.set(pa.x, 0.03, pa.z);
        pulse.scale.setScalar((big ? 2.2 : 1) * (0.6 + 1.6 * pk));
        pulseMat.opacity = 1 - pk;
        moteAt.set(pa.x, big ? 0 : TOP, pa.z);
        const spread = big ? 1.6 : 0.42;
        const rise = big ? 3.2 : 0.7;
        for (let i = 0; i < MOTES; i++) {
          const ph = (i * 2.399) % (Math.PI * 2);
          const life = (t * 0.35 + i / MOTES) % 1;
          const r = spread * (0.4 + (0.6 * ((i * 7) % 5)) / 4);
          motePos[i * 3] = moteAt.x + Math.cos(ph + life) * r;
          motePos[i * 3 + 1] = moteAt.y + 0.05 + life * rise;
          motePos[i * 3 + 2] = moteAt.z + Math.sin(ph + life) * r;
        }
        moteGeo.attributes.position.needsUpdate = true;
        moteMat.opacity = 0.9 * moteFade;
      }

      if (edit || !q.line || q.result) return;
      const code = nearest > FAR ? 1 : q.selected >= 0 ? 2 : 0;
      if (code !== farCode) {
        farCode = code;
        q.line(code);
      }
    },
    tap(hit) {
      const i = Number(hit.name?.slice(6));
      if (hit.name?.startsWith("scene-")) q.select(i);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
      q.sync = q.line = q.choose = q.select = null;
    },
  };
}

/* ---------- the card: the question, the four answers as words, Choose ---------- */
const CARD_CSS = `
[data-kind="${NAME}"] .scline { min-height: 21px; margin-top: 10px; font-size: 15px; font-weight: 600; color: var(--walk-found); }
[data-kind="${NAME}"] .scline.far { color: #ffd391; }
[data-kind="${NAME}"] .scacts { display: flex; gap: 8px; margin-top: 8px; }
[data-kind="${NAME}"] .scacts .btn { flex: 1; min-height: 42px; padding: 8px 10px; font-size: 14px; }
[data-kind="${NAME}"] .scacts .btn.primary { flex: 1.4; }
[data-kind="${NAME}"] .answers .a { overflow-wrap: anywhere; }
[data-kind="${NAME}"] .again { margin-top: 6px; font-size: 12.5px; color: var(--walk-muted); }
[data-kind="${NAME}"] .why { margin-top: 10px; font-size: 13px; color: var(--walk-muted); }
[data-kind="${NAME}"] .why summary { cursor: pointer; min-height: 28px; font-weight: 600; }
[data-kind="${NAME}"] .why p + p { margin-top: 6px; }
`;

function whyBox() {
  const why = document.createElement("details");
  why.className = "why";
  why.innerHTML =
    "<summary>Why are the answers scenes?</summary><p></p><p></p>";
  const [a, b] = why.querySelectorAll("p");
  a.textContent = WHY;
  b.textContent = AGAINST;
  return why;
}

function scenesCard(block, el, env) {
  const q = sessions.get(block);
  if (!q) return { dispose() {} };
  // The card stays short: the answers are in the world. The tiles are the fallback, on request.
  const box = document.createElement("div");
  box.innerHTML = `<style>${CARD_CSS}</style>
    <p class="scline" role="status"></p>
    <div class="scacts">
      <button type="button" class="btn primary" data-do="choose" hidden>Choose this one</button>
      <button type="button" class="btn" data-do="tiles">Answer in the card</button>
    </div>
    <div class="answers small" hidden></div>
    <p class="stamp" hidden></p>
    <p class="again" hidden>Prototype: reload the page to be asked again.</p>`;
  box.append(whyBox());
  el.append(box);
  const line = box.querySelector(".scline");
  const tiles = box.querySelector(".answers");
  const acts = box.querySelector(".scacts");
  const choose = box.querySelector('[data-do="choose"]');
  const asTiles = box.querySelector('[data-do="tiles"]');
  const stamp = box.querySelector(".stamp");
  const again = box.querySelector(".again");
  let showTiles = false;
  block.scenes.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "a";
    b.dataset.a = String(i);
    b.textContent = s.label;
    tiles.append(b);
  });
  const many = block.scenes.length;

  q.line = (code) => {
    line.classList.toggle("far", code === 1);
    if (code === 1)
      line.textContent = `Walk closer: the ${many} answers are the small scenes on the plinths.`;
    else if (code === 2)
      line.textContent = `Your pick: ${block.scenes[q.selected].label}. Compare the others, or choose it.`;
    else
      line.textContent =
        "Walk round the scenes and tap the one you think is right.";
  };
  q.sync = () => {
    const open = !q.result;
    line.hidden = !open && !q.where;
    if (!open) {
      line.classList.remove("far");
      line.textContent = q.where;
    }
    acts.hidden = !open;
    choose.hidden = q.selected < 0;
    asTiles.hidden = showTiles;
    tiles.hidden = !showTiles;
    for (const b of tiles.children) {
      const i = Number(b.dataset.a);
      const s = block.scenes[i];
      b.disabled = !open;
      b.className = `a ${
        open
          ? i === q.selected
            ? "on"
            : ""
          : s.right
            ? i === q.picked
              ? "right"
              : "was"
            : i === q.picked
              ? "wrong"
              : "dim"
      }`;
    }
    stamp.hidden = open;
    again.hidden = !q.whole;
    if (!open) {
      const picked = block.scenes[q.picked];
      const rightOne = block.scenes.find((s) => s.right);
      stamp.textContent = picked?.right
        ? `You chose: ${picked.label}`
        : `You chose: ${picked?.label ?? ""}. Right: ${rightOne?.label ?? ""}`;
      if (block.showScore) {
        const plus = document.createElement("span");
        plus.className = q.earned ? "plus" : "plus none";
        plus.textContent = q.earned ? `+${q.earned}` : "No points";
        stamp.append(plus);
      }
    }
  };
  box.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-a]");
    if (tile) q.select?.(Number(tile.dataset.a));
    const act = e.target.closest("[data-do]")?.dataset.do;
    if (act === "choose") q.choose?.();
    if (act === "tiles") {
      showTiles = true;
      q.sync?.();
    }
  });

  const points = block.showScore ? ` - ${block.points} points` : "";
  if (q.whole) {
    env.say(block.question, { ask: true, eyebrow: "Question done" });
    env.done();
  } else env.say(block.question, { ask: true, eyebrow: `A question${points}` });
  q.line(0);
  q.sync();
  return {
    dispose() {
      q.line = q.sync = null;
    },
  };
}

/* ---------- the edit panel: one scene composed at a time ---------- */
function sceneFields(raw) {
  const options = Array.isArray(raw?.answer?.options) ? raw.answer.options : [];
  const n = clamp(options.length, 0, 4);
  const i = clamp(Number(raw?.edit?.scene ?? 0) || 0, 0, Math.max(0, n - 1));
  const at = `answer.options.${i}`;
  const fields = [
    { name: "question", label: "Question", prose: true, max: 240 },
    {
      name: "answer.correct",
      label: "The right answer",
      type: "choice",
      options: options.map((o, k) => [String(o?.id ?? k), `Scene ${k + 1}`]),
    },
    {
      name: "edit.scene",
      label: "Compose",
      type: "choice",
      options: options.slice(0, n).map((_, k) => [String(k), `Scene ${k + 1}`]),
    },
    {
      name: "edit.preview",
      label: "Preview",
      type: "choice",
      options: [
        ["still", "As the visitor finds it"],
        ["outcome", "This scene's consequence"],
      ],
    },
    { name: `${at}.label`, label: "Its answer, in words", max: 48 },
    {
      name: `${at}.scene.picture.art`,
      label: "Picture",
      type: "choice",
      options: ART_OPTIONS,
    },
    {
      name: `${at}.scene.picture.spot`,
      label: "Picture stands",
      type: "choice",
      options: SPOT_OPTIONS,
    },
    {
      name: `${at}.scene.picture.size`,
      label: "Picture size",
      type: "range",
      min: 0.6,
      max: 1.4,
      step: 0.1,
    },
    {
      name: `${at}.scene.model.stock`,
      label: "Model",
      type: "choice",
      options: STOCK_OPTIONS,
    },
    {
      name: `${at}.scene.model.spot`,
      label: "Model stands",
      type: "choice",
      options: SPOT_OPTIONS,
    },
    {
      name: `${at}.scene.model.size`,
      label: "Model size",
      type: "range",
      min: 0.5,
      max: 1.5,
      step: 0.1,
    },
    {
      name: `${at}.scene.words.text`,
      label: "A few words (optional)",
      max: 40,
    },
    {
      name: `${at}.scene.words.spot`,
      label: "Words stand",
      type: "choice",
      options: SPOT_OPTIONS,
    },
    {
      name: `${at}.outcome.effect`,
      label: "When chosen, the scene",
      type: "choice",
      options: Object.entries(EFFECTS).map(([k, e]) => [k, e.label]),
    },
    {
      name: `${at}.outcome.says`,
      label: "The guide says then",
      prose: true,
      max: 220,
    },
  ];
  if (options[i]?.outcome?.effect === "grow") {
    fields.push(
      { name: `${at}.outcome.at`, label: "Where it stood", type: "place" },
      {
        name: `${at}.outcome.scale`,
        label: "True size, times the model",
        type: "range",
        min: 2,
        max: 14,
        step: 0.5,
      },
    );
  }
  // Then the question's own settings, and where each scene stands: drag its ring.
  fields.push(
    {
      name: "points",
      label: "Points",
      type: "number",
      min: 0,
      max: 1000,
      step: 1,
    },
    { name: "showScore", label: "Show the points", type: "toggle" },
    ...options.slice(0, n).map((_, k) => ({
      name: `answer.options.${k}.scene.at`,
      label: `Scene ${k + 1}`,
      type: "place",
    })),
  );
  return fields;
}

export const kind = {
  name: NAME,

  read(v, _view, tools) {
    const question = tools.requiredText(v, "question", { max: 240 });
    const answer = v.answer ?? {};
    if (answer.type !== "single")
      throw new Error('"answer.type" must be "single": one scene is right');
    const raw = Array.isArray(answer.options) ? answer.options : [];
    if (raw.length < 2 || raw.length > 4)
      throw new Error('"answer.options" must hold 2 to 4 scenes');
    const options = raw.map((o, i) => {
      const id = text(o?.id, 40);
      const label = text(o?.label, 48);
      if (!id) throw new Error(`"answer.options[${i}].id" is required`);
      if (!label) throw new Error(`"answer.options[${i}].label" is required`);
      return { ...o, id, label };
    });
    if (new Set(options.map((o) => o.id)).size !== options.length)
      throw new Error('"answer.options" ids must differ');
    if (!options.some((o) => o.id === answer.correct))
      throw new Error('"answer.correct" must name one of the options');
    const scenes = options.map((o, i) =>
      readScene(o, i, options.length, answer.correct),
    );
    return {
      key: JSON.stringify([
        question,
        options.map((o) => [o.id, o.label]),
        answer.correct,
      ]),
      question,
      points: Math.round(num(v.points, 10, 0, 1000)),
      showScore: v.showScore === true,
      scenes,
      edit: {
        scene: clamp(Number(v.edit?.scene ?? 0) || 0, 0, scenes.length - 1),
        preview: v.edit?.preview === "outcome" ? "outcome" : "still",
      },
    };
  },

  fields: sceneFields,
  world: scenesWorld,
  card: scenesCard,

  panel(_raw, el) {
    el.append(whyBox());
    return { dispose() {} };
  },
};
