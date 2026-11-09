/* Asset shelf prototype 2: the shelf as its own docked panel at the right
 * edge. Everything is faked: processing runs on timers, sizes are
 * illustrative, nothing is saved. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/* ---------- icons ---------- */
const ICON = {
  sound: '<path d="M2.5 6h2.6L8.5 3v10L5.1 10H2.5z"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.9a5.8 5.8 0 0 1 0 8.2"/>',
  picture: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5"/><circle cx="10.5" cy="6.3" r="1"/>',
  video: '<rect x="2" y="4.5" width="8.5" height="7" rx="1"/><path d="M10.5 7l3.5-2v6l-3.5-2"/>',
  model: '<path d="M8 2l5.5 3v6L8 14l-5.5-3V5z"/><path d="M2.5 5L8 8l5.5-3M8 8v6"/>',
  unknown: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>',
  text: '<path d="M3 4h10M3 7h10M3 10h7"/>',
  story: '<path d="M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8.5a1.2 1.2 0 0 0-1.2-1.2H2.5z"/><path d="M13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8.5a1.2 1.2 0 0 1 1.2-1.2h4.3z"/>',
  station: '<circle cx="8" cy="7" r="3"/><path d="M8 14s-4.5-4-4.5-7a4.5 4.5 0 0 1 9 0c0 3-4.5 7-4.5 7z"/>',
  shelf: '<path d="M2 5.5l6-3 6 3-6 3z"/><path d="M2 5.5v5l6 3 6-3v-5M8 8.5v5"/>',
  chevR: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  chevL: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  retry: '<path d="M12.6 8.4a4.6 4.6 0 1 1-1.4-3.6"/><path d="M12.4 2.6v2.6H9.8"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  alert: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3.5M8 12v.1"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  jump: '<path d="M4.5 11.5l7-7M6 4.5h5.5V10"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 12.5h10"/>',
  back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  play: '<path d="M5.5 3.5l7 4.5-7 4.5z"/>',
};
const ic = (n, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 16 16" aria-hidden="true">${ICON[n] || ICON.unknown}</svg>`;

/* ---------- what each kind becomes ---------- */
const MB = 1024 * 1024;
const KINDS = {
  sound: {
    label: "Sound",
    plural: "Sounds",
    ratio: 0.08,
    ms: 6000,
    target: "AAC, 96 kbps, mono",
    exts: ["wav", "mp3", "m4a", "aac", "ogg", "flac", "aif", "aiff", "opus"],
    phases: [
      ["Reading the sound", 0.15],
      ["Converting to AAC, 96 kbps", 0.85],
    ],
  },
  picture: {
    label: "Picture",
    plural: "Pictures",
    ratio: 0.15,
    ms: 3500,
    target: "JPEG, quality 82, at most 2048 px on its long side",
    exts: ["jpg", "jpeg", "png", "webp", "heic", "gif", "avif"],
    phases: [
      ["Reading the picture", 0.2],
      ["Resizing to 2048 px", 0.5],
      ["Saving as JPEG, quality 82", 0.3],
    ],
  },
  video: {
    label: "Video",
    plural: "Videos",
    ratio: 0.195,
    ms: 14000,
    target: "H.264, 1280 px wide, 2 Mbit/s",
    exts: ["mp4", "mov", "webm", "m4v"],
    phases: [
      ["Reading the video", 0.1],
      ["Converting to H.264, 1280 px", 0.9],
    ],
  },
  model: {
    label: "3D model",
    plural: "Models",
    ratio: 0.244,
    ms: 10000,
    target: "fewer triangles, textures at most 1024 px",
    exts: ["glb", "gltf"],
    phases: [
      ["Reading the model", 0.1],
      ["Removing 60 % of the triangles", 0.5],
      ["Making the textures smaller", 0.4],
    ],
  },
};
const MAX_PARALLEL = 2;

const fmt = (bytes) =>
  bytes >= MB
    ? `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
const baseOf = (name) => name.replace(/\.[^.]+$/, "");
const kindOf = (name) => {
  const e = extOf(name);
  return Object.keys(KINDS).find((k) => KINDS[k].exts.includes(e)) || null;
};
const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

/* ---------- sample thumbnails, drawn once ---------- */
function drawThumb(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 84;
  const g = c.getContext("2d");
  if (!g) return null;
  if (kind === "picture") {
    const sky = g.createLinearGradient(0, 0, 0, 84);
    sky.addColorStop(0, "#f3b46b");
    sky.addColorStop(1, "#8b5a6b");
    g.fillStyle = sky;
    g.fillRect(0, 0, 84, 84);
    g.fillStyle = "#fbe3a8";
    g.beginPath();
    g.arc(58, 30, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#4b3b4f";
    g.fillRect(14, 34, 18, 50);
    g.beginPath();
    g.moveTo(10, 36);
    g.lineTo(23, 18);
    g.lineTo(36, 36);
    g.fill();
    g.fillStyle = "#3a2e40";
    g.fillRect(0, 62, 84, 22);
  } else if (kind === "video") {
    const bg = g.createLinearGradient(0, 0, 84, 84);
    bg.addColorStop(0, "#3d5a78");
    bg.addColorStop(1, "#1f2b3a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 84, 84);
    g.fillStyle = "#6d8fb3";
    g.fillRect(0, 50, 84, 34);
    g.fillStyle = "#2a3a4c";
    for (let i = 0; i < 6; i++) g.fillRect(i * 15, 40 - (i % 3) * 6, 10, 14 + (i % 3) * 6);
  } else return null;
  return c.toDataURL("image/png");
}
const SAMPLE_THUMB = { picture: drawThumb("picture"), video: drawThumb("video") };

function thumbHtml(a, extra = "") {
  const k = a.kind || "unknown";
  const img = a.thumb ? ` has-img" style="background-image:url('${a.thumb}')` : "";
  const play = a.kind === "video" && a.thumb ? ic("play", "play") : "";
  return `<span class="thumb k-${k}${img}" ${extra}>${ic(k)}${play}</span>`;
}

/* ---------- the tour (a small mock tree) ---------- */
const stations = [
  {
    id: "s1", t: "station", n: 1, name: "Market Gate", radius: 15, open: true,
    desc: "Where the old town begins, under the clock arch.",
    kids: [
      { id: "i1", t: "item", kind: "text", name: "Welcome", text: "Welcome to the old town. Look up at the arch." },
      { id: "i2", t: "item", kind: "picture", name: "The gate in 1890", asset: null },
    ],
  },
  {
    id: "s2", t: "station", n: 2, name: "Old Bell Tower", radius: 20, open: true,
    desc: "The tower rang for every fire in the town.",
    kids: [
      {
        id: "g1", t: "story", name: "The bell's story", open: true,
        kids: [
          { id: "i3", t: "item", kind: "text", name: "Step 1: Look up", text: "The bell hangs behind the left window." },
          { id: "i4", t: "item", kind: "sound", name: "Step 2: The bell rings", asset: null },
        ],
      },
      { id: "i5", t: "item", kind: "text", name: "Opening hours", text: "Open from April to October." },
    ],
  },
  {
    id: "s3", t: "station", n: 3, name: "River Steps", radius: 12, open: true,
    desc: "The steps down to where the boats once landed.",
    kids: [
      { id: "i6", t: "item", kind: "model", name: "The old ferry", asset: null },
      { id: "i7", t: "item", kind: "video", name: "The flood of 1910", asset: null },
    ],
  },
];
const PIN_AT = { s1: [0.3, 0.33], s2: [0.52, 0.52], s3: [0.7, 0.72] };
let nextNode = 100;

function walk(fn) {
  for (const st of stations) {
    fn(st, null, null);
    for (const k of st.kids) {
      fn(k, st, null);
      if (k.t === "story") for (const e of k.kids) fn(e, st, k);
    }
  }
}
function find(id) {
  let hit = null;
  walk((n, st, story) => {
    if (n.id === id) hit = { node: n, st, story };
  });
  return hit;
}
function pathOf(id) {
  const h = find(id);
  if (!h) return "";
  const parts = [];
  if (h.st) parts.push(`${h.st.n} ${h.st.name}`);
  if (h.story) parts.push(h.story.name);
  parts.push(h.node.t === "station" ? `${h.node.n} ${h.node.name}` : h.node.name);
  return parts.join(" › ");
}
function usesOf(aid) {
  const out = [];
  walk((n) => {
    if (n.t === "item" && n.asset === aid) out.push(n);
  });
  return out;
}

/* ---------- the assets ---------- */
const assets = [];
let nextAsset = 1;
let nextSeq = 1;
let sampleRound = 0;

/* A drop's files land on top of the shelf in the order they were dropped,
 * and are optimized in that order (`seq`), after the files dropped before. */
function addBatch(specs) {
  const base = nextSeq;
  nextSeq += specs.length;
  const added = [];
  for (let i = specs.length - 1; i >= 0; i--) added.unshift(addAsset({ ...specs[i], seq: base + i }));
  return added;
}
const bySeq = (list) => [...list].sort((x, y) => x.seq - y.seq);

function addAsset({ name, size, thumb = null, failOnce = false, seq }) {
  const kind = kindOf(name);
  const a = {
    id: "a" + nextAsset++,
    seq,
    name,
    kind,
    ext: extOf(name).toUpperCase() || "FILE",
    before: size,
    after: kind ? Math.round(size * KINDS[kind].ratio) : size,
    state: kind ? "queued" : "failed",
    progress: 0,
    elapsed: 0,
    failOnce,
    retryable: !!kind,
    reason: kind
      ? ""
      : `This kind of file cannot go into a tour (.${extOf(name) || "?"}). Sounds, pictures, videos and 3D models can.`,
    thumb,
    fresh: true,
  };
  assets.unshift(a);
  return a;
}
const assetById = (id) => assets.find((a) => a.id === id);

function phaseOf(a) {
  if (!a.kind) return "";
  let acc = 0;
  for (const [label, share] of KINDS[a.kind].phases) {
    acc += share;
    if (a.progress < acc) return label;
  }
  return KINDS[a.kind].phases.at(-1)[0];
}
function queuePos(a) {
  return bySeq(assets.filter((x) => x.state === "queued")).indexOf(a);
}

/* ---------- ui state ---------- */
const ui = {
  sel: null,
  folded: false,
  filter: "all",
  openCard: null,
  confirm: null,
  sheet: "list", // phone: "list" | "assets"
  speed: 1,
  dirty: false,
};
try {
  ui.folded = localStorage.getItem("asset-shelf-2-folded") === "1";
} catch {
  /* a private window: start open */
}

/* ---------- processing (faked) ---------- */
let last = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min(500, now - last) * ui.speed;
  last = now;
  let changed = false;
  const running = assets.filter((a) => a.state === "processing");
  for (const a of bySeq(assets)) {
    if (running.length >= MAX_PARALLEL) break;
    if (a.state === "queued") {
      a.state = "processing";
      a.elapsed = 0;
      running.push(a);
      changed = true;
    }
  }
  for (const a of running) {
    a.elapsed += dt;
    a.progress = Math.min(1, a.elapsed / KINDS[a.kind].ms);
    if (a.failOnce && a.progress >= 0.58) {
      a.failOnce = false;
      a.state = "failed";
      a.reason =
        "This browser cannot read the video's format (HEVC). Retry, or export it as H.264 first.";
      changed = true;
      const n = usesOf(a.id).length;
      toast(`${a.name} could not be optimized.${n ? " The original is used until it is." : ""}`, "Show", () => revealCard(a.id));
    } else if (a.progress >= 1) {
      a.state = "ready";
      a.original = true;
      changed = true;
      onReady(a);
    }
  }
  if (changed) renderAll();
  else live();
}
setInterval(tick, 100);

function onReady(a) {
  /* Said only where it changes something the author placed; the shelf
   * itself shows every other file turning ready. */
  const n = usesOf(a.id).length;
  if (n)
    toast(
      `${a.name} is optimized (${fmt(a.before)} → ${fmt(a.after)}) and replaced the original in ${n === 1 ? "1 place" : n + " places"}.`,
    );
  const cur = ui.sel && find(ui.sel);
  if (cur && cur.node.asset === a.id) ui.pulse = true;
}

/* Back to the original: it is in the draft until the next save lands. */
function useOriginal(aid) {
  const a = assetById(aid);
  if (!a || a.state !== "ready" || !a.original) return;
  a.state = "kept";
  a.original = false;
  markDirty();
  renderAll();
  toast(`${a.name}: the original (${fmt(a.before)}) is used again.`);
}

/* Only on request: the opened tour's files join the queue. */
function optimizeTour() {
  const idle = bySeq(assets.filter((a) => a.state === "idle"));
  for (const a of idle) {
    a.state = "queued";
    a.seq = nextSeq++;
  }
  renderAll();
  if (idle.length) toast(`${idle.length === 1 ? "1 file" : idle.length + " files"} of the tour queued to be made smaller.`);
}

function retry(aid) {
  const a = assetById(aid);
  if (!a || !a.retryable) return;
  a.state = "queued";
  a.progress = 0;
  a.elapsed = 0;
  a.reason = "";
  renderAll();
}

/* ---------- rendering ---------- */
function stateLine(a) {
  if (a.state === "queued") {
    const p = queuePos(a);
    return `<div class="cstate queued">${ic("clock")}<span>Queued${p > 0 ? `, ${p} before it` : ", next"}</span></div>`;
  }
  if (a.state === "processing") {
    const pc = Math.round(a.progress * 100);
    return `<div class="cstate processing"><span class="ph">${esc(phaseOf(a))}</span><span class="pc">${pc} %</span>
      <span class="bar" role="progressbar" aria-label="Optimizing ${esc(a.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}"><i style="width:${pc}%"></i></span></div>`;
  }
  if (a.state === "ready") {
    const gain = Math.round((1 - a.after / a.before) * 100);
    return `<div class="cstate ready">${ic("check")}<span class="sz">${fmt(a.before)} → ${fmt(a.after)}</span><span class="gain">-${gain} %</span></div>`;
  }
  /* A file of the opened tour waits for "Optimize this tour"; one whose
   * original was chosen again keeps its first size. */
  if (a.state === "idle") {
    return `<div class="cstate idle">${ic("clock")}<span>In the tour, not made smaller</span></div>`;
  }
  if (a.state === "kept") {
    return `<div class="cstate kept">${ic("check")}<span>The original is used</span><span class="sz">${fmt(a.before)}</span></div>`;
  }
  return `<div class="cstate failed">${ic("alert")}<span>${a.retryable ? "Not optimized" : "Cannot be used"}</span>
    ${a.retryable ? `<button class="btn sm" type="button" data-act="retry">${ic("retry")}Retry</button>` : ""}
    <span class="why">${esc(a.reason)}</span></div>`;
}

function cardHtml(a) {
  const uses = usesOf(a.id);
  const n = uses.length;
  const usesBtn = n
    ? `<button class="uses" type="button" data-act="uses" title="Where it is used">Used in ${n}</button>`
    : `<span class="uses zero">Not used</span>`;
  const k = a.kind ? KINDS[a.kind] : null;
  let more = "";
  if (ui.confirm === a.id) {
    more = `<div class="cconfirm" role="alertdialog" aria-label="Delete ${esc(a.name)}">
      <b>Delete ${esc(a.name)}?</b> It is used in ${n === 1 ? "1 place" : n + " places"}; their file fields become empty.
      <ul>${uses.map((u) => `<li>${esc(pathOf(u.id))}</li>`).join("")}</ul>
      <div class="btnrow"><button class="btn danger" type="button" data-act="delyes">${ic("trash")}Delete</button>
      <button class="btn" type="button" data-act="delno">Keep it</button></div></div>`;
  } else if (ui.openCard === a.id) {
    const what = !k
      ? "Only sounds, pictures, videos and 3D models go into a tour."
      : a.state === "ready"
        ? `Optimized to ${esc(k.target)}. The original is kept until the next save, so you can still go back to it.`
        : a.state === "idle"
          ? `Part of the opened tour. "Optimize this tour" makes it smaller, about ${fmt(a.after)}.`
          : a.state === "kept"
            ? `The original (${fmt(a.before)}) is used; it is not made smaller again.`
            : `Becomes ${esc(k.target)}, about ${fmt(a.after)}. Until then the original (${fmt(a.before)}) is used.`;
    more = `<div class="cmore">${what}
      <div class="btnrow">${k ? `<button class="btn" type="button" data-act="usein">${ic("plus")}Use in...</button>` : ""}
      ${a.state === "ready" && a.original ? `<button class="btn" type="button" data-act="useorig">${ic("back")}Use the original</button>` : ""}
      ${n ? `<button class="btn" type="button" data-act="uses">${ic("jump")}Show where</button>` : ""}</div></div>`;
  }
  return `<div class="card ${a.state}${ui.openCard === a.id ? " open" : ""}${a.fresh ? " new" : ""}" data-aid="${a.id}" role="listitem">
    <div class="crow" data-act="toggle" tabindex="0" aria-expanded="${ui.openCard === a.id}" title="${k ? "Drag onto a station, a story or an item; click for more" : ""}">
      ${thumbHtml(a, 'data-grip="1"')}
      <div class="cmain"><div class="ctop"><span class="cname" title="${esc(a.name)}">${esc(a.name)}</span>${usesBtn}</div>
        <div class="ckind">${k ? k.label : "Unknown"} · ${esc(a.ext)} · ${fmt(a.before)}</div>
        ${stateLine(a)}</div>
      <div class="cside"><button class="ib del" type="button" data-act="del" title="Delete" aria-label="Delete ${esc(a.name)}">${ic("trash")}</button></div>
    </div>${more}</div>`;
}

function summaryHtml() {
  if (!assets.length) return "Nothing on the shelf yet.";
  const idle = assets.filter((a) => a.state === "idle").length;
  const optour = idle
    ? `<span class="optour"><span>${idle === 1 ? "1 file" : idle + " files"} of the opened tour ${idle === 1 ? "is" : "are"} not made smaller.</span>
      <button class="btn sm" type="button" data-act="optour">Optimize this tour</button></span>`
    : "";
  const busy = assets.filter((a) => a.state === "processing" || a.state === "queued");
  const failed = assets.filter((a) => a.state === "failed").length;
  const before = assets.reduce((s, a) => s + a.before, 0);
  const after = assets.reduce((s, a) => s + (a.state === "ready" ? a.after : a.before), 0);
  if (busy.length) {
    const tot = busy.reduce((s, a) => s + a.progress, 0) / busy.length;
    return `<b>Optimizing ${busy.length} of ${assets.length}</b>, you can keep working.${failed ? ` <span style="color:var(--danger)">${failed} failed.</span>` : ""}
      <span class="bar" id="sumBar"><i style="width:${Math.round(tot * 100)}%"></i></span>${optour}`;
  }
  const gain = Math.round((1 - after / before) * 100);
  const ready = assets.filter((a) => a.state === "ready" || a.state === "kept").length;
  return `<b>${ready} ready</b>${failed ? `, <span style="color:var(--danger)">${failed} failed</span>` : ""}. A phone downloads <span class="save">${fmt(after)}</span> instead of ${fmt(before)}${gain > 0 ? ` (-${gain} %)` : ""}.${optour}`;
}

function renderShelf() {
  $("#shelfCount").textContent = assets.length ? String(assets.length) : "";
  $("#shelfSum").innerHTML = summaryHtml();
  const counts = { all: assets.length };
  for (const k of Object.keys(KINDS)) counts[k] = assets.filter((a) => a.kind === k).length;
  $("#shelfChips").innerHTML = [["all", "All"], ...Object.keys(KINDS).map((k) => [k, KINDS[k].plural])]
    .filter(([k]) => k === "all" || counts[k])
    .map(([k, l]) => `<button class="chip${ui.filter === k ? " on" : ""}" type="button" data-filter="${k}" aria-pressed="${ui.filter === k}">${l}<span class="cn">${counts[k]}</span></button>`)
    .join("");
  $("#shelfChips").hidden = assets.length < 2;
  const list = assets.filter((a) => ui.filter === "all" || a.kind === ui.filter);
  $("#shelfList").innerHTML = assets.length
    ? list.map(cardHtml).join("")
    : `<div class="empty">${ic("upload", "big")}<div>Drop sounds, pictures, videos or 3D models anywhere on the page.</div>
       <div class="btnrow"><button class="btn" type="button" data-act="add">${ic("upload")}Add files...</button>
       <button class="btn" type="button" data-act="sim">Simulate drop</button></div></div>`;
  for (const a of assets) a.fresh = false;
  renderRail();
}

const RING_C = 2 * Math.PI * 11;
function renderRail() {
  const open = assets.filter((a) => a.state !== "ready" && a.state !== "idle" && a.state !== "kept");
  const show = open.slice(0, 7);
  const rest = open.length - show.length;
  const busy = assets.filter((a) => a.state === "processing" || a.state === "queued").length;
  const failed = assets.filter((a) => a.state === "failed").length;
  const badge = failed
    ? `<span class="badge bad">${failed}</span>`
    : busy
      ? `<span class="badge">${busy}</span>`
      : "";
  $("#rail").innerHTML = `
    <button class="ib" type="button" data-act="unfold" title="Open the asset shelf" aria-label="Open the asset shelf">${ic("chevL")}</button>
    <span class="rhead"><button class="ib" type="button" data-act="unfold" title="${assets.length} assets" aria-label="Open the asset shelf">${ic("shelf")}</button>${badge}</span>
    <span class="rlabel">Assets</span>
    <div class="rings">${show
      .map((a) => {
        const p = a.state === "failed" ? 1 : a.progress;
        const tip = a.state === "failed" ? `${a.name}: not optimized` : a.state === "queued" ? `${a.name}: queued` : `${a.name}: ${Math.round(p * 100)} %`;
        return `<button class="ring ${a.state}" type="button" data-rid="${a.id}" title="${esc(tip)}" aria-label="${esc(tip)}">
          <svg class="rg" viewBox="0 0 28 28" aria-hidden="true"><circle class="bg" cx="14" cy="14" r="11"/>${a.state === "failed" ? "" : `<circle class="fg" cx="14" cy="14" r="11" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C * (1 - p)}"/>`}</svg>${ic(a.kind || "unknown")}</button>`;
      })
      .join("")}${rest > 0 ? `<span class="rmore">+${rest}</span>` : ""}
      ${!show.length && assets.length ? `<span class="ring ready" title="All ready">${ic("check")}</span>` : ""}</div>`;
}

function rowHtml(n, d, _st) {
  const sel = ui.sel === n.id ? " sel" : "";
  if (n.t === "station") {
    return `<div class="row st${sel}" style="--d:${d}" data-id="${n.id}" data-drop="station" role="treeitem" aria-expanded="${n.open}" aria-selected="${!!sel}">
      <button class="tw${n.open ? " open" : ""}" type="button" data-fold="${n.id}" aria-label="Fold">${ic("chevR")}</button>
      <span class="sbadge">${n.n}</span><span class="nm">${esc(n.name)}</span><span class="meta">${n.kids.length}</span></div>`;
  }
  if (n.t === "story") {
    return `<div class="row${sel}" style="--d:${d}" data-id="${n.id}" data-drop="story" role="treeitem" aria-expanded="${n.open}" aria-selected="${!!sel}">
      <button class="tw${n.open ? " open" : ""}" type="button" data-fold="${n.id}" aria-label="Fold">${ic("chevR")}</button>
      <span class="ti story">${ic("story")}</span><span class="nm">${esc(n.name)}</span><span class="meta">${n.kids.length}</span></div>`;
  }
  let mark = "";
  if (n.kind !== "text") {
    const a = n.asset && assetById(n.asset);
    if (!a) mark = `<span class="meta none">no file</span>`;
    else if (a.state === "processing") mark = `<span class="mk" data-mk="${a.id}" title="Being optimized, the original is used until then"><span class="spin"></span><span class="mkp">${Math.round(a.progress * 100)}%</span></span>`;
    else if (a.state === "queued") mark = `<span class="mk queued" title="Waiting to be optimized, the original is used until then">${ic("clock")}</span>`;
    else if (a.state === "failed") mark = `<span class="mk failed" title="Not optimized: the original is used">${ic("alert")}</span>`;
    else mark = `<span class="meta">${fmt(a.after)}</span>`;
  }
  const drop = n.kind !== "text" ? ` data-drop="item" data-kind="${n.kind}"` : "";
  return `<div class="row${sel}" style="--d:${d}" data-id="${n.id}"${drop} role="treeitem" aria-selected="${!!sel}">
    <span class="tw none"></span><span class="ti">${ic(n.kind)}</span><span class="nm">${esc(n.name)}</span>${mark}</div>`;
}

function renderTree() {
  const out = [];
  for (const st of stations) {
    out.push(rowHtml(st, 0));
    if (!st.open) continue;
    for (const k of st.kids) {
      out.push(rowHtml(k, 1, st));
      if (k.t === "story" && k.open) for (const e of k.kids) out.push(rowHtml(e, 2, st));
    }
  }
  $("#rows").innerHTML = out.join("");
  $("#stCount").textContent = String(stations.length);
  $("#pins").innerHTML = stations
    .map((st) => {
      const [x, y] = PIN_AT[st.id];
      const on = ui.sel === st.id || (ui.sel && find(ui.sel)?.st === st);
      return `<button class="pin${on ? " sel" : ""}" type="button" data-pin="${st.id}" style="left:${x * 100}%;top:${y * 100}%"><span class="badge">${st.n}</span>${esc(st.name)}</button>`;
    })
    .join("");
}

/* The inspector: drawn whole on a new selection only, so a field being
 * typed in keeps its focus; the file block alone follows the asset. */
function renderInsp() {
  const el = $("#insp");
  const h = ui.sel && find(ui.sel);
  document.body.classList.toggle("hasSel", !!h);
  if (!h) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  const n = h.node;
  const icon = n.t === "station" ? "station" : n.t === "story" ? "story" : n.kind;
  let body;
  if (n.t === "station") {
    body = `<div class="sec"><div class="f"><label for="fName">Name</label><input class="tfield" id="fName" value="${esc(n.name)}"></div>
      <div class="f top"><label for="fDesc">Description</label><textarea class="tfield" id="fDesc">${esc(n.desc)}</textarea></div>
      <div class="sech">Place</div>
      <div class="f"><label for="fRad">Radius</label><span class="range"><input type="range" id="fRad" min="5" max="60" value="${n.radius}"><span class="rv" id="fRadV">${n.radius} m</span></span></div>
      <p class="note">Drop an asset from the shelf on this station's row to add it as a new item.</p></div>`;
  } else if (n.t === "story") {
    body = `<div class="sec"><div class="f"><label for="fName">Name</label><input class="tfield" id="fName" value="${esc(n.name)}"></div>
      <p class="note">${n.kids.length} steps. Drop a sound, a picture, a video or a model on the story's row to add a step that shows it.</p></div>`;
  } else if (n.kind === "text") {
    body = `<div class="sec"><div class="f"><label for="fName">Name</label><input class="tfield" id="fName" value="${esc(n.name)}"></div>
      <div class="f top"><label for="fText">Text</label><textarea class="tfield" id="fText">${esc(n.text || "")}</textarea></div></div>`;
  } else {
    body = `<div class="sec"><div class="f"><label for="fName">Name</label><input class="tfield" id="fName" value="${esc(n.name)}"></div>
      <div class="sech">${KINDS[n.kind].label} file</div><div id="fileBlock"></div></div>`;
  }
  el.innerHTML = `<div class="phead">
      <button class="ib phoneOnly" type="button" data-act="back" title="Back to the list" aria-label="Back to the list">${ic("back")}</button>
      <span class="hic">${ic(icon)}</span><span class="htitle" id="inspTitle">${esc(n.t === "station" ? `${n.n} ${n.name}` : n.name)}</span>
      <button class="ib hideS" type="button" data-act="desel" title="Close" aria-label="Close">${ic("close")}</button></div>
    <div class="crumb">${esc(pathOf(n.id))}</div><div class="pbody">${body}</div>`;
  renderFileBlock();
}

