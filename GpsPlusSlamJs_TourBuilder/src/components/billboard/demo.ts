/**
 * Standalone demo for Component 1 — no AR, no GPS, no store.
 *
 * A plain Three.js scene with an orbit camera and three clickable billboards.
 * It wires the pure transport reducer to the view: a single `dispatch` runs the
 * reducer, then every billboard reconciles its panel + audio against the new
 * state. The render loop only billboards the meshes toward the camera. This is
 * the manual stand-in for replay e2e (Component 1 has no movement dependency).
 *
 * Verify (success-criterion #4): orbit the camera — every sprite + open panel
 * stays upright and faces you; click a billboard to play it and open its panel;
 * clicking another switches; the panel button pauses/resumes; the bar fills;
 * tapping the bar seeks.
 */
import {
  AudioListener,
  Color,
  GridHelper,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { attachResize } from "../shared/resize.js";
import {
  INITIAL,
  transportReducer,
  type TransportAction,
  type TransportState,
} from "./core/playback-transport.js";
import { hitToAction } from "./core/panel-layout.js";
import {
  createClickableBillboard,
  type ClickableBillboard,
} from "./view/clickable-billboard.js";
import { createBillboardInteraction } from "./view/billboard-interaction.js";

const canvasRoot = document.getElementById("canvas-root");
const statusEl = document.getElementById("status");
if (canvasRoot === null) {
  throw new Error("#canvas-root not found");
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvasRoot.clientWidth, canvasRoot.clientHeight);
canvasRoot.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x10131a);

const camera = new PerspectiveCamera(
  60,
  canvasRoot.clientWidth / canvasRoot.clientHeight,
  0.1,
  100,
);
camera.position.set(0, 1.8, 6);

// One listener for the whole scene, parented to the camera so its WebAudio pose
// tracks the orbit every frame (the renderer updates the camera's world matrix,
// which cascades to the listener). Each billboard's PositionalAudio pans against
// it. The AudioContext starts suspended and is resumed on the first click.
const listener = new AudioListener();
camera.add(listener);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, 0);
controls.update();

scene.add(new GridHelper(20, 20, 0x33405a, 0x222a38));

const asset = (file: string): string =>
  `${import.meta.env.BASE_URL}billboard/${file}`;

const specs = [
  {
    id: "knight-1",
    position: new Vector3(-2.6, 0.6, 0),
    image: "marker-1.png",
    clip: "clip-1.wav",
  },
  {
    id: "knight-2",
    position: new Vector3(0, 0.6, -1.6),
    image: "marker-2.png",
    clip: "clip-2.wav",
  },
  {
    id: "knight-3",
    position: new Vector3(2.6, 0.6, 0.6),
    image: "marker-3.png",
    clip: "clip-3.wav",
  },
];

let state: TransportState = INITIAL;
const billboards: ClickableBillboard[] = [];

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function updateHud(): void {
  if (statusEl === null) {
    return;
  }
  statusEl.textContent =
    state.activeId === null
      ? "No clip selected — click a billboard to play."
      : `${state.activeId} · ${state.status} · ${formatTime(state.positionSec)} / ${formatTime(state.durationSec)}`;
}

function dispatch(action: TransportAction): void {
  state = transportReducer(state, action);
  for (const billboard of billboards) {
    billboard.applyState(state);
  }
  updateHud();
}

const loader = new TextureLoader();
for (const spec of specs) {
  const texture = loader.load(asset(spec.image));
  texture.colorSpace = SRGBColorSpace;
  const audio = new Audio(asset(spec.clip));
  audio.preload = "metadata";
  const billboard = createClickableBillboard({
    id: spec.id,
    position: spec.position,
    texture,
    audio,
    listener,
    // Events are forwarded blindly — the reducer ignores stale ticks/ended
    // by id, so no caller-side guard is needed (or allowed to drift).
    onTick: (id, positionSec, durationSec) =>
      dispatch({ type: "tick", id, positionSec, durationSec }),
    onEnded: (id) => dispatch({ type: "ended", id }),
  });
  billboards.push(billboard);
  scene.add(billboard.group);
}

createBillboardInteraction({
  domElement: renderer.domElement,
  camera,
  getPickTargets: () => billboards.flatMap((b) => b.getPickTargets()),
  onSpriteClick: (id) => dispatch({ type: "click", id }),
  // Only the active billboard's panel is ever pickable (getPickTargets), so
  // the hit id always matches the active clip and toggle/seek need no id.
  onPanelHit: (_id, uv) => {
    const action = hitToAction(uv);
    if (action !== null) {
      dispatch(action);
    }
  },
});

attachResize(camera, renderer, canvasRoot);

const cameraWorld = new Vector3();
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  camera.getWorldPosition(cameraWorld);
  for (const billboard of billboards) {
    billboard.faceCamera(cameraWorld);
  }
  renderer.render(scene, camera);
}

// Initial paint: panels hidden (nothing active), HUD prompt shown.
for (const billboard of billboards) {
  billboard.applyState(state);
}
updateHud();
animate();
