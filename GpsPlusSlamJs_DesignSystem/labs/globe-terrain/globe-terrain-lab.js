// The globe's relief carrier, prepared (round-5 plan 2026-10-01-0945 §8
// DEC-GL5-9, F1a): the tile library's terrain tiles (`/globe/globe-terrain.js`)
// wearing the globe's look, side by side with the globe's own surface, so
// the smokes can hold the carrier to the globe. Not in the default flight
// (that is F1 proper). See globe-terrain-lab.js.md.
import * as THREE from "three";

import { createGlobeSurface } from "/globe/globe-surface.js";
import { GLOBE_TERRAIN, createGlobeTerrain } from "/globe/globe-terrain.js";
import {
  SYNTHETIC_HEIGHTS_URL,
  installSyntheticHeights,
} from "./synthetic-heights.js";
import {
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_URL_TEMPLATE,
} from "/osm-lib/elevation/terrarium.js";

const DEG = Math.PI / 180;

/**
 * The page's parameters (hash): `carrier` terrain | globe; `alt` km above
 * the target, the camera looking north and down at 45 degrees; `time` an
 * hour UTC on the 2026 March equinox (the sub-solar longitude from it);
 * `heightScale`; `errorTarget` (the carrier's, `GLOBE_TERRAIN.errorTarget`,
 * 2, by default; 1 is the library's); `heights` synthetic (generated in the page, no network) |
 * terrarium (the live AWS tiles); `hideFloatLinear` 1 hides
 * OES_texture_float_linear from the page, as on a device without it;
 * `debug` height (each pixel the tile's height, for the seam scan);
 * `nadir` 1 looks straight down (no ridge hides another: every step in
 * the height grey is then a seam); `lat`, `lng` the target (default
 * 46.5, 9.0); `seamControl` 1 offsets every tile's heights by its own
 * random amount (up to 50 m either way), the seam scan's positive control;
 * `heightFormat` r32f keeps the library's 32-bit heights (the half-float
 * patch undone, for the R16F-against-R32F shading comparison); `sea` m
 * lowers the synthetic heights by that much (a coast, for the bathymetry
 * check).
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
  errorTarget: num("errorTarget", GLOBE_TERRAIN.errorTarget),
  heights: params.get("heights") === "terrarium" ? "terrarium" : "synthetic",
  hideFloatLinear: params.get("hideFloatLinear") === "1",
  debug: params.get("debug") === "height" ? "height" : null,
  nadir: params.get("nadir") === "1",
  seamControl: params.get("seamControl") === "1",
  heightFormat: params.get("heightFormat") === "r32f" ? "r32f" : "r16f",
  seaM: num("sea", 0),
});
const TARGET = { lat: num("lat", 46.5), lng: num("lng", 9.0) };

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

/** Every height tile asked for, and the synthetic PNGs' bytes. */
const heightRecord = installSyntheticHeights({ seaM: LOOK.seaM });

/** The sub-solar direction (ECEF) at an hour UTC on the equinox. */
const sunEcefAt = (hours) => {
  const lng = -(hours - 12) * 15 * DEG;
  return new THREE.Vector3(Math.cos(lng), Math.sin(lng), 0);
};

/**
 * Shows each tile's displaced height in two channels (review 2026-10-02-1235 major 1):
 * v = (h + 1,000 m) x 8, red its high byte, green its low byte, so a step
 * of 0.125 m reads from -1,000 to 7,191 m (the Alps fit). Blue is 0.
 */
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
        "#include <project_vertex>",
        "#ifdef USE_DISPLACEMENTMAP\nvTerrainH = max( texture2D( displacementMap, vDisplacementMapUv ).x, 0.0 ) * displacementScale + displacementBias;\n#else\nvTerrainH = 0.0;\n#endif\n#include <project_vertex>",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vTerrainH;",
      )
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nfloat v = clamp( floor( ( vTerrainH + 1000.0 ) * 8.0 + 0.5 ), 0.0, 65535.0 );\ngl_FragColor = vec4( floor( v / 256.0 ) / 255.0, mod( v, 256.0 ) / 255.0, 0.0, 1.0 );",
      );
  };
  material.customProgramCacheKey = () => "globe-terrain-height-debug";
  // Draw as is: no tone mapping or colour encoding on the code.
  material.toneMapped = false;
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
    // The relief's side of the altitude band's dither keeps every pixel
    // (this page shows one carrier at a time).
    globe.surfaceUniforms.uCarrierShare.value = 1;
    terrain = createGlobeTerrain({
      url:
        LOOK.heights === "terrarium"
          ? TERRARIUM_URL_TEMPLATE
          : SYNTHETIC_HEIGHTS_URL,
      imagery: globe.overlay,
      template: globe.template,
      heightScale: LOOK.heightScale,
    });
    terrain.tiles.errorTarget = LOOK.errorTarget;
    terrain.tiles.addEventListener("load-model", ({ scene: model }) => {
      model.traverse((o) => {
        if (!o.isMesh) return;
        const map = o.material.displacementMap;
        if (LOOK.heightFormat === "r32f" && map) {
          map.internalFormat = null;
          map.needsUpdate = true;
        }
        // The positive control: a seam of up to 50 m at every tile edge.
        if (LOOK.seamControl)
          o.material.displacementBias = (Math.random() - 0.5) * 100;
        if (LOOK.debug === "height") heightDebug(o.material);
      });
    });
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
      // The library's depth counts its root: a tile's level is depth - 1.
      const byLevel = {};
      for (const t of tiles.visibleTiles) {
        const d = (t.internal?.depth ?? 0) - 1;
        byLevel[d] = (byLevel[d] ?? 0) + 1;
      }
      return {
        carrier: LOOK.carrier,
        altKm,
        visibleTiles: tiles.visibleTiles.size,
        visibleByLevel: byLevel,
        triangles: renderer.info.render.triangles,
        heightRequests: heightRecord.requests.slice(),
        syntheticBytes: heightRecord.bytes(),
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
     * The seam scan of a `debug=height` frame below `fromY` (0 at the
     * top), every pixel: how many are the background (cracks), the drawn
     * height range, and how many steps to the right and lower neighbour
     * exceed each threshold (metres, from the two-channel height).
     */
    seamScan(fromY = 0, thresholdsM = [10, 30, 100]) {
      frame();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const rows = Math.floor(h * (1 - fromY));
      const heightAt = (r, c) => {
        const i = 4 * (r * w + c);
        const hole = px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 255;
        return hole ? null : (px[i] * 256 + px[i + 1]) / 8 - 1000;
      };
      let pixels = 0;
      let holes = 0;
      let lowest = Infinity;
      let highest = -Infinity;
      const steps = thresholdsM.map(() => 0);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < w; c++) {
          const here = heightAt(r, c);
          pixels += 1;
          if (here === null) {
            holes += 1;
            continue;
          }
          lowest = Math.min(lowest, here);
          highest = Math.max(highest, here);
          // Both axes: the right and the lower neighbour.
          for (const [rr, cc] of [
            [r, c + 1],
            [r + 1, c],
          ]) {
            if (rr >= rows || cc >= w) continue;
            const there = heightAt(rr, cc);
            if (there === null) continue;
            const d = Math.abs(here - there);
            thresholdsM.forEach((t, k) => {
              if (d > t) steps[k] += 1;
            });
          }
        }
      }
      return {
        pixels,
        holes,
        steps,
        thresholdsM,
        heightRangeM: [lowest, highest],
      };
    },
  };
}

try {
  start();
} catch (e) {
  window.__terrainCarrier = { ready: false, error: String(e?.stack ?? e) };
}
