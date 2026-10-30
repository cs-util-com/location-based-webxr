// Throwaway prototype: the editor's approach on opening a tour, direction A,
// "the quiet camera" (see README.md). Original code, no libraries. The globe
// and the ground are a small ray-cast raster (one ray per few pixels, value
// noise for land, fields and hills), the streets, buildings and stations are
// projected by hand on a 2D canvas. Everything that "loads" is faked.

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (d) => (d * Math.PI) / 180;
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function easeOutBack(t) {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function h2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 65535;
}
function vn2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy);
  const b = h2(ix + 1, iy);
  const c = h2(ix, iy + 1);
  const d = h2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function vn3(x, y, z) {
  const iz = Math.floor(z);
  let fz = z - iz;
  fz = fz * fz * (3 - 2 * fz);
  const o0 = iz * 57.31;
  const o1 = (iz + 1) * 57.31;
  return lerp(vn2(x + o0, y - o0 * 0.7), vn2(x + o1, y - o1 * 0.7), fz);
}

// ---------------------------------------------------------------- the tour
const TOUR_NAME = "Old Town Walk";
const PLACE = "Freiburg";
const STATIONS = [
  { name: "City Gate", x: -122, y: -66 },
  { name: "Old Market Hall", x: -66, y: -98 },
  { name: "Fish Fountain", x: -7, y: -42 },
  { name: "Cathedral Square", x: 38, y: 18 },
  { name: "Canal Walk", x: 98, y: 49 },
  { name: "Town Hall", x: 136, y: 105 },
].map((s, i) => ({ ...s, n: i + 1, appear: -1 }));
const TC = {
  x: STATIONS.reduce((a, s) => a + s.x, 0) / STATIONS.length,
  y: STATIONS.reduce((a, s) => a + s.y, 0) / STATIONS.length,
};
const TOUR_RADIUS = Math.max(...STATIONS.map((s) => Math.hypot(s.x - TC.x, s.y - TC.y))) + 25;