function renderFileBlock() {
  const fb = $("#fileBlock");
  if (!fb) return;
  const n = find(ui.sel).node;
  const a = n.asset && assetById(n.asset);
  fb.dataset.aid = a ? a.id : "";
  if (!a) {
    fb.innerHTML = `<button class="filefield empty" type="button" data-act="pick" data-drop="field" data-kind="${n.kind}" data-id="${n.id}">
      <span class="thumb k-${n.kind}">${ic(n.kind)}</span><span class="ffm"><span class="ffn">Choose a ${KINDS[n.kind].label.toLowerCase()}...</span>
      <span class="ffs">from the shelf, or drop one here</span></span></button>`;
    return;
  }
  let st;
  if (a.state === "processing" || a.state === "queued") {
    const pc = Math.round(a.progress * 100);
    st = `<div class="fstate"><div class="fsh"><span class="spin"></span>Still being optimized${a.state === "queued" ? " (queued)" : `, <span class="fpc">${pc} %</span>`}</div>
      <p>The original file (${fmt(a.before)}) is used until then. The optimized one (about ${fmt(a.after)}) replaces it on its own.</p>
      <span class="bar"><i style="width:${pc}%"></i></span></div>`;
  } else if (a.state === "ready") {
    const gain = Math.round((1 - a.after / a.before) * 100);
    st = `<div class="fstate ready${ui.pulse ? " pulse" : ""}"><div class="fsh">${ic("check")}Optimized</div>
      <p>A phone downloads ${fmt(a.after)} instead of ${fmt(a.before)} (-${gain} %).</p></div>`;
    ui.pulse = false;
  } else {
    st = `<div class="fstate failed"><div class="fsh">${ic("alert")}Not optimized</div><p>${esc(a.reason)}</p>
      <p>The original (${fmt(a.before)}) is used, and a phone downloads all of it.</p>
      <div class="btnrow"><button class="btn sm" type="button" data-act="retryf">${ic("retry")}Retry</button></div></div>`;
  }
  fb.innerHTML = `<button class="filefield" type="button" data-act="pick" data-drop="field" data-kind="${n.kind}" data-id="${n.id}" title="Choose another file">
      ${thumbHtml(a)}<span class="ffm"><span class="ffn">${esc(a.name)}</span><span class="ffs">${KINDS[a.kind].label} · ${a.state === "ready" ? fmt(a.after) : fmt(a.before)}</span></span>${ic("chevR")}</button>
    ${st}<div class="btnrow"><button class="lnk" type="button" data-act="reveal">Show on the shelf</button></div>`;
}

