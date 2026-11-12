// Asset shelf prototype 1: the shelf as a tab (or pinned section) of the
// right panel. All data is made up and nothing is saved; "processing" is
// faked with timers. Plain script, no modules, no libraries.
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const MB = 1024 * 1024;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (b) =>
    b >= 10 * MB ? Math.round(b / MB) + " MB" : b >= MB ? (b / MB).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const phoneQuery = matchMedia("(max-width: 700px)");
  const isPhone = () => phoneQuery.matches;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- icons ----------
  const ICON = {
    picture: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"/>',
    sound: '<path d="M3 6h2.5L9 3v10L5.5 10H3z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/>',
    video: '<rect x="2" y="4" width="9" height="8" rx="1.5"/><path d="M11 7l3-2v6l-3-2"/>',
    model: '<path d="M8 2l5.5 3v6L8 14l-5.5-3V5z"/><path d="M2.5 5L8 8l5.5-3M8 8v6"/>',
    other: '<path d="M4 2h5l3 3v9H4zM9 2v3h3"/>',
    text: '<path d="M3 4h10M3 7h10M3 10h7M3 13h5"/>',
    pin: '<path d="M3 3h10v6H9l-1 4-1-4H3z"/>',
    story: '<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5z"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
    use: '<path d="M2.5 8h8M7.5 5l3 3-3 3M13.5 3v10"/>',
    retry: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5"/>',
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    warn: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3M8 11.5v.2"/>',
    grip: '<path d="M6 4v.1M10 4v.1M6 8v.1M10 8v.1M6 12v.1M10 12v.1" stroke-width="2.2"/>',
    chev: '<path d="M6 4l4 4-4 4"/>',
    down: '<path d="M4 6l4 4 4-4"/>',
    link: '<path d="M6.5 9.5l3-3M5 8l-1.5 1.5a2.1 2.1 0 0 0 3 3L8 11M11 8l1.5-1.5a2.1 2.1 0 0 0-3-3L8 5"/>',
    split: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 9h11"/>',
    unsplit: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 5.5h11"/>',
    shelf: '<path d="M2 13.5h12M3.5 13.5V7h2.5v6.5M7 13.5V4h2.5v9.5M10.5 13.5l1-5.5 2 .4-1 5.1"/>',
    upload: '<path d="M8 11V3M5 6l3-3 3 3M3 11v2h10v-2"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  };
  const ic = (n, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 16 16" aria-hidden="true">${ICON[n] || ICON.other}</svg>`;
  const ring = (pct, id) =>
    `<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="rbg" cx="8" cy="8" r="6"/><circle class="rfg" cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="${pct.toFixed(1)} 100" ${id ? `data-pa="${id}" data-pk="ring"` : ""}/></svg>`;

  // ---------- kinds ----------
  const KIND = {
    picture: { label: "Picture", ratio: 0.12, target: "JPEG, 2048 px, quality 82", steps: ["Decoding", "Resizing to 2048 px", "Saving as JPEG, quality 82"] },
    sound: { label: "Sound", ratio: 0.09, target: "AAC 96 kbps", steps: ["Decoding", "Converting to AAC 96 kbps", "Writing"] },
    video: { label: "Video", ratio: 0.19, target: "720p H.264", steps: ["Reading", "Re-encoding to 720p", "Writing"] },
    model: { label: "3D model", ratio: 0.17, target: "simplified, 1024 px textures", steps: ["Reading", "Simplifying meshes", "Shrinking textures to 1024 px", "Compressing"] },
    other: { label: "File", ratio: 1, target: "", steps: ["Reading"] },
  };
  const MEDIA = ["picture", "sound", "video", "model"];
  function kindOf(name, type) {
    const ext = (String(name).split(".").pop() || "").toLowerCase();
    if (/^image\//.test(type) || ["jpg", "jpeg", "png", "webp", "heic", "gif"].includes(ext)) return "picture";
    if (/^audio\//.test(type) || ["wav", "mp3", "m4a", "aac", "ogg", "flac", "opus"].includes(ext)) return "sound";
    if (/^video\//.test(type) || ["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
    if (["glb", "gltf"].includes(ext) || type === "model/gltf-binary") return "model";
    return "other";
  }
  const extOf = (name) => (String(name).includes(".") ? String(name).split(".").pop().toUpperCase() : "?");
  const baseName = (name) => String(name).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

  // ---------- data ----------
  let seq = 0;
  const uid = (p) => p + ++seq;
  const assets = [];
  function makeAsset(o) {
    const kind = o.kind || kindOf(o.name, o.type || "");
    const a = {
      id: uid("a"),
      name: o.name,
      kind,
      ext: extOf(o.name),
      sizeIn: o.size,
      sizeOut: o.out != null ? o.out : Math.round(o.size * KIND[kind].ratio),
      dur: o.dur || 4000 + Math.random() * 3000,
      failAt: o.failAt || 0,
      state: o.state || "queued",
      progress: o.state === "ready" ? 100 : 0,
      reason: "",
      canRetry: true,
      thumbUrl: o.thumbUrl || "",
    };
    if (kind === "other") {
      a.state = "failed";
      a.canRetry = false;
      a.reason = `A tour cannot use .${a.ext.toLowerCase()} files. Pictures, sounds, videos and 3D models (GLB) work.`;
    } else if (!(o.size > 0)) {
      a.state = "failed";
      a.canRetry = false;
      a.reason = "The file is empty.";
    }
    return a;
  }

  const tree = [
    { id: "s1", type: "station", name: "The Column", open: true, children: [
      { id: "y1", type: "story", name: "The Column's tale", open: true, children: [
        { id: "i1", type: "item", kind: "text", name: "Why a column here?" },
        { id: "i2", type: "item", kind: "picture", name: "The square in 1890", file: null },
      ] },
      { id: "i3", type: "item", kind: "pin", name: "Look up!" },
      { id: "i4", type: "item", kind: "sound", name: "Square ambience", file: null },
    ] },
    { id: "s2", type: "station", name: "The old gate", open: true, children: [
      { id: "i5", type: "item", kind: "picture", name: "Gate in winter", file: null },
      { id: "i6", type: "item", kind: "model", name: "The gate as it stood in 1700", file: null },
    ] },
    { id: "s3", type: "station", name: "Market fountain", open: false, children: [
      { id: "i7", type: "item", kind: "text", name: "Market days" },
    ] },
    { id: "s4", type: "station", name: "The bridge", open: false, children: [] },
    { id: "s5", type: "station", name: "The tower", open: false, children: [
      { id: "y2", type: "story", name: "Climb the tower", open: false, children: [
        { id: "i8", type: "item", kind: "text", name: "137 steps" },
      ] },
    ] },
  ];
  const MAPPOS = { s1: [300, 470], s2: [420, 300], s3: [540, 420], s4: [640, 210], s5: [760, 440] };

  // Two assets already on the shelf and in use, so "used in" shows from the start.
  {
    const g = makeAsset({ name: "gate-winter.jpg", size: 4.3 * MB, out: 0.52 * MB, state: "ready" });
    const c = makeAsset({ name: "column-square-1890.jpg", size: 3.1 * MB, out: 0.41 * MB, state: "ready" });
    assets.push(g, c);
    find("i5").file = g.id;
    find("i2").file = c.id;
  }

  const SAMPLES = [
    { name: "harbour-bells.wav", size: 9 * MB, out: 0.82 * MB, dur: 10000 },
    { name: "gate-1890-scan.jpg", size: 6 * MB, out: 0.74 * MB, dur: 6000 },
    { name: "bridge-flyover.mp4", size: 40 * MB, out: 7.6 * MB, dur: 14000, failAt: 36 },
    { name: "fountain-scan.glb", size: 25 * MB, out: 4.2 * MB, dur: 11000 },
  ];

  // ---------- tree helpers ----------
  function walk(fn, list, parents) {
    for (const n of list || tree) {
      fn(n, parents || []);
      if (n.children) walk(fn, n.children, (parents || []).concat(n));
    }
  }
  function find(id) {
    let hit = null;
    walk((n) => {
      if (n.id === id) hit = n;
    });
    return hit;
  }
  function pathOf(id) {
    let hit = null;
    walk((n, p) => {
      if (n.id === id) hit = p.concat(n);
    });
    return hit || [];
  }
  function usesOf(assetId) {
    const out = [];
    walk((n) => {
      if (n.type === "item" && n.file === assetId) out.push(n);
    });
    return out;
  }
  const assetById = (id) => assets.find((a) => a.id === id) || null;
  const stationNo = (st) => tree.indexOf(st) + 1;
  const crumbText = (id) =>
    pathOf(id)
      .map((n) => (n.type === "station" ? stationNo(n) + " " + n.name : n.name))
      .join("  ›  ");

  // ---------- ui state ----------
  const ui = {
    sel: null,
    tab: "assets", // "sel" | "assets"
    split: false,
    folded: false,
  };

  function applyMode() {
    const split = ui.split && !isPhone();
    const b = document.body.classList;
    b.toggle("mode-split", split);
    b.toggle("mode-tabs", !split);
    b.toggle("tab-sel", ui.tab === "sel");
    b.toggle("tab-assets", ui.tab === "assets");
    b.toggle("panel-folded", ui.folded && !isPhone());
    $("#tabSel").setAttribute("aria-selected", String(ui.tab === "sel"));
    $("#tabAssets").setAttribute("aria-selected", String(ui.tab === "assets"));
    $("#tabSel").tabIndex = ui.tab === "sel" ? 0 : -1;
    $("#tabAssets").tabIndex = ui.tab === "assets" ? 0 : -1;
  }
  function setSheet(which) {
    document.body.classList.toggle("sheet-list", which === "list");
    document.body.classList.toggle("sheet-panel", which === "panel");
  }
  function openTab(tab) {
    ui.tab = tab;
    ui.folded = false;
    applyMode();
    if (isPhone()) setSheet("panel");
  }
  function showAssets(flashId) {
    if (!(ui.split && !isPhone())) openTab("assets");
    else {
      ui.folded = false;
      applyMode();
    }
    if (flashId) {
      const c = $(`.card[data-id="${flashId}"]`);
      if (c) {
        c.scrollIntoView({ block: "nearest" });
        flash(c);
      }
    }
  }
  function flash(el) {
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }

  // ---------- selection ----------
  function select(id, opts) {
    ui.sel = id;
    if (id && !(ui.split && !isPhone())) ui.tab = "sel";
    if (id) {
      for (const n of pathOf(id).slice(0, -1)) n.open = true;
    }
    ui.folded = false;
    applyMode();
    if (isPhone()) setSheet(id ? "panel" : "list");
    renderTree();
    renderInspector();
    renderMap();
    if (id && opts && opts.flash) {
      const r = $(`.row[data-id="${id}"]`);
      if (r) {
        r.scrollIntoView({ block: "nearest" });
        flash(r);
      }
    }
  }

  // ---------- tree ----------
  function rowState(n) {
    if (n.type !== "item" || !n.file) return "";
    const a = assetById(n.file);
    if (!a) return "";
    if (a.state === "processing") return `<span class="rstate" title="Being optimized; the original is used until then">${ring(a.progress, a.id)}</span>`;
    if (a.state === "queued") return `<span class="rstate" title="Waiting to be optimized; the original is used until then"><span class="qdot"></span></span>`;
    if (a.state === "failed") return `<span class="rstate bad" title="Optimizing failed; the original is used">${ic("warn")}</span>`;
    return "";
  }
  function renderTree() {
    const out = [];
    $("#stCount").textContent = tree.length;
    const row = (n, d) => {
      const sel = ui.sel === n.id ? " sel" : "";
      if (n.type === "station") {
        out.push(
          `<div class="row st${sel}" role="treeitem" aria-expanded="${n.open}" data-id="${n.id}" data-drop="station" style="--d:${d}">` +
            `<button class="arrow${n.open ? " open" : ""}" data-act="fold" type="button" aria-label="Fold or unfold">${ic("chev")}</button>` +
            `<span class="badge">${stationNo(n)}</span><span class="nm">${esc(n.name)}</span>` +
            (n.open ? "" : `<span class="rc">${n.children.length || ""}</span>`) +
            `</div>`,
        );
      } else if (n.type === "story") {
        out.push(
          `<div class="row${sel}" role="treeitem" aria-expanded="${n.open}" data-id="${n.id}" data-drop="story" style="--d:${d}">` +
            `<button class="arrow${n.open ? " open" : ""}" data-act="fold" type="button" aria-label="Fold or unfold">${ic("chev")}</button>` +
            `<span class="ti story">${ic("story")}</span><span class="nm">${esc(n.name)}</span><span class="rc">${n.children.length}</span></div>`,
        );
      } else {
        const media = MEDIA.includes(n.kind);
        out.push(
          `<div class="row${sel}" role="treeitem" data-id="${n.id}" ${media ? `data-drop="item" data-kind="${n.kind}"` : ""} style="--d:${d}">` +
            `<span style="width:14px"></span><span class="ti">${ic(n.kind)}</span><span class="nm">${esc(n.name)}</span>${rowState(n)}</div>`,
        );
      }
      if (n.children && n.open) for (const c of n.children) row(c, d + 1);
    };
    for (const st of tree) row(st, 0);
    $("#rows").innerHTML = out.join("");
  }
  $("#rows").addEventListener("click", (e) => {
    const r = e.target.closest(".row");
    if (!r) return;
    const n = find(r.dataset.id);
    if (e.target.closest('[data-act="fold"]')) {
      n.open = !n.open;
      renderTree();
      return;
    }
    select(ui.sel === n.id ? null : n.id);
  });

  // ---------- map ----------
  function renderMap() {
    const lines = [];
    for (let x = -40; x < 1040; x += 130) lines.push(`<path d="M${x} 0 L${x + 120} 700" stroke="#262a31" stroke-width="10"/>`);
    for (let y = 40; y < 700; y += 120) lines.push(`<path d="M0 ${y} L1000 ${y - 60}" stroke="#262a31" stroke-width="8"/>`);
    const river = `<path d="M690 -10 C 640 180, 760 330, 700 460 S 760 640, 820 720" stroke="#22374d" stroke-width="34" fill="none"/>`;
    const ids = tree.map((s) => s.id);
    const route = ids.map((id, i) => (i ? "L" : "M") + MAPPOS[id].join(" ")).join(" ");
    const marks = tree
      .map((s, i) => {
        const [x, y] = MAPPOS[s.id];
        return `<g class="mk${ui.sel === s.id ? " sel" : ""}" data-id="${s.id}"><circle cx="${x}" cy="${y}" r="15" fill="#34465f" stroke="#cfd8e6" stroke-width="2.5"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff" font-family="Segoe UI, sans-serif">${i + 1}</text><text x="${x + 24}" y="${y + 5}" font-size="15" fill="#e6e6e6" font-family="Segoe UI, sans-serif">${esc(s.name)}</text></g>`;
      })
      .join("");
    // a phone shows the map above its sheet only: frame the stations there
    $("#mapSvg").setAttribute("viewBox", isPhone() ? "265 110 600 540" : "0 0 1000 700");
    $("#mapSvg").innerHTML =
      lines.join("") + river + `<path d="${route}" stroke="#a07a45" stroke-width="2.5" stroke-dasharray="7 7" fill="none"/>` + marks;
  }
  $("#mapSvg").addEventListener("click", (e) => {
    const g = e.target.closest(".mk");
    if (g) select(g.dataset.id, { flash: true });
  });

  // ---------- inspector ----------
  function renderInspector() {
    const el = $("#insp");
    const n = ui.sel ? find(ui.sel) : null;
    if (!n) {
      el.innerHTML = `<div class="empty"><b>Nothing selected</b>Select a station or an item in the list.<br/>Files go to the <button class="linkbtn" data-act="toShelf" type="button">asset shelf</button>; drag one onto a station to add it.</div>`;
      return;
    }
    const icon = n.type === "station" ? `<span class="badge">${stationNo(n)}</span>` : `<span class="hic">${ic(n.type === "story" ? "story" : n.kind)}</span>`;
    let h = `<div class="ihead">${icon}<input type="text" data-f="name" value="${esc(n.name)}" aria-label="Name"/></div>`;
    h += `<div class="crumb">${esc(crumbText(n.id))}</div>`;
    if (n.type === "station") {
      n.radius = n.radius || 15;
      h += `<div class="disc">Text</div><div class="sec"><textarea data-f="desc" aria-label="Description" placeholder="What the visitor reads on arrival">${esc(n.desc || "")}</textarea></div>`;
      h += `<div class="disc">Place</div><div class="sec"><div class="f"><label>Radius</label><div class="rng"><input type="range" min="5" max="60" value="${n.radius}" data-f="radius" aria-label="Radius"/><output>${n.radius} m</output></div></div></div>`;
      h += `<div class="hint">${n.children.length} item${n.children.length === 1 ? "" : "s"}. Drag an asset from the shelf onto this station in the list to add one.</div>`;
    } else if (n.type === "story") {
      h += `<div class="hint">A story with ${n.children.length} step${n.children.length === 1 ? "" : "s"}. Drop an asset on it in the list to add a step.</div>`;
    } else if (MEDIA.includes(n.kind)) {
      h += `<div class="disc">File</div><div class="sec">${fileField(n)}</div>`;
      h += `<div class="disc">${KIND[n.kind].label}</div><div class="sec">${kindFields(n)}</div>`;
    } else {
      h += `<div class="disc">Text</div><div class="sec"><textarea data-f="text" aria-label="Text">${esc(n.text || "")}</textarea></div>`;
    }
    el.innerHTML = h;
  }
  function kindFields(n) {
    if (n.kind === "sound")
      return `<div class="f"><label>Plays</label><select data-f="plays"><option>On arrival</option><option>On a tap</option><option>In a loop</option></select></div><div class="f"><label>Volume</label><div class="rng"><input type="range" min="0" max="100" value="${n.vol || 80}" data-f="vol" aria-label="Volume"/><output>${n.vol || 80}%</output></div></div>`;
    if (n.kind === "video") return `<div class="f"><label>Loop</label><label><input type="checkbox" data-f="loop"/> Play again at the end</label></div>`;
    if (n.kind === "model") return `<div class="f"><label>Size</label><input type="number" value="${n.size || 4}" step="0.5" data-f="size" aria-label="Size in metres"/></div>`;
    return `<div class="f"><label>Width</label><input type="number" value="${n.width || 2}" step="0.5" data-f="width" aria-label="Width in metres"/></div>`;
  }
  function fileField(n) {
    const a = n.file ? assetById(n.file) : null;
    if (!a)
      return (
        `<div class="filefield none" data-drop="file" data-kind="${n.kind}">` +
        `No ${KIND[n.kind].label.toLowerCase()} yet. Drag one from the shelf here, or` +
        `<div class="ffbtns" style="justify-content:center"><button class="tbtn sm" data-act="choose" type="button">${ic("shelf")} Choose from the shelf ${ic("down")}</button></div></div>`
      );
    let st = "";
    if (a.state === "processing")
      st = `<div class="ffstate">${ring(a.progress, a.id)}<span>Being optimized: <b data-pa="${a.id}" data-pk="pct">${Math.floor(a.progress)}%</b>. The original (${fmt(a.sizeIn)}) is used until it is ready, then it is replaced.</span></div>`;
    else if (a.state === "queued")
      st = `<div class="ffstate"><span class="qdot" style="margin-top:3px"></span><span>Waiting to be optimized. The original (${fmt(a.sizeIn)}) is used until it is ready.</span></div>`;
    else if (a.state === "ready")
      st = `<div class="ffstate ok">${ic("check")}<span>Optimized: ${fmt(a.sizeIn)} → <b>${fmt(a.sizeOut)}</b> (${KIND[a.kind].target}).</span></div>`;
    else if (a.state === "original")
      st = `<div class="ffstate warn">${ic("warn")}<span>Not optimized: the original (${fmt(a.sizeIn)}) is used. Heavy for a phone download.</span></div>`;
    else if (a.state === "failed")
      st = `<div class="ffstate bad">${ic("warn")}<span>Optimizing failed: ${esc(a.reason)} The original (${fmt(a.sizeIn)}) is used.${a.canRetry ? ` <button class="linkbtn" data-act="retry" data-id="${a.id}" type="button">Retry</button>` : ""}</span></div>`;
    return (
      `<div class="filefield" data-drop="file" data-kind="${n.kind}">` +
      `<div class="ffrow">${thumb(a)}<div class="ffname"><b>${esc(a.name)}</b><span>${KIND[a.kind].label} · ${a.ext} · ${fmt(a.state === "ready" ? a.sizeOut : a.sizeIn)}</span></div></div>` +
      st +
      `<div class="ffbtns"><button class="tbtn sm" data-act="choose" type="button">Change ${ic("down")}</button><button class="tbtn sm" data-act="unset" type="button">Remove</button><span class="sp"></span><button class="linkbtn" data-act="toShelf" data-id="${a.id}" type="button">Show on the shelf</button></div>` +
      `</div>`
    );
  }
  $("#insp").addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    const n = ui.sel && find(ui.sel);
    if (!f || !n) return;
    if (f === "name") {
      n.name = e.target.value;
      const r = $(`.row[data-id="${n.id}"] .nm`);
      if (r) r.textContent = n.name;
      if (n.type === "station") renderMap();
    } else if (f === "radius" || f === "vol") {
      n[f === "radius" ? "radius" : "vol"] = +e.target.value;
      e.target.nextElementSibling.textContent = e.target.value + (f === "radius" ? " m" : "%");
    } else n[f] = e.target.value;
  });
  $("#insp").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const n = ui.sel && find(ui.sel);
    const act = b.dataset.act;
    if (act === "toShelf") showAssets(b.dataset.id);
    else if (act === "retry") retry(assetById(b.dataset.id));
    else if (act === "unset" && n) {
      n.file = null;
      renderInspector();
      renderTree();
      renderShelf();
      toast(`“${n.name}” has no file now.`);
    } else if (act === "choose" && n) choosePop(b, n);
  });

  // ---------- shelf ----------
  function thumb(a) {
    if (a.thumbUrl) return `<div class="thumb"><img src="${a.thumbUrl}" alt=""/></div>`;
    return `<div class="thumb k-${a.kind}">${a.kind === "picture" ? "" : ic(a.kind)}</div>`;
  }
  function stepText(a) {
    const s = KIND[a.kind].steps;
    return s[Math.min(s.length - 1, Math.floor((a.progress / 100) * s.length))];
  }
  function counts() {
    const c = { queued: 0, processing: 0, failed: 0, saved: 0, total: assets.length };
    for (const a of assets) {
      if (a.state in c) c[a.state]++;
      if (a.state === "ready") c.saved += a.sizeIn - a.sizeOut;
    }
    return c;
  }
  function overallPct() {
    const busy = assets.filter((a) => a.state === "processing" || a.state === "queued");
    if (!busy.length) return 100;
    return busy.reduce((s, a) => s + a.progress, 0) / busy.length;
  }
  function cardHtml(a) {
    const uses = usesOf(a.id);
    let st = "";
    if (a.state === "queued") st = `<div class="cstate q"><span class="qdot"></span><span class="stp">Queued</span></div>`;
    else if (a.state === "processing")
      st =
        `<div class="bar" role="progressbar" aria-label="Optimizing ${esc(a.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(a.progress)}" data-pa="${a.id}" data-pk="aria"><i style="width:${a.progress}%" data-pa="${a.id}" data-pk="bar"></i></div>` +
        `<div class="cstate"><span class="stp" data-pa="${a.id}" data-pk="step">${stepText(a)}</span><span class="pct" data-pa="${a.id}" data-pk="pct">${Math.floor(a.progress)}%</span></div>`;
    else if (a.state === "ready")
      st = `<div class="cstate ok">${ic("check")}<span class="fromto">${fmt(a.sizeIn)} → ${fmt(a.sizeOut)}</span></div>`;
    else if (a.state === "original")
      st = `<div class="cstate warn">${ic("warn")}<span class="stp">Original kept, ${fmt(a.sizeIn)}</span></div><div class="cbtns"><button class="tbtn sm" data-act="retry" type="button">${ic("retry")} Optimize</button></div>`;
    else if (a.state === "failed")
      st =
        `<div class="cstate bad">${ic("warn")}<span>${esc(a.reason)}</span></div>` +
        (a.canRetry
          ? `<div class="cbtns"><button class="tbtn sm" data-act="retry" type="button">${ic("retry")} Retry</button><button class="tbtn sm" data-act="keep" type="button">Use the original</button></div>`
          : "");
    const used = uses.length
      ? `<button class="used" data-act="used" type="button" aria-haspopup="menu">${ic("link")} Used in ${uses.length}</button>`
      : `<span class="dim">Not used yet</span>`;
    const canUse = a.kind !== "other";
    return (
      `<div class="card s-${a.state}" role="listitem" data-id="${a.id}">` +
      (canUse ? `<span class="grip" title="Drag onto a station, a story or an item">${ic("grip")}</span>` : `<span class="grip"></span>`) +
      thumb(a) +
      `<div class="cmain"><div class="cname" title="${esc(a.name)}">${esc(a.name)}</div><div class="cmeta">${KIND[a.kind].label} · ${a.ext} · ${fmt(a.sizeIn)}</div>${st}<div class="crow2">${used}</div></div>` +
      `<div class="cact">` +
      (canUse ? `<button class="ib" data-act="use" type="button" title="Use in a station, a story or an item" aria-label="Use ${esc(a.name)}" aria-haspopup="menu">${ic("use")}</button>` : "") +
      `<button class="ib del" data-act="del" type="button" title="Delete" aria-label="Delete ${esc(a.name)}">${ic("trash")}</button></div></div>`
    );
  }
  function renderShelfHead() {
    const c = counts();
    const parts = [`<b>${c.total}</b> file${c.total === 1 ? "" : "s"}`];
    if (c.processing + c.queued) parts.push(`${c.processing + c.queued} optimizing`);
    if (c.failed) parts.push(`<span style="color:var(--danger)">${c.failed} failed</span>`);
    if (c.saved) parts.push(`${fmt(c.saved)} saved`);
    const splitBtn = isPhone()
      ? ""
      : `<button class="ib${ui.split ? " on" : ""}" id="splitBtn" type="button" title="${ui.split ? "Back to tabs" : "Pin the shelf under the selection"}" aria-pressed="${ui.split}" aria-label="Pin the shelf under the selection">${ic(ui.split ? "unsplit" : "split")}</button>`;
    $("#shelfHead").innerHTML = `<span class="sum">${parts.join(" · ")}</span>${splitBtn}`;
    $("#secCount").textContent = c.total;
    // the tab, the folded rail, the phone list's button and the bottom bar
    const busy = c.processing + c.queued;
    const tb = $("#tabBadge");
    tb.className = "tbadge" + (busy ? " busy" : c.failed ? " bad" : "");
    tb.innerHTML = busy ? ring(overallPct(), "all") + busy : c.failed ? ic("warn") + c.failed : String(c.total);
    $("#railAssets").innerHTML = ic("shelf") + (busy ? ring(overallPct(), "all") : `<span>${c.total}</span>`);
    $("#listAssetsInner").innerHTML = ic("shelf") + "Assets" + (busy ? " " + ring(overallPct(), "all") : c.failed ? ` <span style="color:var(--danger)">${c.failed}!</span>` : "");
    const bar = $("#barAssets");
    if (busy) bar.innerHTML = `${ring(overallPct(), "all")} Optimizing ${busy} file${busy === 1 ? "" : "s"} · you can keep editing`;
    else if (c.failed) bar.innerHTML = `<span class="bad">${ic("warn")}</span> ${c.failed} file${c.failed === 1 ? "" : "s"} could not be optimized`;
    else bar.innerHTML = `${ic("check")} Assets ready${c.saved ? " · " + fmt(c.saved) + " saved" : ""}`;
  }
  function renderShelf() {
    renderShelfHead();
    const el = $("#shelf");
    if (!assets.length) {
      el.innerHTML = `<div class="empty"><b>The shelf is empty</b>Drop pictures, sounds, videos or 3D models anywhere on the page.<div class="ffbtns" style="justify-content:center"><button class="tbtn sm" data-act="sim" type="button">Simulate drop</button></div></div>`;
      return;
    }
    // newest first
    el.innerHTML = assets
      .slice()
      .reverse()
      .map(cardHtml)
      .join("");
  }
  function renderCard(a) {
    const old = $(`.card[data-id="${a.id}"]`);
    if (!old) return renderShelf();
    const act = document.activeElement && old.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    const t = document.createElement("div");
    t.innerHTML = cardHtml(a);
    const fresh = t.firstElementChild;
    old.replaceWith(fresh);
    if (act) {
      const f = $(`[data-act="${act}"]`, fresh) || $(".ib", fresh);
      if (f) f.focus();
    }
    renderShelfHead();
  }
  $("#shelf").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "sim") return simulateDrop();
    const a = assetById(b.closest(".card").dataset.id);
    if (!a) return;
    const act = b.dataset.act;
    if (act === "retry") retry(a);
    else if (act === "keep") {
      a.state = "original";
      changed(a);
      toast(`${a.name}: the original (${fmt(a.sizeIn)}) is used, not optimized.`);
    } else if (act === "use") usePop(b, a);
    else if (act === "used") usedPop(b, a);
    else if (act === "del") del(a);
  });
  $("#shelfHead").addEventListener("click", (e) => {
    if (!e.target.closest("#splitBtn")) return;
    ui.split = !ui.split;
    if (!ui.split) ui.tab = "assets";
    applyMode();
    renderShelfHead();
    $("#splitBtn").focus();
  });

  // ---------- processing (faked) ----------
  const CONCURRENCY = 2;
  function patch(a) {
    for (const el of $$(`[data-pa="${a.id}"], [data-pa="all"]`)) {
      const k = el.dataset.pk;
      const p = el.dataset.pa === "all" ? overallPct() : a.progress;
      if (k === "bar") el.style.width = p + "%";
      else if (k === "pct") el.textContent = Math.floor(p) + "%";
      else if (k === "step") el.textContent = stepText(a);
      else if (k === "ring") el.setAttribute("stroke-dasharray", p.toFixed(1) + " 100");
      else if (k === "aria") el.setAttribute("aria-valuenow", String(Math.floor(p)));
    }
  }
  function changed(a) {
    renderCard(a);
    if (usesOf(a.id).length) renderTree();
    const n = ui.sel && find(ui.sel);
    if (n && n.file === a.id && !$("#insp").contains(document.activeElement)) renderInspector();
    else if (n && n.file === a.id) {
      // keep the typing where it is: refresh only the file field
      const ff = $("#insp .filefield");
      if (ff) ff.outerHTML = fileField(n);
    }
  }
  function tick() {
    const running = assets.filter((a) => a.state === "processing");
    for (const a of assets) {
      if (running.length >= CONCURRENCY) break;
      if (a.state === "queued") {
        a.state = "processing";
        a.progress = 0;
        running.push(a);
        changed(a);
      }
    }
    for (const a of running) {
      a.progress = Math.min(100, a.progress + (100 * 100) / a.dur);
      if (a.failAt && a.progress >= a.failAt) {
        a.state = "failed";
        a.failAt = 0;
        a.reason = "The browser ran out of memory while re-encoding this video. Close other tabs, then retry.";
        changed(a);
        toast(`Could not optimize ${a.name}.`, { label: "Show", fn: () => showAssets(a.id) });
        continue;
      }
      if (a.progress >= 100) {
        a.state = "ready";
        changed(a);
        const u = usesOf(a.id).length;
        toast(
          `${a.name} is optimized: ${fmt(a.sizeIn)} → ${fmt(a.sizeOut)}.` + (u ? ` ${u === 1 ? "Its item now uses" : u + " items now use"} the lighter file.` : ""),
        );
        continue;
      }
      patch(a);
    }
  }
  setInterval(tick, 100);
  function retry(a) {
    if (!a) return;
    a.state = "queued";
    a.progress = 0;
    a.reason = "";
    a.dur = Math.min(a.dur, 7000);
    changed(a);
  }

  // ---------- adding files ----------
  function addFiles(list) {
    const added = [];
    for (const f of list) {
      const kind = kindOf(f.name, f.type || "");
      const a = makeAsset({ name: f.name, type: f.type, size: f.size, out: f.out, dur: f.dur, failAt: f.failAt, thumbUrl: f.blob && kind === "picture" ? URL.createObjectURL(f.blob) : "" });
      assets.push(a);
      added.push(a);
    }
    if (!added.length) return;
    renderShelf();
    if (ui.split && !isPhone()) {
      ui.folded = false;
      applyMode();
    } else openTab("assets");
    for (const a of added) {
      const c = $(`.card[data-id="${a.id}"]`);
      if (c) flash(c);
    }
    $("#shelf").scrollTop = 0;
    toast(`${added.length} file${added.length === 1 ? "" : "s"} added to the shelf. They are optimized in the background; you can use them right away.`);
  }
  function simulateDrop() {
    addFiles(SAMPLES.map((s) => Object.assign({}, s)));
  }
  $("#simDrop").addEventListener("click", simulateDrop);
  $("#addFiles").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => {
    const files = [...e.target.files].map((f) => ({ name: f.name, type: f.type, size: f.size, blob: f }));
    addFiles(files);
    e.target.value = "";
  });

  // dropping real files anywhere on the page
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $("#dropzone").hidden = false;
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#dropzone").hidden = true;
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("#dropzone").hidden = true;
    const files = [...e.dataTransfer.files].map((f) => ({ name: f.name, type: f.type, size: f.size, blob: f }));
    addFiles(files);
  });

  // ---------- using an asset ----------
  function accepts(target, a) {
    if (!target || !a || a.kind === "other") return false;
    const t = target.dataset.drop;
    if (t === "station" || t === "story") return true;
    if (t === "item" || t === "file") return target.dataset.kind === a.kind;
    return false;
  }
  function useAsset(a, nodeId) {
    const n = find(nodeId);
    if (!n || !a) return;
    const pending = a.state === "processing" || a.state === "queued";
    const note = pending ? " The original is used until it is optimized." : "";
    if (n.type === "station" || n.type === "story") {
      const it = { id: uid("i"), type: "item", kind: a.kind, name: baseName(a.name), file: a.id };
      n.children.push(it);
      n.open = true;
      renderTree();
      const r = $(`.row[data-id="${it.id}"]`);
      if (r) {
        r.scrollIntoView({ block: "nearest" });
        flash(r);
      }
      toast(`Added “${it.name}” to ${n.name}.${note}`, { label: "Open", fn: () => select(it.id, { flash: true }) });
    } else if (n.type === "item") {
      n.file = a.id;
      renderTree();
      toast(`“${n.name}” now uses ${a.name}.${note}`);
    }
    renderCard(a);
    if (ui.sel) renderInspector();
  }
  function itemsOfKind(kind) {
    const out = [];
    walk((n) => {
      if (n.type === "item" && n.kind === kind) out.push(n);
    });
    return out;
  }
  function usePop(anchor, a) {
    let h = `<div class="ph">Add to</div>`;
    walk((n, p) => {
      if (n.type === "station") h += `<button class="mi" role="menuitem" data-node="${n.id}" type="button"><span class="badge">${stationNo(n)}</span><span class="mt">${esc(n.name)}</span></button>`;
      else if (n.type === "story") h += `<button class="mi" role="menuitem" data-node="${n.id}" style="--d:${p.length}" type="button"><span class="ti">${ic("story")}</span><span class="mt">${esc(n.name)}</span><span class="ms">story</span></button>`;
    });
    const items = itemsOfKind(a.kind);
    if (items.length) {
      h += `<hr/><div class="ph">Set as the file of</div>`;
      for (const it of items) {
        const cur = it.file ? assetById(it.file) : null;
        h += `<button class="mi" role="menuitem" data-node="${it.id}" type="button">${ic(it.kind)}<span class="mt">${esc(it.name)}</span><span class="ms">${it.file === a.id ? "already" : cur ? "replaces " + esc(cur.name) : "no file"}</span></button>`;
      }
    }
    openPop(anchor, h, (b) => useAsset(a, b.dataset.node));
  }
  function usedPop(anchor, a) {
    const uses = usesOf(a.id);
    let h = `<div class="ph">Used in</div>`;
    for (const it of uses) h += `<button class="mi" role="menuitem" data-node="${it.id}" type="button">${ic(it.kind)}<span class="mt">${esc(crumbText(it.id))}</span></button>`;
    openPop(anchor, h, (b) => select(b.dataset.node, { flash: true }));
  }
  function choosePop(anchor, n) {
    const list = assets.filter((a) => a.kind === n.kind);
    let h = `<div class="ph">${KIND[n.kind].label}s on the shelf</div>`;
    if (!list.length) h += `<div class="ph" style="text-transform:none;letter-spacing:0;font-weight:400">None yet.</div>`;
    for (const a of list.slice().reverse()) {
      const s =
        a.state === "processing"
          ? `<span class="ms busy">optimizing ${Math.floor(a.progress)}%</span>`
          : a.state === "queued"
            ? `<span class="ms busy">queued</span>`
            : a.state === "failed"
              ? `<span class="ms" style="color:var(--danger)">failed</span>`
              : `<span class="ms">${fmt(a.state === "ready" ? a.sizeOut : a.sizeIn)}</span>`;
      h += `<button class="mi" role="menuitem" data-asset="${a.id}" type="button">${ic(a.kind)}<span class="mt">${esc(a.name)}</span>${s}</button>`;
    }
    h += `<hr/><button class="mi" role="menuitem" data-asset="__device" type="button">${ic("upload")}<span class="mt">Add a file from this device…</span></button>`;
    openPop(anchor, h, (b) => {
      if (b.dataset.asset === "__device") return $("#fileInput").click();
      useAsset(assetById(b.dataset.asset), n.id);
    });
  }

  // ---------- popover ----------
  let popDone = null;
  let popAnchor = null;
  function openPop(anchor, html, onPick) {
    const p = $("#pop");
    p.innerHTML = html;
    p.hidden = false;
    popDone = onPick;
    popAnchor = anchor;
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth;
    const ph = p.offsetHeight;
    let x = Math.min(r.right - pw, innerWidth - pw - 8);
    x = Math.max(8, x);
    let y = r.bottom + 4;
    if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4);
    p.style.left = x + "px";
    p.style.top = y + "px";
    const first = $(".mi", p);
    if (first) first.focus();
  }
  function closePop(refocus) {
    const p = $("#pop");
    if (p.hidden) return;
    p.hidden = true;
    popDone = null;
    if (refocus && popAnchor && document.contains(popAnchor)) popAnchor.focus();
    popAnchor = null;
  }
  $("#pop").addEventListener("click", (e) => {
    const b = e.target.closest(".mi");
    if (!b) return;
    const fn = popDone;
    closePop(false);
    if (fn) fn(b);
  });
  $("#pop").addEventListener("keydown", (e) => {
    const items = $$("#pop .mi");
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      if (n) n.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!$("#pop").hidden && !e.target.closest("#pop") && !(popAnchor && popAnchor.contains(e.target))) closePop(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#pop").hidden) closePop(true);
      else if (drag) endDrag(false);
      else if (ui.sel && !e.target.closest("input, textarea, select")) select(null);
    }
  });

  // ---------- delete ----------
  function del(a) {
    const uses = usesOf(a.id);
    const go = () => {
      const idx = assets.indexOf(a);
      const usedIds = uses.map((u) => u.id);
      assets.splice(idx, 1);
      for (const u of uses) u.file = null;
      renderShelf();
      renderTree();
      if (ui.sel) renderInspector();
      toast(`Deleted ${a.name}.` + (uses.length ? ` ${uses.length === 1 ? "1 item has" : uses.length + " items have"} no file now.` : ""), {
        label: "Undo",
        fn: () => {
          assets.splice(Math.min(idx, assets.length), 0, a);
          for (const id of usedIds) {
            const n = find(id);
            if (n) n.file = a.id;
          }
          renderShelf();
          renderTree();
          if (ui.sel) renderInspector();
          toast(`${a.name} is back.`);
        },
      });
    };
    if (!uses.length) return go();
    $("#cfTitle").textContent = `Delete ${a.name}?`;
    $("#cfBody").innerHTML =
      `It is used in ${uses.length} place${uses.length === 1 ? "" : "s"}:<ul>${uses.map((u) => `<li>${esc(crumbText(u.id))}</li>`).join("")}</ul>The item${uses.length === 1 ? " stays" : "s stay"}, without a file.`;
    $("#cfOk").textContent = "Delete anyway";
    const d = $("#confirm");
    d.returnValue = "";
    d.onclose = () => {
      d.onclose = null;
      if (d.returnValue === "ok") go();
    };
    d.showModal();
  }

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(text, action) {
    const t = $("#toast");
    t.innerHTML = `<span class="tt">${esc(text)}</span>` + (action ? `<button class="tbtn sm acc" type="button">${esc(action.label)}</button>` : "");
    t.hidden = false;
    if (action) $("button", t).onclick = () => {
      t.hidden = true;
      action.fn();
    };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), action ? 6500 : 4200);
  }

  // ---------- dragging a card from the shelf ----------
  let drag = null;
  $("#shelf").addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".card");
    if (!card || e.button !== 0 || e.target.closest("button")) return;
    const fromGrip = !!e.target.closest(".grip");
    if (e.pointerType !== "mouse" && !fromGrip) return; // touch scrolls the shelf unless the grip is held
    const a = assetById(card.dataset.id);
    if (!a || a.kind === "other") return;
    drag = { a, card, x0: e.clientX, y0: e.clientY, started: false, over: null, id: e.pointerId };
    if (fromGrip || e.pointerType === "mouse") e.preventDefault(); // no text selection, no scroll
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      drag.started = true;
      document.body.classList.add("dragging");
      drag.card.classList.add("dragsrc");
      const g = $("#ghost");
      g.innerHTML = thumb(drag.a) + `<div class="gt"><b>${esc(drag.a.name)}</b><span>Drop on a station, a story or a ${KIND[drag.a.kind].label.toLowerCase()} item</span></div>`;
      g.hidden = false;
      for (const t of $$("[data-drop]")) t.classList.add(accepts(t, drag.a) ? "ok" : "no");
      closePop(false);
    }
    e.preventDefault();
    const g = $("#ghost");
    g.style.left = e.clientX + "px";
    g.style.top = e.clientY + "px";
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const t = hit && hit.closest("[data-drop]");
    const over = t && accepts(t, drag.a) ? t : null;
    if (over !== drag.over) {
      if (drag.over) drag.over.classList.remove("over");
      if (over) over.classList.add("over");
      drag.over = over;
    }
    // scroll the tree near its edges
    const rows = $("#rows");
    const rr = rows.getBoundingClientRect();
    if (e.clientX >= rr.left && e.clientX <= rr.right) {
      if (e.clientY < rr.top + 24) rows.scrollTop -= 8;
      else if (e.clientY > rr.bottom - 24) rows.scrollTop += 8;
    }
  });
  function endDrag(apply) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    document.body.classList.remove("dragging");
    d.card.classList.remove("dragsrc");
    $("#ghost").hidden = true;
    for (const t of $$("[data-drop]")) t.classList.remove("ok", "no", "over");
    if (apply && d.over) {
      const t = d.over;
      const nodeId = t.dataset.drop === "file" ? ui.sel : t.dataset.id;
      useAsset(d.a, nodeId);
    }
  }
  window.addEventListener("pointerup", (e) => {
    if (drag && e.pointerId === drag.id) endDrag(true);
  });
  window.addEventListener("pointercancel", (e) => {
    if (drag && e.pointerId === drag.id) endDrag(false);
  });

  // ---------- panel chrome ----------
  $("#tabSel").addEventListener("click", () => openTab("sel"));
  $("#tabAssets").addEventListener("click", () => openTab("assets"));
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    openTab(ui.tab === "sel" ? "assets" : "sel");
    (ui.tab === "sel" ? $("#tabSel") : $("#tabAssets")).focus();
  });
  $("#panelFold").addEventListener("click", () => {
    ui.folded = true;
    applyMode();
  });
  $("#railSel").addEventListener("click", () => openTab("sel"));
  $("#railAssets").addEventListener("click", () => showAssets());
  $("#barAssets").addEventListener("click", () => showAssets());
  $("#listAssets").addEventListener("click", () => openTab("assets"));
  const toList = () => {
    ui.sel = null;
    setSheet("list");
    renderTree();
    renderInspector();
    renderMap();
  };
  $("#panelBack").addEventListener("click", toList);
  $("#panelClose").addEventListener("click", toList);
  // the phone sheet's grip: a tap toggles a tall sheet
  for (const h of $$(".phead")) {
    h.addEventListener("click", (e) => {
      if (!isPhone() || e.target.closest("button")) return;
      const r = h.getBoundingClientRect();
      if (e.clientY - r.top < 14) document.body.classList.toggle("sheet-tall");
    });
  }
  // the split's resizer
  {
    const sp = $("#splitter");
    let start = null;
    sp.addEventListener("pointerdown", (e) => {
      start = { y: e.clientY, h: $("#shelfSec").offsetHeight, total: $("#pstack").offsetHeight };
      sp.setPointerCapture(e.pointerId);
    });
    sp.addEventListener("pointermove", (e) => {
      if (!start) return;
      const h = Math.max(90, Math.min(start.total - 70, start.h - (e.clientY - start.y)));
      document.documentElement.style.setProperty("--shelfH", h + "px");
    });
    sp.addEventListener("pointerup", () => (start = null));
    sp.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const h = $("#shelfSec").offsetHeight + (e.key === "ArrowUp" ? 24 : -24);
      document.documentElement.style.setProperty("--shelfH", Math.max(90, Math.min($("#pstack").offsetHeight - 70, h)) + "px");
    });
  }
  $("#notesToggle").addEventListener("click", () => {
    const n = $("#notes");
    n.classList.toggle("folded");
    const open = !n.classList.contains("folded");
    $("#notesToggle").setAttribute("aria-expanded", String(open));
    $(".fold", n).textContent = open ? "fold" : "open";
  });
  phoneQuery.addEventListener("change", () => {
    applyMode();
    renderShelfHead();
    renderMap();
    setSheet(ui.sel ? "panel" : "list");
  });

  // ---------- start ----------
  // The notes start open on a desktop, folded where space is short.
  if (innerWidth > 900 && innerHeight > 600) $("#notesToggle").click();
  if (reduceMotion) document.documentElement.style.scrollBehavior = "auto";
  applyMode();
  setSheet("list");
  renderTree();
  renderMap();
  renderInspector();
  renderShelf();
})();
