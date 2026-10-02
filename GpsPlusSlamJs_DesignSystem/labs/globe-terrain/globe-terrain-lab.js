// The globe's relief carrier, prepared (round-5 plan 2026-10-01-0945 §8
// DEC-GL5-9, F1a): the tile library's terrain tiles (`/globe/globe-terrain.js`)
// wearing the globe's look, side by side with the globe's own surface, so
// the smokes can hold the carrier to the globe. Not in the default flight
// (that is F1 proper). See globe-terrain-lab.js.md.
import * as THREE from "three";

import { createGlobeSurface } from "/globe/globe-surface.js";
import { createGlobeTerrain } from "/globe/globe-terrain.js";
import {
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_URL_TEMPLATE,
} from "/osm-lib/elevation/terrarium.js";

const DEG = Math.PI / 180;

/**
 * The page's parameters (hash): `carrier` terrain | globe; `alt` km above
 * the target, the camera looking north and down at 45 degrees; `time` an
 * hour UTC on the 2026 March equinox (the sub-solar longitude from it);
 * `heightScale`; `errorTarget` (the library's; 1 is its recommended
 * setting); `heights` synthetic (generated in the page, no network) |
 * terrarium (the live AWS tiles); `hideFloatLinear` 1 hides
 * OES_texture_float_linear from the page, as on a device without it;
 * `debug` height (each pixel the tile's height, for the seam scan);
 * `nadir` 1 looks straight down (no ridge hides another: every step in
 * the height grey is then a seam).
 */
const params = new URLSearchParams(location.hash.slice(1));
const num = (key, fallback) => {
  const v = Number(params.get(key));
  return params.get(key) !== null && Number.isFinite(v) ? v : fallback;
};
const LOOK = Object.freeze({
  carrier: params.get("carrier") === "globe" ? "globe" : "terrain",
  altKm: num("alt", 150),
  hourUtc: num("time", 11.4),
  heightScale: num("heightScale", 1),
  errorTarget: num("errorTarget", 1),
  heights: params.get("heights") === "terrarium" ? "terrarium" : "synthetic",
  hideFloatLinear: params.get("hideFloatLinear") === "1",
  debug: params.get("debug") === "height" ? "height" : null,
  nadir: params.get("nadir") === "1",
});
const TARGET = { lat: 46.5, lng: 9.0 };
const SYNTHETIC_URL = "/globe-terrain-synthetic/{z}/{x}/{y}.png";

if (LOOK.hideFloatLinear) {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (ctx && /webgl/.test(type) && !ctx.__floatLinearHidden) {
      const getExtension = ctx.getExtension.bind(ctx);
      const supported = ctx.getSupportedExtensions.bind(ctx);
      ctx.getExtension = (name) =>
        name === "OES_texture_float_linear" ? null : getExtension(name);
      ctx.getSupportedExtensions = () =>
        (supported() ?? []).filter((n) => n !== "OES_texture_float_linear");
      ctx.__floatLinearHidden = true;
    }
    return ctx;
  };
}

/**
 * A synthetic Terrarium tile: a 1 km plateau with ridges of about 5-50 km
 * (0-2,200 m), so the smokes run without network. Encoded as Terrarium:
 * h + 32768 = r * 256 + g + b / 256.
 */
