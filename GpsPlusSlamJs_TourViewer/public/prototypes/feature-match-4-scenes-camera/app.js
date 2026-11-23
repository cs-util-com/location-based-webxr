/* Throwaway prototype: camera-first scenes flow for the feature-match photo test.
   Everything is faked: processing runs on timers, the zip is a text placeholder.
   State lives in localStorage so "Simulate reload" shows a real resume. */
(() => {
  "use strict";

  const KEY = "fm-scenes-camera-proto-v1";
  const $ = (id) => document.getElementById(id);

  const METHODS = [
    { id: "orb", name: "ORB", ms: 500 },
    { id: "akaze", name: "AKAZE", ms: 800 },
    { id: "sift", name: "SIFT", ms: 1200 },
    { id: "sp", name: "SuperPoint + LightGlue", ms: 2200 },
  ];

  const ICON = {
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6 7s-5-2-6.5-4.5L4 13a1.5 1.5 0 0 1 2.5-1.5L8 13"/></svg>',
    ghost: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="12" height="10" rx="1.5"/><rect x="9" y="9" width="12" height="10" rx="1.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 8.5l3 3 7-7"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  };

  const KINDS = {
    light: {
      title: "Light",
      motion: "still",
      intro: "Lean the phone on something steady, aimed at a busy corner.",
      shots: [
        { code: "L1", name: "Normal light", main: "Set the phone down, aim at a detailed corner", sub: "Shelves, books, plants. After this shot the phone stays put." },
        { code: "L2", name: "Same again", main: "Change nothing, take it again", sub: "This is the control shot. Do not touch the phone." },
        { code: "L3", name: "Dimmed", main: "Stand up, dim the light, come back", sub: "Main light off, one small lamp on. The phone stays where it is." },
        { code: "L4", name: "As dark as possible", main: "Make it as dark as you can", sub: "Shapes should still show. Then come back and tap." },
      ],
      pairs: [
        { a: "L1", b: "L2", label: "L1 - L2" },
        { a: "L1", b: "L3", label: "L1 - L3" },
        { a: "L1", b: "L4", label: "L1 - L4" },
      ],
    },
    flat: {
      title: "Flat surface",
      motion: "hand",
      intro: "Hold the phone. Find a poster or a patterned door.",
      shots: [
        { code: "F1", name: "Upright, 1.5 m", main: "Stand 1.5 m in front of the poster", sub: "Hold the phone upright. Fill the frame guide." },
        { code: "F2", name: "Same again", main: "Same spot, take it again", sub: "Control shot. The quarter and half turns are computed from it." },
        { code: "F3", name: "At an angle", main: "Walk round to a 30-45 deg angle", sub: "Stay about 1.5 m away and aim back at the poster." },
        { code: "F4", name: "From 3 m", main: "Step back to 3 m", sub: "Straight in front again, poster in the middle." },
        { code: "F5", name: "From 1 m", main: "Come close, to 1 m", sub: "Straight in front, poster in the middle." },
        { code: "F6", name: "Side step", main: "Back to 1.5 m, then 1 m to the side", sub: "Keep the poster in view, aim back at it." },
      ],
      pairs: [
        { a: "F1", b: "F2", label: "F1 - F2" },
        { a: "F1", b: "F3", label: "F1 - F3" },
        { a: "F1", b: "F4", label: "F1 - F4" },
        { a: "F5", b: "F4", label: "F5 - F4" },
        { a: "F1", b: "F6", label: "F1 - F6" },
        { a: "F1", b: "F2", label: "F1 - F2 quarter turn", synth: true },
        { a: "F1", b: "F2", label: "F1 - F2 half turn", synth: true },
      ],
    },
    deep: {
      title: "Deep",
      motion: "hand",
      intro: "Hold the phone. Aim down a hallway.",
      shots: [
        { code: "D1", name: "Down the hallway", main: "Aim down the hallway at chest height", sub: "See as far into it as you can." },
        { code: "D2", name: "Same again", main: "Stay where you are, take it again", sub: "Control shot." },
        { code: "D3", name: "Side step", main: "Step 1 m to the side", sub: "Aim down the hallway again." },
      ],
      pairs: [
        { a: "D1", b: "D2", label: "D1 - D2" },
        { a: "D1", b: "D3", label: "D1 - D3" },
      ],
    },
    own: {
      title: "Your own pair",
      motion: "hand",
      intro: "Any two photos you want compared.",
      shots: [
        { code: "A", name: "First photo", main: "Take the first photo of your pair", sub: "Anything you are curious about." },
        { code: "B", name: "Second photo", main: "Take the second photo", sub: "Change whatever you want to test." },
      ],
      pairs: [{ a: "A", b: "B", label: "A - B" }],
    },
  };

  // ---------------------------------------------------------------- state
  let S = load();
  let active = null; // the unit being measured right now (not persisted)
  let countdownTimer = null;
  let toastTimer = null;
  let ghostOn = false;
  let waitChosen = false;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* storage blocked: start fresh */
    }
    return null;
  }
  function save() {
    try {
      if (S) localStorage.setItem(KEY, JSON.stringify(S));
    } catch {
      /* full or blocked: prototype keeps going */
    }
  }

  function newState(places, own) {
    const scenes = [];
    for (let p = 1; p <= places; p++) scenes.push(makeScene("light", p, places));
    scenes.push(makeScene("flat", 1, 1));
    scenes.push(makeScene("deep", 1, 1));
    if (own) scenes.push(makeScene("own", 1, 1));
    return { v: 1, places, own, scenes, cur: { s: 0, k: 0 }, retake: null, endOpen: false, zip: null, log: [], started: Date.now() };
  }
  function makeScene(kind, place, places) {
    return {
      id: kind + place,
      kind,
      place,
      places,
      shots: KINDS[kind].shots.map((s) => ({ code: s.code, status: "todo", thumb: null, lum: null, check: null })),
      done: [],
    };
  }
  function log(msg) {
    if (!S) return;
    const t = new Date().toISOString().slice(11, 19);
    S.log.push(t + " " + msg);
    if (S.log.length > 300) S.log.shift();
  }

  const def = (sc, k) => KINDS[sc.kind].shots[k];
  const shotByCode = (sc, code) => sc.shots.find((s) => s.code === code);
  const sceneName = (sc) => KINDS[sc.kind].title + (sc.places > 1 ? " - place " + sc.place : "");
  const isComplete = (sc) => sc.shots.every((s) => s.status !== "todo");
  const pairsOf = (sc) => KINDS[sc.kind].pairs.filter((p) => shotByCode(sc, p.a).status === "done" && shotByCode(sc, p.b).status === "done");
  const unitsOf = (sc) => pairsOf(sc).flatMap((p) => METHODS.map((m) => ({ key: p.label + "|" + m.id, pair: p, m })));
  const remainingOf = (sc) => unitsOf(sc).filter((u) => !sc.done.includes(u.key));
  const totalShots = () => S.scenes.reduce((n, sc) => n + sc.shots.length, 0);
  const takenShots = () => S.scenes.reduce((n, sc) => n + sc.shots.filter((s) => s.status === "done").length, 0);
  const handledShots = () => S.scenes.reduce((n, sc) => n + sc.shots.filter((s) => s.status !== "todo").length, 0);

  function sceneStatus(sc) {
    const units = unitsOf(sc);
    if (!isComplete(sc)) return sc.shots.some((s) => s.status !== "todo") ? "capturing" : "ahead";
    if (units.length === 0) return "skipped";
    if (active && active.sceneId === sc.id) return "measuring";
    if (remainingOf(sc).length) return "queued";
    return "done";
  }
  function sceneFraction(sc) {
    const units = unitsOf(sc);
    if (!units.length) return 0;
    let d = units.filter((u) => sc.done.includes(u.key)).length;
    if (active && active.sceneId === sc.id) d += activeFrac();
    return d / units.length;
  }
  function activeFrac() {
    if (!active) return 0;
    return Math.min(1, (performance.now() - active.start) / active.ms);
  }
  function remainingMs() {
    let ms = 0;
    for (const sc of S.scenes) {
      if (!isComplete(sc)) continue;
      for (const u of remainingOf(sc)) ms += u.m.ms;
    }
    if (active) ms -= active.ms * activeFrac();
    return Math.max(0, ms);
  }
  function fmtEta(ms) {
    const s = Math.ceil(ms / 1000);
    if (s <= 0) return "";
    if (s < 60) return "about " + Math.max(5, Math.round(s / 5) * 5) + " s";
    return "about " + Math.round(s / 60) + " min";
  }
  function allMeasured() {
    return S.scenes.every((sc) => isComplete(sc) && remainingOf(sc).length === 0);
  }

  function nextTodo() {
    for (let s = 0; s < S.scenes.length; s++) {
      const k = S.scenes[s].shots.findIndex((x) => x.status === "todo");
      if (k >= 0) return { s, k };
    }
    return null;
  }

  // ---------------------------------------------------------------- processing (fake, never blocks the preview)
  function procTick() {
    if (!S) return;
    if (active) {
      const sc = S.scenes.find((x) => x.id === active.sceneId);
      const still = sc && remainingOf(sc).some((u) => u.key === active.key);
      if (!still) active = null;
      else if (activeFrac() >= 1) {
        sc.done.push(active.key);
        log("result " + sceneName(sc) + " " + active.key.replace("|", " "));
        active = null;
        save();
        if (S.scenes.every((x) => isComplete(x)) && allMeasured()) log("all results done");
      }
    }
    if (!active) {
      for (const sc of S.scenes) {
        if (!isComplete(sc)) continue;
        const r = remainingOf(sc);
        if (r.length) {
          active = { sceneId: sc.id, key: r[0].key, ms: r[0].m.ms, start: performance.now() };
          break;
        }
      }
    }
    renderProc();
  }

  // ---------------------------------------------------------------- camera
  const video = $("video");
  const canvas = $("view");
  const ctx = canvas.getContext("2d");
  let camReady = false;

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      camReady = true;
    } catch {
      camReady = false; // drawn fallback stays
    }
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }

  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function currentDef() {
    if (!S) return { sc: null, d: null };
    const sc = S.scenes[S.cur.s];
    return { sc, d: sc ? def(sc, S.cur.k) : null };
  }

  function draw(t) {
    const w = canvas.width;
    const h = canvas.height;
    if (camReady && video.videoWidth) {
      const vr = video.videoWidth / video.videoHeight;
      const cr = w / h;
      let sw = video.videoWidth;
      let sh = video.videoHeight;
      let sx = 0;
      let sy = 0;
      if (vr > cr) {
        sw = sh * cr;
        sx = (video.videoWidth - sw) / 2;
      } else {
        sh = sw / cr;
        sy = (video.videoHeight - sh) / 2;
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      const { sc, d } = currentDef();
      const kind = sc ? sc.kind : "light";
      const code = d ? d.code : "L1";
      if (kind === "light") drawLight(w, h, t, code, sc ? sc.place : 1);
      else if (kind === "flat") drawFlat(w, h, t, code);
      else if (kind === "deep") drawDeep(w, h, t, code);
      else drawLight(w, h, t, "L1", 7);
    }
    requestAnimationFrame(draw);
  }

  function drawLight(w, h, t, code, place) {
    const r = rng(11 + place * 97);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, place % 2 ? "#cdb898" : "#a9b8c4");
    g.addColorStop(1, place % 2 ? "#8f7a5e" : "#6f7f8c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // corner line
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(w * 0.62, 0, w * 0.38, h);
    // floor
    ctx.fillStyle = "#5b4330";
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    // shelf
    const sx = w * 0.1;
    const sy = h * 0.2;
    const sw = w * 0.5;
    const sh = h * 0.56;
    ctx.fillStyle = "#4a2f1d";
    ctx.fillRect(sx, sy, sw, sh);
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const ry = sy + (sh / rows) * i + 6;
      const rh = sh / rows - 14;
      let x = sx + 8;
      while (x < sx + sw - 20) {
        const bw = w * (0.018 + r() * 0.03);
        const bh = rh * (0.6 + r() * 0.4);
        ctx.fillStyle = `hsl(${Math.floor(r() * 360)},${40 + r() * 40}%,${30 + r() * 35}%)`;
        ctx.fillRect(x, ry + rh - bh, Math.min(bw, sx + sw - 8 - x), bh);
        x += bw + 2;
      }
      ctx.fillStyle = "#3a2414";
      ctx.fillRect(sx, ry + rh, sw, 8);
    }
    // picture frame
    ctx.fillStyle = "#222";
    ctx.fillRect(w * 0.68, h * 0.16, w * 0.24, h * 0.17);
    ctx.fillStyle = "#7fb2d9";
    ctx.fillRect(w * 0.69, h * 0.17, w * 0.22, h * 0.15);
    ctx.fillStyle = "#3f7a46";
    ctx.beginPath();
    ctx.moveTo(w * 0.69, h * 0.32);
    ctx.lineTo(w * 0.76, h * 0.22);
    ctx.lineTo(w * 0.83, h * 0.29);
    ctx.lineTo(w * 0.91, h * 0.2);
    ctx.lineTo(w * 0.91, h * 0.32);
    ctx.fill();
    // plant
    ctx.fillStyle = "#8a4b2a";
    ctx.fillRect(w * 0.72, h * 0.64, w * 0.14, h * 0.14);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `hsl(${100 + r() * 40},45%,${25 + r() * 20}%)`;
      ctx.beginPath();
      ctx.ellipse(w * (0.72 + r() * 0.14), h * (0.48 + r() * 0.17), w * 0.04, h * 0.02, r() * 3, 0, 7);
      ctx.fill();
    }
    // the tester dims the room for L3 / L4
    const b = code === "L3" ? 0.42 : code === "L4" ? 0.16 : 1;
    if (b < 1) {
      ctx.fillStyle = `rgba(4,6,16,${1 - b})`;
      ctx.fillRect(0, 0, w, h);
      // lamp glow
      const lg = ctx.createRadialGradient(w * 0.85, h * 0.6, 0, w * 0.85, h * 0.6, w * 0.5);
      lg.addColorStop(0, `rgba(255,190,110,${b * 0.5})`);
      lg.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, w, h);
    }
    // a little sensor noise so it feels live
    const nr = rng(Math.floor(t / 80));
    ctx.fillStyle = `rgba(255,255,255,${b < 1 ? 0.07 : 0.03})`;
    for (let i = 0; i < 120; i++) ctx.fillRect(nr() * w, nr() * h, 2, 2);
  }

  function drawFlat(w, h, t, code) {
    ctx.fillStyle = "#d8d4cc";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#bdb6aa";
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    const jx = Math.sin(t / 700) * w * 0.004;
    const jy = Math.cos(t / 900) * h * 0.003;
    const cfg = {
      F1: [1, 0, 0],
      F2: [1, 0, 0],
      F3: [0.95, 0, 0.55],
      F4: [0.5, 0, 0],
      F5: [1.45, 0, 0],
      F6: [0.95, -0.22, 0.25],
    }[code] || [1, 0, 0];
    const [s, ox, tilt] = cfg;
    const pw = Math.min(w * 0.62, h * 0.36) * s; // matches the frame guide
    const ph = (pw * 4) / 3;
    ctx.save();
    ctx.translate(w / 2 + ox * w + jx, h * 0.46 + jy);
    ctx.transform(1 - tilt * 0.45, tilt * 0.18, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(-pw / 2 + 8, -ph / 2 + 10, pw, ph);
    ctx.fillStyle = "#f4efe3";
    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    const r = rng(5);
    const cols = 5;
    const cell = pw / cols;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#2a9d8f"][Math.floor(r() * 5)];
        const cx = -pw / 2 + x * cell + cell / 2;
        const cy = -ph / 2 + ph * 0.25 + y * cell * 0.9;
        ctx.beginPath();
        if (r() > 0.5) ctx.arc(cx, cy, cell * 0.32, 0, 7);
        else ctx.rect(cx - cell * 0.3, cy - cell * 0.3, cell * 0.6, cell * 0.6);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#29335c";
    ctx.fillRect(-pw / 2 + pw * 0.08, -ph / 2 + ph * 0.06, pw * 0.84, ph * 0.08);
    ctx.fillStyle = "#e4572e";
    ctx.fillRect(-pw / 2 + pw * 0.08, -ph / 2 + ph * 0.16, pw * 0.5, ph * 0.03);
    ctx.restore();
  }

  function drawDeep(w, h, t, code) {
    const vx = w * (code === "D3" ? 0.32 : 0.5) + Math.sin(t / 800) * w * 0.004;
    const vy = h * 0.44;
    const fw = w * 0.16;
    const fh = h * 0.16;
    const fx = vx - fw / 2;
    const fy = vy - fh / 2;
    const quad = (pts, c) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fill();
    };
    quad([0, 0, w, 0, fx + fw, fy, fx, fy], "#e9e3d6");
    quad([0, h, w, h, fx + fw, fy + fh, fx, fy + fh], "#8b6a4a");
    quad([0, 0, fx, fy, fx, fy + fh, 0, h], "#cfc6b4");
    quad([w, 0, fx + fw, fy, fx + fw, fy + fh, w, h], "#bfb5a2");
    ctx.fillStyle = "#fff6d8";
    ctx.fillRect(fx, fy, fw, fh);
    // doors on the walls
    for (let i = 0; i < 3; i++) {
      const a = 0.15 + i * 0.25;
      const b = a + 0.1;
      const lx = (p) => p * fx;
      const yTop = (p) => p * fy;
      const yBot = (p) => h - p * (h - fy - fh);
      quad([lx(a), yTop(a) + (yBot(a) - yTop(a)) * 0.25, lx(b), yTop(b) + (yBot(b) - yTop(b)) * 0.25, lx(b), yBot(b), lx(a), yBot(a)], "#7a5233");
      const rx = (p) => w - p * (w - fx - fw);
      quad([rx(a), yTop(a) + (yBot(a) - yTop(a)) * 0.25, rx(b), yTop(b) + (yBot(b) - yTop(b)) * 0.25, rx(b), yBot(b), rx(a), yBot(a)], "#6b462b");
    }
    // ceiling lamps
    for (let i = 0; i < 4; i++) {
      const p = 0.2 + i * 0.2;
      const x = vx + (w / 2 - vx) * (1 - p) * 0;
      ctx.fillStyle = "rgba(255,250,220,0.9)";
      ctx.beginPath();
      ctx.ellipse(x + (vx - x), fy * p + 0, fw * (1.4 - p), fh * 0.08 * (1.4 - p), 0, 0, 7);
      ctx.fill();
    }
  }

  function lumOf(src) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const x = c.getContext("2d");
    x.drawImage(src, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  }
  function thumbOf(src) {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = Math.round((240 * src.height) / src.width);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.62);
  }

  // ---------------------------------------------------------------- capture
  function onShutter() {
    if (!S) return;
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      $("shutter").classList.remove("counting");
      $("countdown").textContent = "";
      return;
    }
    const { sc } = currentDef();
    if (sc && KINDS[sc.kind].motion === "still") {
      // a self-timer so the tap does not shake a phone that must stay still
      let n = 2;
      $("shutter").classList.add("counting");
      $("countdown").textContent = n;
      countdownTimer = setInterval(() => {
        n -= 1;
        if (n > 0) $("countdown").textContent = n;
        else {
          clearInterval(countdownTimer);
          countdownTimer = null;
          $("shutter").classList.remove("counting");
          $("countdown").textContent = "";
          capture();
        }
      }, 1000);
    } else capture();
  }

  function capture() {
    const sc = S.scenes[S.cur.s];
    const shot = sc.shots[S.cur.k];
    const wasRetake = shot.status === "done";
    $("flash").classList.remove("go");
    void $("flash").offsetWidth;
    $("flash").classList.add("go");
    shot.thumb = thumbOf(canvas);
    shot.lum = lumOf(canvas);
    shot.status = "done";
    shot.t = Date.now();
    if (wasRetake) {
      const before = sc.done.length;
      sc.done = sc.done.filter((key) => {
        const pair = KINDS[sc.kind].pairs.find((p) => key.startsWith(p.label + "|"));
        return !pair || (pair.a !== shot.code && pair.b !== shot.code);
      });
      log("retake " + sceneName(sc) + " " + shot.code + ", dropped " + (before - sc.done.length) + " results");
    } else log("photo " + sceneName(sc) + " " + shot.code + " saved");
    shot.check = lightCheck(sc, shot);
    // a retake of the first shot changes the light reference, so re-check the others
    if (sc.kind === "light" && shot.code === "L1") for (const o of sc.shots) if (o.code !== "L1" && o.status === "done") o.check = lightCheck(sc, o);

    $("savedTick").classList.add("on");
    setTimeout(() => $("savedTick").classList.remove("on"), 1600);

    S.retake = null;
    const n = nextTodo();
    if (n) {
      const sceneChanged = n.s !== S.cur.s;
      S.cur = n;
      if (shot.check && !shot.check.ok) showCheck(sc, shot);
      else if (sceneChanged && isComplete(sc)) {
        showToast("ok", (shot.check ? `<b>${shot.code}</b> ${shot.check.text} ` : "") + `${sceneName(sc)} done, measuring in the background. Next: ${sceneName(S.scenes[n.s])}.`);
      } else if (shot.check) showCheck(sc, shot);
    } else {
      if (shot.check) showCheck(sc, shot);
      S.endOpen = true;
      log("all shots handled");
      setTimeout(openEnd, 650);
    }
    save();
    render();
  }

  function lightCheck(sc, shot) {
    if (sc.kind !== "light" || shot.code === "L1") return null;
    const l1 = shotByCode(sc, "L1");
    if (!l1 || l1.status !== "done" || !l1.lum) return null;
    const ratio = shot.lum / l1.lum;
    const pct = Math.round((1 - ratio) * 100);
    if (shot.code === "L2") {
      return Math.abs(1 - ratio) < 0.15 ? { ok: true, text: "Same light as L1. Good control." } : { ok: false, text: "The light changed since L1 (" + (pct > 0 ? pct + "% darker" : -pct + "% brighter") + ")." };
    }
    if (shot.code === "L3") {
      return ratio < 0.75 ? { ok: true, text: pct + "% darker than L1. Good." } : { ok: false, text: "Hardly darker than L1 (" + Math.max(0, pct) + "%). Dim more?" };
    }
    const l3 = shotByCode(sc, "L3");
    const r3 = l3 && l3.status === "done" && l3.lum ? l3.lum / l1.lum : 1;
    return ratio < 0.5 && ratio < r3 * 0.85 ? { ok: true, text: "Darkest yet: " + pct + "% below L1." } : { ok: false, text: "Not darker than L3. Make it darker?" };
  }

  function showCheck(sc, shot) {
    const c = shot.check;
    const si = S.scenes.indexOf(sc);
    const k = sc.shots.indexOf(shot);
    showToast(c.ok ? "ok" : "warn", `<b>${shot.code}</b> ${c.text}`, c.ok ? null : { label: "Retake " + shot.code, fn: () => startRetake(si, k) });
  }

  function showToast(kind, html, action, ms = 5000) {
    const el = $("toast");
    clearTimeout(toastTimer);
    el.className = kind === "warn" ? "warn" : "";
    el.innerHTML = `<span class="dot"></span><span class="txt">${html}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = () => {
        el.hidden = true;
        action.fn();
      };
      el.appendChild(b);
    }
    el.hidden = false;
    toastTimer = setTimeout(() => (el.hidden = true), action ? ms + 3000 : ms);
  }

  function pairsUsing(sc, code) {
    return KINDS[sc.kind].pairs.filter((p) => p.a === code || p.b === code);
  }

  function startRetake(s, k) {
    S.cur = { s, k };
    S.retake = { s, k };
    $("toast").hidden = true;
    closeSheets();
    save();
    render();
  }
  function takeNow(s, k) {
    const sc = S.scenes[s];
    sc.shots[k].status = "todo";
    S.cur = { s, k };
    S.retake = null;
    closeSheets();
    save();
    render();
  }
  function cancelRetake() {
    S.retake = null;
    S.cur = nextTodo() || S.cur;
    save();
    render();
  }
  function skipShot(s, k) {
    const sc = S.scenes[s];
    sc.shots[k].status = "skipped";
    log("skip " + sceneName(sc) + " " + sc.shots[k].code);
    afterSkip();
  }
  function skipScene(s) {
    const sc = S.scenes[s];
    sc.shots.forEach((x) => {
      if (x.status === "todo") x.status = "skipped";
    });
    log("skip scene " + sceneName(sc));
    afterSkip();
  }
  function afterSkip() {
    const n = nextTodo();
    if (n) S.cur = n;
    save();
    render();
    renderSheet();
    if (!n) {
      S.endOpen = true;
      save();
      openEnd();
    }
  }
  function addOwnPair() {
    S.own = true;
    S.scenes.push(makeScene("own", 1, 1));
    log("added own pair");
    S.cur = nextTodo() || S.cur;
    save();
    render();
    renderSheet();
  }

  // ---------------------------------------------------------------- render: camera overlay
  function render() {
    document.body.classList.toggle("no-run", !S);
    if (!S) return;
    const sc = S.scenes[S.cur.s];
    const k = S.cur.k;
    const d = def(sc, k);
    const kind = KINDS[sc.kind];
    const shotIdx = k + 1;

    // story-style segments, one group per scene
    $("segments").innerHTML = S.scenes
      .map(
        (x, si) =>
          `<div class="seg-group" style="flex-grow:${x.shots.length}">` +
          x.shots.map((sh, ki) => `<div class="seg ${si === S.cur.s && ki === k ? "current" : sh.status === "done" ? "done" : sh.status === "skipped" ? "skipped" : ""}"></div>`).join("") +
          "</div>",
      )
      .join("");

    $("sceneLabel").textContent = `Scene ${S.cur.s + 1} of ${S.scenes.length} · ${sceneName(sc)} · shot ${shotIdx} of ${sc.shots.length}`;
    $("shotCode").textContent = d.code;
    $("shotName").textContent = d.name;

    const still = kind.motion === "still";
    const mc = $("motionChip");
    mc.className = "chip" + (still ? " still" : "");
    mc.innerHTML = still ? ICON.lock + (d.code === "L1" && sc.shots[0].status !== "done" ? "Phone stays still from now on" : "Phone stays still") : ICON.hand + "Hand-held, you move";

    // ghost of the first shot helps line up controls and retakes
    const first = sc.shots[0];
    const gb = $("ghostBtn");
    const ghostUseful = k > 0 && first.status === "done" && first.thumb;
    gb.hidden = !ghostUseful;
    if (!ghostUseful) ghostOn = false;
    gb.innerHTML = ICON.ghost + "Ghost of " + first.code;
    gb.setAttribute("aria-pressed", ghostOn ? "true" : "false");
    if (ghostUseful) $("ghost").src = first.thumb;
    else $("ghost").removeAttribute("src");
    $("ghost").classList.toggle("on", ghostOn && ghostUseful);

    $("frameGuide").classList.toggle("on", sc.kind === "flat" && ["F1", "F2"].includes(d.code));

    // retake banner
    const bn = $("banner");
    if (S.retake) {
      const using = pairsUsing(sc, d.code);
      bn.hidden = false;
      bn.innerHTML = `<span class="txt"><b>Retaking ${d.code}.</b> ${using.length > 1 ? using.length + " pairs use it and are measured again." : using.length === 1 ? "Its pair is measured again." : ""}</span><button id="cancelRetake">Keep old</button>`;
      $("cancelRetake").onclick = cancelRetake;
    } else bn.hidden = true;

    const allHandled = !nextTodo() && !S.retake;
    if (allHandled) {
      $("instrMain").textContent = "All shots are taken";
      $("instrSub").textContent = "Open the results from the menu, or swipe up to retake a shot.";
    } else {
      $("instrMain").textContent = d.main;
      const intro = k === 0 && sc.shots[0].status !== "done" ? kind.intro + " " : "";
      $("instrSub").textContent = intro ? intro + d.sub : d.sub;
    }
    $("shutter").disabled = allHandled;

    $("shutter").classList.toggle("retake", !!S.retake);
    $("shutter").setAttribute("aria-label", (S.retake ? "Retake " : "Take ") + d.code);
    $("timerTag").hidden = !still;

    // last photo thumb
    let last = null;
    for (const x of S.scenes) for (const sh of x.shots) if (sh.status === "done" && (!last || sh.t > last.t)) last = sh;
    $("thumbImg").hidden = !last;
    if (last) $("thumbImg").src = last.thumb;
    $("thumbEmpty").textContent = last ? "" : "";

    $("counterText").textContent = `${handledShots()}/${totalShots()}`;
    renderProc();
  }

  function renderProc() {
    if (!S) return;
    // ring = share of all results measured so far
    let total = 0;
    let done = 0;
    for (const sc of S.scenes) {
      const units = isComplete(sc) ? unitsOf(sc).length : KINDS[sc.kind].pairs.length * METHODS.length;
      total += units;
      done += sceneFraction(sc) * (isComplete(sc) ? units : 0);
    }
    const C = 2 * Math.PI * 29;
    const ring = $("ringFg");
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - (total ? done / total : 0));

    const pill = $("procPill");
    const statuses = S.scenes.map(sceneStatus);
    const measuring = S.scenes.find((sc) => sceneStatus(sc) === "measuring");
    if (measuring) {
      pill.hidden = false;
      pill.className = "busy";
      pill.innerHTML = `<span class="pd"></span>${KINDS[measuring.kind].title} ${Math.round(sceneFraction(measuring) * 100)}%`;
    } else if (statuses.includes("done")) {
      pill.hidden = false;
      pill.className = "done";
      pill.innerHTML = `<span class="pd"></span>${statuses.filter((x) => x === "done").length} done`;
    } else pill.hidden = true;

    if (!$("sheet").hidden) renderSheetStatuses();
    if (!$("endView").hidden) renderEndLive();
  }

  // ---------------------------------------------------------------- sheets
  function openBackdrop() {
    $("backdrop").hidden = false;
  }
  function closeSheets() {
    for (const id of ["sheet", "review", "setup", "endView"]) $(id).hidden = true;
    $("backdrop").hidden = true;
    if (S && S.endOpen) {
      S.endOpen = false;
      save();
    }
  }

  function statusHtml(sc) {
    const st = sceneStatus(sc);
    const map = {
      ahead: ["", "Not started"],
      capturing: ["", "Capturing"],
      queued: ["queued", "Waiting to measure"],
      measuring: ["measuring", "Measuring " + Math.round(sceneFraction(sc) * 100) + "%"],
      done: ["done", "Measured"],
      skipped: ["", "Skipped"],
    }[st];
    return `<span class="status ${map[0]}" data-st="${sc.id}"><span class="pd"></span>${map[1]}</span>`;
  }
  function renderSheetStatuses() {
    for (const sc of S.scenes) {
      const el = document.querySelector(`#sheet [data-st="${sc.id}"]`);
      if (el) el.outerHTML = statusHtml(sc);
    }
  }

  function openSheet() {
    renderSheet();
    openBackdrop();
    $("sheet").hidden = false;
  }
  function renderSheet() {
    if (!S) return;
    const el = $("sheet");
    const left = totalShots() - handledShots();
    let h = `<div class="sheet-head"><div class="grab"></div><h2><span class="sp">All shots</span><button class="close-x" data-close aria-label="Close">×</button></h2>
      <p>${takenShots()} taken${left ? ", " + left + " to go" : ""}. Retake or skip any shot.</p></div><div class="sheet-body">`;
    S.scenes.forEach((sc, si) => {
      const hasTodo = sc.shots.some((x) => x.status === "todo");
      h += `<div class="group"><div class="group-head"><h3>${sceneName(sc)} <span>· ${sc.shots.length} shots</span></h3>${statusHtml(sc)}${hasTodo ? `<button class="mini-btn" data-skipscene="${si}">Skip scene</button>` : ""}</div>`;
      sc.shots.forEach((sh, ki) => {
        const d = def(sc, ki);
        const isCur = si === S.cur.s && ki === S.cur.k;
        const using = pairsUsing(sc, sh.code).length;
        let sub;
        if (sh.status === "done" && sh.check) sub = `<div class="s ${sh.check.ok ? "ok" : "warn"}">${sh.check.text}</div>`;
        else if (sh.status === "done") sub = `<div class="s">Saved${ki === 0 && using > 1 ? " · used by " + using + " pairs" : ""}</div>`;
        else if (sh.status === "skipped") sub = `<div class="s">Skipped</div>`;
        else sub = `<div class="s">${isCur ? "Next up" : "To do"}</div>`;
        let act;
        if (sh.status === "done") act = `<button class="mini-btn" data-retake="${si}:${ki}">Retake</button>`;
        else if (sh.status === "skipped") act = `<button class="mini-btn" data-take="${si}:${ki}">Take</button>`;
        else if (!isCur) act = `<button class="mini-btn" data-take="${si}:${ki}">Take now</button><button class="mini-btn" data-skip="${si}:${ki}">Skip</button>`;
        else act = `<button class="mini-btn" data-skip="${si}:${ki}">Skip</button>`;
        const bg = sh.thumb && sh.status === "done" ? `style="background-image:url(${sh.thumb})"` : "";
        h += `<div class="shot-row${isCur ? " current" : ""}"><div class="shot-thumb" ${bg}>${bg ? `<span class="code">${sh.code}</span>` : sh.code}</div>
          <div class="shot-info"><div class="n">${d.name}</div>${sub}</div><div class="shot-actions">${act}</div></div>`;
      });
      if (sc.kind === "flat") h += `<div class="note">The quarter and half turns are not photographed: they are computed from F2.</div>`;
      if (sc.kind === "light" && sc.shots[0].status === "done") h += `<div class="note">Retaking <b>L1</b> measures all three light pairs of this place again.</div>`;
      h += `</div>`;
    });
    h += `</div><div class="sheet-foot">${S.own ? "" : `<button class="btn" data-own>Add your own pair</button>`}<button class="btn primary" data-finish>${left ? "Finish now" : "See results"}</button></div>`;
    el.innerHTML = h;
  }

  function openReview() {
    let last = null;
    let where = null;
    S.scenes.forEach((sc, si) =>
      sc.shots.forEach((sh, ki) => {
        if (sh.status === "done" && (!last || sh.t > last.t)) {
          last = sh;
          where = [si, ki];
        }
      }),
    );
    if (!last) return;
    const sc = S.scenes[where[0]];
    const d = def(sc, where[1]);
    $("review").innerHTML = `<div class="sheet-head"><div class="grab"></div><h2><span class="sp">${last.code} · ${d.name}</span><button class="close-x" data-close aria-label="Close">×</button></h2>
      <p>${sceneName(sc)} · saved on this phone${last.check ? " · " + last.check.text : ""}</p></div>
      <div class="sheet-body"><img class="review-img" src="${last.thumb}" alt="Last photo ${last.code}"></div>
      <div class="sheet-foot"><button class="btn" data-retake="${where[0]}:${where[1]}">Retake ${last.code}</button><button class="btn primary" data-close>Keep</button></div>`;
    openBackdrop();
    $("review").hidden = false;
  }

  // ---------------------------------------------------------------- setup
  let setupPlaces = 1;
  let setupOwn = false;
  function openSetup() {
    render();
    renderSetup();
    $("backdrop").hidden = false;
    $("setup").hidden = false;
  }
  function renderSetup() {
    const n = 4 * setupPlaces + 6 + 3 + (setupOwn ? 2 : 0);
    $("setup").innerHTML = `<div class="sheet-head"><div class="grab"></div><h2>Photo test</h2><p>Three scenes, ${n} shots. Every photo is saved on this phone the moment you take it.</p></div>
      <div class="sheet-body">
        <div class="scene-lines"><div class="scene-line"><span class="num">1</span><div><div class="t">Light</div><div class="d">Phone on a table, 4 shots. You only stand up twice, to dim the light.</div></div></div>
        <div class="scene-line"><span class="num">2</span><div><div class="t">Flat surface</div><div class="d">Hand-held at a poster, 6 shots at different distances and angles.</div></div></div>
        <div class="scene-line"><span class="num">3</span><div><div class="t">Deep</div><div class="d">Hand-held down a hallway, 3 shots.</div></div></div></div>
        <div class="label">Light scene, at how many places?</div>
        <div class="seg-pick">${[1, 2, 3].map((p) => `<button data-places="${p}" aria-pressed="${p === setupPlaces}">${p}</button>`).join("")}</div>
        <div class="toggle-row"><span>Add your own pair at the end</span><button class="switch" role="switch" aria-checked="${setupOwn}" data-ownsw aria-label="Add your own pair"></button></div>
      </div>
      <div class="sheet-foot"><button class="btn primary" data-start>Start with Light</button></div>`;
  }

  // ---------------------------------------------------------------- end view
  function openEnd() {
    if (!S) return;
    closeSheets();
    $("toast").hidden = true;
    S.endOpen = true;
    save();
    renderEnd();
    openBackdrop();
    $("endView").hidden = false;
  }

  function endSummary() {
    const taken = takenShots();
    const skipped = S.scenes.reduce((n, sc) => n + sc.shots.filter((s) => s.status === "skipped").length, 0);
    const todo = totalShots() - handledShots();
    return { taken, skipped, todo };
  }

  function renderEnd() {
    const { taken, skipped, todo } = endSummary();
    const title = todo ? "Finished early" : "All shots taken";
    const bits = [taken + " photos"];
    if (skipped) bits.push(skipped + " skipped");
    if (todo) bits.push(todo + " not taken");
    $("endView").innerHTML = `<div class="sheet-head"><div class="grab"></div>
      <h2><span class="sp">${title}</span><button class="close-x" data-close aria-label="Back to camera">×</button></h2>
      <p>${bits.join(" · ")}</p></div>
      <div class="sheet-body" id="endBody"></div>
      <div class="sheet-foot" id="endFoot"></div>`;
    renderEndLive(true);
  }

  function renderEndLive(force) {
    const body = $("endBody");
    const foot = $("endFoot");
    if (!body || !foot) return;
    let h = "";
    for (const sc of S.scenes) {
      const st = sceneStatus(sc);
      const pairs = pairsOf(sc);
      const all = KINDS[sc.kind].pairs.length;
      const map = {
        ahead: ["", "Not taken"],
        capturing: ["", "Not finished"],
        queued: ["queued", "Waiting"],
        measuring: ["measuring", "Measuring"],
        done: ["done", "Done"],
        skipped: ["", "Skipped"],
      }[st];
      h += `<div class="scene-card"><div class="hd"><span class="t">${sceneName(sc)}</span><span class="status ${map[0]}"><span class="pd"></span>${map[1]}</span></div>`;
      if (pairs.length && isComplete(sc)) {
        h += `<div class="sub">${pairs.length} of ${all} pairs${sc.kind === "flat" && pairs.some((p) => p.synth) ? ", turns computed from F2" : ""}</div>`;
        for (const m of METHODS) {
          const units = pairs.map((p) => p.label + "|" + m.id);
          let d = units.filter((u) => sc.done.includes(u)).length;
          if (active && active.sceneId === sc.id && units.includes(active.key)) d += activeFrac();
          const full = Math.floor(d) >= units.length;
          h += `<div class="meth${full ? " done" : ""}"><span class="nm">${m.name}</span><span class="bar"><i style="width:${(d / units.length) * 100}%"></i></span><span class="c">${Math.floor(d)}/${units.length}</span></div>`;
        }
      } else if (st === "capturing" || st === "ahead") {
        h += `<div class="sub">Shots missing, so nothing to measure yet. Close this to take them.</div>`;
      } else {
        h += `<div class="sub">No pairs left after the skips.</div>`;
      }
      h += `</div>`;
    }
    const ms = remainingMs();
    const finished = S.scenes.reduce((n, sc) => n + sc.done.length, 0);
    h += `<div class="trust">${ICON.shield}<span>All ${takenShots()} photos, the log and ${finished} finished results are already stored on this phone. A reload picks up right here.</span></div>`;
    body.innerHTML = h;

    // footer: one primary action at a time
    const z = S.zip;
    const sig = JSON.stringify([z && z.status, z && z.units, waitChosen, ms > 0, finished, fmtEta(ms)]);
    if (!force && foot.dataset.sig === sig) return;
    foot.dataset.sig = sig;
    let f;
    if (z && z.status === "packing") {
      f = `<button class="btn primary" disabled>Packing the zip...</button>`;
    } else if (z && z.status === "ready") {
      const later = z.left ? ` · ${z.left} results left for the PC` : "";
      f = `<button class="btn primary" data-download>Download zip<small>${z.photos} photos, log, summary, ${z.units} results${later}</small></button>`;
      if (finished > z.units) f += `<button class="btn text" data-makezip>Remake it with ${finished - z.units} new results</button>`;
    } else if (ms <= 0) {
      f = `<button class="btn primary" data-makezip>Make the zip<small>Everything is measured</small></button>`;
    } else if (waitChosen) {
      f = `<div class="wait-line"><span class="pd"></span>Waiting, ${fmtEta(ms)} left. The zip button appears when it is done.</div><button class="btn text" data-makezip>Make it now instead</button>`;
    } else {
      f = `<button class="btn primary" data-makezip>Good enough, make the zip now<small>Finished results go in, the rest is measured on the PC later</small></button><button class="btn" data-wait>Wait for the rest<small>${fmtEta(ms)}</small></button>`;
    }
    foot.innerHTML = f;
  }

  function makeZip() {
    const finished = S.scenes.reduce((n, sc) => n + sc.done.length, 0);
    let total = 0;
    for (const sc of S.scenes) total += unitsOf(sc).length;
    S.zip = { status: "packing" };
    waitChosen = false;
    log("zip packing");
    renderEndLive(true);
    setTimeout(() => {
      S.zip = { status: "ready", photos: takenShots(), units: finished, left: total - finished };
      log("zip ready, " + finished + " results, " + (total - finished) + " left for the PC");
      save();
      renderEndLive(true);
    }, 1400);
  }

  function download() {
    const lines = ["Feature-match photo test (prototype placeholder for the zip)", ""];
    for (const sc of S.scenes) {
      lines.push(sceneName(sc) + ": " + sc.shots.map((s) => s.code + " " + s.status).join(", "));
      lines.push("  results: " + sc.done.length + " of " + unitsOf(sc).length);
    }
    lines.push("", "Log:", ...S.log);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "feature-match-scenes-prototype.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    log("zip downloaded");
    save();
  }

  // ---------------------------------------------------------------- menu
  let startOverArmed = false;
  function openMenu() {
    const m = $("menu");
    if (!m.hidden) {
      m.hidden = true;
      return;
    }
    const photos = S ? takenShots() : 0;
    const results = S ? S.scenes.reduce((n, sc) => n + sc.done.length, 0) : 0;
    m.innerHTML = `
      <button data-m="results">Results and zip<small>Make the zip at any time</small></button>
      <button data-m="cockpit">Switch to cockpit view<small>All controls on one screen</small></button>
      <button data-m="log">Copy log<small>For debugging</small></button>
      <button data-m="reload">Simulate reload<small>Reloads the page to show the resume</small></button>
      <button data-m="over" class="danger">${startOverArmed ? "Tap again to delete everything" : "Start over"}</button>
      <div class="store">${ICON.shield}<span>On this phone: ${photos} photos, the log and ${results} results. Saved after every shot.</span></div>`;
    m.hidden = false;
  }
  function onMenu(action) {
    $("menu").hidden = true;
    if (action === "results") openEnd();
    else if (action === "cockpit") showToast("ok", "The cockpit view would open here, at the same shot.", null, 3500);
    else if (action === "log") {
      const txt = S ? S.log.join("\n") : "";
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(() => showToast("ok", "Log copied.", null, 2500))
        .catch(() => showToast("warn", "Copy failed in this browser.", null, 3000));
    } else if (action === "reload") {
      save();
      sessionStorage.setItem(KEY + "-resumed", "1");
      location.reload();
    } else if (action === "over") {
      if (!startOverArmed) {
        startOverArmed = true;
        openMenu();
        setTimeout(() => (startOverArmed = false), 3500);
        return;
      }
      startOverArmed = false;
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      S = null;
      active = null;
      openSetup();
    }
  }

  // ---------------------------------------------------------------- events
  $("shutter").addEventListener("click", onShutter);
  $("counterBtn").addEventListener("click", openSheet);
  $("thumbBtn").addEventListener("click", openReview);
  $("menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu();
  });
  $("ghostBtn").addEventListener("click", () => {
    ghostOn = !ghostOn;
    render();
  });
  $("menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (b) onMenu(b.dataset.m);
  });
  document.addEventListener("click", (e) => {
    const path = e.composedPath();
    if (!$("menu").hidden && !path.includes($("menu")) && !path.includes($("menuBtn"))) $("menu").hidden = true;
  });
  $("backdrop").addEventListener("click", () => {
    if (!$("setup").hidden) return; // setup must be answered
    closeSheets();
  });

  // swipe up on the bottom bar opens the shot list
  let swipeY = null;
  $("bottom").addEventListener("pointerdown", (e) => (swipeY = e.clientY));
  $("bottom").addEventListener("pointerup", (e) => {
    if (swipeY !== null && swipeY - e.clientY > 40) openSheet();
    swipeY = null;
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !t.closest(".sheet")) return;
    const ds = t.dataset;
    const pos = (v) => v.split(":").map(Number);
    if ("close" in ds) closeSheets();
    else if (ds.retake) startRetake(...pos(ds.retake));
    else if (ds.take) takeNow(...pos(ds.take));
    else if (ds.skip) skipShot(...pos(ds.skip));
    else if (ds.skipscene) skipScene(Number(ds.skipscene));
    else if ("own" in ds) addOwnPair();
    else if ("finish" in ds) openEnd();
    else if (ds.places) {
      setupPlaces = Number(ds.places);
      renderSetup();
    } else if ("ownsw" in ds) {
      setupOwn = !setupOwn;
      renderSetup();
    } else if ("start" in ds) {
      S = newState(setupPlaces, setupOwn);
      log("start, light at " + setupPlaces + " place(s)");
      save();
      closeSheets();
      render();
    } else if ("makezip" in ds) makeZip();
    else if ("wait" in ds) {
      waitChosen = true;
      renderEndLive(true);
    } else if ("download" in ds) download();
  });

  // ---------------------------------------------------------------- boot
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
  startCamera();
  setInterval(procTick, 200);

  if (!S) openSetup();
  else {
    if (S.zip && S.zip.status === "packing") S.zip = null;
    render();
    const resumed = sessionStorage.getItem(KEY + "-resumed");
    sessionStorage.removeItem(KEY + "-resumed");
    const photos = takenShots();
    if (photos || resumed) {
      log("resumed after reload");
      const p = $("resumePill");
      p.innerHTML = `${ICON.check}Picked up where you were · ${photos} photos safe on this phone`;
      p.hidden = false;
      setTimeout(() => (p.style.opacity = "0"), 3200);
      setTimeout(() => {
        p.hidden = true;
        p.style.opacity = "";
      }, 3800);
    }
    if (S.endOpen) openEnd();
  }

  // hooks for the screenshot script only
  window.__proto = {
    async fastForward(n) {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let i = 0; i < n; i++) {
        const t = nextTodo();
        if (!t) break;
        S.cur = t;
        render();
        await frame();
        capture();
        await frame();
      }
    },
    openSheet,
    openEnd,
  };
})();
