// Travelling surface, round 1, variant D - words over the circle. Throwaway prototype: not wired
// to the app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the circle's centre on the ground, no scene, camera, renderer, frame
// loop or document access, words drawn on Canvas 2D textures. The page (circle.js) owns the
// voice's clock, the camera and the HUD; it hands this part what to draw and where the viewer
// stands.
//
// The part is a narration circle (a dashed rim on the ground, a plume of motes at the centre, a
// name plate above it) with a words plate in one of three places: standing at the far rim, lying
// on the ground just inside the near rim, or floating at eye height over the centre. The plate's
// canvas is the narration box itself: the page shows the same texture at the bottom edge of the
// screen when the plate cannot be read, so the words are one object in two places, never two.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The words plate's canvas, shared by the plate and the docked box (as in the sign speaks 6.2).
 * The line measure is fixed at 17 em, so the plate and the box break the lines at the same words.
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

/**
 * The three places for the words. letterM is the font size in the world (one canvas pixel is
 * letterM / fontPx metres); the plate's size follows from it.
 * - stand: an upright board on two posts at the far rim, its centre 1.5 m up; big letters, since
 *   it is read across the whole circle.
 * - lie: flat on the ground, 1.4 m inside the near rim (the side the route arrives from), read
 *   while looking down; small, so it fits the screen from where the visitor stands over it.
 * - float: upright at eye height over the centre, sized to be read from the rim; read walking in
 *   and from the rim, but closer than about 3 m it is wider than the screen, and the visitor
 *   standing in the centre stands inside it.
 */
export const PLACES = {
  stand: { letterM: 0.17, label: "standing at the far edge" },
  lie: { letterM: 0.07, label: "lying at the near edge" },
  float: { letterM: 0.14, label: "floating over the centre" },
};
for (const p of Object.values(PLACES)) {
  p.metresPerPx = p.letterM / WORDS.fontPx;
  p.widthM = WORDS.canvasW * p.metresPerPx;
  p.heightM = WORDS.canvasH * p.metresPerPx;
}
const STAND_CENTRE_M = 1.5;
const FLOAT_CENTRE_M = 1.7;
const LIE_INSET_M = 1.4;
const NAME_PLATE = { w: 640, h: 200, widthM: 1.6, centreM: 3.95 };
const PLUME = { count: 140, heightM: 3.4 };

const FONT_UI =
  '"Corbel", "Noto Sans", ui-rounded, "Segoe UI", "Roboto", system-ui, sans-serif';
const FONT_TITLE = 'Georgia, "Noto Serif", "Times New Roman", serif';
const SPEAKER = { name: "Narrator", color: "#f9a8d4" };
/** The sounds' warm palette (as the app's warm glow). */
const WARM = {
  rim: [1.0, 0.75, 0.32],
  glow: [1.0, 0.82, 0.45],
  spark: [1.0, 0.96, 0.86],
  ink: [0.078, 0.086, 0.11],
};
const NAME_LINES = {
  outside: "Walk into the circle to listen",
  away: "Paused while you are outside",
  idle: "Has a voice",
  playing: "Speaking",
  paused: "Paused",
  ended: "Heard to the end",
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
  const transcript =
    typeof r.transcript === "string" ? r.transcript.trim() : "";
  if (!transcript) {
    problems.push("no transcript: nothing to read along");
  }
  let radiusM = Number(r.radiusM);
  if (!Number.isFinite(radiusM) || radiusM < 2 || radiusM > 30) {
    radiusM = 6;
    problems.push("radius missing or out of 2 to 30 m: 6 m");
  }
  const wordsAt = Object.hasOwn(PLACES, r.wordsAt) ? r.wordsAt : "stand";
  const voice = typeof r.audio === "string" && r.audio ? "ok" : "missing";
  if (voice === "missing") {
    problems.push("voice file missing");
  }
  return {
    block: {
      title,
      transcript,
      radiusM,
      wordsAt,
      words: r.words === "screen" ? "screen" : "circle",
      voice,
      synthetic: r.synthetic !== false,
    },
    problems,
  };
}

