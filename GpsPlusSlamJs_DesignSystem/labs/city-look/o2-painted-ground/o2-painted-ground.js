/**
 * O2 painted ground: V2's buildings on a ground whose colour follows the
 * mapped land use. The land-use polygons are painted once, at load, into one
 * small texture over the scene, which the ground's own material samples by
 * world position: no extra triangle, no extra draw call, nothing to z-fight.
 *
 * @see o2-painted-ground.js.md
 */
import { ringToEnu } from "/osm-lib/mesh/enu.js";
import { featureKey } from "/osm-lib/model/osm-feature.js";
import { toGeometry } from "/osm-lib/model/osm-geometry.js";
import { GROUND_COLOUR } from "/osm/surface-colours.js";

import { startCityLook } from "../city-look-harness.js";
import { v2Variant } from "../v2-closed-roofscape/v2-closed-roofscape.js";
import {
  GROUND_CLASSES,
  chroma,
  landuseClassOf,
  paintColour,
  paintOrder,
  polygonAreaM2,
  rasterPlan,
} from "./painted-ground-rules.js";

/** The page's knobs, each overridable from the link for a sweep. */
const DEFAULTS = Object.freeze({
  /** Metres a texel. */
  texelM: 1,
  /** 0 is today's grey, 1 the full class colour. */
  strength: 1,
  /** Blur of the painted edges, in metres; 0 keeps the mapped edge. */
  softM: 0,
  /** Over how many metres the tint fades out at the data's edge. */
  fadeM: 40,
});

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function knobs() {
  const search = new URLSearchParams(location.search);
  const number = (key, fallback) => {
    const value = Number(search.get(key));
    return search.has(key) && Number.isFinite(value) ? value : fallback;
  };
  return {
    texelM: number("texel", DEFAULTS.texelM),
    strength: number("strength", DEFAULTS.strength),
    softM: number("soft", DEFAULTS.softM),
    fadeM: number("fade", DEFAULTS.fadeM),
    on: search.get("tint") !== "off",
  };
}

/** The polygons of a feature in local metres: a list of ring lists. */
function polygonsOf(feature, frame) {
  const result = toGeometry(feature);
  if (!result.ok) return { polygons: null, reason: result.error?.reason };
  const { geometry } = result;
  const raw =
    geometry.kind === "polygon"
      ? [geometry.rings]
      : geometry.kind === "multipolygon"
        ? geometry.polygons
        : null;
  if (!raw) return { polygons: null, reason: geometry.kind };
  const polygons = raw
    .map((rings) =>
      rings.map((ring) => ringToEnu(ring, frame)).filter((r) => r.length >= 3),
    )
    .filter((rings) => rings.length > 0);
  return { polygons, reason: null };
}

/** Every land-use area of the scene, with its class and area. */
function landuseEntries(features, frame) {
  const entries = [];
  const failed = {};
  for (const feature of features) {
    if (feature.type === "node") continue;
    const cls = landuseClassOf(feature.tags);
    if (!cls) continue;
    const { polygons, reason } = polygonsOf(feature, frame);
    if (!polygons || polygons.length === 0) {
      const why = `${cls}: ${reason ?? "empty"}`;
      failed[why] = (failed[why] ?? 0) + 1;
      continue;
    }
    const area = polygons.reduce((sum, p) => sum + polygonAreaM2(p), 0);
    entries.push({ key: featureKey(feature), cls, area, polygons });
  }
  return { entries, failed };
}

function localBox(bbox, frame) {
  const sw = frame.toEnu({ lat: bbox.south, lng: bbox.west });
  const ne = frame.toEnu({ lat: bbox.north, lng: bbox.east });
  return { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y };
}

/**
 * Paints the classes into a canvas, north up. Returns the canvas and each
 * class's share of the box, counted on the exact colour before any blur
 * (anti-aliased edge texels count for nobody, so shares are a floor).
 */
