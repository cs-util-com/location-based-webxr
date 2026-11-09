// A quiz whose answers stand around the visitor as signs. Throwaway; not wired to the app.
//
// The story card asks. The signs rise from the ground where the visitor stands, fan out left and
// right in the direction they look, and stay there. Nothing about the fan is a world coordinate:
// it is measured from the visitor at the moment of asking, so GPS error cannot put it out of reach.
import {
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  TorusGeometry,
  Vector3,
} from "three";

const NAME = "answer-fan";
const FONT = 'Corbel, "Noto Sans", system-ui, sans-serif';

const SIGN_W = 0.96; // metres
const SIGN_H = 0.64;
const SIGN_Y = 1.72; // the middle of a sign: just over the eye, so the card does not cover it
const HIT_R = 0.54;
const GAP = 0.06; // metres between two neighbouring signs
const DEAL_S = 0.7; // seconds for one sign to slide out
const STAGGER = 0.08;
const AWAY_OUT = 7; // metres from the fan: the signs sink
const AWAY_IN = 6; // and rise again, a little nearer so the edge does not flicker
const JUMP = 1; // metres in one frame: not a step, the frame moved under the visitor
const SEEN = 0.38; // radians either side of the view that count as "in view" on a phone
const BEHIND = 1.9;
const DEG = Math.PI / 180;

// One 1024 px canvas holds every sign, two columns of three cells.
const ATLAS = 1024;
const COLS = 2;
const ROWS = 3;
const CELL_W = ATLAS / COLS;
const CELL_H = ATLAS / ROWS;

