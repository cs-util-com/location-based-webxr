// Walk to it: a quiz answered with the feet. Each answer is a tall flag a creator set in the
// place, several metres from the others. Stepping into a flag's circle asks for one confirming
// tap. Tapping a flag, or its letter in the card, reaches the same question from any distance,
// so nobody needs to be able to walk there.
import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from "three";

const NAME = "walk-to-it";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

/* ---------- what the feel rests on: tune here ---------- */
const CIRCLE_DEFAULT = 3; // metres: wide enough that a metre or two of drift still lands inside
const CIRCLE_MIN = 2;
const CIRCLE_MAX = 5;
const EXIT_MARGIN = 1.2; // metres past the circle before it lets go, so jitter cannot flicker it
const SWITCH_MARGIN = 1.5; // metres closer another flag must be to take over
const DWELL = 0.5; // seconds inside before the flag asks
const SECOND_TAP = 0.6; // seconds: a double tap cannot answer unread
const YES_GUARD_MS = 350; // the confirm button wakes a moment later, for a thumb already moving
const TOO_CLOSE = 2; // metres: closer than this the banner goes up, so it never fills the view
const STAND = 2.2; // metres from the pole: the footprints, where the banner fits the view
const POLE_H = 4.5;
const POLE_R = 0.05;
const BANNER_W = 1.7;
const BANNER_H = 1.4;
const BANNER_OUT = 0.1; // metres towards the viewer, so the pole never crosses the words
const NOTCH = 0.17;
const HEAD_TOP = 3.65; // the banner's middle, seen from far
const HEAD_EYE = 1.72; // the banner's middle, while the visitor stands in its circle
const TILT = -0.42; // a wrong flag hangs askew
const SWAY = 0.07; // metres
const EASE_TAU = 0.22;

const HUES = ["#fbbf24", "#7dd3fc", "#fda4af", "#c4b5fd"];
const LETTERS = "ABCD";
const RIGHT = "#2dd4bf";
const WRONG = "#f87171";
const INK = "#1c2128";
const PAPER = "#fbf8f0";
const GREY = "#aab1b8";

const FALLBACK_AT = [
  { x: -6.5, z: 1 },
  { x: -3.5, z: -6.5 },
  { x: 3.5, z: -6.5 },
  { x: 6.5, z: 1 },
];

const SAYS = {
  right: "Yes, that is the one.",
  retry: "Not that one. Have another look, one more try.",
  wrong: "No, that was not it.",
};

const rgba = (hex, a) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

/* ---------- geometry: everything flat is merged, so a flag costs few draw calls ---------- */
function fromSoup(pos, col) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 4));
  return g;
}

function pour(geo, color, pos, col, y = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    pos.push(p.getX(i), p.getY(i) + y, p.getZ(i));
    col.push(color[0], color[1], color[2], color[3]);
  }
  if (g !== geo) g.dispose();
  geo.dispose();
}

// A surveyor's pole: bands read against a pale sky, dark paving and a camera image alike.
function poleGeometry() {
  const pos = [];
  const col = [];
  const bands = 9;
  const band = POLE_H / bands;
  for (let i = 0; i < bands; i++) {
    const tint = rgba(i % 2 ? PAPER : INK, 1);
    const part = new CylinderGeometry(POLE_R, POLE_R, band, 6, 1, true);
    pour(part, tint, pos, col, band * (i + 0.5));
  }
  pour(
    new IcosahedronGeometry(0.11, 0),
    rgba(PAPER, 1),
    pos,
    col,
    POLE_H + 0.06,
  );
  return fromSoup(pos, col);
}

// One disc: a faint fill, a bright rim and a thin dark edge, so it reads on any ground.
function circleGeometry(r) {
  const pos = [];
  const col = [];
  const band = (a, b, tint) =>
    pour(new RingGeometry(a, b, 64).rotateX(-Math.PI / 2), tint, pos, col);
  band(0, r - 0.24, [1, 1, 1, 0.18]);
  band(r - 0.24, r - 0.03, [1, 1, 1, 0.95]);
  band(r - 0.03, r + 0.05, [0.07, 0.09, 0.11, 0.7]);
  return fromSoup(pos, col);
}

function pushTri(pos, col, tint, ax, az, bx, bz, cx, cz) {
  pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
  for (let i = 0; i < 3; i++) col.push(tint[0], tint[1], tint[2], tint[3]);
}

function pushDash(pos, col, tint, x, z, dx, dz, half, width) {
  const sx = -dz * width;
  const sz = dx * width;
  const ax = x - dx * half;
  const az = z - dz * half;
  const bx = x + dx * half;
  const bz = z + dz * half;
  pushTri(pos, col, tint, ax + sx, az + sz, bx - sx, bz - sz, bx + sx, bz + sz);
  pushTri(pos, col, tint, ax + sx, az + sz, ax - sx, az - sz, bx - sx, bz - sz);
}