function paintCanvas(entries, box, plan, settings) {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.fillStyle = hex(GROUND_COLOUR);
  g.fillRect(0, 0, plan.width, plan.height);
  const sx = plan.width / (box.maxX - box.minX);
  const sy = plan.height / (box.maxY - box.minY);
  const colours = new Map();
  for (const entry of paintOrder(entries)) {
    const colour = paintColour(entry.cls, settings.strength, GROUND_COLOUR);
    colours.set(colour, entry.cls);
    g.fillStyle = hex(colour);
    g.beginPath();
    for (const rings of entry.polygons) {
      for (const ring of rings) {
        ring.forEach((p, i) => {
          const x = (p.x - box.minX) * sx;
          const y = (box.maxY - p.y) * sy;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.closePath();
      }
    }
    g.fill("evenodd");
  }

  const shares = {};
  const pixels = g.getImageData(0, 0, plan.width, plan.height).data;
  for (let i = 0; i < pixels.length; i += 4) {
    const colour = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    const cls = colours.get(colour);
    if (cls) shares[cls] = (shares[cls] ?? 0) + 1;
  }
  const total = plan.width * plan.height;
  for (const cls of Object.keys(shares)) shares[cls] /= total;

  if (settings.softM <= 0) return { canvas, shares };
  const soft = document.createElement("canvas");
  soft.width = plan.width;
  soft.height = plan.height;
  const s = soft.getContext("2d");
  s.fillStyle = hex(GROUND_COLOUR);
  s.fillRect(0, 0, plan.width, plan.height);
  s.filter = `blur(${settings.softM / plan.texelM}px)`;
  s.drawImage(canvas, 0, 0);
  return { canvas: soft, shares };
}

/**
 * The ground material, sampling the painted texture by world position. The
 * render axes are east, up, minus north; the texture's rows run north up.
 */
function tintGround(material, THREE, texture, box, settings) {
  const neutral = new THREE.Color(GROUND_COLOUR);
  const uniforms = {
    groundTint: { value: texture },
    groundOrigin: { value: new THREE.Vector2(box.minX, box.minY) },
    groundSize: {
      value: new THREE.Vector2(box.maxX - box.minX, box.maxY - box.minY),
    },
    groundNeutral: {
      value: new THREE.Vector3(neutral.r, neutral.g, neutral.b),
    },
    groundFade: { value: Math.max(0.01, settings.fadeM) },
    groundOn: { value: settings.on ? 1 : 0 },
  };
  material.color.set(0xffffff);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vGroundXZ;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec2 vGroundXZ;",
          "uniform sampler2D groundTint;",
          "uniform vec2 groundOrigin;",
          "uniform vec2 groundSize;",
          "uniform vec3 groundNeutral;",
          "uniform float groundFade;",
          "uniform float groundOn;",
        ].join("\n"),
      )
      .replace(
        "#include <map_fragment>",
        [
          "#include <map_fragment>",
          "vec2 groundEnu = vec2(vGroundXZ.x, -vGroundXZ.y);",
          "vec2 groundUv = (groundEnu - groundOrigin) / groundSize;",
          "vec3 groundPaint = texture2D(groundTint, groundUv).rgb;",
          "vec2 groundEdge = min(groundEnu - groundOrigin, groundOrigin + groundSize - groundEnu);",
          "float groundInside = smoothstep(0.0, groundFade, min(groundEdge.x, groundEdge.y)) * groundOn;",
          "diffuseColor.rgb *= mix(groundNeutral, groundPaint, groundInside);",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "o2-painted-ground";
  return uniforms;
}

/** One painted ground per page, built on the first call. */
let painted = null;

function paintedGround(ctx) {
  if (painted) return painted;
  const { THREE } = ctx;
  const settings = knobs();
  const started = performance.now();
  const box = localBox(ctx.fixture.bbox, ctx.frame);
  const { entries, failed } = landuseEntries(ctx.features, ctx.frame);
  const plan = rasterPlan(box, settings.texelM);
  const { canvas, shares } = paintCanvas(entries, box, plan, settings);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  const paintMs = performance.now() - started;
  const counts = {};
  for (const { cls } of entries) counts[cls] = (counts[cls] ?? 0) + 1;
  painted = { settings, box, plan, texture, shares, counts, failed };
  window.__paintedGround = {
    settings,
    texture: {
      width: plan.width,
      height: plan.height,
      texelM: plan.texelM,
      bytes: plan.bytes,
      bytesWithMips: Math.round((plan.bytes * 4) / 3),
    },
    areas: entries.length,
    counts,
    failed,
    shares,
    taggedShare: Object.values(shares).reduce((a, b) => a + b, 0),
    chroma: Object.fromEntries(
      Object.entries(GROUND_CLASSES).map(([k, v]) => [k, chroma(v.colour)]),
    ),
    paintMs,
  };
  return painted;
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The legend's few rules, kept here so the page needs no second sheet. */
const LEGEND_CSS = `
.o2-legend { margin-top: 10px; }
.o2-swatches { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; }
.o2-swatch { display: flex; align-items: center; gap: 5px; font-size: 11px; line-height: 18px; min-width: 0; }
.o2-chip { width: 14px; height: 14px; border-radius: 3px; flex: none; border: 1px solid var(--cl-line); }
.o2-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2-share { color: var(--cl-muted); font-variant-numeric: tabular-nums; }
.o2-note { margin: 6px 0 0; color: var(--cl-muted); font-size: 12px; }
`;

/** The ground's own panel section: an on/off row and the scene's legend. */
function addLegend(ground) {
  const panel = document.querySelector(".cl-panel");
  if (!panel) return;
  const style = document.createElement("style");
  style.textContent = LEGEND_CSS;
  document.head.append(style);
  const section = el("section", "o2-legend");
  section.setAttribute("aria-label", "Ground tint");

  const row = el("div", "cl-row");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Ground tint");
  row.append(el("span", "cl-row-label", "Ground tint by land use"));
  const buttons = [
    [true, "on"],
    [false, "off"],
  ].map(([value, text]) => {
    const button = el("button", "cl-button", text);
    button.type = "button";
    button.setAttribute("aria-pressed", String(ground.settings.on === value));
    button.addEventListener("click", () => {
      ground.uniforms.groundOn.value = value ? 1 : 0;
      for (const b of buttons) {
        b.setAttribute("aria-pressed", String(b === button));
      }
    });
    return button;
  });
  row.append(...buttons);

  const list = el("ul", "o2-swatches");
  const present = Object.entries(ground.shares)
    .filter(([, share]) => share >= 0.005)
    .sort((a, b) => b[1] - a[1]);
  for (const [cls, share] of present) {
    const item = el("li", "o2-swatch");
    const chip = el("span", "o2-chip");
    chip.style.background = hex(
      paintColour(cls, ground.settings.strength, GROUND_COLOUR),
    );
    item.append(
      chip,
      el("span", "o2-name", GROUND_CLASSES[cls].label),
      el("span", "o2-share", `${Math.round(share * 100)} %`),
    );
    list.append(item);
  }
  const untagged = 1 - Object.values(ground.shares).reduce((a, b) => a + b, 0);
  const rest = el("li", "o2-swatch");
  const chip = el("span", "o2-chip");
  chip.style.background = hex(GROUND_COLOUR);
  rest.append(
    chip,
    el("span", "o2-name", "Unmapped"),
    el("span", "o2-share", `${Math.round(untagged * 100)} %`),
  );
  list.append(rest);

  const note = el(
    "p",
    "o2-note",
    "Share of the data's box, before roads and buildings cover it. " +
      "Water is a still tint only.",
  );
  section.append(row, list, note);
  panel.append(section);
}

startCityLook({
  ...v2Variant,
  id: "o2",
  label: "O2 painted ground",
  materialFor(kind, material, ctx) {
    if (kind !== "ground") return undefined;
    const ground = paintedGround(ctx);
    ground.uniforms = tintGround(
      material,
      ctx.THREE,
      ground.texture,
      ground.box,
      ground.settings,
    );
    return material;
  },
  objectsFor(features, ctx) {
    const ground = paintedGround(ctx);
    if (ground.uniforms) addLegend(ground);
    return [];
  },
});