/** Every asset id the views may read: none, the voice here is a generated tone. */
export function assets() {
  return [];
}

/** The editor's fields for these choices, as data. */
export function fields() {
  return [
    {
      key: "words",
      label: "While the voice plays, show the words",
      type: "choice",
      options: [
        ["circle", "Over the circle, while they can be read"],
        ["screen", "On screen, in the box"],
      ],
      help: "Over the circle, the words move into the box whenever they are out of view, too small or seen too flat, and back when they can be read again. The visitor's own tour-wide choice wins.",
    },
    {
      key: "wordsAt",
      label: "Where the words stand",
      type: "choice",
      options: Object.entries(PLACES).map(([k, p]) => [k, p.label]),
    },
  ];
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * The words plate's text layout and drawing (as the sign speaks 6.2). Exposed so the page knows
 * the lines (for scrolling and scrubbing) and can map a touch to the badge.
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

    // the speaker line: the speaker's dot, the name in bold, the AI voice badge, then the hint
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

const vec3 = (c) => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;

/** The ground: a dashed rim at the radius with a soft halo, a glow at the centre, a wave while
 *  the voice plays. One quad, one draw, no depth written. */
function groundDisc(radiusM, keep) {
  const size = 2 * (radiusM + 0.8);
  const mat = keep(
    new ShaderMaterial({
      uniforms: {
        radius: { value: radiusM },
        time: { value: 0 },
        live: { value: 0 },
        inside: { value: 0 },
      },
      vertexShader:
        "varying vec2 vXZ;\nvoid main() {\n  vXZ = position.xy;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
      fragmentShader: `uniform float radius;
uniform float time;
uniform float live;
uniform float inside;
varying vec2 vXZ;
void main() {
  float d = length(vXZ);
  float aa = max(fwidth(d), 0.004);
  float ang = atan(vXZ.y, vXZ.x);
  float dash = step(0.42, fract(ang * radius / 0.7));
  float band = 1.0 - smoothstep(0.06, 0.06 + aa * 1.5, abs(d - radius));
  float edge = 1.0 - smoothstep(0.11, 0.11 + aa * 1.5, abs(d - radius));
  float halo = smoothstep(radius - 0.9, radius, d) * step(d, radius) * 0.22;
  float centre = exp(-d * d / 0.9) * (0.45 + 0.25 * inside);
  float wf = fract(time * 0.28);
  float wave = live * (1.0 - smoothstep(0.0, 0.35, abs(d - wf * radius))) * (1.0 - wf) * 0.35;
  float rimA = band * dash;
  float inkA = (edge - band) * dash;
  vec3 col = mix(${vec3(WARM.glow)}, ${vec3(WARM.spark)}, centre);
  col = mix(col, ${vec3(WARM.rim)}, rimA);
  col = mix(col, ${vec3(WARM.ink)}, inkA);
  float a = max(max(rimA * 0.95, inkA * 0.55), max(halo + wave, centre));
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
    }),
  );
  const mesh = new Mesh(keep(new PlaneGeometry(size, size)), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.014;
  mesh.renderOrder = 1;
  return mesh;
}

/** The plume: motes rising from the centre, widening and turning; one draw. Fades near the
 *  viewer so a visitor standing in it is not blinded. */
function plume(keep) {
  const seeds = new Float32Array(PLUME.count * 3);
  let a = 12345;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  for (let i = 0; i < PLUME.count; i++) {
    seeds[i * 3] = rnd() * Math.PI * 2;
    seeds[i * 3 + 1] = rnd();
    seeds[i * 3 + 2] = 0.7 + rnd() * 0.6;
  }
  const geo = keep(new BufferGeometry());
  geo.setAttribute("position", new BufferAttribute(seeds, 3));
  const mat = keep(
    new ShaderMaterial({
      uniforms: {
        rise: { value: 0 },
        halfH: { value: 400 },
        dim: { value: 1 },
      },
      vertexShader: `uniform float rise;
uniform float halfH;
varying float vA;
void main() {
  float f = fract(position.y + rise * position.z / ${PLUME.heightM.toFixed(1)});
  float h = f * ${PLUME.heightM.toFixed(1)};
  float r = 0.12 + h * 0.22;
  float ang = position.x + rise * 0.35 + h * 0.6;
  vec4 mv = modelViewMatrix * vec4(cos(ang) * r, h, sin(ang) * r, 1.0);
  float dist = -mv.z;
  vA = smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.7, 1.0, f)) * smoothstep(0.8, 2.0, dist);
  gl_PointSize = clamp(0.07 * projectionMatrix[1][1] * halfH / max(dist, 0.1), 1.5, 18.0);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `uniform float dim;
varying float vA;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p);
  float a = (1.0 - smoothstep(0.15, 0.5, r)) * vA * dim;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(${vec3(WARM.glow)}, ${vec3(WARM.spark)}, 1.0 - r * 2.0), a);
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** The name plate above the plume: the title and one line (what to do, or what the voice does). */
function paintName(g, title, line) {
  const { w: W, h: H } = NAME_PLATE;
  g.clearRect(0, 0, W, H);
  roundRect(g, 4, 4, W - 8, H - 8, 28);
  g.fillStyle = "rgb(20 24 36 / 0.78)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgb(255 210 140 / 0.55)";
  g.stroke();
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fff";
  g.font = `600 52px ${FONT_TITLE}`;
  g.fillText(title, 34, 92, W - 68);
  g.font = `600 32px ${FONT_UI}`;
  g.fillStyle = "rgb(255 220 160 / 0.92)";
  g.fillText(line, 34, 154, W - 68);
}

/**
 * The world view: { object, tapTarget, plate, words, setPlace, show, update, dispose }.
 * - plate: the words plate mesh, in canvas pixels (its scale is metres per pixel); the page shows
 *   or hides it and reads its matrix to fly it.
 * - words: { texture, setText, paint, badge } of the shared canvas.
 * - setPlace(name): stand | lie | float.
 * - show(state, inside): idle | playing | paused | ended, and whether the visitor is inside; a
 *   voice held while outside is "away".
 * - update(frame): frame.viewer (position in the part's parent frame), frame.turns (the plate turns
 *   about the upright axis to face the viewer), frame.dt, frame.halfH (half the drawing height in
 *   px, for the motes' size).
 */
export function world(block, env) {
  const object = new Group();
  object.name = "words-over-the-circle";
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };
  const R = block.radiusM;

  const ground = groundDisc(R, keep);
  object.add(ground);
  const motes = plume(keep);
  object.add(motes);

  // the unseen column a tap is cast against
  const tapTarget = new Mesh(
    keep(new CylinderGeometry(0.7, 0.7, PLUME.heightM, 12)),
    keep(new MeshBasicMaterial({ visible: false })),
  );
  tapTarget.position.y = PLUME.heightM / 2;
  object.add(tapTarget);

  const nameCanvas = new OffscreenCanvas(NAME_PLATE.w, NAME_PLATE.h);
  const ng = nameCanvas.getContext("2d");
  const nameTex = keep(env.canvasTexture(nameCanvas));
  const nameHolder = new Group();
  nameHolder.position.y = NAME_PLATE.centreM;
  const nameMesh = new Mesh(
    keep(
      new PlaneGeometry(
        NAME_PLATE.widthM,
        (NAME_PLATE.widthM * NAME_PLATE.h) / NAME_PLATE.w,
      ),
    ),
    keep(
      new MeshBasicMaterial({
        map: nameTex,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
      }),
    ),
  );
  nameHolder.add(nameMesh);
  object.add(nameHolder);
  let nameLine = "";

  // the words plate, in a holder that places and turns it
  const holder = new Group();
  object.add(holder);
  const words = makeWords(env);
  const plate = new Mesh(
    keep(new PlaneGeometry(WORDS.canvasW, WORDS.canvasH)),
    keep(
      new MeshBasicMaterial({
        map: words.texture,
        transparent: true,
        fog: false,
        toneMapped: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    ),
  );
  plate.name = "words-plate";
  plate.renderOrder = 3;
  holder.add(plate);

  // the standing board's two posts
  const postMat = keep(new MeshBasicMaterial({ color: 0x2a2f3a }));
  const postBottom = STAND_CENTRE_M - PLACES.stand.heightM / 2;
  const postGeo = keep(new CylinderGeometry(0.035, 0.04, postBottom, 8));
  const posts = [-1, 1].map((sgn) => {
    const p = new Mesh(postGeo, postMat);
    p.position.set((sgn * PLACES.stand.widthM) / 2.6, postBottom / 2, -0.02);
    holder.add(p);
    return p;
  });

  let placeName = "";
  let yawNow = 0;
  let yawKnown = false;
  function setPlace(name) {
    const p = PLACES[name] ? name : "stand";
    if (p === placeName) {
      return;
    }
    placeName = p;
    const s = PLACES[p].metresPerPx;
    plate.scale.setScalar(s);
    plate.rotation.set(0, 0, 0);
    yawKnown = false;
    if (p === "stand") {
      holder.position.set(0, 0, -R);
      plate.position.set(0, STAND_CENTRE_M, 0);
    } else if (p === "float") {
      holder.position.set(0, 0, 0);
      plate.position.set(0, FLOAT_CENTRE_M, 0);
    } else {
      holder.position.set(0, 0, R - LIE_INSET_M);
      plate.position.set(0, 0.03, 0);
      // lying flat, the text's top away from the viewer
      plate.rotation.x = -Math.PI / 2;
    }
    posts.forEach((m) => {
      m.visible = p === "stand";
    });
  }
  setPlace(block.wordsAt);

  let state = "idle";
  let inside = false;
  let rise = 0;
  function show(st, isInside) {
    state = st;
    inside = isInside;
    const line = isInside
      ? NAME_LINES[st] || NAME_LINES.idle
      : st === "away"
        ? NAME_LINES.away
        : NAME_LINES.outside;
    if (line !== nameLine) {
      nameLine = line;
      paintName(ng, block.title, line);
      nameTex.needsUpdate = true;
    }
  }
  show("idle", false);

  const RISE_RATE = { idle: 0.45, playing: 1.1, paused: 0.25, ended: 0.12 };
  return {
    object,
    tapTarget,
    plate,
    words,
    setPlace,
    show,
    get place() {
      return placeName;
    },
    update(frame) {
      if (env.mode === "edit" || !frame || !frame.viewer) {
        return;
      }
      const dt = Math.min(0.1, frame.dt || 0);
      rise += dt * (RISE_RATE[state] ?? RISE_RATE.idle);
      motes.material.uniforms.rise.value = rise;
      motes.material.uniforms.halfH.value = frame.halfH || 400;
      // floating words stand in the plume: the motes step back while the words are shown there
      const behindWords = placeName === "float" && plate.visible;
      motes.material.uniforms.dim.value =
        (state === "ended" ? 0.5 : 1) * (behindWords ? 0.15 : 1);
      const gu = ground.material.uniforms;
      gu.time.value += dt;
      gu.live.value += ((state === "playing" ? 1 : 0) - gu.live.value) * 0.08;
      gu.inside.value = inside ? 1 : 0;

      const v = frame.viewer;
      nameHolder.rotation.y = Math.atan2(
        v.x - object.position.x,
        v.z - object.position.z,
      );
      // the plate turns about the upright axis to the viewer; it holds still while the viewer
      // stands almost over it, and eases so a viewer walking past does not spin it
      const dx = v.x - object.position.x - holder.position.x;
      const dz = v.z - object.position.z - holder.position.z;
      let want = frame.turns ? Math.atan2(dx, dz) : 0;
      if (frame.turns && Math.hypot(dx, dz) < 0.8) {
        want = yawNow;
      }
      if (!yawKnown) {
        yawNow = want;
        yawKnown = true;
      } else {
        let d = want - yawNow;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yawNow += d * (1 - Math.exp(-dt * 5));
      }
      holder.rotation.y = yawNow;
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
