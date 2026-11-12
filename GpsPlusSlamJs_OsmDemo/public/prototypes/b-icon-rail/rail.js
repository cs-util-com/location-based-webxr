// Tool rail prototype: faked interactions only. Nothing here computes a
// score, fetches data or talks to the demo; the 3D view and the map are SVG
// drawings that follow the switches so the effect of a card is visible.
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) =>
    Array.from((root || document).querySelectorAll(sel));
  const SVGNS = "http://www.w3.org/2000/svg";
  const params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- state

  const SCHEMES = [
    {
      name: "Today",
      ground: "#5d6b55",
      wall: "#b9ad99",
      roof: "#8a5a48",
      sky: 1,
    },
    {
      name: "Architect's model",
      ground: "#d8d4ca",
      wall: "#f4f2ec",
      roof: "#cfc9bc",
      sky: 1,
    },
    {
      name: "Blueprint",
      ground: "#16325c",
      wall: "#6fa0d8",
      roof: "#d6e6ff",
      sky: 0.8,
    },
    {
      name: "Mediterranean",
      ground: "#b9a57a",
      wall: "#eadbb8",
      roof: "#c8643c",
      sky: 1.1,
    },
    {
      name: "Nordic",
      ground: "#7f8a86",
      wall: "#d9dee3",
      roof: "#a33a2c",
      sky: 0.95,
    },
    {
      name: "Pastel",
      ground: "#bfe3d0",
      wall: "#f4c6d0",
      roof: "#c9d4f2",
      sky: 1.1,
    },
    {
      name: "Road map",
      ground: "#efe9da",
      wall: "#f5f1e6",
      roof: "#f2c94c",
      sky: 1,
    },
    {
      name: "Night",
      ground: "#141a28",
      wall: "#3a4a6b",
      roof: "#f2c46d",
      sky: 0.45,
    },
    {
      name: "Monochrome",
      ground: "#7a7a7a",
      wall: "#e6e6e6",
      roof: "#4d4d4d",
      sky: 0.9,
    },
    {
      name: "High contrast",
      ground: "#000000",
      wall: "#ffffff",
      roof: "#ffd400",
      sky: 0.7,
    },
  ];
  const CATEGORIES = {
    battleArea: { seed: 1.0, stats: "max here 6400 · 1933 above", regions: 5 },
    restingArea: { seed: 2.3, stats: "max here 2100 · 870 above", regions: 3 },
    spawnPoint: { seed: 4.1, stats: "max here 1.3e4 · 1941 above", regions: 6 },
  };
  const TILE_LOOKS = ["Default", "Soft", "Contour", "Outline"];
  const RAMP = [
    "#2d0b3d",
    "#3b2a7a",
    "#2f5f8a",
    "#21918c",
    "#3fbc73",
    "#a6d84a",
    "#fde725",
  ];

  const S = {
    open: null, // id of the open card
    pinned: false,
    cells: false,
    areas: true,
    below: false,
    category: "battleArea",
    scheme: "Today",
    roofs: true,
    markings: true,
    furniture: true,
    layers: {
      buildings: true,
      trees: true,
      woods: true,
      roads: true,
      plates: false,
      tint: true,
      poi: true,
    },
    ground: "CPU ground + slope",
    sun: 697,
    renderDist: 2,
    perf: false,
    tile: 0,
    quest: false,
    failed: false,
    user: { x: 0, z: 0 },
  };
  const busy = new Map();
  let lastOpener = null;
  let swallowSceneClick = false;

  // ---------------------------------------------------------------- layout

  const isDesktop = () => innerWidth > 860;
  const isLandscape = () => innerWidth <= 860 && innerHeight <= 500;
  let sheetFrac = 0.45;
  let sideFrac = 0.4;

  function applyLayoutVars() {
    const root = document.documentElement.style;
    root.setProperty("--sheet-h", Math.round(innerHeight * sheetFrac) + "px");
    root.setProperty("--side-w", Math.round(innerWidth * sideFrac) + "px");
    if (S.open) positionCard($("#" + S.open));
  }

  // ---------------------------------------------------------------- drawing helpers

  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
      Math.max(0, Math.min(255, Math.round(v * f))),
    );
    return "rgb(" + c.join(" ") + ")";
  }

  function score(x, z) {
    const s = CATEGORIES[S.category].seed;
    const v =
      Math.sin(x * 0.33 + s) * Math.cos(z * 0.27 + s * 2) +
      0.6 * Math.sin((x + z) * 0.19 + s * 3);
    const blob = Math.exp(-((x - 1) ** 2) / 160 - (z - 19) ** 2 / 120);
    return Math.max(0, Math.min(1, (v + 1.6) / 3.2) * 0.55 + blob * 0.65);
  }

  const rampColour = (t) =>
    RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length)))];

  // camera at x=0, height 6, looking down +z; horizon at y=290
  const P = (x, z, y) => [
    500 + (x * 400) / z,
    290 + ((6 - (y || 0)) * 400) / z,
  ];
  const pts = (list) =>
    list.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

  function hexCorners(cx, cz, r) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return out;
  }

  function forEachCell(fn) {
    const r = 1.5;
    const w = Math.sqrt(3) * r;
    for (let row = 0; row < 18; row++) {
      const z = 8 + row * 1.5 * r;
      for (let col = -7; col <= 7; col++) {
        const x = col * w + (row % 2 ? w / 2 : 0);
        fn(x, z, r, score(x, z));
      }
    }
  }

  function cellStyle(t, below) {
    const look = TILE_LOOKS[S.tile];
    const c = rampColour(t);
    const op = below ? 0.35 : 1;
    if (look === "Soft")
      return { fill: c, "fill-opacity": 0.5 * op, stroke: "none" };
    if (look === "Contour")
      return {
        fill: c,
        "fill-opacity": 0.22 * op,
        stroke: c,
        "stroke-width": 2,
      };
    if (look === "Outline")
      return {
        fill: "none",
        stroke: c,
        "stroke-width": 2,
        "stroke-opacity": op,
      };
    return {
      fill: c,
      "fill-opacity": 0.8 * op,
      stroke: "#11131a",
      "stroke-width": 0.8,
    };
  }

  // ---------------------------------------------------------------- the 3D placeholder

  const BUILDINGS = [
    { x0: -14, x1: -10, z0: 30, z1: 34, h: 7 },
    { x0: -9, x1: -6, z0: 13, z1: 16, h: 4.5 },
    { x0: -6.5, x1: -3.5, z0: 22, z1: 25, h: 10 },
    { x0: 4, x1: 7.5, z0: 15, z1: 19, h: 5.5 },
    { x0: 8, x1: 11, z0: 26, z1: 29, h: 13 },
    { x0: -1, x1: 1.5, z0: 34, z1: 36, h: 8 },
    { x0: 10, x1: 13, z0: 11, z1: 14, h: 3.8 },
    { x0: 15, x1: 19, z0: 36, z1: 40, h: 9 },
  ];
  const TREES = [
    [-4, 10],
    [-3.2, 12.5],
    [3.5, 11],
    [5, 23],
    [-8, 19],
    [12, 19],
    [2.8, 28],
    [-11, 22],
    [7, 32],
  ];

  function drawScene() {
    const svg = $("#scene-art");
    svg.setAttribute("viewBox", "0 0 1000 700");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.textContent = "";
    const sc = SCHEMES.find((s) => s.name === S.scheme) || SCHEMES[0];
    const t = S.sun / 1000;
    const elev = Math.sin(Math.PI * t);
    const light = Math.max(0.35, (0.45 + 0.6 * elev) * sc.sky);

    const defs = el("defs", {}, svg);
    const sky = el(
      "linearGradient",
      { id: "sky", x1: 0, y1: 0, x2: 0, y2: 1 },
      defs,
    );
    el("stop", { offset: "0", "stop-color": "#11131a" }, sky);
    el(
      "stop",
      {
        offset: "0.55",
        "stop-color": shade("#2b3a5c", 0.6 + 0.6 * elev * sc.sky),
      },
      sky,
    );
    el(
      "stop",
      {
        offset: "1",
        "stop-color": shade("#8a6a72", 0.5 + 0.6 * elev * sc.sky),
      },
      sky,
    );
    const haze = el(
      "linearGradient",
      { id: "haze", x1: 0, y1: 0, x2: 0, y2: 1 },
      defs,
    );
    el(
      "stop",
      { offset: "0", "stop-color": "#8a8fa6", "stop-opacity": 0 },
      haze,
    );
    el(
      "stop",
      { offset: "0.35", "stop-color": "#8a8fa6", "stop-opacity": 0.6 },
      haze,
    );
    el(
      "stop",
      { offset: "1", "stop-color": "#8a8fa6", "stop-opacity": 0 },
      haze,
    );
    const ramp = el(
      "linearGradient",
      { id: "gramp", x1: 0, y1: 0, x2: 0, y2: 1 },
      defs,
    );
    el("stop", { offset: "0", "stop-color": shade(sc.ground, 1.3) }, ramp);
    el("stop", { offset: "1", "stop-color": shade(sc.ground, 0.6) }, ramp);

    el(
      "rect",
      { x: 0, y: 0, width: 1000, height: 290, fill: "url(#sky)" },
      svg,
    );
    // the sun, along an arc from dawn to dusk
    el(
      "circle",
      {
        cx: 120 + 760 * t,
        cy: 280 - 220 * elev,
        r: 16,
        fill: "#ffd98a",
        opacity: 0.9,
      },
      svg,
    );

    if (S.ground !== "No ground") {
      const fill = S.ground.includes("height ramp")
        ? "url(#gramp)"
        : shade(sc.ground, light);
      el("rect", { x: 0, y: 290, width: 1000, height: 410, fill }, svg);
      if (S.ground.includes("slope")) {
        for (let i = 0; i < 6; i++) {
          const z = 9 + i * 7;
          el(
            "line",
            {
              x1: 0,
              y1: P(0, z)[1],
              x2: 1000,
              y2: P(0, z)[1],
              stroke: "#000",
              "stroke-opacity": 0.07,
            },
            svg,
          );
        }
      }
    } else {
      el(
        "rect",
        { x: 0, y: 290, width: 1000, height: 410, fill: "#0b0d13" },
        svg,
      );
    }

    if (S.layers.plates) {
      const tint = S.layers.tint;
      const patch = (x0, x1, z0, z1, c) =>
        el(
          "polygon",
          {
            points: pts([P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)]),
            fill: tint ? c : "#8c8c8c",
            "fill-opacity": 0.55,
          },
          svg,
        );
      patch(-16, -7, 9, 18, "#6aa84f");
      patch(5, 14, 20, 30, "#d9c38f");
      patch(-20, -12, 26, 40, "#7fb26b");
    }

    if (S.layers.woods) {
      for (let i = 0; i < 70; i++) {
        const x = -30 + ((i * 37) % 22);
        const z = 38 + ((i * 53) % 18);
        const [sx, sy] = P(x, z, 0.8);
        el(
          "circle",
          { cx: sx, cy: sy, r: 420 / z / 1.3, fill: shade("#2f5130", light) },
          svg,
        );
      }
    }

    if (S.layers.roads) {
      el(
        "polygon",
        {
          points: pts([P(-1.6, 6.2), P(1.6, 6.2), P(1.6, 60), P(-1.6, 60)]),
          fill: shade("#4a505c", light),
        },
        svg,
      );
      el(
        "polygon",
        {
          points: pts([P(-60, 17), P(60, 17), P(60, 19.5), P(-60, 19.5)]),
          fill: shade("#4a505c", light),
        },
        svg,
      );
      if (S.markings) {
        for (let i = 0; i < 6; i++) {
          const x = -1.4 + i * 0.52;
          el(
            "polygon",
            {
              points: pts([
                P(x, 10),
                P(x + 0.28, 10),
                P(x + 0.28, 11.6),
                P(x, 11.6),
              ]),
              fill: "#f2f2f2",
              "fill-opacity": 0.85,
            },
            svg,
          );
        }
        el(
          "polygon",
          {
            points: pts([P(2.2, 9), P(6, 9), P(6, 12.5), P(2.2, 12.5)]),
            fill: "#cbbfa8",
            "fill-opacity": 0.75,
          },
          svg,
        );
      }
    }

    if (S.cells) {
      forEachCell((x, z, r, v) => {
        const thr = 0.5;
        if (v < thr && !(S.below && v > 0.3)) return;
        el(
          "polygon",
          Object.assign(
            {
              points: pts(
                hexCorners(x, z, r * 0.96).map(([hx, hz]) => P(hx, hz)),
              ),
            },
            cellStyle(v, v < thr),
          ),
          svg,
        );
      });
    }

    if (S.areas) {
      const ring = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ring.push(P(1 + Math.cos(a) * 9, 19 + Math.sin(a) * 6.5));
      }
      el(
        "polygon",
        {
          points: pts(ring),
          fill: "#f2971f",
          "fill-opacity": 0.08,
          stroke: "#fff",
          "stroke-opacity": 0.7,
          "stroke-dasharray": "8 6",
          "stroke-width": 2,
        },
        svg,
      );
    }

    if (S.furniture && S.layers.roads) {
      [9, 13, 21, 27, 33].forEach((z) => {
        [-2.1, 2.1].forEach((x) => {
          const [bx, by] = P(x, z);
          const [, ty] = P(x, z, 1.8);
          el(
            "line",
            {
              x1: bx,
              y1: by,
              x2: bx,
              y2: ty,
              stroke: "#c9ccd6",
              "stroke-width": 1.4,
            },
            svg,
          );
          el("circle", { cx: bx, cy: ty, r: 2.2, fill: "#ffe7a8" }, svg);
        });
      });
    }

    // far to near so near things cover far ones
    const items = [];
    if (S.layers.buildings)
      BUILDINGS.forEach((b) =>
        items.push({ z: b.z0, draw: () => drawBuilding(svg, b, sc, light) }),
      );
    if (S.layers.trees)
      TREES.forEach(([x, z]) =>
        items.push({
          z,
          draw: () => {
            const [sx, sy] = P(x, z, 1.4);
            el(
              "circle",
              { cx: sx, cy: sy, r: 560 / z, fill: shade("#3f6a3a", light) },
              svg,
            );
          },
        }),
      );
    if (S.layers.poi)
      [
        [-5, 16],
        [6, 13],
        [9, 21],
      ].forEach(([x, z]) =>
        items.push({
          z,
          draw: () => {
            const [bx, by] = P(x, z);
            const [, ty] = P(x, z, 2.4);
            el(
              "line",
              {
                x1: bx,
                y1: by,
                x2: bx,
                y2: ty,
                stroke: "#c18cff",
                "stroke-width": 1.6,
              },
              svg,
            );
            el("circle", { cx: bx, cy: ty, r: 4.5, fill: "#c18cff" }, svg);
          },
        }),
      );
    items.sort((a, b) => b.z - a.z).forEach((i) => i.draw());

    // the NPC
    const [nx, ny] = P(2.6 + S.user.x * 0.2, 9.5);
    el(
      "ellipse",
      { cx: nx, cy: ny + 2, rx: 14, ry: 4, fill: "#000", "fill-opacity": 0.35 },
      svg,
    );
    el(
      "circle",
      {
        cx: nx,
        cy: ny - 12,
        r: 10,
        fill: "#f2971f",
        stroke: "#fff",
        "stroke-width": 2,
      },
      svg,
    );

    const hazeH = 150 - S.renderDist * 12;
    el(
      "rect",
      {
        x: 0,
        y: 290 - hazeH * 0.35,
        width: 1000,
        height: hazeH,
        fill: "url(#haze)",
      },
      svg,
    );
  }

  function drawBuilding(svg, b, sc, light) {
    const wall = shade(sc.wall, light);
    const side = shade(sc.wall, light * 0.72);
    const top = shade(sc.wall, light * 1.08);
    const roof = shade(sc.roof, light);
    const roofDark = shade(sc.roof, light * 0.75);
    const right = b.x0 > 0;
    const sx = right ? b.x0 : b.x1;
    el(
      "polygon",
      {
        points: pts([
          P(sx, b.z0),
          P(sx, b.z1),
          P(sx, b.z1, b.h),
          P(sx, b.z0, b.h),
        ]),
        fill: side,
      },
      svg,
    );
    el(
      "polygon",
      {
        points: pts([
          P(b.x0, b.z0),
          P(b.x1, b.z0),
          P(b.x1, b.z0, b.h),
          P(b.x0, b.z0, b.h),
        ]),
        fill: wall,
      },
      svg,
    );
    // windows
    for (let f = 1; f < b.h - 0.5; f += 1.6) {
      for (let x = b.x0 + 0.5; x < b.x1 - 0.4; x += 0.9) {
        el(
          "polygon",
          {
            points: pts([
              P(x, b.z0, f),
              P(x + 0.45, b.z0, f),
              P(x + 0.45, b.z0, f + 0.7),
              P(x, b.z0, f + 0.7),
            ]),
            fill: "#1b2233",
            "fill-opacity": 0.35,
          },
          svg,
        );
      }
    }
    if (S.roofs) {
      const xm = (b.x0 + b.x1) / 2;
      const r = 1.6;
      const eave = right ? b.x0 : b.x1;
      el(
        "polygon",
        {
          points: pts([
            P(eave, b.z0, b.h),
            P(xm, b.z0, b.h + r),
            P(xm, b.z1, b.h + r),
            P(eave, b.z1, b.h),
          ]),
          fill: roofDark,
        },
        svg,
      );
      el(
        "polygon",
        {
          points: pts([
            P(b.x0, b.z0, b.h),
            P(xm, b.z0, b.h + r),
            P(b.x1, b.z0, b.h),
          ]),
          fill: roof,
        },
        svg,
      );
    } else if (b.h < 6) {
      el(
        "polygon",
        {
          points: pts([
            P(b.x0, b.z0, b.h),
            P(b.x1, b.z0, b.h),
            P(b.x1, b.z1, b.h),
            P(b.x0, b.z1, b.h),
          ]),
          fill: top,
        },
        svg,
      );
    }
  }

  // ---------------------------------------------------------------- the map placeholder

  function drawMap() {
    const svg = $("#map-art");
    svg.setAttribute("viewBox", "0 0 600 600");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.textContent = "";
    const M = (x, z) => [300 + x * 9, 360 - (z - 10) * 9];
    el("rect", { x: 0, y: 0, width: 600, height: 600, fill: "#a6db8c" }, svg);
    el("polygon", { points: "0,0 260,0 180,140 0,210", fill: "#bfe6a8" }, svg);
    el(
      "polygon",
      { points: "420,380 600,330 600,600 470,600", fill: "#94cf7c" },
      svg,
    );
    [
      ["M0 210 L600 170", 7],
      ["M290 600 L310 0", 9],
      ["M0 470 L600 420", 5],
    ].forEach(([d, w]) =>
      el(
        "path",
        {
          d,
          stroke: "#fff",
          "stroke-width": w,
          fill: "none",
          "stroke-opacity": 0.9,
        },
        svg,
      ),
    );
    if (S.cells) {
      forEachCell((x, z, r, v) => {
        if (v < 0.5 && !(S.below && v > 0.3)) return;
        el(
          "polygon",
          {
            points: pts(
              hexCorners(x, z, r * 0.95).map(([hx, hz]) => M(hx, hz)),
            ),
            fill: rampColour(v),
            "fill-opacity": v < 0.5 ? 0.3 : 0.7,
          },
          svg,
        );
      });
    }
    if (S.areas) {
      const ring = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        ring.push(M(1 + Math.cos(a) * 11, 19 + Math.sin(a) * 11));
      }
      el(
        "polygon",
        {
          points: pts(ring),
          fill: "none",
          stroke: "#fff",
          "stroke-width": 2.5,
          "stroke-dasharray": "7 6",
        },
        svg,
      );
    }
    const [ux, uy] = M(S.user.x, S.user.z);
    el(
      "circle",
      { cx: ux, cy: uy, r: 14, fill: "#2f7cf6", "fill-opacity": 0.2 },
      svg,
    );
    el(
      "circle",
      {
        cx: ux,
        cy: uy,
        r: 7,
        fill: "#2f7cf6",
        stroke: "#fff",
        "stroke-width": 2.5,
      },
      svg,
    );
  }

  function redraw() {
    drawScene();
    drawMap();
  }

  // ---------------------------------------------------------------- cards

  const railBtn = (card) => $('.rail-btn[data-card="' + card + '"]');
  const cardIdFor = (name) =>
    name === "light" ? "light-dialog" : "card-" + name;
  const railNameFor = (id) =>
    id === "light-dialog" ? "sun" : id.replace("card-", "");

  function openCard(name, opts) {
    const o = opts || {};
    const id = cardIdFor(name);
    if (S.open === id) return;
    const prev = S.open;
    if (prev) hideCard(prev);
    if (!isDesktop()) closeDetails();
    const card = $("#" + id);
    card.hidden = false;
    S.open = id;
    const btn = railBtn(railNameFor(id));
    $$(".rail-btn").forEach((b) =>
      b.setAttribute("aria-expanded", String(b === btn)),
    );
    $("#light-open").setAttribute(
      "aria-expanded",
      String(id === "light-dialog"),
    );
    $$(".pin", card).forEach((p) =>
      p.setAttribute("aria-pressed", String(S.pinned)),
    );
    if (!o.keepOpener) lastOpener = o.opener || btn;
    positionCard(card);
    if (o.focus !== false) card.focus({ preventScroll: true });
    updateCoverage();
  }

  function hideCard(id) {
    const card = $("#" + id);
    if (card) card.hidden = true;
  }

  function closeCard(restoreFocus) {
    if (!S.open) return;
    const card = $("#" + S.open);
    const hadFocus =
      card.contains(document.activeElement) || document.activeElement === card;
    hideCard(S.open);
    S.open = null;
    $$(".rail-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
    $("#light-open").setAttribute("aria-expanded", "false");
    if ((restoreFocus || hadFocus) && lastOpener)
      lastOpener.focus({ preventScroll: true });
    updateCoverage();
  }

  function toggleCard(name, opener) {
    if (S.open === cardIdFor(name)) closeCard(true);
    else openCard(name, { opener });
  }

  // desktop: the card sits across the seam from the rail, its notch pointing at
  // the button; it never reaches into the map's bottom-right control column
  function positionCard(card) {
    if (!card) return;
    if (!isDesktop()) {
      card.style.top = "";
      card.style.maxHeight = "";
      return;
    }
    const btn = railBtn(railNameFor(card.id));
    const reserveBottom = 148;
    const avail = innerHeight - 8 - reserveBottom;
    card.style.maxHeight = avail + "px";
    const h = Math.min(card.scrollHeight, avail);
    const b = btn.getBoundingClientRect();
    const centre = b.top + b.height / 2;
    let top = centre - 26;
    top = Math.max(8, Math.min(top, innerHeight - reserveBottom - h));
    card.style.top = Math.round(top) + "px";
    const notch = Math.max(14, Math.min(h - 26, centre - top - 6));
    card.style.setProperty("--notch-y", Math.round(notch) + "px");
  }

  function openDetails() {
    if (!isDesktop()) closeCard(false);
    $("#details").hidden = false;
    updateCoverage();
  }

  function closeDetails() {
    $("#details").hidden = true;
    updateCoverage();
  }

  // ---------------------------------------------------------------- busy

  function setBusy(key, card, text, on) {
    if (on) busy.set(key, { card, text });
    else busy.delete(key);
    $$(".rail-btn").forEach((b) => {
      const name = b.dataset.card;
      const isBusy = Array.from(busy.values()).some((v) => v.card === name);
      b.dataset.busy = String(isBusy);
      const label = $(".rail-label", b).textContent;
      b.setAttribute("aria-label", isBusy ? label + ", working" : label);
    });
    const first = Array.from(busy.values())[0];
    $(".now-busy").hidden = !first;
    $(".now-busy-text").textContent = first ? first.text : "";
    updateCoverage();
  }

  function runBusy(key, card, text, ms, done) {
    setBusy(key, card, text, true);
    setTimeout(() => {
      setBusy(key, card, text, false);
      done();
      if (S.open) positionCard($("#" + S.open));
    }, ms);
  }

  // ---------------------------------------------------------------- toast

  function toast(msg, err) {
    const root = $("#toast-root");
    while (root.children.length > 1) root.firstChild.remove();
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.setAttribute("role", err ? "alert" : "status");
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  // ---------------------------------------------------------------- now plate + status

  function sunText() {
    const dawn = 6 * 60 + 55;
    const dusk = 19 * 60 + 38;
    const m = Math.round(dawn + ((dusk - dawn) * S.sun) / 1000);
    return (
      String(Math.floor(m / 60)).padStart(2, "0") +
      ":" +
      String(m % 60).padStart(2, "0")
    );
  }

  function statusSentence() {
    if (S.failed) return "Failed: simulated worker death";
    const c = CATEGORIES[S.category];
    return (
      "4843 cells · 1 underground · " +
      c.regions +
      " " +
      S.category +
      " regions · 127 chunks scored / 208 reused · 21 volumes (0 parts, 13 guessed building heights, 16 invented roofs) · 501 triangles · 9 POI · 648 woods · 2 furniture · 23 roads (676 tri) · 5 area slabs · ground cpu 68.7 ms · tiles current · 17 draws / 335,897 tri · fetched 6.3 km²: 2.5 x 2.6 km box per tile (1.39x the hexagon it indexes) · terrain ±30 m nearby / ±40 m in view · rules: snapshot (live fetch failed and no cache)"
    );
  }

  function renderStatus() {
    $("#status").textContent = statusSentence();
    const rows = S.failed
      ? [["State", "Failed: simulated worker death", true]]
      : [
          ["Cells", "4843 (1 underground)"],
          ["Regions", CATEGORIES[S.category].regions + " " + S.category],
          ["Chunks", "127 scored, 208 reused"],
          ["Volumes", "21 (0 parts, 13 guessed heights, 16 invented roofs)"],
          ["Triangles", "501"],
          ["POI", "9"],
          ["Woods", "648"],
          ["Furniture", "2"],
          ["Roads", "23 (676 tri)"],
          ["Area slabs", "5"],
          ["Ground", "cpu 68.7 ms"],
          ["Tiles", "current"],
          ["Draws", "17 / 335,897 tri"],
          [
            "Fetched",
            "6.3 km², 2.5 x 2.6 km box per tile (1.39x the hexagon it indexes)",
          ],
          ["Terrain", "±30 m nearby, ±40 m in view"],
          ["Rules", "snapshot (live fetch failed and no cache)", true],
        ];
    const dl = $("#status-rows");
    dl.textContent = "";
    rows.forEach(([k, v, bad]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      if (bad) dd.className = "bad";
      dl.append(dt, dd);
    });
    const problem = S.failed
      ? "Failed: simulated worker death"
      : "Rules: snapshot (live fetch failed and no cache)";
    $("#problem").textContent = problem;
    const dbg = railBtn("debug");
    dbg.dataset.warn = "true";
  }

  function renderNow() {
    $(".now-cat").textContent = S.category;
    $(".now-ramp").hidden = !S.cells;
    $(".now-cells").textContent = S.cells
      ? "max " + CATEGORIES[S.category].stats.split(" ")[2]
      : "cells off";
    $(".now-sun").textContent = sunText();
    $(".now-quest").hidden = !S.quest;
    $(".now-perf").hidden = !S.perf;
  }

  function renderAnalysis() {
    $(".legend-off").hidden = S.cells;
    $(".legend-on").hidden = !S.cells;
    $(".legend-cat").textContent = S.category;
    $(".legend-stats").textContent = CATEGORIES[S.category].stats;
    $("#show-below").disabled = !S.cells;
    $("#details-title").textContent = S.category + " = 160";
  }

  function renderAll() {
    renderNow();
    renderAnalysis();
    renderStatus();
    redraw();
    updateCoverage();
  }

  // ---------------------------------------------------------------- coverage hook

  function sceneRect() {
    return $("#scene").getBoundingClientRect();
  }

  // Share of the visible 3D view covered by HUD chrome (rail, now plate, any
  // open card), sampled on a 4 px grid so overlaps are not counted twice.
  window.hudCoverage = function () {
    const s = sceneRect();
    const rects = $$("[data-hud]")
      .filter((n) => !n.hidden && n.getClientRects().length)
      .map((n) => n.getBoundingClientRect());
    let hit = 0;
    let total = 0;
    for (let y = s.top + 2; y < s.bottom; y += 4) {
      for (let x = s.left + 2; x < s.right; x += 4) {
        total++;
        if (
          rects.some(
            (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom,
          )
        )
          hit++;
      }
    }
    return total ? Math.round((hit / total) * 1000) / 1000 : 0;
  };

  function updateCoverage() {
    // on a phone a card or the details fill the map sheet: its own controls hide
    document.body.dataset.slot = String(
      Boolean(S.open) || !$("#details").hidden,
    );
    requestAnimationFrame(() => {
      const v = window.hudCoverage();
      $("#cov-now").textContent =
        "3D covered now: " + (v * 100).toFixed(1) + " %";
    });
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    $$(".rail-btn").forEach((b) =>
      b.addEventListener("click", () => toggleCard(b.dataset.card, b)),
    );
    $$(".now-row[data-open]").forEach((b) =>
      b.addEventListener("click", () =>
        openCard(b.dataset.open, { opener: railBtn(b.dataset.open) }),
      ),
    );
    $$(".card .close").forEach((b) =>
      b.addEventListener("click", () => closeCard(true)),
    );
    $$(".card .pin").forEach((b) =>
      b.addEventListener("click", () => {
        S.pinned = !S.pinned;
        $$(".pin").forEach((p) =>
          p.setAttribute("aria-pressed", String(S.pinned)),
        );
      }),
    );
    $("#light-dialog .back").addEventListener("click", () =>
      openCard("sun", { keepOpener: true }),
    );
    $("#light-open").addEventListener("click", () =>
      openCard("light", { keepOpener: true }),
    );
    $("#light-close").addEventListener("click", () => closeCard(true));

    // tap outside closes an unpinned card, and that tap does nothing else
    document.addEventListener(
      "pointerdown",
      (e) => {
        swallowSceneClick = false;
        if (!S.open || S.pinned) return;
        const keep =
          "#" +
          S.open +
          ", #rail, #now, #proto-pill, #proto-panel, #bottom-stack, #legal-link, #details";
        if (e.target.closest(keep)) return;
        closeCard(false);
        swallowSceneClick = true;
      },
      true,
    );

    $("#scene").addEventListener("click", () => {
      if (swallowSceneClick) {
        swallowSceneClick = false;
        return;
      }
      openDetails();
    });
    $("#details .close").addEventListener("click", closeDetails);

    // Place
    $("#site").addEventListener("change", (e) => {
      if (!e.target.value) return;
      const ov = $("#loading-overlay");
      ov.hidden = false;
      $("#status").textContent =
        "Fetching and scoring around 50.92310, 6.94450...";
      setTimeout(() => {
        ov.hidden = true;
        renderStatus();
      }, 1600);
    });
    const findQuest = () => {
      const b = $("#geo-event");
      b.disabled = true;
      b.textContent = "Finding...";
      runBusy("quest", "place", "Finding quests...", 1500, () => {
        b.disabled = false;
        b.textContent = "Show Quests";
        S.quest = true;
        $("#quest-readout").hidden = false;
        $(".quest-none").hidden = true;
        $("#geo-event-picker").disabled = false;
        renderNow();
      });
    };
    $("#geo-event").addEventListener("click", findQuest);
    $("#geo-event-again").addEventListener("click", findQuest);
    $("#geo-event-clear").addEventListener("click", () => {
      S.quest = false;
      $("#quest-readout").hidden = true;
      $(".quest-none").hidden = false;
      $("#geo-event-picker").disabled = true;
      renderNow();
      $("#geo-event").focus();
    });

    // Analysis
    $("#category").addEventListener("change", (e) => {
      S.category = e.target.value;
      renderAll();
    });
    $("#layer-cells").addEventListener("change", (e) => {
      const input = e.target;
      if (!input.checked) {
        S.cells = false;
        renderAll();
        return;
      }
      input.disabled = true;
      $("#cells-row").classList.add("busy");
      $("#cells-note").textContent = "Loading...";
      runBusy("cells", "analysis", "Loading cells...", 2000, () => {
        input.disabled = false;
        $("#cells-row").classList.remove("busy");
        $("#cells-note").textContent = "";
        S.cells = true;
        renderAll();
      });
    });
    $("#layer-areas").addEventListener("change", (e) => {
      S.areas = e.target.checked;
      redraw();
    });
    $("#show-below").addEventListener("change", (e) => {
      S.below = e.target.checked;
      redraw();
    });

    // World
    ["buildings", "trees", "woods", "roads", "plates", "tint", "poi"].forEach(
      (k) =>
        $("#layer-" + k).addEventListener("change", (e) => {
          S.layers[k] = e.target.checked;
          redraw();
        }),
    );
    $("#ground-mode").addEventListener("change", (e) => {
      S.ground = e.target.value;
      redraw();
    });

    // Look
    const sw = $("#swatches");
    SCHEMES.forEach((s) => {
      const label = document.createElement("label");
      label.className = "swatch";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "scheme";
      input.value = s.name;
      input.checked = s.name === S.scheme;
      const chips = document.createElement("span");
      chips.className = "chips";
      chips.setAttribute("aria-hidden", "true");
      [s.ground, s.wall, s.roof].forEach((c) => {
        const i = document.createElement("i");
        i.style.background = c;
        chips.appendChild(i);
      });
      const name = document.createElement("span");
      name.textContent = s.name;
      label.append(input, chips, name);
      sw.appendChild(label);
      input.addEventListener("change", () => applyScheme(s.name));
    });

    const rebuild = (id, statusId, key, text) => {
      const input = $("#" + id);
      input.addEventListener("change", () => {
        const row = input.closest(".sw");
        input.disabled = true;
        row.classList.add("busy");
        $("#" + statusId).textContent = "Applying...";
        runBusy(id, "look", text, 2000, () => {
          input.disabled = false;
          row.classList.remove("busy");
          $("#" + statusId).textContent = "";
          S[key] = input.checked;
          redraw();
        });
      });
    };
    rebuild(
      "invented-roofs",
      "invented-roofs-status",
      "roofs",
      "Applying invented roofs...",
    );
    rebuild("markings", "markings-status", "markings", "Applying zebras...");
    rebuild(
      "layer-furniture",
      "layer-furniture-status",
      "furniture",
      "Applying street furniture...",
    );

    // Sun
    const sunInput = $("#sun-time");
    const setSun = (v) => {
      S.sun = Math.max(0, Math.min(1000, v));
      sunInput.value = String(S.sun);
      $("#sun-readout").textContent = sunText() + " solar time";
      renderNow();
      drawScene();
    };
    sunInput.addEventListener("input", () => setSun(Number(sunInput.value)));
    $("#sun-fwd").addEventListener("click", () => setSun(S.sun + 20));
    $("#sun-back").addEventListener("click", () => setSun(S.sun - 20));
    window.__setSun = setSun;

    // Light
    const defaults = {};
    $$("#light-dialog .lslider input").forEach((input) => {
      defaults[input.id] = input.value;
      const out = input.previousElementSibling.querySelector("output");
      const decimals = (input.step.split(".")[1] || "").length;
      const show = () =>
        (out.textContent = Number(input.value).toFixed(decimals));
      input.addEventListener("input", () => {
        show();
        $("#light-readout").textContent =
          "Lit surfaces " +
          (55 + Number($("#light-gain").value) * 6).toFixed(1);
      });
      input.__show = show;
    });
    $("#light-reset").addEventListener("click", () => {
      $$("#light-dialog .lslider input").forEach((i) => {
        i.value = defaults[i.id];
        i.__show();
      });
      $("#light-readout").textContent = "Lit surfaces 65.0";
      toast("Light settings reset.");
    });
    $("#light-check").addEventListener("click", (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = "Checking...";
      setTimeout(() => {
        b.disabled = false;
        b.textContent = "Check heat grid";
        b.classList.add("done");
        $("#light-readout").textContent =
          "Lit surfaces 65.0 · heat-ramp margin 6.15";
        setTimeout(() => b.classList.remove("done"), 1500);
      }, 1200);
    });
    $("#light-copy").addEventListener("click", (e) => {
      const b = e.currentTarget;
      b.textContent = "Copied";
      b.classList.add("done");
      setTimeout(() => {
        b.textContent = "Copy";
        b.classList.remove("done");
      }, 1500);
    });

    // Debug
    $("#render-distance").addEventListener("input", (e) => {
      S.renderDist = Number(e.target.value);
      const draw = 2400 * S.renderDist;
      $("#render-distance-value").textContent =
        "draw " + draw + " m · haze " + Math.round(draw * 0.66) + " m";
      drawScene();
    });
    $("#tile-preset").addEventListener("click", cycleTile);
    $("#perf-stats").addEventListener("change", (e) => {
      S.perf = e.target.checked;
      renderNow();
      updateCoverage();
    });

    // Map
    $("#map-art").addEventListener("click", (e) => {
      const r = $("#map-art").getBoundingClientRect();
      S.user.x = ((e.clientX - r.left) / r.width - 0.5) * 30;
      S.user.z = ((r.height - (e.clientY - r.top)) / r.height) * 20 - 4;
      drawMap();
      drawScene();
    });
    $(".locate-button").addEventListener("click", () =>
      setTimeout(showOffer, 600),
    );
    $("#enter-ar").addEventListener("click", () =>
      toast("AR would start here (not in this prototype)."),
    );
    $("#ar-offer-enter").addEventListener("click", () => {
      $("#ar-offer").hidden = true;
      toast("AR would start here (not in this prototype).");
    });
    $("#ar-offer-dismiss").addEventListener(
      "click",
      () => ($("#ar-offer").hidden = true),
    );
    $(".attr-more").addEventListener("click", (e) => {
      const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
      e.currentTarget.setAttribute("aria-expanded", String(open));
      $(".attr-long").hidden = !open;
      $(".attr-short").hidden = open;
    });

    // sheet / side panel resize
    const handle = $("#sheet-handle");
    handle.addEventListener("pointerdown", (e) => {
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (isLandscape())
          sideFrac = Math.max(
            0.3,
            Math.min(0.7, (innerWidth - ev.clientX) / innerWidth),
          );
        else
          sheetFrac = Math.max(
            0.25,
            Math.min(0.85, (innerHeight - ev.clientY) / innerHeight),
          );
        applyLayoutVars();
        updateCoverage();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });

    // keys: the same set as the demo, ignored while typing into a field
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      const typing =
        t.matches &&
        t.matches(
          'select, input[type="date"], input[type="time"], input[type="text"]',
        );
      if (e.key === "Escape") {
        if (typing) return t.blur();
        if (!$("#proto-panel").hidden) return toggleProto(false);
        if (S.open) return closeCard(true);
        if (!$("#details").hidden) return closeDetails();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "t") window.__setSun(S.sun + 20);
      else if (e.key === "T") window.__setSun(S.sun - 20);
      else if (e.key === "l") toggleCard("light", $("#light-open"));
      else if (e.key === "p") {
        cycleTile();
        toast("Tile look: " + TILE_LOOKS[S.tile]);
      } else if (e.key === "?") {
        if (S.open === "card-debug") closeCard(true);
        else {
          $("#hotkey-fold").open = true;
          openCard("debug");
        }
      }
    });

    // prototype tools
    $("#proto-pill").addEventListener("click", () =>
      toggleProto($("#proto-panel").hidden),
    );
    const states = [
      ["rest", "Resting"],
      ["place", "Place"],
      ["analysis", "Analysis"],
      ["world", "World"],
      ["look", "Look"],
      ["sun", "Sun"],
      ["light", "Light"],
      ["debug", "Debug"],
      ["keys", "Keys"],
      ["applying", "Applying"],
      ["applying-closed", "Applying, shut"],
      ["cells", "Cells on"],
      ["quest", "Quest found"],
      ["details", "Details"],
      ["pinned", "Pinned + details"],
      ["ar", "AR offer"],
      ["error", "Error toast"],
      ["loading", "Loading"],
      ["failed", "Worker died"],
    ];
    const box = $("#proto-states");
    states.forEach(([key, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => {
        const q = new URLSearchParams(location.search);
        q.set("state", key);
        location.search = q.toString();
      });
      box.appendChild(b);
    });
  }

  function cycleTile() {
    S.tile = (S.tile + 1) % TILE_LOOKS.length;
    $(".tile-name").textContent = TILE_LOOKS[S.tile];
    drawScene();
  }

  function applyScheme(name) {
    const fs = $("#colour-scheme");
    const label = $$(".swatch").find((l) => $("input", l).value === name);
    fs.disabled = true;
    label.classList.add("applying");
    const spin = document.createElement("span");
    spin.className = "spin";
    spin.setAttribute("aria-hidden", "true");
    label.appendChild(spin);
    $("#colour-scheme-status").textContent = "Applying...";
    runBusy("scheme", "look", "Applying colour scheme...", 2000, () => {
      fs.disabled = false;
      label.classList.remove("applying");
      spin.remove();
      $("#colour-scheme-status").textContent = "";
      S.scheme = name;
      drawScene();
    });
  }

  function showOffer() {
    $("#ar-offer").hidden = false;
  }

  function toggleProto(open) {
    $("#proto-panel").hidden = !open;
    $("#proto-pill").setAttribute("aria-expanded", String(open));
    if (open) updateCoverage();
  }

  // ---------------------------------------------------------------- states

  function applyState(name) {
    switch (name) {
      case "place":
      case "analysis":
      case "world":
      case "look":
      case "sun":
      case "light":
      case "debug":
        openCard(name, { focus: false });
        break;
      case "keys":
        $("#hotkey-fold").open = true;
        openCard("debug", { focus: false });
        break;
      case "applying": {
        openCard("look", { focus: false });
        const night = $$("#swatches input").find((i) => i.value === "Night");
        night.checked = true;
        applyScheme("Night");
        break;
      }
      case "applying-closed": {
        const night = $$("#swatches input").find((i) => i.value === "Night");
        night.checked = true;
        applyScheme("Night");
        break;
      }
      case "cells": {
        openCard("analysis", { focus: false });
        const c = $("#layer-cells");
        c.checked = true;
        c.dispatchEvent(new Event("change"));
        break;
      }
      case "quest":
        S.quest = true;
        $("#quest-readout").hidden = false;
        $(".quest-none").hidden = true;
        $("#geo-event-picker").disabled = false;
        renderNow();
        openCard("place", { focus: false });
        break;
      case "details":
        openDetails();
        break;
      case "pinned":
        S.pinned = true;
        openCard("look", { focus: false });
        openDetails();
        break;
      case "ar":
        showOffer();
        break;
      case "error":
        toast("Location permission denied.", true);
        break;
      case "loading":
        $("#loading-overlay").hidden = false;
        $("#status").textContent =
          "Fetching and scoring around 50.92310, 6.94450...";
        break;
      case "failed":
        S.failed = true;
        renderStatus();
        toast("Failed: simulated worker death", true);
        break;
      default:
        break;
    }
    updateCoverage();
  }

  // ---------------------------------------------------------------- boot

  addEventListener("resize", () => {
    applyLayoutVars();
    updateCoverage();
  });
  applyLayoutVars();
  wire();
  if (params.get("pin") === "1") S.pinned = true;
  renderAll();
  applyState(params.get("state") || "rest");
})();
