/**
 * The model views' check page (`model-views-check.html`): one tour model
 * in one world view, with the visitor's notes, card and toy, in a plain
 * daylight scene. Linked from nothing. Two modes, read from the URL
 * (`checkPageMode`): for a person, a demo (the stand-in with its notes,
 * sections and clip, a bar to switch the view, a drag to orbit it); with
 * `?hook=1`, an empty scene the layout e2e and a side-by-side check drive
 * through `window.__modelViewsCheck` (installed in both modes).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TOUR_MODEL_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourModelWorldView } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";

import { loadGlbModel } from "../glb-model.js";
import { modelScale } from "../model-scale.js";
import {
  mountModelView,
  type ModelViewHandle,
  type TourModelBlock,
} from "../model-views.js";
import { createModelVisitor, mountModelVisitorDom } from "../model-visitor.js";

/** What the e2e reads back: the card and every note's disc on screen. */
export interface ModelViewsCheckState {
  readonly view: string | null;
  readonly card: {
    readonly hidden: boolean;
    readonly num: string;
    readonly title: string;
  };
  readonly discs: number;
}

/** The page's hook. */
export interface ModelViewsCheck {
  /** Use this `.glb` (base64) from now on; null: the page's stand-in. */
  load(glbBase64: string | null): void;
  /** Show the model as `block` says (a model block in a world view). */
  show(block: unknown): Promise<void>;
  /** Stand at `eye` (metres, y up) and look at `target`. */
  lookFrom(eye: readonly number[], target: readonly number[]): void;
  /** Open the shown model's note `index`. */
  openNote(index: number): void;
  state(): ModelViewsCheckState;
  /** Stop drawing, so a closing browser is not kept busy by the loop. */
  stop(): void;
}

declare global {
  interface Window {
    __modelViewsCheck?: ModelViewsCheck;
  }
}

const WORLD_VIEWS: readonly string[] = TOUR_MODEL_WORLD_VIEWS;

/** `value` as a model block in a world view, or a thrown error naming
 *  what is wrong (a check page: a bad block is the caller's bug). */
export function checkModelBlock(
  value: unknown,
): TourModelBlock & { readonly sizeM: number } {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("a model block must be an object");
  }
  const block = value as Partial<TourModelBlock>;
  if (block.kind !== "model") throw new TypeError('"kind" must be "model"');
  if (typeof block.view !== "string" || !WORLD_VIEWS.includes(block.view)) {
    throw new TypeError(`"view" must be one of ${WORLD_VIEWS.join(", ")}`);
  }
  if (!(
    typeof block.sizeM === "number" &&
    Number.isFinite(block.sizeM) &&
    block.sizeM > 0
  )) {
    throw new TypeError('"sizeM" must be a positive number');
  }
  if (typeof block.id !== "string" || block.id === "") {
    throw new TypeError('"id" must be a non-empty string');
  }
  const pose: unknown = block.pose;
  if (typeof pose !== "object" || pose === null) {
    throw new TypeError('"pose" must be an object');
  }
  const numbers = (v: unknown, n: number): boolean =>
    Array.isArray(v) &&
    v.length === n &&
    v.every((x) => typeof x === "number" && Number.isFinite(x));
  if (!numbers((pose as { position?: unknown }).position, 3)) {
    throw new TypeError('"pose.position" must be three finite numbers');
  }
  if (!numbers((pose as { rotation?: unknown }).rotation, 4)) {
    throw new TypeError('"pose.rotation" must be four finite numbers');
  }
  return block as TourModelBlock & { readonly sizeM: number };
}

/** The page's mode: `hook` when the URL's `search` names `hook` (any
 *  value but "0"), the demo otherwise. */
export function checkPageMode(search: string): "demo" | "hook" {
  const value = new URLSearchParams(search).get("hook");
  return value !== null && value !== "0" ? "hook" : "demo";
}

/** The stand-in's size (its largest side, the post's height). */
const STAND_IN_SIZE_M = 2;

/**
 * The demo's block for the stand-in in `view` (an unknown view reads
 * `placed`): three notes on the post and the arm, two named sections and
 * the stand-in's clip "swing" playing by itself. Positions are in the
 * stand-in's own space (the post from y 0 to 2, the arm at y 1.8 along x).
 */
