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

const canvas = document.getElementById("globe-canvas");
const errorBox = document.getElementById("globe-error");
/** The camera stands this many Earth radii from the centre. */
const DISTANCE_RADII = 3.4;

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const radius = WGS84_ELLIPSOID.radius.x;
  const camera = new THREE.PerspectiveCamera(40, 1, radius * 0.01, radius * 20);
  camera.position.set(0, 0, radius * DISTANCE_RADII);
  camera.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(1, 0.4, 1);
  scene.add(sun);
  const globe = createGlobeSurface();
  scene.add(globe.group);

  const frame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    globe.update(camera, renderer);
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  window.__globeLab = {
    ready: true,
    error: null,
    state: () => ({ ...globe.state(), radiusM: radius }),
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