// ---------------------------------------------------------------- world
const R = 6371000;
const FOV = 50;
const NEAR = 1;
const SUN = (() => {
  const v = [-0.35, -0.5, 0.8];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
const SUN2 = (() => {
  const l = Math.hypot(SUN[0], SUN[1]);
  return [SUN[0] / l, SUN[1] / l];
})();

// The town: a slightly rotated street grid with blocks of buildings.
const CITY_R = 1150;
const GRID_A = 0.21;
const GU = [Math.cos(GRID_A), Math.sin(GRID_A)];
const GV = [-Math.sin(GRID_A), Math.cos(GRID_A)];
const uvToX = (u, v) => u * GU[0] + v * GV[0];
const uvToY = (u, v) => u * GU[1] + v * GV[1];

const roads = [];
const buildings = [];
(function buildTown() {
  const rng = mulberry32(11);
  const lines = (arr) => {
    for (let p = -1350; p < 1350; p += 95 + rng() * 60) {
      arr.push(p);
    }
  };
  const uL = [];
  const vL = [];
  lines(uL);
  lines(vL);
  const edge = (x, y) => CITY_R * (0.82 + 0.3 * vn2(x / 700 + 3.3, y / 700 + 1.7));
  const addRoad = (ax, ay, bx, by, w) => {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const r = Math.hypot(mx, my);
    if (r > edge(mx, my)) {
      return;
    }
    const th = clamp01((r / CITY_R) * 0.2 + rng() * 0.05);
    roads.push({ ax, ay, bx, by, w, th, born: -1 });
  };
  uL.forEach((u, i) => {
    for (let v = -1350; v < 1350; v += 60) {
      addRoad(uvToX(u, v), uvToY(u, v), uvToX(u, v + 60), uvToY(u, v + 60), i % 4 === 0 ? 12 : 7);
    }
  });
  vL.forEach((v, i) => {
    for (let u = -1350; u < 1350; u += 60) {
      addRoad(uvToX(u, v), uvToY(u, v), uvToX(u + 60, v), uvToY(u + 60, v), i % 4 === 0 ? 12 : 7);
    }
  });
  for (let s = -1600; s < 1600; s += 60) {
    addRoad(s * 0.8, s * 0.6 - 120, (s + 60) * 0.8, (s + 60) * 0.6 - 120, 13);
  }
  const nearStation = (a0, a1, b0, b1) =>
    STATIONS.some((st) => {
      const su = st.x * GU[0] + st.y * GU[1];
      const sv = st.x * GV[0] + st.y * GV[1];
      const du = Math.max(a0 - su, 0, su - a1);
      const dv = Math.max(b0 - sv, 0, sv - b1);
      return Math.hypot(du, dv) < 16;
    });
  for (let i = 0; i < uL.length - 1; i++) {
    for (let j = 0; j < vL.length - 1; j++) {
      const u0 = uL[i] + 9;
      const u1 = uL[i + 1] - 9;
      const v0 = vL[j] + 9;
      const v1 = vL[j + 1] - 9;
      const cx = uvToX((u0 + u1) / 2, (v0 + v1) / 2);
      const cy = uvToY((u0 + u1) / 2, (v0 + v1) / 2);
      const r = Math.hypot(cx, cy);
      if (r > edge(cx, cy) - 40) {
        continue;
      }
      const nu = clamp(Math.round((u1 - u0) / 48), 1, 3);
      const nv = clamp(Math.round((v1 - v0) / 48), 1, 2);
      for (let a = 0; a < nu; a++) {
        for (let b = 0; b < nv; b++) {
          if (rng() < 0.1) {
            continue;
          }
          const du = (u1 - u0) / nu;
          const dv = (v1 - v0) / nv;
          const a0 = u0 + a * du + 2 + rng() * 4;
          const a1 = u0 + (a + 1) * du - 2 - rng() * 4;
          const b0 = v0 + b * dv + 2 + rng() * 4;
          const b1 = v0 + (b + 1) * dv - 2 - rng() * 4;
          if (a1 - a0 < 8 || b1 - b0 < 8 || nearStation(a0, a1, b0, b1)) {
            continue;
          }
          const xs = [uvToX(a0, b0), uvToX(a1, b0), uvToX(a1, b1), uvToX(a0, b1)];
          const ys = [uvToY(a0, b0), uvToY(a1, b0), uvToY(a1, b1), uvToY(a0, b1)];
          const height = 8 + rng() * 10 + (r < 400 ? rng() * 12 : 0);
          const terracotta = rng() < 0.45;
          const tone = 0.9 + rng() * 0.14;
          buildings.push({
            xs,
            ys,
            cx: (xs[0] + xs[2]) / 2,
            cy: (ys[0] + ys[2]) / 2,
            h: height,
            roof: terracotta
              ? [176 * tone, 100 * tone, 76 * tone]
              : [214 * tone, 207 * tone, 196 * tone],
            th: 0.18 + 0.82 * clamp01((r / CITY_R) * 0.5 + rng() * 0.5),
            born: -1,
            d: 0,
          });
        }
      }
    }
  }
  // the cathedral next to Cathedral Square
  const cs = STATIONS[3];
  let best = null;
  let bestD = Infinity;
  for (const b of buildings) {
    const d = Math.hypot(b.cx - cs.x, b.cy - cs.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best) {
    best.h = 46;
    best.roof = [120, 84, 70];
    best.th = 0.2;
  }
})();

const STARS = (() => {
  const rng = mulberry32(5);
  const out = [];
  for (let i = 0; i < 420; i++) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    out.push({ x: s * Math.cos(a), y: s * Math.sin(a), z, m: rng() ** 3 });
  }
  return out;
})();

// ---------------------------------------------------------------- loading (fake)
const SCENARIOS = {
  fast: {
    land: { dur: 1.6, start: 0.2 },
    heights: { dur: 2.0, start: 0.2 },
    city: { dur: 3.5, start: 0.6 },
  },
  normal: {
    land: { dur: 4.5, start: 0.3 },
    heights: { dur: 5.5, start: 0.3 },
    city: { dur: 9, start: 1.2 },
  },
  slow: {
    land: { dur: 22, start: 0.8, jitter: true },
    heights: { dur: 26, start: 0.8, jitter: true },
    city: { dur: 55, start: 3, jitter: true },
  },
  never: {
    land: { dur: 4.5, start: 0.3 },
    heights: { dur: 5.5, start: 0.3 },
    city: { dur: 9, start: 1.2, stallAt: 0.68 },
  },
  fail: {
    land: { dur: 4.5, start: 0.3 },
    heights: { dur: 5.5, start: 0.3, stallAt: 0.33, fails: true },
    city: { dur: 9, start: 1.2 },
  },
};
let scenario = "normal";
let src = {};
function makeSource(def, seed) {
  return { ...def, seed, p: 0, ema: 0, state: "loading", stalledFor: 0 };
}
function stepSource(s, dt, now) {
  if (s.state === "done" || s.state === "failed" || now < s.start) {
    return;
  }
  let rate = 1 / s.dur;
  if (s.jitter) {
    rate *= 0.2 + 1.6 * vn2(now * 0.45, s.seed * 13.1);
  }
  if (s.stallAt != null && s.p >= s.stallAt) {
    rate = 0;
    s.stalledFor += dt;
    if (s.fails && s.stalledFor > 2) {
      s.state = s.stalledFor > 8 ? "failed" : "retrying";
    }
  }
  const before = s.p;
  s.p = Math.min(1, s.p + rate * dt);
  if (s.p >= 1) {
    s.state = "done";
  }
  const k = 1 - Math.exp(-dt / 2.5);
  s.ema += ((s.p - before) / Math.max(dt, 1e-3) - s.ema) * k;
}
function srcEta(s, q, now) {
  if (s.p >= q || s.state === "done" || s.state === "failed") {
    return 0;
  }
  if (now - s.start < 1.5) {
    return (q - s.p) * 8; // no measurement yet: assume a typical pace
  }
  if (s.ema < 0.004) {
    return Infinity;
  }
  return (q - s.p) / s.ema;
}

// ---------------------------------------------------------------- camera + flight
const cam = { tx: 0, ty: 0, dist: 1.2e7, heading: 25, pitch: 90 };
const E = {}; // derived eye: position, basis, projection
const fl = {
  mode: "flying", // flying | arriving | done | manual | glide
  vel: 0,
  hRate: 1.5,
  waitF: 0,
  waitLow: 0,
  floor: { alt: 350e3, why: "land" },
  arrivedAt: -1,
  takenOver: false,
  glide: null,
};
let simT = 0;
let landAlt = 220;
const LAND_PITCH = 38;
let stationsShownAt = -1;
let doneAt = -1;
let draftMode = false;
let viewW = 800;
let viewH = 600;

const camAlt = () => cam.dist * Math.sin(rad(cam.pitch));
function pitchFor(logAlt) {
  return LAND_PITCH + (90 - LAND_PITCH) * smoothstep(2.35, 5.4, logAlt);
}
function landingPose() {
  const fovV = rad(FOV);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (viewW / viewH));
  const d = (1.05 * TOUR_RADIUS) / Math.tan(Math.min(fovV, fovH) / 2);
  return { tx: TC.x, ty: TC.y, dist: d, pitch: LAND_PITCH };
}
function updateLandAlt() {
  const p = landingPose();
  landAlt = clamp(p.dist * Math.sin(rad(LAND_PITCH)), 110, 320);
}

function floorInfo() {
  const L = src.land;
  const H = src.heights;
  const C = src.city;
  const hOk = (q) => H.state === "failed" || H.p >= q;
  if (L.p < 0.25) {
    return { alt: 350e3, why: "land" };
  }
  if (L.p < 0.7) {
    return { alt: 30e3, why: "land" };
  }
  if (!hOk(0.6)) {
    return { alt: 30e3, why: "heights" };
  }
  if (L.p < 1) {
    return { alt: 3500, why: "land" };
  }
  if (!hOk(1)) {
    return { alt: 3500, why: "heights" };
  }
  if (C.p < 0.12) {
    return { alt: 3500, why: "city" };
  }
  if (C.p < 0.6 && fl.waitLow < 6) {
    return { alt: 750, why: "city" };
  }
  return { alt: landAlt, why: null };
}

function showStations(now) {
  if (stationsShownAt >= 0) {
    return;
  }
  stationsShownAt = now;
  STATIONS.forEach((s, i) => {
    s.appear = now + 0.15 + i * 0.16;
  });
}

function stepFlight(dt, now) {
  const logAlt = Math.log10(Math.max(camAlt(), 1));
  fl.floor = floorInfo();
  const goal = Math.log10(Math.max(fl.floor.alt, landAlt));
  const gap = logAlt - goal;
  const ramp = smoothstep(0, 1.8, now);
  const desired = gap > 0 ? Math.min(0.95 * ramp, 1.05 * gap) : 0.6 * gap;
  fl.vel += (desired - fl.vel) * (1 - Math.exp(-dt * 2.2));
  const nextLog = logAlt - fl.vel * dt;
  // waiting = held above the landing by missing data: slow down and circle
  const waiting = fl.floor.why !== null && gap < 0.3;
  fl.waitF += ((waiting ? 1 : 0) - fl.waitF) * (1 - Math.exp(-dt * 0.9));
  if (fl.floor.alt === 750 && gap < 0.3) {
    fl.waitLow += dt;
  }
  if (fl.mode === "arriving") {
    fl.hRate *= Math.exp(-dt * 1.1);
  } else {
    const target = 1.4 + 5.2 * fl.waitF;
    fl.hRate += (target - fl.hRate) * (1 - Math.exp(-dt * 0.8));
  }
  cam.heading += fl.hRate * dt;
  const breathe = fl.waitF * 3 * Math.sin(now * 0.42);
  cam.pitch = clamp(pitchFor(nextLog) + breathe, 20, 90);
  cam.dist = 10 ** nextLog / Math.sin(rad(cam.pitch));
  // early on the globe sits off-centre and the place slides to the middle
  const off = smoothstep(5.6, 7.0, nextLog);
  cam.tx = TC.x - 2.6e6 * off;
  cam.ty = TC.y - 1.3e6 * off;
  if (fl.mode === "flying" && fl.floor.why === null && gap < 0.12) {
    fl.mode = "arriving";
    fl.arrivedAt = now;
    showStations(now);
  }
  if (fl.mode === "arriving" && now - fl.arrivedAt > 3.6) {
    fl.mode = "done";
  }
}

function startGlide(kind, to, dur, now) {
  const dh = ((((to.heading ?? cam.heading) - cam.heading) % 360) + 540) % 360 - 180;
  fl.glide = {
    kind,
    t0: now,
    dur,
    from: { ...cam },
    to: { ...to, heading: cam.heading + dh },
  };
  fl.mode = "glide";
}
function stepGlide(now) {
  const g = fl.glide;
  const t = clamp01((now - g.t0) / g.dur);
  const e = easeInOut(t);
  cam.tx = lerp(g.from.tx, g.to.tx, e);
  cam.ty = lerp(g.from.ty, g.to.ty, e);
  cam.dist = Math.exp(lerp(Math.log(g.from.dist), Math.log(g.to.dist), e));
  cam.pitch = lerp(g.from.pitch, g.to.pitch, e);
  cam.heading = lerp(g.from.heading, g.to.heading, e);
  if (camAlt() < 40e3) {
    showStations(now);
  }
  if (t >= 1) {
    fl.mode = "done";
    fl.glide = null;
  }
}

function frameTour(now) {
  const p = landingPose();
  startGlide("tour", { ...p, dist: landAlt / Math.sin(rad(LAND_PITCH)) }, 1.8, now);
}
function frameStation(i, now) {
  const s = STATIONS[i];
  startGlide("station", { tx: s.x, ty: s.y, dist: 150 / Math.sin(rad(48)), pitch: 48 }, 1.2, now);
}

// Any input: the creator takes the camera where it is; loading carries on.
function interrupt() {
  if (fl.mode === "flying" || fl.mode === "arriving" || fl.mode === "glide") {
    fl.mode = "manual";
    fl.vel = 0;
    fl.glide = null;
    fl.takenOver = true;
  } else if (fl.mode === "done") {
    fl.mode = "manual";
  }
}

// ---------------------------------------------------------------- reset
function reset(sc, draft) {
  scenario = sc;
  draftMode = !!draft;
  const def = SCENARIOS[draft ? "fast" : sc];
  src = {
    land: makeSource(def.land, 1),
    heights: makeSource(def.heights, 2),
    city: makeSource(def.city, 3),
  };
  simT = 0;
  fl.vel = 0;
  fl.hRate = 1.5;
  fl.waitF = 0;
  fl.waitLow = 0;
  fl.arrivedAt = -1;
  fl.takenOver = false;
  fl.glide = null;
  stationsShownAt = -1;
  doneAt = -1;
  STATIONS.forEach((s) => {
    s.appear = -1;
  });
  roads.forEach((r) => {
    r.born = -1;
  });
  buildings.forEach((b) => {
    b.born = -1;
  });
  landShown = 0;
  heightsShown = 0;
  updateLandAlt();
  if (draft) {
    const p = landingPose();
    Object.assign(cam, p, { dist: landAlt / Math.sin(rad(LAND_PITCH)), heading: 25 });
    fl.mode = "done";
    stationsShownAt = 0;
    STATIONS.forEach((s) => {
      s.appear = 0;
    });
  } else {
    Object.assign(cam, { tx: TC.x, ty: TC.y, dist: 1.2e7, heading: 25, pitch: 90 });
    fl.mode = "flying";
  }
  capState.shownKey = "";
  capState.etaPhrase = "";
  document.querySelectorAll(".debug [data-sc]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.sc === sc));
  });
}