function pushFoot(pos, col, tint, x, z, dx, dz, grow) {
  const along = 0.25 + grow;
  const across = 0.11 + grow;
  const n = 10;
  const point = (a) => [
    x + dx * Math.cos(a) * along - dz * Math.sin(a) * across,
    z + dz * Math.cos(a) * along + dx * Math.sin(a) * across,
  ];
  for (let i = 0; i < n; i++) {
    const [ax, az] = point((i / n) * Math.PI * 2);
    const [bx, bz] = point(((i + 1) / n) * Math.PI * 2);
    pushTri(pos, col, tint, x, z, bx, bz, ax, az);
  }
}

// The paint on the ground: a dashed way from the middle to each circle, and a pair of feet in it.
function groundGeometry(flags, r) {
  const pos = [];
  const col = [];
  const dark = [0.07, 0.09, 0.11, 0.55];
  for (const f of flags) {
    const len = Math.hypot(f.at.x, f.at.z) || 1;
    const dx = f.at.x / len;
    const dz = f.at.z / len;
    const hue = rgba(f.hue, 0.95);
    const end = len - r - 0.3;
    for (let at = 1; at < end; at += 1.05) {
      const x = dx * at;
      const z = dz * at;
      pushDash(pos, col, dark, x, z, dx, dz, 0.33, 0.1);
      pushDash(pos, col, hue, x, z, dx, dz, 0.28, 0.065);
    }
    const stand = Math.min(STAND, r - 0.45);
    const fx = f.at.x - dx * stand;
    const fz = f.at.z - dz * stand;
    for (const side of [-1, 1]) {
      const px = fx - dz * 0.2 * side + dx * side * 0.1;
      const pz = fz + dx * 0.2 * side + dz * side * 0.1;
      pushFoot(pos, col, dark, px, pz, dx, dz, 0.035);
      pushFoot(pos, col, hue, px, pz, dx, dz, 0);
    }
  }
  return fromSoup(pos, col);
}

/* ---------- one atlas: every banner and the waiting mark share a single canvas ---------- */
const ATLAS = 512;
const CELL_W = 256;
const CELL_H = 208;
const MARK = 96; // the "?" disc, in the strip under the banners

function bannerGeometry(index) {
  const g = new PlaneGeometry(BANNER_W, BANNER_H, 8, 3);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const bottom = -BANNER_H / 2 + 0.001;
  const inset = 3;
  const col = index % 2;
  const row = index >> 1;
  for (let i = 0; i < p.count; i++) {
    const across = Math.abs(p.getX(i) / (BANNER_W / 2));
    if (p.getY(i) <= bottom) p.setY(i, p.getY(i) + NOTCH * (1 - across));
    const u = p.getX(i) / BANNER_W + 0.5;
    const v = p.getY(i) / BANNER_H + 0.5;
    const px = col * CELL_W + inset + u * (CELL_W - inset * 2);
    const py = row * CELL_H + inset + (1 - v) * (CELL_H - inset * 2);
    uv.setXY(i, px / ATLAS, 1 - py / ATLAS);
  }
  return g;
}

function markGeometry() {
  const g = new PlaneGeometry(0.7, 0.7);
  const uv = g.attributes.uv;
  const y0 = CELL_H * 2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      (uv.getX(i) * MARK) / ATLAS,
      1 - (y0 + (1 - uv.getY(i)) * MARK) / ATLAS,
    );
  }
  return g;
}

