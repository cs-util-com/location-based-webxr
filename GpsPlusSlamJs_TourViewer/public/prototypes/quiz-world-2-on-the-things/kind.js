// The answers sit on the things. The question is about the place; each answer is a marker a creator
// put on a real thing, and the visitor taps the thing or its marker. The card keeps a list as the way
// out, and a row of it shows its marker in the world.
//
// One rule for both sides: a tap POINTS, a second tap (or the card's button) ANSWERS. A tap on the
// world is also the stage's walk gesture and a thumb outdoors is not exact, so one stray tap must
// not spend a try.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Vector3,
} from "three";

const NAME = "quiz-on-things";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';
const LETTERS = "ABCD";
const WORDS = ["No", "One", "Two", "Three", "Four"];

const ACCENT = "#fb923c";
const FOUND = "#2dd4bf";
const DANGER = "#f87171";
const PLATE = "rgb(12 16 21 / 94%)";

/* The marker atlas: one canvas, a row per marker and one for the waiting sign. */
const ROW_W = 512;
const ROW_H = 128;
const ROWS = 5;
const WAITING_ROW = 4;
const ASPECT = ROW_W / ROW_H;

/* A marker keeps its size on screen: metres grow with distance, here in radians of the view.
   0.083 rad is about 48 px on a phone held upright, so its words stay about 17 px tall at 25 m. */
const BOARD_ANGLE = 0.083;
const BOARD_MIN = 0.42; // metres: close up it stops shrinking
const LIFT = 1.15; // board heights above the thing, so it never hides what it names
const BEAM_ANGLE = 0.012;
const BEAM_HIGH = 40;
const BEAM_AFTER = 6; // seconds the answer's beam stays after a result

/* The turn ring: chevrons around the viewer. It needs no view direction: whichever way you
   face, the part you see slides towards the marker. */
const GUIDE_RADIUS = 2.4;
const GUIDE_Y = 1.95; // above the eye: the card covers what lies below the horizon
const GUIDE_BAND = 0.16;
const GUIDE_REPS = 14;
const GUIDE_SEGMENTS = 72;

const STATE_SIZE = {
  idle: 1,
  pointed: 1.25,
  right: 1.3,
  was: 1.15,
  wrong: 0.8,
  crossed: 0.6,
  dim: 0.6,
};
const STATE_INK = {
  idle: ACCENT,
  pointed: "#ffffff",
  right: FOUND,
  was: FOUND,
  wrong: DANGER,
  crossed: "#9aa3ad",
  dim: "#9aa3ad",
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const noRay = () => {};

/* ---------- the typed answer: a salted hash, synchronous so it needs no secure context ---------- */
const SHA = (() => {
  const k = [];
  const h = [];
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
  for (let n = 2; k.length < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (!prime) continue;
    if (h.length < 8) h.push(frac(Math.sqrt(n)));
    k.push(frac(Math.cbrt(n)));
  }
  return { k, h };
})();

export function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const size = (((bytes.length + 8) >> 6) + 1) * 64;
  const data = new Uint8Array(size);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(size - 4, bytes.length * 8);
  const hash = SHA.h.slice();
  const w = new Int32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < size; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = rot(a, 7) ^ rot(a, 18) ^ (a >>> 3);
      const s1 = rot(b, 17) ^ rot(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const s1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + SHA.k[i] + w[i]) | 0;
      const s0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
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
      hash[i] = (hash[i] + v) | 0;
    });
  }
  return hash.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

const normalise = (s) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .trim()
    .replace(/\s+/g, " ");

/* ---------- what one open of the quiz remembers, shared by world and card ---------- */
const lives = new WeakMap();

function liveOf(block) {
  if (!lives.has(block)) {
    const v = block.visit;
    lives.set(block, {
      pointed: -1, // the answer the visitor is pointing at, -1 for none
      from: "", // "card" or "world": a card row needs the world to show the way
      listOpen: block.list === "open",
      crossed: new Set(v?.crossed ?? []),
      tries: 0,
      typed: v?.typed ?? "",
      flash: v && block.mode === "typed" ? v.result : "", // the typed field's right or wrong
      result: v?.result ?? "", // "", "right" or "wrong"
      picked: v?.picked ?? -1,
      earned: v?.result === "right" ? block.points : 0,
      settled: !!v, // came back to a finished quiz: nothing pops in, no beam
      plate: "", // a reaction the world must carry because the card is folded
      plateOn: 0, // the marker that reaction belongs to
      cardHidden: false,
      moves: null,
      onCard: null,
      onWorld: null,
    });
  }
  return lives.get(block);
}