export function demoBlock(view: string): TourModelBlock & {
  readonly sizeM: number;
} {
  return {
    id: "demo",
    kind: "model",
    createdAtIso: "2026-10-28T12:00:00.000Z",
    asset: "stand-in",
    title: "A post with a swinging arm",
    view: (WORLD_VIEWS.includes(view) ? view : "placed") as TourModelWorldView,
    sizeM: STAND_IN_SIZE_M,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    animation: { name: "swing", autoplay: true },
    annotations: [
      {
        title: "The post",
        text: "Stone, two metres high.",
        position: [0, 1, 0.2],
        normal: [0, 0, 1],
      },
      {
        title: "The arm",
        text: "It swings when its clip plays.",
        position: [1.1, 1.9, 0],
        normal: [0, 1, 0],
      },
      {
        title: "The foot",
        position: [0.2, 0.3, 0],
        normal: [1, 0, 0],
      },
    ],
    sections: [
      { name: "Through the post", position: [0, 1, 0], normal: [0, 0, 1] },
      { name: "Across the arm", position: [0.6, 1.8, 0], normal: [1, 0, 0] },
    ],
  };
}

/** Where the demo's camera stands for a model `sizeM` tall at the origin:
 *  above and in front, about two and a half sizes from its middle.
 *  RangeError for a size that is not finite and > 0. */
export function demoCamera(sizeM: number): {
  readonly eye: readonly [number, number, number];
  readonly target: readonly [number, number, number];
} {
  if (!(Number.isFinite(sizeM) && sizeM > 0)) {
    throw new RangeError(`a model's size must be finite and > 0, got ${sizeM}`);
  }
  return {
    eye: [sizeM * 0.9, sizeM * 1.1, sizeM * 2.3],
    target: [0, sizeM / 2, 0],
  };
}

/** The demo's view bar: one button per world view. */
const VIEW_LABELS: Readonly<Record<string, string>> = {
  placed: "Placed",
  ghost: "Ghost",
  hotspots: "Hotspots",
  cutaway: "Cutaway",
  toy: "Toy",
};

/** A press moves less than this (px) to be a tap, not an orbit. */
const TAP_SLOP_PX = 8;

/** The camera's vertical field of view: the screen's short side spans
 *  45 degrees, like a phone camera. */
export function viewerFovDeg(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 45;
  const half = (22.5 * Math.PI) / 180;
  return width < height
    ? (2 * Math.atan((Math.tan(half) * height) / width) * 180) / Math.PI
    : 45;
}

/** A stand-in model for a page without a `.glb`: a 2 m post and an arm
 *  with a 1 s clip "swing" turning the arm. The arm is skinned to a bone,
 *  as a rigged model's parts are, so every view is seen on one. */
function standIn(): THREE.Object3D {
  const root = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    name: "stone",
    color: "#8c8a85",
  });
  const brass = new THREE.MeshStandardMaterial({
    name: "brass",
    color: "#b8853f",
    metalness: 0.8,
    roughness: 0.4,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 0.4), stone);
  post.position.y = 1;
  const arm = new THREE.Bone();
  arm.name = "arm";
  arm.position.y = 1.8;
  const geometry = new THREE.BoxGeometry(1.2, 0.2, 0.2).translate(0.6, 1.8, 0);
  const count = geometry.getAttribute("position").count;
  // Every vertex follows the one bone.
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(new Array<number>(count * 4).fill(0), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      4,
    ),
  );
  const bar = new THREE.SkinnedMesh(geometry, brass);
  bar.name = "arm-bar";
  root.add(post, arm, bar);
  root.updateMatrixWorld(true);
  bar.bind(new THREE.Skeleton([arm]));
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    0.6,
  );
  root.animations = [
    new THREE.AnimationClip("swing", 1, [
      new THREE.QuaternionKeyframeTrack(
        "arm.quaternion",
        [0, 0.5, 1],
        [...q0.toArray(), ...q1.toArray(), ...q0.toArray()],
      ),
    ]),
  ];
  return root;
}

/** Take a shown model off the page: its view first (it gives the model its
 *  own materials back), then the model out of `station`, then every
 *  geometry and material it holds freed - the visitor renderer's order
 *  (`content-placement.ts`). */
