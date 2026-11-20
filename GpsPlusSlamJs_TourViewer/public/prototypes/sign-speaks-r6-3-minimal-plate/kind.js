/**
 * Sign speaks 6.3 - the sign is the speaker, the words stay near. Throwaway prototype, written
 * to the item prototype rule so its world view could ship: three only, by named imports;
 * metres, Y up, origin at the foot; words in the world are Canvas 2D textures; no lights or sky
 * of its own; it never touches the scene, the camera, the renderer, the frame loop or
 * `document`.
 *
 * - The sign says only who speaks and the state: the speaker's name and the AI voice mark, one
 *   state word (Listen, Speaking, Paused, Heard it all, No voice) and one hint. The speaker's
 *   disc beside them pulses while the voice speaks; the pulse is drawn in a shader, so the
 *   sign's canvas is redrawn only when the state changes.
 * - The plate hanging under it carries only the line being spoken and the next one, in larger
 *   type; its canvas is redrawn when a word lights up and while the lines move.
 *
 * Halves: `read(record)`, `assets(block)`, `fields(view)`, `world(block, env)`.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The sign's face: canvas px, metres, centre height. */
export const SIGN = { wPx: 1024, hPx: 352, wM: 1.8, cyM: 2.32 };
SIGN.hM = (SIGN.wM * SIGN.hPx) / SIGN.wPx;

/** The plate: canvas px, metres, centre height, the words' type and its two rows. */
export const PLATE = {
  wPx: 1024,
  hPx: 288,
  wM: 1.8,
  cyM: 1.6,
  fontPx: 80,
  linePx: 104,
  padX: 54,
  rows: 2,
};
PLATE.hM = (PLATE.wM * PLATE.hPx) / PLATE.wPx;
PLATE.mPerPx = PLATE.wM / PLATE.wPx;
/** One em of the plate's words, in metres (before the sign grows). */
PLATE.emM = PLATE.fontPx * PLATE.mPerPx;
PLATE.lineM = PLATE.linePx * PLATE.mPerPx;
PLATE.textTopPx = (PLATE.hPx - PLATE.rows * PLATE.linePx) / 2;
/** The words' box on the plate, in the plate's own metres (for "is all of it in view"). */
PLATE.textHalfW = PLATE.wM / 2 - PLATE.padX * PLATE.mPerPx;
PLATE.textHalfH = (PLATE.rows * PLATE.linePx * PLATE.mPerPx) / 2;

const PLATE_FONT = `600 ${PLATE.fontPx}px "Noto Sans", "Segoe UI", Roboto, system-ui, sans-serif`;
const SIGN_FONT = '"Noto Sans", "Segoe UI", Roboto, system-ui, sans-serif';

/** Sign growth: the far sign grows with distance, from 4.5 m, at most 1.6 times. */
export const GROWTH = { fromM: 4.5, max: 1.6 };
export function growthScale(distanceM, on) {
  return on ? clamp(distanceM / GROWTH.fromM, 1, GROWTH.max) : 1;
}

const TITLE_MAX = 60;
const TEXT_MAX = 4000;
const NAME_MAX = 30;