// ---------------------------------------------------------------- rendering
const cv = $("cv");
const ctx = cv.getContext("2d");
const rc = document.createElement("canvas");
const rctx = rc.getContext("2d");
let img = null;
let rw = 0;
let rh = 0;
let dpr = 1;
let landShown = 0;
let heightsShown = 0;

function resize() {
  const view = $("view");
  viewW = Math.max(50, view.clientWidth);
  viewH = Math.max(50, view.clientHeight);
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(viewW * dpr);
  cv.height = Math.round(viewH * dpr);
  const step = viewW > 1000 ? 5 : 4;
  rw = Math.ceil(viewW / step);
  rh = Math.ceil(viewH / step);
  rc.width = rw;
  rc.height = rh;
  img = rctx.createImageData(rw, rh);
  updateLandAlt();
}

function computeEye() {
  const p = rad(cam.pitch);
  const h = rad(cam.heading);
  const hor = cam.dist * Math.cos(p);
  E.px = cam.tx - Math.sin(h) * hor;
  E.py = cam.ty - Math.cos(h) * hor;
  E.pz = cam.dist * Math.sin(p);
  let fx = cam.tx - E.px;
  let fy = cam.ty - E.py;
  let fz = -E.pz;
  const fl2 = Math.hypot(fx, fy, fz);
  fx /= fl2;
  fy /= fl2;
  fz /= fl2;
  E.fx = fx;
  E.fy = fy;
  E.fz = fz;
  E.rx = Math.cos(h);
  E.ry = -Math.sin(h);
  E.ux = E.ry * fz;
  E.uy = -E.rx * fz;
  E.uz = E.rx * fy - E.ry * fx;
  E.fpx = viewH / 2 / Math.tan(rad(FOV) / 2);
  E.cx = viewW / 2;
  E.cy = viewH / 2;
  E.alt = Math.hypot(E.px, E.py, E.pz + R) - R;
}

