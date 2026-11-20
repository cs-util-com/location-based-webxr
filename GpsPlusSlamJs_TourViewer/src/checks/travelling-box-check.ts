/**
 * The travelling box's check page (`check.html?view=travelling-box`): a
 * narrated long text's reading sign in the reading stand's plain square
 * (`lectern-check.ts`), its words painted on the plate under the sign
 * from the invisible narration box at the bottom of the page (travel
 * mode, a ghost), moved between the sign and the screen by the travelling
 * box's controller. Linked from nothing. The layout e2e and the side-by-side
 * check drive it through `window.__travellingBoxCheck`, which is always
 * installed.
 *
 * Every part is the production one: the sign (`reading-sign.ts`), the box
 * (`narration-box.ts`), the sign's words as a surface
 * (`travelling-box-sign.ts`), the controller (`travelling-box.ts`) and
 * its registry (`travel-registry.ts`). The voice is the long text check's
 * stand-in clock, which stands still until it is moved, so a screenshot
 * sees one exact moment.
 *
 * @see travelling-box-check.ts.md
 */
import { configureStore } from "@reduxjs/toolkit";
import * as THREE from "three";

import { createNarrationBox } from "../narration-box.js";
import { narrationBoxReducer } from "../narration-box-slice.js";
import { wordsPaintScale } from "../narration-words-paint.js";
import {
  mountReadingSign,
  READING_SIGN,
  type ReadingSignVoice,
} from "../reading-sign.js";
import { createTravelRegistry } from "../travel-registry.js";
import {
  createTravellingBox,
  type TravelPlaceEvent,
  type TravellingBox,
  type TravellingBoxCost,
  type TravellingBoxState,
  type TravelViewRect,
} from "../travelling-box.js";
import {
  plateSizeM,
  signGrowth,
  TRAVELLING_BOX_DEFAULTS,
} from "../travelling-box-rules.js";
import { signWordsGrowth, signWordsSurface } from "../travelling-box-sign.js";
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
    /** The voice's line as a float. */
    readonly line: number;
    readonly playing: boolean;
  };
  /** The controller's state: place, why, u, presence, the plate's and the
   *  quad's corners relative to the view, the dock, the metrics, which
   *  mesh shows, the texture ids, the surface id. */
  readonly travel: TravellingBoxState;
  /** The words plate's own material map (independent of the travel
   *  state's texture id). */
  readonly plateMapId: number | null;
  /** The ghost takes pointers itself. */
  readonly ghostPointer: boolean;
  /** The drawing area on the page. */
  readonly view: TravelViewRect;
  /** The settled changes so far. */
  readonly events: readonly TravelPlaceEvent[];
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
  /** Overrides both holds (s); null: the defaults. Starts the travel
   *  afresh. */
  hold(s: number | null): void;
  openSheet(): void;
  closeSheet(): void;
  /** The travel's cost counters. */
  cost(): TravellingBoxCost;
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

