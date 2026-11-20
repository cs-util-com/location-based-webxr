// Travelling surface, round 1, variant B - the screen comes with you. Throwaway prototype: not
// wired to the app, linked from nothing in it.
//
// The world half, written to the item prototype rule: three only by named imports, metres with
// Y up and the origin at the foot, no scene, camera, renderer, frame loop or document access,
// pictures drawn on Canvas 2D textures. The page (travelling-screen.js) owns the clip's clock, the
// camera and the HUD; it hands this part what to draw and where the viewer stands.
//
// The part is a free video: a `screen` (a dark slab on two legs with a title plate above) or a
// `porthole` (a round brass bezel showing the clip's centred square). The player surface - the
// picture, its captions and its control bar - is ONE canvas texture. The page shows that same
// texture in a corner of the screen while the video is docked, so the clip is one object in two
// places, never two pictures.
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
} from "three";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The player surface in canvas pixels: the picture area on top, the control bar below. The bar
 * is BAR tall so that in the docked player (about 220 px wide on a phone) each of its buttons is
 * at least 44 px square. The picture area is as tall as the clip's aspect asks, at most square: a
 * tall clip is pillarboxed in it.
 */
export const SURFACE = { w: 640, bar: 136, btn: 136, capPx: 40 };

/** The surface's layout for a clip of aspect (width / height). */
export function surfaceLayout(aspect) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const W = SURFACE.w;
  const PH = Math.round(Math.min(W / a, W));
  const H = PH + SURFACE.bar;
  // the clip itself, contained in the picture area
  let cw = W;
  let ch = W / a;
  if (ch > PH) {
    ch = PH;
    cw = PH * a;
  }
  const clip = { x: (W - cw) / 2, y: (PH - ch) / 2, w: cw, h: ch };
  const side = Math.min(cw, ch);
  const crop = {
    x: clip.x + (cw - side) / 2,
    y: clip.y + (ch - side) / 2,
    w: side,
    h: side,
  };
  const b = SURFACE.btn;
  const controls = {
    picture: { x: 0, y: 0, w: W, h: PH },
    play: { x: 0, y: PH, w: b, h: SURFACE.bar },
    cc: { x: W - 2 * b, y: PH, w: b, h: SURFACE.bar },
    sound: { x: W - b, y: PH, w: b, h: SURFACE.bar },
  };
  return { W, H, PH, clip, crop, controls };
}

/** A rect in canvas px as a uv rect [u0, v0, uw, vh] (v from the bottom, as three maps it). */
export function uvRectOf(r, L) {
  return [r.x / L.W, 1 - (r.y + r.h) / L.H, r.w / L.W, r.h / L.H];
}

const INK = "#f6f2ea";
const ACCENT = "#f1b45c";
const SLAB = 0x17191d;
const BEZEL = 0x8d6c42;
const FONT_UI =
  '"Corbel", "Noto Sans", ui-rounded, "Segoe UI", "Roboto", system-ui, sans-serif';
const FONT_TITLE = 'Georgia, "Noto Serif", "Times New Roman", serif';

/** The record as this kind uses it, and what had to be fixed. */
export function read(record) {
  const problems = [];
  const r = record && typeof record === "object" ? record : {};
  let title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) {
    title = "Untitled";
    problems.push("no title: shown as Untitled");
  }
  const view = r.view === "porthole" ? "porthole" : "screen";
  const widthM =
    Number.isFinite(r.widthM) && r.widthM > 0.2 ? Math.min(r.widthM, 8) : 1.6;
  const c = r.clip && typeof r.clip === "object" ? r.clip : {};
  const file = typeof c.file === "string" && c.file ? c.file : "";
  if (!file) {
    problems.push("clip file missing: the screen says so and never docks");
  }
  const aspect = Number.isFinite(c.aspect) && c.aspect > 0 ? c.aspect : 16 / 9;
  const duration =
    Number.isFinite(c.duration) && c.duration > 0 ? c.duration : 30;
  const scene = c.scene === "windmill" ? "windmill" : "harbour";
  const captions = Array.isArray(c.captions)
    ? c.captions
        .filter(
          (q) =>
            q &&
            Number.isFinite(q.start) &&
            Number.isFinite(q.end) &&
            q.end > q.start &&
            typeof q.text === "string",
        )
        .map((q) => ({ start: q.start, end: q.end, text: q.text.trim() }))
    : [];
  return {
    block: {
      title,
      view,
      widthM,
      clip: { ok: Boolean(file), aspect, duration, scene, captions },
    },
    problems,
  };
}

