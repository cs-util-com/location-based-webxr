/**
 * Then and now's check page (`then-now-check.html`): one `thenNow`
 * picture with its production part (`viewpointWorld`), seen from exactly
 * its viewpoint, so its slider shows at once and Swipe can be tried on a
 * desktop without a phone or a tour. Linked from nothing. "Today" is a
 * plain blue backdrop and the old picture a red one with a light grid,
 * so either side of the line is told apart at a glance and by a pixel.
 *
 * The e2e (`playwright-tests/then-now-check.spec.js`) drives the real
 * panel and knob and reads the page through `window.__thenNowCheck`,
 * which is always installed (the page has no demo bar, so a person and a
 * test see the same page).
 *
 * @see then-now-check.ts.md
 */
import type {
  TourPictureBlock,
  TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import * as THREE from "three";

import { viewpointWorld } from "../kinds/picture/viewpoint-world.js";
import { screenIn, worldEnv, type WorldPart } from "../world-part.js";

/** "Today": what the visitor sees where the old picture is cut away. */
const TODAY_COLOR = "#3d7ab8";
/** The old picture's ground colour. */
const THEN_COLOR = "#c0392b";

/** Where the picture was taken: 1.6 m up, looking along +z. */
const VIEWPOINT: TourPictureViewpoint = {
  position: [0, 1.6, 0],
  rotation: [0, 1, 0, 0],
  hfovDeg: 60,
  distanceM: 12,
};

const BLOCK: TourPictureBlock = {
  id: "then-now-check",
  kind: "picture",
  view: "thenNow",
  image: "then",
  widthM: 1,
  title: "The square",
  caption: "The square on market day. The stalls are gone.",
  year: "1902",
  viewpoint: VIEWPOINT,
  pose: { position: [3, 0, 4], rotation: [0, 0, 0, 1] },
};

/** The camera sees a little more across than the picture, so its soft
 *  edges stay on screen. */
const CAMERA_HFOV_DEG = 66;

/** What the shader is told (`swipeMask`'s read-out on the material). */
interface SwipeReading {
  readonly on: boolean;
  readonly split: number;
}

/** The page's hook. */
interface ThenNowCheck {
  /** The picture's swipe as its shader has it; null until it stands. */
  state(): SwipeReading | null;
  /** The drawn colour [r, g, b] (0-255) at a share of the canvas's width
   *  and height from its top left, drawn afresh for the reading. */
  sample(xShare: number, yShare: number): readonly [number, number, number];
  /** Stop drawing, so a closing browser is not kept busy by the loop. */
  stop(): void;
}

declare global {
  interface Window {
    __thenNowCheck?: ThenNowCheck;
  }
}

/** The old picture: its ground colour with a light grid, as a PNG. */
function paintThen(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  const g = canvas.getContext("2d");
  if (g === null) return Promise.reject(new Error("no 2D canvas"));
  g.fillStyle = THEN_COLOR;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = "rgb(255 235 205 / 55%)";
  g.lineWidth = 3;
  for (let x = 50; x < canvas.width; x += 100) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, canvas.height);
    g.stroke();
  }
  for (let y = 50; y < canvas.height; y += 100) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(canvas.width, y);
    g.stroke();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("the picture was not painted"));
      else resolve(blob);
    }, "image/png");
  });
}

export function startThenNowCheck(
  host: HTMLElement,
  screenHost: HTMLElement,
): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "check-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(TODAY_COLOR);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 600);
  camera.position.set(...VIEWPOINT.position);
  camera.quaternion.set(...VIEWPOINT.rotation);
  camera.updateMatrixWorld(true);

  const env = worldEnv(
    "play",
    [{ id: "then", path: "content/then.png", kind: "image" }],
    () => paintThen(),
    { screen: screenIn(screenHost) },
  );
  const part: WorldPart | null = viewpointWorld(BLOCK, env);
  if (part === null) throw new Error("then and now stands no part");
  part.object.position.set(...BLOCK.pose.position);
  part.object.quaternion.set(...BLOCK.pose.rotation);
  scene.add(part.object);
  let ready = false;
  void part.ready?.then(
    () => {
      ready = true;
    },
    (error: unknown) => {
      console.error(error);
    },
  );

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfAcross = Math.tan((CAMERA_HFOV_DEG * Math.PI) / 360);
    camera.fov = (2 * Math.atan(halfAcross / camera.aspect) * 180) / Math.PI;
    camera.updateProjectionMatrix();
  }

  const start = performance.now();
  function draw(): void {
    part?.update?.({
      seconds: (performance.now() - start) / 1000,
      viewer: VIEWPOINT.position,
      camera,
    });
    renderer.render(scene, camera);
  }

  let running = true;
  const hook: ThenNowCheck = {
    state() {
      if (!ready) return null;
      const plane = part.object.getObjectByName("picture-viewpoint-plane");
      const material =
        plane instanceof THREE.Mesh ? (plane.material as THREE.Material) : null;
      const read = material?.userData["thenNowSwipe"] as
        (() => SwipeReading) | undefined;
      return typeof read === "function" ? read() : null;
    },
    sample(xShare, yShare) {
      if (!Number.isFinite(xShare) || !Number.isFinite(yShare)) {
        throw new TypeError("sample needs two finite shares");
      }
      draw();
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const x = Math.min(w - 1, Math.max(0, Math.floor(xShare * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor((1 - yShare) * h)));
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
    },
    stop() {
      running = false;
    },
  };
  window.__thenNowCheck = hook;

  resize();
  window.addEventListener("resize", resize);
  const loop = (): void => {
    if (!running) return;
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