const CS = [0, 0, 0];
const CS2 = [0, 0, 0];
function camSpace(x, y, z, o) {
  const dx = x - E.px;
  const dy = y - E.py;
  const dz = z - E.pz;
  o[0] = dx * E.rx + dy * E.ry;
  o[1] = dx * E.ux + dy * E.uy + dz * E.uz;
  o[2] = dx * E.fx + dy * E.fy + dz * E.fz;
}
function project(x, y, z, out) {
  camSpace(x, y, z, CS);
  if (CS[2] < NEAR) {
    return false;
  }
  out[0] = E.cx + (E.fpx * CS[0]) / CS[2];
  out[1] = E.cy - (E.fpx * CS[1]) / CS[2];
  out[2] = CS[2];
  return true;
}
// project a ground segment, clipped at the near plane; result in SEG
const SEG = [0, 0, 0, 0, 0];
function projectSeg(ax, ay, bx, by) {
  camSpace(ax, ay, 0, CS);
  camSpace(bx, by, 0, CS2);
  if (CS[2] < NEAR && CS2[2] < NEAR) {
    return false;
  }
  if (CS[2] < NEAR || CS2[2] < NEAR) {
    const a = CS[2] < NEAR ? CS : CS2;
    const b = a === CS ? CS2 : CS;
    const t = (NEAR - a[2]) / (b[2] - a[2]);
    a[0] = lerp(a[0], b[0], t);
    a[1] = lerp(a[1], b[1], t);
    a[2] = NEAR;
  }
  SEG[0] = E.cx + (E.fpx * CS[0]) / CS[2];
  SEG[1] = E.cy - (E.fpx * CS[1]) / CS[2];
  SEG[2] = E.cx + (E.fpx * CS2[0]) / CS2[2];
  SEG[3] = E.cy - (E.fpx * CS2[1]) / CS2[2];
  SEG[4] = (CS[2] + CS2[2]) / 2;
  return true;
}

const COL = [0, 0, 0];
function groundColor(x, y, nx, ny, nz, g) {
  // continents on the whole sphere; the tour's region is always land
  const far = 1 - nz;
  let cont = 1;
  if (far > 2e-4) {
    cont =
      vn3(nx * 1.7 + 3.1, ny * 1.7, nz * 1.7) * 0.62 +
      vn3(nx * 4.3, ny * 4.3 + 7.7, nz * 4.3) * 0.38 -
      0.52 +
      0.6 * Math.exp(-far / 0.02);
  }
  const landF = smoothstep(-0.012, 0.012, cont);
  let r;
  let gr;
  let b;
  if (landF < 1) {
    const sh = smoothstep(-0.09, 0, cont);
    r = lerp(20, 44, sh);
    gr = lerp(42, 88, sh);
    b = lerp(66, 108, sh);
  } else {
    r = 0;
    gr = 0;
    b = 0;
  }
  if (landF > 0) {
    const dry = smoothstep(0.55, 0.82, vn3(nx * 9, ny * 9, nz * 9));
    let lr = lerp(86, 150, dry);
    let lg = lerp(114, 138, dry);
    let lb = lerp(68, 96, dry);
    if (far < 0.05) {
      // the landscape: detail arrives as the landscape loads (lamMin falls)
      const lamMin = Math.exp(lerp(Math.log(200000), Math.log(45), landShown));
      let bright = 0;
      let hue = 0;
      const lams = [40000, 9000, 2200, 520, 130];
      for (let k = 0; k < lams.length; k++) {
        const lam = lams[k];
        const w = smoothstep(2.5 * g, 6 * g, lam) * smoothstep(lamMin, lamMin * 3, lam);
        if (w > 0.01) {
          const v = vn2(x / lam + k * 17.3, y / lam - k * 9.1) - 0.5;
          if (lam > 2500) {
            bright += v * w * 0.55;
          } else {
            hue += v * w * 1.4;
          }
        }
      }
      lr *= 1 + bright;
      lg *= 1 + bright;
      lb *= 1 + bright;
      // fields (yellow) versus woods (dark green)
      const fy = clamp(hue, -1, 1);
      if (fy > 0) {
        lr = lerp(lr, 178, fy * 0.8);
        lg = lerp(lg, 168, fy * 0.8);
        lb = lerp(lb, 98, fy * 0.8);
      } else {
        lr = lerp(lr, 46, -fy * 0.8);
        lg = lerp(lg, 76, -fy * 0.8);
        lb = lerp(lb, 50, -fy * 0.8);
      }
      // town and villages (part of the landscape)
      const rr = Math.hypot(x, y) + 350 * (vn2(x / 500, y / 500) - 0.5);
      const vil =
        smoothstep(0.8, 0.86, vn2(x / 1800 + 11.3, y / 1800 + 5.1)) *
        smoothstep(lamMin, lamMin * 3, 2200) *
        smoothstep(2 * g, 5 * g, 1800);
      const town =
        Math.max(smoothstep(1600, 850, rr), vil * 0.45) * smoothstep(0.25, 0.7, landShown);
      lr = lerp(lr, 182, town * 0.75);
      lg = lerp(lg, 176, town * 0.75);
      lb = lerp(lb, 166, town * 0.75);
      // hill shapes (relief shading) as the heights load
      if (heightsShown > 0.01) {
        let s = 0;
        const hl = [12000, 3000, 700];
        for (let k = 0; k < hl.length; k++) {
          const lam = hl[k];
          const w = smoothstep(2 * g, 5 * g, lam);
          if (w > 0.01) {
            const e = 0.12;
            const ax = x / lam + 40 + k * 3.7;
            const ay = y / lam - 20;
            s += (vn2(ax + e, ay + e) - vn2(ax, ay)) * w * (k === 0 ? 2.4 : 1.6);
          }
        }
        const m = 1 + clamp(s, -0.6, 0.6) * heightsShown;
        lr *= m;
        lg *= m;
        lb *= m;
      }
    }
    r = lerp(r, lr, landF);
    gr = lerp(gr, lg, landF);
    b = lerp(b, lb, landF);
  }
  const lum = 0.3 + 0.7 * Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  COL[0] = r * lum;
  COL[1] = gr * lum;
  COL[2] = b * lum;
}