function renderChrome() {
  const phone = isPhone();
  const shelfEl = $("#shelf");
  const folded = ui.folded && !phone;
  shelfEl.classList.toggle("folded", folded);
  document.body.classList.toggle("shelfFolded", folded);
  $("#shelfFold").setAttribute("aria-expanded", String(!folded));
  for (const s of ["list", "assets"]) document.body.classList.toggle("sheet-" + s, ui.sheet === s);
  const busy = assets.filter((a) => a.state === "processing" || a.state === "queued").length;
  const failed = assets.filter((a) => a.state === "failed").length;
  for (const id of ["#togBadge", "#assetsBtnBadge"]) {
    const b = $(id);
    b.hidden = !busy && !failed;
    b.textContent = String(failed || busy);
    b.classList.toggle("bad", !!failed);
  }
  $("#assetsTog").setAttribute("aria-pressed", String(phone ? ui.sheet === "assets" : !ui.folded));
  const pill = $("#phonePill");
  pill.hidden = !phone || ui.sheet === "assets" || (!busy && !failed);
  pill.classList.toggle("bad", !!failed && !busy);
  pill.innerHTML = busy
    ? `<span class="spin"></span><span id="pillTx">Optimizing ${busy} ${busy === 1 ? "file" : "files"}</span>`
    : `${ic("alert")}${failed} not optimized`;
  $("#unsaved").hidden = !ui.dirty;
  $("#saveState").textContent = ui.dirty ? "Not saved" : "No changes";
}