function wrapLines(g, text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(g, text, width, height) {
  for (const size of [42, 36, 30, 26, 22, 19, 16]) {
    g.font = `700 ${size}px ${FONT}`;
    const lines = wrapLines(g, text, width);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (lines.length * size * 1.13 <= height && widest <= width)
      return { size, lines };
  }
  return { size: 16, lines: wrapLines(g, text, width).slice(0, 5) };
}

const PLATE = {
  open: { band: null, paper: PAPER, ink: INK, edge: null },
  picked: { band: null, paper: PAPER, ink: INK, edge: "#fb923c" },
  crossed: { band: WRONG, paper: "#d9dcdf", ink: "#4d545b", edge: null },
  out: { band: GREY, paper: "#d9dcdf", ink: "#4d545b", edge: null },
  right: { band: RIGHT, paper: "#d7fbf4", ink: "#04201c", edge: RIGHT },
  was: { band: RIGHT, paper: PAPER, ink: INK, edge: RIGHT },
};

function drawGlyph(g, kind, x, y, s) {
  g.strokeStyle = INK;
  g.lineWidth = s * 0.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (kind === "tick") {
    g.moveTo(x - s * 0.5, y + s * 0.05);
    g.lineTo(x - s * 0.12, y + s * 0.42);
    g.lineTo(x + s * 0.5, y - s * 0.4);
  } else {
    g.moveTo(x - s * 0.4, y - s * 0.4);
    g.lineTo(x + s * 0.4, y + s * 0.4);
    g.moveTo(x + s * 0.4, y - s * 0.4);
    g.lineTo(x - s * 0.4, y + s * 0.4);
  }
  g.stroke();
}

function drawCell(g, flag, look, text, showRight) {
  const plate = PLATE[look];
  const band = 74;
  g.fillStyle = plate.paper;
  g.fillRect(0, 0, CELL_W, CELL_H);
  g.fillStyle = plate.band ?? flag.hue;
  g.fillRect(0, 0, CELL_W, band);
  g.fillStyle = "rgb(0 0 0 / 28%)";
  g.fillRect(0, 0, CELL_W, 7); // the bar the banner hangs from

  g.fillStyle = INK;
  g.font = `800 60px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const glyph =
    look === "right" || look === "was"
      ? "tick"
      : look === "crossed"
        ? "cross"
        : null;
  if (glyph) {
    g.fillText(flag.letter, CELL_W / 2 - 30, band / 2 + 6);
    drawGlyph(g, glyph, CELL_W / 2 + 38, band / 2 + 3, 40);
  } else g.fillText(flag.letter, CELL_W / 2, band / 2 + 6);
  if (showRight) drawGlyph(g, "tick", CELL_W - 30, band / 2 + 3, 26);

  const top = band + 6;
  const room = CELL_H - top - (NOTCH / BANNER_H) * CELL_H * 0.72;
  const { size, lines } = fitText(g, text, CELL_W - 24, room);
  g.fillStyle = plate.ink;
  g.font = `700 ${size}px ${FONT}`;
  const lh = size * 1.13;
  const y0 = top + (room - lines.length * lh) / 2 + lh / 2;
  lines.forEach((l, i) => g.fillText(l, CELL_W / 2, y0 + i * lh, CELL_W - 20));

  if (plate.edge) {
    g.strokeStyle = plate.edge;
    g.lineWidth = 11;
    g.strokeRect(5.5, 5.5, CELL_W - 11, CELL_H - 11);
  }
}

function drawMark(g) {
  g.fillStyle = "#ffd391";
  g.beginPath();
  g.arc(MARK / 2, MARK / 2, MARK / 2 - 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a1a04";
  g.font = `800 62px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("?", MARK / 2, MARK / 2 + 4);
}

/* ---------- a typed answer is judged by a salted hash, so the file does not give it away ---------- */
const normalise = (s) =>
  s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");

async function saltedHash(salt, typed) {
  const bytes = new TextEncoder().encode(salt + normalise(typed));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- the quiz's state: the world part and the card share one record, per open ---------- */
const sessions = new WeakMap();

function makeSession(block, env) {
  const { flags } = block;
  const r = block.circle;
  const s = {
    picked: -1,
    via: "", // "walk" | "tap" | "card"
    pickedAt: 0,
    standing: -1,
    dismissed: -1, // "Not this one": it stays quiet until the visitor has stepped out
    dwell: 0,
    crossed: new Set(),
    tries: 0,
    result: null, // null | "right" | "wrong"
    chosen: -1,
    earned: 0,
    typedText: "",
    checking: false,
    outside: false,
    skipped: false,
    earlier: false,
    dist: flags.map(() => 99),
    time: 0,
    burst: -1,
    closed: false,
    render() {}, // the card
    paint() {}, // the banners
    focusField() {},
  };

  const opening = () => (s.tries ? "One more try" : "A question");
  const line = (text, opts) => env.say(text, opts);
  const changed = () => {
    s.paint();
    s.render();
  };
  s.quiet = () => s.outside || s.skipped;

  s.look = (i) => {
    if (block.typed) {
      if (s.result === "right") return "right";
      return s.crossed.has(i) ? "crossed" : "open";
    }
    if (s.result === "right") return i === s.chosen ? "right" : "out";
    if (s.result === "wrong") {
      if (i === block.right) return "was";
      return s.crossed.has(i) ? "crossed" : "out";
    }
    if (s.crossed.has(i)) return "crossed";
    return s.picked === i ? "picked" : "open";
  };

  s.clear = (silent) => {
    if (s.picked < 0) return;
    s.picked = -1;
    s.via = "";
    if (!silent) line(block.ask, { ask: true, eyebrow: opening() });
    changed();
  };

  s.select = (i, via) => {
    if (s.result || s.crossed.has(i) || block.typed) return;
    if (s.picked === i) {
      s.via = via === "walk" ? "walk" : s.via;
      changed();
      return;
    }
    s.picked = i;
    s.via = via;
    s.pickedAt = s.time;
    const f = flags[i];
    if (via !== "walk") env.sound("tap").play();
    line(`Flag ${f.letter} says "${f.text}". Is that your answer?`, {
      ask: true,
      eyebrow: via === "walk" ? `You are at flag ${f.letter}` : `Flag ${f.letter}`,
    });
    changed();
  };

  const finish = (result) => {
    s.result = result;
    s.picked = -1;
    s.via = "";
    s.standing = -1;
    if (result === "right") {
      s.earned = s.tries ? Math.floor(block.points / 2) : block.points;
      s.burst = block.typed ? 0 : s.chosen;
      s.burstAt = s.time;
      env.sound("right").play();
      line(block.says.right, { mood: "happy" });
    } else {
      env.sound("wrong").play();
      line(block.says.wrong, { mood: "doubt" });
    }
    changed();
    env.done();
  };

  const missed = () => {
    s.tries += 1;
    if (block.retry && s.tries < 2) {
      env.sound("wrong").play();
      line(block.says.retry, { mood: "doubt", eyebrow: "One more try" });
      changed();
    } else finish("wrong");
  };

  s.confirm = () => {
    if (s.picked < 0 || s.result) return;
    const i = s.picked;
    s.chosen = i;
    if (i === block.right) {
      finish("right");
      return;
    }
    s.crossed.add(i);
    s.picked = -1;
    s.via = "";
    missed();
  };

  s.decline = () => {
    if (s.picked < 0) return;
    if (s.standing === s.picked) s.dismissed = s.picked;
    s.clear();
  };

  s.tapFlag = (i) => {
    if (s.result) return;
    if (block.typed) {
      env.sound("tap").play();
      s.focusField();
      return;
    }
    if (s.crossed.has(i)) {
      line(`You tried flag ${flags[i].letter} already. Try another one.`, {
        mood: "doubt",
        eyebrow: "One more try",
      });
      return;
    }
    if (s.picked === i) {
      if (s.time - s.pickedAt >= SECOND_TAP) s.confirm();
      return;
    }
    s.select(i, "tap");
  };

  s.setTyped = (text) => {
    s.typedText = text;
    if (s.crossed.size) s.crossed.clear();
    s.paint();
  };

  s.check = async () => {
    const typed = s.typedText;
    if (s.checking || s.result || !typed.trim()) return;
    s.checking = true;
    s.render();
    let hex = null;
    try {
      hex = await saltedHash(block.typed.salt, typed);
    } catch {
      hex = null; // crypto.subtle needs a secure page
    }
    s.checking = false;
    if (s.closed) return;
    if (hex === null) {
      line("I cannot check that on this page. Skip it for now.", {
        mood: "doubt",
      });
      s.render();
      return;
    }
    if (block.typed.sha256.includes(hex)) finish("right");
    else {
      s.crossed.add(0);
      missed();
    }
  };

  const setStanding = (i) => {
    s.standing = i;
    s.dwell = 0;
    if (i !== s.dismissed) s.dismissed = -1;
    if (block.typed) s.render();
    else if (i >= 0 && i !== s.dismissed) s.select(i, "walk");
    else if (i < 0 && s.via === "walk") s.clear();
  };

  // Called every frame while the quiz is open. No allocation: only reads and rare state changes.
  s.stepStanding = (dt) => {
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < flags.length; i++) {
      if (s.crossed.has(i) && !block.typed) continue;
      if (s.dist[i] < nearD) {
        nearD = s.dist[i];
        near = i;
      }
    }
    if (s.standing >= 0) {
      const held = s.dist[s.standing];
      if (held > r + EXIT_MARGIN || (s.crossed.has(s.standing) && !block.typed))
        setStanding(-1);
      else if (near !== s.standing && nearD < r && nearD < held - SWITCH_MARGIN)
        setStanding(near);
      return;
    }
    if (near >= 0 && nearD < r) {
      s.dwell += dt;
      if (s.dwell >= DWELL) setStanding(near);
    } else s.dwell = 0;
  };

  s.leave = () => {
    s.outside = true;
    s.standing = -1;
    s.dismissed = -1;
    s.clear();
  };
  s.back = () => {
    s.outside = false;
  };
  s.close = () => {
    s.closed = true;
    s.render = () => {};
    s.paint = () => {};
    s.focusField = () => {};
  };

  const had = block.already;
  if (had) {
    s.earlier = true;
    if (block.typed) {
      s.typedText = had.typed ?? "";
      s.result = had.right ? "right" : "wrong";
      if (!had.right) s.crossed.add(0);
    } else {
      s.chosen = had.picked;
      s.result = had.picked === block.right ? "right" : "wrong";
      if (s.result === "wrong") s.crossed.add(had.picked);
    }
    s.tries = had.tries;
    s.earned =
      s.result === "right"
        ? s.tries
          ? Math.floor(block.points / 2)
          : block.points
        : 0;
  }
  return s;
}

/* ---------- the world part ---------- */
function world(block, env) {
  const s = makeSession(block, env);
  sessions.set(block, s);
  const { flags, circle: r } = block;
  const play = env.mode === "play";
  const object = new Group();

  const atlas = env.paintText({
    width: ATLAS,
    height: ATLAS,
    draw(g) {
      flags.forEach((f, i) => {
        g.save();
        g.translate((i % 2) * CELL_W, (i >> 1) * CELL_H);
        g.beginPath();
        g.rect(0, 0, CELL_W, CELL_H);
        g.clip();
        const blank = block.typed?.blanks ?? "?";
        const text = block.typed ? s.typedText.trim() || blank : f.text;
        drawCell(g, f, s.look(i), text, !play && i === block.right && !block.typed);
        g.restore();
      });
      g.save();
      g.translate(0, CELL_H * 2);
      drawMark(g);
      g.restore();
    },
  });
  s.paint = () => atlas.repaint();

  const poleMat = new MeshBasicMaterial({ vertexColors: true });
  const bannerMat = new MeshBasicMaterial({ map: atlas });
  const markMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  const groundMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const burstMat = new MeshBasicMaterial({
    color: RIGHT,
    transparent: true,
    depthWrite: false,
  });
  const poleGeo = poleGeometry();
  const circleGeo = circleGeometry(r);
  const groundGeo = groundGeometry(flags, r);
  const burstGeo = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
  const markGeo = markGeometry();
  const stakeGeo = new CylinderGeometry(0.03, 0.03, 1.1, 6, 1, true);
  const flat = () => {}; // paint on the ground takes no tap, so a tap there walks the visitor in
  const geos = [poleGeo, circleGeo, groundGeo, burstGeo, markGeo, stakeGeo];
  const mats = [poleMat, bannerMat, markMat, groundMat, burstMat];

  const ground = new Mesh(groundGeo, groundMat);
  ground.position.y = 0.025;
  ground.renderOrder = 2;
  ground.raycast = flat;
  object.add(ground);

  const burst = new Mesh(burstGeo, burstMat);
  burst.position.y = 0.05;
  burst.renderOrder = 3;
  burst.visible = false;
  burst.raycast = flat;
  object.add(burst);

  const hub = new Group();
  const mark = new Mesh(markGeo, markMat);
  mark.position.y = 1.4;
  const stake = new Mesh(stakeGeo, poleMat);
  stake.position.y = 0.55;
  hub.add(mark, stake);
  hub.visible = false;
  mark.raycast = flat;
  stake.raycast = flat;
  object.add(hub);

  const spacing = 2 * r + 1;
  const parts = flags.map((f, i) => {
    const post = new Group();
    post.name = `flag-${i}`;
    post.position.set(f.at.x, 0, f.at.z);
    const pole = new Mesh(poleGeo, poleMat);
    const head = new Group();
    head.position.y = HEAD_TOP;
    const bannerGeo = bannerGeometry(i);
    const banner = new Mesh(bannerGeo, bannerMat);
    banner.position.z = BANNER_OUT;
    head.add(banner, env.hitArea({ radius: 1, name: post.name }));
    post.add(
      pole,
      head,
      env.hitArea({ radius: 0.6, at: new Vector3(0, 1.3, 0), name: post.name }),
    );

    const crowded =
      !play &&
      flags.some(
        (o, j) =>
          j !== i && Math.hypot(o.at.x - f.at.x, o.at.z - f.at.z) < spacing,
      );
    const circleMat = new MeshBasicMaterial({
      color: crowded ? WRONG : f.hue,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const disc = new Mesh(circleGeo, circleMat);
    disc.position.set(f.at.x, 0.03, f.at.z);
    disc.renderOrder = 2;
    disc.raycast = flat;
    object.add(post, disc);
    geos.push(bannerGeo);
    mats.push(circleMat);
    const p = bannerGeo.attributes.position;
    return {
      post,
      head,
      banner,
      disc,
      circleMat,
      p,
      base: Float32Array.from(p.array),
      y: HEAD_TOP,
      tilt: s.crossed.has(i) ? TILT : 0,
      lift: 1,
      yaw: 0,
      phase: i * 1.7,
    };
  });

  const update = (frame) => {
    const v = frame.viewer;
    const t = frame.time;
    const k = 1 - Math.exp(-frame.dt / EASE_TAU);
    s.time = t;
    const quiet = play && s.quiet();
    const shut = quiet || s.result !== null;
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      const dx = v.x - f.at.x;
      const dz = v.z - f.at.z;
      s.dist[i] = Math.hypot(dx, dz);
      parts[i].yaw = Math.atan2(dx, dz);
    }
    if (play && !shut) s.stepStanding(frame.dt);

    for (let i = 0; i < flags.length; i++) {
      const part = parts[i];
      const d = s.dist[i];
      const inside = s.standing === i && d > TOO_CLOSE;
      const askew = s.crossed.has(i);
      part.y += ((inside ? HEAD_EYE : HEAD_TOP) - part.y) * k;
      part.tilt += ((askew ? TILT : 0) - part.tilt) * k;
      part.lift += ((quiet ? 0 : 1) - part.lift) * k;
      part.post.scale.y = Math.max(0.001, part.lift);
      part.post.visible = part.lift > 0.02;
      part.head.position.y = part.y;
      part.head.rotation.set(0, part.yaw, part.tilt);
      part.disc.visible = !shut && !s.crossed.has(i);
      if (part.disc.visible) {
        part.circleMat.opacity =
          s.picked === i ? 0.82 + Math.sin(t * 6) * 0.18 : 0.85;
      }
      if (t > 0 && part.post.visible) {
        const { p, base } = part;
        const a = p.array;
        for (let j = 0; j < a.length; j += 3) {
          const depth = (BANNER_H / 2 - base[j + 1]) / BANNER_H;
          a[j + 2] =
            Math.sin(t * 2.3 + base[j] * 2.6 + part.phase) * SWAY * depth;
        }
        p.needsUpdate = true;
      }
    }

    ground.visible = !shut;
    hub.visible = quiet && s.result === null;
    if (hub.visible) mark.rotation.y = Math.atan2(v.x, v.z);
    if (s.burst >= 0) {
      const age = (t - s.burstAt) / 1.1;
      burst.visible = age < 1;
      if (burst.visible) {
        const f = flags[s.burst];
        burst.position.set(f.at.x, 0.05, f.at.z);
        burst.scale.setScalar(r * (1 + age * 1.3));
        burstMat.opacity = 1 - age;
      } else s.burst = -1;
    }
  };

  return {
    object,
    update,
    tap(hit) {
      const name = hit.name ?? "";
      if (name.startsWith("flag-")) s.tapFlag(Number(name.slice(5)));
    },
    leave: s.leave,
    back: s.back,
    dispose() {
      s.close();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      atlas.dispose();
    },
  };
}

/* ---------- the story card: DOM, inside el only ---------- */
const CSS = `
[data-kind="${NAME}"] .wk-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin-top: 10px; }
[data-kind="${NAME}"] .wk-row .a { flex-direction: column; gap: 0; min-height: 56px; padding: 4px 2px 3px; font-size: 19px; border-bottom: 5px solid var(--hue); }
[data-kind="${NAME}"] .wk-row .a small { font-size: 12.5px; font-weight: 600; color: var(--walk-muted); font-variant-numeric: tabular-nums; }
[data-kind="${NAME}"] .wk-row .a.wrong small { color: inherit; }
[data-kind="${NAME}"] .wk-note { margin-top: 8px; font-size: 13.5px; line-height: 1.3; color: var(--walk-muted); }
[data-kind="${NAME}"] .wk-yes { display: flex; gap: 8px; margin-top: 10px; }
[data-kind="${NAME}"] .wk-yes .btn { min-height: 56px; }
[data-kind="${NAME}"] .wk-yes .btn:not(.primary) { flex: none; }
[data-kind="${NAME}"] .answers .a b { font-weight: 800; margin-right: 2px; }
[data-kind="${NAME}"] .wk-earlier .answers, [data-kind="${NAME}"] .wk-earlier .typed { filter: grayscale(0.7); opacity: 0.82; }
[data-kind="${NAME}"] .wk-pill { margin-top: 8px; }
[data-kind="${NAME}"] .wk-pill .plus { margin-left: 0; }
[data-kind="${NAME}"] .wk-add { display: flex; gap: 8px; margin-top: 4px; }
[data-kind="${NAME}"] .wk-add input { flex: 1; min-width: 0; }
@media (orientation: landscape) and (max-height: 520px) {
  [data-kind="${NAME}"] .wk-row { margin-top: 6px; }
  [data-kind="${NAME}"] .wk-row .a { min-height: 46px; font-size: 16px; }
  [data-kind="${NAME}"] .wk-yes .btn { min-height: 46px; }
  [data-kind="${NAME}"] .wk-note { margin-top: 5px; font-size: 12.5px; }
}
`;

function make(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function addStyle(el) {
  const style = document.createElement("style");
  style.textContent = CSS;
  el.append(style);
}

const COUNT = ["", "One", "Two", "Three", "Four"];

function scorePill(block, s) {
  const row = make("p", "wk-pill");
  if (s.earned > 0) row.append(make("span", "plus", `+${s.earned}`));
  else row.append(make("span", "plus none", "No points"));
  return row;
}

function choiceCard(block, s, host, env) {
  const { flags } = block;
  let yesTimer = 0;
  const chips = [];

  const row = () => {
    const wrap = make("div", "wk-row");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "The flags");
    chips.length = 0;
    flags.forEach((f, i) => {
      const b = make("button", "a");
      b.type = "button";
      b.style.setProperty("--hue", f.hue);
      b.dataset.flag = String(i);
      b.setAttribute("aria-label", `Flag ${f.letter}`);
      const crossed = s.crossed.has(i);
      if (crossed) b.classList.add("wrong");
      if (s.picked === i) b.classList.add("on");
      b.disabled = crossed;
      const metres = make("small");
      b.append(make("span", "", f.letter), metres);
      chips[i] = metres;
      wrap.append(b);
    });
    return wrap;
  };

  const tiles = () => {
    const wrap = make("div", "answers small");
    flags.forEach((f, i) => {
      const look = s.look(i);
      const cls =
        look === "right"
          ? "right"
          : look === "was"
            ? "was"
            : look === "crossed"
              ? "wrong"
              : "dim";
      const b = make("button", `a ${cls}`);
      b.type = "button";
      b.disabled = true;
      b.append(make("b", "", f.letter), make("span", "", f.text));
      wrap.append(b);
    });
    return wrap;
  };

  const tickMetres = () => {
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      if (!c) continue;
      const text =
        s.standing === i ? "here" : `${Math.round(s.dist[i])} m`;
      if (c.textContent !== text) c.textContent = text;
    }
  };

  s.render = () => {
    clearTimeout(yesTimer);
    host.replaceChildren();
    host.classList.toggle("wk-earlier", s.earlier);
    if (s.result) {
      if (s.earlier) host.append(make("p", "stamp", "You answered this earlier"));
      host.append(tiles());
      if (block.showScore) host.append(scorePill(block, s));
      return;
    }
    if (s.picked >= 0) {
      const f = flags[s.picked];
      host.append(make("p", "echo", block.ask));
      const yes = make("div", "wk-yes");
      const ok = make("button", "btn primary", "Yes, this one");
      ok.type = "button";
      ok.dataset.act = "yes";
      ok.disabled = true;
      yesTimer = setTimeout(() => (ok.disabled = false), YES_GUARD_MS);
      ok.addEventListener("click", () => s.confirm());
      const no = make("button", "btn", "Not this one");
      no.type = "button";
      no.dataset.act = "no";
      no.addEventListener("click", () => s.decline());
      yes.append(ok, no);
      host.append(yes);
      if (s.via !== "walk")
        host.append(
          make(
            "p",
            "wk-note",
            `Step into the circle of flag ${f.letter}, or choose it from here.`,
          ),
        );
      return;
    }
    host.append(row());
    host.append(
      make(
        "p",
        "wk-note",
        `${COUNT[flags.length]} flags stand around you, so look around. Walk into a circle to answer, or tap a letter if you cannot get there.`,
      ),
    );
    tickMetres();
  };

  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-flag]");
    if (b && !b.disabled) s.select(Number(b.dataset.flag), "card");
  });

  if (s.result) {
    env.say(block.ask, { ask: true });
    s.render();
    env.done();
  } else {
    env.say(block.ask, { ask: true, eyebrow: "A question" });
    s.render();
  }
  const metresTimer = setInterval(tickMetres, 400);
  return () => {
    clearTimeout(yesTimer);
    clearInterval(metresTimer);
  };
}

