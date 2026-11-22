/*
 * Feature Match Cockpit - throwaway prototype. Not wired to the app.
 * The viewfinder plus one fixed dock; photos take themselves when the motion
 * sensor reports the phone still (tap + 3 s countdown as the fallback); each
 * finished pair is packed as one zip and saved by itself. Measuring is faked.
 */
(function () {
  "use strict";

  // ---------- data: the pairs and their texts ----------
  const PAIRS = [
    ["1a", "light: control (same light)", "still", "nothing"],
    ["1b", "light: dimmed", "light", "light dims"],
    ["1c", "light: dark, not black", "light", "very dark"],
    ["2a", "rotation: control (both upright)", "still", "nothing"],
    ["2b", "rotation: 90 deg", "move", "quarter turn"],
    ["2c", "rotation: 180 deg", "move", "half turn"],
    ["2d", "rotation: tilted 30-45 deg", "move", "tilt 30-45 deg"],
    ["3a", "distance: control (both 1.5 m)", "still", "nothing"],
    ["3b", "distance: 1.5 m to 3 m", "move", "1.5 m to 3 m"],
    ["3c", "distance: 1 m to 3 m", "move", "1 m to 3 m"],
    ["4a", "side step, flat: control", "still", "nothing"],
    ["4b", "side step, flat: 1 m", "move", "1 m side step"],
    ["4c", "side step, deep: control", "still", "nothing"],
    ["4d", "side step, deep: 1 m", "move", "1 m side step"],
    ["x", "other", "still", "your choice"],
    ["none", "manual run", "still", "options decide"],
  ].map(([key, label, kind, change]) => ({ key, label, kind, change }));
  const byKey = Object.fromEntries(PAIRS.map((p) => [p.key, p]));
  const LIGHT = new Set(["1a", "1b", "1c"]);

  /* The short line in the dock, per phase: before A, and between A and B. */
  const SHORT = {
    "1a": [
      "Prop the phone up, aim at a detailed part of the room.",
      "Change nothing.",
    ],
    "1b": [
      "Light <b>ON</b> as normal. Phone on the stand.",
      "Now <b>dim the light</b> (main light off, one small lamp). B waits for the darker room.",
    ],
    "1c": [
      "Light <b>ON</b> as normal. Phone on the stand.",
      "<b>Dim as far as possible</b> while shapes still show. B waits for the dark.",
    ],
    "2a": [
      "About 1.5 m from a flat surface with detail. Phone upright.",
      "Same place, upright again.",
    ],
    "2b": [
      "Same surface and place as 2a. Phone upright.",
      "<b>Turn the phone sideways</b>, aim at the same centre.",
    ],
    "2c": [
      "Same surface and place as 2a. Phone upright.",
      "<b>Hold it upside down</b>, aim at the same centre.",
    ],
    "2d": [
      "Same surface and place as 2a. Phone upright.",
      "<b>Tilt it 30-45 deg</b> (one o'clock), same centre.",
    ],
    "3a": ["Flat surface, from 1.5 m.", "From the same place."],
    "3b": [
      "From 1.5 m, surface centred.",
      "<b>Step straight back to about 3 m</b>, keep it centred.",
    ],
    "3c": [
      "From 1 m, surface centred.",
      "<b>Step straight back to about 3 m</b>, keep it centred.",
    ],
    "4a": ["A flat surface, from one place.", "Same place."],
    "4b": [
      "The flat surface.",
      "<b>Step 1 m to the side</b>, parallel; aim at the same centre.",
    ],
    "4c": [
      "Aim into a deep room or hallway (near and far things).",
      "Same place.",
    ],
    "4d": [
      "The deep scene.",
      "<b>Step 1 m to the side</b>, aim at the same centre.",
    ],
    x: ["Anything not in the list (the file says other).", "Photo B."],
    none: ["Manual run: the Settings options decide.", "Photo B."],
  };

  const DO_NOT_MOVE = "Do not move the phone (tap gently).";
  const BRIGHTENS =
    "The camera brightens a dim picture by itself a little; photo B only has to look clearly darker.";
  const FLAT =
    "a FLAT surface with detail (a poster, a wall with pictures, a patterned door, a large book or map on the floor)";
  const GUIDE = {
    "1a": [
      "How many matches survive when nothing changes.",
      [
        "Prop the phone up on a table or shelf, pointing at a detailed part of the room (or hold it very still).",
        "Photo A.",
        "Change nothing.",
        "Photo B.",
      ],
      0,
      "Moving the phone, changing the light.",
    ],
    "1b": [
      "Same place as 1a: does a method still match when the light gets weaker?",
      [
        "Photo A with the light ON as normal.",
        "Then dim the light, wait 2 seconds, then photo B.",
        "To dim: switch off the main light, keep one small lamp, or use a dimmer. " +
          DO_NOT_MOVE,
        BRIGHTENS,
      ],
      2,
      "Dimming before photo A, moving the phone between A and B.",
    ],
    "1c": [
      "Same place as 1a: does a method still match with very little light?",
      [
        "Photo A with the light ON as normal.",
        "Then dim the light, wait 2 seconds, then photo B.",
        "Dim as far as possible while the room's shapes are still visible on the screen. " +
          DO_NOT_MOVE,
        BRIGHTENS,
      ],
      2,
      "Dimming before photo A, fully black (nothing to match), moving the phone.",
    ],
    "2a": [
      "The baseline for the turning tests.",
      [
        "Stand about 1.5 m in front of " + FLAT + ".",
        "Hold the phone upright: photo A.",
        "Same place, upright again: photo B. Holding by hand is fine.",
      ],
      0,
      "A deep scene: turning the phone also shifts the lens a few cm, which changes how near and far things line up; a flat surface does not notice.",
    ],
    "2b": [
      "Does a method cope with a quarter turn?",
      [
        "Same flat surface, same place as 2a.",
        "Upright: photo A.",
        "Turn the phone sideways (either way) and aim at the same centre: photo B.",
      ],
      0,
      "Stepping closer or away.",
    ],
    "2c": [
      "Does a method cope with a half turn?",
      [
        "Same flat surface, same place as 2a.",
        "Upright: photo A.",
        "Hold the phone upside down and aim at the same centre: photo B.",
      ],
      0,
      "Stepping closer or away.",
    ],
    "2d": [
      "Does a method cope with a slight tilt?",
      [
        "Same flat surface, same place as 2a.",
        "Upright: photo A.",
        "Tilt the phone 30-45 deg (like a clock hand at one o'clock) and aim at the same centre: photo B.",
      ],
      0,
      "Stepping closer or away.",
    ],
    "3a": [
      "The baseline for the distance tests.",
      [
        "Same flat surface.",
        "From 1.5 m: photo A.",
        "From the same place: photo B.",
      ],
      0,
      "Moving between A and B.",
    ],
    "3b": [
      "Does a method match the same thing at half the size?",
      [
        "From 1.5 m: photo A.",
        "Step straight back to about 3 m, keep the surface centred: photo B.",
      ],
      0,
      "Zooming instead of stepping back.",
    ],
    "3c": [
      "Does a method match the same thing at a third of the size?",
      [
        "From 1 m: photo A.",
        "Step straight back to about 3 m, keep the surface centred: photo B.",
      ],
      0,
      "Zooming instead of stepping back.",
    ],
    "4a": [
      "The baseline for the side-step test on a flat surface.",
      ["From one place: photo A of the flat surface.", "Photo B."],
      0,
      "Moving between A and B.",
    ],
    "4b": [
      "Does a method match after a change of viewpoint?",
      [
        "Photo A of the flat surface.",
        "Step about 1 m to the side, parallel to it.",
        "Turn to aim at the same centre: photo B.",
      ],
      0,
      "Stepping closer or away.",
    ],
    "4c": [
      "The baseline for a scene with depth.",
      [
        "Aim into a deep room or a hallway (things near and far).",
        "From one place: photo A, then photo B.",
      ],
      0,
      "Anything moving in the scene (people, pets, a TV).",
    ],
    "4d": [
      "Does a method match a deep scene after a change of viewpoint?",
      [
        "Photo A into the deep scene.",
        "Step about 1 m to the side.",
        "Aim at the same centre: photo B.",
      ],
      0,
      "Anything moving in the scene (people, pets, a TV).",
    ],
    x: [
      'Anything not in the list; the file name says "other".',
      ["Photo A.", "Photo B."],
      0,
      "Anything personal in the picture.",
    ],
    none: [
      "A manual benchmark run: the options decide what runs, and no photo test settings apply.",
      ["Set the options.", "Photo A.", "Photo B."],
      0,
      "Using it for the photo tests: pick their pair instead.",
    ],
  };
  const BEFORE = [
    "Lock the screen rotation. Do not zoom.",
    "Put the phone on a stand where you can. Photos take themselves when the phone is still, so you do not have to touch it.",
    "Nothing personal in the picture: no faces, documents, screens, letters, house numbers, and no window showing the outside.",
    "Aim at something with detail (furniture, shelves, pictures, patterned fabric); a plain white wall gives nothing to match.",
    "Each pair is saved as one zip when it is measured, and the next pair comes up by itself. Tap a pair under Pairs to repeat or skip one.",
    "Chrome may ask once whether this page may download several files: choose Allow.",
  ];
  const SPOT_NOTE =
    "Spot: test 1 is repeated at up to 3 places in the room (spot 1, 2, 3). After 1c, point the phone at another part of the room; 1a at the next spot comes up by itself.";

  /* The run order: the light pairs at spots 1-3, then the rest at spot 1 (as nextPair does). */
  const PLAN = [];
  for (let s = 1; s <= 3; s++)
    for (const k of ["1a", "1b", "1c"]) PLAN.push({ key: k, spot: s });
  for (const k of [
    "2a",
    "2b",
    "2c",
    "2d",
    "3a",
    "3b",
    "3c",
    "4a",
    "4b",
    "4c",
    "4d",
  ])
    PLAN.push({ key: k, spot: 1 });
  const planId = (p) => p.key + "-s" + p.spot;
  function nextPair(key, spot) {
    if (key === "1c")
      return spot < 3 ? { key: "1a", spot: spot + 1 } : { key: "2a", spot: 1 };
    if (key === "x" || key === "none") return { key, spot: 1 };
    const order = PAIRS.map((p) => p.key);
    const i = order.indexOf(key);
    return { key: order[i + 1], spot: LIGHT.has(order[i + 1]) ? spot : 1 };
  }
  const slug = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const pairName = (seq, key, spot) =>
    "feature-match-" +
    String(seq).padStart(2, "0") +
    "-" +
    key +
    "-s" +
    spot +
    "-" +
    slug(byKey[key].label);

  // ---------- state ----------
  const STORE = "fm-cockpit-progress";
  const params = new URLSearchParams(location.search);
  const S = {
    phase: "off", // off | ready | armA | countA | armB | countB | measure
    seq: 0,
    cur: { key: "1a", spot: 1 },
    entries: {}, // planId or key -> { status: saved|kept|warn, seq, name }
    mode: "auto",
    save: "each",
    welcomed: false,
    a: null, // { canvas, thumb, mean }
    tag: null, // { seq, key, spot } fixed at photo A
    tA: 0,
    savedOnce: false,
    lastFinished: null, // { tag, a } for "retake B"
    drawerOpen: false,
    countEnd: 0,
    gateSince: 0,
    autoDownloads: 0,
  };
  const kept = new Map(); // zip name -> Blob, until "Download all"
  const session = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const logLines = [];

  function load() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE) || "null");
      if (p && typeof p === "object") {
        if (Number.isInteger(p.seq) && p.seq >= 0) S.seq = p.seq;
        if (p.cur && byKey[p.cur.key] && [1, 2, 3].includes(p.cur.spot))
          S.cur = p.cur;
        if (p.entries && typeof p.entries === "object") S.entries = p.entries;
        if (p.mode === "tap" || p.mode === "auto") S.mode = p.mode;
        if (p.save === "end" || p.save === "each") S.save = p.save;
        S.welcomed = !!p.welcomed;
      }
    } catch {
      /* storage blocked: start at pair 1; the session token tells runs apart */
    }
  }
  function persist() {
    try {
      const { seq, cur, entries, mode, save, welcomed } = S;
      localStorage.setItem(
        STORE,
        JSON.stringify({ seq, cur, entries, mode, save, welcomed }),
      );
    } catch {
      /* ignore */
    }
  }
  function log(line) {
    logLines.push(line);
    $("log").textContent = logLines.join("\n");
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const video = $("video");
  const fake = $("fake");
  const fctx = fake.getContext("2d");
  let useVideo = false;

  // ---------- the drawn room (no camera) ----------
  const fakeRoom = { light: 1, target: 1, jx: 0, jy: 0, rot: 0 };
  function drawRoom() {
    const w = fake.clientWidth || 400;
    const h = fake.clientHeight || 400;
    if (fake.width !== w || fake.height !== h) {
      fake.width = w;
      fake.height = h;
    }
    fakeRoom.light += (fakeRoom.target - fakeRoom.light) * 0.08;
    const L = fakeRoom.light;
    const shake = motion.fake ? Math.min(14, motion.energy * 2.2) : 0;
    fakeRoom.jx = (Math.random() - 0.5) * shake;
    fakeRoom.jy = (Math.random() - 0.5) * shake;
    const c = fctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    c.translate(w / 2 + fakeRoom.jx, h / 2 + fakeRoom.jy);
    c.rotate(fakeRoom.rot);
    const s = Math.max(w, h) / 900;
    c.scale(s, s);
    const tone = (r, g, b) => "rgb(" + r * L + "," + g * L + "," + b * L + ")";
    c.fillStyle = tone(176, 160, 138);
    c.fillRect(-700, -700, 1400, 1400);
    c.fillStyle = tone(120, 92, 66);
    c.fillRect(-700, 180, 1400, 600);
    // shelf with books
    c.fillStyle = tone(92, 64, 44);
    c.fillRect(-380, -260, 360, 16);
    c.fillRect(-380, -90, 360, 16);
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (const y of [-246, -76]) {
      let x = -376;
      while (x < -30) {
        const bw = 14 + rnd() * 22;
        const bh = 90 + rnd() * 60;
        c.fillStyle = tone(
          60 + rnd() * 180,
          50 + rnd() * 150,
          40 + rnd() * 160,
        );
        c.fillRect(x, y - bh, bw, bh);
        x += bw + 2;
      }
    }
    // framed picture with a pattern
    c.fillStyle = tone(40, 36, 30);
    c.fillRect(60, -320, 280, 210);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 4; j++) {
        c.fillStyle = (i + j) % 2 ? tone(210, 120, 70) : tone(70, 120, 160);
        c.fillRect(74 + i * 42, -306 + j * 46, 40, 44);
      }
    // rug
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i % 2 ? tone(150, 40, 50) : tone(220, 200, 160);
      c.fillRect(-300 + i * 50, 260, 50, 120);
    }
    // plant
    c.fillStyle = tone(40, 110, 60);
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.arc(250 + Math.cos(i) * 40, 60 + Math.sin(i * 1.7) * 50, 30, 0, 7);
      c.fill();
    }
    c.fillStyle = tone(150, 80, 50);
    c.fillRect(220, 110, 70, 70);
    c.restore();
  }

  // ---------- camera ----------
  async function startCamera() {
    if (params.has("nocam")) return false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log("camera: no camera API - showing a drawn room");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      useVideo = true;
      video.hidden = false;
      fake.hidden = true;
      log("camera: on, " + video.videoWidth + "x" + video.videoHeight);
      return true;
    } catch (e) {
      log("ERROR camera: " + (e && e.name) + " - showing a drawn room");
      return false;
    }
  }
  function source() {
    return useVideo
      ? { el: video, w: video.videoWidth, h: video.videoHeight }
      : { el: fake, w: fake.width, h: fake.height };
  }
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 24;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  function greyMean(el) {
    pctx.drawImage(el, 0, 0, 32, 24);
    const d = pctx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4)
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  }
  function grab() {
    const { el, w, h } = source();
    const k = Math.min(1, 1280 / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * k);
    cv.height = Math.round(h * k);
    cv.getContext("2d").drawImage(el, 0, 0, cv.width, cv.height);
    const t = document.createElement("canvas");
    t.width = 160;
    t.height = Math.round((160 * cv.height) / cv.width);
    t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
    return {
      canvas: cv,
      thumb: t.toDataURL("image/jpeg", 0.7),
      mean: greyMean(cv),
    };
  }

  // ---------- motion sensor: is the phone still? ----------
  const motion = {
    status: "unknown",
    energy: 0,
    stillMs: 0,
    movedMs: 0,
    moved: false,
    fake: false,
    fakeE: 0.2,
    shakeUntil: 0,
  };
  const HOLD_MS = 1200;
  window.addEventListener("devicemotion", (e) => {
    const r = e.rotationRate;
    const a = e.acceleration;
    if (!r && !a) return;
    if (r && r.alpha == null && a && a.x == null) return;
    motion.status = "ok";
    if (motion.fake) return;
    const rot = r ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0; // deg/s
    const acc = a ? Math.hypot(a.x || 0, a.y || 0, a.z || 0) : 0; // m/s2 without gravity
    const e1 = Math.max(rot / 3, acc / 0.25); // 1 = the edge of "still"
    motion.energy = motion.energy * 0.7 + e1 * 0.3;
  });
  function sensorUsable() {
    return motion.fake || motion.status !== "none";
  }
  function effectiveMode() {
    return S.mode === "auto" && sensorUsable() ? "auto" : "tap";
  }
  // Every touch shakes the phone a little; the fake sensor shows that.
  document.addEventListener("pointerdown", () => {
    if (motion.fake) motion.fakeE = Math.max(motion.fakeE, 4);
  });

  // ---------- the flow ----------
  function pairOf() {
    return byKey[S.cur.key];
  }
  function entryKey(p) {
    return LIGHT.has(p.key) || PLAN.some((q) => q.key === p.key)
      ? planId(p)
      : p.key;
  }
  function setPhase(p) {
    S.phase = p;
    motion.stillMs = 0;
    S.gateSince = 0;
    if (p === "armB") {
      motion.moved = false;
      motion.movedMs = 0;
    }
    render();
  }
  function flash() {
    const f = $("flash");
    f.classList.add("on");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => f.classList.remove("on")),
    );
  }
  function captureA() {
    S.a = grab();
    S.seq += 1;
    S.tag = {
      seq: S.seq,
      key: S.cur.key,
      spot: LIGHT.has(S.cur.key) ? S.cur.spot : 1,
    };
    S.tA = performance.now();
    S.lastFinished = null;
    flash();
    log(
      "photo A: pair " +
        S.tag.seq +
        ", " +
        S.tag.key +
        " " +
        pairOf().label +
        ", spot " +
        S.tag.spot +
        ", grey " +
        S.a.mean.toFixed(1),
    );
    persist();
    setPhase(effectiveMode() === "auto" ? "armB" : "readyB");
    status(
      "A taken. " +
        (effectiveMode() === "auto"
          ? "B takes itself when ready."
          : "Tap for B."),
      "ok",
    );
    demoAutopilot();
  }
  function captureB() {
    const b = grab();
    S.b = b;
    flash();
    log("photo B: grey " + b.mean.toFixed(1));
    measure(S.tag, S.a, b);
  }
  function lightCheck(key, mA, mB) {
    if (key === "1b" || key === "1c") {
      if (mA < 10) return "too-dark-a";
      if (mB < 3) return "too-dark-b";
      if (mB > 0.8 * mA) return "not-darker";
      return "ok";
    }
    if (key === "1a") {
      const lim = mA < 10 ? 3 : 0.2 * mA;
      return Math.abs(mB - mA) > lim ? "changed" : "ok";
    }
    return null;
  }
  const LIGHT_TEXT = {
    "not-darker":
      "Photo B is not darker than photo A. The light has to change BETWEEN the two photos; dim further and retake B.",
    "too-dark-a": "Photo A is almost black. Turn the light on for photo A.",
    "too-dark-b":
      "Photo B is black: nothing to match. Dim a little less and retake B.",
    changed:
      "The light changed during the control pair. Keep the light as it is and take it again.",
  };

  const METHODS = ["SIFT", "XFeat", "ALIKED+LG"];
  const SIZES = [320, 480, 640];
  function measure(tag, a, b) {
    setPhase("measure");
    status("Measuring the pair, then it saves itself.", "");
    $("cover").hidden = false;
    const steps = METHODS.length * SIZES.length;
    let i = 0;
    const rows = [];
    const t = setInterval(() => {
      const m = METHODS[Math.floor(i / SIZES.length)];
      const s = SIZES[i % SIZES.length];
      $("coverTitle").textContent = "Measuring " + (i + 1) + " / " + steps;
      $("coverText").textContent =
        m + " at " + s + " px. Camera paused so the timing is fair.";
      $("coverBar").style.width = ((i + 1) / steps) * 100 + "%";
      rows.push([
        m,
        s,
        (20 + Math.random() * 90 * (s / 320)).toFixed(0),
        (4 + Math.random() * 30).toFixed(0),
        Math.round(80 + Math.random() * 400),
      ]);
      i++;
      if (i >= steps) {
        clearInterval(t);
        $("cover").hidden = true;
        finish(tag, a, b, rows);
      }
    }, 330);
  }

  async function finish(tag, a, b, rows) {
    const check = lightCheck(tag.key, a.mean, b.mean);
    if (check)
      log(
        "light check: " +
          check +
          " (B " +
          ((b.mean / Math.max(1, a.mean)) * 100).toFixed(0) +
          "% of A)",
      );
    $("resultRows").innerHTML = rows
      .map((r) => "<tr><td>" + r.join("</td><td>") + "</td></tr>")
      .join("");
    $("resultsFor").textContent =
      "Pair " +
      String(tag.seq).padStart(2, "0") +
      ", " +
      tag.key +
      " " +
      byKey[tag.key].label +
      ", spot " +
      tag.spot;
    const warn = check && check !== "ok" ? LIGHT_TEXT[check] : "";
    $("lightWarn").hidden = !warn;
    $("lightWarn").textContent = warn;

    const name = pairName(tag.seq, tag.key, tag.spot) + ".zip";
    const zip = await pairZip(tag, a, b, rows, check);
    kept.set(name, zip);
    const id = entryKey(tag);
    const entry = {
      status: warn ? "warn" : S.save === "each" ? "saved" : "kept",
      seq: tag.seq,
      name,
    };
    S.entries[id] = entry;
    if (S.save === "each") {
      if (S.autoDownloads === 0)
        log(
          "save: the first automatic download; Chrome may ask to allow several",
        );
      download(zip, name);
      S.autoDownloads++;
      log("saved: " + name);
    } else {
      log("kept on this page: " + name);
    }
    S.lastFinished = { tag, a };
    S.a = null;
    S.b = null;
    S.tag = null;
    if (warn) {
      log("pair kept: take " + tag.key + " again");
    } else {
      S.cur = nextPair(tag.key, tag.spot);
      log("next pair: " + S.cur.key + " spot " + S.cur.spot);
    }
    persist();
    setPhase("ready");
    if (warn) status(warn, "bad");
    else
      status(
        (S.save === "each" ? "Saved " : "Kept ") +
          name.replace("feature-match-", "").replace(".zip", "") +
          ". Next: " +
          S.cur.key +
          ".",
        "ok",
      );
    S.savedOnce = true;
  }

  // ---------- files: a stored (uncompressed) zip ----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zipBlob(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let off = 0;
    for (const f of files) {
      const data =
        f.data instanceof Uint8Array
          ? f.data
          : new Uint8Array(await f.data.arrayBuffer());
      const nm = enc.encode(f.name);
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, nm.length, true);
      parts.push(h.buffer, nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, nm.length, true);
      c.setUint32(42, off, true);
      central.push(c.buffer, nm);
      off += 30 + nm.length + data.length;
    }
    const csize = central.reduce((s, p) => s + (p.byteLength || p.length), 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true);
    e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e.buffer], {
      type: "application/zip",
    });
  }
  const png = (cv) => new Promise((res) => cv.toBlob(res, "image/png"));
  async function pairZip(tag, a, b, rows, check) {
    const frames = {
      format: "feature-match-frames/1",
      pair: tag.key,
      pairLabel: byKey[tag.key].label,
      spot: tag.spot,
      sequence: tag.seq,
      session,
      lightCheck: check,
      note: "PROTOTYPE: fake measurements",
      frames: [
        {
          name: "A",
          width: a.canvas.width,
          height: a.canvas.height,
          greyMean: +a.mean.toFixed(2),
        },
        {
          name: "B",
          width: b.canvas.width,
          height: b.canvas.height,
          greyMean: +b.mean.toFixed(2),
        },
      ],
    };
    const enc = new TextEncoder();
    return zipBlob([
      { name: "feature-match-frame-a.png", data: await png(a.canvas) },
      { name: "feature-match-frame-b.png", data: await png(b.canvas) },
      {
        name: "feature-match-frames.json",
        data: enc.encode(JSON.stringify(frames, null, 2)),
      },
      {
        name: "feature-match-matches.json",
        data: enc.encode(
          JSON.stringify({
            format: "feature-match-matches/1",
            methods: rows.map((r) => ({ id: r[0], size: r[1], matches: r[4] })),
          }),
        ),
      },
      { name: "feature-match-log.txt", data: enc.encode(logLines.join("\n")) },
    ]);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function downloadAll() {
    if (!kept.size) return;
    const files = [...kept].map(([name, blob]) => ({ name, data: blob }));
    const zip = await zipBlob(files);
    const name = "feature-match-all-" + session + ".zip";
    download(zip, name);
    for (const [id, e] of Object.entries(S.entries))
      if (e.status === "kept") e.status = "saved";
    persist();
    log("download all: " + files.length + " pairs as " + name);
    status("Downloaded " + files.length + " pairs in one zip.", "ok");
    render();
  }

  // ---------- controls ----------
  async function onShutter() {
    const m = effectiveMode();
    switch (S.phase) {
      case "off": {
        if (S.starting) return; // the permission prompt may still be open
        S.starting = true;
        $("shutterText").textContent = "Starting";
        S.welcomed = true;
        persist();
        $("welcome").hidden = true;
        const ok = await startCamera();
        S.starting = false;
        if (!ok)
          motion.fake =
            motion.fake ||
            params.has("demo") ||
            !("DeviceMotionEvent" in window);
        $("fakeSensor").checked = motion.fake;
        setTimeout(() => {
          if (motion.status !== "ok" && !motion.fake) {
            motion.status = "none";
            $("sensorNote").textContent =
              "No motion sensor readings: photos are taken by tap with a 3 s countdown. Check Chrome's site settings, Motion sensors.";
            log("motion sensor: no readings, tap + countdown");
            render();
          }
        }, 2000);
        setPhase("ready");
        status("Camera on. Follow the line above, then tap.", "");
        break;
      }
      case "ready":
        setPhase(m === "auto" ? "armA" : "countA");
        if (m === "tap") S.countEnd = performance.now() + 3000;
        break;
      case "readyB":
        setPhase("countB");
        S.countEnd = performance.now() + 3000;
        break;
      case "armA":
      case "countA":
        setPhase("ready");
        status("Cancelled.", "");
        break;
      case "armB":
      case "countB":
        // tap during B: take B by countdown instead of waiting for the condition
        if (S.phase === "armB") {
          setPhase("countB");
          S.countEnd = performance.now() + 3000;
        } else setPhase(m === "auto" ? "armB" : "readyB");
        break;
    }
  }
  function onRetake() {
    if (S.phase === "armB" || S.phase === "readyB" || S.phase === "countB") {
      // retake A: a new photo A starts the pair again (B is not taken yet)
      S.a = null;
      S.tag = null;
      setPhase(effectiveMode() === "auto" ? "armA" : "countA");
      if (S.phase === "countA") S.countEnd = performance.now() + 3000;
      status("Retaking A.", "");
      log("retake A");
    } else if (S.phase === "ready" && S.lastFinished) {
      // retake B of the pair just saved: it becomes a new take with a new number
      const lf = S.lastFinished;
      S.seq += 1;
      S.tag = { seq: S.seq, key: lf.tag.key, spot: lf.tag.spot };
      S.cur = { key: lf.tag.key, spot: lf.tag.spot };
      S.a = lf.a;
      S.lastFinished = null;
      S.tA = performance.now();
      log("retake B of " + lf.tag.key + ": new take, pair " + S.seq);
      persist();
      setPhase(effectiveMode() === "auto" ? "armB" : "readyB");
      status(
        "Retaking B as pair " + String(S.seq).padStart(2, "0") + " (A kept).",
        "",
      );
    }
  }
  function onNext() {
    if (S.phase === "measure" || S.phase === "off") return;
    S.a = null;
    S.tag = null;
    S.lastFinished = null;
    const from = S.cur;
    S.cur = nextPair(S.cur.key, S.cur.spot);
    if (S.cur.key === from.key && S.cur.spot === from.spot) {
      const idx = PLAN.findIndex((p) => !S.entries[planId(p)]);
      if (idx >= 0) S.cur = PLAN[idx];
    }
    log("skipped to " + S.cur.key + " spot " + S.cur.spot);
    persist();
    setPhase("ready");
    status("Skipped " + from.key + "; it stays missing.", "");
  }
  function pickPair(key, spot) {
    if (S.phase === "measure") return;
    S.cur = { key, spot };
    S.a = null;
    S.tag = null;
    S.lastFinished = null;
    persist();
    if (S.phase !== "off") setPhase("ready");
    setDrawer(false);
    status("Pair " + key + " picked.", "");
  }
  function setDrawer(open, tab) {
    S.drawerOpen = open;
    $("drawer").hidden = !open;
    $("drawerBtn").setAttribute("aria-expanded", String(open));
    if (tab) selectTab(tab);
    motion.stillMs = 0;
    render();
  }
  function selectTab(tab) {
    document
      .querySelectorAll(".tabs [data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.tab === tab)),
      );
    document
      .querySelectorAll(".panel")
      .forEach((p) => (p.hidden = p.dataset.panel !== tab));
  }
  let statusTimer = 0;
  function status(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
    clearTimeout(statusTimer);
  }

  // ---------- the tick: stillness, light gate, countdown ----------
  let lightNow = 0;
  let lastLightAt = 0;
  let last = performance.now();
  let frozen = false;
  function tick(now) {
    const dt = Math.min(200, now - last);
    last = now;
    if (!useVideo) drawRoom();
    if (frozen) return requestAnimationFrame(tick);
    if (motion.fake) {
      if (now < motion.shakeUntil) motion.fakeE = 6 + Math.random() * 6;
      motion.fakeE = Math.max(
        0.15 + Math.random() * 0.2,
        motion.fakeE * Math.pow(0.86, dt / 50),
      );
      motion.energy = motion.fakeE;
    }
    if (motion.energy < 1) motion.stillMs += dt;
    else motion.stillMs = 0;
    if (motion.energy > 3) {
      motion.movedMs += dt;
      if (motion.movedMs > 300) motion.moved = true;
    } else motion.movedMs = Math.max(0, motion.movedMs - dt);
    if (now - lastLightAt > 250 && S.phase !== "off") {
      lastLightAt = now;
      const src = source();
      if (src.w) lightNow = greyMean(src.el);
    }
    step(now);
    renderLive(now);
    requestAnimationFrame(tick);
  }
  /** What B still waits for, or "" once only stillness is missing. */
  function gateB(now) {
    const kind = pairOf().kind;
    if (now - S.tA < 2000) return "settling after photo A";
    if (kind === "light" && S.a) {
      const ratio = lightNow / Math.max(1, S.a.mean);
      if (ratio > 0.8) {
        S.gateSince = 0;
        return (
          "waiting for a darker room (now " +
          Math.round(ratio * 100) +
          "% of A, needs under 80%)"
        );
      }
      if (!S.gateSince) S.gateSince = now;
      if (now - S.gateSince < 2000)
        return "darker - waiting 2 s for the light to settle";
    }
    if (kind === "move" && !motion.moved)
      return "waiting for you to move the phone";
    return "";
  }
  function step(now) {
    if (S.drawerOpen) return; // auto capture pauses while the drawer is open
    if (S.phase === "armA" && motion.stillMs >= HOLD_MS) captureA();
    else if (S.phase === "armB") {
      const g = gateB(now);
      S.gateText = g;
      if (g) motion.stillMs = Math.min(motion.stillMs, 0);
      else if (motion.stillMs >= holdFor()) captureB();
    } else if (
      (S.phase === "countA" || S.phase === "countB") &&
      now >= S.countEnd
    ) {
      if (S.phase === "countA") captureA();
      else captureB();
    }
  }
  const holdFor = () => (pairOf().kind === "move" ? 1500 : HOLD_MS);

  // ---------- rendering ----------
  function renderLive(now) {
    const armed = S.phase === "armA" || (S.phase === "armB" && !S.gateText);
    const p =
      armed && !S.drawerOpen
        ? Math.min(
            1,
            motion.stillMs / (S.phase === "armA" ? HOLD_MS : holdFor()),
          )
        : 0;
    $("meterFg").style.strokeDashoffset = String(289.03 * (1 - p));
    const sr = $("stillRead");
    if (!sensorUsable()) {
      sr.textContent = motion.status === "none" ? "no sensor" : "still: -";
      sr.className = "readout";
    } else if (motion.energy < 1) {
      sr.textContent =
        "still " +
        Math.round(Math.min(1, motion.stillMs / HOLD_MS) * 100) +
        "%";
      sr.className = "readout good";
    } else {
      sr.textContent = "moving";
      sr.className = "readout wait";
    }
    const lr = $("lightRead");
    if (S.a && LIGHT.has(S.cur.key)) {
      const r = lightNow / Math.max(1, S.a.mean);
      lr.textContent = "light " + Math.round(r * 100) + "%";
      lr.className =
        "readout" + (S.cur.key !== "1a" && r <= 0.8 ? " good" : "");
    } else {
      lr.textContent = "light " + Math.round(lightNow);
      lr.className = "readout";
    }
    const count = $("count");
    if ((S.phase === "countA" || S.phase === "countB") && !S.drawerOpen) {
      const left = Math.max(1, Math.ceil((S.countEnd - now) / 1000));
      count.textContent = String(left);
      $("shutterText").textContent = "Tap to stop";
      status(
        "Countdown: photo " +
          (S.phase === "countA" ? "A" : "B") +
          " in " +
          left +
          " s.",
        "",
      );
    } else count.textContent = "";
    if (S.phase === "armB") {
      $("shutterText").textContent = S.drawerOpen
        ? "Paused"
        : S.gateText
          ? "Waiting"
          : "Hold still";
      if (S.gateText && !S.drawerOpen) status("B is " + S.gateText + ".", "");
      else if (!S.drawerOpen) status("Hold still - B takes itself.", "");
    } else if (S.phase === "armA") {
      $("shutterText").textContent = S.drawerOpen ? "Paused" : "Hold still";
    }
  }
  function render() {
    const pair = pairOf();
    const between = ["armB", "readyB", "countB", "measure"].includes(S.phase);
    $("chipKey").textContent = pair.key;
    $("chipLabel").textContent = pair.label;
    $("chipSpot").textContent = LIGHT.has(pair.key) ? "spot " + S.cur.spot : "";
    const done = PLAN.filter(
      (p) => S.entries[planId(p)] && S.entries[planId(p)].status !== "warn",
    ).length;
    $("progressText").textContent = done + " / " + PLAN.length;
    $("segs").innerHTML = PLAN.map((p) => {
      const e = S.entries[planId(p)];
      const cur = p.key === S.cur.key && p.spot === S.cur.spot;
      return '<i class="' + (cur ? "cur" : e ? e.status : "") + '"></i>';
    }).join("");
    const mode = effectiveMode();
    const shortT = SHORT[pair.key];
    let instr;
    if (S.phase === "off")
      instr =
        "Put the phone on its stand, then tap <b>Start</b> to turn the camera on.";
    else if (S.phase === "measure")
      instr =
        "Measuring the pair. The camera is paused; leave the phone where it is.";
    else if (between) instr = "<b>B:</b> " + shortT[1];
    else instr = "<b>A:</b> " + shortT[0];
    $("instr").innerHTML = instr;
    $("changeText").textContent = pair.change;

    // A / B slots
    const a = S.a;
    $("thumbA").hidden = !a;
    if (a) $("thumbA").src = a.thumb;
    $("thumbB").hidden = !S.b;
    if (S.b) $("thumbB").src = S.b.thumb;
    const sa = $("shotA");
    const sb = $("shotB");
    sa.dataset.state = a
      ? "taken"
      : S.phase === "armA" || S.phase === "countA"
        ? "armed"
        : "";
    sb.dataset.state =
      S.phase === "armB" || S.phase === "countB" ? "armed" : "";
    $("stateA").textContent = a
      ? "taken"
      : S.phase === "armA" || S.phase === "countA"
        ? "now"
        : "-";
    $("stateB").textContent =
      S.phase === "armB" || S.phase === "countB"
        ? "now"
        : S.phase === "readyB"
          ? "tap"
          : S.phase === "measure"
            ? "taken"
            : "-";

    // ghost of A while B is being lined up
    const ghost = $("ghost");
    ghost.hidden = !(
      between &&
      a &&
      $("showGhost").checked &&
      S.phase !== "measure"
    );
    if (!ghost.hidden) ghost.src = a.thumb;

    // shutter
    const sh = $("shutter");
    const st = $("shutterText");
    sh.disabled = S.phase === "measure";
    sh.dataset.mode = "";
    if (S.phase === "off") st.textContent = "Start";
    else if (S.phase === "ready")
      st.textContent = mode === "auto" ? "Take A" : "A in 3 s";
    else if (S.phase === "readyB") st.textContent = "B in 3 s";
    else if (S.phase === "measure") {
      st.textContent = "Measuring";
      sh.dataset.mode = "busy";
    }
    if (["armA", "armB", "countA", "countB"].includes(S.phase))
      sh.dataset.mode = "armed";
    if (S.phase === "ready" && done === PLAN.length) {
      st.textContent = "All done";
      sh.dataset.mode = "save";
    }

    // side buttons: fixed size, only label and enabled state change
    const rt = $("retake");
    const rl = $("retakeLabel");
    if (between && S.phase !== "measure") {
      rt.disabled = false;
      rl.textContent = "Retake A";
    } else if (S.phase === "ready" && S.lastFinished) {
      rt.disabled = false;
      rl.textContent =
        "Retake B of " + String(S.lastFinished.tag.seq).padStart(2, "0");
    } else {
      rt.disabled = true;
      rl.textContent = "Retake";
    }
    $("next").disabled = S.phase === "measure" || S.phase === "off";
    $("modeRead").textContent = mode === "auto" ? "auto: still" : "tap, 3 s";
    $("modeRead").className = "readout" + (mode === "auto" ? " good" : "");
    $("saveAll").disabled = kept.size === 0;
    $("saveAll").textContent = kept.size
      ? "Download all (" + kept.size + ")"
      : "Download all";
    $("saveAllDrawer").disabled = kept.size === 0;
    $("saveAllNote").textContent = kept.size
      ? kept.size + " pairs on this page"
      : "nothing kept yet";

    app.classList.toggle(
      "night",
      (pair.key === "1b" || pair.key === "1c") &&
        between &&
        S.phase !== "measure",
    );
    renderDrawer();
  }
  function renderDrawer() {
    const pair = pairOf();
    const rows = PLAN.concat([
      { key: "x", spot: 1 },
      { key: "none", spot: 1 },
    ]).map((p) => {
      const id = PLAN.includes(p) ? planId(p) : p.key;
      const e = S.entries[id];
      const cur = p.key === S.cur.key && p.spot === S.cur.spot;
      const st = e
        ? e.status === "saved"
          ? "saved " + e.name.slice(14, 16)
          : e.status === "kept"
            ? "kept, not downloaded"
            : "light check failed, again"
        : cur
          ? "now"
          : "missing";
      return (
        '<li><button type="button" class="' +
        (cur ? "cur " : "") +
        (e ? "st-" + e.status : "") +
        '" data-key="' +
        p.key +
        '" data-spot="' +
        p.spot +
        '"><b>' +
        p.key +
        "</b><span>" +
        byKey[p.key].label +
        (LIGHT.has(p.key) ? ", spot " + p.spot : "") +
        "</span><small>" +
        st +
        "</small></button></li>"
      );
    });
    $("pairList").innerHTML = rows.join("");
    const done = PLAN.filter(
      (p) => S.entries[planId(p)] && S.entries[planId(p)].status !== "warn",
    ).length;
    $("pairsSummary").textContent =
      done +
      " of " +
      PLAN.length +
      " pairs done, " +
      (PLAN.length - done) +
      " missing. Session " +
      session +
      ".";
    const g = GUIDE[pair.key];
    $("guideTitle").textContent = pair.key + " - " + pair.label;
    $("guidePurpose").textContent = g[0];
    $("guideSteps").innerHTML = "";
    g[1].forEach((s, i) => {
      const li = document.createElement("li");
      li.textContent = s;
      if (i < g[2]) li.className = "strong";
      $("guideSteps").append(li);
    });
    $("guideAvoid").textContent = "Avoid: " + g[3];
    $("guideSpot").hidden = !LIGHT.has(pair.key);
    $("guideSpot").textContent = SPOT_NOTE;
    $("sensorNote").textContent = sensorUsable()
      ? motion.fake
        ? "Motion sensor: faked (prototype switch). Every tap jolts it."
        : "Motion sensor: on. A photo is taken after " +
          HOLD_MS / 1000 +
          " s of stillness."
      : motion.status === "none"
        ? "No motion sensor readings: tap + countdown is used. Check Chrome's site settings, Motion sensors."
        : "Motion sensor: starts with the camera.";
  }

  // Prototype autopilot with the fake sensor: dims the drawn room or "moves" the phone after A.
  function demoAutopilot() {
    if (!motion.fake || params.has("freeze")) return;
    const kind = pairOf().kind;
    if (kind === "light")
      setTimeout(() => {
        fakeRoom.target = S.cur.key === "1c" ? 0.18 : 0.5;
      }, 2600);
    if (kind === "move")
      setTimeout(() => {
        motion.shakeUntil = performance.now() + 1200;
        fakeRoom.rot =
          S.cur.key === "2b"
            ? Math.PI / 2
            : S.cur.key === "2c"
              ? Math.PI
              : S.cur.key === "2d"
                ? 0.6
                : 0;
      }, 2600);
  }

  // ---------- wiring ----------
  $("shutter").addEventListener("click", onShutter);
  $("retake").addEventListener("click", onRetake);
  $("shotA").addEventListener("click", () => {
    if (S.a) onRetake();
  });
  $("shotB").addEventListener("click", () => {
    if (S.phase === "ready" && S.lastFinished) onRetake();
  });
  $("next").addEventListener("click", onNext);
  $("pairChip").addEventListener("click", () =>
    setDrawer(!S.drawerOpen, "pairs"),
  );
  $("progress").addEventListener("click", () =>
    setDrawer(!S.drawerOpen, "pairs"),
  );
  $("drawerBtn").addEventListener("click", () => setDrawer(!S.drawerOpen));
  $("drawerClose").addEventListener("click", () => setDrawer(false));
  $("saveAll").addEventListener("click", downloadAll);
  $("saveAllDrawer").addEventListener("click", downloadAll);
  document
    .querySelectorAll(".tabs [data-tab]")
    .forEach((b) =>
      b.addEventListener("click", () => selectTab(b.dataset.tab)),
    );
  $("pairList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) pickPair(b.dataset.key, Number(b.dataset.spot));
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      S.mode = r.value;
      persist();
      if (S.phase === "armB" && effectiveMode() === "tap") S.phase = "readyB";
      if (S.phase === "readyB" && effectiveMode() === "auto") S.phase = "armB";
      if (S.phase === "armA" || S.phase === "countA") S.phase = "ready";
      render();
    }),
  );
  document.querySelectorAll('input[name="save"]').forEach((r) =>
    r.addEventListener("change", () => {
      S.save = r.value;
      persist();
      render();
    }),
  );
  $("fakeSensor").addEventListener("change", (e) => {
    motion.fake = e.target.checked;
    render();
  });
  $("fakeShake").addEventListener(
    "click",
    () => (motion.shakeUntil = performance.now() + 1500),
  );
  $("fakeDim").addEventListener("click", () => {
    fakeRoom.target =
      fakeRoom.target > 0.9 ? 0.5 : fakeRoom.target > 0.3 ? 0.18 : 1;
    if (fakeRoom.target === 1) fakeRoom.rot = 0;
  });
  $("showGhost").addEventListener("change", render);
  $("resetAll").addEventListener("click", () => {
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
    location.reload();
  });
  $("copyLog").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(logLines.join("\n"));
      $("copyState").textContent = "copied";
    } catch {
      $("copyState").textContent = "copy failed - select the log below";
    }
  });
  $("synthetic").addEventListener(
    "click",
    () => ($("synthState").textContent = "(faked in this prototype)"),
  );
  window.addEventListener("pagehide", () => {
    if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  });

  // ---------- start ----------
  load();
  document.querySelector('input[name="mode"][value="' + S.mode + '"]').checked =
    true;
  document.querySelector('input[name="save"][value="' + S.save + '"]').checked =
    true;
  $("beforeList").innerHTML = BEFORE.map((t) => "<li>" + t + "</li>").join("");
  $("beforeStart").open = !S.welcomed;
  $("welcome").hidden = S.welcomed;
  log(
    "page: session " +
      session +
      ", continuing at pair " +
      (S.seq + 1) +
      " (" +
      S.cur.key +
      ")",
  );
  render();
  status(
    S.welcomed
      ? "Tap Start to turn the camera on."
      : "First time here? Read the card, then tap Start.",
    "",
  );
  requestAnimationFrame(tick);

  // Screenshot states: ?demo=mid (several pairs done, A taken, B half steady), ?drawer=<tab>, ?count=1
  const demo = params.get("demo");
  if (demo) {
    S.welcomed = demo !== "first";
    $("welcome").hidden = S.welcomed;
    if (demo === "mid" || demo === "count") {
      motion.fake = true;
      $("fakeSensor").checked = true;
      for (let i = 0; i < 6; i++)
        S.entries[planId(PLAN[i])] = {
          status: "saved",
          seq: i + 1,
          name: pairName(i + 1, PLAN[i].key, PLAN[i].spot) + ".zip",
        };
      S.seq = 6;
      S.cur = { key: params.get("pair") || "1a", spot: 3 };
      S.phase = "ready";
      drawRoom();
      if (demo === "mid") {
        S.a = grab();
        S.seq = 7;
        S.tag = { seq: 7, key: S.cur.key, spot: LIGHT.has(S.cur.key) ? 3 : 1 };
        if (params.get("pair") === "1b")
          fakeRoom.light = fakeRoom.target = 0.55;
        S.tA = -10000;
        setPhase("armB");
        motion.stillMs = 0.62 * HOLD_MS;
        motion.fakeE = 0.2;
      } else {
        S.a = grab();
        S.seq = 7;
        S.tag = { seq: 7, key: S.cur.key, spot: LIGHT.has(S.cur.key) ? 3 : 1 };
        if (params.get("pair") === "1b")
          fakeRoom.light = fakeRoom.target = 0.55;
        S.tA = -10000;
        S.mode = "tap";
        setPhase("countB");
        S.countEnd = performance.now() + 2500;
      }
      status("Hold still - B takes itself.", "");
      drawRoom();
      lightNow = greyMean(fake);
      frozen = params.has("freeze");
      requestAnimationFrame((t) => {
        renderLive(t);
      });
    }
    if (params.get("drawer")) setDrawer(true, params.get("drawer"));
    render();
    if (frozen) setTimeout(() => renderLive(performance.now()), 50);
  }
})();
