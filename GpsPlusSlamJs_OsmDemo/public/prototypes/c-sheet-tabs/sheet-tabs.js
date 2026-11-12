// HUD prototype C: tabs on the sheet. Every interaction is faked with
// timers; nothing is computed, saved or fetched. Plain script, no modules,
// no libraries.
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const portraitQuery = matchMedia(
    "(max-width: 860px) and (orientation: portrait)",
  );
  const landscapeQuery = matchMedia(
    "(max-width: 860px) and (orientation: landscape)",
  );
  const layout = () =>
    portraitQuery.matches
      ? "portrait"
      : landscapeQuery.matches
        ? "landscape"
        : "desktop";

  const scene = $("#scene");
  const sheet = $("#sheet");
  const root = document.documentElement;

  // ---------- drawn 3D placeholder ----------

  const RAMP = [
    "#2d0b4e",
    "#3b2f80",
    "#2a6f8f",
    "#1f9e89",
    "#6cce59",
    "#fde725",
  ];

  const SCHEMES = [
    { name: "Today", wall: "#b9b2a6", roof: "#8c5a4a", ground: "#2a3040" },
    {
      name: "Architect's model",
      wall: "#eceae4",
      roof: "#d2cec4",
      ground: "#3a3d44",
    },
    { name: "Blueprint", wall: "#2c5aa0", roof: "#5d8fdc", ground: "#173057" },
    {
      name: "Mediterranean",
      wall: "#e9d3a8",
      roof: "#c4643f",
      ground: "#3d3a2c",
    },
    { name: "Nordic", wall: "#c9d3dc", roof: "#59616b", ground: "#28323a" },
    { name: "Pastel", wall: "#f2c6d6", roof: "#a7d3c9", ground: "#36343f" },
    { name: "Road map", wall: "#e8e2d0", roof: "#c9b98f", ground: "#3a3a32" },
    { name: "Night", wall: "#39405a", roof: "#252a3d", ground: "#12151d" },
    { name: "Monochrome", wall: "#9a9a9a", roof: "#6a6a6a", ground: "#2a2a2a" },
    {
      name: "High contrast",
      wall: "#ffffff",
      roof: "#ffd400",
      ground: "#000000",
    },
  ];

  const BUILDINGS = [
    [110, 300, 70, 90, 30],
    [235, 292, 50, 150, 24],
    [520, 296, 80, 110, 30],
    [650, 312, 60, 70, 24],
    [330, 330, 60, 60, 20],
    [590, 365, 70, 85, 28],
    [70, 390, 90, 64, 30],
    [690, 412, 70, 125, 30],
  ];

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
      Math.round(v * f),
    );
    return "rgb(" + c.join(" ") + ")";
  }

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function drawBuildings(scheme) {
    const g = $("#buildings");
    g.textContent = "";
    const sorted = BUILDINGS.slice().sort((a, b) => a[1] - b[1]);
    for (const [x, y, w, h, d] of sorted) {
      const top = y - h;
      const dy = d * 0.5;
      el(
        "polygon",
        {
          points: `${x + w},${y} ${x + w + d},${y - dy} ${x + w + d},${top - dy} ${x + w},${top}`,
          fill: shade(scheme.wall, 0.62),
        },
        g,
      );
      el(
        "rect",
        { x, y: top, width: w, height: h, fill: shade(scheme.wall, 0.86) },
        g,
      );
      el(
        "polygon",
        {
          points: `${x},${top} ${x + d},${top - dy} ${x + w + d},${top - dy} ${x + w},${top}`,
          fill: scheme.roof,
        },
        g,
      );
    }
    $("#ground-rect").setAttribute("fill", scheme.ground);
  }

  function hexPoints(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      pts.push(
        (cx + r * Math.cos(a)).toFixed(1) +
          "," +
          (cy + r * Math.sin(a)).toFixed(1),
      );
    }
    return pts.join(" ");
  }

  function score(q, r) {
    const v = Math.sin(q * 1.7 + r * 0.9) + Math.cos(q * 0.6 - r * 1.3);
    return Math.max(0, Math.min(5, Math.round((v + 2) * 1.25)));
  }

  function drawHexes() {
    const g = $("#hexes");
    const inner = el("g", { transform: "translate(410 372) scale(1 0.42)" }, g);
    const R = 26;
    for (let q = -9; q <= 9; q++) {
      for (let r = -6; r <= 6; r++) {
        const x = R * Math.sqrt(3) * (q + r / 2);
        const y = R * 1.5 * r;
        if (Math.abs(x) > 420 || Math.abs(y) > 230) continue;
        el(
          "polygon",
          {
            points: hexPoints(x, y, R - 1.5),
            fill: RAMP[score(q, r)],
            "fill-opacity": "0.78",
          },
          inner,
        );
      }
    }
    const m = $("#map-cells");
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        if (Math.abs(q + r) > 4) continue;
        const x = 200 + 13 * Math.sqrt(3) * (q + r / 2);
        const y = 164 + 13 * 1.5 * r;
        el(
          "polygon",
          {
            points: hexPoints(x, y, 12),
            fill: RAMP[score(q, r)],
            "fill-opacity": "0.7",
          },
          m,
        );
      }
    }
  }

  // ---------- tabs ----------

  const tabs = $$('[role="tab"]');
  let currentTab = "map";
  let previousTab = "map";

  function selectTab(name, opts) {
    const o = opts || {};
    if (name !== currentTab) previousTab = currentTab;
    currentTab = name;
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      $("#" + t.getAttribute("aria-controls")).hidden = !on;
      if (on && o.focus) t.focus();
    }
    closeDetails(false);
    queueCoverage();
  }

  for (const t of tabs) {
    t.addEventListener("click", () => selectTab(t.dataset.tab));
    t.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(t);
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      selectTab(tabs[j].dataset.tab, { focus: true });
    });
  }

  // A tab carries a pulsing dot while one of its controls is busy.
  const busy = {};
  function setBusy(tab, key, on) {
    busy[tab] = busy[tab] || new Set();
    if (on) busy[tab].add(key);
    else busy[tab].delete(key);
    const t = $("#tab-" + tab);
    const isBusy = busy[tab].size > 0;
    t.dataset.busy = isBusy ? "true" : "false";
    const label = t.querySelector(".tab-label").textContent;
    t.setAttribute("aria-label", isBusy ? label + ", working" : label);
  }

  function setProblem(on) {
    $("#tab-info").dataset.problem = on ? "true" : "false";
  }

  // ---------- toast ----------

  function toast(msg, kind) {
    const item = document.createElement("div");
    item.className =
      "toast-item" + (kind === "error" ? " toast-item--error" : "");
    item.textContent = msg;
    $("#toast-root").appendChild(item);
    setTimeout(() => item.remove(), 4000);
  }

  // ---------- category + cells (strip is canonical, the tab mirrors it) ----------

  const category = $("#category");
  function setCategory(v) {
    category.value = v;
    for (const r of $$('input[name="cat"]')) r.checked = r.value === v;
    for (const n of $$('[data-mirror="category-id"]')) n.textContent = v;
    $("#details-title").textContent = v + " = 160";
  }
  category.addEventListener("change", () => setCategory(category.value));
  for (const r of $$('input[name="cat"]'))
    r.addEventListener("change", () => setCategory(r.value));

  const cells = $("#layer-cells");
  const cellsMirror = $('[data-mirror-of="layer-cells"]');
  const cellsSwitch = $("#cells-switch");
  let cellsTimer = 0;

  function showCells(on) {
    $("#hexes").style.display = on ? "" : "none";
    $("#map-cells").style.display = on ? "" : "none";
    $("#strip-legend").hidden = !on;
    $("#legend-on").hidden = !on;
    $("#legend-off").hidden = on;
    const below = $("#show-below");
    below.disabled = !on;
    if (!on) below.checked = false;
    $("#show-below-hint").textContent = on
      ? "Also draw the cells that score under the bar."
      : "Needs cells. Turn cells on to also draw cells under the bar.";
    queueCoverage();
  }

  function setCells(on) {
    clearTimeout(cellsTimer);
    cells.checked = on;
    cellsMirror.checked = on;
    if (!on) {
      cellsSwitch.removeAttribute("aria-busy");
      cellsMirror.disabled = false;
      setBusy("analysis", "cells", false);
      showCells(false);
      return;
    }
    // Switching on refetches: busy (dimmed, spinner) for about two seconds.
    cellsSwitch.setAttribute("aria-busy", "true");
    cellsMirror.disabled = true;
    setBusy("analysis", "cells", true);
    cellsTimer = setTimeout(() => {
      cellsSwitch.removeAttribute("aria-busy");
      cellsMirror.disabled = false;
      setBusy("analysis", "cells", false);
      showCells(true);
    }, 2000);
  }
  cells.addEventListener("change", () => setCells(cells.checked));
  cellsMirror.addEventListener("change", () => setCells(cellsMirror.checked));

  // ---------- look: rebuild switches and colour schemes ----------

  function rebuild(input, statusEl, label, done) {
    input.disabled = true;
    statusEl.textContent = label;
    setBusy("look", input.id || "scheme", true);
    setTimeout(() => {
      input.disabled = false;
      statusEl.textContent = "";
      setBusy("look", input.id || "scheme", false);
      if (done) done();
    }, 2000);
  }

  for (const input of $$("[data-rebuild]")) {
    input.addEventListener("change", () =>
      rebuild(input, $("#" + input.id + "-status"), "Applying..."),
    );
  }

  const swatchBox = $("#colour-scheme");
  SCHEMES.forEach((s, i) => {
    const lab = document.createElement("label");
    lab.className = "swatch";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "scheme";
    input.value = s.name;
    input.checked = i === 0;
    const chip = document.createElement("span");
    chip.className = "swatch-chip";
    chip.style.background = `linear-gradient(135deg, ${s.wall} 50%, ${s.roof} 50%)`;
    const name = document.createElement("span");
    name.textContent = s.name;
    lab.append(input, chip, name);
    swatchBox.appendChild(lab);
  });

  let schemeBusy = false;
  function applyScheme(name) {
    if (schemeBusy) return;
    schemeBusy = true;
    const radios = $$('input[name="scheme"]');
    for (const r of radios) {
      r.checked = r.value === name;
      r.disabled = true;
    }
    $("#colour-scheme-status").textContent = "Applying colour scheme...";
    setBusy("look", "scheme", true);
    setTimeout(() => {
      for (const r of radios) r.disabled = false;
      $("#colour-scheme-status").textContent = "";
      setBusy("look", "scheme", false);
      drawBuildings(SCHEMES.find((s) => s.name === name) || SCHEMES[0]);
      schemeBusy = false;
    }, 2000);
  }
  swatchBox.addEventListener("change", (e) => applyScheme(e.target.value));

  // ---------- world ----------

  const rd = $("#render-distance");
  function renderDistance() {
    const draw = 2400 * Number(rd.value);
    $("#render-distance-value").textContent =
      "draw " + draw + " m · haze " + Math.round(draw * 0.66) + " m";
  }
  rd.addEventListener("input", renderDistance);

  $("#layer-buildings").addEventListener("change", (e) => {
    $("#buildings").style.display = e.target.checked ? "" : "none";
  });

  // ---------- sun ----------

  const sunTime = $("#sun-time");
  const DAWN = 391;
  const SPAN = 780;
  function sunReadout() {
    const v = Number(sunTime.value) / 1000;
    const m = Math.round(DAWN + v * SPAN);
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    $("#sun-readout").textContent = hh + ":" + mm + " solar time";
    const elev = Math.sin(Math.PI * v);
    const stop = $("#sky").children[1];
    stop.setAttribute("stop-color", elev > 0.35 ? "#3c5c95" : "#2b3a63");
  }
  function stepSun(dir) {
    const step = Math.round((1000 * 15) / SPAN);
    sunTime.value = String(
      Math.max(0, Math.min(1000, Number(sunTime.value) + dir * step)),
    );
    sunReadout();
  }
  sunTime.addEventListener("input", sunReadout);
  $("#sun-forward").addEventListener("click", () => stepSun(1));
  $("#sun-back").addEventListener("click", () => stepSun(-1));

  // ---------- light settings (inside the Sun tab) ----------

  const LIGHT = [
    [
      "light-gain",
      "Sunlit buildings and roads (gain at a high sun)",
      0,
      3,
      0.05,
      1.35,
    ],
    ["light-gain-start", "Gain starts at sun elevation (°)", 0, 60, 1, 20],
    ["light-gain-full", "Gain full at sun elevation (°)", 0, 90, 1, 45],
    ["light-sky", "Sky light on buildings", 0, 2, 0.05, 0.8],
    ["light-ev", "Overall exposure (EV)", -3, 3, 0.1, 0],
    [
      "light-auto",
      "Auto-exposure strength (mostly dawn and dusk darkness)",
      0,
      1,
      0.05,
      0.6,
    ],
  ];
  const lightBox = $("#light-sliders");
  for (const [id, label, min, max, step, value] of LIGHT) {
    const f = document.createElement("label");
    f.className = "field";
    f.innerHTML =
      '<span class="field-head"><span class="row-hint"></span><output class="num"></output></span>' +
      '<input type="range" class="slider">';
    f.querySelector(".row-hint").textContent = label;
    const input = f.querySelector("input");
    Object.assign(input, { id, min, max, step, value });
    input.dataset.default = String(value);
    const out = f.querySelector("output");
    const show = () => {
      out.textContent = Number(input.value).toFixed(step < 1 ? 2 : 0);
      lightReadout();
    };
    input.addEventListener("input", show);
    lightBox.appendChild(f);
    out.textContent = Number(value).toFixed(step < 1 ? 2 : 0);
  }
  function lightReadout() {
    const gain = Number($("#light-gain").value);
    const ev = Number($("#light-ev").value);
    const lit = 65 + (gain - 1.35) * 10 + ev * 5;
    $("#light-readout").textContent = "Lit surfaces " + lit.toFixed(1);
  }

  const lightOpen = $("#light-open");
  const lightDialog = $("#light-dialog");
  function setLight(open, focus) {
    lightDialog.hidden = !open;
    lightOpen.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (currentTab !== "sun") selectTab("sun");
      if (focus !== false) $("#light-gain").focus();
      lightOpen.scrollIntoView({ block: "start" });
    } else if (focus !== false) {
      lightOpen.focus();
    }
  }
  lightOpen.addEventListener("click", () => setLight(lightDialog.hidden));
  $("#light-close").addEventListener("click", () => setLight(false));
  $("#light-reset").addEventListener("click", () => {
    for (const s of $$("input[type=range]", lightBox)) {
      s.value = s.dataset.default;
      s.dispatchEvent(new Event("input"));
    }
    $("#light-ao").checked = true;
  });

  function pressFor(btn, busyLabel, doneLabel, ms) {
    const idle = btn.textContent.trim();
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = busyLabel;
    setTimeout(() => {
      btn.removeAttribute("aria-busy");
      btn.textContent = doneLabel;
      setTimeout(() => {
        btn.textContent = idle;
        btn.disabled = false;
      }, 1200);
    }, ms);
  }
  $("#light-check").addEventListener("click", (e) =>
    pressFor(e.currentTarget, "Checking...", "Margin 6.15", 1200),
  );
  $("#light-copy").addEventListener("click", (e) =>
    pressFor(e.currentTarget, "Copying...", "Copied", 300),
  );

  // ---------- quests (Map tab) ----------

  const questBtn = $("#geo-event");
  const picker = $("#geo-event-picker");
  let raisedFrom = 0;

  function ensureRoom() {
    // On a short phone sheet, raise the sheet just enough for the picker.
    if (layout() !== "portrait") return;
    const map = $("#map");
    const need = 92 + picker.offsetHeight + 8 + 52;
    const short = need - map.clientHeight;
    if (short <= 0) return;
    const cur = sheet.getBoundingClientRect().height;
    raisedFrom = raisedFrom || cur;
    setSheetHeight(cur + short);
  }

  function restoreRoom() {
    if (raisedFrom) setSheetHeight(raisedFrom);
    raisedFrom = 0;
  }

  function findQuest() {
    if (questBtn.getAttribute("aria-busy") === "true") return;
    questBtn.setAttribute("aria-busy", "true");
    questBtn.textContent = "Finding...";
    setBusy("map", "quest", true);
    setTimeout(() => {
      questBtn.removeAttribute("aria-busy");
      questBtn.textContent = "Show Quests";
      setBusy("map", "quest", false);
      $("#quest-readout").hidden = false;
      picker.hidden = false;
      questBtn.setAttribute("aria-expanded", "true");
      ensureRoom();
      queueCoverage();
    }, 1500);
  }
  questBtn.addEventListener("click", findQuest);
  $("#quest-again").addEventListener("click", findQuest);
  $("#quest-clear").addEventListener("click", () => {
    $("#quest-readout").hidden = true;
    picker.hidden = true;
    questBtn.setAttribute("aria-expanded", "false");
    restoreRoom();
    questBtn.focus();
  });

  // ---------- AR, locate, attribution ----------

  function offerAr() {
    $("#enter-ar").hidden = false;
    $("#ar-offer").hidden = false;
    queueCoverage();
  }
  $(".locate-button").addEventListener("click", offerAr);
  $("#enter-ar").addEventListener("click", () =>
    toast("The AR session would start here."),
  );
  $("#ar-offer-enter").addEventListener("click", () => {
    $("#ar-offer").hidden = true;
    toast("The AR session would start here.");
  });
  $("#ar-offer-dismiss").addEventListener("click", () => {
    $("#ar-offer").hidden = true;
  });
  const attrMore = $(".attr-more");
  attrMore.addEventListener("click", () => {
    const open = attrMore.getAttribute("aria-expanded") !== "true";
    attrMore.setAttribute("aria-expanded", open ? "true" : "false");
    toast(
      open
        ? "© OpenStreetMap contributors (ODbL) · Mapterhorn terrain · Mapzen/AWS terrain tiles"
        : "Attribution folded.",
    );
  });

  // ---------- details ----------

  const details = $("#details");
  let detailsOpener = null;
  function openDetails(opener) {
    detailsOpener = opener || null;
    details.hidden = false;
    $("#details-close").focus({ preventScroll: true });
    queueCoverage();
  }
  function closeDetails(restoreFocus) {
    if (details.hidden) return;
    details.hidden = true;
    if (restoreFocus !== false && detailsOpener) detailsOpener.focus();
    queueCoverage();
  }
  $("#details-close").addEventListener("click", () => closeDetails());
  scene.addEventListener("click", (e) => {
    if (e.target.closest(".strip, .loading")) return;
    openDetails(null);
  });

  // ---------- info ----------

  const STATUS_ROWS = [
    ["Cells", "4843 · 1 underground"],
    ["Regions", "5 battleArea"],
    ["Chunks", "127 scored / 208 reused"],
    ["Volumes", "21 (0 parts, 13 guessed building heights, 16 invented roofs)"],
    ["Triangles", "501"],
    ["POI", "9"],
    ["Woods", "648"],
    ["Furniture", "2"],
    ["Roads", "23 (676 tri)"],
    ["Area slabs", "5"],
    ["Ground", "cpu 68.7 ms"],
    ["Tiles", "current"],
    ["Draws", "17 draws / 335,897 tri"],
    [
      "Fetched",
      "6.3 km²: 2.5 x 2.6 km box per tile (1.39x the hexagon it indexes)",
    ],
    ["Terrain", "±30 m nearby / ±40 m in view"],
    ["Rules", "snapshot (live fetch failed and no cache)"],
  ];
  const FULL_STATUS =
    "4843 cells · 1 underground · 5 battleArea regions · 127 chunks scored / 208 reused · 21 volumes (0 parts, 13 guessed building heights, 16 invented roofs) · 501 triangles · 9 POI · 648 woods · 2 furniture · 23 roads (676 tri) · 5 area slabs · ground cpu 68.7 ms · tiles current · 17 draws / 335,897 tri · fetched 6.3 km²: 2.5 x 2.6 km box per tile (1.39x the hexagon it indexes) · terrain ±30 m nearby / ±40 m in view · rules: snapshot (live fetch failed and no cache)";

  function fillStatus(rows, sentence, problem) {
    const dl = $("#status-rows");
    dl.textContent = "";
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    $("#status").textContent = sentence;
    const p = $("#status-problem");
    p.hidden = !problem;
    if (problem) p.lastChild.textContent = " " + problem;
    setProblem(Boolean(problem));
  }

  const PRESETS = ["Default", "Contour", "Glass", "Flat"];
  const presetBtn = $("#tile-preset");
  function cyclePreset() {
    const i =
      (PRESETS.indexOf(presetBtn.textContent.trim()) + 1) % PRESETS.length;
    presetBtn.textContent = PRESETS[i];
    toast("Tile look: " + PRESETS[i]);
  }
  presetBtn.addEventListener("click", cyclePreset);

  // ---------- loading overlay ----------

  function showLoading(ms) {
    $("#loading-overlay").hidden = false;
    $("#status").textContent =
      "Fetching and scoring around 50.92310, 6.94450...";
    setTimeout(() => {
      $("#loading-overlay").hidden = true;
      fillStatus(
        STATUS_ROWS,
        FULL_STATUS,
        "Rules: snapshot (live fetch failed and no cache)",
      );
    }, ms);
  }

  // ---------- phone sheet: drag and keys ----------

  function setSheetHeight(px) {
    const min = 170;
    const max = Math.round(innerHeight * 0.85);
    const h = Math.max(min, Math.min(max, Math.round(px)));
    root.style.setProperty("--sheet-h", h + "px");
    queueCoverage();
  }

  const handle = $("#sheet-handle");
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    drag = { y: e.clientY, h: sheet.getBoundingClientRect().height };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    raisedFrom = 0;
    setSheetHeight(drag.h + (drag.y - e.clientY));
  });
  handle.addEventListener("pointerup", () => {
    drag = null;
  });
  handle.addEventListener("keydown", (e) => {
    const h = sheet.getBoundingClientRect().height;
    if (e.key === "ArrowUp") setSheetHeight(h + 40);
    else if (e.key === "ArrowDown") setSheetHeight(h - 40);
    else return;
    e.preventDefault();
  });

  // ---------- keyboard ----------

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && t.matches && t.matches("input, select, textarea");
    if (e.key === "Escape") {
      if (typing) t.blur();
      if (!$("#states-pop").hidden) return toggleStates(false);
      if (!details.hidden) return closeDetails();
      if (!lightDialog.hidden) return setLight(false);
      if (currentTab !== "map") return selectTab("map", { focus: true });
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "t") stepSun(1);
    else if (e.key === "T") stepSun(-1);
    else if (e.key === "l") setLight(lightDialog.hidden);
    else if (e.key === "p") cyclePreset();
    else if (e.key === "?") {
      if (currentTab === "info") selectTab(previousTab);
      else {
        selectTab("info");
        $("#hotkey-help").scrollIntoView({ block: "nearest" });
      }
    } else return;
    e.preventDefault();
  });

  // ---------- coverage hook ----------

  function band() {
    const s = scene.getBoundingClientRect();
    const b = { left: s.left, top: s.top, right: s.right, bottom: s.bottom };
    if (layout() === "portrait")
      b.bottom = Math.min(b.bottom, sheet.getBoundingClientRect().top);
    return b;
  }

  function visible(node) {
    if (node.hidden || node.closest("[hidden]")) return false;
    return node.getClientRects().length > 0;
  }

  // Share of the visible 3D band (the 3D view minus the part under the
  // sheet) that HUD chrome ([data-hud]) covers, sampled every 2 px.
  function hudCoverage() {
    const b = band();
    const rects = $$("[data-hud]")
      .filter(visible)
      .map((n) => n.getBoundingClientRect());
    let total = 0;
    let hit = 0;
    for (let y = b.top + 1; y < b.bottom; y += 2) {
      for (let x = b.left + 1; x < b.right; x += 2) {
        total++;
        for (const r of rects) {
          if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
            hit++;
            break;
          }
        }
      }
    }
    return total ? Math.round((hit / total) * 1000) / 1000 : 0;
  }
  hudCoverage.detail = () => {
    const b = band();
    return {
      coverage: hudCoverage(),
      layout: layout(),
      bandWidth: Math.round(b.right - b.left),
      bandHeight: Math.round(b.bottom - b.top),
      viewport: innerWidth + "x" + innerHeight,
      tab: currentTab,
    };
  };
  window.hudCoverage = hudCoverage;

  let coverageQueued = 0;
  function queueCoverage() {
    cancelAnimationFrame(coverageQueued);
    coverageQueued = requestAnimationFrame(() => {
      const d = hudCoverage.detail();
      $("#coverage-out").textContent =
        (d.coverage * 100).toFixed(1) +
        " % of a " +
        d.bandWidth +
        " x " +
        d.bandHeight +
        " px band";
    });
  }
  addEventListener("resize", queueCoverage);

  // ---------- state switcher (prototype tooling) ----------

  function reset() {
    selectTab("map");
    setLight(false, false);
    closeDetails(false);
    setCells(false);
    picker.hidden = true;
    $("#quest-readout").hidden = true;
    questBtn.setAttribute("aria-expanded", "false");
    restoreRoom();
    $("#toast-root").textContent = "";
    $("#ar-offer").hidden = true;
    $("#enter-ar").hidden = true;
    $("#loading-overlay").hidden = true;
    fillStatus(
      STATUS_ROWS,
      FULL_STATUS,
      "Rules: snapshot (live fetch failed and no cache)",
    );
  }

  const STATES = {
    resting: () => {},
    analysis: () => selectTab("analysis"),
    world: () => selectTab("world"),
    look: () => selectTab("look"),
    sun: () => selectTab("sun"),
    light: () => setLight(true, false),
    info: () => selectTab("info"),
    applying: () => {
      selectTab("look");
      applyScheme("Nordic");
    },
    "applying-away": () => {
      selectTab("look");
      applyScheme("Blueprint");
      selectTab("map");
    },
    "cells-on": () => setCells(true),
    "cells-shown": () => {
      cells.checked = true;
      cellsMirror.checked = true;
      showCells(true);
    },
    quest: () => findQuest(),
    "quest-found": () => {
      $("#quest-readout").hidden = false;
      picker.hidden = false;
      questBtn.setAttribute("aria-expanded", "true");
      ensureRoom();
    },
    error: () => toast("Location permission denied.", "error"),
    loading: () => showLoading(3000),
    ar: () => offerAr(),
    details: () => openDetails(null),
    failed: () => {
      fillStatus(
        [["State", "Failed: simulated worker death"]],
        "Failed: simulated worker death",
        "Failed: simulated worker death",
      );
      toast("Failed: simulated worker death", "error");
    },
  };

  const LABELS = {
    resting: "Resting",
    analysis: "Analysis tab",
    world: "World tab",
    look: "Look tab",
    sun: "Sun tab",
    light: "Light open",
    info: "Info tab",
    applying: "Applying scheme",
    "applying-away": "Applying, on Map",
    "cells-on": "Cells loading",
    "cells-shown": "Cells on",
    quest: "Finding quest",
    "quest-found": "Quest found",
    error: "Error toast",
    loading: "Loading",
    ar: "AR reachable",
    details: "Details open",
    failed: "Worker died",
  };

  function showState(name) {
    if (!STATES[name]) return;
    reset();
    STATES[name]();
    queueCoverage();
  }

  const grid = $("#states-grid");
  for (const name of Object.keys(STATES)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = LABELS[name];
    b.addEventListener("click", () => {
      showState(name);
      history.replaceState(null, "", "?state=" + name);
    });
    grid.appendChild(b);
  }

  const statesBtn = $("#states-btn");
  function toggleStates(open) {
    $("#states-pop").hidden = !open;
    statesBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) queueCoverage();
    else statesBtn.focus();
  }
  statesBtn.addEventListener("click", () =>
    toggleStates($("#states-pop").hidden),
  );

  // ---------- boot ----------

  drawBuildings(SCHEMES[0]);
  drawHexes();
  showCells(false);
  sunReadout();
  renderDistance();
  lightReadout();
  if (portraitQuery.matches) setSheetHeight(innerHeight * 0.45);
  fillStatus(
    STATUS_ROWS,
    FULL_STATUS,
    "Rules: snapshot (live fetch failed and no cache)",
  );
  const wanted = new URLSearchParams(location.search).get("state");
  if (wanted) showState(wanted);
  if (new URLSearchParams(location.search).get("notes") === "1")
    toggleStates(true);
  queueCoverage();
})();