function typedCard(block, s, host, env) {
  const form = make("div", "typed");
  const field = make("input", "field");
  field.type = "text";
  field.placeholder = block.typed.placeholder;
  field.autocomplete = "off";
  field.spellcheck = false;
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("autocorrect", "off");
  field.setAttribute("enterkeyhint", "done");
  field.setAttribute("aria-label", "Your answer");
  field.value = s.typedText;
  const check = make("button", "check", "Check");
  check.type = "button";
  check.disabled = !s.typedText.trim();
  form.append(field, check);
  const note = make("p", "wk-note");
  const extras = make("div");
  host.append(form, note, extras);
  host.classList.toggle("wk-earlier", s.earlier);

  s.focusField = () => field.focus();
  s.render = () => {
    const shut = s.result !== null;
    field.readOnly = shut;
    field.classList.toggle("right", s.result === "right");
    field.classList.toggle("wrong", s.crossed.size > 0);
    check.hidden = shut;
    check.disabled = s.checking || !field.value.trim();
    check.textContent = s.checking ? "Checking" : "Check";
    note.hidden = shut;
    note.textContent =
      s.standing === 0
        ? "You are at the flag. Your word goes up on its banner."
        : "Go to the flag for a good view, or type from anywhere.";
    extras.replaceChildren();
    if (shut && s.earlier)
      extras.append(make("p", "stamp", "You answered this earlier"));
    if (shut && block.showScore) extras.append(scorePill(block, s));
  };

  field.addEventListener("input", () => {
    s.setTyped(field.value);
    s.render();
  });
  field.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    s.check();
  });
  check.addEventListener("click", () => s.check());

  env.say(block.ask, { ask: true, eyebrow: "A question" });
  s.render();
  if (s.result) env.done();
  return () => {};
}