/** The moves, one set for the world's taps and the card's buttons. */
function makeMoves(block, env, live) {
  const changed = () => {
    live.onWorld?.();
    live.onCard?.();
  };
  const react = (text, opts) => {
    env.say(text, opts);
    live.plate = live.cardHidden ? text : "";
  };
  const spent = () => {
    live.tries += 1;
    return block.retry && live.tries < 2;
  };
  const finish = () => {
    env.done();
    changed();
  };
  const half = () => Math.floor(block.points / 2);

  const moves = {
    ask() {
      env.say(block.ask, {
        ask: true,
        eyebrow: block.showScore
          ? `A question - ${block.points} points`
          : "A question",
      });
    },
    point(i, from) {
      if (live.result || live.crossed.has(i)) return;
      live.pointed = i;
      live.from = from;
      live.plate = "";
      env.sound("tap").play();
      changed();
    },
    worldTap(i) {
      if (live.result || live.crossed.has(i)) return;
      if (block.mode === "typed") return moves.point(i, "world");
      if (!block.confirm || live.pointed === i) return moves.answer(i);
      moves.point(i, "world");
    },
    cardTap(i) {
      if (live.pointed === i) moves.answer(i);
      else moves.point(i, "card");
    },
    answer(i) {
      if (live.result || live.crossed.has(i)) return;
      const a = block.answers[i];
      const again = live.tries > 0;
      live.pointed = -1;
      live.plateOn = i;
      if (a.id === block.right) {
        live.result = "right";
        live.picked = i;
        live.earned = again ? half() : block.points;
        env.sound("right").play();
        react(a.says ?? block.sayRight, { mood: "happy" });
        return finish();
      }
      live.crossed.add(i);
      if (spent()) {
        env.sound("wrong").play();
        react(a.says ?? block.sayWrong, {
          mood: "doubt",
          eyebrow: block.showScore
            ? `One more try - ${half()} points`
            : "One more try",
        });
        return changed();
      }
      live.result = "wrong";
      live.picked = i;
      live.earned = 0;
      env.sound("wrong").play();
      const right = block.answers.find((x) => x.id === block.right);
      react(
        `${a.says ?? "Not that one."} The answer is ${right.text}.${right.says ? ` ${right.says}` : ""}`,
        { mood: "doubt" },
      );
      finish();
    },
    check() {
      if (live.result || !live.typed.trim()) return;
      const right = block.accept.includes(
        sha256(block.salt + normalise(live.typed)),
      );
      live.flash = right ? "right" : "wrong";
      live.pointed = -1;
      if (right) {
        live.result = "right";
        live.earned = live.tries > 0 ? half() : block.points;
        env.sound("right").play();
        react(block.sayRight, { mood: "happy" });
        return finish();
      }
      if (spent()) {
        env.sound("wrong").play();
        react(block.sayWrong, { mood: "doubt", eyebrow: "One more try" });
        return changed();
      }
      live.result = "wrong";
      env.sound("wrong").play();
      react(block.sayLast, { mood: "doubt" });
      finish();
    },
    typing(text) {
      live.typed = text;
      live.flash = "";
      live.onWorld?.();
    },
    openList() {
      if (live.listOpen) return;
      live.listOpen = true;
      live.onCard?.();
    },
  };
  return moves;
}

/* ---------- words in the world ---------- */
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

