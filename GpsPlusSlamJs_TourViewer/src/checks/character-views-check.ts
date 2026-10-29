/**
 * The character views' check page (`character-views-check.html`): one
 * tour character (the station-blocks-7 prototype's knight) standing in a
 * plain daylight scene like the prototype's, in one of his world views,
 * seen from the visitor's eye. Linked from nothing. For a person, a demo
 * with a bar to switch the view; with `?hook=1` the bar is gone and the
 * layout e2e and the side-by-side check drive the page through
 * `window.__characterViewsCheck` (installed in both modes).
 *
 * The scene copies the prototype's numbers (background, fog, the 1.6 m
 * eye, the "short side sees 40 degrees" field of view, the first
 * station's place), so a screenshot of each can be put next to the other.
 */
import * as THREE from "three";

import { checkPageMode } from "./model-views-check.js";
import {
  createCharacterLook,
  type CharacterBeckon,
  type CharacterLook,
  type CharacterLookState,
  type CharacterVoice,
} from "../character-look.js";
import { TOUR_CHARACTER_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { isStageCharacterView } from "../character-views.js";

/** The prototype's first station: Wendel, his line and his place. */
export const CHECK_CHARACTER = {
  name: "Wendel the Warden",
  line: "Good day, traveller! My keep stood behind that broken wall. Come, the market road runs east.",
  heightM: 1.85,
  at: [-3.2, -4.5] as const,
  /** The prototype's own viewpoint for station 1 (`viewpointFor(0)`). */
  eye: [-2.6998, 0.2742] as const,
  /** The second station, for the beckon (`two-stations`). */
  next: { at: [61.6, -2.2] as const, title: "East road" },
} as const;

/** The visitor's eye height (m), as in the prototype. */
export const CHECK_EYE_M = 1.6;
const FIGURE_URL = "/checks/character-knight.webp";

/** A part's box on the page (CSS px), or null when it is not drawn. */
export interface PartRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CharacterViewsCheckState extends CharacterLookState {
  readonly parts: {
    readonly figure: PartRect | null;
    readonly bubble: PartRect | null;
    readonly pip: PartRect | null;
    readonly scroll: PartRect | null;
    readonly popup: PartRect | null;
  };
  /** His head (0.86 of his height) projected onto the page. */
  readonly head: { readonly x: number; readonly y: number } | null;
}

export interface ShowOptions {
  readonly view: string;
  readonly name?: string;
  readonly line?: string;
  readonly heightM?: number;
}

/** The page's hook. */
export interface CharacterViewsCheck {
  /** Stand the character in `view` (re-made from scratch). */
  show(options: ShowOptions): Promise<void>;
  /** Stand the visitor's eye over (x, z), in metres (x north, z east). */
  standAt(x: number, z: number): void;
  /** Look at a point (m, y up). */
  lookAt(x: number, y: number, z: number): void;
  setVoice(voice: CharacterVoice): void;
  /** The beckon toward the next station; `true` uses the page's second
   *  station, null none. */
  setBeckon(beckon: CharacterBeckon | true | null): void;
  /** Jump every ease to its settled state and draw one frame. */
  settle(): void;
  state(): CharacterViewsCheckState | null;
  /** Stop drawing, so a closing browser is not kept busy by the loop. */
  stop(): void;
}

declare global {
  interface Window {
    __characterViewsCheck?: CharacterViewsCheck;
  }
}

/** The prototype's field of view rule: the short side sees 40 degrees. */
export function checkFovDeg(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 40;
  if (width >= height) return 40;
  const aspect = width / height;
  const half = (40 * Math.PI) / 180 / 2;
  return (2 * Math.atan(Math.tan(half) / aspect) * 180) / Math.PI;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export function startCharacterViewsCheck(host: HTMLElement): void {
  const mode = checkPageMode(location.search);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "check-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4e9ee);
  scene.fog = new THREE.Fog(0xe4e9ee, 70, 240);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ab, 1.2));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0xc9cdd0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  const target = new THREE.Vector3();
  const holder = new THREE.Group();
  holder.position.set(CHECK_CHARACTER.at[0], 0, CHECK_CHARACTER.at[1]);
  scene.add(holder);

  let look: CharacterLook | null = null;
  let figure: HTMLImageElement | null = null;
  let voice: CharacterVoice = "idle";
  let beckon: CharacterBeckon | null = null;
  let heightM: number = CHECK_CHARACTER.heightM;
  let running = true;

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = checkFovDeg(w, h);
    camera.updateProjectionMatrix();
  }

  function standAt(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new TypeError("standAt needs two finite numbers");
    }
    camera.position.set(x, CHECK_EYE_M, z);
    camera.lookAt(target);
  }

  function lookAt(x: number, y: number, z: number): void {
    if (![x, y, z].every(Number.isFinite)) {
      throw new TypeError("lookAt needs three finite numbers");
    }
    target.set(x, y, z);
    camera.lookAt(target);
  }

  function frame(snap: boolean): void {
    look?.update({ nowMs: performance.now(), camera, snap });
    renderer.render(scene, camera);
  }

  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  function rectOf(object: THREE.Object3D): PartRect | null {
    let shown = object.visible;
    object.traverseAncestors((a) => {
      if (!a.visible) shown = false;
    });
    if (!shown) return null;
    object.updateWorldMatrix(true, true);
    box.setFromObject(object);
    if (box.isEmpty()) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      corner.project(camera);
      if (corner.z > 1) return null;
      const px = rect.left + ((corner.x + 1) / 2) * rect.width;
      const py = rect.top + ((1 - corner.y) / 2) * rect.height;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
    return { left, top, right, bottom };
  }

  async function show(options: ShowOptions): Promise<void> {
    if (!isStageCharacterView(options.view)) {
      throw new TypeError(
        `"view" must be one of ${TOUR_CHARACTER_VIEWS.join(", ")}`,
      );
    }
    figure ??= await loadImage(FIGURE_URL);
    look?.dispose();
    heightM = options.heightM ?? CHECK_CHARACTER.heightM;
    look = createCharacterLook({
      view: options.view,
      name: options.name ?? CHECK_CHARACTER.name,
      line: options.line ?? CHECK_CHARACTER.line,
      figure,
      heightM,
    });
    look.setVoice(voice);
    look.setBeckon(beckon);
    holder.add(look.root);
    frame(true);
  }

  const hook: CharacterViewsCheck = {
    show,
    standAt,
    lookAt,
    setVoice(next) {
      voice = next;
      look?.setVoice(next);
    },
    setBeckon(next) {
      beckon =
        next === true
          ? {
              dx: CHECK_CHARACTER.next.at[0] - CHECK_CHARACTER.at[0],
              dz: CHECK_CHARACTER.next.at[1] - CHECK_CHARACTER.at[1],
              title: CHECK_CHARACTER.next.title,
            }
          : next;
      look?.setBeckon(beckon);
    },
    settle() {
      frame(true);
    },
    state() {
      if (look === null) return null;
      const head = new THREE.Vector3(0, heightM * 0.86, 0);
      look.root.localToWorld(head);
      head.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        ...look.state(),
        parts: {
          figure: rectOf(look.parts.figure),
          bubble: rectOf(look.parts.bubble),
          pip: rectOf(look.parts.pip),
          scroll: rectOf(look.parts.scroll),
          popup: rectOf(look.parts.popup),
        },
        head:
          head.z > 1
            ? null
            : {
                x: rect.left + ((head.x + 1) / 2) * rect.width,
                y: rect.top + ((1 - head.y) / 2) * rect.height,
              },
      };
    },
    stop() {
      running = false;
    },
  };
  window.__characterViewsCheck = hook;

  resize();
  window.addEventListener("resize", resize);
  lookAt(CHECK_CHARACTER.at[0], heightM * 0.82, CHECK_CHARACTER.at[1]);
  standAt(CHECK_CHARACTER.eye[0], CHECK_CHARACTER.eye[1]);

  const loop = (): void => {
    if (!running) return;
    frame(false);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (mode === "demo") mountDemoBar(host, hook);
}

/** The demo's view bar (a person's mode). */
function mountDemoBar(host: HTMLElement, hook: CharacterViewsCheck): void {
  const bar = document.createElement("div");
  bar.className = "cvc-views";
  const buttons = TOUR_CHARACTER_VIEWS.map((view) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = view;
    b.addEventListener("click", () => {
      for (const o of buttons) {
        o.setAttribute("aria-pressed", String(o === b));
      }
      hook.setBeckon(view === "two-stations" ? true : null);
      hook.setVoice(view === "portrait" ? "speaking" : "idle");
      void hook.show({ view });
    });
    bar.appendChild(b);
    return b;
  });
  host.appendChild(bar);
  buttons[0]?.click();
}
