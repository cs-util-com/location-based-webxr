/**
 * The reading stand's check page (`lectern-check.html`): one long text in
 * the `lectern` view standing in a plain square like the narrated-text
 * prototype's, seen from the visitor's eye 2.6 m in front of it. Linked
 * from nothing. A click on the page turns it, as a visitor's tap does in
 * AR. The layout e2e and the side-by-side check drive the page through
 * `window.__lecternCheck`, which is always installed (the page has no
 * demo bar, so a person and a test see the same page).
 *
 * The scene copies the prototype's numbers (background, fog, lights, the
 * ground and the paving, the guild house's front, the 1.6 m eye, its
 * field of view rule), so a screenshot of each can be put next to the
 * other. The stand itself is the production one (`mountLectern`).
 *
 * @see lectern-check.ts.md
 */
import * as THREE from "three";

import { mountLectern, type LecternHandle } from "../lectern-view.js";
import { CHECK_TEXT } from "./lectern-check-text.js";

/** The visitor's eye height (m) and distance from the stand, as in the
 *  prototype's lectern preview. */
const LECTERN_CHECK_EYE = { heightM: 1.6, distanceM: 2.6, pitch: 0.02 };

/** A part's box on the page (CSS px), or null when it is not drawn. */
interface PartRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface LecternCheckState {
  readonly sentence: number;
  readonly parts: {
    readonly page: PartRect | null;
    readonly stand: PartRect | null;
  };
}

/** The page's hook. */
interface LecternCheck {
  /** Stand a long text (the prototype's by default) on the stand,
   *  re-made from scratch. */
  show(options?: { readonly title?: string; readonly body?: string }): void;
  /** Turn the page, as a tap on it does. */
  turn(): void;
  /** Stand the visitor's eye over (x, z), in metres, looking at the
   *  stand's page. */
  standAt(x: number, z: number): void;
  state(): LecternCheckState | null;
  /** Stop drawing, so a closing browser is not kept busy by the loop. */
  stop(): void;
}

declare global {
  interface Window {
    __lecternCheck?: LecternCheck;
  }
}

/** The prototype's field of view rule: the short side sees 42 degrees in
 *  portrait, the height 50 degrees in landscape. */
export function lecternCheckFovDeg(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 50;
  const aspect = width / height;
  if (aspect >= 1) return 50;
  return (
    (2 * Math.atan(Math.tan((21 * Math.PI) / 180) / aspect) * 180) / Math.PI
  );
}

function grey(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

/** The prototype's square: the ground, the paving and the guild house. */
function buildSquare(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    grey("#bdbab3"),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const pc = document.createElement("canvas");
  pc.width = pc.height = 512;
  const x = pc.getContext("2d");
  if (x !== null) {
    x.fillStyle = "#c9c6bf";
    x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const v = 196 + ((i * 7 + j * 13) % 9);
        x.fillStyle = `rgb(${String(v)},${String(v - 3)},${String(v - 9)})`;
        x.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
      }
    }
  }
  const paving = new THREE.CanvasTexture(pc);
  paving.colorSpace = THREE.SRGBColorSpace;
  paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
  paving.repeat.set(2.5, 2.5);
  const square = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshLambertMaterial({ map: paving }),
  );
  square.rotation.x = -Math.PI / 2;
  square.position.y = 0.005;
  scene.add(square);
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(18, 6, 8),
    grey("#c3c0ba"),
  );
  house.position.set(0, 3, -24);
  scene.add(house);
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(18.4, 0.3, 0.5),
    grey("#b5b2ab"),
  );
  cornice.position.set(0, 6.0, -19.9);
  scene.add(cornice);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.6, 0.1),
    grey("#7d7a75"),
  );
  door.position.set(0, 1.3, -19.97);
  scene.add(door);
  for (const wx of [-5, 5]) {
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.7, 0.1),
      grey("#8e959a"),
    );
    w.position.set(wx, 3.7, -19.97);
    scene.add(w);
  }
}

export function startLecternCheck(host: HTMLElement): void {
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
  let stand: LecternHandle | null = null;
  let running = true;

  function resize(): void {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = lecternCheckFovDeg(w, h);
    camera.updateProjectionMatrix();
  }

  function standAt(x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new TypeError("standAt needs two finite numbers");
    }
    camera.position.set(x, LECTERN_CHECK_EYE.heightM, z);
    // The prototype's preview: facing the stand, the eye a touch raised.
    camera.rotation.set(LECTERN_CHECK_EYE.pitch, Math.atan2(x, z), 0);
  }

  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  function rectOf(object: THREE.Object3D): PartRect | null {
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

  function show(options: { title?: string; body?: string } = {}): void {
    stand?.dispose();
    stand = mountLectern({
      id: "stand",
      title: options.title ?? CHECK_TEXT.title,
      body: options.body ?? CHECK_TEXT.body,
    });
    scene.add(stand.object);
  }

  // A click on the page turns it (the visitor's tap in AR).
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  renderer.domElement.addEventListener("click", (event) => {
    if (stand === null) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(stand.page, false).length > 0) stand.turn();
  });

  const hook: LecternCheck = {
    show,
    turn() {
      stand?.turn();
    },
    standAt,
    state() {
      if (stand === null) return null;
      return {
        sentence: stand.sentence(),
        parts: { page: rectOf(stand.page), stand: rectOf(stand.object) },
      };
    },
    stop() {
      running = false;
    },
  };
  window.__lecternCheck = hook;

  resize();
  window.addEventListener("resize", resize);
  standAt(0, LECTERN_CHECK_EYE.distanceM);
  show();

  const loop = (): void => {
    if (!running) return;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