function card(block, el, env) {
  const s = sessions.get(block);
  if (!s) return null;
  addStyle(el);
  const host = make("div");
  el.append(host);
  const stop = (block.typed ? typedCard : choiceCard)(block, s, host, env);
  // The stage hides this element when the story moves on. Without an answer that is a skip,
  // and the seam has no other word for it, so the flags fold on this.
  const watch = new MutationObserver(() => {
    if (el.hidden && !s.result) s.skipped = true;
  });
  watch.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  return {
    dispose() {
      watch.disconnect();
      stop();
    },
  };
}

/* ---------- the edit panel: only what a FieldSpec cannot say ---------- */
function panel(raw, el) {
  addStyle(el);
  if (raw.type !== "typed") {
    el.append(
      make(
        "p",
        "wk-note",
        "Keep flags apart by twice the circle and a metre more: a circle turns red when it is crowded. The tick on a banner is only here, it marks the right answer.",
      ),
    );
    return null;
  }
  const label = make("label", "f", "Accept this word");
  const row = make("div", "wk-add");
  const input = make("input");
  input.type = "text";
  const add = make("button", "btn", "Add");
  add.type = "button";
  row.append(input, add);
  label.append(row);
  const clear = make("button", "btn", "Clear all");
  clear.type = "button";
  const note = make("p", "wk-note");
  const say = () => {
    const n = raw.typed?.sha256?.length ?? 0;
    note.textContent = `${n} accepted, kept only as salted hashes. The tour file does not show the word.`;
  };
  add.addEventListener("click", async () => {
    const word = input.value;
    if (!word.trim()) return;
    add.disabled = true;
    add.textContent = "Saving";
    try {
      raw.typed ??= {};
      raw.typed.salt ??= `walk-${Math.random().toString(36).slice(2, 8)}`;
      const hex = await saltedHash(raw.typed.salt, word);
      raw.typed.sha256 = [...(raw.typed.sha256 ?? []), hex];
      input.value = "";
    } catch {
      note.textContent = "Could not hash that on this page.";
      add.disabled = false;
      add.textContent = "Add";
      return;
    }
    add.disabled = false;
    add.textContent = "Add";
    say();
  });
  clear.addEventListener("click", () => {
    if (raw.typed) raw.typed.sha256 = [];
    say();
  });
  el.append(label, clear, note);
  say();
  return null;
}