function renderAll() {
  renderShelf();
  renderTree();
  renderFileBlock();
  renderChrome();
}

/* Between state changes only the numbers move: the bars, the rings, the
 * marks, so nothing that has the focus is drawn again. */
function live() {
  for (const a of assets) {
    if (a.state !== "processing") continue;
    const pc = Math.round(a.progress * 100);
    const card = $(`.card[data-aid="${a.id}"]`);
    if (card) {
      const bar = $(".bar", card);
      bar.firstElementChild.style.width = pc + "%";
      bar.setAttribute("aria-valuenow", String(pc));
      $(".pc", card).textContent = pc + " %";
      $(".ph", card).textContent = phaseOf(a);
    }
    const fg = $(`.ring[data-rid="${a.id}"] .fg`);
    if (fg) fg.setAttribute("stroke-dashoffset", String(RING_C * (1 - a.progress)));
    const ring = $(`.ring[data-rid="${a.id}"]`);
    if (ring) ring.title = `${a.name}: ${pc} %`;
    for (const mk of $$(`[data-mk="${a.id}"] .mkp`)) mk.textContent = pc + "%";
    const fb = $("#fileBlock");
    if (fb && fb.dataset.aid === a.id) {
      const i = $(".fstate .bar i", fb);
      if (i) i.style.width = pc + "%";
      const f = $(".fpc", fb);
      if (f) f.textContent = pc + " %";
    }
  }
  const busy = assets.filter((a) => a.state === "processing" || a.state === "queued");
  const sb = $("#sumBar i");
  if (sb && busy.length) sb.style.width = Math.round((busy.reduce((s, a) => s + a.progress, 0) / busy.length) * 100) + "%";
}

