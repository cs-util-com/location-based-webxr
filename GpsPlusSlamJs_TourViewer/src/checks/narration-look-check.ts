/**
 * The narration circle's check page (`narration-look-check.html`): one
 * circle in the production look (`narrationLook`) on the narration
 * prototype's bright square, seen from the visitor's eye 20 m south of
 * it, as the prototype's "eye" view shows it. Linked from nothing. The
 * side-by-side check and a frame-cost measure drive the page through
 * `window.__narrationLookCheck`, which is always installed.
 *
 * The scene copies the prototype's numbers (the backdrop's colours, the
 * paving, the walls and the figures, the lights, the 62 degree camera at
 * 1.6 m looking 0.2 rad down), so a screenshot of each can be put next to
 * the other.
 *
 * @see narration-look-check.ts.md
 */
import * as THREE from "three";

import {
  narrationLook,
  type NarrationLook,
  type NarrationState,
} from "../kinds/audio/narration-look.js";

/** The prototype's eye: 1.6 m up, 20 m south, looking 0.2 rad down. */
const EYE = { heightM: 1.6, z: 20, pitch: -0.2, fovDeg: 62 } as const;

/** The prototype's bright backdrop. */
const BRIGHT = {
  sky: "#dfe3e6",
  ground: "#c9ccc7",
  prop: "#aeb1b0",
  figure: "#8f9396",
} as const;

/** One frame-cost measure: the mean time per frame (ms), with the circle
 *  drawn and without, over the same frames, and what the circle adds in
 *  draws. */
interface FrameCost {
  readonly frames: number;
  readonly withMs: number;
  readonly withoutMs: number;
  readonly tickMs: number;
  readonly draws: number;
}

interface NarrationLookCheck {
  /** Stand a circle of `radiusM` (6 by default), re-made from scratch. */
  show(options?: {
    readonly radiusM?: number;
    readonly mode?: "play" | "edit";
  }): void;
  /** What the voice does and whether the visitor is inside. */
  state(state: NarrationState, inside: boolean): void;
  /** Hold the page clock at `seconds` (null: run), so a screenshot is the
   *  same frame each time. */
  hold(seconds: number | null): void;
  /** Draw `frames` frames back to back, waiting for the GPU after each,
   *  with the circle and without. */
  cost(frames?: number): FrameCost;
  /** Stop drawing. */
  stop(): void;
}

declare global {
  interface Window {
    __narrationLookCheck?: NarrationLookCheck;
  }
}

/** The prototype's paving: a white tile with a grid, tinted by the
 *  ground's colour. */
function paving(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g !== null) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(0,0,0,.16)";
    g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(0,0,0,.07)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 256);
    g.moveTo(0, 128);
    g.lineTo(256, 128);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(100, 100);
  return t;
}

/** The prototype's square: ground, two walls, a bench, a post, figures. */
function buildSquare(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: paving(), color: BRIGHT.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const prop = new THREE.MeshLambertMaterial({ color: BRIGHT.prop });
  const box = (w: number, h: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), prop);
    m.position.set(x, h / 2, z);
    scene.add(m);
  };
  box(44, 7, 2, 0, -22);
  box(2, 5, 18, -21, -12);
  box(1.8, 0.45, 0.5, -7, 6);
  box(0.4, 1.1, 0.4, 5, 9);
  const figure = new THREE.MeshLambertMaterial({ color: BRIGHT.figure });
  for (const [x, z] of [
    [-4.5, 2.5],
    [3, -8.5],
    [13, -1],
    [-9, -6],
    [7.5, 4.5],
  ] as const) {
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 1.25, 4, 10),
      figure,
    );
    m.position.set(x, 0.86, z);
    scene.add(m);
  }
}

export function startNarrationLookCheck(host: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = "check-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BRIGHT.sky);
  scene.add(new THREE.HemisphereLight("#ffffff", "#7d807c", 2.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.1);
  sun.position.set(-20, 40, 25);
  scene.add(sun);
  buildSquare(scene);

  const camera = new THREE.PerspectiveCamera(EYE.fovDeg, 1, 0.05, 400);
  camera.rotation.order = "YXZ";
  camera.position.set(0, EYE.heightM, EYE.z);
  camera.rotation.set(EYE.pitch, 0, 0);

  let look: NarrationLook | null = null;
  let running = true;
  let held: number | null = null;
  const seen = new THREE.Vector3();

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function show(
    options: { radiusM?: number; mode?: "play" | "edit" } = {},
  ): void {
    look?.object.removeFromParent();
    look?.dispose();
    const canvas = document.createElement("canvas");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    look = narrationLook(options.radiusM ?? 6, {
      mode: options.mode ?? "play",
      title: "The old well",
      plate: { canvas, texture },
    });
    look.show("idle", false);
    scene.add(look.object);
  }

  /** One frame of the circle: its clock, the plate turned to the eye. */
  function frame(seconds: number): void {
    if (look === null) return;
    look.tick(seconds);
    camera.getWorldPosition(seen);
    look.object.worldToLocal(seen);
    look.face(seen.x, seen.z);
  }

  const gl = renderer.getContext();
  function timed(
    frames: number,
    drawn: boolean,
  ): { ms: number; tickMs: number } {
    if (look !== null) look.object.visible = drawn;
    let tickMs = 0;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      frame(i / 60);
      tickMs += performance.now() - t0;
      renderer.render(scene, camera);
      gl.finish();
    }
    const ms = (performance.now() - start) / frames;
    if (look !== null) look.object.visible = true;
    return { ms, tickMs: tickMs / frames };
  }

  const hook: NarrationLookCheck = {
    show,
    state(state, inside) {
      look?.show(state, inside);
    },
    hold(seconds) {
      held = seconds;
    },
    cost(frames = 300) {
      const n = Math.max(10, Math.min(5000, Math.round(frames)));
      // A warm-up so shader compiles and uploads are not counted.
      timed(20, true);
      timed(20, false);
      const without = timed(n, false);
      const withLook = timed(n, true);
      renderer.info.reset();
      renderer.info.autoReset = false;
      renderer.render(scene, camera);
      const all = renderer.info.render.calls;
      renderer.info.reset();
      if (look !== null) look.object.visible = false;
      renderer.render(scene, camera);
      const bare = renderer.info.render.calls;
      if (look !== null) look.object.visible = true;
      renderer.info.autoReset = true;
      return {
        frames: n,
        withMs: withLook.ms,
        withoutMs: without.ms,
        tickMs: withLook.tickMs,
        draws: all - bare,
      };
    },
    stop() {
      running = false;
    },
  };
  window.__narrationLookCheck = hook;

  resize();
  window.addEventListener("resize", resize);
  show();

  const loop = (now: number): void => {
    if (!running) return;
    frame(held ?? now / 1000);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