const LOOKS = {
  open: { plate: "#141a20", edge: "#ffffff", ink: "#ffffff", size: 1 },
  key: {
    plate: "#141a20",
    edge: "#2dd4bf",
    ink: "#ffffff",
    size: 1,
    mark: "check",
    markInk: "#2dd4bf",
  },
  wrong: {
    plate: "#3a1618",
    edge: "#f87171",
    ink: "#fecaca",
    size: 0.86,
    mark: "cross",
    markInk: "#f87171",
    strike: true,
  },
  right: {
    plate: "#2dd4bf",
    edge: "#2dd4bf",
    ink: "#04201c",
    size: 1.08,
    mark: "check",
    markInk: "#04201c",
  },
  was: {
    plate: "#141a20",
    edge: "#2dd4bf",
    ink: "#a7f3e6",
    size: 1,
    mark: "check",
    markInk: "#2dd4bf",
  },
  dim: {
    plate: "rgb(20 26 32 / 66%)",
    edge: "rgb(255 255 255 / 34%)",
    ink: "rgb(255 255 255 / 66%)",
    size: 0.8,
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const normalise = (s) =>
  s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
const turn = (a, b) => {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

/** What the visitor already did on a quiz. The seam has no saved progress, so it lives here. */
const kept = new Map();
/** One open of the kind: world() makes it, card() finds it by the block both of them get. */
const sessions = new WeakMap();

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

function fit(g, text, w, h) {
  for (const size of [104, 88, 74, 62, 52, 44, 38, 33]) {
    g.font = `700 ${size}px ${FONT}`;
    const lines = wrap(g, text, w);
    const fitsHigh = lines.length * size * 1.15 <= h;
    if (fitsHigh && lines.every((l) => g.measureText(l).width <= w))
      return { size, lines };
  }
  const size = 33;
  g.font = `700 ${size}px ${FONT}`;
  const room = Math.floor(h / (size * 1.15));
  return { size, lines: wrap(g, text, w).slice(0, room) };
}

function drawMark(g, kind, x, y, colour) {
  g.strokeStyle = colour;
  g.lineWidth = 11;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (kind === "check") {
    g.moveTo(x - 20, y + 2);
    g.lineTo(x - 5, y + 18);
    g.lineTo(x + 22, y - 18);
  } else {
    g.moveTo(x - 17, y - 17);
    g.lineTo(x + 17, y + 17);
    g.moveTo(x + 17, y - 17);
    g.lineTo(x - 17, y + 17);
  }
  g.stroke();
}

/** One sign, in a 512 by 341 cell. A sign is opaque: it must read on a sunlit wall and at night. */
function drawSign(g, text, lookName, label) {
  const look = LOOKS[lookName];
  const w = CELL_W;
  const h = CELL_H;
  const inset = 10;
  g.beginPath();
  g.roundRect(inset, inset, w - inset * 2, h - inset * 2, 44);
  g.fillStyle = look.plate;
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = look.edge;
  g.stroke();
  const pad = 38;
  const top = label ? 84 : pad;
  const box = fit(g, text || " ", w - pad * 2, h - top - pad);
  g.fillStyle = look.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (label) {
    g.save();
    g.font = `600 40px ${FONT}`;
    g.fillText(label, w / 2, 62);
    g.restore();
    g.font = `700 ${box.size}px ${FONT}`;
  }
  const lead = box.size * 1.15;
  const y0 = top + (h - top - pad - lead * box.lines.length) / 2 + lead / 2;
  box.lines.forEach((line, i) => {
    g.fillText(line, w / 2, y0 + i * lead, w - pad * 2);
    if (look.strike) {
      const half = Math.min(g.measureText(line).width, w - pad * 2) / 2;
      g.fillRect(w / 2 - half, y0 + i * lead - 3, half * 2, 6);
    }
  });
  if (look.mark) drawMark(g, look.mark, w - 70, 68, look.markInk);
}

/** How a sign looks follows from the answers given, so card and world can never disagree. */
function lookOf(block, q, i) {
  if (q.edit) return !block.typed && block.answers[i].right ? "key" : "open";
  if (block.typed) {
    if (q.result) return q.result === "right" ? "right" : "wrong";
    return q.tries > 0 && q.typed === q.picked ? "wrong" : "open";
  }
  if (!q.result) return q.crossed.includes(i) ? "wrong" : "open";
  const crossed = q.crossed.includes(i) || i === q.picked;
  if (q.result === "right")
    return i === q.picked ? "right" : crossed ? "wrong" : "dim";
  return block.answers[i].right ? "was" : crossed ? "wrong" : "dim";
}

function openQuiz(block, edit) {
  const was = edit ? null : (kept.get(block.key) ?? block.done ?? null);
  return {
    edit,
    whole: !!was?.result, // reopened after it was answered: shown as a whole, nothing to do
    result: was?.result ?? null,
    picked: was?.picked ?? -1,
    tries: was?.tries ?? 0,
    crossed: [...(was?.crossed ?? [])],
    earned: was?.earned ?? 0,
    typed: was?.typed ?? "",
    tiles: false, // the visitor asked for the answers in the card
    el: null,
    sync: null,
    showLine: null,
    bring: null,
    repaint: null,
    away: false,
    parked: false,
  };
}

function keep(block, q) {
  kept.set(block.key, {
    result: q.result,
    picked: q.picked,
    tries: q.tries,
    crossed: q.crossed,
    earned: q.earned,
    typed: q.typed,
  });
}

const retryEyebrow = (block) =>
  block.showScore
    ? `One more try - ${Math.floor(block.points / 2)} points`
    : "One more try";

/** Tries, points and the guide's reaction, whichever way the answer came in. */
function judge(block, q, env, right, picked) {
  q.picked = picked;
  if (right) {
    q.result = "right";
    q.earned = q.tries === 0 ? block.points : Math.floor(block.points / 2);
  } else {
    q.tries += 1;
    if (typeof picked === "number" && !q.crossed.includes(picked))
      q.crossed.push(picked);
    if (!block.retry || q.tries >= 2) q.result = "wrong";
  }
  keep(block, q);
  q.repaint?.(picked);
  env.sound(right ? "right" : "wrong").play();
  if (right) env.say(block.say.right, { mood: "happy" });
  else if (q.result) env.say(block.say.wrong, { mood: "doubt" });
  else
    env.say(block.say.retry, { mood: "doubt", eyebrow: retryEyebrow(block) });
  q.sync?.();
  if (q.result) env.done();
}
function fanWorld(block, env) {
  const edit = env.mode === "edit";
  const q = openQuiz(block, edit);
  sessions.set(block, q);
  const count = block.typed ? 1 : block.answers.length;
  const reach = block.reach;

  // Always one 1024 px canvas: the stage multiplies by the screen's density, so ask for the rest.
  const probe = env.paintText({ width: 8, height: 8 });
  const logical = ATLAS / (probe.image.width / 8);
  probe.dispose();
  const atlas = env.paintText({
    width: logical,
    height: logical,
    draw(g, w) {
      const k = w / ATLAS;
      for (let i = 0; i < count; i++) {
        g.save();
        g.scale(k, k);
        g.translate((i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H);
        const text = block.typed ? q.typed || "?" : block.answers[i].text;
        const label = block.typed ? "Your word" : undefined;
        drawSign(g, text, lookOf(block, q, i), label);
        g.restore();
      }
    },
  });
  atlas.premultiplyAlpha = true;

  const plateMat = new MeshBasicMaterial({
    map: atlas,
    transparent: true,
    premultipliedAlpha: true,
  });
  const postMat = new MeshBasicMaterial({ color: "#3c4044" });
  const footMat = new MeshBasicMaterial({
    color: "#000000",
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const railMat = new MeshBasicMaterial({
    color: "#fb923c",
    transparent: true,
    depthWrite: false,
  });
  const postGeo = new BoxGeometry(0.05, SIGN_Y - SIGN_H / 2, 0.05).translate(
    0,
    (SIGN_Y - SIGN_H / 2) / 2,
    0,
  );
  const footGeo = new CircleGeometry(0.24, 20).rotateX(-Math.PI / 2);
  const plateGeos = [];

  // A sign never comes closer than its neighbour allows, however narrow the creator set the fan.
  const least = 2 * Math.atan((SIGN_W / 2 + GAP) / reach);
  const step =
    count > 1 ? Math.max((block.fanWidth * DEG) / (count - 1), least) : 0;
  const width = step * (count - 1);

  const object = new Group();
  const fan = new Group();
  fan.visible = false;
  object.add(fan);

  const signs = [];
  for (let i = 0; i < count; i++) {
    const geo = new PlaneGeometry(SIGN_W, SIGN_H);
    const u0 = (i % COLS) / COLS;
    const u1 = u0 + 1 / COLS;
    const v1 = 1 - Math.floor(i / COLS) / ROWS;
    const v0 = v1 - 1 / ROWS;
    const uv = geo.attributes.uv;
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    plateGeos.push(geo);

    const name = `answer-${i}`;
    const group = new Group();
    group.name = name;
    const plate = new Mesh(geo, plateMat);
    plate.position.y = SIGN_Y;
    const post = new Mesh(postGeo, postMat);
    const foot = new Mesh(footGeo, footMat);
    foot.position.y = 0.015;
    group.add(post, foot, plate);
    group.add(
      env.hitArea({ radius: HIT_R, at: new Vector3(0, SIGN_Y, 0), name }),
    );
    fan.add(group);
    signs.push({
      group,
      plate,
      offset: width / 2 - i * step, // the first answer stands furthest to the left
      order: Math.abs(i - (count - 1) / 2),
      scale: 0,
      size: 1,
      face: 0,
      kick: -10,
      shake: false,
    });
  }

  // A thin line through the signs: where it runs out of the view, there is another sign.
  let railGeo = null;
  let rail = null;
  if (count > 1) {
    railGeo = new TorusGeometry(reach, 0.011, 5, 48, width);
    railGeo.rotateX(Math.PI / 2).rotateY(width / 2 - Math.PI / 2);
    rail = new Mesh(railGeo, railMat);
    rail.position.y = SIGN_Y + SIGN_H / 2 + 0.08;
    fan.add(rail);
  }

  const sizeOf = (i) => LOOKS[lookOf(block, q, i)].size * (q.whole ? 0.92 : 1);
  const applySizes = () => {
    for (let i = 0; i < count; i++) signs[i].size = sizeOf(i);
  };
  applySizes();

  let cx = 0;
  let cz = 0;
  let heading = 0;
  let dealT = -100;
  // Where the visitor looks, as atan2(x, z) in the kind's metres: the convention of toSign below.
  let viewYaw = Math.PI;
  let wantDeal = !edit;
  let snapFaces = true;
  let movedOn = false;
  let hasLast = false;
  let lastX = 0;
  let lastZ = 0;
  let railFade = 0;
  let lineCode = 0;

  const deal = (x, z, yaw, time) => {
    cx = x;
    cz = z;
    heading = yaw;
    fan.position.set(x, 0, z);
    fan.rotation.y = yaw;
    fan.visible = true;
    dealT = time;
    snapFaces = true;
    for (const s of signs) s.scale = 0;
    wantDeal = false;
    q.parked = false;
    q.away = false;
  };

  if (edit) {
    // A creator places nothing: the fan is drawn around an example visitor looking at the item.
    const { x, z } = block.preview;
    const far = Math.hypot(x, z) > 0.5;
    deal(x, z, far ? Math.atan2(-x, -z) : Math.PI, -100);
  }

  q.repaint = (picked) => {
    atlas.repaint();
    applySizes();
    if (picked === undefined) return;
    const i = block.typed ? 0 : picked;
    const s = signs[i];
    if (!s) return;
    s.kick = env.frame.time;
    s.shake = !block.typed
      ? !block.answers[i].right
      : q.result !== "right";
    s.plate.rotation.z = s.shake ? -0.05 : 0;
    s.scale = s.size * (s.shake ? 1 : 1.16);
  };
  q.bring = () => {
    wantDeal = true;
    q.parked = false;
    q.away = false;
    movedOn = false;
    lineCode = 0;
  };

  return {
    object,
    update(frame) {
      const t = frame.time;
      const dt = frame.dt;
      const v = frame.viewer;
      viewYaw = frame.viewYaw;

      // A GPS correction moves this whole object under the visitor. The fan was never about the
      // world, so it stays where the visitor saw it.
      if (hasLast && !edit) {
        const dx = v.x - lastX;
        const dz = v.z - lastZ;
        if (dx * dx + dz * dz > JUMP * JUMP) {
          cx += dx;
          cz += dz;
          fan.position.set(cx, 0, cz);
        }
      }
      hasLast = true;
      lastX = v.x;
      lastZ = v.z;

      if (!movedOn && q.el?.hidden) movedOn = true;
      if (wantDeal && !q.parked && !movedOn)
        deal(v.x, v.z, viewYaw - (count % 2 ? 0 : step / 2), t);

      if (!edit && fan.visible && !q.parked) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (!q.away && d > AWAY_OUT) q.away = true;
        else if (q.away && d < AWAY_IN) {
          q.away = false;
          dealT = t;
        }
      }

      const up = !movedOn && !q.parked && !q.away && !wantDeal;
      const soft = dt > 0 ? 1 - Math.exp(-dt / 0.16) : 1;
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      let left = 0;
      let right = 0;
      let seen = 0;
      let nearest = 9;
      let anyShown = false;

      for (let i = 0; i < count; i++) {
        const s = signs[i];
        const start = dealT + s.order * STAGGER;
        const p = edit ? 1 : easeOut(clamp((t - start) / DEAL_S, 0, 1));
        const o = s.offset * p;
        const r = reach * (0.7 + 0.3 * p);
        const x = r * Math.sin(o);
        const z = r * Math.cos(o);
        s.group.position.set(x, 0, z);

        // Turn to the viewer around the post: the sign stays where it is and always reads.
        const wx = cx + x * cos + z * sin;
        const wz = cz - x * sin + z * cos;
        const toSign = Math.atan2(wx - v.x, wz - v.z);
        const face = toSign + Math.PI - heading;
        s.face = snapFaces ? face : s.face + turn(s.face, face) * soft;
        s.group.rotation.y = s.face;

        const target = up && t >= start ? s.size : 0;
        s.scale += (target - s.scale) * soft;
        s.group.visible = s.scale > 0.03;
        if (s.group.visible) {
          anyShown = true;
          s.group.scale.setScalar(s.scale);
        }
        const since = t - s.kick;
        s.plate.position.x =
          s.shake && since < 0.4
            ? Math.sin(since * 42) * 0.05 * (1 - since / 0.4)
            : 0;

        const off = turn(viewYaw, toSign);
        const abs = Math.abs(off);
        if (abs < nearest) nearest = abs;
        if (abs < SEEN) seen += 1;
        else if (off > 0) left += 1;
        else right += 1;
      }
      snapFaces = false;

      if (rail) {
        railFade += ((up ? 1 : 0) - railFade) * soft;
        railMat.opacity = railFade * 0.9;
        rail.visible = railFade > 0.02;
      }
      if (movedOn && !anyShown && railFade < 0.02) fan.visible = false;

      if (edit || !q.showLine || q.result) return;
      let state = "look";
      let code = 10 + left * 10 + right * 100 + seen * 1000;
      if (q.parked) {
        state = "parked";
        code = 1;
      } else if (q.away) {
        state = "away";
        code = 2;
      } else if (wantDeal || t - dealT < DEAL_S) {
        state = "deal";
        code = 3;
      } else if (!seen && nearest > BEHIND) {
        state = "behind";
        code = 4;
      }
      if (code !== lineCode) {
        lineCode = code;
        q.showLine(state, left, right, seen);
      }
    },
    tap(hit) {
      const i = Number(hit.name?.slice(7));
      if (block.typed || q.result || !hit.name?.startsWith("answer-")) return;
      if (env.frame.time - dealT < 0.3 || q.crossed.includes(i)) return;
      judge(block, q, env, block.answers[i].right, i);
    },
    leave() {
      q.parked = true;
    },
    back() {
      q.parked = false;
      if (!movedOn) wantDeal = true;
    },
    dispose() {
      for (const g of [postGeo, footGeo, ...plateGeos]) g.dispose();
      railGeo?.dispose();
      for (const m of [plateMat, postMat, footMat, railMat]) m.dispose();
      atlas.dispose();
      q.repaint = q.bring = null;
    },
  };
}

const CARD_CSS = `
[data-kind="${NAME}"] .fanline { min-height: 21px; margin-top: 10px; font-size: 15px; font-weight: 600; color: var(--walk-found); }
[data-kind="${NAME}"] .fanline.lost { color: #ffd391; }
[data-kind="${NAME}"] .fanacts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
[data-kind="${NAME}"] .fanacts .btn { flex: 1; min-height: 40px; padding: 8px 10px; font-size: 13.5px; white-space: nowrap; }
[data-kind="${NAME}"] .fanacts .btn.primary { font-size: 14px; }
[data-kind="${NAME}"] .echo { margin-top: 8px; white-space: normal; }
[data-kind="${NAME}"] .whole .answers { filter: grayscale(1); opacity: 0.62; pointer-events: none; }
[data-kind="${NAME}"] .whole .a.right { animation: none; }
[data-kind="${NAME}"] .again { margin-top: 6px; font-size: 12.5px; color: var(--walk-muted); }
`;

async function typedIsRight(block, typed) {
  const word = normalise(typed);
  if (block.accept.includes(word)) return true;
  if (!crypto.subtle) return null;
  const bytes = new TextEncoder().encode(block.salt + word);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return block.sha256.includes(hex);
}

function tileClass(block, q, i) {
  const look = lookOf(block, q, i);
  return look === "open" || look === "key" ? "" : look;
}

function fanCard(block, el, env) {
  const q = sessions.get(block);
  if (!q) return { dispose() {} };
  q.el = el;
  const pick = !block.typed;
  const box = document.createElement("div");
  box.innerHTML = `<style>${CARD_CSS}</style>
    <p class="echo" hidden></p>
    <p class="fanline" role="status"></p>
    <div class="answers small" hidden></div>
    <div class="typed" hidden>
      <input class="field" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
        spellcheck="false" enterkeyhint="done" aria-label="Your answer" />
      <button class="check" type="button" disabled>Check</button>
    </div>
    <p class="stamp" hidden></p>
    <p class="again" hidden>Prototype: reload the page to be asked again.</p>
    <div class="fanacts">
      <button type="button" class="btn" data-do="bring"></button>
      <button type="button" class="btn" data-do="tiles">Answer in the card</button>
    </div>`;
  el.append(box);
  const $ = (s) => box.querySelector(s);
  const echo = $(".echo");
  const line = $(".fanline");
  const tiles = $(".answers");
  const typed = $(".typed");
  const field = $(".field");
  const check = $(".check");
  const stamp = $(".stamp");
  const again = $(".again");
  const acts = $(".fanacts");
  const bring = $('[data-do="bring"]');
  const asTiles = $('[data-do="tiles"]');
  bring.textContent = pick ? "Bring them here" : "Bring it here";
  field.placeholder = block.placeholder;
  field.value = q.typed;
  check.disabled = !q.typed.trim();
  if (pick) {
    block.answers.forEach((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "a";
      b.dataset.a = String(i);
      b.textContent = a.text;
      tiles.append(b);
    });
  }

  q.showLine = (state, left, right, seen) => {
    line.classList.toggle("lost", state === "away" || state === "parked");
    bring.classList.toggle("primary", state === "away" || state === "parked");
    const things = pick ? "answers" : "sign";
    if (state === "deal") {
      line.textContent = pick
        ? "The answers are opening around you."
        : "Your word will show on the sign.";
    } else if (state === "away") {
      line.textContent = `The ${things} stayed back there.`;
    } else if (state === "parked") {
      line.textContent = `The ${things} will open again when you come back.`;
    } else if (state === "behind") {
      line.textContent = `The ${things} ${pick ? "are" : "is"} behind you.`;
    } else if (!left && !right) {
      line.textContent = pick
        ? "Tap the one you think is right."
        : "Your word shows on the sign.";
    } else if (!pick) {
      line.textContent = `The sign is to your ${left ? "left" : "right"}.`;
    } else if (!seen && !(left && right)) {
      line.textContent = `The answers are to your ${left ? "left" : "right"}.`;
    } else if (left && right) {
      line.textContent = `${left} more to your left, ${right} to your right.`;
    } else {
      line.textContent = `${left || right} more to your ${left ? "left" : "right"}.`;
    }
  };

  q.sync = () => {
    box.className = q.whole ? "whole" : "";
    const open = !q.result;
    echo.hidden = q.whole || (open && q.tries === 0);
    echo.textContent = block.ask;
    line.hidden = !open;
    acts.hidden = !open;
    asTiles.hidden = !pick || q.tiles;
    tiles.hidden = !pick || !(q.tiles || q.whole);
    typed.hidden = pick;
    for (const b of tiles.children) {
      const i = Number(b.dataset.a);
      b.className = `a ${tileClass(block, q, i)}`;
      b.disabled = !open || q.crossed.includes(i);
    }
    if (!pick) {
      const wrongNow = q.tries > 0 && q.typed === q.picked;
      field.classList.toggle("right", q.result === "right");
      field.classList.toggle("wrong", q.result === "wrong" || wrongNow);
      field.readOnly = !open;
      check.hidden = !open;
    }
    stamp.hidden = open;
    if (!open) {
      const said = pick ? block.answers[q.picked]?.text : q.typed;
      stamp.textContent = `You answered: ${said ?? ""}`;
      if (block.showScore) {
        const plus = document.createElement("span");
        plus.className = q.earned ? "plus" : "plus none";
        plus.textContent = q.earned ? `+${q.earned}` : "No points";
        stamp.append(plus);
      }
    }
    again.hidden = !q.whole || !!block.done;
  };

  const submit = async () => {
    if (q.result || q.checking || !q.typed.trim()) return;
    q.checking = true;
    const said = q.typed;
    const right = await typedIsRight(block, said);
    q.checking = false;
    if (right === null) {
      line.textContent = "This page needs https to check a word.";
      return;
    }
    if (said === q.typed) judge(block, q, env, right, said);
  };

  box.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-a]");
    if (tile) {
      const i = Number(tile.dataset.a);
      if (!q.result && !q.crossed.includes(i))
        judge(block, q, env, block.answers[i].right, i);
      return;
    }
    if (e.target === check) submit();
    const act = e.target.closest("[data-do]")?.dataset.do;
    if (act === "bring") q.bring?.();
    if (act === "tiles") {
      q.tiles = true;
      q.sync();
    }
  });
  field.addEventListener("input", () => {
    q.typed = field.value;
    check.disabled = !q.typed.trim();
    q.repaint?.();
    q.sync();
  });
  field.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  });

  const points = block.showScore ? ` - ${block.points} points` : "";
  if (q.whole) {
    env.say(block.ask, { ask: true, eyebrow: "Question done" });
    q.sync();
    env.done();
  } else if (q.tries > 0) {
    env.say(block.say.retry, { mood: "doubt", eyebrow: retryEyebrow(block) });
  } else {
    env.say(block.ask, { ask: true, eyebrow: `A question${points}` });
  }
  q.sync();
  q.showLine("deal");
  return {
    dispose() {
      q.showLine = q.sync = null;
      q.el = null;
    },
  };
}