/** The record as the kind uses it, and what it had to fix. `words` defaults to "screen". */
export function read(record) {
  const problems = [];
  const raw = record !== null && typeof record === "object" ? record : {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  let title = str(raw.title);
  if (title.length > TITLE_MAX) {
    title = title.slice(0, TITLE_MAX);
    problems.push(`title cut to ${TITLE_MAX} characters`);
  }
  let text = str(raw.text);
  if (text.length > TEXT_MAX) {
    text = text.slice(0, TEXT_MAX);
    problems.push(`text cut to ${TEXT_MAX} characters`);
  }
  if (text === "") {
    problems.push("no text: the plate stays empty");
  }
  const sp =
    raw.speaker !== null && typeof raw.speaker === "object" ? raw.speaker : {};
  let name = str(sp.name) || "Narrator";
  if (name.length > NAME_MAX) {
    name = name.slice(0, NAME_MAX);
    problems.push(`speaker cut to ${NAME_MAX} characters`);
  }
  const color = /^#[0-9a-f]{6}$/i.test(str(sp.color))
    ? str(sp.color)
    : "#f9a8d4";
  const voice = str(raw.voice) || null;
  if (!voice) {
    problems.push("no voice file: the sign says No voice");
  }
  const words = raw.words === "sign" ? "sign" : "screen";
  if (
    raw.words !== undefined &&
    raw.words !== "sign" &&
    raw.words !== "screen"
  ) {
    problems.push("unknown words place: on screen");
  }
  return {
    block: {
      title: title || "Untitled",
      text,
      speaker: { name, color },
      synthetic: raw.synthetic === true,
      voice,
      words,
    },
    problems,
  };
}

/** Every asset the world view may read: the voice. */
export function assets(block) {
  return block && block.voice ? [block.voice] : [];
}

/** The editor's field for the narrated text, as data: where its words show while it plays. */
export function fields() {
  return [
    {
      key: "words",
      label: "Words while the voice plays",
      kind: "choice",
      only: "with a voice",
      default: "screen",
      options: [
        { value: "screen", label: "On screen" },
        { value: "sign", label: "On the sign" },
      ],
    },
  ];
}

/** Word-wrap for the plate: `lineOf[i]` per word, greedy, within `maxW` px. */
export function wrapWords(texts, measure, maxW) {
  const lineOf = [];
  let line = 0;
  let cur = "";
  texts.forEach((w, i) => {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxW) {
      line++;
      cur = w;
    } else {
      cur = next;
    }
    lineOf[i] = line;
  });
  return lineOf;
}

// ---------- the sign's face ----------