/* ---------- the record ---------- */
function readPlace(v, i) {
  const fallback = FALLBACK_AT[i] ?? FALLBACK_AT[0];
  const x = Number.isFinite(v?.x) ? v.x : fallback.x;
  const z = Number.isFinite(v?.z) ? v.z : fallback.z;
  return { x, z };
}

// A flag must stand where its circle can be reached without leaving the station's ring.
function insideRing(at, ring) {
  const room = ring - 1;
  const d = Math.hypot(at.x, at.z);
  if (d <= room) return at;
  return { x: (at.x / d) * room, z: (at.z / d) * room };
}

const STATION_RING = 12;

function read(v, _view, tools) {
  const ask = tools.requiredText(v, "ask", { max: 220 });
  const circle = Math.min(
    CIRCLE_MAX,
    Math.max(CIRCLE_MIN, Number(v.circle) || CIRCLE_DEFAULT),
  );
  const points = Math.max(0, Math.round(Number(v.points ?? 10)) || 0);
  const says = {
    right: tools.optionalText(v.says, "right", { max: 200 }).right ?? SAYS.right,
    retry: tools.optionalText(v.says, "retry", { max: 200 }).retry ?? SAYS.retry,
    wrong: tools.optionalText(v.says, "wrong", { max: 200 }).wrong ?? SAYS.wrong,
  };
  const common = {
    ask,
    circle,
    points,
    says,
    retry: v.retry !== false,
    showScore: v.showScore === true,
  };
  const earlier = (extra) =>
    v.already ? { tries: Number(v.already.tries) || 0, ...extra } : null;

  if (v.type === "typed") {
    const t = v.typed ?? {};
    return {
      ...common,
      right: 0,
      flags: [
        {
          letter: "?",
          hue: HUES[0],
          text: "",
          at: insideRing(readPlace(t.at, 0), STATION_RING),
        },
      ],
      typed: {
        salt: typeof t.salt === "string" ? t.salt : "",
        sha256: Array.isArray(t.sha256) ? t.sha256 : [],
        placeholder:
          typeof t.placeholder === "string" && t.placeholder
            ? t.placeholder
            : "Type the word",
        blanks: typeof t.blanks === "string" && t.blanks ? t.blanks : "?",
      },
      already: earlier({
        typed: String(v.already?.typed ?? ""),
        right: v.already?.right === true,
      }),
    };
  }

  const list = Array.isArray(v.answers) ? v.answers : [];
  const kept = [];
  list.forEach((a, i) => {
    if (typeof a?.text === "string" && a.text.trim() && kept.length < 4)
      kept.push({ i, a });
  });
  if (kept.length < 2) throw new Error("Give at least two answers");
  const flags = kept.map(({ i, a }, n) => ({
    letter: LETTERS[n],
    hue: HUES[n],
    text: a.text.trim().slice(0, 80),
    at: insideRing(readPlace(a.at, i), STATION_RING),
  }));
  const right = Math.max(
    0,
    kept.findIndex(({ i }) => i === Number(v.right)),
  );
  const picked = kept.findIndex(({ i }) => i === Number(v.already?.picked));
  return {
    ...common,
    flags,
    right,
    typed: null,
    already: picked >= 0 ? earlier({ picked }) : null,
  };
}