/** Sets the largest font that fits and returns the text, cut only when even the smallest does not. */
function fit(g, text, maxWidth, from, to) {
  for (let px = from; px >= to; px -= 2) {
    g.font = `700 ${px}px ${FONT}`;
    if (g.measureText(text).width <= maxWidth) return text;
  }
  let cut = text;
  while (cut.length > 2 && g.measureText(`${cut}...`).width > maxWidth)
    cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function glyph(g, mark, x, y, r, ink, letter) {
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = r * 0.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (mark === "check") {
    g.moveTo(x - r * 0.45, y + r * 0.02);
    g.lineTo(x - r * 0.1, y + r * 0.38);
    g.lineTo(x + r * 0.48, y - r * 0.36);
    g.stroke();
  } else if (mark === "cross") {
    g.moveTo(x - r * 0.36, y - r * 0.36);
    g.lineTo(x + r * 0.36, y + r * 0.36);
    g.moveTo(x + r * 0.36, y - r * 0.36);
    g.lineTo(x - r * 0.36, y + r * 0.36);
    g.stroke();
  } else {
    g.font = `800 ${r * 1.25}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letter, x, y + r * 0.06);
    g.textAlign = "left";
  }
}

const LOOKS = {
  idle: { head: ACCENT, ink: "#1f1105", mark: "letter" },
  pointed: { head: "#ffffff", ink: "#14171d", mark: "letter" },
  right: { head: "#04201c", ink: FOUND, mark: "check", plate: FOUND },
  was: { head: FOUND, ink: "#04201c", mark: "check" },
  wrong: { head: DANGER, ink: "#2a0a0a", mark: "cross" },
  crossed: { head: "#6b7280", ink: "#ffffff", mark: "cross", small: true },
  dim: { head: "#6b7280", ink: "#ffffff", mark: "letter", small: true },
};

function paintRow(g, row, w, { letter, text, state, note }) {
  const look = LOOKS[state];
  const cy = row * ROW_H + ROW_H / 2;
  const r = 50;
  const room = w - r * 2 - 56;
  const shown = look.small ? "" : fit(g, text, room, 46, 30);
  const font = g.font;
  let textW = shown ? Math.min(room, g.measureText(shown).width) : 0;
  if (note) {
    g.font = `600 27px ${FONT}`;
    textW = Math.max(textW, g.measureText(note).width);
  }
  const width = look.small ? r * 2 + 12 : r * 2 + 12 + textW + 36;
  const x = (w - width) / 2;
  g.fillStyle = look.plate ?? PLATE;
  g.beginPath();
  g.roundRect(x, cy - 56, width, 112, 56);
  g.fill();
  g.strokeStyle = state === "pointed" ? "#ffffff" : "rgb(255 255 255 / 45%)";
  g.lineWidth = state === "pointed" ? 5 : 3;
  g.stroke();
  g.fillStyle = look.head;
  g.beginPath();
  g.arc(x + r + 6, cy, r, 0, Math.PI * 2);
  g.fill();
  glyph(g, look.mark, x + r + 6, cy, r, look.ink, letter);
  if (!shown) return;
  g.font = font;
  g.fillStyle = state === "right" ? "#04201c" : "#ffffff";
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(shown, x + r * 2 + 26, note ? cy - 18 : cy + 2);
  if (note) {
    g.font = `600 27px ${FONT}`;
    g.fillStyle = "#ffd391";
    g.fillText(note, x + r * 2 + 26, cy + 26);
  }
}

/* ---------- the kind ---------- */
function answerFields(raw) {
  const list = Array.isArray(raw.answers) ? raw.answers : [];
  const typed = raw.mode === "typed";
  const fields = [];
  for (let i = 0; i < (typed ? 1 : 4); i++) {
    const L = LETTERS[i];
    const word = typed ? "Marker" : `Answer ${L}`;
    fields.push({
      name: `answers.${i}.text`,
      label: `${word}: words`,
      max: 28,
    });
    if (!typed) {
      fields.push({
        name: `answers.${i}.says`,
        label: `${word}: what the guide says`,
        prose: true,
      });
    }
    fields.push(
      {
        name: `answers.${i}.up`,
        label: `${word}: metres up or down`,
        type: "number",
        step: 0.5,
      },
      {
        name: `answers.${i}.reach`,
        label: `${word}: how wide the thing is, metres (0: about 3)`,
        type: "number",
        step: 0.5,
      },
    );
    if (list[i]?.text)
      fields.push({
        name: `answers.${i}.at`,
        label: `Marker ${L}`,
        type: "place",
      });
  }
  return fields;
}

export const kind = {
  name: NAME,

  read(v, _view, tools) {
    const mode = v.mode === "typed" ? "typed" : "choose";
    const raws = Array.isArray(v.answers) ? v.answers.slice(0, 4) : [];
    const answers = [];
    raws.forEach((a, i) => {
      const text = tools.optionalText(a, "text", { max: 28 }).text;
      if (!text) return;
      answers.push({
        id: typeof a.id === "string" ? a.id : LETTERS[i].toLowerCase(),
        letter: LETTERS[answers.length],
        text,
        ...tools.optionalText(a, "says", { max: 220 }),
        on: typeof a.on === "string" ? a.on : "",
        at: a.at ? { x: a.at.x ?? 0, z: a.at.z ?? 0 } : null,
        up: a.up === undefined ? 0 : tools.metres(a.up, "up", [-20, 20]),
        reach: a.reach > 0 ? tools.metres(a.reach, "reach", [0, 12]) : 3,
      });
    });
    // A choice needs something to choose between, as in the other kinds.
    if (mode === "choose" && answers.length < 2)
      throw new Error("A question needs at least two answers");
    const right = answers.some((a) => a.id === v.right)
      ? v.right
      : answers[0]?.id;
    const indexOf = (id) => answers.findIndex((a) => a.id === id);
    const visit = v.visit?.result
      ? {
          result: v.visit.result === "wrong" ? "wrong" : "right",
          picked: indexOf(v.visit.picked),
          crossed: (v.visit.crossed ?? []).map(indexOf).filter((i) => i >= 0),
          typed: typeof v.visit.typed === "string" ? v.visit.typed : "",
        }
      : null;
    return {
      mode,
      ask: tools.requiredText(v, "ask", { max: 240 }),
      answers,
      right,
      retry: v.retry !== false,
      confirm: v.confirm !== false,
      list: v.list === "open" ? "open" : "folded",
      listAfter:
        typeof v.listAfter === "number" && v.listAfter >= 0 ? v.listAfter : 45,
      points: typeof v.points === "number" && v.points >= 0 ? v.points : 10,
      showScore: v.showScore === true,
      drift: typeof v.drift === "number" ? v.drift : 0,
      sayRight:
        tools.optionalText(v, "sayRight", { max: 220 }).sayRight ?? "Yes!",
      sayWrong:
        tools.optionalText(v, "sayWrong", { max: 220 }).sayWrong ??
        "Not that one. Look again.",
      sayLast:
        tools.optionalText(v, "sayLast", { max: 220 }).sayLast ??
        "Not quite. Have another look on your way out.",
      placeholder:
        tools.optionalText(v, "placeholder", { max: 40 }).placeholder ??
        "Type your answer",
      salt: typeof v.salt === "string" ? v.salt : "",
      accept: Array.isArray(v.accept) ? v.accept : [],
      visit,
    };
  },

  fields(raw) {
    const common = [
      { name: "ask", label: "Question", prose: true },
      {
        name: "mode",
        label: "Kind of answer",
        type: "choice",
        options: [
          ["choose", "Tap a thing"],
          ["typed", "Type it"],
        ],
      },
    ];
    const end = [
      {
        name: "retry",
        label: "One more try after a wrong answer",
        type: "toggle",
      },
      { name: "points", label: "Points", type: "number", step: 1 },
      { name: "showScore", label: "Show the points", type: "toggle" },
      {
        name: "drift",
        label: "Try a tracking error, metres",
        type: "range",
        min: 0,
        max: 6,
        step: 0.5,
      },
    ];
    if (raw.mode === "typed") {
      return [
        ...common,
        { name: "placeholder", label: "Text in the empty field" },
        { name: "sayRight", label: "Guide, when right", prose: true },
        { name: "sayWrong", label: "Guide, one more try", prose: true },
        { name: "sayLast", label: "Guide, out of tries", prose: true },
        ...answerFields(raw),
        ...end,
      ];
    }
    return [
      ...common,
      ...answerFields(raw),
      {
        name: "right",
        label: "Which is right",
        type: "choice",
        options: (Array.isArray(raw.answers) ? raw.answers : [])
          .map((a, i) => [a.id, LETTERS[i]])
          .filter(([id]) => id),
      },
      {
        name: "confirm",
        label: "A tap in the world asks before it answers",
        type: "toggle",
      },
      {
        name: "list",
        label: "The list in the card",
        type: "choice",
        options: [
          ["folded", "Folded, one tap away"],
          ["open", "Open from the start"],
        ],
      },
      {
        name: "listAfter",
        label: "Open the list by itself after, seconds (0: never)",
        type: "range",
        min: 0,
        max: 120,
        step: 5,
      },
      ...end,
    ];
  },

  // A place field needs a value before its ring is drawn, and a record names a thing rather than
  // a spot. Only the panel gets both the raw record and the anchors.
  panel(raw, el, env) {
    for (const a of Array.isArray(raw.answers) ? raw.answers : []) {
      if (a.at) continue;
      const p = env.place.anchors[a.on];
      a.at = p
        ? { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }
        : { x: 0, z: 0 };
    }
    const style = document.createElement("style");
    style.textContent = `
      [data-kind="${NAME}"] .f:has(.where) { display: none; }
      [data-kind="${NAME}"] .note { margin-top: 12px; color: var(--walk-muted); font-size: 13px; line-height: 1.35; }
      [data-kind="${NAME}"] .add { display: flex; gap: 8px; margin-top: 6px; }
      [data-kind="${NAME}"] .add input { flex: 1; min-width: 0; min-height: var(--tap); padding: 8px 10px; border: 1px solid rgb(255 255 255 / 34%); border-radius: 10px; background: rgb(255 255 255 / 9%); color: #fff; font-size: 16px; outline: 0; }`;
    const note = document.createElement("p");
    note.className = "note";
    note.textContent =
      raw.mode === "typed"
        ? "Drag the lettered ring on the ground under the thing."
        : "Drag a lettered ring on the ground under its thing, then set how high the marker sits. The circle shows what counts as a tap on the thing.";
    el.append(style, note);
    if (raw.mode !== "typed") return { dispose() {} };

    const count = document.createElement("p");
    count.className = "note";
    const say = () => {
      const n = Array.isArray(raw.accept) ? raw.accept.length : 0;
      count.textContent = `${n} accepted ${n === 1 ? "spelling" : "spellings"}, kept only as salted hashes.`;
    };
    say();
    const add = document.createElement("div");
    add.className = "add";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add an accepted answer";
    input.setAttribute("aria-label", "Add an accepted answer");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = "Add";
    button.addEventListener("click", () => {
      const word = normalise(input.value);
      if (!word) return;
      raw.salt ||= `salt-${Math.random().toString(36).slice(2, 10)}`;
      raw.accept = [
        ...(Array.isArray(raw.accept) ? raw.accept : []),
        sha256(raw.salt + word),
      ];
      input.value = "";
      say();
    });
    add.append(input, button);
    el.append(count, add);
    return { dispose() {} };
  },

  world(block, env) {
    const live = liveOf(block);
    const moves = makeMoves(block, env, live);
    live.moves = moves;
    const edit = env.mode === "edit";
    const geos = [];
    const mats = [];
    const geo = (g) => {
      geos.push(g);
      return g;
    };
    const mat = (m) => {
      mats.push(m);
      return m;
    };

    const object = new Group();
    const markers = new Group();
    object.add(markers);

    /* the things' spots: a creator's placement wins, else the place's named thing */
    const shiftX = block.drift * 0.8;
    const shiftZ = block.drift * 0.6;
    const spots = block.answers.map((a) => {
      const p = env.place.anchors[a.on];
      return {
        x: (a.at?.x ?? p?.x ?? 0) + shiftX,
        y: Math.max(0.3, (p?.y ?? 2) + a.up),
        z: (a.at?.z ?? p?.z ?? 0) + shiftZ,
      };
    });

    /* the atlas: every marker and the waiting sign on one canvas */
    const typedQuiz = block.mode === "typed";
    const rightIndex = typedQuiz
      ? 0
      : block.answers.findIndex((a) => a.id === block.right);
    const stateOf = (i) => {
      if (live.result) {
        if (typedQuiz) return live.result;
        if (i === rightIndex) return i === live.picked ? "right" : "was";
        if (i === live.picked) return "wrong";
        return live.crossed.has(i) ? "crossed" : "dim";
      }
      if (live.crossed.has(i)) return "crossed";
      return live.pointed === i ? "pointed" : "idle";
    };
    const noteOf = (i) =>
      stateOf(i) === "pointed" && block.confirm && !typedQuiz
        ? "Tap again to answer"
        : "";
    const wordsOf = (i) =>
      typedQuiz && live.typed.trim()
        ? live.typed.trim().slice(0, 28)
        : block.answers[i].text;

    const atlas = env.paintText({
      width: ROW_W,
      height: ROW_H * ROWS,
      draw(g, w) {
        block.answers.forEach((a, i) => {
          paintRow(g, i, w, {
            letter: a.letter,
            text: wordsOf(i),
            state: stateOf(i),
            note: noteOf(i),
          });
        });
        paintRow(g, WAITING_ROW, w, {
          letter: "?",
          text: "Question waiting",
          state: "idle",
        });
      },
    });
    atlas.premultiplyAlpha = true;
    const boardMat = mat(
      new MeshBasicMaterial({
        map: atlas,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    const boardGeo = (row) => {
      const g = geo(new PlaneGeometry(ASPECT, 1));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++)
        uv.setY(i, 1 - (row + 1 - uv.getY(i)) / ROWS);
      return g;
    };
    const unitStem = geo(new PlaneGeometry(1, 1).translate(0, 0.5, 0));
    const unitDot = geo(new RingGeometry(0, 1, 18));
    const unitHalo = geo(new RingGeometry(0.965, 1, 56));
    const flat = (color, opacity = 0.95) =>
      mat(
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
          fog: false,
        }),
      );

    const zone = new Vector3();
    const marks = block.answers.map((a, i) => {
      const s = spots[i];
      const group = new Group();
      group.position.set(s.x, 0, s.z);
      group.name = `answer:${i}`;
      const stemMat = flat(ACCENT);
      const haloMat = flat(ACCENT, 0.9);
      const board = new Mesh(boardGeo(i), boardMat);
      board.rotation.order = "YXZ";
      board.renderOrder = 6;
      const stem = new Mesh(unitStem, stemMat);
      stem.renderOrder = 5;
      const foot = new Mesh(unitDot, stemMat);
      foot.rotation.order = "YXZ";
      foot.position.y = s.y;
      foot.renderOrder = 5;
      const halo = new Mesh(unitHalo, haloMat);
      halo.rotation.order = "YXZ";
      halo.position.y = s.y;
      halo.renderOrder = 5;
      halo.raycast = noRay;
      halo.visible = edit;
      // The tap zones: the marker keeps a thumb's size at any distance, and the thing itself is
      // tapped, from the marker's spot down to the ground, so a tower counts below its clock too.
      const hits = new Group();
      const hit = env.hitArea({ name: group.name });
      hits.add(hit);
      for (let y = s.y; y > -a.reach; y -= a.reach * 1.6) {
        zone.set(0, Math.max(y, 0.5), 0);
        hits.add(env.hitArea({ radius: a.reach, at: zone, name: group.name }));
      }
      group.add(stem, foot, halo, board, hits);
      markers.add(group);
      return {
        ...s,
        reach: a.reach,
        board,
        stem,
        foot,
        halo,
        haloMat,
        stemMat,
        hit,
        hits,
        state: "idle",
        want: 1,
        grow: 1,
        kick: -9,
      };
    });

    /* the light that shows which marker is meant, over any roof */
    const beamGeo = geo(new PlaneGeometry(1, 1, 1, 2).translate(0, 0.5, 0));
    {
      const n = beamGeo.attributes.position.count;
      const c = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const y = beamGeo.attributes.position.getY(i);
        c.set([1, 1, 1, y > 0.9 ? 0 : y > 0.4 ? 0.28 : 0.6], i * 4);
      }
      beamGeo.setAttribute("color", new Float32BufferAttribute(c, 4));
    }
    const beamMat = mat(
      new MeshBasicMaterial({
        color: ACCENT,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    const beam = new Mesh(beamGeo, beamMat);
    beam.raycast = noRay;
    beam.renderOrder = 4;
    beam.visible = false;
    markers.add(beam);

    /* the turn ring */
    const guideTex = env.paintText({
      width: 64,
      height: 64,
      draw(g, w, h) {
        g.lineCap = "round";
        g.lineJoin = "round";
        const chevron = () => {
          g.beginPath();
          g.moveTo(w * 0.62, h * 0.18);
          g.lineTo(w * 0.28, h * 0.5);
          g.lineTo(w * 0.62, h * 0.82);
          g.stroke();
        };
        g.strokeStyle = "rgb(12 16 21 / 85%)";
        g.lineWidth = 20;
        chevron();
        g.strokeStyle = "#ffd391";
        g.lineWidth = 10;
        chevron();
      },
    });
    guideTex.premultiplyAlpha = true;
    guideTex.wrapS = RepeatWrapping;
    const guideGeo = geo(new BufferGeometry());
    {
      const pos = [];
      const uv = [];
      const index = [];
      for (let k = 0; k <= GUIDE_SEGMENTS; k++) {
        const t = (k / GUIDE_SEGMENTS) * Math.PI * 2;
        const u = ((t <= Math.PI ? t : Math.PI * 2 - t) / Math.PI) * GUIDE_REPS;
        const x = Math.sin(t) * GUIDE_RADIUS;
        const z = Math.cos(t) * GUIDE_RADIUS;
        pos.push(x, -GUIDE_BAND / 2, z, x, GUIDE_BAND / 2, z);
        uv.push(u, 0, u, 1);
        if (k < GUIDE_SEGMENTS) {
          const a = k * 2;
          index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      guideGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      guideGeo.setAttribute("uv", new Float32BufferAttribute(uv, 2));
      guideGeo.setIndex(index);
    }
    const guideMat = mat(
      new MeshBasicMaterial({
        map: guideTex,
        transparent: true,
        premultipliedAlpha: true,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    const guide = new Mesh(guideGeo, guideMat);
    guide.raycast = noRay;
    guide.renderOrder = 3;
    guide.visible = false;
    guide.frustumCulled = false;
    markers.add(guide);

    /* a single sign at the station's foot while the visitor is outside its ring */
    const waiting = new Group();
    const waitBoard = new Mesh(boardGeo(WAITING_ROW), boardMat);
    waitBoard.rotation.order = "YXZ";
    waitBoard.renderOrder = 6;
    waitBoard.raycast = noRay;
    const waitStem = new Mesh(unitStem, flat("#ffd391"));
    waitStem.raycast = noRay;
    waitStem.renderOrder = 5;
    waiting.add(waitStem, waitBoard);
    waiting.visible = false;
    object.add(waiting);

    /* the reaction, when the card is folded and cannot carry it */
    let plateText = "";
    const plateTex = env.paintText({
      width: 512,
      height: 256,
      draw(g, w, h) {
        if (!plateText) return;
        g.fillStyle = PLATE;
        g.beginPath();
        g.roundRect(3, 3, w - 6, h - 6, 28);
        g.fill();
        g.fillStyle = "#fff";
        g.textBaseline = "top";
        let px = 38;
        let lines;
        do {
          px -= 2;
          g.font = `600 ${px}px ${FONT}`;
          lines = wrap(g, plateText, w - 56);
        } while (lines.length * (px + 8) > h - 86 && px > 18);
        lines.forEach((l, i) => g.fillText(l, 28, 22 + i * (px + 8)));
        if (live.result) {
          g.fillStyle = "#ffd391";
          g.font = `700 26px ${FONT}`;
          g.fillText("Open the card to go on", 28, h - 48);
        }
      },
    });
    plateTex.premultiplyAlpha = true;
    const plateMat = mat(
      new MeshBasicMaterial({
        map: plateTex,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    const plate = new Mesh(geo(new PlaneGeometry(2, 1)), plateMat);
    plate.rotation.order = "YXZ";
    plate.raycast = noRay;
    plate.renderOrder = 8;
    plate.visible = false;
    markers.add(plate);

    let sign = null;
    let away = false;
    let beamUntil = -1;
    let plateAt = null;
    let target = null; // the marker the beam stands on

    const refresh = () => {
      let next = live.typed;
      for (let i = 0; i < marks.length; i++) next += stateOf(i) + noteOf(i);
      const now = env.frame.time;
      if (next !== sign) {
        sign = next;
        atlas.repaint();
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          const state = stateOf(i);
          if (state !== m.state) m.kick = now;
          m.state = state;
          m.want = STATE_SIZE[state];
          m.stemMat.color.set(STATE_INK[state]);
          m.haloMat.color.set(STATE_INK[state]);
          m.board.renderOrder = state === "idle" ? 6 : 7;
          // A settled or crossed marker takes no taps, so a tap there walks.
          m.hits.visible = !live.result && state !== "crossed";
          m.stem.visible = !LOOKS[state].small;
          m.foot.visible = m.stem.visible;
          m.halo.visible = edit || state === "pointed" || state === "right";
        }
      }
      target = null;
      if (live.pointed >= 0) {
        target = marks[live.pointed];
        beamUntil = -1;
        beamMat.color.set(ACCENT);
      } else if (live.result && !live.settled) {
        target = marks[rightIndex] ?? null;
        if (beamUntil < 0) beamUntil = now + BEAM_AFTER;
        beamMat.color.set(FOUND);
      }
      if (live.plate !== plateText) {
        plateText = live.plate;
        plateTex.repaint();
        plateAt = plateText ? (marks[live.plateOn] ?? null) : null;
      }
    };
    live.onWorld = refresh;
    refresh();

    return {
      object,
      update(frame) {
        const t = frame.time;
        const v = frame.viewer;
        if (
          !edit &&
          !away &&
          !live.listOpen &&
          !live.result &&
          !typedQuiz &&
          block.listAfter > 0 &&
          t > block.listAfter
        )
          moves.openList();

        const ease = edit ? 1 : 1 - Math.exp(-frame.dt / 0.12);
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          const dx = v.x - m.x;
          const dz = v.z - m.z;
          const ground = Math.hypot(dx, dz);
          const dist = Math.hypot(ground, v.y - m.y);
          const yaw = Math.atan2(dx, dz);
          const base = Math.max(BOARD_MIN, dist * BOARD_ANGLE);
          m.grow += (m.want - m.grow) * ease;
          let pop = 1;
          if (!edit && !live.settled) {
            const p = clamp01((t - i * 0.25) / 0.45);
            pop = 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
          }
          const s = Math.max(0.001, base * m.grow * pop);
          const lift = base * LIFT;
          const age = t - m.kick;
          const hop =
            m.state === "right" && age < 0.6
              ? Math.sin((age / 0.6) * Math.PI) * base * 0.8
              : 0;
          const shake =
            (m.state === "crossed" || m.state === "wrong") && age < 0.5
              ? Math.sin(age * 34) * (0.5 - age) * base * 0.8
              : 0;
          const y = m.y + lift + hop;
          const tilt = -Math.atan2(v.y - y, ground);
          m.board.position.set(
            Math.cos(yaw) * shake,
            y,
            -Math.sin(yaw) * shake,
          );
          m.board.rotation.set(tilt, yaw, 0);
          m.board.scale.setScalar(s);
          m.stem.rotation.y = yaw;
          m.stem.position.y = m.y;
          m.stem.scale.set(Math.max(0.02, dist * 0.0045), lift * pop, 1);
          m.foot.rotation.set(tilt, yaw, 0);
          m.foot.scale.setScalar(Math.max(0.05, dist * 0.011));
          m.hit.position.y = m.y + lift;
          m.hit.scale.setScalar(base * 1.05);
          if (m.halo.visible) {
            const burst = m.state === "right" ? clamp01(age / 0.8) : 0;
            m.halo.rotation.set(tilt, yaw, 0);
            m.halo.scale.setScalar(m.reach * (1 + burst * 0.5));
            m.haloMat.opacity = m.state === "right" ? 0.9 * (1 - burst) : 0.9;
          }
        }

        const beamOn = target !== null && (beamUntil < 0 || t < beamUntil);
        beam.visible = beamOn;
        if (beamOn) {
          const dx = v.x - target.x;
          const dz = v.z - target.z;
          beam.position.set(target.x, 0, target.z);
          beam.rotation.y = Math.atan2(dx, dz);
          beam.scale.set(
            Math.max(0.25, Math.hypot(dx, dz) * BEAM_ANGLE),
            target.y + BEAM_HIGH,
            1,
          );
        }

        // Only a card row needs the way shown: a world tap means the visitor is already looking.
        const showWay =
          live.pointed >= 0 && live.from === "card" && target !== null;
        guide.visible = showWay;
        if (showWay) {
          guide.position.set(v.x, GUIDE_Y, v.z);
          guide.rotation.y = Math.atan2(target.x - v.x, target.z - v.z);
          guideTex.offset.x = (t * 1.2) % 1;
        }

        if (waiting.visible) {
          const d = Math.hypot(v.x, v.z);
          const s = Math.max(0.7, d * BOARD_ANGLE * 1.15);
          const h = 2.2;
          waitBoard.position.y = h + s * 0.42;
          waitBoard.rotation.set(
            -Math.atan2(v.y - waitBoard.position.y, d),
            Math.atan2(v.x, v.z),
            0,
          );
          waitBoard.scale.setScalar(s);
          waitStem.rotation.y = waitBoard.rotation.y;
          waitStem.scale.set(Math.max(0.03, d * 0.0045), h, 1);
        }

        plate.visible = plateAt !== null;
        if (plate.visible) {
          const m = plateAt;
          const dx = v.x - m.x;
          const dz = v.z - m.z;
          const ground = Math.hypot(dx, dz);
          const dist = Math.hypot(ground, v.y - m.y);
          const h = Math.max(1, dist * 0.2);
          const y = m.y + Math.max(BOARD_MIN, dist * BOARD_ANGLE) * 2 + h / 2;
          plate.position.set(m.x, y, m.z);
          plate.rotation.set(
            -Math.atan2(v.y - y, ground),
            Math.atan2(dx, dz),
            0,
          );
          plate.scale.setScalar(h);
        }
      },
      tap(hit) {
        if (hit.name.startsWith("answer:"))
          moves.worldTap(Number(hit.name.slice(7)));
      },
      leave() {
        away = true;
        markers.visible = false;
        waiting.visible = !live.result;
      },
      back() {
        away = false;
        markers.visible = true;
        waiting.visible = false;
      },
      dispose() {
        live.onWorld = null;
        geos.forEach((g) => g.dispose());
        mats.forEach((m) => m.dispose());
        atlas.dispose();
        guideTex.dispose();
        plateTex.dispose();
      },
    };
  },

  card(block, el, env) {
    const live = liveOf(block);
    const { moves } = live;
    const make = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const button = (cls, text) => {
      const b = make("button", cls, text);
      b.type = "button";
      return b;
    };

    const style = make("style");
    style.textContent = `
      [data-kind="${NAME}"] .look { margin-top: 8px; color: var(--walk-muted); font-size: 14px; line-height: 1.3; }
      [data-kind="${NAME}"] .way { display: block; width: 100%; margin-top: 10px; }
      [data-kind="${NAME}"] .ltr { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--walk-accent); color: var(--walk-accent-ink); font-size: 14px; font-weight: 800; }
      [data-kind="${NAME}"] .answers.small .a { justify-content: flex-start; min-height: 50px; padding: 6px 8px; font-size: 15px; text-align: left; }
      [data-kind="${NAME}"] .a.wrong { text-decoration: none; }
      [data-kind="${NAME}"] .a.wrong .words { text-decoration: line-through 2px; }
      [data-kind="${NAME}"] .a.on .ltr { background: #fff; color: #14171d; }
      [data-kind="${NAME}"] .a.right .ltr { background: var(--walk-found-ink); color: var(--walk-found); }
      [data-kind="${NAME}"] .a.was .ltr { background: var(--walk-found); color: var(--walk-found-ink); }
      [data-kind="${NAME}"] .a.wrong .ltr, [data-kind="${NAME}"] .a.dim .ltr { background: rgb(255 255 255 / 22%); color: #fff; }
      [data-kind="${NAME}"] .pick { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 6px 6px 6px 10px; border: 1.5px solid var(--walk-accent); border-radius: 14px; background: rgb(251 146 60 / 16%); }
      [data-kind="${NAME}"] .pick b { flex: 1; min-width: 0; font-size: 15px; line-height: 1.2; }
      [data-kind="${NAME}"] .pick .btn { flex: none; }
      [data-kind="${NAME}"] .echo { margin-top: 8px; }
      [data-kind="${NAME}"] .score { margin-top: 8px; }`;
    const body = make("div");
    el.append(style, body);

    const rows = () => {
      const list = make("div", "answers small");
      block.answers.forEach((a, i) => {
        const b = button("a");
        const crossed = live.crossed.has(i);
        if (live.result) {
          b.disabled = true;
          if (a.id === block.right)
            b.classList.add(i === live.picked ? "right" : "was");
          else if (i === live.picked || crossed) b.classList.add("wrong");
          else b.classList.add("dim");
        } else if (crossed) {
          b.disabled = true;
          b.classList.add("wrong");
        } else if (live.pointed === i) b.classList.add("on");
        b.append(make("span", "ltr", a.letter), make("span", "words", a.text));
        b.addEventListener("click", () => moves.cardTap(i));
        list.append(b);
      });
      return list;
    };

    const typedRow = () => {
      const row = make("div", "typed");
      const field = make("input", `field ${live.flash}`.trim());
      field.type = "text";
      field.value = live.typed;
      field.placeholder = block.placeholder;
      field.autocomplete = "off";
      field.spellcheck = false;
      field.enterKeyHint = "done";
      field.setAttribute("aria-label", "Your answer");
      field.readOnly = !!live.result;
      row.append(field);
      if (live.result) return row;
      const check = button("check", "Check");
      check.disabled = !live.typed.trim();
      const submit = () => {
        field.blur();
        moves.check();
      };
      check.addEventListener("click", submit);
      field.addEventListener("input", () => {
        moves.typing(field.value);
        check.disabled = !field.value.trim();
        field.classList.remove("wrong");
      });
      field.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        submit();
      });
      field.addEventListener("focus", () =>
        field.scrollIntoView({ block: "nearest" }),
      );
      row.append(check);
      return row;
    };

    const render = () => {
      const parts = [];
      if (live.tries > 0 || live.result) {
        if (!block.visit) parts.push(make("p", "echo", block.ask));
      }
      if (block.mode === "typed") {
        parts.push(typedRow());
        if (!live.result) {
          const a = block.answers[0];
          const where = button(
            "btn way",
            live.pointed === 0
              ? "The way to it is showing"
              : `Where is ${a.text.toLowerCase()}?`,
          );
          where.addEventListener("click", () => moves.point(0, "card"));
          parts.push(where);
        }
      } else {
        const listed = live.listOpen || !!live.result;
        if (!listed) {
          const left = block.answers.length - live.crossed.size;
          parts.push(
            make(
              "p",
              "look",
              `${WORDS[left]} ${left === 1 ? "thing carries" : "things carry"} a marker around you. Tap the one you mean.`,
            ),
          );
        }
        if (listed) parts.push(rows());
        if (!live.result && live.pointed >= 0) {
          const a = block.answers[live.pointed];
          const yes = button("btn primary", listed ? `Yes, ${a.text.toLowerCase()}` : "That one");
          yes.addEventListener("click", () => moves.answer(live.pointed));
          if (listed) {
            yes.classList.add("way");
            parts.push(yes);
          } else {
            const pick = make("div", "pick");
            pick.append(
              make("span", "ltr", a.letter),
              make("b", "", a.text),
              yes,
            );
            parts.push(pick);
          }
        }
        if (!listed) {
          const way = button("btn way", "I can't find them, show a list");
          way.addEventListener("click", () => moves.openList());
          parts.push(way);
        }
      }
      if (block.visit)
        parts.push(make("p", "stamp", "You answered this one earlier"));
      if (live.result && block.showScore) {
        const score = make("p", "score");
        score.append(
          make(
            "span",
            live.earned ? "plus" : "plus none",
            live.earned ? `+${live.earned}` : "No points",
          ),
        );
        parts.push(score);
      }
      body.replaceChildren(...parts);
    };
    live.onCard = render;

    // A folded card cannot carry a reaction: the world does, until the card is open again.
    const watcher = new ResizeObserver(() => {
      live.cardHidden = el.offsetHeight === 0;
      if (!live.cardHidden && live.plate) {
        live.plate = "";
        live.onWorld?.();
      }
    });
    watcher.observe(el);

    moves.ask();
    render();
    if (live.result) env.done();
    return {
      dispose() {
        watcher.disconnect();
        live.onCard = null;
      },
    };
  },
};