async function syntheticTile(z, x, y) {
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n = 2 ** z;
  for (let py = 0; py < size; py++) {
    const merc = Math.PI * (1 - (2 * (y + (py + 0.5) / size)) / n);
    const lat = Math.atan(Math.sinh(merc)) / DEG;
    for (let px = 0; px < size; px++) {
      const lng = ((x + (px + 0.5) / size) / n) * 360 - 180;
      const h = Math.max(
        0,
        1000 +
          900 *
            Math.sin((2 * Math.PI * lng) / 0.5) *
            Math.sin((2 * Math.PI * lat) / 0.4) +
          300 *
            Math.sin((2 * Math.PI * lng) / 0.07) *
            Math.cos((2 * Math.PI * lat) / 0.06),
      );
      const v = h + 32768;
      const i = 4 * (py * size + px);
      img.data[i] = Math.floor(v / 256);
      img.data[i + 1] = Math.floor(v) % 256;
      img.data[i + 2] = Math.floor((v - Math.floor(v)) * 256);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/** Every height tile the page asked for, `z/x/y`, and the synthetic bytes. */
const heightRequests = [];
let syntheticBytes = 0;
const fetchOwn = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const synthetic = url.match(
    /\/globe-terrain-synthetic\/(\d+)\/(\d+)\/(\d+)\.png/,
  );
  const live = url.match(/\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
  const m = synthetic ?? live;
  if (m) heightRequests.push(`${m[1]}/${m[2]}/${m[3]}`);
  if (!synthetic) return fetchOwn(input, init);
  const blob = await syntheticTile(...synthetic.slice(1).map(Number));
  syntheticBytes += blob.size;
  return new Response(blob, { headers: { "Content-Type": "image/png" } });
};

/** The sub-solar direction (ECEF) at an hour UTC on the equinox. */
const sunEcefAt = (hours) => {
  const lng = -(hours - 12) * 15 * DEG;
  return new THREE.Vector3(Math.cos(lng), Math.sin(lng), 0);
};

/** Shows each tile's height as grey (0-3,000 m), for the seam scan. */
function heightDebug(material) {
  const hook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    hook.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vTerrainH;",
      )
      .replace(
        "#include <displacementmap_vertex>",
        "#include <displacementmap_vertex>\n#ifdef USE_DISPLACEMENTMAP\nvTerrainH = texture2D( displacementMap, vDisplacementMapUv ).x;\n#else\nvTerrainH = 0.0;\n#endif",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vTerrainH;",
      )
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor = vec4( vec3( clamp( vTerrainH / 3000.0, 0.0, 1.0 ) ), 1.0 );",
      );
  };
  material.customProgramCacheKey = () => "globe-terrain-height-debug";
}

