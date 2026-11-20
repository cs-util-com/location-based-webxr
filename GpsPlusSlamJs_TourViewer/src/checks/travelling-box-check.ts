/**
 * The travelling box's check page (`travelling-box-check.html`): a
 * narrated long text's reading sign in the reading stand's plain square
 * (`lectern-check.ts`), its words painted on the plate under the sign
 * from the invisible narration box at the bottom of the page (travel
 * mode, a ghost). Linked from nothing. The layout e2e and the side-by-side
 * check drive it through `window.__travellingBoxCheck`, which is always
 * installed.
 *
 * Every part is the production one: the sign (`reading-sign.ts`), the box
 * (`narration-box.ts`), the painter (`narration-words-paint.ts`) and the
 * plate's size (`travelling-box-rules.ts`). The voice is the long text
 * check's stand-in clock, which stands still until it is moved, so a
 * screenshot sees one exact moment. The plate stays on the sign: the
 * controller that moves the words between sign and screen comes later.
 *
 * @see travelling-box-check.ts.md
 */
import { configureStore } from "@reduxjs/toolkit";
import * as THREE from "three";

import { createNarrationBox } from "../narration-box.js";
import { narrationBoxReducer } from "../narration-box-slice.js";
import {
  paintNarrationWords,
  wordsCanvasSize,
  wordsPaintKey,
  type WordsPaintLayout,
} from "../narration-words-paint.js";
import { mountReadingSign, READING_SIGN } from "../reading-sign.js";
import { plateSizeM, signGrowth } from "../travelling-box-rules.js";
import { canvasTexture } from "../world-part.js";
import { buildSquare, lecternCheckFovDeg } from "./lectern-check.js";
import { checkSegments, createCheckClock } from "./long-text-check.js";

/** The prototype's text (its sample's "normal" record). */
export const TRAVELLING_BOX_CHECK_TEXT = {
  title: "The weighing house",
  body:
    "This house was built for one job: weighing what came to market. Every" +
    " sack of grain, every bale of wool and every cheese passed over the" +
    " great scale inside the door. The scale master wrote each weight in a" +
    " ledger, and the town took one coin in twenty. Look up at the gable." +
    " The iron hook still hangs there, where the heaviest loads were lifted" +
    " with a rope and a wheel. In winter the hall became a dance floor, and" +
    " the scale was pushed against the wall. When the market moved to the" +
    " new square, the house stood empty for many years. Today the ground" +
    " floor is open again, and on the first morning of each month the old" +
    " scale weighs whatever you bring.",
} as const;

/** The visitor's eye height (m), as in the prototype. */
const EYE_M = 1.6;

/** The painted texture's scale: 2.5 to 3 device px a CSS px. */
export function wordsPaintScale(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return Math.min(3, Math.max(2.5, dpr));
}

/** A plane's four corners on the page (CSS px): TL, TR, BR, BL. */
type Corners = [number, number][];

interface TravellingBoxCheckState {
  readonly distanceM: number;
  readonly growth: number;
  readonly camera: {
    readonly position: [number, number, number];
    readonly yaw: number;
    readonly pitch: number;
    readonly fovDeg: number;
    readonly viewW: number;
    readonly viewH: number;
  };
  /** The sign plate's and the words plate's corners, projected from each
   *  mesh's own world corners; null when not drawn. */
  readonly sign: Corners | null;
  readonly plate: Corners | null;
  /** The plate's size on the sign (m), before the growth. */
  readonly plateM: { readonly widthM: number; readonly heightM: number };
  readonly box: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly opacity: number;
  };
  readonly texture: {
    readonly id: number | null;
    readonly width: number;
    readonly height: number;
    readonly scale: number;
    readonly paints: number;
  };
  readonly voice: {
    readonly lit: number;
    readonly lines: number;
    readonly rows: number;
    readonly hint: string;
    readonly totalMs: number;
  };
}

/** The page's hook. */
interface TravellingBoxCheck {
  /** Stands the eye `distanceM` from the sign, `deg` round from its front. */
  standAt(distanceM: number, deg?: number): void;
  /** Pitches the eye by `rad` (null: back to looking at the sign). */
  pitch(rad: number | null): void;
  /** Turns the eye by `rad` from facing the sign. */
  turn(rad: number): void;
  /** Moves the voice to `ms`. */
  at(ms: number): void;
  play(): void;
  pause(): void;
  state(): TravellingBoxCheckState;
  /** The words' texture canvas, for a test to read its pixels. */
  wordsCanvas(): HTMLCanvasElement;
  stop(): void;
}

declare global {
  interface Window {
    __travellingBoxCheck?: TravellingBoxCheck;
  }
}

const corner = new THREE.Vector3();

function cornersOf(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  rect: DOMRect,
): Corners | null {
  const geometry = mesh.geometry;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  if (b === null) return null;
  mesh.updateWorldMatrix(true, false);
  const out: Corners = [];
  for (const [x, y] of [
    [b.min.x, b.max.y],
    [b.max.x, b.max.y],
    [b.max.x, b.min.y],
    [b.min.x, b.min.y],
  ] as const) {
    corner.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    if (corner.z > 1) return null;
    out.push([
      rect.left + ((corner.x + 1) / 2) * rect.width,
      rect.top + ((1 - corner.y) / 2) * rect.height,
    ]);
  }
  return out;
}