function renderRaster() {
  const data = img.data;
  const ocx = E.px;
  const ocy = E.py;
  const ocz = E.pz + R;
  const ocLen2 = ocx * ocx + ocy * ocy + ocz * ocz;
  const ocLen = Math.sqrt(ocLen2);
  const occ = ocLen2 - R * R;
  const upx = ocx / ocLen;
  const upy = ocy / ocLen;
  const upz = ocz / ocLen;
  const alt = ocLen - R;
  const skyF = smoothstep(170000, 22000, alt);
  const sx0 = viewW / rw;
  const sy0 = viewH / rh;
  const pixAng = sy0 / E.fpx;
  const hazeD = 26000 + alt * 7;
  let o = 0;
  for (let j = 0; j < rh; j++) {
    const sy = -((j + 0.5) * sy0 - E.cy) / E.fpx;
    for (let i = 0; i < rw; i++) {
      const sx = ((i + 0.5) * sx0 - E.cx) / E.fpx;
      let dx = E.fx + E.rx * sx + E.ux * sy;
      let dy = E.fy + E.ry * sx + E.uy * sy;
      let dz = E.fz + E.uz * sy;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const bb = ocx * dx + ocy * dy + ocz * dz;
      const disc = bb * bb - occ;
      if (disc > 0 && bb < 0) {
        const t = occ / (-bb + Math.sqrt(disc));
        const hx = E.px + dx * t;
        const hy = E.py + dy * t;
        const hz = E.pz + dz * t;
        const nx = hx / R;
        const ny = hy / R;
        const nz = (hz + R) / R;
        const inc = -(dx * nx + dy * ny + dz * nz);
        const g = (t * pixAng) / Math.max(0.12, inc);
        groundColor(hx, hy, nx, ny, nz, g);
        let hz2 = 1 - Math.exp(-t / hazeD);
        hz2 = clamp01(hz2 * (0.35 + 0.65 * skyF) + (1 - inc) ** 4 * 0.55);
        data[o] = lerp(COL[0], 196, hz2);
        data[o + 1] = lerp(COL[1], 214, hz2);
        data[o + 2] = lerp(COL[2], 236, hz2);
        data[o + 3] = 255;
      } else {
        const e = dx * upx + dy * upy + dz * upz;
        const zen = smoothstep(-0.02, 0.5, e);
        const skr = lerp(200, 92, zen);
        const skg = lerp(216, 138, zen);
        const skb = lerp(234, 196, zen);
        const closest = bb < 0 ? Math.sqrt(Math.max(0, ocLen2 - bb * bb)) : ocLen;
        const glow = clamp01(1 - (closest - R) / (R * 0.03)) ** 2 * (closest > R * 0.999 ? 1 : 0);
        const a = Math.max(skyF, glow * 0.85);
        data[o] = lerp(130, skr, skyF);
        data[o + 1] = lerp(175, skg, skyF);
        data[o + 2] = lerp(240, skb, skyF);
        data[o + 3] = a * 255;
      }
      o += 4;
    }
  }
  rctx.putImageData(img, 0, 0);
}

function drawStars() {
  const a = smoothstep(18000, 260000, E.alt);
  if (a <= 0) {
    return;
  }
  ctx.fillStyle = "#fff";
  for (const s of STARS) {
    const cz = s.x * E.fx + s.y * E.fy + s.z * E.fz;
    if (cz <= 0.05) {
      continue;
    }
    const x = E.cx + (E.fpx * (s.x * E.rx + s.y * E.ry)) / cz;
    const y = E.cy - (E.fpx * (s.x * E.ux + s.y * E.uy + s.z * E.uz)) / cz;
    if (x < 0 || y < 0 || x > viewW || y > viewH) {
      continue;
    }
    ctx.globalAlpha = a * (0.25 + 0.75 * s.m);
    const sz = s.m > 0.7 ? 1.6 : 1;
    ctx.fillRect(x, y, sz, sz);
  }
  ctx.globalAlpha = 1;
}