export function freeShown(
  station: THREE.Object3D,
  shown: {
    readonly model: THREE.Object3D;
    readonly handle: { dispose(): void };
  },
): void {
  shown.handle.dispose();
  station.remove(shown.model);
  disposeObject3D(shown.model);
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Build the page under `root` in `mode` and install its hook. */
export function startModelViewsCheck(
  root: HTMLElement,
  mode: "demo" | "hook" = checkPageMode(window.location.search),
): ModelViewsCheck {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.domElement.className = "check-canvas";
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color("#dfe5e8");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 70, 240);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
    new RoomEnvironment(),
    0.035,
  ).texture;
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight("#eef1f4", "#8d8b85", 0.95));
  const sun = new THREE.DirectionalLight("#fff4e6", 0.95);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshLambertMaterial({ color: "#c7c8c2" }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // The visitor's page finds its models under a station's content group.
  const station = new THREE.Group();
  station.name = "station-content:check";
  scene.add(station);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
  camera.position.set(0, 1.6, 6);
  camera.lookAt(0, 1.2, 0);

  let tapNdc: THREE.Vector2 | null = null;
  const raycaster = new THREE.Raycaster();
  const visitor = createModelVisitor({
    dom: mountModelVisitorDom(root),
    scene: () => scene,
    camera: () => camera,
    pick: (targets) => {
      if (tapNdc === null) return null;
      raycaster.setFromCamera(tapNdc, camera);
      for (const [id, object] of targets) {
        if (raycaster.intersectObject(object, true).length > 0) return id;
      }
      return null;
    },
  });
  // A drag (the demo's orbit) is not a tap.
  let pressedAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    pressedAt = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("click", (event) => {
    const moved =
      pressedAt === null
        ? 0
        : Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
    pressedAt = null;
    if (moved >= TAP_SLOP_PX) return;
    const rect = renderer.domElement.getBoundingClientRect();
    tapNdc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    visitor.tapped(null);
    tapNdc = null;
  });

  let glb: Uint8Array<ArrayBuffer> | null = null;
  let shown: { model: THREE.Object3D; handle: ModelViewHandle } | null = null;

  const resize = (): void => {
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = viewerFovDeg(w, h);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(root);
  resize();
  renderer.setAnimationLoop((now: number) => {
    visitor.tick(now);
    renderer.render(scene, camera);
  });

  const hook: ModelViewsCheck = {
    load(glbBase64) {
      glb = glbBase64 === null ? null : bytesOf(glbBase64);
    },
    async show(value) {
      const block = checkModelBlock(value);
      const model =
        glb === null ? standIn() : await loadGlbModel(new Blob([glb]));
      visitor.close();
      if (shown !== null) freeShown(station, shown);
      const scale = modelScale(model, block.sizeM);
      model.scale.setScalar(scale);
      model.position.fromArray(block.pose.position);
      model.quaternion.fromArray(block.pose.rotation);
      model.userData["objectId"] = block.id;
      station.add(model);
      const handle = mountModelView(model, block, scale, {
        enableClipping: () => {
          renderer.localClippingEnabled = true;
        },
      });
      model.userData["modelView"] = handle;
      shown = { model, handle };
    },
    lookFrom(eye, target) {
      if (
        eye.length !== 3 ||
        target.length !== 3 ||
        ![...eye, ...target].every(Number.isFinite)
      ) {
        throw new TypeError(
          "lookFrom needs two points of three finite numbers",
        );
      }
      camera.position.set(eye[0]!, eye[1]!, eye[2]);
      camera.lookAt(target[0]!, target[1]!, target[2]!);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
    openNote(index) {
      if (shown !== null) visitor.openNote(shown.handle, index);
    },
    state() {
      const card = root.querySelector<HTMLElement>("#model-card");
      return {
        view: shown?.handle.view ?? null,
        card: {
          // `hidden` may also read "until-found", which hides too.
          hidden: card === null || card.hidden !== false,
          num: root.querySelector("#model-card-num")?.textContent ?? "",
          title: root.querySelector("#model-card-title")?.textContent ?? "",
        },
        discs: root.querySelectorAll("button.note-marker:not([hidden])").length,
      };
    },
  };
  window.__modelViewsCheck = hook;
  if (mode === "demo") startDemo(root, hook, camera, renderer.domElement);
  return hook;
}

/**
 * The demo for a person: the stand-in in `hotspots`, the camera framing
 * it, a drag orbiting it (but in `toy`, whose card takes the drags) and a
 * bar of the five views, the shown one pressed.
 */
function startDemo(
  root: HTMLElement,
  hook: ModelViewsCheck,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): void {
  const { eye, target } = demoCamera(STAND_IN_SIZE_M);
  hook.lookFrom(eye, target);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...target);
  controls.enablePan = false;
  controls.minDistance = STAND_IN_SIZE_M;
  controls.maxDistance = STAND_IN_SIZE_M * 6;
  // Never under the ground.
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.update();

  const bar = root.ownerDocument.createElement("nav");
  bar.className = "mvc-views";
  bar.setAttribute("aria-label", "View");
  const buttons = WORLD_VIEWS.map((view) => {
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.dataset["view"] = view;
    button.textContent = VIEW_LABELS[view] ?? view;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => void choose(view));
    return button;
  });
  bar.append(...buttons);
  root.append(bar);

  const choose = async (view: string): Promise<void> => {
    await hook.show(demoBlock(view));
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset["view"] === view),
      );
    }
    controls.enabled = view !== "toy";
  };
  void choose("hotspots");
}