const STATE_WORD = {
  far: "Listen",
  listen: "Listen",
  speaking: "Speaking",
  paused: "Paused",
  ended: "Heard it all",
  novoice: "No voice",
};
const STATE_CODE = {
  listen: 0,
  speaking: 1,
  paused: 2,
  ended: 3,
  novoice: 4,
  far: 5,
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function paintSign(g, block, minutes, state, hint) {
  const { wPx: W, hPx: H } = SIGN;
  g.clearRect(0, 0, W, H);
  roundRect(g, 6, 6, W - 12, H - 12, 34);
  g.fillStyle = "rgb(26 30 44)";
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "rgb(255 255 255 / 0.55)";
  g.stroke();
  // the disc's place (the shader draws the disc and its pulse over it)
  const x = 372;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#f2971f";
  g.font = `700 30px ${SIGN_FONT}`;
  g.letterSpacing = "4px";
  g.fillText(
    `${block.title.toUpperCase()}  ·  ${minutes} MIN`.slice(0, 44),
    x,
    70,
  );
  g.letterSpacing = "0px";
  g.font = `700 50px ${SIGN_FONT}`;
  g.fillStyle = block.speaker.color;
  g.fillText(block.speaker.name, x, 134);
  if (block.synthetic) {
    const nameW = g.measureText(block.speaker.name).width;
    g.font = `700 26px ${SIGN_FONT}`;
    const label = "AI VOICE";
    const bw = g.measureText(label).width + 28;
    roundRect(g, x + nameW + 18, 100, bw, 40, 20);
    g.lineWidth = 3;
    g.strokeStyle = "rgb(255 255 255 / 0.7)";
    g.stroke();
    g.fillStyle = "rgb(255 255 255 / 0.85)";
    g.fillText(label, x + nameW + 32, 130);
  }
  g.font = `800 86px ${SIGN_FONT}`;
  g.fillStyle = state === "novoice" ? "rgb(255 255 255 / 0.62)" : "#fff";
  g.fillText(STATE_WORD[state] ?? "Listen", x, 232);
  g.font = `500 32px ${SIGN_FONT}`;
  g.fillStyle = "rgb(255 255 255 / 0.74)";
  g.fillText(hint.slice(0, 40), x, 292);
}

// ---------- the plate ----------

function paintPlate(g, view) {
  const { wPx: W, hPx: H, padX, linePx, textTopPx, rows } = PLATE;
  g.clearRect(0, 0, W, H);
  roundRect(g, 6, 6, W - 12, H - 12, 28);
  g.fillStyle = "rgb(22 26 38)";
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "rgb(255 255 255 / 0.5)";
  g.stroke();
  if (!view.texts.length) {
    return;
  }
  g.save();
  g.beginPath();
  g.rect(0, textTopPx - 6, W, rows * linePx + 12);
  g.clip();
  g.font = PLATE_FONT;
  g.textBaseline = "alphabetic";
  const space = g.measureText(" ").width;
  const first = Math.max(0, Math.floor(view.scroll));
  const last = Math.min(view.nLines - 1, Math.floor(view.scroll) + rows);
  const grey = `rgb(255 255 255 / ${view.grey})`;
  let i = view.firstWordOfLine[first] ?? 0;
  for (let k = first; k <= last; k++) {
    const y = textTopPx + (k - view.scroll) * linePx + linePx * 0.74;
    let xPos = padX;
    while (i < view.texts.length && view.lineOf[i] === k) {
      const w = view.texts[i];
      g.fillStyle = i <= view.lit ? "#fff" : grey;
      g.fillText(w, xPos, y);
      xPos += g.measureText(w).width + space;
      i++;
    }
  }
  g.restore();
}

// ---------- the pulse: a shader on a small square over the sign's disc ----------

const PULSE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PULSE_FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;
uniform float uState;
uniform vec3 uColor;
float band(float d, float w, float aa) { return 1.0 - smoothstep(w, w + aa, abs(d)); }
float box(vec2 p, vec2 c, vec2 h) { vec2 q = abs(p - c) - h; return max(q.x, q.y); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float aa = fwidth(r) * 1.5;
  float disc = 1.0 - smoothstep(0.40 - aa, 0.40 + aa, r);
  float rim = band(r - 0.425, 0.022, aa);
  float waves = 0.0;
  if (uState < 0.5 || uState > 4.5) {
    float ph = fract(uTime * 0.3);
    waves = (1.0 - ph) * 0.5 * band(r - (0.47 + ph * 0.5), 0.025, aa);
  } else if (uState < 1.5) {
    for (int i = 0; i < 3; i++) {
      float ph = fract(uTime * 0.85 + float(i) / 3.0);
      waves += (1.0 - ph) * (0.25 + 0.75 * uLevel) * band(r - (0.47 + ph * 0.5), 0.02 + 0.02 * uLevel, aa);
    }
  }
  vec3 discCol = uState > 3.5 && uState < 4.5 ? vec3(0.45) : uColor;
  // the glyph: a speaker, or two bars while paused, struck through without a voice
  float spk = min(box(p, vec2(-0.13, 0.0), vec2(0.065, 0.085)), max(box(p, vec2(0.0, 0.0), vec2(0.09, 0.2)), abs(p.y) - (0.085 + (p.x + 0.07) * 0.9)));
  float bars = min(box(p, vec2(-0.09, 0.0), vec2(0.045, 0.16)), box(p, vec2(0.09, 0.0), vec2(0.045, 0.16)));
  float glyphD = uState > 1.5 && uState < 2.5 ? bars : spk;
  float glyph = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, glyphD);
  if (uState > 3.5 && uState < 4.5) {
    glyph = max(glyph, band(dot(p, normalize(vec2(1.0, 1.0))), 0.03, aa) * step(r, 0.32));
  }
  vec3 col = mix(discCol, vec3(0.08, 0.09, 0.13), glyph * disc);
  col = mix(col, vec3(1.0), rim);
  float a = max(max(disc, rim), 0.0);
  vec3 waveCol = mix(uColor, vec3(1.0), 0.35);
  col = mix(waveCol, col, a);
  a = max(a, clamp(waves, 0.0, 1.0));
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

/**
 * The world view: `{ object, signMesh, plateMesh, tapTarget, update, setSign, setLevel,
 * setPlateWords, drawPlate, setPlateOpacity, dispose }`.
 * `env.canvasTexture(canvas)` gives a texture; `env.mode` is "play" or "edit".
 */
export function world(block, env) {
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };
  const root = new Group();
  root.name = "sign-speaks";
  const body = new Group();
  root.add(body);

  const post = keep(new CylinderGeometry(0.035, 0.035, 1, 10));
  const metal = keep(new MeshLambertMaterial({ color: 0x3a3f48 }));
  const postTop = SIGN.cyM + SIGN.hM / 2;
  for (const x of [-SIGN.wM / 2 - 0.06, SIGN.wM / 2 + 0.06]) {
    const m = new Mesh(post, metal);
    m.scale.y = postTop;
    m.position.set(x, postTop / 2, -0.03);
    body.add(m);
  }
  // hangers between the sign and the plate
  const plateTop = PLATE.cyM + PLATE.hM / 2;
  const signBottom = SIGN.cyM - SIGN.hM / 2;
  for (const x of [-PLATE.wM / 2 + 0.12, PLATE.wM / 2 - 0.12]) {
    const m = new Mesh(post, metal);
    m.scale.set(0.35, signBottom - plateTop + 0.02, 0.35);
    m.position.set(x, (signBottom + plateTop) / 2, -0.01);
    body.add(m);
  }
  const backing = keep(new BoxGeometry(1, 1, 1));
  const backMat = keep(new MeshLambertMaterial({ color: 0x23262e }));
  const signBack = new Mesh(backing, backMat);
  signBack.scale.set(SIGN.wM, SIGN.hM, 0.04);
  signBack.position.set(0, SIGN.cyM, -0.025);
  body.add(signBack);

  // the sign's face
  const signCanvas = new OffscreenCanvas(SIGN.wPx, SIGN.hPx);
  const sg = signCanvas.getContext("2d");
  const signTex = keep(env.canvasTexture(signCanvas));
  const signMat = keep(
    new MeshBasicMaterial({ map: signTex, transparent: true }),
  );
  const signMesh = new Mesh(keep(new PlaneGeometry(SIGN.wM, SIGN.hM)), signMat);
  signMesh.name = "sign-speaks-sign";
  signMesh.position.y = SIGN.cyM;
  body.add(signMesh);

  // the pulse over the disc
  const pulseMat = keep(
    new ShaderMaterial({
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uState: { value: 0 },
        // the shader writes its colour as it is, so the speaker's colour goes in unconverted
        uColor: {
          value: new Color().setHex(
            parseInt(block.speaker.color.slice(1), 16),
            LinearSRGBColorSpace,
          ),
        },
      },
    }),
  );
  const pulseSize = 0.62;
  const pulse = new Mesh(
    keep(new PlaneGeometry(pulseSize, pulseSize)),
    pulseMat,
  );
  pulse.position.set(
    -SIGN.wM / 2 + (196 / SIGN.wPx) * SIGN.wM,
    SIGN.cyM,
    0.006,
  );
  pulse.renderOrder = 2;
  body.add(pulse);

  // the plate
  const plateBack = new Mesh(backing, backMat);
  plateBack.scale.set(PLATE.wM, PLATE.hM, 0.03);
  plateBack.position.set(0, PLATE.cyM, -0.02);
  body.add(plateBack);
  const plateCanvas = new OffscreenCanvas(PLATE.wPx, PLATE.hPx);
  const pg = plateCanvas.getContext("2d");
  const plateTex = keep(env.canvasTexture(plateCanvas));
  const plateMat = keep(
    new MeshBasicMaterial({ map: plateTex, transparent: true, opacity: 1 }),
  );
  const plateMesh = new Mesh(
    keep(new PlaneGeometry(PLATE.wM, PLATE.hM)),
    plateMat,
  );
  plateMesh.name = "sign-speaks-plate";
  plateMesh.position.y = PLATE.cyM;
  body.add(plateMesh);

  // the amber ring on the ground, as the app's reading sign has
  const ringMat = keep(
    new MeshBasicMaterial({
      color: 0xf2971f,
      transparent: true,
      opacity: 0.75,
    }),
  );
  const ring = new Mesh(keep(new RingGeometry(1.15, 1.27, 48)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  root.add(ring);

  const minutes = Math.max(
    1,
    Math.round(block.text.split(/\s+/).filter(Boolean).length / 150),
  );
  let signKey = "";
  let signDraws = 0;
  let plateDraws = 0;
  let plateMs = 0;
  let plateView = {
    texts: [],
    lineOf: [],
    firstWordOfLine: [],
    nLines: 1,
    lit: -1,
    scroll: 0,
    grey: 0.5,
  };
  let plateKey = "";

  const part = {
    object: root,
    signMesh,
    plateMesh,
    tapTarget: signMesh,
    /** Turn to the viewer and grow with distance. `frame.viewer` is in the root's parent frame. */
    update(frame) {
      pulseMat.uniforms.uTime.value = frame.seconds ?? 0;
      if (env.mode === "edit" || !frame.viewer) {
        return;
      }
      const dx = frame.viewer.x - root.position.x;
      const dz = frame.viewer.z - root.position.z;
      if (frame.turn !== false) {
        body.rotation.y = Math.atan2(dx, dz);
      }
      body.scale.setScalar(
        growthScale(Math.hypot(dx, dz), frame.growth !== false),
      );
    },
    /** The sign's state and hint; the canvas is redrawn only when either changes. */
    setSign(state, hint = "") {
      const key = `${state}|${hint}`;
      pulseMat.uniforms.uState.value = STATE_CODE[state] ?? 0;
      if (key === signKey) {
        return false;
      }
      signKey = key;
      paintSign(sg, block, minutes, state, hint);
      signTex.needsUpdate = true;
      signDraws++;
      return true;
    },
    /** How loud the voice is now, 0..1 (the pulse's strength). */
    setLevel(v) {
      pulseMat.uniforms.uLevel.value = clamp(v, 0, 1);
    },
    /** Lays the words out on the plate: `{ lineOf, nLines }`. */
    setPlateWords(texts) {
      pg.font = PLATE_FONT;
      const lineOf = wrapWords(
        texts,
        (s) => pg.measureText(s).width,
        PLATE.wPx - 2 * PLATE.padX,
      );
      const nLines = Math.max(
        1,
        lineOf.length ? lineOf[lineOf.length - 1] + 1 : 1,
      );
      const firstWordOfLine = [];
      lineOf.forEach((k, i) => {
        if (firstWordOfLine[k] === undefined) {
          firstWordOfLine[k] = i;
        }
      });
      plateView = { ...plateView, texts, lineOf, firstWordOfLine, nLines };
      plateKey = "";
      return { lineOf, nLines };
    },
    /** Redraws the plate when the lit word, the scroll or the grey changed; true when it did. */
    drawPlate(lit, scroll, grey) {
      const s = Math.round(scroll * 200) / 200;
      const key = `${lit}|${s}|${grey}`;
      if (key === plateKey) {
        return false;
      }
      plateKey = key;
      const t0 = performance.now();
      plateView = { ...plateView, lit, scroll: s, grey };
      paintPlate(pg, plateView);
      plateTex.needsUpdate = true;
      plateMs = performance.now() - t0;
      plateDraws++;
      return true;
    },
    /** The plate's words fade with the plate; at 0 it is not drawn and takes no tap. */
    setPlateOpacity(a) {
      plateMat.opacity = clamp(a, 0, 1);
      plateMesh.visible = a > 0.01;
    },
    stats() {
      return { signDraws, plateDraws, plateMs };
    },
    dispose() {
      root.removeFromParent();
      for (const x of made) {
        x.dispose();
      }
    },
  };
  part.setSign("listen", "");
  part.setPlateOpacity(1);
  return part;
}