function start() {
  const canvas = document.getElementById("terrain-canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  // Magenta behind everything: a crack in the ground shows as it.
  scene.background = new THREE.Color(LOOK.debug ? 0xff00ff : 0x000000);
  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.clientWidth / canvas.clientHeight,
    1,
    1e7,
  );
  const globe = createGlobeSurface();
  scene.add(globe.group);
  globe.setSun(sunEcefAt(LOOK.hourUtc));
  let terrain = null;
  if (LOOK.carrier === "terrain") {
    globe.tiles.group.visible = false;
    terrain = createGlobeTerrain({
      url:
        LOOK.heights === "terrarium" ? TERRARIUM_URL_TEMPLATE : SYNTHETIC_URL,
      imagery: globe.overlay,
      template: globe.template,
      heightScale: LOOK.heightScale,
    });
    terrain.tiles.errorTarget = LOOK.errorTarget;
    if (LOOK.debug === "height") {
      terrain.tiles.addEventListener("load-model", ({ scene: model }) => {
        model.traverse((o) => {
          if (o.isMesh) heightDebug(o.material);
        });
      });
    }
    scene.add(terrain.tiles.group);
    terrain.tiles.setCamera(camera);
    terrain.tiles.setResolutionFromRenderer(camera, renderer);
  }
  document.getElementById("terrain-credits").textContent =
    LOOK.heights === "terrarium"
      ? TERRARIUM_ATTRIBUTION
      : "Heights: synthetic, generated in the page.";
  const tiles = terrain ? terrain.tiles : globe.tiles;
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  const p = new THREE.Vector3();
  let altKm = LOOK.altKm;
  /** altKm above the target, looking north and down at 45 degrees. */
  const pose = () => {
    const ell = tiles.ellipsoid;
    const lat = TARGET.lat * DEG;
    const lon = TARGET.lng * DEG;
    ell.getEastNorthUpAxes(lat, lon, e, n, u);
    ell.getCartographicToPosition(lat, lon, 1000, p);
    const h = altKm * 1000;
    camera.position.copy(p).addScaledVector(u, h);
    if (!LOOK.nadir) camera.position.addScaledVector(n, -h);
    camera.up.copy(LOOK.nadir ? n : u);
    camera.lookAt(p);
    camera.near = Math.max(1, h * 0.05);
    camera.far = Math.sqrt(2 * 6.371e6 * h) * 3 + h * 4;
    camera.updateProjectionMatrix();
  };
  const frame = () => {
    pose();
    if (terrain) terrain.tiles.update();
    else globe.update(camera, renderer);
    renderer.render(scene, camera);
  };
  const loop = () => {
    frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const gl = renderer.getContext();

  window.__terrainCarrier = {
    ready: true,
    error: null,
    look: LOOK,
    setAlt(km) {
      altKm = km;
    },
    /** Everything loaded and nothing queued, downloading or parsing. */
    settled: () =>
      tiles.loadProgress === 1 &&
      !tiles.downloadQueue.running &&
      !tiles.parseQueue?.running &&
      !tiles.processNodeQueue?.running,
    /** Mean ms of `frames` frames, each finished by a one-pixel read. */
    frameCost(frames = 10) {
      const one = new Uint8Array(4);
      frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        frame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      }
      return (performance.now() - t0) / frames;
    },
    state() {
      const byDepth = {};
      for (const t of tiles.visibleTiles) {
        const d = t.internal?.depth ?? -1;
        byDepth[d] = (byDepth[d] ?? 0) + 1;
      }
      return {
        carrier: LOOK.carrier,
        altKm,
        visibleTiles: tiles.visibleTiles.size,
        visibleByDepth: byDepth,
        triangles: renderer.info.render.triangles,
        heightRequests: heightRequests.slice(),
        syntheticBytes,
        litTiles: terrain ? terrain.litTiles() : null,
        floatLinear: renderer.extensions.has("OES_texture_float_linear"),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    },
    /**
     * The first loaded tile's height texture as the GPU samples it
     * (linear, midway between two texels of one row) against the same
     * value from its data on the CPU: the relief's vertex shader reads
     * the GPU value.
     */
    probeHeight() {
      let map = null;
      tiles.group.traverse((o) => {
        if (!map && o.material?.displacementMap?.image?.data) {
          map = o.material.displacementMap;
        }
      });
      if (!map) return null;
      const { data, width, height } = map.image;
      const row = Math.floor(height / 2);
      const col = Math.floor(width / 2);
      const a = data[row * width + col];
      const b = data[row * width + col + 1];
      const uv = new THREE.Vector2((col + 1) / width, (row + 0.5) / height);
      const target = new THREE.WebGLRenderTarget(1, 1);
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.ShaderMaterial({
          uniforms: { t: { value: map }, uv: { value: uv } },
          vertexShader:
            "void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
          fragmentShader:
            "uniform sampler2D t; uniform vec2 uv; void main() { float v = texture2D( t, uv ).r; gl_FragColor = vec4( fract( v / 256.0 ), floor( v / 256.0 ) / 255.0, 0.0, 1.0 ); }",
        }),
      );
      const s2 = new THREE.Scene();
      s2.add(quad);
      renderer.setRenderTarget(target);
      renderer.render(s2, new THREE.Camera());
      const px = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, px);
      renderer.setRenderTarget(null);
      target.dispose();
      quad.geometry.dispose();
      quad.material.dispose();
      return {
        internalFormat: map.internalFormat,
        cpuMidwayM: (a + b) / 2,
        gpuMidwayM: px[1] * 256 + (px[0] / 255) * 256,
      };
    },
    /** RGBA of the drawing buffer at normalised points (0,0 top-left). */
    readPixels(points) {
      frame();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return points.map(([x, y]) => {
        const i =
          4 *
          ((h - 1 - Math.min(h - 1, Math.floor(y * h))) * w +
            Math.min(w - 1, Math.floor(x * w)));
        return [px[i], px[i + 1], px[i + 2], px[i + 3]];
      });
    },
    /**
     * The seam scan over the lower part of the frame (from `fromY`, 0 at
     * the top), every pixel: how many are the background (cracks) and how
     * many steps between horizontal neighbours exceed each threshold (in
     * levels of the height grey).
     */
    seamScan(fromY = 0.45, thresholds = [3, 6, 12]) {
      frame();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let pixels = 0;
      let holes = 0;
      let lowest = 255;
      let highest = 0;
      const steps = thresholds.map(() => 0);
      const rows = Math.floor(h * (1 - fromY));
      for (let r = 0; r < rows; r++) {
        let prev = null;
        for (let c = 0; c < w; c++) {
          const i = 4 * (r * w + c);
          const hole = px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 255;
          pixels += 1;
          if (hole) {
            holes += 1;
            prev = null;
            continue;
          }
          lowest = Math.min(lowest, px[i]);
          highest = Math.max(highest, px[i]);
          if (prev !== null) {
            const d = Math.abs(px[i] - prev);
            thresholds.forEach((t, k) => {
              if (d > t) steps[k] += 1;
            });
          }
          prev = px[i];
        }
      }
      return { pixels, holes, steps, thresholds, greyRange: [lowest, highest] };
    },
  };
}

try {
  start();
} catch (e) {
  window.__terrainCarrier = { ready: false, error: String(e?.stack ?? e) };
}
