/* Asset shelf prototype 3: a rail of rings. Sample data, fake timers, nothing saved. */
(() => {
  "use strict";

  const MB = 1024 * 1024;
  const KIND = {
    audio: { label: "Sound", how: "Made a small standard sound (96 kbit/s M4A)" },
    image: { label: "Picture", how: "Scaled to 2048 px, JPEG quality 82" },
    video: { label: "Video", how: "Made 720p H.264" },
    model: { label: "3D model", how: "Meshes simplified, textures to 1024 px" },
    other: { label: "File", how: "" },
  };
  const noun = (k) => (k === "model" ? "3D model" : KIND[k].label.toLowerCase());
  const RATIO ={ audio: 0.09, image: 0.15, video: 0.2, model: 0.17 };
  const SAMPLES = [
    { name: "river-ambience.wav", kind: "audio", before: 9 * MB, after: 0.82 * MB, dur: 5200 },
    { name: "market-square.jpg", kind: "image", before: 6 * MB, after: 0.9 * MB, dur: 3200 },
    {
      name: "harbour-1962.mp4",
      kind: "video",
      before: 40 * MB,
      after: 7.8 * MB,
      dur: 9000,
      failAt: 0.58,
      reason: "The video stopped decoding at 0:41, so the file may have been cut short while it was copied.",
    },
    { name: "church-bell.glb", kind: "model", before: 25 * MB, after: 4.1 * MB, dur: 7600 },
  ];
  const PINS = { s1: [30, 34], s2: [62, 22], s3: [52, 66] };
  const TICK = 100;
  const PARALLEL = 2;

  const S = {
    assets: [],
    nodes: [
      { id: "s1", type: "station", name: "Market Square", text: "The square where the town began.", files: [] },
      { id: "s2", type: "station", name: "Cathedral Steps", text: "Look up at the bell tower.", files: [] },
      { id: "s3", type: "station", name: "River Bridge", text: "The oldest crossing of the river.", files: [] },
      { id: "t1", type: "story", name: "The founding legend", text: "A merchant, a storm and a vow.", files: [] },
      { id: "t2", type: "story", name: "The bridge keeper", text: "Who paid the toll, and who did not.", files: [] },
      { id: "i1", type: "item", kind: "image", name: "Old map board", file: null, scale: 1 },
      { id: "i2", type: "item", kind: "model", name: "Church bell", file: null, scale: 1 },
      { id: "i3", type: "item", kind: "video", name: "Harbour film", file: null, scale: 1 },
      { id: "i4", type: "item", kind: "audio", name: "Bell sound", file: null, scale: 1 },
    ],
    sel: "s1",
    card: null,
    pinned: false,
    drawer: false,
    filter: "all",
    armed: null,
    pane: "tree",
    edits: 0,
    landing: new Set(),
    seq: 1,
  };

  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (b) => (b >= MB ? (b / MB).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const nodeById = (id) => S.nodes.find((n) => n.id === id);
  const assetById = (id) => S.assets.find((a) => a.id === id);
  const isPhone = () => window.matchMedia("(width <= 700px)").matches;
  const usesOf = (id) => S.nodes.filter((n) => (n.type === "item" ? n.file === id : n.files.includes(id)));
  const pct = (a) => (a.state === "queued" ? 0 : a.state === "ready" ? 100 : Math.round(a.progress * 100));

  /* ---------- pictures ---------- */
  const ICON = {
    station: '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>',
    story: '<path d="M3 3.5h4a1.5 1.5 0 0 1 1 .5 1.5 1.5 0 0 1 1-.5h4v9H9a1 1 0 0 0-1 1 1 1 0 0 0-1-1H3z"/><path d="M8 4v9.5"/>',
    image: '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="m3 11 3-3 2.5 2.5L10.5 9 13 11.5"/><circle cx="10.5" cy="6" r="1"/>',
    model: '<path d="M8 2.5 13 5v6l-5 2.5L3 11V5z"/><path d="M3 5l5 2.5L13 5M8 7.5v6"/>',
    video: '<rect x="2.5" y="4" width="8" height="8" rx="1"/><path d="m10.5 7 3-2v6l-3-2"/>',
    audio: '<path d="M3 6.5h2.5L9 3.5v9l-3.5-3H3z"/><path d="M11 6a2.8 2.8 0 0 1 0 4M12.5 4.5a5 5 0 0 1 0 7"/>',
  };
  const icon = (k) => `<svg class="i ico" viewBox="0 0 16 16" aria-hidden="true">${ICON[k] || ICON.image}</svg>`;

  const THUMB = {
    image:
      '<svg viewBox="0 0 40 40" preserveAspectRatio="xMidYMid slice"><rect width="40" height="40" fill="#8fb4d9"/><circle cx="28" cy="11" r="5" fill="#f3d48a"/><path d="M0 26 6 19l5 4 6-9 6 8 5-3 6 5 6-3v19H0z" fill="#46566b"/><path d="M0 31h7v-6l4-3 4 3v6h4v-9l5-4 5 4v9h11v9H0z" fill="#2b3442"/></svg>',
    audio:
      '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="#1f3d3a"/><g fill="#5fb3a8"><rect x="7" y="17" width="2.6" height="6" rx="1.3"/><rect x="11.5" y="12" width="2.6" height="16" rx="1.3"/><rect x="16" y="8" width="2.6" height="24" rx="1.3"/><rect x="20.5" y="14" width="2.6" height="12" rx="1.3"/><rect x="25" y="10" width="2.6" height="20" rx="1.3"/><rect x="29.5" y="16" width="2.6" height="8" rx="1.3"/></g></svg>',
    video:
      '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="#2a2340"/><g fill="#3d3460"><rect x="4" y="5" width="4" height="3"/><rect x="12" y="5" width="4" height="3"/><rect x="20" y="5" width="4" height="3"/><rect x="28" y="5" width="4" height="3"/><rect x="4" y="32" width="4" height="3"/><rect x="12" y="32" width="4" height="3"/><rect x="20" y="32" width="4" height="3"/><rect x="28" y="32" width="4" height="3"/></g><path d="M16 13.5v13l11-6.5z" fill="#c9b5ef"/></svg>',
    model:
      '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="#3a2e22"/><path d="M20 8 31 14v12l-11 6-11-6V14z" fill="#8e6a43"/><path d="M20 8 31 14 20 20 9 14z" fill="#e2b77f"/><path d="M20 20v12l11-6V14z" fill="#b5875a"/></svg>',
    other:
      '<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="#2f3136"/><path d="M13 9h10l5 5v17H13z" fill="none" stroke="#8a8f99" stroke-width="1.6"/><path d="M23 9v5h5" fill="none" stroke="#8a8f99" stroke-width="1.6"/></svg>',
  };
  const thumb = (a, cls) =>
    `<span class="th ${cls || ""}">${a.url ? `<img src="${esc(a.url)}" alt="" draggable="false">` : THUMB[a.kind]}</span>`;
  const ring = (a) =>
    `<svg class="ring st-${a.state}" viewBox="0 0 40 40" aria-hidden="true"><circle class="trk" cx="20" cy="20" r="18" pathLength="100"/><circle class="arc" data-arc="${a.id}" cx="20" cy="20" r="18" pathLength="100" stroke-dasharray="${pct(a)} 100"/></svg>`;
  const ringedThumb = (a, cls) => `<span class="ringed">${ring(a)}${thumb(a, cls)}</span>`;

  function stateWords(a) {
    if (a.state === "queued") return "queued";
    if (a.state === "processing") return `optimizing, ${pct(a)}%`;
    if (a.state === "ready") return `ready, ${fmt(a.before)} to ${fmt(a.after)}`;
    return "could not be optimized";
  }

  /* the short line for an asset in use: what the tour gets right now */
  function useNote(a) {
    if (a.state === "queued")
      return `<div class="fnote st-queued">Waiting to be optimized.<span class="orig">The original (${fmt(a.before)}) is used until then.</span></div>`;
    if (a.state === "processing")
      return `<div class="fnote st-processing">Still being optimized, <b data-pct="${a.id}">${pct(a)}%</b>.<span class="orig">The original (${fmt(a.before)}) is used until then; the lighter file replaces it by itself.</span></div><span class="pbar"><i data-bar="${a.id}" style="width:${pct(a)}%"></i></span>`;
    if (a.state === "ready")
      return `<div class="fnote st-ready">Optimized: ${fmt(a.before)} → ${fmt(a.after)}. The tour uses the lighter file.</div>`;
    return `<div class="fnote st-failed">Not optimized: ${esc(a.reason)}<span class="orig">The original (${fmt(a.before)}) is used.</span></div>${
      a.noRetry ? "" : `<button class="linkb" type="button" data-act="retry" data-id="${a.id}">Retry</button>`
    }`;
  }

  function stateBlock(a) {
    if (a.state === "queued")
      return `<div class="sline"><span>Queued</span><span class="pct">0%</span></div><div class="sub">Waits for a free slot. ${esc(KIND[a.kind].how)}.</div><div class="sub">Already usable: the original is used until then.</div>`;
    if (a.state === "processing")
      return `<div class="sline p"><span>Optimizing</span><span class="pct" data-pct="${a.id}">${pct(a)}%</span></div><span class="pbar"><i data-bar="${a.id}" style="width:${pct(a)}%"></i></span><div class="sub">${esc(KIND[a.kind].how)}. Already usable: the original is used until then.</div>`;
    if (a.state === "ready") {
      const save = Math.round((1 - a.after / a.before) * 100);
      return `<div class="sline ok"><span>Ready</span></div><div class="sizes">${fmt(a.before)} → <b>${fmt(a.after)}</b><span class="save">${save}% lighter</span></div><div class="sub">${esc(KIND[a.kind].how)}.</div>`;
    }
    return `<div class="sline bad"><span>Could not optimize</span></div><div class="sub">${esc(a.reason)}</div>`;
  }

  function usesBlock(a) {
    const uses = usesOf(a.id);
    if (!uses.length)
      return `<div class="lab">Used in</div><div class="sub">Nowhere yet. Drag it onto a station, a story or an item, or use "Use in...".</div>`;
    return `<div class="lab">Used in ${uses.length} place${uses.length > 1 ? "s" : ""}</div><div class="jumps">${uses
      .map((n) => `<button class="jump" type="button" data-jump="${n.id}">${icon(n.type === "item" ? n.kind : n.type)}${esc(n.name)}</button>`)
      .join("")}</div>`;
  }

  function actions(a) {
    return `<div class="cacts">${
      a.kind !== "other" ? `<button class="sbtn acc" type="button" data-act="arm" data-id="${a.id}">Use in...</button>` : ""
    }${a.state === "failed" && !a.noRetry ? `<button class="sbtn" type="button" data-act="retry" data-id="${a.id}">Retry</button>` : ""}<button class="sbtn dng" type="button" data-act="delete" data-id="${a.id}">Delete</button></div>`;
  }

  /* ---------- rendering ---------- */
  function renderRail() {
    const ul = $("#chips");
    ul.innerHTML = S.assets
      .map((a) => {
        const n = usesOf(a.id).length;
        return `<li><button class="chip${S.card === a.id ? " on" : ""}${S.landing.has(a.id) ? " landing" : ""}" type="button" data-chip="${a.id}" data-drag-asset="${a.id}" aria-label="${esc(a.name)}, ${stateWords(a)}${n ? `, used in ${n}` : ""}">${ring(a)}${thumb(a)}${
          n ? `<span class="uses" aria-hidden="true">${n}</span>` : ""
        }${a.state === "failed" ? '<span class="bad" aria-hidden="true">!</span>' : ""}</button></li>`;
      })
      .join("");
    $("#railEmpty").hidden = S.assets.length > 0;
    $("#railCount").textContent = S.assets.length;
    $("#railCount").hidden = S.assets.length === 0;
    const working = S.assets.filter((a) => a.state === "queued" || a.state === "processing").length;
    $("#railHead").title = `Open the shelf (${S.assets.length} assets${working ? `, ${working} optimizing` : ""})`;
    $("#railHead").setAttribute("aria-label", $("#railHead").title);
    $("#railHead").setAttribute("aria-expanded", String(S.drawer));
  }

  function treeRow(n) {
    const ids = n.type === "item" ? (n.file ? [n.file] : []) : n.files;
    const minis = ids
      .map(assetById)
      .filter(Boolean)
      .filter((a) => a.state !== "ready")
      .map((a) => `<span class="mini" title="${esc(a.name)}: ${stateWords(a)}">${ring(a)}</span>`)
      .join("");
    return `<button class="trow${S.sel === n.id ? " sel" : ""}" type="button" data-select="${n.id}" data-drop="${n.id}">${icon(
      n.type === "item" ? n.kind : n.type,
    )}<span class="nm">${esc(n.name)}</span>${minis ? `<span class="minis">${minis}</span>` : ""}</button>`;
  }

  function renderTree() {
    const sec = (title, type) =>
      `<div class="tsec">${title}</div>` + S.nodes.filter((n) => n.type === type).map(treeRow).join("");
    $("#treeBody").innerHTML = sec("Stations", "station") + sec("Stories", "story") + sec("Free items", "item");
    $("#pins").innerHTML = Object.entries(PINS)
      .map(([id, [x, y]], i) => {
        const n = nodeById(id);
        const f = n.files.length;
        return `<button class="pin${S.sel === id ? " sel" : ""}" type="button" style="left:${x}%;top:${y}%" data-select="${id}" data-drop="${id}"><span class="dotp"><b>${i + 1}</b></span><span class="pl">${esc(n.name)}</span>${
          f ? `<span class="pf">${f} file${f > 1 ? "s" : ""}</span>` : ""
        }</button>`;
      })
      .join("");
    markTargets();
  }

  function renderInsp() {
    const n = nodeById(S.sel);
    const title = n.type === "item" ? `Item: ${KIND[n.kind].label}` : n.type === "story" ? "Story" : "Station";
    let body = `<label class="fld"><span>Name</span><input type="text" id="fName" value="${esc(n.name)}"></label>`;
    if (n.type === "item") {
      body += `<div class="fld"><span>Kind</span><div class="ro">${KIND[n.kind].label}</div></div>
        <div class="sec" data-drop="${n.id}"><div class="sechead">File</div><div id="inspFiles"></div></div>
        <label class="fld"><span>Size in the world</span><input type="range" id="fScale" min="0.2" max="3" step="0.1" value="${n.scale}"><output id="fScaleOut">${n.scale.toFixed(1)}x</output></label>`;
    } else {
      body += `<label class="fld"><span>Text</span><textarea id="fText" rows="3">${esc(n.text)}</textarea></label>
        <div class="sec" data-drop="${n.id}"><div class="sechead">Files <span class="cnt" id="fileCnt"></span></div><div id="inspFiles"></div></div>`;
    }
    $("#inspInner").innerHTML = `<div class="phead"><button class="sbtn" id="inspBack" type="button" data-act="back">‹ List</button><span class="ptitle">${title}</span></div><div class="pbody">${body}</div>`;
    renderInspFiles();
    markTargets();
  }

  function fileRow(a, n) {
    return `<div class="frow">${ringedThumb(a, "sm")}<div class="fmain"><div class="fname"><button class="linkb" type="button" data-act="openAsset" data-id="${a.id}" title="Show it on the shelf">${esc(a.name)}</button></div>${useNote(a)}</div>${
      n.type === "item"
        ? `<button class="sbtn" type="button" data-act="pick" data-node="${n.id}">Change</button>`
        : `<button class="x" type="button" data-act="detach" data-node="${n.id}" data-id="${a.id}" aria-label="Remove ${esc(a.name)} from ${esc(n.name)}"><svg class="i" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>`
    }</div>`;
  }

  function renderInspFiles() {
    const box = $("#inspFiles");
    if (!box) return;
    const n = nodeById(S.sel);
    if (n.type === "item") {
      const a = n.file && assetById(n.file);
      box.innerHTML = a
        ? fileRow(a, n)
        : `<button class="pickb" type="button" data-act="pick" data-node="${n.id}">${icon(n.kind)}<span>Choose a ${noun(n.kind)} from the shelf, or drag one here</span></button>`;
    } else {
      const rows = n.files.map(assetById).filter(Boolean).map((a) => fileRow(a, n)).join("");
      box.innerHTML = `${rows}<div class="dropin">Drag an asset from the shelf here, or <button class="linkb" type="button" data-act="pick" data-node="${n.id}">choose one</button></div>`;
      const c = $("#fileCnt");
      if (c) c.textContent = n.files.length ? String(n.files.length) : "";
    }
  }

  function renderDrawer() {
    const d = $("#drawer");
    d.setAttribute("aria-hidden", String(!S.drawer));
    d.inert = !S.drawer;
    const groups = {
      all: () => true,
      working: (a) => a.state === "queued" || a.state === "processing",
      ready: (a) => a.state === "ready",
      problems: (a) => a.state === "failed",
    };
    const names = { all: "All", working: "Optimizing", ready: "Ready", problems: "Problems" };
    $("#dfilters").innerHTML = Object.keys(groups)
      .map(
        (k) =>
          `<button class="fchip" type="button" role="tab" aria-selected="${S.filter === k}" data-filter="${k}">${names[k]} ${S.assets.filter(groups[k]).length}</button>`,
      )
      .join("");
    const list = S.assets.filter(groups[S.filter]);
    $("#dlist").innerHTML = list.length
      ? list
          .map(
            (a) =>
              `<div class="drow st-${a.state}"><span class="grabT" data-drag-asset="${a.id}" title="Drag onto a station, a story or an item">${ringedThumb(a, "md")}</span><div class="dmain"><div class="dn"><b>${esc(a.name)}</b><span>${KIND[a.kind].label} · ${fmt(a.before)}</span></div><div class="cstate">${stateBlock(a)}</div><div class="cuses">${usesBlock(a)}</div>${actions(a)}</div></div>`,
          )
          .join("")
      : `<div class="dempty">${S.assets.length ? "Nothing here." : "The shelf is empty.<br>Drop files anywhere on the page, or use Simulate drop."}</div>`;
    const ready = S.assets.filter((a) => a.state === "ready");
    const saved = ready.reduce((s, a) => s + a.before - a.after, 0);
    const working = S.assets.filter(groups.working).length;
    $("#dsum").textContent = S.assets.length
      ? `${S.assets.length} asset${S.assets.length > 1 ? "s" : ""}${working ? `, ${working} optimizing` : ""}${ready.length ? `, ${fmt(saved)} saved for the phone` : ""}`
      : "No assets yet";
  }

  function renderCard() {
    const card = $("#card");
    const a = S.card && assetById(S.card);
    if (!a) {
      card.hidden = true;
      S.card = null;
      return;
    }
    card.hidden = false;
    card.classList.toggle("pinned", S.pinned);
    card.setAttribute("aria-label", a.name);
    card.innerHTML = `<div class="ctop"><span class="grabT" data-drag-asset="${a.id}" title="Drag onto a station, a story or an item">${ringedThumb(a, "big")}</span><div style="flex:1;min-width:0"><div class="cname">${esc(a.name)}</div><div class="cmeta">${KIND[a.kind].label} · ${fmt(a.before)}</div></div><button class="x" type="button" data-act="closeCard" aria-label="Close"><svg class="i" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><div class="cstate">${stateBlock(a)}</div><div class="cuses">${usesBlock(a)}</div>${actions(a)}`;
    positionCard();
  }

  function positionCard() {
    const card = $("#card");
    if (card.hidden || !S.card) return;
    const rail = $("#rail").getBoundingClientRect();
    const chip = $(`#chips [data-chip="${S.card}"]`);
    if (isPhone()) {
      card.style.left = "8px";
      card.style.right = "8px";
      card.style.top = Math.round(rail.bottom + 10) + "px";
      card.style.bottom = "auto";
      card.style.maxHeight = Math.max(160, Math.round(window.innerHeight - rail.bottom - 40)) + "px";
      if (chip) {
        const c = chip.getBoundingClientRect();
        card.style.setProperty("--nx", Math.max(14, Math.round(window.innerWidth - 8 - (c.left + c.width / 2) - 5)) + "px");
      }
      return;
    }
    card.style.left = "auto";
    card.style.bottom = "auto";
    card.style.maxHeight = "";
    card.style.right = Math.round(window.innerWidth - rail.left + 10) + "px";
    const c = chip ? chip.getBoundingClientRect() : rail;
    const h = card.offsetHeight;
    const top = Math.max(46, Math.min(c.top - 14, window.innerHeight - h - 30));
    card.style.top = Math.round(top) + "px";
    card.style.setProperty("--ny", Math.round(Math.max(14, Math.min(h - 14, c.top + c.height / 2 - top))) + "px");
  }

  function renderStatus() {
    const working = S.assets.filter((a) => a.state === "queued" || a.state === "processing").length;
    const failed = S.assets.filter((a) => a.state === "failed").length;
    const parts = [];
    if (working) parts.push(`${working} optimizing`);
    if (failed) parts.push(`${failed} failed`);
    $("#shelfState").innerHTML = `<span class="dot${working ? " p" : ""}"></span>Shelf: ${
      S.assets.length ? parts.join(", ") || "all ready" : "empty"
    }`;
    $("#saveState").textContent = S.edits ? `${S.edits} edit${S.edits > 1 ? "s" : ""} since opening (a prototype saves nothing)` : "All changes saved";
    $("#unsaved").hidden = !S.edits;
  }

  function renderArm() {
    const bar = $("#armBar");
    const a = S.armed && assetById(S.armed);
    document.body.classList.toggle("armed", !!a);
    if (!a) {
      bar.hidden = true;
      markTargets();
      return;
    }
    bar.hidden = false;
    bar.innerHTML = `<span>Where does <b>${esc(a.name)}</b> go? Choose a station, a story or an item.</span><button class="sbtn" type="button" data-act="disarm">Cancel</button>`;
    markTargets();
  }

  function renderAll() {
    renderRail();
    renderTree();
    renderInspFiles();
    renderDrawer();
    renderCard();
    renderStatus();
    renderArm();
    updateLive();
  }

  /* the 100 ms update: rings, bars and numbers only, so typing is never disturbed */
  function updateLive() {
    for (const a of S.assets) {
      const p = pct(a);
      $$(`[data-arc="${a.id}"]`).forEach((c) => c.setAttribute("stroke-dasharray", `${p} 100`));
      $$(`[data-bar="${a.id}"]`).forEach((b) => (b.style.width = p + "%"));
      $$(`[data-pct="${a.id}"]`).forEach((t) => (t.textContent = p + "%"));
    }
    const open = S.assets.filter((a) => a.state === "queued" || a.state === "processing");
    const agg = open.length ? open.reduce((s, a) => s + pct(a), 0) / open.length : 0;
    const arc = $('[data-arc="agg"]');
    arc.setAttribute("stroke-dasharray", `${agg} 100`);
  }

  /* where the dragged or armed asset may go */
  function accepts(n, a) {
    if (!n || !a) return { ok: false, why: "" };
    if (a.kind === "other") return { ok: false, why: "A tour cannot use this kind of file" };
    if (n.type === "item" && n.kind !== a.kind)
      return { ok: false, why: `${n.name} takes a ${noun(n.kind)}` };
    if (n.type === "item" ? n.file === a.id : n.files.includes(a.id)) return { ok: false, why: `Already in ${n.name}` };
    return { ok: true, why: "" };
  }

  function markTargets() {
    const a = (drag && drag.on && assetById(drag.id)) || (S.armed && assetById(S.armed));
    const attr = drag && drag.on ? "data-drop" : "data-select";
    $$("[data-drop],[data-select]").forEach((el) => el.classList.remove("canDrop", "noDrop"));
    if (!a) return;
    $$(`[${attr}]`).forEach((el) => {
      const ok = accepts(nodeById(el.getAttribute(attr)), a).ok;
      el.classList.add(ok ? "canDrop" : "noDrop");
    });
  }

  /* ---------- actions ---------- */
  function useAsset(nodeId, assetId) {
    const n = nodeById(nodeId);
    const a = assetById(assetId);
    const r = accepts(n, a);
    if (!r.ok) {
      toast(r.why + ".", { kind: "bad" });
      return false;
    }
    if (n.type === "item") n.file = a.id;
    else n.files.push(a.id);
    S.edits++;
    toast(
      a.state === "ready"
        ? `${a.name} is now in ${n.name}.`
        : `${a.name} is now in ${n.name}. The original is used until the optimized file is ready.`,
    );
    renderAll();
    flash(nodeId);
    return true;
  }

  function select(id) {
    S.sel = id;
    if (isPhone()) {
      S.pane = "insp";
      closeCard();
      applyPane();
    }
    renderTree();
    renderInsp();
  }

  function flash(id) {
    $$(`[data-select="${id}"]`).forEach((el) => {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
  }

  function applyPane() {
    document.body.dataset.pane = S.pane;
  }

  function openCard(id, pinned) {
    S.card = id;
    S.pinned = pinned;
    renderRail();
    renderCard();
  }
  function closeCard() {
    if (!S.card) return;
    S.card = null;
    S.pinned = false;
    renderRail();
    renderCard();
  }

  function setDrawer(open) {
    S.drawer = open;
    document.body.classList.toggle("drawerOpen", open);
    closeCard();
    renderDrawer();
    renderRail();
    if (open) setTimeout(() => $("#drawer .x").focus({ preventScroll: true }), 30);
  }

  function arm(id) {
    S.armed = id;
    closeCard();
    if (S.drawer && isPhone()) setDrawer(false);
    if (isPhone()) {
      S.pane = "tree";
      applyPane();
    }
    renderArm();
    toast("Choose where it goes. Esc cancels.");
  }
  function disarm() {
    S.armed = null;
    renderArm();
  }

  function retry(id) {
    const a = assetById(id);
    if (!a || a.noRetry) return;
    a.state = "queued";
    a.progress = 0;
    a.reason = "";
    a.seq = S.seq++;
    renderAll();
    toast(`Trying ${a.name} again.`);
  }

  function detach(nodeId, id) {
    const n = nodeById(nodeId);
    n.files = n.files.filter((f) => f !== id);
    S.edits++;
    renderAll();
  }

  function askDelete(id) {
    const a = assetById(id);
    if (!a) return;
    const uses = usesOf(id);
    if (!uses.length) return doDelete(id);
    const dlg = $("#dlg");
    dlg.innerHTML = `<h2>Delete ${esc(a.name)}?</h2><p>It is used in ${uses.length} place${uses.length > 1 ? "s" : ""}. Deleting it takes it out of ${uses.length > 1 ? "them" : "it"}:</p><ul>${uses
      .map((n) => `<li>${esc(n.name)}</li>`)
      .join("")}</ul><div class="dacts"><button class="sbtn" type="button" data-act="dlgCancel">Keep it</button><button class="sbtn del" type="button" data-act="dlgDelete" data-id="${a.id}">Delete and remove from ${uses.length} place${uses.length > 1 ? "s" : ""}</button></div>`;
    dlg.showModal();
    dlg.querySelector('[data-act="dlgCancel"]').focus();
  }

  function doDelete(id) {
    const idx = S.assets.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const a = S.assets[idx];
    const refs = usesOf(id).map((n) => ({ n, pos: n.type === "item" ? -1 : n.files.indexOf(id) }));
    S.assets.splice(idx, 1);
    refs.forEach(({ n }) => (n.type === "item" ? (n.file = null) : (n.files = n.files.filter((f) => f !== id))));
    if (S.card === id) S.card = null;
    if (S.armed === id) S.armed = null;
    if (refs.length) S.edits++;
    renderAll();
    toast(`${a.name} deleted${refs.length ? ` and taken out of ${refs.length} place${refs.length > 1 ? "s" : ""}` : ""}.`, {
      action: "Undo",
      onAction: () => {
        S.assets.splice(Math.min(idx, S.assets.length), 0, a);
        refs.forEach(({ n, pos }) => (n.type === "item" ? (n.file = id) : n.files.splice(pos, 0, id)));
        renderAll();
        toast(`${a.name} is back.`);
      },
    });
  }

  /* ---------- picker for a file field ---------- */
  function openPicker(nodeId, anchor) {
    const n = nodeById(nodeId);
    const p = $("#picker");
    const opts = S.assets
      .slice()
      .sort((x, y) => accepts(n, y).ok - accepts(n, x).ok)
      .map((a) => {
        const r = accepts(n, a);
        return `<button class="popt" type="button" data-act="pickOne" data-node="${n.id}" data-id="${a.id}" ${r.ok ? "" : "disabled"}>${ringedThumb(a, "sm")}<span class="pm"><b>${esc(a.name)}</b><span>${r.ok ? `${KIND[a.kind].label}, ${stateWords(a)}` : esc(r.why)}</span></span></button>`;
      })
      .join("");
    p.innerHTML =
      `<div class="lab" style="padding:6px 8px 2px">From the shelf</div>` +
      (S.assets.length ? opts : `<div class="phint">The shelf is empty. Drop files anywhere on the page, or use Simulate drop.</div>`);
    p.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 16);
    p.style.width = w + "px";
    p.style.left = Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))) + "px";
    const below = window.innerHeight - r.bottom;
    if (below > 200 || below > r.top) {
      p.style.top = Math.round(r.bottom + 4) + "px";
      p.style.bottom = "auto";
      p.style.maxHeight = Math.max(120, below - 36) + "px";
    } else {
      p.style.top = "auto";
      p.style.bottom = Math.round(window.innerHeight - r.top + 4) + "px";
      p.style.maxHeight = Math.max(120, r.top - 50) + "px";
    }
    const first = p.querySelector(".popt:not(:disabled)");
    if (first) first.focus({ preventScroll: true });
  }
  const closePicker = () => ($("#picker").hidden = true);

  /* ---------- adding files ---------- */
  function kindOf(file) {
    const t = file.type || "";
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (t.startsWith("audio/") || ["wav", "mp3", "m4a", "ogg", "flac", "aac"].includes(ext)) return "audio";
    if (t.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "gif"].includes(ext)) return "image";
    if (t.startsWith("video/") || ["mp4", "mov", "webm", "m4v"].includes(ext)) return "video";
    if (["glb", "gltf"].includes(ext)) return "model";
    return "other";
  }

  function makeAsset(spec) {
    const a = {
      seq: S.seq,
      id: "a" + S.seq++,
      name: spec.name,
      kind: spec.kind,
      before: spec.before,
      after: spec.after,
      dur: spec.dur,
      failAt: spec.failAt || 0,
      reason: spec.reason || "",
      url: spec.url || "",
      noRetry: false,
      state: "queued",
      progress: 0,
    };
    if (a.kind === "other") {
      a.state = "failed";
      a.noRetry = true;
      const ext = (a.name.split(".").pop() || "").toLowerCase();
      a.reason = `A tour cannot use .${ext} files. Sounds, pictures, videos and 3D models (.glb) can go on the shelf.`;
    }
    return a;
  }

  function addAssets(specs, origin) {
    const added = specs.map(makeAsset);
    S.assets.unshift(...added);
    added.forEach((a) => S.landing.add(a.id));
    renderAll();
    const chipsBox = $("#chips");
    chipsBox.scrollTop = 0;
    chipsBox.scrollLeft = 0;
    added.forEach((a, i) => fly(a, origin, i * 110));
    const bad = added.filter((a) => a.state === "failed").length;
    toast(
      `${added.length} file${added.length > 1 ? "s" : ""} on the shelf. ${added.length - bad ? "They are optimized while you keep working, and can be used right away." : ""}${bad ? ` ${bad} cannot be used in a tour.` : ""}`,
      { kind: bad ? "bad" : "" },
    );
  }

  function fly(a, origin, delay) {
    const chip = $(`#chips [data-chip="${a.id}"]`);
    const r = chip && chip.getBoundingClientRect();
    const land = () => {
      S.landing.delete(a.id);
      const c = $(`#chips [data-chip="${a.id}"]`);
      if (c) c.classList.remove("landing");
    };
    if (!r || !r.width || !Element.prototype.animate) return land();
    const f = document.createElement("div");
    f.className = "flyer";
    f.style.width = r.width + "px";
    f.style.height = r.height + "px";
    f.innerHTML = thumb(a);
    document.body.append(f);
    const sx = origin.x - r.width / 2;
    const sy = origin.y - r.height / 2;
    const anim = f.animate(
      [
        { transform: `translate(${sx}px,${sy}px) scale(1.7)`, opacity: 0 },
        { transform: `translate(${sx}px,${sy}px) scale(1.5)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${r.left}px,${r.top}px) scale(1)`, opacity: 1 },
      ],
      { duration: 700, delay, easing: "cubic-bezier(.55,0,.2,1)", fill: "both" },
    );
    anim.onfinish = () => {
      f.remove();
      land();
    };
  }

  function addFiles(files, origin) {
    const specs = Array.from(files).map((file) => {
      const kind = kindOf(file);
      const before = Math.max(file.size, 1024);
      return {
        name: file.name,
        kind,
        before,
        after: before * (RATIO[kind] || 1),
        dur: Math.min(12000, 2500 + (before / MB) * 180),
        url: kind === "image" ? URL.createObjectURL(file) : "",
      };
    });
    if (specs.length) addAssets(specs, origin);
  }

  function simulateDrop() {
    closeCard();
    closePicker();
    const ov = $("#drop");
    ov.hidden = false;
    const z = $("#dropZone").getBoundingClientRect();
    const origin = { x: z.left + z.width / 2, y: z.top + z.height / 2 };
    setTimeout(() => {
      ov.hidden = true;
      addAssets(
        SAMPLES.map((s) => ({ ...s })),
        origin,
      );
    }, 900);
  }

  /* ---------- the processing queue, faked ---------- */
  setInterval(() => {
    let changed = false;
    let active = S.assets.filter((a) => a.state === "processing").length;
    const waiting = S.assets.filter((a) => a.state === "queued").sort((x, y) => x.seq - y.seq);
    for (const a of waiting) {
      if (active < PARALLEL) {
        a.state = "processing";
        active++;
        changed = true;
      }
    }
    for (const a of S.assets) {
      if (a.state !== "processing") continue;
      a.progress = Math.min(1, a.progress + TICK / a.dur);
      if (a.failAt && a.progress >= a.failAt) {
        a.state = "failed";
        a.failAt = 0;
        changed = true;
        toast(`${a.name} could not be optimized. Its original is still used. Open it on the shelf to retry.`, { kind: "bad" });
      } else if (a.progress >= 1) {
        a.state = "ready";
        changed = true;
        const n = usesOf(a.id).length;
        toast(`${a.name} is optimized: ${fmt(a.before)} → ${fmt(a.after)}.${n ? ` ${n === 1 ? "1 place now uses" : n + " places now use"} the lighter file.` : ""}`, {
          kind: "ok",
        });
      }
    }
    if (changed) renderAll();
    else updateLive();
  }, TICK);

  /* ---------- toasts ---------- */
  function toast(msg, opts = {}) {
    const box = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast" + (opts.kind ? " " + opts.kind : "");
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (opts.action) {
      const b = document.createElement("button");
      b.className = "sbtn acc";
      b.type = "button";
      b.textContent = opts.action;
      b.addEventListener("click", () => {
        t.remove();
        opts.onAction();
      });
      t.append(b);
    }
    box.append(t);
    const most = window.matchMedia("(width <= 700px), (height <= 560px)").matches ? 1 : 3;
    while (box.children.length > most) box.firstElementChild.remove();
    setTimeout(() => t.remove(), opts.action ? 7000 : 4200);
  }

  /* ---------- dragging a chip (pointer events: mouse and touch alike) ---------- */
  let drag = null;
  let suppressClick = false;

  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("[data-drag-asset]");
    if (!el || e.button !== 0) return;
    drag = { id: el.dataset.dragAsset, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, ghost: null, target: null, src: el };
  });

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
        beginDrag();
      }
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
    },
    { passive: false },
  );

  document.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (drag.on) {
      endDrag(true);
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
    drag = null;
  });
  document.addEventListener("pointercancel", () => {
    if (drag && drag.on) endDrag(false);
    drag = null;
  });

  function beginDrag() {
    const a = assetById(drag.id);
    if (!a) return;
    drag.on = true;
    clearTimeout(hoverT);
    document.body.classList.add("dragging");
    closePicker();
    if (S.card && !S.pinned) closeCard();
    drag.src.classList.add("dragSrc");
    const g = document.createElement("div");
    g.className = "ghost";
    g.innerHTML = `${thumb(a, "sm")}<span class="gt">${esc(a.name)}<span>Drop on a station, a story or an item</span></span>`;
    document.body.append(g);
    drag.ghost = g;
    if (S.drawer && isPhone()) document.body.classList.remove("drawerOpen");
    markTargets();
  }

  function moveDrag(x, y) {
    const g = drag.ghost;
    if (!g) return;
    g.style.transform = `translate(${Math.min(x + 14, window.innerWidth - g.offsetWidth - 4)}px, ${Math.max(4, y - 46)}px)`;
    const hit = document.elementFromPoint(x, y);
    const t = hit && hit.closest("[data-drop]");
    if (drag.target && drag.target !== t) drag.target.classList.remove("over");
    drag.target = t || null;
    const line = g.querySelector(".gt span");
    if (t) {
      t.classList.add("over");
      const n = nodeById(t.dataset.drop);
      const r = accepts(n, assetById(drag.id));
      g.classList.toggle("no", !r.ok);
      line.textContent = r.ok ? `Into ${n.name}` : r.why;
    } else {
      g.classList.remove("no");
      line.textContent = "Drop on a station, a story or an item";
    }
  }

  function endDrag(apply) {
    const d = drag;
    document.body.classList.remove("dragging");
    if (d.ghost) d.ghost.remove();
    if (d.target) d.target.classList.remove("over");
    d.src.classList.remove("dragSrc");
    drag = null;
    if (S.drawer) document.body.classList.add("drawerOpen");
    if (apply && d.target) useAsset(d.target.dataset.drop, d.id);
    markTargets();
  }

  /* ---------- the card on hover (mouse) ---------- */
  let hoverT = 0;
  let leaveT = 0;
  let cardHover = false;
  const rail = $("#rail");
  rail.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse" || (drag && drag.on) || S.pinned || S.drawer) return;
    const c = e.target.closest("[data-chip]");
    if (!c) return;
    clearTimeout(hoverT);
    clearTimeout(leaveT);
    hoverT = setTimeout(() => openCard(c.dataset.chip, false), S.card ? 60 : 260);
  });
  rail.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(hoverT);
    leaveT = setTimeout(() => {
      if (!cardHover && !S.pinned) closeCard();
    }, 260);
  });
  $("#card").addEventListener("pointerenter", () => {
    cardHover = true;
    clearTimeout(leaveT);
  });
  $("#card").addEventListener("pointerleave", (e) => {
    cardHover = false;
    if (e.pointerType !== "mouse") return;
    leaveT = setTimeout(() => {
      if (!S.pinned && !(drag && drag.on)) closeCard();
    }, 300);
  });

  /* ---------- clicks ---------- */
  document.addEventListener("click", (e) => {
    if (suppressClick) return;
    const t = e.target;
    if (!t.closest("#picker") && !t.closest('[data-act="pick"]')) closePicker();

    const chip = t.closest("[data-chip]");
    if (chip) {
      const id = chip.dataset.chip;
      clearTimeout(hoverT);
      if (S.drawer) setDrawer(false);
      if (S.card === id && S.pinned) closeCard();
      else openCard(id, true);
      return;
    }
    const f = t.closest("[data-filter]");
    if (f) {
      S.filter = f.dataset.filter;
      renderDrawer();
      return;
    }
    const j = t.closest("[data-jump]");
    if (j) {
      if (isPhone()) {
        closeCard();
        if (S.drawer) setDrawer(false);
      }
      select(j.dataset.jump);
      flash(j.dataset.jump);
      return;
    }
    const s = t.closest("[data-select]");
    if (s) {
      if (S.armed) {
        const id = S.armed;
        if (useAsset(s.dataset.select, id)) disarm();
        return;
      }
      select(s.dataset.select);
      return;
    }
    const b = t.closest("[data-act]");
    if (!b) {
      if (S.card && S.pinned && !t.closest("#card") && !t.closest("#rail")) closeCard();
      return;
    }
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case "simulate":
        return simulateDrop();
      case "addFiles":
        return $("#fileIn").click();
      case "drawer":
        return setDrawer(!S.drawer);
      case "closeCard":
        return closeCard();
      case "arm":
        return arm(id);
      case "disarm":
        return disarm();
      case "retry":
        return retry(id);
      case "delete":
        return askDelete(id);
      case "dlgCancel":
        return $("#dlg").close();
      case "dlgDelete":
        $("#dlg").close();
        return doDelete(id);
      case "detach":
        return detach(b.dataset.node, id);
      case "openAsset":
        if (S.drawer) setDrawer(false);
        return openCard(id, true);
      case "pick":
        if (!$("#picker").hidden) return closePicker();
        return openPicker(b.dataset.node, b);
      case "pickOne":
        closePicker();
        return useAsset(b.dataset.node, id);
      case "list":
        S.pane = "tree";
        applyPane();
        return;
      case "back":
        S.pane = "tree";
        applyPane();
        return;
      case "menu":
        return toast("The menus are not part of this prototype.");
    }
  });

  /* typing in the inspector: the tree follows, the shelf never interrupts */
  document.addEventListener("input", (e) => {
    const n = nodeById(S.sel);
    if (e.target.id === "fName") {
      n.name = e.target.value;
      $$(`[data-select="${n.id}"] .nm, [data-select="${n.id}"] .pl`).forEach((el) => (el.textContent = n.name));
    } else if (e.target.id === "fText") n.text = e.target.value;
    else if (e.target.id === "fScale") {
      n.scale = Number(e.target.value);
      $("#fScaleOut").textContent = n.scale.toFixed(1) + "x";
    } else return;
    if (!S.typing) {
      S.typing = true;
      S.edits++;
      renderStatus();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "fName" || e.target.id === "fText" || e.target.id === "fScale") S.typing = false;
    if (e.target.id === "fileIn") {
      addFiles(e.target.files, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      e.target.value = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("#dlg").open) return;
    if (!$("#picker").hidden) return closePicker();
    if (drag && drag.on) return endDrag(false);
    if (S.armed) return disarm();
    if (S.card) return closeCard();
    if (S.drawer) return setDrawer(false);
  });

  /* ---------- files dropped anywhere on the page ---------- */
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    $("#drop").hidden = false;
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) $("#drop").hidden = true;
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $("#drop").hidden = true;
    addFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY });
  });

  window.addEventListener("resize", () => {
    positionCard();
    closePicker();
  });

  /* test hooks for the viewport check */
  window.__shelf = { state: S, simulateDrop, useAsset, select };

  applyPane();
  renderInsp();
  renderAll();
})();
