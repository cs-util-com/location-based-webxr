// A quiz whose card unfolds into the world. The story card opens as usual. Then its answer rows
// lift out of the card and fly as flat tablets to stand in the space before the visitor, while
// the question stays on the card. After an answer they fold back in, and the right one carries
// the feedback home.
//
// The hand-over rests on one trick. Every tablet has ONE pose, in metres, computed each frame. The
// three.js tablet is drawn at that pose, and while any part of it is over the card a DOM copy of
// the answer row is drawn at the same pose by a matrix3d built from the same camera. The canvas
// lies under the card, so the DOM copy is what you see there; once the tablet has cleared the
// card's edge the copy fades and the canvas one, already underneath it, is left. Tile and tablet
// are painted from the same measurements, so nothing jumps.
import {
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";

const NAME = "card-unfolds";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here ---------- */
const BEAT_FIRST = 1.2; // seconds the rows sit in the card before they lift
const BEAT_AGAIN = 0.55; // the same, coming back to a waiting question
const OUT_TIME = 1.05;
const OUT_STAGGER = 0.11;
const HOME_TIME = 0.72;
const HOME_STAGGER = 0.08;
const PARK_TIME = 0.5;
const HOLD_ANSWER = 0.42; // the answer stands in the world this long before anything moves
const SHAKE_TIME = 0.36;
const SCREEN_DEPTH = 0.7; // metres from the eye of the plane a card row sits on
const TILT = 1.0; // radians the tablet swings back at the middle of its flight
const SWELL = 0.24; // how much nearer it seems at the middle of its flight
const LIFT = 0.1; // metres of arc
const BACK_ROW = 0.35; // metres the upper row stands behind the lower one
const FAR = 6.5; // walking further than this, the tablets come after the visitor
const NEAR = 0.9; // walking closer than this, they step back
const RESEAT_AFTER = 1.2; // seconds
const LOST_AFTER = 1.4; // seconds out of view before the card says where they are
const GHOST_MARGIN = 44; // CSS pixels: the DOM copy takes over this far before the card's edge
const GHOST_FADE = 0.1; // seconds

/* ---------- the atlas: one canvas for every tablet, in rows ---------- */
const ATLAS = 512; // logical pixels
const ATLAS_ROWS = 5; // up to four answers, then the soft shadow
const CELL = ATLAS / ATLAS_ROWS;
const PAD = 3;

const COLOURS = {
  plate: "rgb(12 16 21 / 86%)",
  sheen: "rgb(255 255 255 / 11%)",
  edge: "rgb(255 255 255 / 42%)",
  found: "#2dd4bf",
  foundInk: "#04201c",
  danger: "#f87171",
  dangerWash: "rgb(248 113 113 / 18%)",
  dangerInk: "#fecaca",
  wasInk: "#a7f3e6",
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const angDiff = (a, b) => {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

/* The tour's normalisation: Unicode NFC, case and white space folded. */
const normalise = (s) =>
  s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");

/* SHA-256 written out, so a typed answer can be judged at once and on a plain http address too,
   where crypto.subtle does not exist. */
function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const bits = bytes.length * 8;
  const size = (((bytes.length + 8) >> 6) + 1) * 64;
  const data = new Uint8Array(size);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(size - 4, bits >>> 0);
  const primes = [];
  for (let n = 2; primes.length < 64; n++)
    if (primes.every((p) => n % p)) primes.push(n);
  const frac = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
  const K = primes.map((p) => frac(Math.cbrt(p)));
  const H = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let at = 0; at < size; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => {
      H[i] = (H[i] + v) | 0;
    });
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

const typedIsRight = (typed, block) =>
  block.sha256.includes(sha256(block.salt + normalise(typed)));

function wrap(g, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGlyph(g, kind, x, y, s, colour) {
  g.save();
  g.translate(x, y);
  g.scale(s / 24, s / 24);
  g.strokeStyle = colour;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (kind === "check") {
    g.moveTo(5, 13);
    g.lineTo(10, 18);
    g.lineTo(19, 7);
  } else {
    g.moveTo(6, 6);
    g.lineTo(18, 18);
    g.moveTo(18, 6);
    g.lineTo(6, 18);
  }
  g.stroke();
  g.restore();
}

/* One answer row, in the card's CSS pixels, so tile and tablet come out the same. */
function drawRow(g, t) {
  const { tw: w, th: h, look } = t;
  const r = t.radius;
  const inset = t.edge / 2;
  const shape = () => {
    g.beginPath();
    g.roundRect(inset, inset, w - t.edge, h - t.edge, r - inset);
  };
  const right = look === "right";
  shape();
  g.fillStyle = right ? COLOURS.found : COLOURS.plate;
  g.fill();
  if (!right) {
    g.fillStyle =
      look === "wrong"
        ? COLOURS.dangerWash
        : look === "was"
          ? "rgb(0 0 0 / 0%)"
          : COLOURS.sheen;
    shape();
    g.fill();
  }
  shape();
  g.lineWidth = t.edge;
  g.strokeStyle =
    right || look === "was"
      ? COLOURS.found
      : look === "wrong"
        ? COLOURS.danger
        : COLOURS.edge;
  g.stroke();

  const ink = right
    ? COLOURS.foundInk
    : look === "wrong"
      ? COLOURS.dangerInk
      : look === "was"
        ? COLOURS.wasInk
        : "#fff";
  g.fillStyle = ink;
  g.textBaseline = "middle";
  if (t.typed) {
    g.save();
    g.beginPath();
    g.rect(t.padX, 0, w - t.padX * 2, h);
    g.clip();
    const empty = !t.text;
    g.font = empty ? t.hintFont : t.font;
    g.fillStyle = empty ? "#c6cdd5" : ink;
    g.textAlign = "left";
    g.fillText(empty ? t.hint : t.text, t.padX, h / 2 + 1);
    g.restore();
    return;
  }
  const glyph =
    look === "right" || look === "was"
      ? "check"
      : look === "wrong"
        ? "cross"
        : null;
  const glyphRoom = glyph ? 30 : 0;
  g.font = t.font;
  const lines = wrap(g, t.text, w - t.padX * 2 - glyphRoom - 3);
  const widest = lines.reduce((m, l) => Math.max(m, g.measureText(l).width), 0);
  const startX = (w - widest - glyphRoom) / 2;
  if (glyph) drawGlyph(g, glyph, startX, h / 2 - 11, 22, ink);
  const lh = t.px * 1.15;
  const top = h / 2 - ((lines.length - 1) * lh) / 2;
  const cx = startX + glyphRoom + widest / 2;
  g.textAlign = "center";
  lines.forEach((line, i) => {
    const y = top + i * lh + 1;
    g.fillText(line, cx, y);
    if (look === "wrong") {
      const half = g.measureText(line).width / 2;
      g.fillRect(cx - half, y - 1, half * 2, 2);
    }
  });
}

/* ---------- world and card share one deck; both receive the same block ---------- */
const decks = new WeakMap();
const memories = new WeakMap(); // env to Map(question to what was answered): a done quiz stays done
const memoryOf = (env) => {
  if (!memories.has(env)) memories.set(env, new Map());
  return memories.get(env);
};

function readBlock(v, tools) {
  const ask = tools.requiredText(v, "ask", { max: 200 });
  const format = v.format === "typed" ? "typed" : "choice";
  const right = clamp(Math.round(Number(v.right ?? 0)) || 0, 0, 3);
  const list = (Array.isArray(v.answers) ? v.answers : [])
    .map((a, i) => ({
      text: String(a?.text ?? "")
        .trim()
        .slice(0, 70),
      right: i === right,
    }))
    .filter((a) => a.text)
    .slice(0, 4);
  if (format === "choice" && list.length < 2)
    throw new Error("A quiz needs at least two answers");
  if (format === "choice" && !list.some((a) => a.right)) list[0].right = true;
  const says = v.says ?? {};
  const answered = v.answered;
  return {
    ask,
    format,
    answers: list,
    placeholder: String(v.placeholder ?? "Type the word").slice(0, 40),
    salt: String(v.salt ?? ""),
    sha256: Array.isArray(v.sha256) ? v.sha256.map(String) : [],
    retry: v.retry !== false,
    points: clamp(Math.round(Number(v.points ?? 10)) || 0, 0, 1000),
    showScore: v.showScore === true,
    says: {
      right: String(says.right ?? "That is right."),
      retry: String(says.retry ?? "Not quite. Have another look."),
      wrong: String(says.wrong ?? "Not this time."),
    },
    stand: { x: Number(v.stand?.x) || 0, z: Number(v.stand?.z) || 0 },
    reach: clamp(Number(v.reach) || 2.4, 1.8, 4),
    answered:
      answered && typeof answered === "object"
        ? {
            picked: Number(answered.picked ?? -1),
            crossed: Array.isArray(answered.crossed) ? answered.crossed : [],
            right: answered.right === true,
            earned: Number(answered.earned ?? 0),
            typed: String(answered.typed ?? ""),
          }
        : null,
  };
}

/* One list for both ways of answering: the stage draws the panel once, so a list that changed
   with the format would go stale the moment a creator switched it. */
function fieldsOf() {
  const ofAnswers = [
    ...[0, 1, 2, 3].map((i) => ({
      name: `answers.${i}.text`,
      label: `Tablet ${i + 1}${i >= 2 ? " (optional)" : ""}`,
      max: 70,
    })),
    {
      name: "right",
      label: "Which tablet is right",
      type: "choice",
      options: [0, 1, 2, 3].map((i) => [i, `Tablet ${i + 1}`]),
    },
    { name: "placeholder", label: "Typed: the hint in the field", max: 40 },
  ];
  return [
    { name: "ask", label: "Question", prose: true, max: 200 },
    {
      name: "format",
      label: "How it is answered",
      type: "choice",
      options: [
        ["choice", "Tap a tablet"],
        ["typed", "Type a word"],
      ],
    },
    ...ofAnswers,
    {
      name: "retry",
      label: "One more try after a wrong answer",
      type: "toggle",
    },
    { name: "says.right", label: "The guide, when right", prose: true },
    { name: "says.retry", label: "The guide, one more try", prose: true },
    { name: "says.wrong", label: "The guide, when wrong", prose: true },
    {
      name: "points",
      label: "Points",
      type: "number",
      min: 0,
      max: 1000,
      step: 1,
    },
    { name: "showScore", label: "Show the points", type: "toggle" },
    { name: "stand", label: "Tablets", type: "place" },
    {
      name: "reach",
      label: "Metres before a visitor, when the spot is out of view",
      type: "range",
      min: 1.8,
      max: 4,
      step: 0.1,
    },
  ];
}

/* ---------- the deck: tablets, poses, flights ---------- */
const newPose = () => ({
  pos: new Vector3(),
  q: new Quaternion(),
  sx: 1,
  sy: 1,
});
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
let lastDeck = null;

function makeDeck(block, env) {
  const typed = block.format === "typed";
  const items = typed ? [{ text: "", right: true }] : block.answers;
  const long = items.some((a) => a.text.length > 12);
  const object = new Group();

  /* The rows as the card would measure them; the card replaces these with the real numbers. */
  const tablets = items.map((item, i) => {
    const px = typed ? 21 : long ? 16 : 22;
    const tw = typed ? 262 : 175;
    const lines = Math.ceil((item.text.length * px * 0.52) / (tw - 26)) || 1;
    return {
      i,
      item,
      typed,
      text: item.text,
      hint: block.placeholder,
      look: "plain",
      tw,
      th: Math.max(long ? 60 : 64, lines * px * 1.15 + 18),
      dx: typed ? 0 : ((i % 2) - 0.5) * 183,
      dy: typed ? 0 : (Math.floor(i / 2) - 0.5) * 72,
      px,
      font: `${typed || long ? 600 : 700} ${px}px ${FONT}`,
      hintFont: `500 17px ${FONT}`,
      radius: 14,
      edge: 1.5,
      padX: typed ? 15.5 : 11.5,
      state: "card", // card | fly | stand
      flight: null, // out | home | dock | park | seat
      start: 0,
      dur: 1,
      fromScreen: false,
      rect0: { l: 0, t: 0, w: 1, h: 1 },
      rect: { l: 0, t: 0, w: 1, h: 1 },
      from: newPose(),
      now: newPose(),
      stand: new Vector3(),
      w: 0.7,
      h: 0.25,
      yaw: 0,
      seededYaw: false,
      popAt: -9,
      shakeAt: -9,
      ghost: 0,
      ghostShown: false,
      landThen: null,
      mesh: null,
      material: null,
      blob: null,
      hit: null,
    };
  });

  const drawAtlas = (g, w, h) => {
    const rowH = h / ATLAS_ROWS;
    for (const t of tablets) {
      g.save();
      g.translate(PAD, t.i * rowH + PAD);
      g.scale((w - PAD * 2) / t.tw, (rowH - PAD * 2) / t.th);
      drawRow(g, t);
      g.restore();
    }
    // the soft shadow a standing tablet throws, in the last row
    g.save();
    g.translate(w / 2, h - rowH / 2);
    g.scale(w / 2 - PAD, rowH / 2 - PAD);
    const soft = g.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    soft.addColorStop(0, "rgb(0 0 0 / 55%)");
    soft.addColorStop(1, "rgb(0 0 0 / 0%)");
    g.fillStyle = soft;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  };
  const texture = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw: drawAtlas,
  });
  texture.premultiplyAlpha = true;

  const uvRow = (geo, row) => {
    const uv = geo.attributes.uv;
    const u0 = PAD / ATLAS;
    const u1 = 1 - u0;
    const v1 = 1 - (row * CELL + PAD) / ATLAS;
    const v0 = 1 - ((row + 1) * CELL - PAD) / ATLAS;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    return geo;
  };

  const blobGeo = uvRow(new PlaneGeometry(1, 1), ATLAS_ROWS - 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const silent = () => {};

  for (const t of tablets) {
    const geo = uvRow(new PlaneGeometry(1, 1), t.i);
    // Above the place, as in AR, where no real wall hides a virtual thing.
    t.material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: DoubleSide,
      forceSinglePass: true, // one draw, not two: a flat tablet has nothing behind itself
    });
    t.mesh = new Mesh(geo, t.material);
    t.mesh.name = `answer-${t.i}`;
    t.mesh.matrixAutoUpdate = false;
    t.mesh.frustumCulled = false;
    t.mesh.renderOrder = 20 + t.i;
    t.mesh.visible = false;
    t.hit = env.hitArea({ radius: 0.3, name: t.mesh.name });
    t.mesh.add(t.hit);
    t.blob = new Mesh(blobGeo, blobMat);
    t.blob.renderOrder = 10;
    t.blob.visible = false;
    t.blob.raycast = silent;
    object.add(t.mesh, t.blob);
  }

  /* ---------- the state of the quiz ---------- */
  const memory = memoryOf(env);
  const prior =
    env.mode === "play"
      ? (block.answered ?? memory.get(block.ask) ?? null)
      : null;
  const crossed = new Set(prior?.crossed ?? []);
  let bridge = null; // the card, once it is open
  let clock = 0;
  let dt = 0;
  let phase = "card"; // card | out
  let over = prior !== null;
  let busy = false;
  let tries = 0;
  let wantOut = true;
  let shown = false;
  let outside = false;
  let measured = false;
  let outAt = null;
  let liftedOnce = false;
  let dirty = false;
  let farSince = -1;
  let lostSince = -1;
  let whereNow = null;
  let hookMs = 0;
  let hookMax = 0; // the slowest frame, an atlas repaint included
  let seated = false;
  const queue = [];
  const after = (delay, fn) => queue.push({ at: clock + delay, fn });

  /* ---------- scratch: the frame loop allocates nothing here ---------- */
  const view = { w: 1, h: 1 };
  const camPos = new Vector3();
  const camQ = new Quaternion();
  const camQInv = new Quaternion();
  const camUp = new Vector3();
  const unitScale = new Vector3(1, 1, 1);
  const projection = new Matrix4();
  const viewProj = new Matrix4(); // the kind's metres to clip space, depth left out
  let tanH = 0.5;
  let tanV = 0.5;
  const v1 = new Vector3();
  const v2 = new Vector3();
  const scaleV = new Vector3();
  const tiltQ = new Quaternion();
  const poseA = newPose();
  const poseB = newPose();
  const centre = new Vector3();
  const m1 = new Matrix4();
  const m2 = new Matrix4();
  const toCss = new Matrix4();
  const parkRect = { l: 0, t: 0, w: 80, h: 30 };

  const screenPose = (r, out) => {
    const nx = ((r.l + r.w / 2) / view.w) * 2 - 1;
    const ny = 1 - ((r.t + r.h / 2) / view.h) * 2;
    out.pos
      .set(nx * tanH * SCREEN_DEPTH, ny * tanV * SCREEN_DEPTH, -SCREEN_DEPTH)
      .applyQuaternion(camQ)
      .add(camPos);
    out.q.copy(camQ);
    out.sx = (r.w / view.w) * 2 * tanH * SCREEN_DEPTH;
    out.sy = (r.h / view.h) * 2 * tanV * SCREEN_DEPTH;
  };

  const standPose = (t, out) => {
    const want = Math.atan2(camPos.x - t.stand.x, camPos.z - t.stand.z);
    if (!t.seededYaw || dt === 0) {
      t.yaw = want;
      t.seededYaw = true;
    } else t.yaw += angDiff(t.yaw, want) * (1 - Math.exp(-dt / 0.4));
    out.pos.copy(t.stand);
    out.pos.y += Math.sin(clock * 0.9 + t.i * 1.7) * 0.012;
    out.q.setFromAxisAngle(Y_AXIS, t.yaw);
    out.sx = t.w;
    out.sy = t.h;
    const pop = (clock - t.popAt) / 0.32;
    if (pop >= 0 && pop < 1) {
      const k = 1 + 0.09 * Math.sin(Math.PI * pop);
      out.sx *= k;
      out.sy *= k;
    }
    const shake = (clock - t.shakeAt) / SHAKE_TIME;
    if (shake >= 0 && shake < 1) {
      const push = Math.sin(shake * 18) * 0.04 * (1 - shake);
      out.pos.x += Math.cos(t.yaw) * push;
      out.pos.z -= Math.sin(t.yaw) * push;
    }
  };

  /* Where the tablets go: the placed spot when it is in view and near enough, otherwise straight
     into the free part of the view at a fixed reach. So a spot that is a few metres off cannot
     put the tablets behind the visitor. */
  function arrange(eyeDistance, y) {
    const ppm = view.h / (2 * tanV * eyeDistance);
    let top = Infinity;
    let bottom = -Infinity;
    for (const t of tablets) {
      top = Math.min(top, t.dy);
      bottom = Math.max(bottom, t.dy);
    }
    const dirX = camPos.x - centre.x;
    const dirZ = camPos.z - centre.z;
    const flat = Math.hypot(dirX, dirZ) || 1;
    const fx = dirX / flat;
    const fz = dirZ / flat;
    let low = Infinity;
    for (const t of tablets) {
      t.w = Math.min(2.4, t.tw / ppm);
      t.h = t.w * (t.th / t.tw);
      const ox = (t.dx / ppm) * 1.06;
      const oy = (-t.dy / ppm) * 1.3;
      const back =
        bottom > top ? ((bottom - t.dy) / (bottom - top)) * BACK_ROW : 0;
      t.stand.set(
        centre.x + fz * ox - fx * back,
        y + oy,
        centre.z - fx * ox - fz * back,
      );
      low = Math.min(low, t.stand.y - t.h / 2);
      // The hit reaches the tablet's ends: a wide tablet answers a tap near its edge too. Where two
      // overlap the stage takes the nearer centre, so neighbours stay apart.
      t.hit.scale.setScalar(Math.max(0.2, Math.max(t.w, t.h) / 2));
    }
    if (low < 0.3) for (const t of tablets) t.stand.y += 0.3 - low;
  }

  function seat() {
    const s = bridge.sheet();
    let fx0 = 0;
    const fx1 = view.w;
    let fy1 = view.h * 0.6;
    if (s.right > 0) {
      if (s.left <= 20 && s.right < view.w * 0.6) {
        fx0 = s.right;
        fy1 = view.h;
      } else fy1 = s.top + bridge.shrink();
    }
    const sx = (fx0 + fx1) / 2;
    const sy = (64 + fy1) / 2;
    v1.set(((sx / view.w) * 2 - 1) * tanH, (1 - (sy / view.h) * 2) * tanV, -1);
    v1.applyQuaternion(camQ);
    const flat = Math.hypot(v1.x, v1.z) || 1;

    // The group keeps the rows' size on screen at any distance, so it is as wide as the rows
    // were in the card: the spot counts only when that whole group fits the free part of the view.
    let wide = 0;
    let tall = 0;
    for (const t of tablets) {
      wide = Math.max(wide, (Math.abs(t.dx) + t.tw / 2) * 1.06);
      tall = Math.max(tall, (Math.abs(t.dy) + t.th / 2) * 1.3);
    }
    v2.set(block.stand.x, 1.4, block.stand.z)
      .sub(camPos)
      .applyQuaternion(camQInv);
    const spotAway = Math.hypot(
      block.stand.x - camPos.x,
      block.stand.z - camPos.z,
    );
    const spotX = (v2.x / -v2.z / tanH + 1) * 0.5 * view.w;
    const spotY = (1 - v2.y / -v2.z / tanV) * 0.5 * view.h;
    const spotSeen =
      v2.z < 0 &&
      spotX - wide >= fx0 - 8 &&
      spotX + wide <= fx1 + 8 &&
      spotY - tall >= 56 &&
      spotY + tall <= fy1 &&
      spotAway >= 1.6 &&
      spotAway <= 7;

    const dist = spotSeen ? spotAway : block.reach;
    if (spotSeen) centre.set(block.stand.x, 0, block.stand.z);
    else
      centre.set(
        camPos.x + (v1.x / flat) * dist,
        0,
        camPos.z + (v1.z / flat) * dist,
      );
    centre.y = clamp(camPos.y + (v1.y / flat) * dist, 0.95, 2.2);
    arrange(dist, centre.y);
  }

  function fly(t, flight, delay, dur) {
    t.from.pos.copy(t.now.pos);
    t.from.q.copy(t.now.q);
    t.from.sx = t.now.sx;
    t.from.sy = t.now.sy;
    t.fromScreen = false;
    t.flight = flight;
    t.state = "fly";
    t.start = clock + delay;
    t.dur = dur;
  }

  function land(t) {
    const flight = t.flight;
    t.flight = null;
    if (flight === "out" || flight === "seat") {
      t.state = "stand";
    } else {
      t.state = "card";
      t.mesh.visible = false;
      t.blob.visible = false;
      t.ghost = 0;
      t.ghostShown = false;
      if (flight === "park") bridge?.ghost(t.i, null, 0);
      else bridge?.landed(t.i, flight, t.look);
    }
    const then = t.landThen;
    t.landThen = null;
    then?.();
  }

  /* The one pose of a tablet this frame. Both the mesh and its DOM copy are drawn from it.
     Returns how much it stands on the ground, 0 to 1, or -1 once it has landed. */
  function evaluate(t) {
    const now = t.now;
    if (!t.flight) {
      standPose(t, now);
      return 1;
    }
    // Reduced motion: every flight lands at once, so the rows simply change places.
    const raw =
      deck.calm || t.dur <= 0 ? 1 : clamp((clock - t.start) / t.dur, 0, 1);
    const e = ease(raw);
    if (t.fromScreen) screenPose(t.rect0, poseA);
    else {
      poseA.pos.copy(t.from.pos);
      poseA.q.copy(t.from.q);
      poseA.sx = t.from.sx;
      poseA.sy = t.from.sy;
    }
    if (t.flight === "out" || t.flight === "seat") standPose(t, poseB);
    else if (t.flight === "park" || !bridge?.dockRect(t.i, t.flight, t.rect)) {
      parkRect.l = (bridge ? bridge.parkX() : view.w / 2) - 40;
      parkRect.t = view.h - 36;
      screenPose(parkRect, poseB);
    } else screenPose(t.rect, poseB);
    now.pos.lerpVectors(poseA.pos, poseB.pos, e);
    now.q.slerpQuaternions(poseA.q, poseB.q, e);
    now.sx = poseA.sx + (poseB.sx - poseA.sx) * e;
    now.sy = poseA.sy + (poseB.sy - poseA.sy) * e;
    if (t.flight !== "seat" && t.flight !== "park") {
      const k = Math.sin(Math.PI * e);
      now.pos.addScaledVector(camUp, k * LIFT);
      now.sx *= 1 + SWELL * k;
      now.sy *= 1 + SWELL * k;
      tiltQ.setFromAxisAngle(X_AXIS, -TILT * k);
      now.q.multiply(tiltQ);
    }
    if (raw >= 1) {
      place(t, t.flight === "out" || t.flight === "seat" ? 1 : 0);
      ghostOf(t);
      land(t);
      return -1;
    }
    return t.flight === "out" ? e : t.flight === "seat" ? 1 : 1 - e;
  }

  function place(t, grounded) {
    const now = t.now;
    scaleV.set(now.sx, now.sy, 1);
    t.mesh.matrix.compose(now.pos, now.q, scaleV);
    t.mesh.updateMatrixWorld(true);
    if (grounded > 0.02) {
      t.blob.visible = true;
      t.blob.position.set(now.pos.x, 0.02, now.pos.z);
      const k = grounded * grounded;
      t.blob.scale.set(t.w * 1.2 * k, 1, t.w * 0.6 * k);
      t.blob.rotation.y = t.yaw;
      t.blob.updateMatrixWorld(true);
    } else t.blob.visible = false;
  }

  /* The DOM copy of a row, at the tablet's own pose: the same camera, the same matrix. */
  function ghostOf(t) {
    if (!bridge) return;
    if (t.flight !== "out" && t.flight !== "home" && t.flight !== "dock") {
      if (t.ghostShown) {
        t.ghostShown = false;
        t.ghost = 0;
        bridge.ghost(t.i, null, 0);
      }
      return;
    }
    const s = bridge.sheet();
    if (s.right <= 0) return;
    const tw = t.tw;
    const th = t.th;
    m1.multiplyMatrices(viewProj, t.mesh.matrix);
    m2.set(1 / tw, 0, 0, -0.5, 0, -1 / th, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1);
    m1.multiply(m2);
    toCss.set(
      view.w / 2,
      0,
      0,
      view.w / 2 - s.left,
      0,
      -view.h / 2,
      0,
      view.h / 2 - s.top,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
    );
    m1.premultiply(toCss);
    const e = m1.elements;
    // The element is flat at z = 0, and a CSS matrix must stay invertible.
    e[2] = 0;
    e[6] = 0;
    e[10] = 1;
    e[14] = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let behind = false;
    for (let c = 0; c < 4; c++) {
      const x = c & 1 ? tw : 0;
      const y = c & 2 ? th : 0;
      const w = e[3] * x + e[7] * y + e[15];
      if (w <= 0.001) {
        behind = true;
        break;
      }
      const px = (e[0] * x + e[4] * y + e[12]) / w;
      const py = (e[1] * x + e[5] * y + e[13]) / w;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const onCard =
      !behind &&
      maxX > -GHOST_MARGIN &&
      minX < s.right - s.left + GHOST_MARGIN &&
      maxY > -GHOST_MARGIN &&
      minY < s.bottom - s.top + GHOST_MARGIN;
    const step = dt / GHOST_FADE;
    t.ghost = onCard
      ? Math.min(1, t.ghost + step)
      : Math.max(0, t.ghost - step);
    if (t.ghost > 0) {
      t.ghostShown = true;
      bridge.ghost(t.i, e, t.ghost);
    } else if (t.ghostShown) {
      t.ghostShown = false;
      bridge.ghost(t.i, null, 0);
    }
  }

  function liftOff() {
    outAt = null;
    if (!bridge.measure()) {
      outAt = clock + 0.3;
      return;
    }
    if (dirty) {
      dirty = false;
      texture.repaint();
    }
    seat();
    phase = "out";
    liftedOnce = true;
    lostSince = -1;
    farSince = -1;
    // The rows rise first, leaving their holes; only then does the card close up, so a row
    // never sits over the question on its way out.
    after(0.42, () => {
      if (phase === "out") bridge?.setOut(true);
    });
    let order = 0;
    for (const t of tablets) {
      if (crossed.has(t.i)) continue;
      screenPose(t.rect0, t.now);
      t.mesh.visible = true;
      t.seededYaw = false;
      t.fromScreen = true;
      t.flight = "out";
      t.state = "fly";
      t.start = clock + 0.14 + order * OUT_STAGGER;
      t.dur = OUT_TIME;
      t.ghost = 1;
      t.ghostShown = true;
      order += 1;
    }
    bridge.hideRows();
  }

  const inPlay = (t) => t.state !== "card";
  const flying = () => tablets.some((t) => t.flight !== null);

  /* Every row goes home; `last` goes last, carrying the answer. */
  function foldAll(last, then) {
    outAt = null;
    phase = "card";
    bridge?.setOut(false);
    const going = tablets.filter((t) => inPlay(t) && t !== last);
    going.forEach((t, i) => fly(t, "home", i * HOME_STAGGER, HOME_TIME * 0.85));
    if (last && inPlay(last)) {
      fly(last, "home", going.length * HOME_STAGGER + 0.12, HOME_TIME);
      last.landThen = then;
    } else if (going.length) {
      going[going.length - 1].landThen = then;
    } else then();
  }

  function park() {
    outAt = null;
    const wasOut = phase === "out" || flying();
    phase = "card";
    if (!wasOut) return;
    bridge?.setOut(false, true);
    bridge?.showRows();
    tablets.filter(inPlay).forEach((t, i) => {
      const then = t.landThen;
      fly(t, "park", i * 0.05, PARK_TIME);
      t.landThen = then;
    });
  }

  const armLift = (beat) => {
    if (over || busy || !bridge || !wantOut || outside || !shown) return;
    if (phase === "card") outAt = clock + beat;
  };

  /* ---------- answering: the same rules for a tablet and for a row in the card ---------- */
  const setLook = (t, look) => {
    t.look = look;
    t.material.opacity = look === "dim" ? 0.42 : 1;
    dirty = true;
    bridge?.look(t.i, look, t.state === "card");
  };
  const pointsNow = () =>
    tries === 0 ? block.points : Math.floor(block.points / 2);

  function conclude(right, picked, typedText) {
    const earned = right ? pointsNow() : 0;
    memory.set(block.ask, {
      picked,
      crossed: [...crossed],
      right,
      earned,
      typed: typedText ?? "",
    });
    busy = false;
    bridge?.conclude(right, earned);
  }

  function answerChoice(i) {
    if (over || busy || crossed.has(i)) return;
    const t = tablets[i];
    const standing = t.state === "stand";
    const right = t.item.right;
    env.sound(right ? "right" : "wrong").play();
    outAt = null;
    if (right) {
      over = true;
      busy = true;
      setLook(t, "right");
      for (const o of tablets)
        if (o !== t && !crossed.has(o.i)) setLook(o, "dim");
      if (standing) {
        t.popAt = clock;
        after(HOLD_ANSWER, () => foldAll(t, () => conclude(true, i)));
      } else conclude(true, i);
      return;
    }
    crossed.add(i);
    setLook(t, "wrong");
    if (standing) t.shakeAt = clock;
    if (block.retry && tries === 0) {
      tries = 1;
      if (standing) {
        busy = true;
        after(SHAKE_TIME, () => {
          fly(t, "dock", 0, HOME_TIME);
          t.landThen = () => {
            busy = false;
            bridge?.retry();
          };
        });
      } else {
        bridge?.retry();
      }
      return;
    }
    tries += 1;
    over = true;
    busy = true;
    const truth = tablets.find((o) => o.item.right);
    for (const o of tablets) {
      if (o === truth) setLook(o, "was");
      else if (!crossed.has(o.i)) setLook(o, "dim");
    }
    if (phase === "out" || flying())
      after(HOLD_ANSWER, () => foldAll(truth, () => conclude(false, i)));
    else conclude(false, i);
  }

  function answerTyped(text) {
    if (over || busy || !text.trim()) return;
    const t = tablets[0];
    const standing = t.state === "stand";
    const right = typedIsRight(text, block);
    env.sound(right ? "right" : "wrong").play();
    outAt = null;
    const finalWrong = !right && !(block.retry && tries === 0);
    setLook(t, right ? "right" : "wrong");
    if (right || finalWrong) {
      if (finalWrong) tries += 1;
      over = true;
      busy = true;
      if (standing) {
        if (right) t.popAt = clock;
        else t.shakeAt = clock;
        after(HOLD_ANSWER, () =>
          foldAll(t, () => conclude(right, right ? 0 : -1, text)),
        );
      } else conclude(right, right ? 0 : -1, text);
      return;
    }
    tries = 1;
    if (standing) t.shakeAt = clock;
    bridge?.retry();
  }

  /* ---------- the frame ---------- */
  function watchGroup() {
    if (phase !== "out" || busy) return;
    const away = Math.hypot(centre.x - camPos.x, centre.z - camPos.z);
    if (away > FAR || away < NEAR) {
      if (farSince < 0) farSince = clock;
      else if (clock - farSince > RESEAT_AFTER) {
        farSince = -1;
        seat();
        let n = 0;
        for (const t of tablets)
          if (t.state === "stand") fly(t, "seat", n++ * 0.07, 0.95);
      }
    } else farSince = -1;

    v1.copy(centre).sub(camPos).applyQuaternion(camQInv);
    const seen =
      v1.z < 0 &&
      Math.abs(v1.x / -v1.z) < tanH * 1.05 &&
      Math.abs(v1.y / -v1.z) < tanV * 1.05;
    if (seen) {
      lostSince = -1;
      if (whereNow !== null) {
        whereNow = null;
        bridge?.where(null);
      }
      return;
    }
    if (lostSince < 0) lostSince = clock;
    if (clock - lostSince < LOST_AFTER) return;
    const angle = Math.atan2(v1.x, -v1.z);
    const word =
      Math.abs(angle) > 2.3
        ? "behind"
        : Math.abs(angle) < 0.45
          ? v1.y > 0
            ? "up"
            : "down"
          : angle < 0
            ? "left"
            : "right";
    if (word !== whereNow) {
      whereNow = word;
      bridge?.where(word);
    }
  }

  function advance() {
    for (let i = 0; i < queue.length;) {
      if (queue[i].at <= clock) {
        const { fn } = queue[i];
        queue.splice(i, 1);
        fn();
      } else i += 1;
    }
    if (outAt !== null && clock >= outAt && phase === "card" && !flying())
      liftOff();
    if (dirty) {
      dirty = false;
      texture.repaint();
    }
    for (const t of tablets) {
      if (t.state === "card") continue;
      const grounded = evaluate(t);
      if (grounded < 0) continue; // it landed, and was placed on the way
      place(t, grounded);
      ghostOf(t);
    }
    watchGroup();
  }

  function restInEdit() {
    if (!seated) {
      seated = true;
      const truth = tablets.find((t) => t.item.right);
      if (!typed && truth) {
        truth.look = "was";
        texture.repaint();
      }
    }
    centre.set(block.stand.x, 1.5, block.stand.z);
    arrange(block.reach, 1.5);
    for (const t of tablets) {
      t.mesh.visible = true;
      standPose(t, t.now);
      place(t, 1);
    }
  }

  /* The eye as the stage hands it over, in the kind's metres. The update runs after the stage
     has moved the camera and before it draws, so a tablet held to the screen never trails the
     view by a frame. */
  function readEye(eye) {
    view.w = eye.width || 1;
    view.h = eye.height || 1;
    camPos.copy(eye.position);
    camQ.copy(eye.quaternion);
    camQInv.copy(camQ).invert();
    camUp.copy(Y_AXIS).applyQuaternion(camQ);
    tanH = eye.tanH;
    tanV = eye.tanV;
    // Only x, y and w of a projected point are read (ghostOf), so depth needs no near or far.
    projection.set(
      1 / tanH, 0, 0, 0,
      0, 1 / tanV, 0, 0,
      0, 0, -1, 0,
      0, 0, -1, 0,
    );
    viewProj.compose(camPos, camQ, unitScale).invert().premultiply(projection);
  }

  const deck = {
    block,
    tablets,
    prior,
    crossed,
    typed,
    answerChoice,
    answerTyped,
    isOver: () => over,
    isOut: () => phase === "out",
    attach(card) {
      bridge = card;
    },
    detach() {
      bridge = null;
    },
    /* The card says whether it can be seen at all: folded by hand, by walking off, or gone. */
    cardShown(on) {
      if (on === shown) return;
      shown = on;
      if (!on) {
        park();
        return;
      }
      if (!measured && bridge?.measure()) {
        measured = true;
        dirty = true;
      }
      armLift(liftedOnce ? BEAT_AGAIN : BEAT_FIRST);
    },
    recall() {
      if (phase !== "out" || busy) return;
      wantOut = false;
      foldAll(null, () => bridge?.recalled());
    },
    sendOut() {
      if (over || busy || phase === "out") return;
      wantOut = true;
      armLift(0.05);
    },
    typedText(text) {
      const t = tablets[0];
      t.text = text;
      if (t.look === "wrong") setLook(t, "plain");
      dirty = true;
    },
    resized() {
      dirty = true;
    },
    peek: () => ({
      phase,
      over,
      busy,
      tries,
      outAt,
      where: whereNow,
      hookMs,
      hookMax,
      clock,
      camera: { x: camPos.x, y: camPos.y, z: camPos.z },
      centre: { x: centre.x, y: centre.y, z: centre.z },
      tablets: tablets.map((t) => ({
        state: t.state,
        flight: t.flight,
        look: t.look,
        w: t.w,
        h: t.h,
        x: t.now.pos.x,
        y: t.now.pos.y,
        z: t.now.pos.z,
        ghost: t.ghost,
        progress: t.flight ? clamp((clock - t.start) / t.dur, 0, 1) : 1,
      })),
    }),
  };

  const part = {
    object,
    update(frame) {
      // The sum of frame.dt is frame.time; kind.speed only slows it for screenshots.
      clock += frame.dt * kind.speed;
      dt = frame.dt;
      const t0 = performance.now();
      readEye(frame.eye);
      if (env.mode === "edit") restInEdit();
      else advance();
      const spent = performance.now() - t0;
      hookMs += (spent - hookMs) * 0.1;
      hookMax = Math.max(hookMax, spent);
    },
    tap(hit) {
      const m = /^answer-(\d)$/.exec(hit.name);
      if (!m) return;
      const t = tablets[Number(m[1])];
      if (!t || t.state !== "stand") return;
      if (typed) bridge?.focusField();
      else answerChoice(t.i);
    },
    leave() {
      outside = true;
      park();
    },
    back() {
      outside = false;
      armLift(BEAT_AGAIN);
    },
    dispose() {
      for (const t of tablets) {
        t.mesh.geometry.dispose();
        t.material.dispose();
      }
      blobGeo.dispose();
      blobMat.dispose();
      texture.dispose();
      queue.length = 0;
      bridge = null;
      if (lastDeck === deck) lastDeck = null;
    },
  };
  lastDeck = deck;
  decks.set(block, deck);
  return part;
}

/* ---------- the card: DOM inside el only ---------- */
const SCOPE = `[data-kind="${NAME}"]`;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 13l5 5 9-11"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const CARD_CSS = `
${SCOPE} .cu-well { transition: height 0.42s cubic-bezier(0.3, 0.8, 0.3, 1); }
${SCOPE} .cu-well.moving { overflow: hidden; }
${SCOPE} .a .g { flex: none; width: 22px; height: 22px; display: none; }
${SCOPE} .a.right .g, ${SCOPE} .a.wrong .g, ${SCOPE} .a.was .g { display: block; }
${SCOPE} .a .g svg, ${SCOPE} .cu-slots svg {
  display: block; width: 100%; height: 100%; fill: none; stroke: currentcolor;
  stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;
}
${SCOPE} .a.gone { visibility: hidden; }

/* what stays in the card while the rows are out */
${SCOPE} .cu-tray {
  display: flex; align-items: center; gap: 8px; height: 0; overflow: hidden; opacity: 0;
  transition: height 0.42s cubic-bezier(0.3, 0.8, 0.3, 1), opacity 0.3s;
}
${SCOPE} .cu[data-phase="out"] .cu-tray { height: 56px; opacity: 1; }
${SCOPE} .cu-slots { flex: 1; min-width: 0; display: flex; gap: 5px; }
${SCOPE} .cu-slots i {
  flex: 1; max-width: 40px; height: 30px; padding: 5px; display: block;
  border: 1.5px dashed rgb(255 255 255 / 34%); border-radius: 8px; color: var(--walk-danger);
}
${SCOPE} .cu-slots i.x { border: 1.5px solid var(--walk-danger); background: rgb(248 113 113 / 18%); }
${SCOPE} .cu-call { flex: none; max-width: 70%; }
${SCOPE} .cu-call.far { border-color: var(--walk-accent); color: #ffd391; }
${SCOPE} .cu-send { display: block; margin-top: 8px; }
${SCOPE} .cu-note { margin-top: 8px; }
${SCOPE} .cu-under { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

/* the row as it leaves: inside the card's own element, drawn at the tablet's pose */
${SCOPE} .cu-layer { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
${SCOPE} .cu-layer .ghost {
  position: absolute; left: 0; top: 0; margin: 0; min-height: 0; flex: none;
  transform-origin: 0 0; will-change: transform, opacity; visibility: hidden;
  animation: none; transition: none; box-shadow: 0 10px 26px rgb(0 0 0 / 28%);
}
${SCOPE} .cu-layer .a.ghost:not(.right) {
  background: linear-gradient(rgb(255 255 255 / 11%), rgb(255 255 255 / 11%)), rgb(12 16 21 / 86%);
}
${SCOPE} .cu-layer .a.ghost.was { background: rgb(12 16 21 / 86%); }
${SCOPE} .cu-layer .a.ghost.wrong {
  background: linear-gradient(rgb(248 113 113 / 18%), rgb(248 113 113 / 18%)), rgb(12 16 21 / 86%);
}
${SCOPE} .cu-layer .a.ghost.dim { opacity: 1; }
${SCOPE} .cu-layer .field.ghost {
  display: flex; align-items: center; white-space: nowrap; overflow: hidden;
  background: linear-gradient(rgb(255 255 255 / 11%), rgb(255 255 255 / 11%)), rgb(12 16 21 / 86%);
}
${SCOPE} .cu-layer .field.ghost.right { background: var(--walk-found); }
${SCOPE} .cu-layer .field.ghost[data-empty] { color: #c6cdd5; font-weight: 500; font-size: 17px; }

/* a quiz already done reads as done, as a whole */
${SCOPE} .cu.greyed .answers, ${SCOPE} .cu.greyed .typed { filter: grayscale(1); opacity: 0.62; pointer-events: none; }
${SCOPE} .cu.greyed .a.right { animation: none; background: rgb(255 255 255 / 20%); border-color: rgb(255 255 255 / 60%); color: #fff; }
${SCOPE} .cu.greyed .a.wrong, ${SCOPE} .cu.greyed .field { animation: none; }
@media (orientation: landscape) and (max-height: 520px) {
  ${SCOPE} .cu[data-phase="out"] .cu-tray { height: 52px; }
}
`;

const WHERE = {
  left: "To your left - bring them",
  right: "To your right - bring them",
  behind: "Behind you - bring them",
  up: "Look up - or bring them",
  down: "Look down - or bring them",
};
const ANSWER_HERE = "Answer here";

function openCard(block, el, env) {
  const deck = decks.get(block);
  if (!deck) return { dispose() {} };
  const { tablets, typed, prior, crossed } = deck;
  const style = document.createElement("style");
  style.textContent = CARD_CSS;

  const root = document.createElement("div");
  root.className = "cu";
  root.dataset.phase = "card";
  const echo = document.createElement("p");
  echo.className = "echo";
  echo.hidden = true;
  const well = document.createElement("div");
  well.className = "cu-well";
  const layer = document.createElement("div");
  layer.className = "cu-layer";
  layer.setAttribute("aria-hidden", "true");

  const rows = [];
  const ghosts = [];
  let input = null;
  let check = null;
  if (typed) {
    const box = document.createElement("div");
    box.className = "typed";
    input = document.createElement("input");
    input.className = "field";
    Object.assign(input, {
      type: "text",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: false,
      enterKeyHint: "done",
      placeholder: block.placeholder,
    });
    input.setAttribute("aria-label", "Your answer");
    check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.textContent = "Check";
    check.disabled = true;
    box.append(input, check);
    well.append(box);
    rows.push(input);
    const ghost = document.createElement("div");
    ghost.className = "field ghost";
    ghost.textContent = block.placeholder;
    ghost.dataset.empty = "";
    ghosts.push(ghost);
    layer.append(ghost);
    const send = () => {
      const text = input.value;
      if (!text.trim()) return;
      input.blur();
      deck.answerTyped(text);
    };
    check.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener("input", () => {
      input.classList.remove("wrong");
      check.disabled = !input.value.trim();
      ghost.textContent = input.value || block.placeholder;
      if (input.value) delete ghost.dataset.empty;
      else ghost.dataset.empty = "";
      deck.typedText(input.value);
    });
  } else {
    const grid = document.createElement("div");
    grid.className = "answers";
    if (block.answers.some((a) => a.text.length > 12))
      grid.classList.add("small");
    block.answers.forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "a";
      b.innerHTML = '<span class="g"></span><span class="t"></span>';
      b.querySelector(".t").textContent = a.text;
      b.addEventListener("click", () => deck.answerChoice(i));
      grid.append(b);
      rows.push(b);
      const ghost = b.cloneNode(true);
      ghost.classList.add("ghost");
      ghost.tabIndex = -1;
      ghosts.push(ghost);
      layer.append(ghost);
    });
    well.append(grid);
  }

  /* While the rows are out: an empty socket for each, and the way to answer without them. */
  const tray = document.createElement("div");
  tray.className = "cu-tray";
  const slots = document.createElement("span");
  slots.className = "cu-slots";
  slots.setAttribute("aria-hidden", "true");
  const slotList = tablets.map((t) => {
    const s = document.createElement("i");
    if (crossed.has(t.i)) {
      s.className = "x";
      s.innerHTML = CROSS;
    }
    slots.append(s);
    return s;
  });
  const call = document.createElement("button");
  call.type = "button";
  call.className = "btn cu-call";
  call.textContent = ANSWER_HERE;
  call.addEventListener("click", () => deck.recall());
  tray.append(slots, call);

  const under = document.createElement("div");
  under.className = "cu-under";
  const sendBack = document.createElement("button");
  sendBack.type = "button";
  sendBack.className = "btn cu-send";
  sendBack.textContent = "Send them out again";
  sendBack.hidden = true;
  sendBack.addEventListener("click", () => {
    sendBack.hidden = true;
    deck.sendOut();
  });
  under.append(sendBack);

  root.append(echo, well);
  if (!typed) root.append(tray);
  root.append(under, layer);
  el.append(style, root);

  /* ---------- rows ---------- */
  const paintRow = (node, look) => {
    if (typed) {
      node.classList.toggle("right", look === "right");
      node.classList.toggle("wrong", look === "wrong");
      return;
    }
    node.classList.remove("right", "wrong", "was", "dim");
    if (look !== "plain") node.classList.add(look);
    node.querySelector(".g").innerHTML =
      look === "right" || look === "was"
        ? CHECK
        : look === "wrong"
          ? CROSS
          : "";
    if (node.tagName === "BUTTON") node.disabled = look !== "plain";
  };
  const looks = tablets.map(() => "plain");
  let timer = 0;

  const scoreNote = (earned) => {
    if (!block.showScore) return;
    const plus = document.createElement("span");
    plus.className = earned > 0 ? "plus" : "plus none";
    plus.textContent = earned > 0 ? `+${earned}` : "No points";
    under.prepend(plus);
  };

  /* ---------- a quiz already done: everything in the card, nothing in the world ---------- */
  if (prior) {
    root.classList.add("greyed");
    env.say(block.ask, { ask: true, eyebrow: "Question done" });
    tablets.forEach((t) => {
      const look =
        t.i === prior.picked
          ? prior.right
            ? "right"
            : "wrong"
          : crossed.has(t.i)
            ? "wrong"
            : t.item.right && !prior.right
              ? "was"
              : "dim";
      paintRow(rows[t.i], look);
    });
    if (typed) {
      input.value = prior.typed;
      input.readOnly = true;
      check.hidden = true;
    }
    const stamp = document.createElement("p");
    stamp.className = "stamp cu-note";
    stamp.textContent = prior.right
      ? "You got this one right."
      : "You have answered this one.";
    under.append(stamp);
    scoreNote(prior.earned);
    env.done();
    return { dispose() {} };
  }

  env.say(block.ask, {
    ask: true,
    eyebrow: block.showScore
      ? `A question - ${block.points} points`
      : "A question",
  });

  /* ---------- the well: the card gives up the rows' height while they are out ---------- */
  const moveWell = (open, instant) => {
    if (typed) return;
    if (instant) {
      well.style.transition = "none";
      well.style.height = open ? "auto" : "0px";
      well.classList.toggle("moving", !open);
      void well.offsetHeight;
      well.style.transition = "";
      return;
    }
    const isOpen = well.style.height === "" || well.style.height === "auto";
    if (open === isOpen) return; // called back before it ever closed: nothing to undo
    well.classList.add("moving");
    if (open) well.style.height = `${well.scrollHeight}px`;
    else {
      well.style.height = `${well.offsetHeight}px`;
      void well.offsetHeight;
      well.style.height = "0px";
    }
  };
  well.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "height" || well.style.height === "0px") return;
    well.style.height = "auto";
    well.classList.remove("moving");
  });

  const sheetBox = { left: 0, top: 0, right: 0, bottom: 0 };
  let parkX = 0;

  const bridge = {
    /* Takes the real numbers from the card, so the tablet is painted as the row is. */
    measure() {
      const boxes = rows.map((r) => r.getBoundingClientRect());
      if (!boxes[0].width) return false;
      let l = Infinity;
      let r = -Infinity;
      let t = Infinity;
      let b = -Infinity;
      for (const box of boxes) {
        l = Math.min(l, box.left);
        r = Math.max(r, box.right);
        t = Math.min(t, box.top);
        b = Math.max(b, box.bottom);
      }
      tablets.forEach((tablet, i) => {
        const box = boxes[i];
        const css = getComputedStyle(rows[i]);
        const changed = tablet.tw !== box.width || tablet.th !== box.height;
        tablet.tw = box.width;
        tablet.th = box.height;
        tablet.dx = box.left + box.width / 2 - (l + r) / 2;
        tablet.dy = box.top + box.height / 2 - (t + b) / 2;
        tablet.rect0.l = box.left;
        tablet.rect0.t = box.top;
        tablet.rect0.w = box.width;
        tablet.rect0.h = box.height;
        tablet.px = parseFloat(css.fontSize);
        tablet.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        tablet.radius = parseFloat(css.borderTopLeftRadius);
        tablet.edge = parseFloat(css.borderTopWidth);
        tablet.padX = parseFloat(css.paddingLeft) + tablet.edge;
        const g = ghosts[i];
        g.style.width = `${box.width}px`;
        g.style.height = `${box.height}px`;
        if (changed) deck.resized();
      });
      return true;
    },
    /* The card's own outline: the layer fills it, so this reads nothing outside the slot. */
    sheet() {
      const r = layer.getBoundingClientRect();
      sheetBox.left = r.left;
      sheetBox.top = r.top;
      sheetBox.right = r.right;
      sheetBox.bottom = r.bottom;
      if (r.width) parkX = r.left + r.width / 2;
      return sheetBox;
    },
    shrink: () =>
      typed || root.dataset.phase === "out"
        ? 0
        : Math.max(0, well.offsetHeight - 56),
    parkX: () => parkX,
    setOut(out, instant) {
      root.dataset.phase = out ? "out" : "card";
      moveWell(!out, instant);
      if (out) {
        // a row crossed out in the card shows as a crossed socket too
        slotList.forEach((s, i) => {
          if (crossed.has(i) && s.className !== "x") {
            s.className = "x";
            s.innerHTML = CROSS;
          }
        });
        sendBack.hidden = true;
        call.textContent = ANSWER_HERE;
        call.classList.remove("far");
      }
    },
    hideRows() {
      if (typed) return;
      rows.forEach((r, i) => {
        if (!crossed.has(i)) r.classList.add("gone");
      });
    },
    showRows() {
      rows.forEach((r, i) => {
        r.classList.remove("gone");
        paintRow(r, looks[i]);
      });
    },
    ghost(i, matrix, opacity) {
      const g = ghosts[i];
      if (!matrix) {
        g.style.visibility = "hidden";
        return;
      }
      g.style.transition = "";
      g.style.transform = `matrix3d(${matrix.join(",")})`;
      g.style.opacity = looks[i] === "dim" ? opacity * 0.42 : opacity;
      g.style.visibility = "visible";
    },
    dockRect(i, flight, out) {
      const node = flight === "dock" ? slotList[i] : rows[i];
      const r = node.getBoundingClientRect();
      if (!r.width) return false;
      if (flight === "dock") {
        const t = tablets[i];
        out.w = 44;
        out.h = (44 * t.th) / t.tw;
        out.l = r.left + r.width / 2 - 22;
        out.t = r.top + r.height / 2 - out.h / 2;
      } else {
        out.l = r.left;
        out.t = r.top;
        out.w = r.width;
        out.h = r.height;
      }
      return true;
    },
    look(i, look, inCard) {
      looks[i] = look;
      paintRow(ghosts[i], look);
      if (inCard) paintRow(rows[i], look);
    },
    /* The tablet is home: the real row appears under its copy, and the copy goes. */
    landed(i, flight, look) {
      const g = ghosts[i];
      if (flight === "dock") {
        slotList[i].className = "x";
        slotList[i].innerHTML = CROSS;
      }
      rows[i].classList.remove("gone");
      paintRow(rows[i], look);
      g.style.transition = "opacity 0.14s";
      g.style.opacity = "0";
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (let n = 0; n < ghosts.length; n++)
          if (ghosts[n].style.opacity === "0")
            ghosts[n].style.visibility = "hidden";
      }, 170);
      env.sound("tap").play();
    },
    retry() {
      if (typed) input.classList.add("wrong");
      env.say(block.says.retry, { mood: "doubt", eyebrow: "One more try" });
    },
    recalled() {
      sendBack.hidden = deck.isOver();
    },
    where(word) {
      call.textContent = word ? WHERE[word] : ANSWER_HERE;
      call.classList.toggle("far", word !== null);
    },
    conclude(right, earned) {
      echo.textContent = block.ask;
      echo.hidden = false;
      sendBack.hidden = true;
      rows.forEach((r) => {
        if (r.tagName === "BUTTON") r.disabled = true;
        else r.readOnly = true;
      });
      if (check) check.hidden = true;
      env.say(right ? block.says.right : block.says.wrong, {
        mood: right ? "happy" : "doubt",
      });
      scoreNote(earned);
      env.done();
    },
    focusField: () => input?.focus(),
  };
  deck.attach(bridge);
  deck.calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const watcher = new ResizeObserver(() => {
    deck.cardShown(el.getBoundingClientRect().height > 0);
  });
  watcher.observe(el);

  return {
    dispose() {
      clearTimeout(timer);
      watcher.disconnect();
      deck.detach();
    },
  };
}

/* The one thing a FieldSpec cannot say: a typed answer is stored only as a salted hash. */
function openPanel(raw, el) {
  const label = document.createElement("label");
  label.className = "f";
  label.textContent = "A typed answer to accept (kept only as a salted hash)";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "water";
  label.append(input);
  el.append(label);
  input.addEventListener("input", () => {
    const word = normalise(input.value);
    raw.salt ||= Math.random().toString(36).slice(2, 10);
    raw.sha256 = word ? [sha256(raw.salt + word)] : (raw.sha256 ?? []);
  });
  return { dispose() {} };
}

export const kind = {
  name: NAME,
  read: (v, _view, tools) => readBlock(v, tools),
  fields: fieldsOf,
  world: makeDeck,
  card: openCard,
  panel: openPanel,
  /** For checks and screenshots, like the stage's own window.__stage. */
  peek: () => lastDeck?.peek() ?? null,
  speed: 1,
};
