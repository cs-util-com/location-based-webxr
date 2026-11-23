"use strict";
/* Throwaway prototype: the feature-match photo test as ONE growing session
   timeline. Scenes are timeline nodes: the current one is expanded with the
   camera, finished ones collapse into a row of thumbnails plus a live
   processing bar, and the timeline ends in the Processing section.
   Measuring is faked with timers; the state (thumbnails included) is kept in
   localStorage so a reload resumes. Not wired to the app. */
(() => {
  const KEY = "fm-scenes-timeline-v1";
  const RESUME_FLAG = "fm-scenes-timeline-resumed";
  const params = new URLSearchParams(location.search);
  const FREEZE = params.has("freeze");
  const NOCAM = params.has("nocam");

  const METHODS = [
    { id: "orb", name: "ORB", sec: 1.3 },
    { id: "akaze", name: "AKAZE", sec: 2.1 },
    { id: "brisk", name: "BRISK", sec: 1.6 },
    { id: "learned", name: "Learned", sec: 3.4 },
  ];
  const STILL_MOVE = "Do not touch the phone. The shot fires 2 s after your tap.";
  const KINDS = {
    light: {
      title: "Light",
      prefix: "L",
      rule: "still",
      where: "Phone stands still on a table, aimed at a detailed part of the room.",
      shots: [
        {
          name: "Normal light",
          how: "Put the phone down on the table, aimed at something detailed: a shelf, a plant, a picture. Lights as they are now.",
          move: "Place the phone now. From this shot on it must stay exactly where it is.",
        },
        { name: "Again, unchanged", how: "Change nothing. This is the control shot.", move: STILL_MOVE },
        {
          name: "Dimmed",
          how: "Go and turn the main light off, leave one small lamp on. Come back and tap.",
          move: STILL_MOVE,
        },
        {
          name: "As dark as possible",
          how: "Turn off everything you can while shapes still show. Come back and tap.",
          move: STILL_MOVE,
        },
      ],
      pairs: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    },
    flat: {
      title: "Flat surface",
      prefix: "F",
      rule: "hand",
      where: "Hand-held, at a poster or a patterned door.",
      shots: [
        {
          name: "Upright at 1.5 m",
          how: "Stand about 1.5 m in front of the poster. Hold the phone upright and square to it.",
          move: "Hand-held. Remember this spot: you come back to it for F6.",
        },
        { name: "Again (control)", how: "Stay where you are and take the same shot again.", move: "Hand-held. Do not change your spot." },
        {
          name: "Tilted 30-45 deg",
          how: "Same spot. Tilt the phone 30-45 deg so you look at the poster at an angle.",
          move: "Tilt only, do not step.",
        },
        { name: "From 3 m", how: "Step back to about 3 m. Phone upright again.", move: "Walk back, then hold still for the shot." },
        { name: "From 1 m", how: "Step in to about 1 m from the poster.", move: "Walk in, then hold still for the shot." },
        {
          name: "Side step",
          how: "Back to the 1.5 m spot, then 1 m to the side. Aim at the poster.",
          move: "Step sideways, aim back at the poster.",
        },
      ],
      pairs: [
        [0, 1],
        [0, 2],
        [0, 3],
        [4, 3],
        [0, 5],
      ],
      synth: ["quarter turn", "half turn"],
      computed: "The quarter and half turn are computed from F2, so you do not photograph them.",
    },
    deep: {
      title: "Deep",
      prefix: "D",
      rule: "hand",
      where: "Hand-held, aimed down a hallway.",
      shots: [
        { name: "Down the hallway", how: "Stand at the start of a hallway and aim down its length.", move: "Hand-held. Remember this spot." },
        { name: "Again (control)", how: "Stay where you are and take the same shot again.", move: "Hand-held. Do not change your spot." },
        { name: "1 m to the side", how: "Step 1 m sideways and aim down the hallway again.", move: "Step sideways, then hold still for the shot." },
      ],
      pairs: [
        [0, 1],
        [0, 2],
      ],
    },
    extra: {
      title: "Your own pair",
      prefix: "X",
      rule: "hand",
      optional: true,
      where: "Two photos of anything you want compared.",
      shots: [
        { name: "First photo", how: "Any scene you are curious about.", move: "Hand-held." },
        { name: "Second photo", how: "Change one thing: the light, your spot or the angle.", move: "Hand-held." },
      ],
      pairs: [[0, 1]],
    },
  };

  const I = {
    check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    still: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="15" rx="2"/><path d="M4 21h16M12 17.5V21"/></svg>',
    hand: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="9" height="15" rx="2"/><path d="M9 11.5c-2.2 0-3.5 1.3-3.5 3.3v.9c0 2.7 2.2 4.8 5 4.8h3"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    info: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    dl: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    flag: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>',
    turn: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/></svg>',
    plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
  };

  // ---------------- state ----------------
  function freshState() {
    return {
      v: 1,
      started: false,
      places: 1,
      startedAt: null,
      scenes: [],
      pairs: [],
      retake: null,
      finished: false,
      endShown: false,
      wait: false,
      zip: null,
      zipAt: null,
      zipResults: 0,
      lastCheck: null,
      log: [],
    };
  }
  function mkScene(kind, place) {
    const d = KINDS[kind];
    return {
      id: kind + (place ? "-" + place : ""),
      kind,
      place: place || 0,
      on: !d.optional,
      skipped: false,
      built: false,
      shots: d.shots.map(() => ({ status: "todo", thumb: null, lum: null, check: null })),
    };
  }
  function buildScenes(places) {
    const out = [];
    for (let p = 1; p <= places; p++) out.push(mkScene("light", places > 1 ? p : 0));
    out.push(mkScene("flat"), mkScene("deep"), mkScene("extra"));
    return out;
  }

  let state = freshState();
  let saveOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.v === 1 && Array.isArray(s.scenes) ? s : null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveOk = true;
    } catch {
      saveOk = false;
    }
  }
  function log(m) {
    state.log.push({ t: Date.now(), m });
    if (state.log.length > 400) state.log.shift();
  }

  // ---------------- derived ----------------
  const def = (s) => KINDS[s.kind];
  const key = (s, i) => def(s).prefix + (i + 1);
  const title = (s) => def(s).title + (s.place ? " · place " + s.place : "");
  const inFlow = (s) => s.on && !s.skipped;
  const complete = (s) => s.skipped || s.shots.every((x) => x.status !== "todo");
  const photos = () => state.scenes.reduce((n, s) => n + s.shots.filter((x) => x.status === "done").length, 0);

  function cursor() {
    if (!state.started || state.finished) return null;
    for (let si = 0; si < state.scenes.length; si++) {
      const s = state.scenes[si];
      if (!inFlow(s)) continue;
      const i = s.shots.findIndex((x) => x.status === "todo");
      if (i >= 0) return { si, i };
    }
    return null;
  }
  function target() {
    if (state.retake) return { ...state.retake, retake: true };
    return cursor();
  }
  function sceneNumber(si) {
    const req = state.scenes.filter((s) => s.kind !== "extra");
    return { n: req.indexOf(state.scenes[si]) + 1, total: req.length };
  }

  // ---------------- pairs + fake processing ----------------
  function pairLabel(p) {
    const s = state.scenes[p.si];
    if (p.synth) return key(s, 0) + "-" + key(s, 1) + " " + p.synth + " (computed)";
    return key(s, p.a) + "-" + key(s, p.b);
  }
  function pairReady(s, a, b) {
    return s.shots[a].status === "done" && s.shots[b].status === "done";
  }
  function newProg() {
    return Object.fromEntries(METHODS.map((m) => [m.id, 0]));
  }
  function buildPairs(si) {
    const s = state.scenes[si];
    if (s.built || s.skipped) return;
    s.built = true;
    const d = def(s);
    const add = (a, b, synth) =>
      state.pairs.push({ si, a, b, synth: synth || null, prog: newProg(), status: pairReady(s, a, b) ? "queued" : "skipped" });
    d.pairs.forEach(([a, b]) => add(a, b));
    (d.synth || []).forEach((label) => add(0, 1, label));
  }
  function pairsOf(si) {
    return state.pairs.filter((p) => p.si === si);
  }
  function affected(si, i) {
    const s = state.scenes[si];
    const d = def(s);
    const list = d.pairs.filter(([a, b]) => a === i || b === i).map(([a, b]) => key(s, a) + "-" + key(s, b));
    const synth = d.synth && (i === 0 || i === 1) ? d.synth.length : 0;
    return { list, synth };
  }
  function requeue(si, i) {
    const s = state.scenes[si];
    pairsOf(si).forEach((p) => {
      if (p.a === i || p.b === i) {
        p.prog = newProg();
        p.status = pairReady(s, p.a, p.b) ? "queued" : "skipped";
      }
    });
  }
  const pairRemain = (p) => METHODS.reduce((t, m) => t + (1 - p.prog[m.id]) * m.sec, 0);
  const pairFrac = (p) => {
    const tot = METHODS.reduce((t, m) => t + m.sec, 0);
    return METHODS.reduce((t, m) => t + p.prog[m.id] * m.sec, 0) / tot;
  };
  const live = (p) => p.status === "queued" || p.status === "running";

  function sceneProc(si) {
    const s = state.scenes[si];
    if (s.skipped) return { st: "skipped" };
    if (!s.built) return { st: "capturing" };
    const ps = pairsOf(si).filter((p) => p.status !== "skipped");
    const done = ps.filter((p) => p.status === "done").length;
    const frac = ps.length ? ps.reduce((t, p) => t + pairFrac(p), 0) / ps.length : 1;
    // ETA: everything queued before this scene's last open pair, plus its own.
    let eta = 0;
    let lastIdx = -1;
    state.pairs.forEach((p, idx) => {
      if (p.si === si && live(p)) lastIdx = idx;
    });
    for (let k = 0; k <= lastIdx; k++) if (live(state.pairs[k])) eta += pairRemain(state.pairs[k]);
    const running = ps.some((p) => p.status === "running");
    const st = done === ps.length ? "done" : running ? "measuring" : "waiting";
    return { st, done, total: ps.length, frac, eta, skippedPairs: pairsOf(si).length - ps.length };
  }
  function totals() {
    const ps = state.pairs.filter((p) => p.status !== "skipped");
    const done = ps.filter((p) => p.status === "done").length;
    const eta = ps.filter(live).reduce((t, p) => t + pairRemain(p), 0);
    return { done, total: ps.length, eta, open: ps.length - done };
  }
  function fmtEta(sec) {
    if (sec < 8) return "a few seconds";
    if (sec < 50) return "about " + Math.ceil(sec / 10) * 10 + " s";
    const m = Math.round(sec / 60);
    return "about " + Math.max(1, m) + " min";
  }

  let lastTick = performance.now();
  let lastSave = 0;
  function tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - lastTick) / 1000);
    lastTick = now;
    if (FREEZE) return;
    const p = state.pairs.find(live);
    if (p) {
      p.status = "running";
      const m = METHODS.find((mm) => p.prog[mm.id] < 1);
      if (m) p.prog[m.id] = Math.min(1, p.prog[m.id] + dt / m.sec);
      if (METHODS.every((mm) => p.prog[mm.id] >= 1)) {
        p.status = "done";
        log("Measured " + pairLabel(p));
        const si = p.si;
        if (sceneProc(si).st === "done") log(title(state.scenes[si]) + ": all pairs measured");
      }
      if (now - lastSave > 1000) {
        save();
        lastSave = now;
      }
    } else if (state.wait && state.zip === null && totals().total > 0) {
      makeZip();
    }
    updateLive();
  }

  // ---------------- camera ----------------
  const vf = (() => {
    const el = document.createElement("div");
    el.className = "vf";
    el.innerHTML =
      '<video playsinline muted autoplay></video><canvas></canvas><img class="vf-ghost" alt="" hidden>' +
      '<div class="vf-tag"></div><div class="vf-src" hidden>Simulated camera</div>' +
      '<div class="vf-check" hidden></div><div class="vf-count" hidden></div><div class="vf-flash"></div>';
    const video = el.querySelector("video");
    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const ghost = el.querySelector(".vf-ghost");
    const tag = el.querySelector(".vf-tag");
    const chk = el.querySelector(".vf-check");
    const cnt = el.querySelector(".vf-count");
    const flashEl = el.querySelector(".vf-flash");
    let mode = "none";
    let starting = null;
    let sc = { kind: "light", i: 0 };
    video.hidden = true;

    function start() {
      if (starting) return starting;
      starting = (async () => {
        try {
          if (NOCAM || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera api");
          const req = navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false,
          });
          const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("camera timeout")), 4000));
          req.then(
            (s) => {
              if (mode === "fake") s.getTracks().forEach((t) => t.stop());
            },
            () => {}
          );
          const stream = await Promise.race([req, timeout]);
          video.srcObject = stream;
          video.hidden = false;
          canvas.hidden = true;
          await video.play().catch(() => {});
          mode = "real";
          log("Camera on");
        } catch (e) {
          mode = "fake";
          video.hidden = true;
          canvas.hidden = false;
          el.querySelector(".vf-src").hidden = false;
          log("No camera (" + (e && e.message ? e.message : "error") + "), using the drawn camera");
        }
        requestAnimationFrame(loop);
      })();
      return starting;
    }
    function loop(t) {
      if (mode === "fake" && el.isConnected) {
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(el.clientWidth * dpr));
        const h = Math.max(1, Math.round(el.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        drawScene(ctx, w, h, sc, t / 1000);
      }
      requestAnimationFrame(loop);
    }
    function attach(slot, ctxScene, tagText, ghostSrc) {
      sc = ctxScene;
      tag.textContent = tagText;
      ghost.hidden = !ghostSrc;
      if (ghostSrc) ghost.src = ghostSrc;
      if (el.parentNode !== slot) slot.appendChild(el);
      if (mode === "real") video.play().catch(() => {});
      start();
    }
    function setCheck(c) {
      chk.hidden = !c;
      if (!c) return;
      chk.className = "vf-check " + (c.ok ? "ok" : "warn");
      chk.innerHTML = (c.ok ? I.check : I.warn) + "<span>" + c.text + "</span>";
    }
    function countdown(sec) {
      return new Promise((resolve) => {
        if (!sec) return resolve();
        let n = sec;
        cnt.hidden = false;
        const show = () => (cnt.innerHTML = "<div>" + n + "<small>Hands off</small></div>");
        show();
        const id = setInterval(() => {
          n -= 1;
          if (n <= 0) {
            clearInterval(id);
            cnt.hidden = true;
            resolve();
          } else show();
        }, 1000);
      });
    }
    function grab() {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 128;
      const x = c.getContext("2d");
      if (mode === "real" && video.videoWidth) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const r = Math.max(96 / vw, 128 / vh);
        const dw = vw * r;
        const dh = vh * r;
        x.drawImage(video, (96 - dw) / 2, (128 - dh) / 2, dw, dh);
      } else {
        drawScene(x, 96, 128, sc, performance.now() / 1000);
      }
      return { thumb: c.toDataURL("image/jpeg", 0.62), lum: luminance(x, 96, 128) };
    }
    function flash() {
      flashEl.classList.remove("go");
      void flashEl.offsetWidth;
      flashEl.classList.add("go");
    }
    return { el, start, attach, setCheck, countdown, grab, flash, mode: () => mode };
  })();

  function luminance(x, w, h) {
    const d = x.getImageData(0, 0, w, h).data;
    let t = 0;
    for (let k = 0; k < d.length; k += 16) t += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
    return t / (d.length / 16);
  }

  // ---------- drawn camera (headless, desktop) ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function drawScene(c, w, h, sc, t) {
    c.save();
    const shake = sc.kind === "light" ? 0 : 1;
    c.translate(shake * Math.sin(t * 1.3) * w * 0.005, shake * Math.cos(t * 1.7) * h * 0.004);
    if (sc.kind === "flat") drawPoster(c, w, h, sc.i);
    else if (sc.kind === "deep") drawHall(c, w, h, sc.i);
    else drawRoom(c, w, h, sc.kind === "extra" && sc.i === 1 ? 0.12 : 0);
    c.restore();
    const level = sc.kind === "light" ? [1, 1, 0.4, 0.13][sc.i] : 1;
    if (level < 1) {
      c.fillStyle = "rgba(0,0,0," + (1 - level) + ")";
      c.fillRect(0, 0, w, h);
      const g = c.createRadialGradient(w * 0.86, h * 0.3, 0, w * 0.86, h * 0.3, w * 0.7);
      g.addColorStop(0, "rgba(255,180,100," + 0.22 * level + ")");
      g.addColorStop(1, "rgba(255,180,100,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      const r = rng(Math.floor(t * 12));
      c.fillStyle = "rgba(255,255,255,0.05)";
      for (let k = 0; k < 220; k++) c.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
  }
  function drawRoom(c, w, h, shift) {
    c.save();
    c.translate(-shift * w, 0);
    const wall = c.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, "#bba78f");
    wall.addColorStop(1, "#8c7963");
    c.fillStyle = wall;
    c.fillRect(-w, 0, w * 3, h);
    // picture frame
    c.fillStyle = "#3b2f24";
    c.fillRect(w * 0.58, h * 0.06, w * 0.34, h * 0.15);
    c.fillStyle = "#9cc3d6";
    c.fillRect(w * 0.6, h * 0.075, w * 0.3, h * 0.12);
    c.fillStyle = "#4f7a52";
    c.beginPath();
    c.moveTo(w * 0.6, h * 0.195);
    c.lineTo(w * 0.7, h * 0.11);
    c.lineTo(w * 0.78, h * 0.16);
    c.lineTo(w * 0.84, h * 0.12);
    c.lineTo(w * 0.9, h * 0.195);
    c.fill();
    // shelf
    const r = rng(7);
    const left = w * 0.08;
    const right = w * 0.92;
    [0.36, 0.56, 0.76].forEach((y, row) => {
      let x = left + 4;
      while (x < right - 12) {
        const bw = w * (0.03 + r() * 0.05);
        const bh = h * (0.11 + r() * 0.07);
        const hue = Math.floor(r() * 360);
        c.fillStyle = "hsl(" + hue + ", " + (30 + r() * 40) + "%, " + (30 + r() * 30) + "%)";
        if (r() < 0.12 && row !== 1) {
          c.save();
          c.translate(x, h * y);
          c.rotate(-0.22);
          c.fillRect(0, -bh, bw, bh);
          c.restore();
          x += bw * 2;
        } else {
          c.fillRect(x, h * y - bh, bw, bh);
          c.fillStyle = "rgba(255,255,255,0.35)";
          c.fillRect(x + bw * 0.2, h * y - bh * 0.7, bw * 0.6, 2);
          x += bw + 2;
        }
      }
      c.fillStyle = "#5a4330";
      c.fillRect(left - 6, h * y, right - left + 12, h * 0.02);
    });
    // plant
    c.fillStyle = "#7d5136";
    c.fillRect(w * 0.12, h * 0.8, w * 0.12, h * 0.08);
    c.fillStyle = "#3e7a45";
    for (let k = 0; k < 9; k++) {
      c.beginPath();
      c.ellipse(w * (0.12 + r() * 0.12), h * (0.78 - r() * 0.07), w * 0.04, h * 0.018, r() * 3, 0, 7);
      c.fill();
    }
    // table
    c.fillStyle = "#4a3426";
    c.fillRect(-w, h * 0.88, w * 3, h * 0.12);
    c.restore();
  }
  function drawPoster(c, w, h, i) {
    const wall = c.createLinearGradient(0, 0, w, h);
    wall.addColorStop(0, "#8e959c");
    wall.addColorStop(1, "#6c737a");
    c.fillStyle = wall;
    c.fillRect(-w, -h, w * 3, h * 3);
    c.save();
    c.translate(w / 2, h / 2);
    const s = [1, 1, 1, 0.5, 1.45, 1][i] || 1;
    if (i === 2) c.transform(0.72, 0.16, 0, 1, 0, 0);
    if (i === 5) {
      c.translate(-w * 0.16, 0);
      c.transform(0.86, -0.07, 0, 1, 0, 0);
    }
    c.scale(s, s);
    const pw = Math.min(w * 0.66, h * 0.5);
    const ph = pw * 1.38;
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.fillRect(-pw / 2 + 6, -ph / 2 + 8, pw, ph);
    c.fillStyle = "#f1ece2";
    c.fillRect(-pw / 2, -ph / 2, pw, ph);
    const r = rng(11);
    const cols = ["#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c", "#2b3e50", "#9b59b6"];
    c.fillStyle = "#2b3e50";
    c.fillRect(-pw * 0.4, -ph * 0.44, pw * 0.8, ph * 0.07);
    c.fillStyle = "#7a7a7a";
    c.fillRect(-pw * 0.4, -ph * 0.34, pw * 0.5, ph * 0.025);
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const cx = -pw * 0.3 + gx * pw * 0.2;
        const cy = -ph * 0.2 + gy * ph * 0.11;
        c.fillStyle = cols[Math.floor(r() * cols.length)];
        if (r() < 0.5) {
          c.beginPath();
          c.arc(cx, cy, pw * 0.07, 0, 7);
          c.fill();
        } else {
          c.save();
          c.translate(cx, cy);
          c.rotate(r() * 3);
          c.fillRect(-pw * 0.06, -pw * 0.06, pw * 0.12, pw * 0.12);
          c.restore();
        }
      }
    }
    c.fillStyle = "#2b3e50";
    for (let k = 0; k < 5; k++) c.fillRect(-pw * 0.4, ph * 0.34 + k * ph * 0.025, pw * (0.25 + r() * 0.5), Math.max(1, ph * 0.01));
    c.restore();
  }
  function drawHall(c, w, h, i) {
    const vx = w * (i === 2 ? 0.36 : 0.5);
    const vy = h * 0.46;
    const bw = w * 0.16;
    const bh = h * 0.2;
    const bx0 = vx - bw / 2;
    const by0 = vy - bh / 2;
    const poly = (pts, fill) => {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
      c.closePath();
      c.fill();
    };
    poly([0, 0, w, 0, bx0 + bw, by0, bx0, by0], "#d8d2c6");
    poly([0, h, w, h, bx0 + bw, by0 + bh, bx0, by0 + bh], "#8a6446");
    poly([0, 0, bx0, by0, bx0, by0 + bh, 0, h], "#bdb4a5");
    poly([w, 0, bx0 + bw, by0, bx0 + bw, by0 + bh, w, h], "#aaa192");
    c.fillStyle = "#f4ead0";
    c.fillRect(bx0, by0, bw, bh);
    c.fillStyle = "#9fc5dd";
    c.fillRect(bx0 + bw * 0.3, by0 + bh * 0.15, bw * 0.4, bh * 0.45);
    // doors along the walls
    // doors on the left wall: top edge y = by0*x/bx0, bottom edge falls from h to by0+bh
    const wallTop = (x) => (by0 * x) / bx0;
    const wallBot = (x) => h - ((h - (by0 + bh)) * x) / bx0;
    [0.15, 0.55].forEach((f, k) => {
      const x1 = bx0 * f;
      const x2 = x1 + bx0 * 0.2 * (1 - f * 0.6);
      const doorTop = (x) => wallTop(x) + (wallBot(x) - wallTop(x)) * 0.25;
      c.fillStyle = k ? "#6b4b33" : "#7b5a40";
      c.beginPath();
      c.moveTo(x1, wallBot(x1));
      c.lineTo(x1, doorTop(x1));
      c.lineTo(x2, doorTop(x2));
      c.lineTo(x2, wallBot(x2));
      c.fill();
    });
    c.fillStyle = "#3c5a7a";
    const rx = bx0 + bw + (w - bx0 - bw) * 0.35;
    c.fillRect(rx, h * 0.3, (w - bx0 - bw) * 0.25, h * 0.12);
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.lineWidth = 1;
    for (let k = 1; k < 7; k++) {
      c.beginPath();
      c.moveTo((w * k) / 7, h);
      c.lineTo(bx0 + (bw * k) / 7, by0 + bh);
      c.stroke();
    }
  }

  // ---------------- capture ----------------
  let busy = false;
  async function shoot() {
    const t = target();
    if (!t || busy) return;
    busy = true;
    resumedInfo = null;
    const btn = document.querySelector(".shutter");
    if (btn) btn.disabled = true;
    const s = state.scenes[t.si];
    if (def(s).rule === "still") await vf.countdown(2);
    const g = vf.grab();
    vf.flash();
    const sh = s.shots[t.i];
    const k = key(s, t.i);
    sh.status = "done";
    sh.thumb = g.thumb;
    sh.lum = g.lum;
    sh.check = null;
    state.zip = null;
    log((t.retake ? "Retook " : "Took ") + title(s) + " " + k);
    state.lastCheck = lightCheck(t.si, t.i);
    if (t.retake) {
      if (s.built) requeue(t.si, t.i);
      state.retake = null;
    }
    let msg = null;
    if (complete(s) && !s.built) {
      buildPairs(t.si);
      log(title(s) + " complete, measuring queued");
      msg = title(s) + " is complete. Measuring runs in the background.";
      if (state.lastCheck && state.lastCheck.si === t.si) msg = state.lastCheck.text + " " + msg;
    } else if (t.retake && s.built) {
      msg = k + " replaced. Its pairs are measured again.";
    }
    const ended = !cursor() && !state.retake;
    if (ended) state.endShown = true;
    save();
    busy = false;
    render();
    if (msg && !ended) toast(msg);
  }
  function lightCheck(si, i) {
    const s = state.scenes[si];
    if (s.kind !== "light" || i === 0) return null;
    const ref = s.shots[0].lum;
    const lum = s.shots[i].lum;
    if (ref == null || lum == null) return null;
    const ratio = lum / Math.max(1, ref);
    const darker = Math.round((1 - ratio) * 100);
    let c;
    if (i === 1) {
      c = Math.abs(1 - ratio) < 0.12 ? { ok: true, text: "Same light as L1. Good." } : { ok: false, text: "Brightness changed by " + Math.abs(darker) + " % against L1. Did a light change?" };
    } else if (i === 2) {
      c = ratio < 0.8 ? { ok: true, text: "L3 is " + darker + " % darker than L1. Good." } : { ok: false, text: "L3 is only " + Math.max(0, darker) + " % darker than L1. Is the main light off? Retake L3 when it is." };
    } else {
      const l3 = s.shots[2].status === "done" ? s.shots[2].lum : null;
      if (lum < 4) c = { ok: false, text: "L4 is nearly black. If no shapes show, retake it with a little more light." };
      else if (l3 != null && lum > l3 * 0.85) c = { ok: false, text: "L4 is not darker than L3. Turn off one more light and retake L4." };
      else c = { ok: true, text: "L4 is " + darker + " % darker than L1. Good." };
    }
    s.shots[i].check = { ok: c.ok, short: i === 1 ? (c.ok ? "same" : "changed") : "-" + Math.max(0, darker) + " %" };
    return { si, i, ...c };
  }

  // ---------------- zip (faked) ----------------
  function makeZip() {
    if (state.zip === "making") return;
    state.zip = "making";
    log("Making zip");
    renderEndActions();
    setTimeout(() => {
      state.zip = "ready";
      state.zipAt = Date.now();
      state.zipResults = totals().done;
      log("Zip ready with " + state.zipResults + " results");
      save();
      renderEndActions();
      updateLive();
    }, 1500);
  }
  const zipSize = () => (photos() * 0.9 + 0.05).toFixed(1) + " MB";

  // ---------------- rendering ----------------
  const tl = document.getElementById("timeline");
  const openPairs = new Set();
  let lastFocus = null;
  let resumedInfo = null;

  function nodeWrap(cls, id, dot, inner) {
    return '<section class="node ' + cls + '" id="' + id + '"><div class="rail"><span class="dot">' + dot + '</span></div><div class="card">' + inner + "</div></section>";
  }
  function ruleBadge(s) {
    return def(s).rule === "still"
      ? '<span class="rule rule--still">' + I.still + "Phone stays still</span>"
      : '<span class="rule rule--hand">' + I.hand + "Hand-held</span>";
  }

  function setupNode() {
    if (state.started) {
      const at = new Date(state.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const inner =
        '<div class="row-head"><div class="row-title">Session started <small>' + at + "</small></div></div>" +
        '<p class="row-meta">Light scene at ' + state.places + (state.places > 1 ? " places" : " place") + ". Photos are saved on this phone as you take them.</p>";
      return nodeWrap("node--done", "node-setup", I.check, inner);
    }
    const seg = [1, 2, 3].map((n) => '<button data-act="places" data-n="' + n + '" aria-pressed="' + (state.places === n) + '">' + n + "</button>").join("");
    const n = state.places;
    const shots = n * 4 + 6 + 3;
    const inner =
      '<div class="eyebrow">Before you start</div><h2 style="margin:2px 0 0;font-size:20px">Three scenes, ' + shots + " shots</h2>" +
      '<ul class="setup-list">' +
      "<li>" + I.still + "<span><b>Light</b> - phone on a table, 4 shots. You only stand up twice, to dim the light.</span></li>" +
      "<li>" + I.hand + "<span><b>Flat surface</b> - a poster or a patterned door, 6 shots, hand-held.</span></li>" +
      "<li>" + I.hand + "<span><b>Deep</b> - down a hallway, 3 shots, hand-held.</span></li>" +
      "</ul>" +
      '<div class="setup-q">At how many places do you want the light scene?</div>' +
      '<div class="seg" role="group" aria-label="Places for the light scene">' + seg + "</div>" +
      '<p class="quiet-note">More places give more variety. Each extra place is 4 more shots.</p>' +
      '<div style="height:12px"></div><button class="primary setup-start" data-act="start">Start - open the camera</button>' +
      '<p class="quiet-note">Each scene is measured on this phone as soon as it is complete, while you go on. Every photo is saved here immediately; nothing is uploaded.</p>';
    return nodeWrap("node--active", "node-setup", I.gear, inner);
  }

  function thumbsHtml(s, si) {
    return s.shots
      .map((x, i) => {
        if (x.status === "todo") return "";
        const k = key(s, i);
        const lbl = '<span class="thumb-label">' + k + "</span>";
        if (x.status === "done")
          return '<button class="thumb" data-act="retake" data-si="' + si + '" data-i="' + i + '" aria-label="Retake ' + k + '"><img alt="" src="' + x.thumb + '">' + lbl + '<span class="thumb-saved">' + I.check + "</span></button>";
        return '<button class="thumb is-skipped" data-act="retake" data-si="' + si + '" data-i="' + i + '" aria-label="Take ' + k + ' now"><span class="thumb-empty">skipped</span>' + lbl + "</button>";
      })
      .join("");
  }
  function procInner(si) {
    const s = state.scenes[si];
    const p = sceneProc(si);
    let chip;
    let text;
    if (p.st === "capturing") {
      return '<div class="proc-line"><span class="chip chip--capturing">Not yet</span><span class="grow">Measured as soon as the scene is complete</span></div>';
    }
    if (p.st === "done") {
      chip = '<span class="chip chip--done">Done</span>';
      text = p.total ? "All " + p.total + " pairs measured" : "No pairs to measure";
    } else if (p.st === "measuring") {
      chip = '<span class="chip chip--measuring">Measuring</span>';
      text = p.done + " of " + p.total + " pairs · " + fmtEta(p.eta) + " left";
    } else {
      chip = '<span class="chip chip--waiting">Waiting</span>';
      text = "Queued · done in " + fmtEta(p.eta);
    }
    if (p.skippedPairs) text += " · " + p.skippedPairs + " skipped";
    let html =
      '<div class="proc-line">' + chip + '<span class="grow">' + text + "</span></div>" +
      '<div class="bar' + (p.st === "done" ? " is-done" : "") + '"><span style="width:' + Math.round(p.frac * 100) + '%"></span></div>';
    if (openPairs.has(s.id)) {
      html +=
        '<ul class="pairs">' +
        pairsOf(si)
          .map((q) => {
            const st = q.status === "done" ? "measured" : q.status === "running" ? "measuring " + Math.round(pairFrac(q) * 100) + " %" : q.status === "skipped" ? "skipped" : "waiting";
            return "<li><span><b>" + pairLabel(q) + '</b></span><span class="st st--' + q.status + '">' + st + "</span></li>";
          })
          .join("") +
        "</ul>";
    }
    return html;
  }
  function lightChecksLine(s) {
    if (s.kind !== "light") return "";
    const parts = s.shots.map((x, i) => (x.check ? key(s, i) + " " + x.check.short : null)).filter(Boolean);
    const bad = s.shots.some((x) => x.check && !x.check.ok);
    return parts.length ? "<span" + (bad ? ' style="color:var(--warn)"' : "") + ">Light check: " + parts.join(", ") + "</span>" : "";
  }
  function doneRow(s, si) {
    const n = s.shots.filter((x) => x.status === "done").length;
    const inner =
      '<div class="row-head"><div class="row-title">' + title(s) + " <small>" + n + " photo" + (n === 1 ? "" : "s") + " saved</small></div></div>" +
      '<div class="thumbs">' + thumbsHtml(s, si) + "</div>" +
      '<div class="proc" id="proc-' + s.id + '">' + procInner(si) + "</div>" +
      '<div class="row-foot"><span>Tap a photo to retake it</span>' + lightChecksLine(s) +
      '<button class="textbtn" data-act="pairs" data-id="' + s.id + '">' + (openPairs.has(s.id) ? "Hide pairs" : "Show pairs") + "</button></div>";
    return nodeWrap("node--done", "node-" + s.id, I.check, inner);
  }
  function upcomingRow(s, si, firstOpen) {
    const d = def(s);
    const taken = s.shots.filter((x) => x.status !== "todo").length;
    const num = s.kind === "extra" ? "+" : String(sceneNumber(si).n);
    let foot;
    if (state.finished) foot = firstOpen ? '<button class="textbtn" data-act="continue">Continue capturing here</button>' : "";
    else if (s.kind === "extra") foot = taken ? "" : '<button class="textbtn muted" data-act="extra-off" data-si="' + si + '">Remove the extra pair</button>';
    else foot = '<button class="textbtn muted" data-act="skipscene" data-si="' + si + '">Skip this scene</button>';
    const meta = taken ? taken + " of " + s.shots.length + " shots taken. " + d.where : d.where;
    const inner =
      '<div class="row-head"><div class="row-title">' + title(s) + " <small>" + s.shots.length + " shots" + (state.finished ? " · not taken" : "") + "</small></div>" + ruleBadge(s) + "</div>" +
      '<p class="row-meta">' + meta + "</p>" + (taken ? '<div class="thumbs">' + thumbsHtml(s, si) + "</div>" : "") + foot;
    return nodeWrap("node--upcoming", "node-" + s.id, num, inner);
  }
  function skippedRow(s, si) {
    const inner =
      '<div class="row-head"><div class="row-title">' + title(s) + " <small>skipped</small></div></div>" +
      '<button class="textbtn" data-act="unskip" data-si="' + si + '">Take it after all</button>';
    return nodeWrap("node--skipped", "node-" + s.id, s.kind === "extra" ? "+" : String(sceneNumber(si).n), inner);
  }
  function extraOffRow(si) {
    const inner =
      '<div class="row-head"><div class="row-title">Extra: your own pair <small>optional</small></div></div>' +
      '<p class="row-meta">Two photos of anything you want compared.</p>' +
      '<button class="textbtn" data-act="extra-on" data-si="' + si + '">Add your own pair</button>';
    return nodeWrap("node--upcoming", "node-extra", "+", inner);
  }

  function activeCard(s, si, t) {
    const d = def(s);
    const i = t.i;
    const sh = d.shots[i];
    const k = key(s, i);
    const num = sceneNumber(si);
    const eyebrow = t.retake ? "Retake" : s.kind === "extra" ? "Extra" : "Scene " + num.n + " of " + num.total;
    const strip = s.shots
      .map((x, j) => {
        const kk = key(s, j);
        let cls = "pill is-" + x.status;
        if (j === i) cls += t.retake ? " is-retake" : " is-current";
        const act = j !== i && x.status !== "todo" ? ' data-act="retake" data-si="' + si + '" data-i="' + j + '" aria-label="Retake ' + kk + '"' : " disabled";
        const img = x.status === "done" && j !== i ? '<img alt="" src="' + x.thumb + '">' : "";
        const ico = x.status === "done" && j !== i ? I.check : "";
        return '<li><button class="' + cls + '"' + act + ">" + img + "<span>" + kk + "</span>" + ico + "</button></li>";
      })
      .join("");
    let notes = "";
    let retakeNote = "";
    if (t.retake) {
      const a = affected(si, i);
      const n = a.list.length + a.synth;
      const listTxt = a.list.join(", ") + (a.synth ? (a.list.length ? " and " : "") + "the " + a.synth + " computed turns" : "");
      const pl = n + " pair" + (n === 1 ? "" : "s");
      const uses = s.built ? "Retaking it redoes " + pl + ": " + listTxt + "." : pl + " will use it: " + listTxt + ".";
      if (i === 0) {
        retakeNote =
          '<div class="notice warn"><b>' + k + " is the shared first shot.</b> " + uses +
          (d.rule === "still" ? " Only retake it if the phone has not moved since; otherwise redo the whole scene." : " Stand where you stood for it.") +
          "</div>";
      } else if (n) {
        retakeNote = '<div class="notice">' + (s.built ? "Retaking " + k + " redoes " + pl + ": " + listTxt + "." : pl + " will use " + k + ": " + listTxt + ".") + "</div>";
      }
    } else if (d.computed && i <= 1) {
      notes += '<p class="note-computed">' + I.turn + "<span>" + d.computed + "</span></p>";
    }
    const isStill = d.rule === "still";
    const moveTxt = t.retake && isStill ? STILL_MOVE : sh.move;
    const minor = t.retake
      ? '<button class="textbtn" data-act="cancel-retake">Cancel retake</button>' +
        (s.built || s.shots.some((x) => x.status === "done") ? '<button class="textbtn muted" data-act="redo-scene" data-si="' + si + '" data-armed="0">Redo the whole scene</button>' : "")
      : (i > 0 ? '<button class="textbtn muted" data-act="skipshot">Skip ' + k + "</button>" : "") +
        '<button class="textbtn muted" data-act="skipscene" data-si="' + si + '">Skip scene</button>' +
        '<button class="textbtn muted" data-act="finish">Finish now</button>';
    const inner =
      '<div class="active"><div class="a-info">' +
      '<div class="a-head"><div class="grow"><div class="eyebrow">' + eyebrow + "</div><h2>" + title(s) + "</h2></div>" + ruleBadge(s) + "</div>" +
      '<ol class="strip" aria-label="Shots of this scene">' + strip + "</ol>" +
      retakeNote +
      '<div class="step"><div class="step-label">' + (t.retake ? "Retaking <b>" + k + "</b>" : "Shot <b>" + k + "</b> of " + s.shots.length) + "</div>" +
      '<div class="step-name">' + sh.name + "</div>" +
      '<p class="step-how">' + sh.how + "</p>" +
      '<p class="step-move ' + (isStill ? "still" : "hand") + '">' + (isStill ? I.still : I.hand) + "<span>" + moveTxt + "</span></p>" +
      notes +
      "</div></div>" +
      '<div class="vf-slot"></div>' +
      '<div class="shoot"><button class="shutter" data-act="shoot"><span class="ring"></span>' + (t.retake ? "Retake " : "Take ") + k + "</button></div>" +
      '<div class="minor">' + minor + "</div>" +
      "</div>";
    return nodeWrap(t.retake ? "node--retake" : "node--active", "node-" + s.id, t.retake ? I.turn : String(s.kind === "extra" ? "+" : num.n), inner);
  }

  function miniSummary() {
    const built = state.scenes.filter((s) => s.built);
    const doneScenes = built.filter((s) => sceneProc(state.scenes.indexOf(s)).st === "done").length;
    const tt = totals();
    const req = state.scenes.filter((s) => inFlow(s)).length;
    const frac = tt.total ? state.pairs.filter((p) => p.status !== "skipped").reduce((a, p) => a + pairFrac(p), 0) / tt.total : 0;
    const line = !built.length
      ? "Starts by itself when the first scene is complete."
      : doneScenes + " of " + req + " scenes measured · " + tt.done + " of " + tt.total + " pairs so far.";
    return '<p class="row-meta">' + line + " The zip is made here after the last shot.</p>" + (built.length ? '<div class="bar" style="margin-top:6px"><span style="width:' + Math.round(frac * 100) + '%"></span></div>' : "");
  }
  function endLive() {
    let html = '<div class="proc-scenes">';
    state.scenes.forEach((s, si) => {
      if (!s.on) return;
      const n = s.shots.filter((x) => x.status === "done").length;
      if (s.skipped && !n) {
        html += '<div class="pscene"><div class="pscene-head"><b>' + title(s) + ' <small>skipped</small></b></div></div>';
        return;
      }
      if (!s.built) {
        html += '<div class="pscene"><div class="pscene-head"><b>' + title(s) + " <small>" + n + " photo" + (n === 1 ? "" : "s") + '</small></b><span class="chip chip--capturing">Not complete</span></div><p class="row-meta">' + (n ? "Its photos go in the zip, unmeasured." : "No photos.") + "</p></div>";
        return;
      }
      const p = sceneProc(si);
      const chip = '<span class="chip chip--' + p.st + '">' + { done: "Done", measuring: "Measuring", waiting: "Waiting" }[p.st] + "</span>";
      const ps = pairsOf(si).filter((q) => q.status !== "skipped");
      if (p.st === "done") {
        html += '<div class="pscene"><div class="pscene-head"><b>' + title(s) + " <small>" + p.total + " pairs</small></b>" + chip + '</div><p class="row-meta">All ' + METHODS.length + " methods finished" + (p.skippedPairs ? ", " + p.skippedPairs + " pairs skipped" : "") + ".</p></div>";
        return;
      }
      const rows = METHODS.map((m) => {
        const dn = ps.filter((q) => q.prog[m.id] >= 1).length;
        const fr = ps.length ? ps.reduce((a, q) => a + q.prog[m.id], 0) / ps.length : 1;
        const all = dn === ps.length;
        return "<li><span>" + m.name + '</span><div class="bar' + (all ? " is-done" : "") + '"><span style="width:' + Math.round(fr * 100) + '%"></span></div><span class="n' + (all ? " done" : "") + '">' + dn + " / " + ps.length + "</span></li>";
      }).join("");
      html += '<div class="pscene"><div class="pscene-head"><b>' + title(s) + " <small>" + p.total + " pairs</small></b>" + chip + '</div><ul class="methods">' + rows + "</ul></div>";
    });
    html += "</div>";
    return html;
  }
  function endSum() {
    const tt = totals();
    let html = '<p class="end-eta">' + (tt.open ? "<b>" + tt.open + " pair" + (tt.open === 1 ? "" : "s") + " still running</b>, " + fmtEta(tt.eta) + " left on this phone." : "<b>Everything is measured.</b>") + "</p>";
    html +=
      '<p class="end-sum">A zip now holds <b>' + photos() + " photos</b>, the log, the summary and <b>" + tt.done + " of " + tt.total + " results</b>." +
      (tt.open ? " The other " + tt.open + " are measured on the PC later." : "") + "</p>" +
      (state.finished ? '<p class="end-sum">Missing shots can still be taken: "Continue capturing" is at the first open scene above.</p>' : "");
    return html;
  }
  function endActions() {
    const tt = totals();
    if (state.zip === "making") return '<button class="primary dl" disabled><span class="spin"></span>Making the zip...</button>';
    if (state.zip === "ready") {
      const at = new Date(state.zipAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const newer = tt.done - state.zipResults;
      return (
        '<button class="primary dl" data-act="download">' + I.dl + "Download zip (" + zipSize() + ")</button>" +
        "<p>Made at " + at + " with " + state.zipResults + " of " + tt.total + " results." +
        (newer > 0 ? ' ' + newer + ' more finished since. <button class="textbtn" data-act="zip">Make it again with them</button>' : "") +
        "</p>"
      );
    }
    if (!tt.open) return '<button class="primary dl" data-act="zip">Make the zip</button>';
    if (state.wait)
      return '<p>Waiting for the rest. The zip is made by itself when everything is measured; keep this page open.</p><button class="secondary" data-act="zip">Good enough - make the zip now</button>';
    return (
      '<button class="primary" data-act="zip">Good enough - make the zip now</button>' +
      '<button class="secondary" data-act="wait">Wait for the rest</button>' +
      "<p>Finished results go in now; the rest is done on the PC.</p>"
    );
  }
  function procNode(t) {
    if (!state.started) {
      return nodeWrap("node--upcoming", "node-end", I.flag, '<div class="row-head"><div class="row-title">Processing and zip</div></div><p class="row-meta">After the last shot. You can finish early at any time.</p>');
    }
    if (t) {
      return nodeWrap("node--upcoming", "node-end", I.flag, '<div class="row-head"><div class="row-title">Processing and zip</div></div><div id="end-mini">' + miniSummary() + "</div>");
    }
    const inner =
      '<div class="eyebrow">' + (state.finished ? "Finished early" : "All shots taken") + '</div><h2 style="margin:2px 0 0;font-size:20px">Processing</h2>' +
      '<div class="end-grid"><div class="end-side"><div id="end-sum">' + endSum() + "</div>" +
      '<div class="end-actions" id="end-actions">' + endActions() + "</div></div>" +
      '<div id="end-live" class="end-live">' + endLive() + "</div></div>";
    return nodeWrap("node--active", "node-end", I.flag, inner);
  }

  function resumedBanner() {
    if (!resumedInfo) return "";
    return (
      '<div class="resumed">' + I.check + '<div class="grow"><b>Resumed where you left off.</b> ' + resumedInfo + "</div>" +
      '<button class="textbtn muted" data-act="dismiss-resumed" aria-label="Dismiss">OK</button></div>'
    );
  }

  function render() {
    const t = target();
    let html = setupNode();
    let firstOpen = true;
    state.scenes.forEach((s, si) => {
      if (t && t.si === si) html += resumedBanner() + activeCard(s, si, t);
      else if (s.kind === "extra" && !s.on) html += extraOffRow(si);
      else if (s.skipped) html += skippedRow(s, si);
      else if (complete(s) && s.shots.some((x) => x.status === "done")) html += doneRow(s, si);
      else {
        html += upcomingRow(s, si, firstOpen);
        firstOpen = false;
      }
    });
    html += (t ? "" : resumedBanner()) + procNode(t);
    tl.innerHTML = html;
    const slot = tl.querySelector(".vf-slot");
    if (slot && t) {
      const s = state.scenes[t.si];
      const k = key(s, t.i);
      const ghost = t.retake && t.i > 0 && s.shots[0].thumb && def(s).rule === "still" ? s.shots[0].thumb : null;
      vf.attach(slot, { kind: s.kind, i: t.i }, k + " · " + def(s).shots[t.i].name, ghost);
      vf.setCheck(state.lastCheck && state.lastCheck.si === t.si ? state.lastCheck : null);
    }
    updateHeader();
    fitVf();
    const focus = t ? (t.retake ? "r" : "a") + t.si : state.started ? "end" : "setup";
    if (focus !== lastFocus) {
      const first = lastFocus === null;
      lastFocus = focus;
      const id = t ? "node-" + state.scenes[t.si].id : state.started ? "node-end" : null;
      if (id && !(first && focus === "a0" && !resumedInfo && photos() === 0)) {
        requestAnimationFrame(() => {
          const el = tl.querySelector(".resumed") || document.getElementById(id);
          if (el) el.scrollIntoView({ block: "start", behavior: first ? "auto" : "smooth" });
        });
      }
    }
  }
  function fitVf() {
    const card = tl.querySelector(".active");
    if (!card || !vf.el.isConnected) return;
    if (window.innerWidth >= 700) {
      vf.el.style.height = "";
      return;
    }
    vf.el.style.height = "260px";
    const top = document.querySelector(".topbar").offsetHeight;
    const cardBox = card.closest(".card");
    const banner = tl.querySelector(".resumed");
    const rest = cardBox.offsetHeight - vf.el.offsetHeight + (banner ? banner.offsetHeight + 10 : 0);
    const avail = window.innerHeight - top - 8 - rest - 6;
    vf.el.style.height = Math.round(Math.max(200, Math.min(avail, window.innerHeight * 0.6))) + "px";
  }
  window.addEventListener("resize", () => fitVf());
  function renderEndActions() {
    const el = document.getElementById("end-actions");
    if (el) el.innerHTML = endActions();
  }
  function updateLive() {
    state.scenes.forEach((s, si) => {
      const el = document.getElementById("proc-" + s.id);
      if (el) el.innerHTML = procInner(si);
    });
    const liveEl = document.getElementById("end-live");
    if (liveEl) liveEl.innerHTML = endLive();
    const sumEl = document.getElementById("end-sum");
    if (sumEl) sumEl.innerHTML = endSum();
    const mini = document.getElementById("end-mini");
    if (mini) mini.innerHTML = miniSummary();
    const act = document.getElementById("end-actions");
    if (act) {
      const h = endActions();
      if (act.dataset.h !== h) {
        act.innerHTML = h;
        act.dataset.h = h;
      }
    }
    updateHeader();
  }
  function updateHeader() {
    const line = document.getElementById("status-line");
    const txt = document.getElementById("status-text");
    const n = photos();
    let s = n ? n + " photo" + (n === 1 ? "" : "s") + " saved on this phone" : "Nothing captured yet";
    const running = state.pairs.find((p) => p.status === "running");
    const tt = totals();
    if (running) s += " · measuring " + def(state.scenes[running.si]).title;
    else if (tt.total && !tt.open) s += " · all measured";
    if (!saveOk) s = "Could not save on this phone. Keep the page open.";
    line.classList.toggle("is-warn", !saveOk);
    txt.textContent = s;
  }

  // ---------------- toast ----------------
  const toastEl = document.getElementById("toast");
  let toastId = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastId);
    toastId = setTimeout(() => (toastEl.hidden = true), ms || 4200);
  }

  // ---------------- events ----------------
  tl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    const si = b.dataset.si != null ? Number(b.dataset.si) : null;
    const i = b.dataset.i != null ? Number(b.dataset.i) : null;
    switch (act) {
      case "places":
        state.places = Number(b.dataset.n);
        render();
        break;
      case "start":
        state.started = true;
        state.startedAt = Date.now();
        state.scenes = buildScenes(state.places);
        log("Session started, light scene at " + state.places + " place(s)");
        save();
        vf.start();
        render();
        break;
      case "shoot":
        shoot();
        break;
      case "retake":
        if (busy) return;
        state.retake = { si, i };
        state.lastCheck = null;
        render();
        break;
      case "cancel-retake":
        state.retake = null;
        render();
        break;
      case "redo-scene":
        if (b.dataset.armed !== "1") {
          b.dataset.armed = "1";
          b.textContent = "Tap again: all shots of this scene are taken anew";
          b.style.color = "var(--warn)";
          setTimeout(() => {
            if (b.isConnected) {
              b.dataset.armed = "0";
              b.textContent = "Redo the whole scene";
              b.style.color = "";
            }
          }, 4000);
          return;
        }
        redoScene(si);
        break;
      case "skipshot": {
        const t = target();
        if (!t) return;
        const s = state.scenes[t.si];
        s.shots[t.i].status = "skipped";
        log("Skipped " + title(s) + " " + key(s, t.i));
        state.lastCheck = null;
        if (complete(s)) buildPairs(t.si);
        if (!cursor()) state.endShown = true;
        save();
        render();
        break;
      }
      case "skipscene": {
        const s = state.scenes[si];
        s.skipped = true;
        if (state.retake && state.retake.si === si) state.retake = null;
        log("Skipped scene " + title(s));
        state.lastCheck = null;
        save();
        render();
        break;
      }
      case "unskip":
        state.scenes[si].skipped = false;
        state.finished = false;
        save();
        render();
        break;
      case "finish":
        state.finished = true;
        state.endShown = true;
        log("Finished early");
        save();
        render();
        break;
      case "continue":
        state.finished = false;
        save();
        render();
        break;
      case "extra-on":
        state.scenes[si].on = true;
        state.finished = false;
        save();
        render();
        break;
      case "extra-off":
        state.scenes[si].on = false;
        save();
        render();
        break;
      case "pairs": {
        const id = b.dataset.id;
        if (openPairs.has(id)) openPairs.delete(id);
        else openPairs.add(id);
        b.textContent = openPairs.has(id) ? "Hide pairs" : "Show pairs";
        updateLive();
        break;
      }
      case "zip":
        makeZip();
        break;
      case "wait":
        state.wait = true;
        save();
        renderEndActions();
        break;
      case "download":
        toast("In the real page this saves the zip: every photo, the log, the summary and the results.");
        break;
      case "dismiss-resumed":
        resumedInfo = null;
        render();
        break;
    }
  });
  function redoScene(si) {
    const s = state.scenes[si];
    s.shots.forEach((x) => {
      x.status = "todo";
      x.thumb = null;
      x.lum = null;
      x.check = null;
    });
    state.pairs = state.pairs.filter((p) => p.si !== si);
    s.built = false;
    state.retake = null;
    state.lastCheck = null;
    state.zip = null;
    log("Redo scene " + title(s));
    save();
    render();
    toast(title(s) + " starts again from " + key(s, 0) + ".");
  }

  // menu
  const menuBtn = document.getElementById("menu-btn");
  const menu = document.getElementById("menu");
  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(menu.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) setMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenu(false);
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "reset" && b.dataset.armed !== "1") {
      b.dataset.armed = "1";
      b.firstChild.textContent = "Tap again to delete " + photos() + " photos ";
      return;
    }
    setMenu(false);
    if (act === "cockpit") toast("In the real page this switches to the cockpit view. Your session stays as it is.");
    else if (act === "copylog") {
      const text = state.log.map((l) => new Date(l.t).toISOString().slice(11, 19) + "  " + l.m).join("\n") || "(empty log)";
      const done = () => toast("Log copied (" + state.log.length + " lines).");
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast("Could not copy the log here."));
      else toast("Could not copy the log here.");
    } else if (act === "reload") {
      save();
      try {
        sessionStorage.setItem(RESUME_FLAG, "1");
      } catch {
        /* resume banner is optional */
      }
      location.reload();
    } else if (act === "reset") {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* nothing stored */
      }
      state = freshState();
      lastFocus = null;
      resumedInfo = null;
      render();
      window.scrollTo(0, 0);
    }
    b.dataset.armed = "0";
  });
  new MutationObserver(() => {
    if (menu.hidden) {
      const r = menu.querySelector('[data-act="reset"]');
      if (r && r.dataset.armed === "1") {
        r.dataset.armed = "0";
        r.firstChild.textContent = "Start over ";
      }
    }
  }).observe(menu, { attributes: true, attributeFilter: ["hidden"] });

  // ---------------- demo states (for screenshots) ----------------
  function demoThumb(kind, i) {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 128;
    const x = c.getContext("2d");
    drawScene(x, 96, 128, { kind, i }, 0);
    return { thumb: c.toDataURL("image/jpeg", 0.62), lum: luminance(x, 96, 128) };
  }
  function demoTake(si, upto) {
    const s = state.scenes[si];
    for (let i = 0; i < upto; i++) {
      const g = demoThumb(s.kind, i);
      Object.assign(s.shots[i], { status: "done", thumb: g.thumb, lum: g.lum });
      lightCheck(si, i);
    }
    if (complete(s)) buildPairs(si);
  }
  function demoProgress(frac) {
    let budget = frac * state.pairs.reduce((t, p) => t + pairRemain(p), 0);
    for (const p of state.pairs) {
      for (const m of METHODS) {
        if (budget <= 0) return;
        const use = Math.min(m.sec, budget);
        p.prog[m.id] = use / m.sec;
        budget -= use;
      }
      p.status = METHODS.every((m) => p.prog[m.id] >= 1) ? "done" : "running";
    }
  }
  function demo(name) {
    state = freshState();
    if (name === "setup") return;
    state.started = true;
    state.startedAt = Date.now() - 9 * 60000;
    state.scenes = buildScenes(1);
    log("Demo state " + name);
    if (name === "light") {
      demoTake(0, 2);
      state.lastCheck = { si: 0, i: 1, ok: true, text: "Same light as L1. Good." };
    } else if (name === "mid" || name === "retake") {
      demoTake(0, 4);
      demoTake(1, 2);
      demoProgress(0.6);
      if (name === "retake") state.retake = { si: 1, i: 0 };
    } else if (name === "end") {
      demoTake(0, 4);
      demoTake(1, 6);
      demoTake(2, 3);
      demoProgress(0.55);
      state.endShown = true;
    }
  }

  // ---------------- boot ----------------
  const demoName = params.get("demo");
  if (demoName) {
    demo(demoName);
    save();
    params.delete("demo");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
  } else {
    const loaded = load();
    if (loaded) state = loaded;
  }
  // A measurement interrupted by the reload restarts its current method.
  state.pairs.forEach((p) => {
    if (p.status === "running") p.status = "queued";
  });
  if (state.zip === "making") state.zip = null;

  let resumed;
  try {
    resumed = sessionStorage.getItem(RESUME_FLAG) === "1";
    sessionStorage.removeItem(RESUME_FLAG);
  } catch {
    resumed = false;
  }
  if (resumed && state.started) {
    const tt = totals();
    resumedInfo = "Restored from this phone: " + photos() + " photos, " + tt.done + " measured pair" + (tt.done === 1 ? "" : "s") + ". Nothing was lost.";
    const rs = document.getElementById("restoring");
    rs.hidden = false;
    setTimeout(() => {
      rs.hidden = true;
      render();
    }, 700);
  } else {
    render();
  }
  if (state.started) vf.start();
  setInterval(tick, 250);
  window.addEventListener("pagehide", save);
})();