function plateMapIdOf(plate: THREE.Object3D): number | null {
  if (!(plate instanceof THREE.Mesh)) return null;
  const m = plate.material as THREE.MeshBasicMaterial | THREE.Material[];
  return Array.isArray(m) ? null : (m.map?.id ?? null);
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
  const scale = wordsPaintScale(window.devicePixelRatio);
  const canvas = document.createElement("canvas");
  let sheetOpen = false;
  const surface = signWordsSurface({
    id: "check",
    sign,
    box,
    scale,
    travelling: () => true,
    voice: () => true,
    inStation: () => true,
    sheetOpen: () => sheetOpen,
  });
  const registry = createTravelRegistry();
  let view: TravelViewRect = { left: 0, top: 0, width: 1, height: 1 };
  let knobs = TRAVELLING_BOX_DEFAULTS;
  const events: TravelPlaceEvent[] = [];
  let travel: TravellingBox | null = null;

  /** A fresh controller for the current knobs. */
  function startTravel(): void {
    travel?.stop();
    travel = createTravellingBox({
      surface,
      scene,
      camera,
      knobs,
      now: () => performance.now(),
      reduceMotion: () =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      viewRect: () => view,
      createCanvas: () => canvas,
      upload: (texture) => {
        renderer.initTexture(texture);
      },
      onPlace: (event) => events.push(event),
      registry,
    });
  }
  startTravel();
  renderer.domElement.addEventListener("pointerdown", (e) => {
    registry.pointerDown(e, renderer.domElement);
  });

  let distanceM = 3;
  let deg = 0;
  let turnRad = 0;
  let pitchRad: number | null = null;
  let running = true;

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    const r = host.getBoundingClientRect();
    view = { left: r.left, top: r.top, width: w, height: h };
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
    const hung = sign.wordsPlate.parent !== null;
    const growth = hung
      ? (signWordsGrowth(knobs.grow) ?? signGrowth(distanceM))
      : 1;
    const wordsY = sign.wordsPlate.position.y;
    const lookH = hung
      ? ((READING_SIGN.centreM + wordsY) / 2) * growth
      : READING_SIGN.centreM * growth;
    const auto = Math.atan2(lookH - EYE_M, Math.max(0.5, distanceM));
    camera.rotation.set(
      pitchRad ?? auto,
      Math.atan2(camera.position.x, camera.position.z) + turnRad,
      0,
    );
    camera.updateMatrixWorld();
  }

  /** The sign chip follows the voice, as the prototype's sign does. */
  function chipState(): ReadingSignVoice {
    if (clock.playing()) return "playing";
    const at = clock.nowMs();
    if (at >= totalMs) return "ended";
    return at > 0 ? "paused" : "idle";
  }

  function frame(): void {
    box.tick();
    sign.setVoiceState(chipState());
    placeEye();
    sign.update({
      viewer: [camera.position.x, camera.position.y, camera.position.z],
      growth: signWordsGrowth(knobs.grow),
    });
    camera.updateMatrixWorld();
    registry.frame();
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
    hold(s) {
      if (s !== null && !(Number.isFinite(s) && s >= 0)) {
        throw new TypeError("hold needs a time >= 0 or null");
      }
      knobs =
        s === null
          ? TRAVELLING_BOX_DEFAULTS
          : { ...TRAVELLING_BOX_DEFAULTS, holdDock: s, holdPlate: s };
      startTravel();
      frame();
    },
    openSheet() {
      sheetOpen = true;
      frame();
    },
    closeSheet() {
      sheetOpen = false;
      frame();
    },
    cost() {
      if (travel === null) throw new Error("no travel");
      return travel.cost();
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
      // Rendered here too, so the quad's corners (written before its draw)
      // are this frame's.
      renderer.render(scene, camera);
      scene.updateMatrixWorld(true);
      const rect = renderer.domElement.getBoundingClientRect();
      const boxRect = box.element.getBoundingClientRect();
      const v = box.state();
      const growth = sign.object.getObjectByName("reading-sign-grow")?.scale.x;
      if (travel === null) throw new Error("no travel");
      const t = travel.state();
      const layout = box.paintModel()?.layout ?? null;
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
        plateM:
          layout === null
            ? { widthM: 0, heightM: 0 }
            : plateSizeM(layout.width, layout.height, layout.fontPx),
        box: {
          left: boxRect.left,
          top: boxRect.top,
          width: boxRect.width,
          height: boxRect.height,
          opacity: Number(getComputedStyle(box.element).opacity),
        },
        texture: {
          id: t.textureId,
          width: canvas.width,
          height: canvas.height,
          scale,
          paints: t.paints,
        },
        voice: {
          lit: v.lit,
          lines: v.lines,
          rows: v.rows,
          hint: v.hint,
          totalMs,
          line: v.line,
          playing: clock.playing(),
        },
        travel: t,
        plateMapId: plateMapIdOf(sign.wordsPlate),
        ghostPointer: !box.element.classList.contains("nb-nopointer"),
        view,
        events: [...events],
      };
    },
    wordsCanvas: () => canvas,
    stop() {
      running = false;
      travel?.stop();
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
