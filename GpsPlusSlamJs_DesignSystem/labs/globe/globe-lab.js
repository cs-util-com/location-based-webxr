/**
 * The globe lab (globe plan 2026-09-26-0539 §7, M0): the globe package's
 * surface, served no-build through the design system's routes. M0 draws the
 * untextured ellipsoid lit by one sun; the imagery, the credits, the target
 * and the turn arrive in M1-M4.
 *
 * @see globe-lab.js.md
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { createGlobeSurface } from "/globe/globe-surface.js";
import { creditsFor } from "/globe/globe-credits.js";
import { GIBS_ACKNOWLEDGEMENT } from "/globe/globe-sources.js";

const canvas = document.getElementById("globe-canvas");
const errorBox = document.getElementById("globe-error");
const creditsBox = document.getElementById("globe-credits");
const loadingLabel = document.getElementById("globe-loading");

/**
 * The async-feedback rule (globe plan §7.8, M1): a label while imagery tiles
 * are pending, and a line in the error box when some could not load (the
 * parent level then shows there, DEC-PRG-14). DOM writes only on a change.
 */
function statusView() {
  let shown = false;
  let lastLoading = "";
  let lastError = "";
  return {
    get loadingShown() {
      return shown;
    },
    update({ pendingTiles, loadedTiles, tileErrors }) {
      const loading =
        pendingTiles > 0
          ? `Loading Earth imagery: ${loadedTiles} of ${loadedTiles + pendingTiles}`
          : "";
      if (loading !== lastLoading) {
        lastLoading = loading;
        loadingLabel.textContent = loading;
        loadingLabel.hidden = loading === "";
        shown ||= loading !== "";
      }
      const error =
        tileErrors > 0
          ? `Some Earth imagery could not load (${tileErrors} tiles): a coarser level shows there.`
          : "";
      if (error !== lastError) {
        lastError = error;
        errorBox.textContent = error;
      }
    },
  };
}

/**
 * The credits line (globe plan §7.7): the short names over the canvas, the
 * full texts, links and GIBS's acknowledgement in a <details>. Built with
 * textContent only: the texts come from the registry, never from markup.
 */
function renderCredits(credits) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Imagery: ${credits.map((c) => c.short).join(" · ")}`;
  details.append(summary);
  const list = document.createElement("ul");
  for (const c of credits) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = c.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = c.full;
    item.append(link);
    list.append(item);
  }
  const note = document.createElement("p");
  note.textContent = GIBS_ACKNOWLEDGEMENT;
  details.append(list, note);
  creditsBox.replaceChildren(details);
}
/** The camera stands this many Earth radii from the centre. */
const DISTANCE_RADII = 3.4;
/**
 * Where it looks until M2 brings the target and the turn: over North Africa
 * and Europe, on the day side of the lab's sun, with north up.
 */
const VIEW = { latDeg: 30, lonDeg: 15 };
const DEG = Math.PI / 180;

/** A unit ECEF direction (z north) for a latitude and longitude. */
function ecefDirection(latDeg, lonDeg) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  );
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const radius = WGS84_ELLIPSOID.radius.x;
  const camera = new THREE.PerspectiveCamera(40, 1, radius * 0.01, radius * 20);
  camera.position
    .copy(ecefDirection(VIEW.latDeg, VIEW.lonDeg))
    .multiplyScalar(radius * DISTANCE_RADII);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  // The sun over the Atlantic, west of the view: a lit face with the
  // terminator on screen, until M3 brings the real sun.
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.copy(ecefDirection(20, -25));
  scene.add(sun);
  const globe = createGlobeSurface();
  scene.add(globe.group);
  const credits = creditsFor(globe.activeSources());
  renderCredits(credits);
  const status = statusView();

  const frame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    globe.update(camera, renderer);
    status.update(globe.state());
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  window.__globeLab = {
    ready: true,
    view: VIEW,
    error: null,
    state: () => ({
      ...globe.state(),
      radiusM: radius,
      activeSources: globe.activeSources(),
      loadingShown: status.loadingShown,
      loadingVisible: !loadingLabel.hidden,
      cacheBudgetBytes: globe.tiles.lruCache.maxBytesSize,
      creditShorts: credits.map((c) => c.short),
    }),
    /**
     * Render one frame and read RGBA bytes at normalised canvas points
     * (0,0 = top-left), in the same task as the render.
     */
    readPixels(points) {
      frame();
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      return points.map(([u, v]) => {
        const px = new Uint8Array(4);
        const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
        const y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      });
    },
  };
}

try {
  start();
} catch (e) {
  window.__globeLab = { ready: false, error: String(e?.stack ?? e) };
  errorBox.textContent = String(e);
  throw e;
}
