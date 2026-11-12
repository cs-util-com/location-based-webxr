/* Prototype A - command bar and settings drawer.
   Visual behaviour only: nothing here computes anything real. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const body = document.body;
  const phoneQuery = window.matchMedia("(max-width: 860px)");
  const isPhone = () => phoneQuery.matches;

  /* ---------- Scene placeholder ---------- */

  const SCHEMES = {
    Today: ["#b9b2a6", "#8f897f", "#6f6a63", "#c0583a"],
    "Architect's model": ["#f2f0ea", "#d2cfc6", "#ffffff", "#e6e3db"],
    Blueprint: ["#2f5d9e", "#24497d", "#4a80c9", "#7fb0ff"],
    Mediterranean: ["#ead2ae", "#cbb08a", "#f1e2c8", "#c0583a"],
    Nordic: ["#dfe4e8", "#b8c0c7", "#eef1f3", "#3d4b58"],
    Pastel: ["#f3c9d6", "#d9a9bb", "#fbe3ea", "#a9d6e5"],
    "Road map": ["#ece6d8", "#d1cab9", "#f6f1e6", "#e0a458"],
    Night: ["#2b3142", "#20252f", "#363d52", "#4a5372"],
    Monochrome: ["#bdbdbd", "#949494", "#d6d6d6", "#707070"],
    "High contrast": ["#ffffff", "#9a9a9a", "#ffffff", "#ffd400"],
  };
  const HEAT = [
    "#3b0f4f",
    "#46327e",
    "#365c8d",
    "#277f8e",
    "#1fa187",
    "#4ac16d",
    "#a0da39",
    "#fde725",
  ];
  const CAM_H = 60;
  const FOCAL = 520;
  const HORIZON = 300;

  function project(x, z, y) {
    return [500 + (x * FOCAL) / z, HORIZON + ((CAM_H - (y || 0)) * FOCAL) / z];
  }

  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function poly(points, attrs, parent) {
    return el(
      "polygon",
      Object.assign(
        { points: points.map((p) => p.join(",")).join(" ") },
        attrs,
      ),
      parent,
    );
  }

  function score(x, z) {
    const a = Math.sin(x / 55) * Math.cos(z / 70);
    const b = Math.sin((x + z) / 90);
    return Math.max(0, Math.min(1, 0.5 + 0.35 * a + 0.25 * b));
  }

  function drawCells() {
    const g = $("scene-cells");
    const r = 18;
    const w = Math.sqrt(3) * r;
    for (let row = 0; row < 26; row++) {
      const z = 70 + row * r * 1.5;
      for (let col = -18; col <= 18; col++) {
        const x = col * w + (row % 2 ? w / 2 : 0);
        if (Math.abs(x) > z * 1.1) continue;
        const s = score(x, z);
        if (s < 0.22) continue;
        const corners = [];
        for (let k = 0; k < 6; k++) {
          const ang = (Math.PI / 3) * k + Math.PI / 6;
          corners.push(
            project(x + r * 0.92 * Math.cos(ang), z + r * 0.92 * Math.sin(ang)),
          );
        }
        poly(
          corners,
          {
            fill: HEAT[Math.min(7, Math.floor(s * 8))],
            "fill-opacity": "0.78",
          },
          g,
        );
      }
    }
  }

  function drawRoads() {
    const g = $("scene-roads");
    poly(
      [project(-22, 60), project(22, 60), project(22, 900), project(-22, 900)],
      { fill: "#3a4252" },
      g,
    );
    poly(
      [
        project(-700, 210),
        project(700, 210),
        project(700, 240),
        project(-700, 240),
      ],
      { fill: "#3a4252" },
      g,
    );
    const m = $("scene-markings");
    for (let i = -18; i <= 14; i += 8) {
      poly(
        [
          project(i, 180),
          project(i + 4, 180),
          project(i + 4, 198),
          project(i, 198),
        ],
        { fill: "#e8e8e8", "fill-opacity": "0.85" },
        m,
      );
    }
    poly(
      [
        project(30, 250),
        project(110, 250),
        project(110, 330),
        project(30, 330),
      ],
      { fill: "#5b6070", "fill-opacity": "0.8" },
      m,
    );
  }

  function drawLanduse() {
    const g = $("scene-landuse");
    const patches = [
      [-260, 120, 140, 160, "#3f6b45"],
      [120, 380, 180, 200, "#6b5a3a"],
      [-420, 420, 200, 220, "#3f6b45"],
    ];
    patches.forEach(([x, z, w, d, c]) => {
      poly(
        [
          project(x, z),
          project(x + w, z),
          project(x + w, z + d),
          project(x, z + d),
        ],
        { fill: c, class: "landuse-patch" },
        g,
      );
    });
  }

  function drawWoods() {
    const g = $("scene-woods");
    for (let i = 0; i < 70; i++) {
      const x = -520 + ((i * 37) % 300);
      const z = 520 + ((i * 53) % 260);
      const [sx, sy] = project(x, z);
      const r = 2600 / z;
      el("circle", { cx: sx, cy: sy - r, r, fill: "#24402c" }, g);
    }
  }

  function drawTrees() {
    const g = $("scene-trees");
    for (let z = 90; z < 600; z += 45) {
      [-34, 34].forEach((x) => {
        const [sx, sy] = project(x, z);
        const h = 900 / z;
        el(
          "rect",
          {
            x: sx - h * 0.08,
            y: sy - h,
            width: h * 0.16,
            height: h,
            fill: "#3b2d22",
          },
          g,
        );
        el(
          "circle",
          { cx: sx, cy: sy - h * 1.2, r: h * 0.5, fill: "#2f5a37" },
          g,
        );
      });
    }
  }

  function drawFurniture() {
    const g = $("scene-furniture");
    for (let z = 110; z < 500; z += 60) {
      [-27, 27].forEach((x) => {
        const [sx, sy] = project(x, z);
        const h = 1300 / z;
        el(
          "rect",
          {
            x: sx - 1,
            y: sy - h,
            width: 2,
            height: h,
            fill: "#c9cdd6",
          },
          g,
        );
        el("circle", { cx: sx, cy: sy - h, r: 2.2, fill: "#ffe7a0" }, g);
      });
    }
  }

  const BUILDINGS = [
    [-210, 260, 90, 70, 70, false],
    [-120, 330, 70, 60, 110, true],
    [80, 280, 80, 60, 55, true],
    [170, 360, 90, 90, 140, false],
    [-330, 420, 120, 80, 90, true],
    [60, 470, 70, 70, 80, false],
    [-160, 150, 60, 50, 38, true],
    [110, 150, 70, 50, 44, true],
    [300, 520, 110, 90, 160, false],
    [-60, 600, 80, 80, 120, true],
  ];

  function drawBuildings() {
    const g = $("scene-buildings");
    g.textContent = "";
    const [front, side, roof, invented] =
      SCHEMES[state.scheme] || SCHEMES.Today;
    const order = BUILDINGS.slice().sort((a, b) => b[1] - a[1]);
    order.forEach(([x, z, w, d, h, noRoof]) => {
      const x0 = x;
      const x1 = x + w;
      const z0 = z;
      const z1 = z + d;
      const stroke = state.scheme === "High contrast" ? "#000" : "none";
      const visibleSide = x1 < 0 ? x1 : x0;
      poly(
        [
          project(visibleSide, z0, 0),
          project(visibleSide, z1, 0),
          project(visibleSide, z1, h),
          project(visibleSide, z0, h),
        ],
        { fill: side, stroke },
        g,
      );
      poly(
        [
          project(x0, z0, 0),
          project(x1, z0, 0),
          project(x1, z0, h),
          project(x0, z0, h),
        ],
        { fill: front, stroke },
        g,
      );
      poly(
        [
          project(x0, z0, h),
          project(x1, z0, h),
          project(x1, z1, h),
          project(x0, z1, h),
        ],
        { fill: roof, stroke },
        g,
      );
      if (noRoof && state.roofs) {
        const mid = (z0 + z1) / 2;
        const rh = h + Math.min(w, d) * 0.45;
        poly(
          [
            project(x0, z0, h),
            project(x1, z0, h),
            project(x1, mid, rh),
            project(x0, mid, rh),
          ],
          { fill: invented, stroke },
          g,
        );
      }
      if (state.scheme === "Night") {
        for (let k = 1; k < 4; k++) {
          const [wx, wy] = project(x0 + (w * k) / 4, z0, (h * 2) / 3);
          el(
            "rect",
            { x: wx - 2, y: wy, width: 4, height: 5, fill: "#ffd77a" },
            g,
          );
        }
      }
    });
  }

  function drawNpc() {
    const g = $("scene-npc");
    const [sx, sy] = project(-6, 140);
    el(
      "circle",
      {
        cx: sx,
        cy: sy - 6,
        r: 13,
        fill: "none",
        stroke: "#f2971f",
        "stroke-width": 2,
      },
      g,
    );
    el("circle", { cx: sx, cy: sy - 6, r: 6, fill: "#f2971f" }, g);
  }

  function drawMapCells() {
    const g = $("map-cells");
    const r = 14;
    const w = Math.sqrt(3) * r;
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 26; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0);
        const cy = row * r * 1.5;
        const s = score(cx - 300, cy + 100);
        if (s < 0.22) continue;
        const pts = [];
        for (let k = 0; k < 6; k++) {
          const ang = (Math.PI / 3) * k + Math.PI / 6;
          pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
        poly(
          pts,
          {
            fill: HEAT[Math.min(7, Math.floor(s * 8))],
            "fill-opacity": "0.55",
          },
          g,
        );
      }
    }
  }

  /* ---------- State ---------- */

  const state = {
    scheme: "Today",
    roofs: true,
    panel: "none",
    opener: null,
    lastSection: null,
    lightFromDrawer: false,
    busy: new Set(),
    tileLook: 0,
  };
  const TILE_LOOKS = ["Default", "Soft hexes", "Outlined", "Flat tint"];

  function syncScene() {
    const show = (id, on) => {
      $(id).style.display = on ? "" : "none";
    };
    const cells =
      $("layer-cells").checked && !$("cells-pill").hasAttribute("aria-busy");
    show("scene-cells", cells);
    show("map-cells", cells);
    show("scene-buildings", $("layer-buildings").checked);
    show("scene-trees", $("layer-trees").checked);
    show("scene-woods", $("layer-woods").checked);
    show("scene-roads", $("layer-roads").checked);
    show("scene-landuse", $("layer-plates").checked);
    show("scene-markings", $("markings").checked && $("layer-roads").checked);
    show("scene-furniture", $("layer-furniture").checked);
    $("scene-landuse").style.opacity = $("layer-tint").checked
      ? "0.85"
      : "0.35";
    show("scene-ground", $("ground-mode").value !== "No ground");
    $("legend-plate").hidden = !cells;
    body.dataset.cells = cells ? "on" : "off";
    $("legend-name").textContent = $("category").value;
  }

  /* ---------- Panels: one at a time ---------- */

  const PANELS = {
    drawer: { el: "drawer", opener: "settings-open" },
    details: { el: "details", opener: null },
    light: { el: "light-dialog", opener: "light-open" },
    stats: { el: "stats-card", opener: "info-open" },
    sun: { el: "sun-pop", opener: "sun-chip" },
    quest: { el: "geo-event-picker", opener: "geo-event" },
  };

  function setExpanded(name, open) {
    const id = PANELS[name].opener;
    if (id) $(id).setAttribute("aria-expanded", open ? "true" : "false");
  }

  function placePopover(name) {
    const pop = $(PANELS[name].el);
    if (isPhone()) {
      pop.style.left = "";
      return;
    }
    const opener = $(PANELS[name].opener).getBoundingClientRect();
    const width = pop.offsetWidth;
    let left = opener.left;
    left = Math.min(left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    pop.style.left = left + "px";
  }

  function openPanel(name, opts) {
    const options = opts || {};
    if (state.panel === name) return;
    closePanel({ silent: true });
    state.panel = name;
    state.opener = document.activeElement;
    const node = $(PANELS[name].el);
    node.hidden = false;
    setExpanded(name, true);
    body.dataset.panel = name;
    if (["sun", "quest", "stats"].includes(name)) placePopover(name);
    if (name === "drawer") {
      node.dataset.detent = options.detent || "half";
      syncGrabLabel();
      if (options.section) expandSection(options.section, true);
      else if (state.lastSection) expandSection(state.lastSection, true);
    }
    if (!options.noFocus) {
      const target = node.querySelector(
        "button:not([disabled]), select, input:not([disabled])",
      );
      if (target) target.focus({ preventScroll: true });
    }
    updateCoverage();
  }

  function closePanel(opts) {
    const options = opts || {};
    if (state.panel === "none") return;
    const name = state.panel;
    $(PANELS[name].el).hidden = true;
    setExpanded(name, false);
    state.panel = "none";
    body.dataset.panel = "none";
    if (!options.silent) {
      if (name === "light" && state.lightFromDrawer) {
        state.lightFromDrawer = false;
        openPanel("drawer", { section: "sun" });
        $("light-open").focus();
        return;
      }
      const back = PANELS[name].opener ? $(PANELS[name].opener) : state.opener;
      if (back && back.isConnected && back.offsetParent !== null) back.focus();
    }
    updateCoverage();
  }

  function togglePanel(name, opts) {
    if (state.panel === name) closePanel();
    else openPanel(name, opts);
  }

  /* ---------- Drawer sections ---------- */

  function expandSection(key, open) {
    document.querySelectorAll(".sect").forEach((sect) => {
      const head = sect.querySelector(".sect-head");
      const bodyEl = sect.querySelector(".sect-body");
      const mine = sect.dataset.sect === key;
      const want = mine ? open : false;
      head.setAttribute("aria-expanded", want ? "true" : "false");
      bodyEl.hidden = !want;
    });
    if (open) state.lastSection = key;
  }

  function syncGrabLabel() {
    const full = $("drawer").dataset.detent === "full";
    $("drawer-grab").setAttribute(
      "aria-label",
      full ? "Shrink settings" : "Expand settings",
    );
  }

  const LAYER_IDS = [
    "layer-buildings",
    "layer-trees",
    "layer-woods",
    "layer-roads",
    "layer-plates",
    "layer-poi",
    "layer-tint",
  ];

  function summaries() {
    const on = LAYER_IDS.filter((id) => $(id).checked).length;
    const look = [$("colour-scheme").value];
    if ($("invented-roofs").checked) look.push("roofs");
    if ($("markings").checked) look.push("zebras");
    if ($("layer-furniture").checked) look.push("furniture");
    const analysis = [];
    analysis.push($("layer-areas").checked ? "areas on" : "areas off");
    if ($("show-below").checked) analysis.push("below threshold");
    const debug = [];
    if ($("layer-underground").checked) debug.push("underground");
    if ($("perf-stats").checked) debug.push("perf");
    const sums = {
      analysis: analysis.join(" · "),
      world:
        on + " of " + LAYER_IDS.length + " layers · " + $("ground-mode").value,
      look: look.join(" · "),
      sun: $("sun-date").value + " · " + clock($("sun-time").value),
      view:
        "draw " +
        2400 * $("render-distance").value +
        " m · " +
        TILE_LOOKS[state.tileLook],
      debug: debug.length ? debug.join(" · ") : "all off · keyboard list",
    };
    document.querySelectorAll(".sect-sum").forEach((node) => {
      const key = node.dataset.sum;
      const busy = key === "look" && state.busy.size > 0;
      node.dataset.busy = busy ? "true" : "false";
      node.textContent = busy ? "Applying..." : sums[key];
    });
  }

  /* ---------- Rebuild switches (async feedback) ---------- */

  function rebuild(controlId, statusId, label, after) {
    const control = $(controlId);
    const status = $(statusId);
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    status.dataset.busy = "true";
    status.textContent = "Applying " + label + "...";
    state.busy.add(controlId);
    syncBusy();
    window.setTimeout(() => {
      control.disabled = false;
      control.removeAttribute("aria-busy");
      status.dataset.busy = "false";
      status.textContent = status.dataset.idle;
      state.busy.delete(controlId);
      if (after) after();
      syncBusy();
    }, 2000);
  }

  function syncBusy() {
    const btn = $("settings-open");
    const busy = state.busy.size > 0;
    btn.dataset.busy = busy ? "true" : "false";
    $("settings-label").textContent = busy ? "Applying..." : "Settings";
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    summaries();
  }

  /* ---------- Sun ---------- */

  function clock(v) {
    const minutes = Math.round(380 + Number(v) * 0.8);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function setSun(v, source) {
    const value = Math.max(0, Math.min(1000, Number(v)));
    if (source !== "drawer") $("sun-time").value = value;
    if (source !== "quick") $("sun-time-quick").value = value;
    const time = clock(value);
    $("sun-readout").textContent = time + " solar time";
    $("sun-pop-readout").textContent = time + " solar time";
    $("sun-chip-time").textContent = time;
    $("sun-chip").setAttribute("aria-label", "Sun " + time);
    const t = value / 1000;
    const sun = $("scene-sun");
    sun.setAttribute("cx", String(80 + t * 840));
    sun.setAttribute("cy", String(290 - Math.sin(t * Math.PI) * 220));
    summaries();
  }

  function stepSun(dir) {
    setSun(Number($("sun-time").value) + dir * 19);
  }

  /* ---------- Status card ---------- */

  const STATUS_OK =
    "4843 cells · 1 underground · 5 battleArea regions · 127 chunks scored / 208 reused · 21 volumes (0 parts, 13 guessed building heights, 16 invented roofs) · 501 triangles · 9 POI · 648 woods · 2 furniture · 23 roads (676 tri) · 5 area slabs · ground cpu 68.7 ms · tiles current · 17 draws / 335,897 tri · fetched 6.3 km²: 2.5 x 2.6 km box per tile (1.39x the hexagon it indexes) · terrain ±30 m nearby / ±40 m in view · rules: snapshot (live fetch failed and no cache)";

  const KV = [
    ["cells", "4843 · 1 underground"],
    ["regions", "5 battleArea"],
    ["chunks", "127 scored / 208 reused"],
    ["volumes", "21 · 13 guessed heights · 16 invented roofs"],
    ["triangles", "501"],
    ["POI", "9"],
    ["woods", "648"],
    ["furniture", "2"],
    ["roads", "23 (676 tri)"],
    ["area slabs", "5"],
    ["ground", "cpu 68.7 ms"],
    ["draws", "17 / 335,897 tri"],
    ["fetched", "6.3 km² · 2.5 x 2.6 km box per tile"],
    ["terrain", "±30 m nearby / ±40 m in view"],
  ];

  function fillStats() {
    const dl = $("stats-kv");
    dl.textContent = "";
    KV.forEach(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    });
  }

  function setStatus(level, text, alertText) {
    $("status").textContent = text;
    $("status-lamp").dataset.level = level;
    const headline = {
      ok: "tiles current",
      warn: "tiles current",
      busy: "loading...",
      bad: "failed",
    };
    $("stats-headline").textContent = headline[level];
    const alert = $("stats-alert");
    alert.hidden = !alertText;
    alert.dataset.level = level === "bad" ? "bad" : "warn";
    $("stats-alert-text").textContent = alertText || "";
    $("stats-kv").hidden = level === "busy" || level === "bad";
  }

  /* ---------- Toast ---------- */

  function toast(text, kind) {
    const root = $("toast-root");
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.kind = kind || "info";
    node.textContent = text;
    root.appendChild(node);
    window.setTimeout(() => node.remove(), kind === "sticky" ? 600000 : 5000);
  }

  /* ---------- Light settings ---------- */

  const LIGHT = [
    [
      "light-gain",
      "Sunlit buildings and roads (gain at a high sun)",
      0,
      3,
      0.05,
      1.6,
    ],
    ["light-gain-start", "Gain starts at sun elevation (°)", 0, 60, 1, 12],
    ["light-gain-full", "Gain full at sun elevation (°)", 0, 90, 1, 45],
    ["light-sky", "Sky light on buildings", 0, 2, 0.05, 0.8],
    ["light-ev", "Overall exposure (EV)", -3, 3, 0.1, 0],
    [
      "light-auto",
      "Auto-exposure strength (mostly dawn and dusk darkness)",
      0,
      1,
      0.05,
      0.5,
    ],
  ];

  function buildLight() {
    const host = $("light-sliders");
    LIGHT.forEach(([id, label, min, max, step, value]) => {
      const row = document.createElement("div");
      row.className = "light-row";
      row.innerHTML =
        '<div class="light-line"><label for="' +
        id +
        '">' +
        label +
        '</label><output id="' +
        id +
        '-out">' +
        value +
        "</output></div>" +
        '<input class="slider" type="range" id="' +
        id +
        '" min="' +
        min +
        '" max="' +
        max +
        '" step="' +
        step +
        '" value="' +
        value +
        '">';
      host.appendChild(row);
      row.querySelector("input").addEventListener("input", (e) => {
        $(id + "-out").textContent = e.target.value;
      });
    });
    const ao = document.createElement("div");
    ao.className = "row light-ao";
    ao.innerHTML =
      '<label class="row-label" for="light-ao">ambient occlusion</label>' +
      '<input id="light-ao" class="switch" type="checkbox" checked>';
    host.appendChild(ao);
  }

  function busyButton(id, busyText, doneText, ms) {
    const btn = $(id);
    const idle = btn.textContent.trim();
    btn.disabled = true;
    btn.textContent = busyText;
    window.setTimeout(() => {
      btn.disabled = false;
      btn.textContent = doneText;
      btn.dataset.done = "true";
      window.setTimeout(() => {
        btn.textContent = idle;
        btn.dataset.done = "false";
      }, 1600);
    }, ms);
  }

  /* ---------- Coverage hook ---------- */

  function visible(node) {
    if (node.hidden) return false;
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function hudCoverage() {
    const pane = $("scene-pane").getBoundingClientRect();
    const sheet = isPhone() ? $("map").getBoundingClientRect() : null;
    const huds = Array.from(document.querySelectorAll("[data-hud]"))
      .filter(visible)
      .map((n) => n.getBoundingClientRect());
    let total = 0;
    let covered = 0;
    const step = 4;
    for (let y = pane.top + step / 2; y < pane.bottom; y += step) {
      for (let x = pane.left + step / 2; x < pane.right; x += step) {
        if (sheet && y >= sheet.top && x >= sheet.left && x <= sheet.right)
          continue;
        total++;
        for (const r of huds) {
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            covered++;
            break;
          }
        }
      }
    }
    return total ? Math.round((covered / total) * 1000) / 1000 : 0;
  }
  window.hudCoverage = hudCoverage;

  function updateCoverage() {
    window.requestAnimationFrame(() => {
      $("cov-readout").textContent = hudCoverage().toFixed(3);
    });
  }

  /* ---------- Layout variables ---------- */

  let sheetDragged = false;

  function measure() {
    const root = document.documentElement;
    root.style.setProperty("--bar-h", $("command-bar").offsetHeight + "px");
    if (!sheetDragged) {
      root.style.setProperty(
        "--sheet-h",
        Math.round(window.innerHeight * 0.45) + "px",
      );
    }
    if (["sun", "quest", "stats"].includes(state.panel))
      placePopover(state.panel);
    updateCoverage();
  }

  function dragSheet(handle, onMove) {
    handle.addEventListener("pointerdown", (e) => {
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => onMove(ev);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        measure();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  /* ---------- Wiring ---------- */

  function wire() {
    $("settings-open").addEventListener("click", () => togglePanel("drawer"));
    $("drawer-close").addEventListener("click", () => closePanel());
    $("drawer-grab").addEventListener("click", () => {
      const d = $("drawer");
      d.dataset.detent = d.dataset.detent === "full" ? "half" : "full";
      syncGrabLabel();
      updateCoverage();
    });
    $("info-open").addEventListener("click", () => togglePanel("stats"));
    $("sun-chip").addEventListener("click", () => togglePanel("sun"));
    $("sun-pop-more").addEventListener("click", () => {
      openPanel("drawer", { section: "sun" });
    });
    $("details-close").addEventListener("click", () => closePanel());

    document.querySelectorAll(".sect-head").forEach((head) => {
      head.addEventListener("click", () => {
        const key = head.closest(".sect").dataset.sect;
        expandSection(key, head.getAttribute("aria-expanded") !== "true");
      });
    });

    document.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => stepSun(Number(btn.dataset.step)));
    });
    $("sun-time").addEventListener("input", (e) =>
      setSun(e.target.value, "drawer"),
    );
    $("sun-time-quick").addEventListener("input", (e) =>
      setSun(e.target.value, "quick"),
    );
    $("sun-date").addEventListener("change", summaries);

    $("layer-cells").addEventListener("change", (e) => {
      const pill = $("cells-pill");
      const below = $("show-below");
      if (e.target.checked) {
        pill.setAttribute("aria-busy", "true");
        syncScene();
        window.setTimeout(() => {
          pill.removeAttribute("aria-busy");
          below.disabled = false;
          $("show-below-hint").textContent = "also draw cells under the bar";
          syncScene();
          updateCoverage();
        }, 2000);
      } else {
        below.disabled = true;
        $("show-below-hint").textContent = "needs cells";
        syncScene();
        updateCoverage();
      }
    });
    $("category").addEventListener("change", syncScene);

    LAYER_IDS.concat([
      "layer-areas",
      "show-below",
      "layer-underground",
      "perf-stats",
    ]).forEach((id) => {
      $(id).addEventListener("change", () => {
        syncScene();
        summaries();
      });
    });
    $("ground-mode").addEventListener("change", () => {
      syncScene();
      summaries();
    });

    $("colour-scheme").addEventListener("change", (e) => {
      const next = e.target.value;
      rebuild("colour-scheme", "colour-scheme-status", "colour scheme", () => {
        state.scheme = next;
        drawBuildings();
      });
    });
    $("invented-roofs").addEventListener("change", (e) => {
      const on = e.target.checked;
      rebuild("invented-roofs", "invented-roofs-status", "roofs", () => {
        state.roofs = on;
        drawBuildings();
      });
    });
    $("markings").addEventListener("change", () => {
      rebuild("markings", "markings-status", "markings", syncScene);
    });
    $("layer-furniture").addEventListener("change", () => {
      rebuild("layer-furniture", "furniture-status", "furniture", syncScene);
    });

    $("render-distance").addEventListener("input", (e) => {
      const draw = 2400 * Number(e.target.value);
      $("render-distance-value").textContent =
        "draw " + draw + " m · haze " + Math.round(draw * 0.66) + " m";
      summaries();
    });
    $("tile-look").addEventListener("click", cycleTileLook);

    $("geo-event").addEventListener("click", () => {
      const btn = $("geo-event");
      if (btn.getAttribute("aria-busy") === "true") return;
      if (!$("quest-readout").hidden) {
        togglePanel("quest");
        return;
      }
      findQuest();
    });
    $("geo-event-search").addEventListener("click", () => {
      closePanel({ silent: true });
      findQuest();
    });
    $("geo-event-clear").addEventListener("click", () => {
      $("quest-readout").hidden = true;
      closePanel();
    });

    $("light-open").addEventListener("click", () => {
      state.lightFromDrawer = true;
      openPanel("light");
    });
    $("light-close").addEventListener("click", () => closePanel());
    $("light-back").addEventListener("click", () => {
      state.lightFromDrawer = true;
      closePanel();
    });
    $("light-check").addEventListener("click", () =>
      busyButton("light-check", "Checking...", "Checked", 1500),
    );
    $("light-copy").addEventListener("click", () =>
      busyButton("light-copy", "Copying...", "Copied", 500),
    );
    $("light-reset").addEventListener("click", () => {
      LIGHT.forEach(([id, , , , , value]) => {
        $(id).value = value;
        $(id + "-out").textContent = value;
      });
    });

    $("scene").addEventListener("click", () =>
      openPanel("details", { noFocus: true }),
    );

    $("ar-offer-dismiss").addEventListener("click", () => {
      $("ar-offer").hidden = true;
    });
    $("ar-offer-go").addEventListener("click", () => {
      $("ar-offer").hidden = true;
      toast("Starting AR...");
    });
    $("enter-ar").addEventListener("click", () => toast("Starting AR..."));

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", (e) => {
      if (!["sun", "quest", "stats"].includes(state.panel)) return;
      const pop = $(PANELS[state.panel].el);
      const opener = $(PANELS[state.panel].opener);
      if (!pop.contains(e.target) && !opener.contains(e.target))
        closePanel({ silent: true });
    });

    dragSheet($("sheet-handle"), (ev) => {
      sheetDragged = true;
      const h = Math.max(
        120,
        Math.min(window.innerHeight - 160, window.innerHeight - ev.clientY),
      );
      document.documentElement.style.setProperty("--sheet-h", h + "px");
    });

    $("proto-open").addEventListener("click", () => {
      const panel = $("proto-panel");
      panel.hidden = !panel.hidden;
      $("proto-open").setAttribute(
        "aria-expanded",
        panel.hidden ? "false" : "true",
      );
      updateCoverage();
    });
    $("proto-close").addEventListener("click", () => {
      $("proto-panel").hidden = true;
      $("proto-open").setAttribute("aria-expanded", "false");
    });

    window.addEventListener("resize", measure);
    new ResizeObserver(measure).observe($("command-bar"));
  }

  function findQuest() {
    const btn = $("geo-event");
    const label = btn.querySelector(".quests-label");
    btn.setAttribute("aria-busy", "true");
    label.textContent = "Finding...";
    $("quest-readout").hidden = true;
    window.setTimeout(() => {
      btn.removeAttribute("aria-busy");
      label.textContent = "Show Quests";
      $("quest-readout").hidden = false;
      openPanel("quest", { noFocus: true });
    }, 1500);
  }

  function cycleTileLook() {
    state.tileLook = (state.tileLook + 1) % TILE_LOOKS.length;
    $("tile-look-value").textContent = TILE_LOOKS[state.tileLook];
    summaries();
    return TILE_LOOKS[state.tileLook];
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (!$("proto-panel").hidden) {
        $("proto-panel").hidden = true;
        return;
      }
      closePanel();
      return;
    }
    const tag = (e.target.tagName || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tag)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "t") stepSun(1);
    else if (e.key === "T") stepSun(-1);
    else if (e.key === "l") {
      state.lightFromDrawer = false;
      togglePanel("light");
    } else if (e.key === "p") toast("Tile look: " + cycleTileLook());
    else if (e.key === "?") {
      if (state.panel === "drawer" && state.lastSection === "debug")
        closePanel();
      else openPanel("drawer", { section: "debug" });
    }
  }

  /* ---------- Prototype states ---------- */

  const STATES = {
    resting: "Resting",
    settings: "Settings open",
    applying: "Applying colour scheme",
    cells: "Cells switching on",
    quest: "Quest found",
    error: "Error toast",
    loading: "Loading",
    failed: "Worker failed",
    details: "Cell details",
    light: "Light settings",
    status: "Status card",
    sun: "Sun popover",
    ar: "AR offer",
    full: "Settings full (phone)",
  };

  function reset() {
    closePanel({ silent: true });
    const cells = $("layer-cells");
    if (cells.checked) {
      cells.checked = false;
      cells.dispatchEvent(new Event("change"));
    }
    $("quest-readout").hidden = true;
    if ($("colour-scheme").value !== "Today") {
      $("colour-scheme").value = "Today";
      state.scheme = "Today";
      drawBuildings();
    }
    $("toast-root").textContent = "";
    $("ar-offer").hidden = true;
    $("loading-overlay").hidden = true;
    setStatus(
      "warn",
      STATUS_OK,
      "Rules: snapshot - live fetch failed and no cache",
    );
    expandSection("", false);
    state.lastSection = null;
  }

  function applyState(name) {
    reset();
    document.querySelectorAll("#proto-states button").forEach((b) => {
      b.setAttribute(
        "aria-pressed",
        b.dataset.state === name ? "true" : "false",
      );
    });
    switch (name) {
      case "settings":
        openPanel("drawer", { section: "look", noFocus: true });
        break;
      case "full":
        openPanel("drawer", {
          section: "world",
          detent: "full",
          noFocus: true,
        });
        break;
      case "applying": {
        openPanel("drawer", { section: "look", noFocus: true });
        const sel = $("colour-scheme");
        sel.value = "Blueprint";
        sel.dispatchEvent(new Event("change"));
        break;
      }
      case "cells": {
        const cb = $("layer-cells");
        if (cb.checked) cb.checked = false;
        cb.checked = true;
        cb.dispatchEvent(new Event("change"));
        break;
      }
      case "quest":
        findQuest();
        break;
      case "error":
        toast("Location permission denied.", "error");
        break;
      case "loading":
        $("loading-overlay").hidden = false;
        setStatus(
          "busy",
          "Fetching and scoring around 50.92310, 6.94450...",
          null,
        );
        break;
      case "failed":
        setStatus(
          "bad",
          "Failed: simulated worker death",
          "Failed: simulated worker death",
        );
        toast("Failed: simulated worker death", "error");
        break;
      case "details":
        openPanel("details", { noFocus: true });
        break;
      case "light":
        openPanel("light", { noFocus: true });
        break;
      case "status":
        openPanel("stats", { noFocus: true });
        break;
      case "sun":
        openPanel("sun", { noFocus: true });
        break;
      case "ar":
        $("ar-offer").hidden = false;
        break;
      default:
        break;
    }
    syncScene();
    updateCoverage();
  }
  window.applyPrototypeState = applyState;

  function buildStates() {
    const host = $("proto-states");
    Object.keys(STATES).forEach((key) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "proto-state";
      b.dataset.state = key;
      b.textContent = STATES[key];
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => applyState(key));
      host.appendChild(b);
    });
  }

  /* ---------- Boot ---------- */

  drawLanduse();
  drawWoods();
  drawRoads();
  drawCells();
  drawFurniture();
  drawTrees();
  drawBuildings();
  drawNpc();
  drawMapCells();
  buildLight();
  fillStats();
  buildStates();
  wire();
  setStatus(
    "warn",
    STATUS_OK,
    "Rules: snapshot - live fetch failed and no cache",
  );
  setSun(709);
  syncScene();
  summaries();
  measure();

  const params = new URLSearchParams(window.location.search);
  const initial = params.get("state");
  if (initial && STATES[initial]) applyState(initial);
})();