export function startTravellingBoxCheck(host: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "check-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dde4e8");
  scene.fog = new THREE.Fog("#dde4e8", 70, 190);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9a59d, 2.3));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-20, 40, 25);
  scene.add(sun);
  buildSquare(scene);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 600);
  camera.rotation.order = "YXZ";

  const sign = mountReadingSign({ id: "check", ...TRAVELLING_BOX_CHECK_TEXT });
  sign.setVoiceState("idle");
  scene.add(sign.object);

  const plain = TRAVELLING_BOX_CHECK_TEXT.body;
  const segments = checkSegments(plain);
  const totalMs = segments.at(-1)?.endMs ?? 0;
  const clock = createCheckClock(totalMs);
  const store = configureStore({
    reducer: { narrationBox: narrationBoxReducer },
  });
  const box = createNarrationBox({ host: document.body, store });
  box.show(
    {
      key: "check",
      title: TRAVELLING_BOX_CHECK_TEXT.title,
      speaker: { name: "Narrator", color: "#f9a8d4" },
      plain,
      timing: { segments },
      player: clock,
      synthetic: true,
    },
    "travel",
  );
  box.setGhost(true);

  const scale = wordsPaintScale(window.devicePixelRatio);
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  let texture: THREE.CanvasTexture | null = null;
  let painted: WordsPaintLayout | null = null;
  let key = "";
  let paints = 0;
  let plateM = { widthM: 0, heightM: 0 };

  /** Sizes the canvas for a new layout and hangs the plate at its shape;
   *  false when the layout has no size yet. */
  function hangPlate(l: WordsPaintLayout): boolean {
    const size = wordsCanvasSize(l, scale);
    if (size.width <= 0 || size.height <= 0) return false;
    if (
      texture === null ||
      canvas.width !== size.width ||
      canvas.height !== size.height
    ) {
      canvas.width = size.width;
      canvas.height = size.height;
      texture?.dispose();
      texture = canvasTexture(canvas);
    }
    plateM = plateSizeM(l.width, l.height, l.fontPx);
    sign.attachWords(texture, plateM);
    painted = l;
    return true;
  }

  /** Repaints the words when they look different, and hangs the plate
   *  anew when the box is laid out anew. */
  function paintWords(): void {
    const model = box.paintModel();
    if (model === null || g === null) return;
    const next = wordsPaintKey(model.layout, model.frame);
    if (model.layout === painted && next === key) return;
    if (model.layout !== painted && !hangPlate(model.layout)) return;
    paintNarrationWords(g, model, scale);
    if (texture !== null) texture.needsUpdate = true;
    key = next;
    paints += 1;
  }

  let distanceM = 3;
  let deg = 0;
  let turnRad = 0;
  let pitchRad: number | null = null;
  let running = true;

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = lecternCheckFovDeg(w, h);
    camera.updateProjectionMatrix();
  }

  /** The prototype's eye: facing the sign, looking at the middle between
   *  the sign and the words plate, both grown. */
  function placeEye(): void {
    const a = (deg * Math.PI) / 180;
    camera.position.set(
      Math.sin(a) * distanceM,
      EYE_M,
      Math.cos(a) * distanceM,
    );
    const growth = painted === null ? 1 : signGrowth(distanceM);
    const wordsY = sign.wordsPlate.position.y;
    const lookH =
      painted === null
        ? READING_SIGN.centreM * growth
        : ((READING_SIGN.centreM + wordsY) / 2) * growth;
    const auto = Math.atan2(lookH - EYE_M, Math.max(0.5, distanceM));
    camera.rotation.set(
      pitchRad ?? auto,
      Math.atan2(camera.position.x, camera.position.z) + turnRad,
      0,
    );
    camera.updateMatrixWorld();
  }

  function frame(): void {
    box.tick();
    paintWords();
    placeEye();
    sign.update({
      viewer: [camera.position.x, camera.position.y, camera.position.z],
    });
  }

  const hook: TravellingBoxCheck = {
    standAt(d, at = 0) {
      if (!(Number.isFinite(d) && d > 0) || !Number.isFinite(at)) {
        throw new TypeError("standAt needs a distance > 0 and an angle");
      }
      distanceM = d;
      deg = at;
      frame();
    },
    pitch(rad) {
      pitchRad = rad;
      frame();
    },
    turn(rad) {
      turnRad = rad;
      frame();
    },
    at(ms) {
      clock.seek(ms);
      frame();
    },
    play() {
      clock.play();
      frame();
    },
    pause() {
      clock.pause();
      frame();
    },
    state() {
      frame();
      scene.updateMatrixWorld(true);
      const rect = renderer.domElement.getBoundingClientRect();
      const boxRect = box.element.getBoundingClientRect();
      const v = box.state();
      const growth = sign.object.getObjectByName("reading-sign-grow")?.scale.x;
      return {
        distanceM,
        growth: growth ?? 1,
        camera: {
          position: [camera.position.x, camera.position.y, camera.position.z],
          yaw: camera.rotation.y,
          pitch: camera.rotation.x,
          fovDeg: camera.fov,
          viewW: rect.width,
          viewH: rect.height,
        },
        sign: cornersOf(sign.tapTarget as THREE.Mesh, camera, rect),
        plate:
          sign.wordsPlate.parent === null
            ? null
            : cornersOf(sign.wordsPlate as THREE.Mesh, camera, rect),
        plateM,
        box: {
          left: boxRect.left,
          top: boxRect.top,
          width: boxRect.width,
          height: boxRect.height,
          opacity: Number(getComputedStyle(box.element).opacity),
        },
        texture: {
          id: texture?.id ?? null,
          width: canvas.width,
          height: canvas.height,
          scale,
          paints,
        },
        voice: {
          lit: v.lit,
          lines: v.lines,
          rows: v.rows,
          hint: v.hint,
          totalMs,
        },
      };
    },
    wordsCanvas: () => canvas,
    stop() {
      running = false;
    },
  };
  window.__travellingBoxCheck = hook;

  resize();
  window.addEventListener("resize", () => {
    resize();
    frame();
  });
  frame();

  const loop = (): void => {
    if (!running) return;
    frame();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