/** Every asset id the views may read: none, the clip here is drawn, not loaded. */
export function assets() {
  return [];
}

/** The editor's field for the docking choice, as data. */
export function fields() {
  return [
    {
      key: "dock",
      label: "When the visitor cannot watch it here",
      type: "choice",
      options: [
        ["playing", "Keep it in a corner of the screen while it plays"],
        ["always", "Keep it in a corner once started"],
      ],
      help: "The same clip leaves its place in the world and docks in a corner; it comes back when it can be watched there again. A stopped video never docks.",
    },
  ];
}

export function captionAt(captions, t) {
  for (const q of captions) {
    if (t >= q.start && t < q.end) {
      return q.text;
    }
  }
  return "";
}

// ---------- the synthetic clips: drawn from the clip's own time, so pausing freezes them ----------
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, f) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(" ")})`;
}

function drawHarbour(g, r, t, dur) {
  const { x, y, w, h } = r;
  const f = clamp(t / dur, 0, 1);
  const horizon = y + h * 0.6;
  const sky = g.createLinearGradient(0, y, 0, horizon);
  sky.addColorStop(0, mixHex("#2b2f5c", "#5d9cd4", f));
  sky.addColorStop(1, mixHex("#f4a261", "#d6ecf7", f));
  g.fillStyle = sky;
  g.fillRect(x, y, w, horizon - y);
  // the sun rises through the clip
  g.fillStyle = mixHex("#ff9f5a", "#fff2b8", f);
  g.beginPath();
  g.arc(x + w * 0.3, horizon - f * h * 0.42 + h * 0.04, h * 0.07, 0, Math.PI * 2);
  g.fill();
  // a far headland with a lighthouse
  g.fillStyle = mixHex("#3a3550", "#5b7088", f);
  g.beginPath();
  g.moveTo(x + w * 0.62, horizon);
  g.quadraticCurveTo(x + w * 0.8, horizon - h * 0.12, x + w, horizon - h * 0.08);
  g.lineTo(x + w, horizon);
  g.fill();
  g.fillStyle = "#e9e4dc";
  g.fillRect(x + w * 0.83, horizon - h * 0.27, w * 0.025, h * 0.17);
  g.fillStyle = "#c0392b";
  g.fillRect(x + w * 0.83, horizon - h * 0.21, w * 0.025, h * 0.03);
  if (Math.sin(t * 2.4) > 0.2) {
    g.fillStyle = "rgb(255 236 160 / 0.9)";
    g.beginPath();
    g.arc(x + w * 0.8425, horizon - h * 0.28, h * 0.018, 0, Math.PI * 2);
    g.fill();
  }
  // the sea, with moving waves
  g.fillStyle = mixHex("#1d3557", "#2a6f97", f);
  g.fillRect(x, horizon, w, y + h - horizon);
  g.strokeStyle = "rgb(255 255 255 / 0.28)";
  g.lineWidth = Math.max(1.5, h * 0.006);
  for (let row = 0; row < 5; row++) {
    const wy = horizon + h * (0.05 + row * 0.075);
    const amp = h * (0.006 + row * 0.003);
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = x + (w * i) / 24;
      const py = wy + Math.sin(i * 0.9 + t * (1.4 + row * 0.25) + row) * amp;
      if (i === 0) {
        g.moveTo(px, py);
      } else {
        g.lineTo(px, py);
      }
    }
    g.stroke();
  }
  // a boat crosses
  const bx = x + w * (-0.15 + 1.3 * f);
  const by = horizon + h * 0.13 + Math.sin(t * 2) * h * 0.012;
  g.fillStyle = "#2d2a26";
  g.beginPath();
  g.moveTo(bx - w * 0.07, by);
  g.lineTo(bx + w * 0.07, by);
  g.lineTo(bx + w * 0.05, by + h * 0.04);
  g.lineTo(bx - w * 0.05, by + h * 0.04);
  g.fill();
  g.fillRect(bx - 1.5, by - h * 0.2, 3, h * 0.2);
  g.fillStyle = "#f7f1e3";
  g.beginPath();
  g.moveTo(bx + 2, by - h * 0.19);
  g.lineTo(bx + w * 0.06, by - h * 0.02);
  g.lineTo(bx + 2, by - h * 0.02);
  g.fill();
  // two gulls
  g.strokeStyle = "rgb(30 30 40 / 0.75)";
  g.lineWidth = Math.max(1.5, h * 0.007);
  for (let i = 0; i < 2; i++) {
    const gx = x + ((t * (28 + i * 9) + i * 170) % (w + 60)) - 30;
    const gy = y + h * (0.2 + i * 0.08) + Math.sin(t * 3 + i) * h * 0.02;
    const s = h * 0.03;
    const flap = Math.sin(t * 7 + i) * s * 0.5;
    g.beginPath();
    g.moveTo(gx - s, gy - flap);
    g.quadraticCurveTo(gx - s * 0.4, gy - s * 0.6, gx, gy);
    g.quadraticCurveTo(gx + s * 0.4, gy - s * 0.6, gx + s, gy - flap);
    g.stroke();
  }
}

function drawWindmill(g, r, t, dur) {
  const { x, y, w, h } = r;
  const f = clamp(t / dur, 0, 1);
  const sky = g.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, mixHex("#4f86c6", "#7a5ea8", f));
  sky.addColorStop(1, mixHex("#cfe3f2", "#f2b880", f));
  g.fillStyle = sky;
  g.fillRect(x, y, w, h);
  // clouds drift
  g.fillStyle = "rgb(255 255 255 / 0.8)";
  for (let i = 0; i < 3; i++) {
    const cx = x + ((t * (10 + i * 4) + i * 230) % (w + 160)) - 80;
    const cy = y + h * (0.15 + i * 0.1);
    g.beginPath();
    g.ellipse(cx, cy, w * 0.09, h * 0.04, 0, 0, Math.PI * 2);
    g.ellipse(cx + w * 0.05, cy - h * 0.02, w * 0.06, h * 0.04, 0, 0, Math.PI * 2);
    g.fill();
  }
  // fields
  const bands = ["#6a994e", "#a7c957", "#d4a373", "#7f9f4e"];
  bands.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    const top = y + h * (0.62 + i * 0.09);
    g.moveTo(x, top + h * 0.03);
    g.quadraticCurveTo(x + w / 2, top - h * 0.04, x + w, top + h * 0.02);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.fill();
  });
  // the mill, its sails turning
  const mx = x + w * 0.5;
  const my = y + h * 0.42;
  g.fillStyle = "#efe6d6";
  g.beginPath();
  g.moveTo(mx - w * 0.06, y + h * 0.72);
  g.lineTo(mx + w * 0.06, y + h * 0.72);
  g.lineTo(mx + w * 0.035, my);
  g.lineTo(mx - w * 0.035, my);
  g.fill();
  g.fillStyle = "#8c5a3c";
  g.beginPath();
  g.moveTo(mx - w * 0.045, my + 2);
  g.lineTo(mx, my - h * 0.07);
  g.lineTo(mx + w * 0.045, my + 2);
  g.fill();
  g.save();
  g.translate(mx, my);
  g.rotate(t * 1.6);
  g.fillStyle = "rgb(250 245 235 / 0.95)";
  g.strokeStyle = "#5c4433";
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.fillRect(-w * 0.012, 0, w * 0.024, h * 0.3);
    g.strokeRect(-w * 0.012, 0, w * 0.024, h * 0.3);
  }
  g.restore();
  g.fillStyle = "#5c4433";
  g.beginPath();
  g.arc(mx, my, h * 0.02, 0, Math.PI * 2);
  g.fill();
}

function drawPlayGlyph(g, cx, cy, r, kind) {
  g.fillStyle = "rgb(15 17 21 / 0.72)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgb(255 255 255 / 0.55)";
  g.lineWidth = Math.max(2, r * 0.05);
  g.stroke();
  g.fillStyle = INK;
  if (kind === "replay") {
    g.lineWidth = r * 0.12;
    g.strokeStyle = INK;
    g.beginPath();
    g.arc(cx, cy, r * 0.42, -Math.PI * 0.35, Math.PI * 1.35);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + r * 0.2, cy - r * 0.62);
    g.lineTo(cx + r * 0.46, cy - r * 0.3);
    g.lineTo(cx + r * 0.08, cy - r * 0.22);
    g.fill();
    return;
  }
  g.beginPath();
  g.moveTo(cx - r * 0.3, cy - r * 0.42);
  g.lineTo(cx + r * 0.46, cy);
  g.lineTo(cx - r * 0.3, cy + r * 0.42);
  g.fill();
}

function drawSpeaker(g, cx, cy, s, on) {
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(cx - s * 0.5, cy - s * 0.18);
  g.lineTo(cx - s * 0.24, cy - s * 0.18);
  g.lineTo(cx + s * 0.06, cy - s * 0.44);
  g.lineTo(cx + s * 0.06, cy + s * 0.44);
  g.lineTo(cx - s * 0.24, cy + s * 0.18);
  g.lineTo(cx - s * 0.5, cy + s * 0.18);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = s * 0.08;
  g.lineCap = "round";
  if (on) {
    for (const k of [0.26, 0.44]) {
      g.beginPath();
      g.arc(cx + s * 0.06, cy, s * k, -0.8, 0.8);
      g.stroke();
    }
  } else {
    g.beginPath();
    g.moveTo(cx + s * 0.2, cy - s * 0.18);
    g.lineTo(cx + s * 0.5, cy + s * 0.18);
    g.moveTo(cx + s * 0.5, cy - s * 0.18);
    g.lineTo(cx + s * 0.2, cy + s * 0.18);
    g.stroke();
  }
  g.lineCap = "butt";
}

function fmt(s) {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

function wrap(g, text, maxW, maxLines) {
  const out = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      out.push(line);
      line = w;
      if (out.length === maxLines) {
        return out;
      }
    }
  }
  if (line && out.length < maxLines) {
    out.push(line);
  }
  return out;
}

/**
 * The player surface: one canvas, one texture, painted by the page's clock.
 * view: { t, playing, started, finished, sound, cc, hint, docked }; a porthole fits its captions
 * into its disc while in the world and uses the whole picture once docked.
 */
function makeSurface(block, env) {
  const L = surfaceLayout(block.clip.aspect);
  const canvas = new OffscreenCanvas(L.W, L.H);
  const g = canvas.getContext("2d");
  const texture = env.canvasTexture(canvas);
  const isPorthole = block.view === "porthole";

  function paint(view) {
    const { W, H, PH, clip, crop } = L;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0b0c0f";
    g.fillRect(0, 0, W, PH);
    if (!block.clip.ok) {
      g.fillStyle = "#1a1d23";
      g.fillRect(clip.x, clip.y, clip.w, clip.h);
      g.fillStyle = "rgb(255 255 255 / 0.78)";
      g.font = `600 34px ${FONT_UI}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const box = isPorthole ? crop : clip;
      wrap(g, "This video cannot be played here.", box.w * 0.7, 3).forEach(
        (line, i, all) =>
          g.fillText(
            line,
            box.x + box.w / 2,
            box.y + box.h / 2 + (i - (all.length - 1) / 2) * 42,
          ),
      );
      g.textAlign = "left";
    } else {
      g.save();
      g.beginPath();
      g.rect(clip.x, clip.y, clip.w, clip.h);
      g.clip();
      const t = view.started ? view.t : 0;
      if (block.clip.scene === "windmill") {
        drawWindmill(g, clip, t, block.clip.duration);
      } else {
        drawHarbour(g, clip, t, block.clip.duration);
      }
      g.restore();
      // captions inside the picture (inside the porthole's circle for a porthole)
      const cap =
        view.cc && view.started ? captionAt(block.clip.captions, view.t) : "";
      if (cap) {
        const disc = isPorthole && !view.docked;
        const box = disc ? crop : clip;
        const maxW = disc ? box.w * 0.62 : box.w - 60;
        g.font = `600 ${SURFACE.capPx}px ${FONT_UI}`;
        const lines = wrap(g, cap, maxW, 2);
        const lh = SURFACE.capPx * 1.22;
        const bottom = disc ? box.y + box.h * 0.8 : box.y + box.h - 16;
        const top = bottom - lines.length * lh;
        const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 28;
        g.fillStyle = "rgb(0 0 0 / 0.62)";
        g.beginPath();
        g.roundRect(box.x + (box.w - bw) / 2, top - 6, bw, lines.length * lh + 10, 10);
        g.fill();
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        lines.forEach((l, i) =>
          g.fillText(l, box.x + box.w / 2, top + (i + 0.82) * lh),
        );
        g.textAlign = "left";
      }
      if (!view.playing) {
        const box = isPorthole ? crop : clip;
        const r = Math.min(box.w, box.h) * 0.15;
        drawPlayGlyph(
          g,
          box.x + box.w / 2,
          box.y + box.h / 2,
          r,
          view.finished ? "replay" : "play",
        );
        if (view.hint) {
          g.font = `600 30px ${FONT_UI}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          const tw = g.measureText(view.hint).width + 28;
          const hy = box.y + box.h / 2 + r + 34;
          g.fillStyle = "rgb(0 0 0 / 0.55)";
          g.beginPath();
          g.roundRect(box.x + (box.w - tw) / 2, hy - 22, tw, 44, 22);
          g.fill();
          g.fillStyle = "#fff";
          g.fillText(view.hint, box.x + box.w / 2, hy + 1);
          g.textAlign = "left";
        }
      }
    }

    // the control bar: play, time and progress, CC, sound
    const y0 = PH;
    const bh = SURFACE.bar;
    const cy = y0 + bh / 2;
    g.fillStyle = "#121418";
    g.fillRect(0, y0, W, bh);
    g.fillStyle = "rgb(255 255 255 / 0.1)";
    g.fillRect(0, y0, W, 2);
    const b = SURFACE.btn;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(b / 2, cy, bh * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#16181c";
    if (view.playing) {
      g.fillRect(b / 2 - bh * 0.1, cy - bh * 0.12, bh * 0.07, bh * 0.24);
      g.fillRect(b / 2 + bh * 0.03, cy - bh * 0.12, bh * 0.07, bh * 0.24);
    } else {
      g.beginPath();
      g.moveTo(b / 2 - bh * 0.07, cy - bh * 0.13);
      g.lineTo(b / 2 + bh * 0.13, cy);
      g.lineTo(b / 2 - bh * 0.07, cy + bh * 0.13);
      g.fill();
    }
    const x0 = b + 8;
    const x1 = W - 2 * b - 10;
    const p = block.clip.ok
      ? clamp((view.started ? view.t : 0) / block.clip.duration, 0, 1)
      : 0;
    g.font = `600 34px ui-monospace, Consolas, monospace`;
    g.fillStyle = "#d9d4ca";
    g.textBaseline = "middle";
    g.fillText(
      block.clip.ok
        ? `${fmt(view.started ? view.t : 0)} / ${fmt(block.clip.duration)}`
        : "-:-- / -:--",
      x0,
      cy - 16,
    );
    g.fillStyle = "rgb(255 255 255 / 0.22)";
    g.fillRect(x0, cy + 22, x1 - x0, 8);
    g.fillStyle = ACCENT;
    g.fillRect(x0, cy + 22, (x1 - x0) * p, 8);
    // CC
    const ccx = W - 2 * b + b / 2;
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.beginPath();
    g.roundRect(ccx - 34, cy - 24, 68, 48, 9);
    if (view.cc) {
      g.fillStyle = INK;
      g.fill();
    }
    g.stroke();
    g.fillStyle = view.cc ? "#16181c" : INK;
    g.font = `800 28px ${FONT_UI}`;
    g.textAlign = "center";
    g.fillText("CC", ccx, cy + 1);
    g.textAlign = "left";
    drawSpeaker(g, W - b / 2, cy, bh * 0.42, view.sound);
    texture.needsUpdate = true;
  }

  return { texture, layout: L, paint, dispose: () => texture.dispose() };
}

/** The surface material: a uv crop and a round mask, so a porthole can show its square as a disc. */
const SURF_VERT =
  "varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}";
export const SURF_FRAG =
  "uniform sampler2D map;\nuniform vec4 uvRect;\nuniform float roundness;\nuniform float opacity;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(map, uvRect.xy + vUv * uvRect.zw);\n  float d = length(vUv - 0.5) * 2.0;\n  float mask = mix(1.0, 1.0 - smoothstep(0.985, 1.0, d), roundness);\n  gl_FragColor = vec4(c.rgb, c.a * mask * opacity);\n  #include <colorspace_fragment>\n}";

function surfaceMaterial(texture, uvRect, round) {
  return new ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uvRect: { value: uvRect },
      roundness: { value: round },
      opacity: { value: 1 },
    },
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
    transparent: true,
    side: DoubleSide,
  });
}

/** A face painted once: shown in the surface's world place while the clip is docked. */
function awayCanvas(w, h, round) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#0e1014";
  if (round) {
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillRect(0, 0, w, h);
  }
  // a picture-in-picture sign: the clip is in a corner of the screen now
  const s = Math.min(w, h) * 0.32;
  const x = w / 2 - s / 2;
  const y = h / 2 - s * 0.55;
  g.strokeStyle = "rgb(255 255 255 / 0.45)";
  g.lineWidth = Math.max(3, s * 0.04);
  g.beginPath();
  g.roundRect(x, y, s, s * 0.7, s * 0.06);
  g.stroke();
  g.fillStyle = "rgb(241 180 92 / 0.85)";
  g.beginPath();
  g.roundRect(x + s * 0.5, y + s * 0.36, s * 0.42, s * 0.28, s * 0.04);
  g.fill();
  g.fillStyle = "rgb(255 255 255 / 0.6)";
  g.font = `600 ${Math.round(Math.min(w, h) * 0.065)}px ${FONT_UI}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("playing on your screen", w / 2, y + s * 0.95);
  return c;
}

/**
 * The world view: { object, surface, away, tapTarget, player, update, dispose }.
 * - surface: { mesh, wM, hM, uvRect, round } - the mesh is a quad of wM x hM in its own frame; the
 *   page shows it while the clip is in the world and reads its matrix to fly it.
 * - away: the face shown in its place while the clip is docked.
 * - player: { texture, layout, paint } - the shared surface canvas.
 */
export function world(block, env) {
  const object = new Group();
  object.name = `video-${block.view}`;
  const made = [];
  const keep = (x) => {
    made.push(x);
    return x;
  };
  const player = makeSurface(block, env);
  const L = player.layout;
  const s = block.widthM / 1.6;
  let surface;
  let away;

  if (block.view === "porthole") {
    const D = block.widthM * 0.55;
    const centre = 1.6 * Math.max(1, s * 0.9);
    const front = new Group();
    front.position.y = centre;
    object.add(front);
    const uvRect = uvRectOf(L.crop, L);
    const mesh = new Mesh(
      keep(new PlaneGeometry(D, D)),
      keep(surfaceMaterial(player.texture, uvRect, 1)),
    );
    mesh.position.z = 0.07;
    mesh.renderOrder = 2;
    front.add(mesh);
    const awayTex = keep(env.canvasTexture(awayCanvas(512, 512, true)));
    away = new Mesh(
      keep(new CircleGeometry(D / 2, 48)),
      keep(new MeshBasicMaterial({ map: awayTex, toneMapped: false })),
    );
    away.position.z = 0.069;
    away.visible = false;
    front.add(away);
    const bezel = new Mesh(
      keep(new TorusGeometry(D / 2 + 0.03 * s, 0.035 * s, 12, 64)),
      keep(new MeshLambertMaterial({ color: BEZEL })),
    );
    bezel.position.z = 0.07;
    front.add(bezel);
    const back = new Mesh(
      keep(new CylinderGeometry(D / 2 + 0.09 * s, D / 2 + 0.09 * s, 0.04, 48)),
      keep(new MeshLambertMaterial({ color: SLAB })),
    );
    back.rotation.x = Math.PI / 2;
    back.position.z = 0.04;
    front.add(back);
    const post = new Mesh(
      keep(new CylinderGeometry(0.04 * s, 0.05 * s, centre, 10)),
      keep(new MeshLambertMaterial({ color: 0x2a2f3a })),
    );
    post.position.y = centre / 2;
    object.add(post);
    // the "Watch" label stays in the world; only the picture travels
    const lc = new OffscreenCanvas(640, 150);
    const lg = lc.getContext("2d");
    lg.fillStyle = "rgb(15 17 21 / 0.88)";
    lg.beginPath();
    lg.roundRect(20, 15, 600, 120, 60);
    lg.fill();
    lg.fillStyle = INK;
    lg.font = `650 50px ${FONT_UI}`;
    lg.textBaseline = "middle";
    lg.fillText(block.title.slice(0, 18), 60, 77);
    lg.font = "500 40px ui-monospace, Consolas, monospace";
    lg.fillStyle = "#c9c2b6";
    lg.textAlign = "right";
    lg.fillText(fmt(block.clip.duration), 590, 78);
    const label = new Mesh(
      keep(new PlaneGeometry(0.96 * s, 0.225 * s)),
      keep(
        new MeshBasicMaterial({
          map: keep(env.canvasTexture(lc)),
          transparent: true,
          toneMapped: false,
          side: DoubleSide,
        }),
      ),
    );
    label.position.set(0, -D / 2 - 0.27 * s, 0.07);
    front.add(label);
    surface = { mesh, wM: D, hM: D, uvRect, round: 1 };
  } else {
    const wM = block.widthM;
    const hM = (wM * L.H) / L.W;
    const pad = 0.045 * s;
    const bottom = 0.9;
    const centre = bottom + pad + hM / 2;
    const front = new Group();
    front.position.y = centre;
    object.add(front);
    const slab = new Mesh(
      keep(new BoxGeometry(wM + 2 * pad, hM + 2 * pad, 0.05)),
      keep(new MeshLambertMaterial({ color: SLAB })),
    );
    front.add(slab);
    const uvRect = [0, 0, 1, 1];
    const mesh = new Mesh(
      keep(new PlaneGeometry(wM, hM)),
      keep(surfaceMaterial(player.texture, uvRect, 0)),
    );
    mesh.position.z = 0.03;
    mesh.renderOrder = 2;
    front.add(mesh);
    const awayTex = keep(
      env.canvasTexture(awayCanvas(640, Math.round((640 * L.H) / L.W), false)),
    );
    away = new Mesh(
      keep(new PlaneGeometry(wM, hM)),
      keep(new MeshBasicMaterial({ map: awayTex, toneMapped: false })),
    );
    away.position.z = 0.029;
    away.visible = false;
    front.add(away);
    for (const side of [-1, 1]) {
      const leg = new Mesh(
        keep(new CylinderGeometry(0.035 * s, 0.04 * s, bottom, 8)),
        keep(new MeshLambertMaterial({ color: 0x2a2f3a })),
      );
      leg.position.set(side * wM * 0.35, bottom / 2, -0.02);
      object.add(leg);
    }
    // the title stays in the world; only the player travels
    const tc = new OffscreenCanvas(1024, 170);
    const tg = tc.getContext("2d");
    tg.fillStyle = "rgb(20 24 36 / 0.92)";
    tg.beginPath();
    tg.roundRect(4, 4, 1016, 162, 28);
    tg.fill();
    tg.fillStyle = "#f2971f";
    tg.font = `700 30px ${FONT_UI}`;
    tg.letterSpacing = "4px";
    tg.fillText(`WATCH  ·  ${fmt(block.clip.duration)}`, 44, 58);
    tg.letterSpacing = "0px";
    tg.fillStyle = "#fff";
    tg.font = `600 56px ${FONT_TITLE}`;
    tg.fillText(wrap(tg, block.title, 940, 1)[0] || "", 44, 130);
    const titleH = (wM * 170) / 1024;
    const title = new Mesh(
      keep(new PlaneGeometry(wM, titleH)),
      keep(
        new MeshBasicMaterial({
          map: keep(env.canvasTexture(tc)),
          transparent: true,
          toneMapped: false,
        }),
      ),
    );
    title.position.set(0, hM / 2 + pad + 0.04 + titleH / 2, 0.01);
    front.add(title);
    surface = { mesh, wM, hM, uvRect, round: 0 };
  }

  return {
    object,
    surface,
    away,
    tapTarget: surface.mesh,
    player,
    update() {
      // a free video stands as posed: it neither turns nor grows
    },
    dispose() {
      object.removeFromParent();
      player.dispose();
      for (const x of made) {
        x.dispose();
      }
    },
  };
}