function fields(raw) {
  const head = [{ name: "ask", label: "Question", prose: true }];
  const tail = [
    { name: "retry", label: "One more try after a wrong answer", type: "toggle" },
    {
      name: "circle",
      label: "Circle radius, metres",
      type: "range",
      min: CIRCLE_MIN,
      max: CIRCLE_MAX,
      step: 0.5,
    },
    { name: "says.right", label: "Guide, when right" },
    { name: "says.retry", label: "Guide, one more try" },
    { name: "says.wrong", label: "Guide, when wrong" },
    { name: "points", label: "Points", type: "number", min: 0, max: 100, step: 1 },
    { name: "showScore", label: "Show the points", type: "toggle" },
  ];
  if (raw.type === "typed")
    return [
      ...head,
      { name: "typed.placeholder", label: "Hint inside the field" },
      { name: "typed.blanks", label: "Banner before typing" },
      { name: "typed.at", label: "Flag", type: "place" },
      ...tail,
    ];
  const answers = Array.isArray(raw.answers) ? raw.answers : [];
  const rows = [];
  for (let i = 0; i < 4; i++) {
    rows.push({ name: `answers.${i}.text`, label: `Answer ${LETTERS[i]}`, max: 80 });
    if (answers[i]?.at)
      rows.push({
        name: `answers.${i}.at`,
        label: `Flag ${LETTERS[i]}`,
        type: "place",
      });
  }
  return [
    ...head,
    ...rows,
    {
      name: "right",
      label: "The right answer",
      type: "choice",
      options: [0, 1, 2, 3].map((i) => [i, LETTERS[i]]),
    },
    ...tail,
  ];
}

export const kind = { name: NAME, read, fields, world, card, panel };