/* ---------- actions ---------- */
function select(id, { scroll = false } = {}) {
  ui.sel = id;
  if (id) {
    const h = find(id);
    if (h?.st) h.st.open = true;
    if (h?.story) h.story.open = true;
    if (isPhone()) ui.sheet = "list";
  }
  renderTree();
  renderInsp();
  renderChrome();
  if (id && scroll) {
    const row = $(`.row[data-id="${id}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      row.classList.add("flash");
    }
  }
}

function markDirty() {
  ui.dirty = true;
  renderChrome();
}

/* Puts an asset where it was dropped or chosen: a station gets a new item
 * of its kind, a story a new step, an item (of the same kind) the file. */
function useAsset(aid, target) {
  const a = assetById(aid);
  if (!a || !a.kind) {
    toast("This file cannot go into a tour.");
    return;
  }
  const h = find(target.id);
  if (!h) return;
  const node = h.node;
  let itemId;
  if (node.t === "station" || node.t === "story") {
    const item = {
      id: "n" + nextNode++,
      t: "item",
      kind: a.kind,
      name: node.t === "story" ? `Step ${node.kids.length + 1}: ${baseOf(a.name)}` : `${KINDS[a.kind].label}: ${baseOf(a.name)}`,
      asset: aid,
    };
    node.kids.push(item);
    node.open = true;
    itemId = item.id;
  } else if (node.t === "item" && node.kind === a.kind) {
    node.asset = aid;
    itemId = node.id;
  } else {
    toast(`A ${KINDS[a.kind].label.toLowerCase()} cannot go into this ${node.kind} item.`);
    return;
  }
  ui.confirm = null;
  markDirty();
  renderShelf();
  select(itemId, { scroll: true });
  const where = pathOf(itemId);
  const msg =
    a.state === "ready"
      ? `${a.name} is in ${where}.`
      : a.state === "failed"
        ? `${a.name} is in ${where}; it is not optimized, the original is used.`
        : `${a.name} is in ${where}. Still being optimized; the original is used until then.`;
  toast(msg);
}

function deleteAsset(aid) {
  const a = assetById(aid);
  if (!a) return;
  const users = usesOf(aid);
  for (const u of users) u.asset = null;
  const at = assets.indexOf(a);
  assets.splice(at, 1);
  ui.confirm = null;
  if (ui.openCard === aid) ui.openCard = null;
  if (users.length) markDirty();
  renderAll();
  renderInsp();
  toast(`${a.name} deleted${users.length ? `, removed from ${users.length === 1 ? "1 place" : users.length + " places"}` : ""}.`, "Undo", () => {
    assets.splice(at, 0, a);
    for (const u of users) u.asset = aid;
    renderAll();
    renderInsp();
  });
}

function setFolded(f) {
  ui.folded = f;
  try {
    localStorage.setItem("asset-shelf-2-folded", f ? "1" : "0");
  } catch {
    /* not kept */
  }
  renderChrome();
}

function revealCard(aid) {
  if (isPhone()) ui.sheet = "assets";
  else if (ui.folded) setFolded(false);
  if (ui.filter !== "all") ui.filter = "all";
  ui.openCard = aid;
  renderShelf();
  renderChrome();
  const c = $(`.card[data-aid="${aid}"]`);
  if (c) {
    c.scrollIntoView({ block: "nearest" });
    c.classList.add("flash");
  }
}

function addFiles(files) {
  const added = addBatch(
    files.map((f) => ({
      name: f.name,
      size: f.size || 1,
      thumb:
        kindOf(f.name) === "picture" && /^image\/(jpeg|png|webp|gif|avif)$/.test(f.type)
          ? URL.createObjectURL(f)
          : null,
    })),
  );
  afterAdd(added);
  return added;
}

function afterAdd(added) {
  if (!added.length) return;
  ui.filter = "all";
  if (!isPhone()) ui.folded = false;
  renderAll();
  const n = added.length;
  if (isPhone() && ui.sheet !== "assets") toast(`${n === 1 ? "1 file" : n + " files"} added to the assets.`, "Show", () => {
    ui.sheet = "assets";
    renderChrome();
  });
}

const SAMPLES = [
  { name: "bell-tower.wav", size: 9 * MB },
  { name: "gate-1890.jpg", size: 6 * MB, thumb: SAMPLE_THUMB.picture },
  { name: "flood-1910.mp4", size: 40 * MB, thumb: SAMPLE_THUMB.video, failOnce: true },
  { name: "ferry.glb", size: 25 * MB },
];

function simulateDrop() {
  const round = sampleRound++;
  const files = SAMPLES.map((s) => ({ ...s, name: round ? s.name.replace(/\.(\w+)$/, ` (${round + 1}).$1`) : s.name }));
  $("#dropFiles").innerHTML = files.map((f) => `<span>${esc(f.name)} · ${fmt(f.size)}</span>`).join("");
  showOverlay(true);
  setTimeout(() => {
    showOverlay(false);
    afterAdd(addBatch(files));
  }, 900);
}

/* ---------- popover ---------- */
let popClose = null;
function openPop(anchor, html, onPick) {
  closePop();
  const pop = $("#pop");
  pop.innerHTML = html;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let x = Math.min(r.right - pw, window.innerWidth - pw - 8);
  x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
  if (r.left + pw < window.innerWidth - 8 && r.right - pw < 8) x = Math.max(8, r.left);
  let y = r.bottom + 4;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 4);
  pop.style.left = x + "px";
  pop.style.top = y + "px";
  const onClick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) {
      closePop();
      onPick(b.dataset.pick);
    }
  };
  pop.addEventListener("click", onClick);
  const outside = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop();
  };
  let live = true;
  setTimeout(() => live && document.addEventListener("pointerdown", outside), 0);
  popClose = () => {
    live = false;
    pop.removeEventListener("click", onClick);
    document.removeEventListener("pointerdown", outside);
  };
  $(".mi", pop)?.focus();
}
function closePop() {
  if (popClose) popClose();
  popClose = null;
  $("#pop").hidden = true;
}

function useInMenu(anchor, aid) {
  const a = assetById(aid);
  const label = KINDS[a.kind].label.toLowerCase();
  const empties = [];
  const others = [];
  walk((n) => {
    if (n.t === "item" && n.kind === a.kind && n.asset !== aid) (n.asset ? others : empties).push(n);
  });
  const stories = [];
  walk((n) => {
    if (n.t === "story") stories.push(n);
  });
  const mi = (id, icon, text, hint) =>
    `<button class="mi" type="button" data-pick="${id}">${ic(icon)}<span class="mt">${esc(text)}</span>${hint ? `<span class="mh">${esc(hint)}</span>` : ""}</button>`;
  let html = `<div class="mhead">Put ${esc(a.name)} into</div>`;
  if (empties.length) html += empties.map((n) => mi(n.id, a.kind, pathOf(n.id), "empty")).join("");
  html += `<div class="mhead">A new ${label} in a station</div>` + stations.map((s) => mi(s.id, "station", `${s.n} ${s.name}`)).join("");
  if (stories.length) html += `<div class="mhead">A new step in a story</div>` + stories.map((s) => mi(s.id, "story", pathOf(s.id))).join("");
  if (others.length) html += `<div class="mhead">Replace the file of</div>` + others.map((n) => mi(n.id, a.kind, pathOf(n.id))).join("");
  openPop(anchor, html, (id) => useAsset(aid, { id }));
}

function usesMenu(anchor, aid) {
  const a = assetById(aid);
  const uses = usesOf(aid);
  const html =
    `<div class="mhead">${esc(a.name)} is used in</div>` +
    uses.map((u) => `<button class="mi" type="button" data-pick="go:${u.id}">${ic("jump")}<span class="mt">${esc(pathOf(u.id))}</span></button>`).join("") +
    `<div class="msep"></div><button class="mi" type="button" data-pick="usein">${ic("plus")}<span class="mt">Use it somewhere else...</span></button>`;
  openPop(anchor, html, (pick) => {
    if (pick === "usein") useInMenu(anchor, aid);
    else select(pick.slice(3), { scroll: true });
  });
}

function pickMenu(anchor, itemId) {
  const n = find(itemId).node;
  const list = assets.filter((a) => a.kind === n.kind);
  const stateTx = (a) =>
    a.state === "ready" ? fmt(a.after) : a.state === "failed" ? "not optimized" : a.state === "queued" ? "queued" : `${Math.round(a.progress * 100)} %`;
  let html = `<div class="mhead">${KINDS[n.kind].plural} on the shelf</div>`;
  html += list.length
    ? list.map((a) => `<button class="mi${n.asset === a.id ? " cur" : ""}" type="button" data-pick="${a.id}">${thumbHtml(a)}<span class="mt">${esc(a.name)}</span><span class="mh">${stateTx(a)}</span></button>`).join("")
    : `<div class="mhead" style="text-transform:none;letter-spacing:0">None yet.</div>`;
  html += `<div class="msep"></div><button class="mi" type="button" data-pick="file">${ic("upload")}<span class="mt">Add a file from this computer...</span></button>`;
  if (n.asset) html += `<button class="mi" type="button" data-pick="none">${ic("close")}<span class="mt">Remove the file</span></button>`;
  openPop(anchor, html, (pick) => {
    if (pick === "file") {
      chooseFiles(KINDS[n.kind].exts.map((e) => "." + e).join(","), false, (added) => {
        if (added[0]?.kind === n.kind) useAsset(added[0].id, { id: itemId });
      });
    } else if (pick === "none") {
      n.asset = null;
      markDirty();
      renderAll();
    } else useAsset(pick, { id: itemId });
  });
}

let fileCb = null;
function chooseFiles(accept, multiple, cb) {
  const inp = $("#fileInput");
  inp.accept = accept;
  inp.multiple = multiple;
  inp.value = "";
  fileCb = cb;
  inp.click();
}
$("#fileInput").addEventListener("change", (e) => {
  const added = addFiles([...e.target.files]);
  if (fileCb) fileCb(added);
  fileCb = null;
});

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(text, act, fn) {
  const t = $("#toast");
  $(".tx", t).textContent = text;
  const b = $("#toastAct");
  b.hidden = !act;
  b.textContent = act || "";
  b.onclick = () => {
    t.classList.remove("show");
    fn?.();
  };
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), act ? 6000 : 4200);
}

/* ---------- drop of real files anywhere ---------- */
function showOverlay(on) {
  $("#dropOverlay").hidden = !on;
  document.body.classList.toggle("filedrag", on);
  if (on && !isPhone() && ui.folded) {
    ui.folded = false;
    renderChrome();
  }
}
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) {
    $("#dropFiles").innerHTML = "";
    showOverlay(true);
  }
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    showOverlay(false);
  }
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  showOverlay(false);
  addFiles([...e.dataTransfer.files]);
});

/* ---------- dragging a card onto the tree or a file field ---------- */
let drag = null;
function validTarget(el, a) {
  if (!el || !a?.kind) return false;
  const t = el.dataset.drop;
  if (t === "station" || t === "story") return true;
  return (t === "item" || t === "field") && el.dataset.kind === a.kind;
}
$("#shelfList").addEventListener("pointerdown", (e) => {
  if (isPhone() || e.button !== 0) return;
  const card = e.target.closest(".card");
  if (!card || e.target.closest("button, .cconfirm, .cmore")) return;
  if (e.pointerType === "touch" && !e.target.closest("[data-grip]")) return;
  const a = assetById(card.dataset.aid);
  if (!a?.kind) return;
  drag = { a, card, x: e.clientX, y: e.clientY, on: false, over: null, pid: e.pointerId };
});
window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.on = true;
    closePop();
    document.body.classList.add("dragging");
    drag.card.classList.add("dragsrc");
    for (const el of $$("[data-drop]")) if (validTarget(el, drag.a)) el.classList.add("drop-ok");
    const g = $("#ghost");
    g.innerHTML = `${thumbHtml(drag.a)}<span><span class="gt">${esc(drag.a.name)}</span><br><span class="gh">Drop on a station, a story or an item</span></span>`;
    g.hidden = false;
  }
  const g = $("#ghost");
  g.style.left = e.clientX + "px";
  g.style.top = e.clientY + "px";
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]");
  const over = validTarget(el, drag.a) ? el : null;
  if (over !== drag.over) {
    drag.over?.classList.remove("drop-hover");
    over?.classList.add("drop-hover");
    drag.over = over;
    $(".gh", g).textContent = over
      ? over.dataset.drop === "station"
        ? "Add as a new item of this station"
        : over.dataset.drop === "story"
          ? "Add as a new step of this story"
          : "Use as this item's file"
      : "Drop on a station, a story or an item";
  }
  e.preventDefault();
});
function endDrag(commit) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  document.body.classList.remove("dragging");
  $("#ghost").hidden = true;
  for (const el of $$(".drop-ok, .drop-hover")) el.classList.remove("drop-ok", "drop-hover");
  d.card.classList.remove("dragsrc");
  if (commit && d.over) useAsset(d.a.id, { id: d.over.dataset.id });
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
}
let suppressClick = false;
window.addEventListener("pointerup", (e) => drag && e.pointerId === drag.pid && endDrag(true));
window.addEventListener("pointercancel", () => endDrag(false));

/* ---------- events ---------- */
$("#shelfList").addEventListener("click", (e) => {
  if (suppressClick) return;
  const card = e.target.closest(".card");
  const actEl = e.target.closest("[data-act]");
  const act = actEl?.dataset.act;
  if (act === "add") return chooseFiles("", true, null);
  if (act === "sim") return simulateDrop();
  if (!card) return;
  const aid = card.dataset.aid;
  if (act === "retry") return retry(aid);
  if (act === "useorig") return useOriginal(aid);
  if (act === "uses") return usesMenu(actEl, aid);
  if (act === "usein") return useInMenu(actEl, aid);
  if (act === "del") {
    if (usesOf(aid).length) {
      ui.confirm = aid;
      renderShelf();
      $(`.card[data-aid="${aid}"] [data-act="delno"]`)?.focus();
    } else deleteAsset(aid);
    return;
  }
  if (act === "delyes") return deleteAsset(aid);
  if (act === "delno") {
    ui.confirm = null;
    return renderShelf();
  }
  if (act === "toggle") {
    ui.openCard = ui.openCard === aid ? null : aid;
    ui.confirm = null;
    renderShelf();
    $(`.card[data-aid="${aid}"] .crow`)?.focus();
  }
});
$("#shelfList").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".crow")) {
    e.preventDefault();
    e.target.click();
  }
});
$("#shelfSum").addEventListener("click", (e) => {
  if (e.target.closest('[data-act="optour"]')) optimizeTour();
});
$("#shelfChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  ui.filter = b.dataset.filter;
  renderShelf();
});
$("#rail").addEventListener("click", (e) => {
  const r = e.target.closest("[data-rid]");
  if (r) return revealCard(r.dataset.rid);
  if (e.target.closest('[data-act="unfold"]')) setFolded(false);
});
$("#shelfFold").addEventListener("click", () => setFolded(true));
$("#shelfClose").addEventListener("click", () => {
  ui.sheet = "list";
  renderChrome();
});
$("#addFiles").addEventListener("click", () => chooseFiles("", true, null));
$("#simDrop").addEventListener("click", simulateDrop);
$("#assetsTog").addEventListener("click", () => {
  if (isPhone()) {
    ui.sheet = ui.sheet === "assets" ? "list" : "assets";
    renderChrome();
  } else setFolded(!ui.folded);
});
$("#assetsBtn").addEventListener("click", () => {
  ui.sheet = ui.sheet === "assets" ? "list" : "assets";
  renderChrome();
});
$("#listBtn").addEventListener("click", () => {
  ui.sheet = "list";
  select(null);
});
$("#phonePill").addEventListener("click", () => {
  ui.sheet = "assets";
  renderChrome();
});
$("#treeFold").addEventListener("click", () => $("#tree").classList.toggle("folded"));

$("#rows").addEventListener("click", (e) => {
  const f = e.target.closest("[data-fold]");
  if (f) {
    const n = find(f.dataset.fold).node;
    n.open = !n.open;
    return renderTree();
  }
  const row = e.target.closest(".row");
  if (row) select(ui.sel === row.dataset.id ? null : row.dataset.id);
});
$("#pins").addEventListener("click", (e) => {
  const p = e.target.closest("[data-pin]");
  if (p) select(p.dataset.pin);
});

$("#insp").addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  const act = actEl?.dataset.act;
  if (act === "back" || act === "desel") return select(null);
  if (act === "pick") return pickMenu(actEl, actEl.dataset.id);
  if (act === "reveal") return revealCard($("#fileBlock").dataset.aid);
  if (act === "retryf") return retry($("#fileBlock").dataset.aid);
});
$("#insp").addEventListener("input", (e) => {
  const n = ui.sel && find(ui.sel)?.node;
  if (!n) return;
  if (e.target.id === "fName") {
    n.name = e.target.value;
    $("#inspTitle").textContent = n.t === "station" ? `${n.n} ${n.name}` : n.name;
    renderTree();
  } else if (e.target.id === "fDesc") n.desc = e.target.value;
  else if (e.target.id === "fText") n.text = e.target.value;
  else if (e.target.id === "fRad") {
    n.radius = Number(e.target.value);
    $("#fRadV").textContent = n.radius + " m";
  }
  markDirty();
});

$("#speedSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-speed]");
  if (!b) return;
  ui.speed = Number(b.dataset.speed);
  for (const x of $$("#speedSeg button")) x.classList.toggle("on", x === b);
});
for (const b of $$("[data-inert]")) b.addEventListener("click", () => toast("Not part of this prototype."));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (drag) return endDrag(false);
  if (!$("#pop").hidden) return closePop();
  if (ui.confirm) {
    ui.confirm = null;
    return renderShelf();
  }
  if (ui.sel && !e.target.closest?.("input, textarea")) select(null);
});

let wasPhone = isPhone();
window.addEventListener("resize", () => {
  closePop();
  if (isPhone() !== wasPhone) {
    wasPhone = isPhone();
    renderChrome();
  }
});

/* Notes open on a roomy screen, folded where they would cover the work. */
if (window.innerWidth >= 1000 && window.innerHeight >= 600) $("#notes").open = true;
/* The opened tour's own files: on the shelf, idle until "Optimize this tour". */
for (const a of addBatch([
  { name: "market-square.jpg", size: 6.2 * MB },
  { name: "church-bells.wav", size: 18.4 * MB },
])) {
  a.state = "idle";
  a.fresh = false;
}
renderAll();
renderInsp();
