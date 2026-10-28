/**
 * The model views' check page (`model-views-check.html`): one tour model
 * in one world view, with the visitor's notes, card and toy, in a plain
 * daylight scene. Linked from nothing; the layout e2e and a side-by-side
 * check against the views' prototype drive it through
 * `window.__modelViewsCheck`.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TOUR_MODEL_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";

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
  return block as TourModelBlock & { readonly sizeM: number };
}

/** The camera's vertical field of view: the screen's short side spans
 *  45 degrees, like a phone camera. */
export function viewerFovDeg(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 45;
  const half = (22.5 * Math.PI) / 180;
  return width < height
    ? (2 * Math.atan((Math.tan(half) * height) / width) * 180) / Math.PI
    : 45;
}

/** A stand-in model for a page without a `.glb`: a 2 m post and arm with
 *  a 1 s clip "swing" turning the arm. */
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
  const arm = new THREE.Group();
  arm.name = "arm";
  arm.position.y = 1.8;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.2), brass);
  bar.position.x = 0.6;
  arm.add(bar);
  root.add(post, arm);
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

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Build the page under `root` and install its hook. */
export function startModelViewsCheck(root: HTMLElement): ModelViewsCheck {
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
  renderer.domElement.addEventListener("click", (event) => {
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
      if (shown !== null) {
        shown.handle.dispose();
        station.remove(shown.model);
      }
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
  return hook;
}