export const kind = {
  name: NAME,

  read(v, _view, tools) {
    const typed = v.answerBy === "typed";
    const ask = tools.requiredText(v, "ask", { max: 220 });
    const wanted = Number(v.right ?? 0);
    const answers = (Array.isArray(v.answers) ? v.answers : [])
      .slice(0, 4)
      .map((a, i) => ({
        text: typeof a?.text === "string" ? a.text.trim().slice(0, 64) : "",
        right: i === wanted,
      }))
      .filter((a) => a.text);
    if (!typed && answers.length < 2)
      throw new Error("A question needs at least two answers");
    if (!typed && !answers.some((a) => a.right)) answers[0].right = true;
    const say = v.say ?? {};
    const result = v.done?.result;
    return {
      key: JSON.stringify([ask, typed, answers]),
      typed,
      ask,
      answers,
      placeholder: typeof v.placeholder === "string" ? v.placeholder : "Type it",
      salt: typeof v.salt === "string" ? v.salt : "",
      sha256: Array.isArray(v.sha256) ? v.sha256 : [],
      // A saved tour holds only the hashes. This is the creator's draft before that save.
      accept: String(v.accept ?? "")
        .split(",")
        .map(normalise)
        .filter(Boolean),
      retry: v.retry !== false,
      points: clamp(Math.round(Number(v.points) || 10), 0, 1000),
      showScore: v.showScore === true,
      say: {
        right: "That is the one.",
        retry: "Not quite. Have another try.",
        wrong: "Not quite. The sign with the tick was the one.",
        ...tools.optionalText(say, "right", { max: 200 }),
        ...tools.optionalText(say, "retry", { max: 200 }),
        ...tools.optionalText(say, "wrong", { max: 200 }),
      },
      fanWidth: clamp(Number(v.fanWidth) || 100, 60, 160),
      reach: tools.metres(v.reach ?? 2.5, "reach", [2, 3]),
      preview: { x: v.preview?.x ?? 0, z: v.preview?.z ?? 0 },
      ...(result === "right" || result === "wrong" ? { done: v.done } : {}),
    };
  },

  fields: [
    { name: "ask", label: "Question", prose: true, max: 220 },
    {
      name: "answerBy",
      label: "Answered by",
      type: "choice",
      options: [
        ["pick", "Tapping a sign"],
        ["typed", "Typing a word"],
      ],
    },
    { name: "answers.0.text", label: "Answer 1", max: 64 },
    { name: "answers.1.text", label: "Answer 2", max: 64 },
    { name: "answers.2.text", label: "Answer 3", max: 64 },
    { name: "answers.3.text", label: "Answer 4 (optional)", max: 64 },
    {
      name: "right",
      label: "The right answer",
      type: "choice",
      options: [
        ["0", "Answer 1"],
        ["1", "Answer 2"],
        ["2", "Answer 3"],
        ["3", "Answer 4"],
      ],
    },
    { name: "accept", label: "Typed: accepted words, comma between them" },
    { name: "retry", label: "A second try after a wrong answer", type: "toggle" },
    { name: "points", label: "Points", type: "number", min: 0, max: 1000, step: 1 },
    { name: "showScore", label: "Show the points", type: "toggle" },
    { name: "say.right", label: "Guide says when right", prose: true },
    { name: "say.retry", label: "Guide says before the second try", prose: true },
    { name: "say.wrong", label: "Guide says when wrong", prose: true },
    {
      name: "fanWidth",
      label: "Fan width, degrees",
      type: "range",
      min: 60,
      max: 160,
      step: 5,
    },
    { name: "reach", label: "Reach, metres", type: "range", min: 2, max: 3, step: 0.1 },
    { name: "preview", label: "Example visitor", type: "place" },
  ],

  world: fanWorld,
  card: fanCard,
};