function drawRoads(now) {
  const a = smoothstep(9000, 3200, E.alt);
  if (a <= 0) {
    return;
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgb(244,238,226)";
  for (const r of roads) {
    if (r.born < 0) {
      continue;
    }
    if (!projectSeg(r.ax, r.ay, r.bx, r.by)) {
      continue;
    }
    const minX = Math.min(SEG[0], SEG[2]);
    const maxX = Math.max(SEG[0], SEG[2]);
    const minY = Math.min(SEG[1], SEG[3]);
    const maxY = Math.max(SEG[1], SEG[3]);
    if (maxX < -20 || minX > viewW + 20 || maxY < -20 || minY > viewH + 20) {
      continue;
    }
    const wpx = (r.w * E.fpx) / SEG[4];
    const fade = clamp01((now - r.born) / 0.6);
    ctx.globalAlpha = a * fade * clamp(wpx / 0.8, 0.25, 0.9);
    ctx.lineWidth = clamp(wpx, 0.6, 22);
    ctx.beginPath();
    ctx.moveTo(SEG[0], SEG[1]);
    ctx.lineTo(SEG[2], SEG[3]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const P8 = new Float64Array(16);
const PT = [0, 0, 0];
function projectBuilding(b, top) {
  for (let k = 0; k < 4; k++) {
    if (!project(b.xs[k], b.ys[k], 0, PT)) {
      return false;
    }
    P8[k * 2] = PT[0];
    P8[k * 2 + 1] = PT[1];
    if (!project(b.xs[k], b.ys[k], top, PT)) {
      return false;
    }
    P8[8 + k * 2] = PT[0];
    P8[8 + k * 2 + 1] = PT[1];
  }
  return true;
}
function drawBuildings(now) {
  if (E.alt > 6000) {
    return;
  }
  const a = smoothstep(6000, 2600, E.alt);
  const cityP = src.city.p;
  const vis = [];
  for (const b of buildings) {
    camSpace(b.cx, b.cy, 0, CS);
    if (CS[2] < 20) {
      continue;
    }
    const sx = E.cx + (E.fpx * CS[0]) / CS[2];
    const sy = E.cy - (E.fpx * CS[1]) / CS[2];
    if (sx < -200 || sx > viewW + 200 || sy < -200 || sy > viewH + 300) {
      continue;
    }
    b.d = CS[2];
    vis.push(b);
  }
  vis.sort((p, q) => q.d - p.d);
  const roofOnly = E.alt > 2400;
  // where buildings are still to come: faint footprints on the ground
  if (cityP > 0.22 && E.alt < 3500) {
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    for (const b of vis) {
      if (b.born >= 0 || !projectBuilding(b, 0)) {
        continue;
      }
      ctx.globalAlpha = a;
      polyPath(0);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const b of vis) {
    if (b.born < 0) {
      continue;
    }
    const g = easeOutCubic(clamp01((now - b.born) / 0.9));
    if (!projectBuilding(b, b.h * g)) {
      continue;
    }
    ctx.globalAlpha = a * clamp01(g * 3);
    if (!roofOnly) {
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        const ex = b.xs[k2] - b.xs[k];
        const ey = b.ys[k2] - b.ys[k];
        const el = Math.hypot(ex, ey);
        const nx = ey / el;
        const ny = -ex / el;
        const mx = (b.xs[k] + b.xs[k2]) / 2;
        const my = (b.ys[k] + b.ys[k2]) / 2;
        if (nx * (E.px - mx) + ny * (E.py - my) <= 0) {
          continue;
        }
        const sh = 0.6 + 0.32 * Math.max(0, nx * SUN2[0] + ny * SUN2[1]);
        ctx.fillStyle = `rgb(${232 * sh},${225 * sh},${212 * sh})`;
        ctx.beginPath();
        ctx.moveTo(P8[k * 2], P8[k * 2 + 1]);
        ctx.lineTo(P8[k2 * 2], P8[k2 * 2 + 1]);
        ctx.lineTo(P8[8 + k2 * 2], P8[8 + k2 * 2 + 1]);
        ctx.lineTo(P8[8 + k * 2], P8[8 + k * 2 + 1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.fillStyle = `rgb(${b.roof[0]},${b.roof[1]},${b.roof[2]})`;
    polyPath(8);
    ctx.fill();
    if (!roofOnly) {
      ctx.strokeStyle = "rgba(40,30,20,0.18)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
function polyPath(off) {
  ctx.beginPath();
  ctx.moveTo(P8[off], P8[off + 1]);
  for (let k = 1; k < 4; k++) {
    ctx.lineTo(P8[off + k * 2], P8[off + k * 2 + 1]);
  }
  ctx.closePath();
}

const PIN_H = 20;
function drawRouteAndStations(now) {
  if (stationsShownAt < 0) {
    return;
  }
  const lastAppear = STATIONS[STATIONS.length - 1].appear;
  const routeT = clamp01((now - lastAppear - 0.4) / 1.4);
  if (routeT > 0) {
    // the walk between the stations, drawn on once they have settled
    const total = STATIONS.length - 1;
    const upto = routeT * total;
    ctx.strokeStyle = "rgba(233,162,59,0.9)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < total && i < upto; i++) {
      const a = STATIONS[i];
      const b = STATIONS[i + 1];
      const frac = Math.min(1, upto - i);
      const steps = 8;
      for (let k = 0; k < steps; k++) {
        const t0 = (k / steps) * frac;
        const t1 = ((k + 1) / steps) * frac;
        if (projectSeg(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0), lerp(a.x, b.x, t1), lerp(a.y, b.y, t1))) {
          ctx.moveTo(SEG[0], SEG[1]);
          ctx.lineTo(SEG[2], SEG[3]);
        }
      }
    }
    ctx.stroke();
  }
  const order = STATIONS.filter((s) => s.appear >= 0 && now >= s.appear)
    .map((s) => {
      camSpace(s.x, s.y, 0, CS);
      return { s, d: CS[2] };
    })
    .sort((p, q) => q.d - p.d);
  const G = [0, 0, 0];
  const H = [0, 0, 0];
  for (const { s } of order) {
    const e = clamp01((now - s.appear) / 0.9);
    const z = PIN_H + 70 * (1 - easeOutBack(e));
    if (!project(s.x, s.y, 0, G) || !project(s.x, s.y, z, H)) {
      continue;
    }
    const alpha = clamp01(e * 2.5);
    // a ring that spreads once where the station touches down
    const rt = (now - s.appear - 0.45) / 1.2;
    if (rt > 0 && rt < 1) {
      ctx.strokeStyle = `rgba(233,162,59,${(1 - rt) * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const rr = 4 + 26 * easeOutCubic(rt);
      let started = false;
      for (let k = 0; k <= 24; k++) {
        const an = (k / 24) * Math.PI * 2;
        if (project(s.x + Math.cos(an) * rr, s.y + Math.sin(an) * rr, 0, PT)) {
          if (started) {
            ctx.lineTo(PT[0], PT[1]);
          } else {
            ctx.moveTo(PT[0], PT[1]);
            started = true;
          }
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(G[0], G[1], 5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(G[0], G[1]);
    ctx.lineTo(H[0], H[1]);
    ctx.stroke();
    ctx.fillStyle = "#e9a23b";
    ctx.beginPath();
    ctx.arc(H[0], H[1], 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#20160a";
    ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s.n), H[0], H[1] + 0.5);
    const la = clamp01((now - s.appear - 0.5) / 0.5) * alpha;
    if (la > 0) {
      ctx.globalAlpha = la;
      ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "left";
      const tw = ctx.measureText(s.name).width;
      const lx = H[0] + 16;
      const ly = H[1];
      ctx.fillStyle = "rgba(18,20,24,0.8)";
      roundRect(lx - 6, ly - 10, tw + 12, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#f2f3f5";
      ctx.fillText(s.name, lx, ly + 0.5);
    }
    ctx.globalAlpha = 1;
  }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// a small soft marker for where the flight is heading
function drawTarget(now) {
  const show = stationsShownAt < 0 ? 1 : clamp01(1 - (now - stationsShownAt) / 0.8);
  const a = show * smoothstep(900, 3000, E.alt);
  if (a <= 0 || !project(TC.x, TC.y, 0, PT)) {
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(now * 2.4);
  ctx.globalAlpha = a;
  ctx.strokeStyle = "rgba(233,162,59,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(PT[0], PT[1], 6 + pulse * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#e9a23b";
  ctx.beginPath();
  ctx.arc(PT[0], PT[1], 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.fillText(TOUR_NAME, PT[0], PT[1] + 13);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function render(now) {
  computeEye();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, viewW, viewH);
  drawStars();
  renderRaster();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(rc, 0, 0, viewW, viewH);
  if (E.alt < 12000) {
    drawRoads(now);
    drawBuildings(now);
  }
  drawTarget(now);
  drawRouteAndStations(now);
}

// ---------------------------------------------------------------- the caption line
const capEl = $("caption");
const capText = $("capText");
const capEta = $("capEta");
const capSub = $("capSub");
const capDot = $("capDot");
const capState = {
  shownKey: "",
  pending: null,
  swapping: false,
  etaPhrase: "",
  etaCand: "",
  etaSince: 0,
};

function etaPhrase(s) {
  if (!Number.isFinite(s)) {
    return "taking longer than usual";
  }
  if (s < 4) {
    return "a few seconds";
  }
  if (s < 8) {
    return "about 5 seconds";
  }
  if (s < 15) {
    return "about 10 seconds";
  }
  if (s < 25) {
    return "about 20 seconds";
  }
  if (s < 45) {
    return "about half a minute";
  }
  if (s < 80) {
    return "about a minute";
  }
  return "a few minutes";
}

function flightEta(now) {
  const L = src.land;
  const H = src.heights;
  const C = src.city;
  const flyLeft = Math.max(0, Math.log10(camAlt()) - Math.log10(landAlt)) / 0.75;
  let eCity = srcEta(C, 0.6, now);
  eCity = Math.min(eCity, flyLeft * 0.7 + Math.max(0, 6 - fl.waitLow));
  return Math.max(srcEta(L, 1, now), srcEta(H, 1, now), eCity, flyLeft) + 0.5;
}
function loadEta(now) {
  return Math.max(srcEta(src.land, 1, now), srcEta(src.heights, 1, now), srcEta(src.city, 1, now));
}

function captionModel(now) {
  const L = src.land;
  const H = src.heights;
  const C = src.city;
  const hFailed = H.state === "failed";
  const allDone = L.p >= 1 && (H.p >= 1 || hFailed) && C.p >= 1;
  const flying = fl.mode === "flying";
  const m = { dot: "loading", text: "", eta: null, sub: [], gone: false };
  if (flying) {
    const why = fl.floor.why;
    if (H.state === "retrying") {
      m.text = "The hill shapes are slow to answer - trying again";
    } else if (hFailed && now - (H.failedAt ?? now) < 5) {
      m.dot = "warn";
      m.text = "The hill shapes could not be loaded, so the ground will be flat - flying on";
    } else if (fl.waitF > 0.5 && why) {
      const what = why === "city" ? "the streets and buildings" : why === "heights" ? "the hill shapes" : "the landscape";
      m.text = `Waiting for ${what}`;
      const e = why === "city" ? srcEta(C, 0.6, now) : srcEta(why === "land" ? L : H, 1, now);
      if (e > 12) {
        m.text += " - the connection is slow";
      }
    } else if (camAlt() > 300e3) {
      m.text = `Flying to ${PLACE}`;
    } else if (camAlt() > 4000) {
      m.text = `Flying to ${PLACE} - the landscape is filling in`;
    } else {
      m.text = `Coming down over ${TOUR_NAME}`;
    }
    if (hFailed) {
      m.dot = "warn";
    }
    m.eta = H.state === "retrying" ? null : flightEta(now);
    m.sub = [{ t: "Drag, scroll or press any key to take over" }, { b: "Skip to the tour", act: "skip" }];
    return m;
  }
  if (fl.arrivedAt >= 0 && now - fl.arrivedAt < 2.8 && fl.mode !== "manual") {
    m.dot = allDone ? "done" : "loading";
    m.text = `Here is ${TOUR_NAME} - ${STATIONS.length} stations`;
    return m;
  }
  if (draftMode && now < 2.5) {
    m.text = "Your draft is back where you left it";
  } else if (allDone) {
    if (hFailed) {
      m.dot = "warn";
      m.text = "Ready. The hill shapes are missing, so the ground is flat";
      m.sub = [{ b: "Try again", act: "retry" }];
    } else {
      m.dot = "done";
      m.text = "Everything is loaded";
      m.gone = now - doneAt > 4;
    }
  } else if (H.state === "retrying") {
    m.text = "Your tour is ready to edit. The hill shapes are slow to answer - trying again";
  } else if (C.stalledFor > 5) {
    m.dot = "warn";
    m.text = "Some buildings are slow to arrive - they will appear on their own. Everything else is ready";
  } else {
    const what = L.p < 1 ? "The landscape is still filling in" : C.p < 1 ? "More buildings are on their way" : "The hill shapes are on their way";
    m.text = stationsShownAt >= 0 ? `Your tour is ready to edit. ${what}` : what;
    m.eta = loadEta(now);
  }
  if (fl.takenOver && !m.gone) {
    const sub = [];
    if (!allDone) {
      sub.push({ t: "You have the camera - loading carries on" });
    }
    if (fl.mode === "manual") {
      sub.push({ b: "Back to the tour", act: "tour" });
    }
    m.sub = [...sub, ...m.sub];
  }
  return m;
}

function renderCaption(m) {
  capText.textContent = m.text;
  capSub.textContent = "";
  m.sub.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "-";
      capSub.append(sep);
    }
    if (part.b) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = part.b;
      b.dataset.act = part.act;
      capSub.append(b);
    } else {
      capSub.append(document.createTextNode(part.t));
    }
  });
}
function swapCaption() {
  capState.swapping = true;
  capEl.classList.add("swap");
  setTimeout(() => {
    const { m, key } = capState.pending;
    capState.pending = null;
    renderCaption(m);
    capState.shownKey = key;
    capEl.classList.remove("swap");
    setTimeout(() => {
      capState.swapping = false;
      if (capState.pending) {
        swapCaption();
      }
    }, 260);
  }, 220);
}
function updateCaption(now) {
  const m = captionModel(now);
  const key = m.text + "|" + JSON.stringify(m.sub);
  if (key !== capState.shownKey && (!capState.pending || capState.pending.key !== key)) {
    capState.pending = { m, key };
    if (!capState.swapping) {
      swapCaption();
    }
  }
  capDot.className = `dot ${m.dot}`;
  capEl.classList.toggle("gone", m.gone);
  // the time estimate changes in place, and only once it has settled for a second
  const phrase = m.eta == null ? "" : etaPhrase(m.eta);
  if (phrase !== capState.etaCand) {
    capState.etaCand = phrase;
    capState.etaSince = now;
  }
  if (capState.etaPhrase !== phrase && (now - capState.etaSince > 1 || capState.etaPhrase === "" || phrase === "")) {
    capState.etaPhrase = phrase;
    capEta.textContent = phrase ? `- ${phrase}` : "";
  }
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
const params = new URLSearchParams(location.hash.slice(1));
const timeScale = clamp(Number(params.get("x")) || 1, 0.1, 10);
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000) * timeScale;
  last = t;
  simT += dt;
  const now = simT;
  stepSource(src.land, dt, now);
  stepSource(src.heights, dt, now);
  stepSource(src.city, dt, now);
  if (src.heights.state === "failed" && src.heights.failedAt == null) {
    src.heights.failedAt = now;
  }
  const C = src.city;
  for (const r of roads) {
    if (r.born < 0 && C.p >= r.th) {
      r.born = now;
    }
  }
  for (const b of buildings) {
    if (b.born < 0 && C.p >= b.th) {
      b.born = now;
    }
  }
  const k = 1 - Math.exp(-dt * 1.5);
  landShown += (src.land.p - landShown) * k;
  const hTarget = src.heights.state === "failed" ? 0 : smoothstep(0.15, 1, src.heights.p);
  heightsShown += (hTarget - heightsShown) * k;
  const allDone =
    src.land.p >= 1 && (src.heights.p >= 1 || src.heights.state === "failed") && C.p >= 1;
  if (allDone && doneAt < 0) {
    doneAt = now;
  }
  if (!allDone) {
    doneAt = -1;
  }
  if (fl.mode === "flying" || fl.mode === "arriving") {
    stepFlight(dt, now);
  } else if (fl.mode === "glide") {
    stepGlide(now);
  } else if (camAlt() < 40e3) {
    showStations(now);
  }
  render(now);
  updateCaption(now);
  $("readout").textContent =
    `alt ${fmtAlt(camAlt())} - landscape ${pct(src.land.p)} hills ${src.heights.state === "failed" ? "failed" : pct(src.heights.p)} city ${pct(C.p)} - ${fl.mode}` +
    (fl.mode === "flying" ? ` (held at ${fmtAlt(fl.floor.alt)})` : "");
  requestAnimationFrame(frame);
}
const pct = (p) => `${Math.round(p * 100)}%`;
const fmtAlt = (a) => (a >= 10000 ? `${Math.round(a / 1000)} km` : a >= 1000 ? `${(a / 1000).toFixed(1)} km` : `${Math.round(a)} m`);

// ---------------------------------------------------------------- input
const view = $("view");
const inDebug = (el) => !!(el && el.closest && el.closest("#debug"));
const pointers = new Map();
let pinchD = 0;
window.addEventListener(
  "pointerdown",
  (e) => {
    if (!inDebug(e.target)) {
      interrupt();
    }
  },
  true,
);
window.addEventListener(
  "wheel",
  (e) => {
    if (!inDebug(e.target)) {
      interrupt();
    }
  },
  { capture: true, passive: true },
);
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey });
  view.classList.add("dragging");
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchD = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
cv.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    return;
  }
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD > 0 && d > 0) {
      zoomBy(pinchD / d);
    }
    pinchD = d;
    return;
  }
  if (p.b === 2 || p.b === 1 || p.shift) {
    panBy(dx, dy);
  } else {
    cam.heading -= dx * 0.3;
    cam.pitch = clamp(cam.pitch + dy * 0.25, 12, 90);
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    view.classList.remove("dragging");
  }
};
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0015));
  },
  { passive: false },
);
function zoomBy(f) {
  cam.dist = clamp(cam.dist * f, 40, 2.5e7);
}
function panBy(dx, dy) {
  const s = (cam.dist / E.fpx) * 1.2;
  const h = rad(cam.heading);
  cam.tx += (-dx * Math.cos(h) + dy * Math.sin(h)) * s;
  cam.ty += (dx * Math.sin(h) + dy * Math.cos(h)) * s;
}
window.addEventListener("keydown", (e) => {
  if (inDebug(e.target)) {
    return;
  }
  interrupt();
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    return;
  }
  const step = 40;
  const k = e.key.toLowerCase();
  const actions = {
    arrowleft: () => panBy(step, 0),
    a: () => panBy(step, 0),
    arrowright: () => panBy(-step, 0),
    d: () => panBy(-step, 0),
    arrowup: () => panBy(0, step),
    w: () => panBy(0, step),
    arrowdown: () => panBy(0, -step),
    s: () => panBy(0, -step),
    q: () => (cam.heading += 6),
    e: () => (cam.heading -= 6),
    "+": () => zoomBy(0.8),
    "=": () => zoomBy(0.8),
    "-": () => zoomBy(1.25),
    f: () => frameTour(simT),
  };
  if (actions[k]) {
    actions[k]();
    e.preventDefault();
  }
});

// chrome: rail, View menu, caption links, debug strip
const tree = $("tree");
(function buildTree() {
  const li = (html, cls, act) => {
    const item = document.createElement("li");
    const b = document.createElement("button");
    b.className = cls;
    b.dataset.act = act;
    b.innerHTML = html;
    item.append(b);
    tree.append(item);
  };
  li(`<span class="num">T</span><span class="label">${TOUR_NAME}</span>`, "root", "tour");
  STATIONS.forEach((s, i) => {
    li(`<span class="num">${s.n}</span><span class="label">${s.name}</span>`, "kid", `st${i}`);
  });
})();
function act(name) {
  if (name === "tour" || name === "skip") {
    frameTour(simT);
  } else if (name === "replay") {
    reset(scenario, false);
  } else if (name === "retry") {
    Object.assign(src.heights, {
      state: "loading",
      stallAt: null,
      fails: false,
      dur: 3,
      start: simT,
      stalledFor: 0,
      failedAt: null,
    });
    src.heights.p = 0.33;
    doneAt = -1;
  } else if (name && name.startsWith("st")) {
    showStations(simT);
    frameStation(Number(name.slice(2)), simT);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (el && !inDebug(el)) {
    $("viewMenu").hidden = true;
    act(el.dataset.act);
  }
});
$("viewBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $("viewMenu");
  m.hidden = !m.hidden;
  $("viewBtn").setAttribute("aria-expanded", String(!m.hidden));
});
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".menu")) {
    $("viewMenu").hidden = true;
  }
});
$("debug").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) {
    return;
  }
  b.blur(); // keys must reach the editor again, so any key still takes over
  if (b.dataset.sc) {
    reset(b.dataset.sc, false);
  } else if (b.dataset.dbg === "replay") {
    reset(scenario, false);
  } else if (b.dataset.dbg === "draft") {
    reset(scenario, true);
  }
});

new ResizeObserver(resize).observe(view);
resize();
reset(SCENARIOS[params.get("sc")] ? params.get("sc") : "normal", params.get("draft") === "1");
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
