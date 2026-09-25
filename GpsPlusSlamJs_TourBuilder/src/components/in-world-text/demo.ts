/**
 * Standalone demo for Component 2 — no tour, no GPS, no store.
 *
 * A plain Three.js scene with a couple of billboarded, paginated text labels.
 * Desktop: orbit with the mouse; the labels stay upright and face you; click the
 * Prev/Next buttons to page; "Swap text" re-paginates. Phone: tap "START AR" to
 * enter an immersive-ar session and read a label in the real world, paging it
 * with the controller/tap `select` ray — the manual XR confirmation the plan's
 * success criteria ask for. The HUD shows which backend actually rendered
 * (`html` normally; `canvas` if the HTML-in-3D raster failed and it fell back).
 */
import {
  GridHelper,
  Matrix4,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";

import { attachResize } from "../shared/resize.js";
import {
  createInWorldText,
  type InWorldText,
  type TextLabelUserData,
} from "./view/in-world-text.js";
import { createTextInteraction } from "./view/text-interaction.js";

const SHORT_TEXT =
  "Sir Aldric guarded this gate for thirty winters. Tap Next — there is more to his story.";

const LONG_TEXT =
  "In the winter of 1361 the castle was besieged for forty days. The defenders, " +
  "outnumbered five to one, held the outer wall through storm and frost.\n\n" +
  "Sir Aldric, then a squire of sixteen, carried water and arrows to the ramparts " +
  "each night. When the north tower's captain fell, it was Aldric who rallied the " +
  "line and held the breach until dawn.\n\n" +
  "For that stand he was knighted on this very spot. The stone beneath your feet " +
  "still bears the mark where his blade was laid to receive the accolade.";

const ALT_SHORT =
  "The chapel bell you hear was cast in 1408 from the melted armour of the fallen.";

const ALT_LONG =
  "The great hall behind this wall once seated three hundred guests beneath " +
  "banners of every allied house.\n\n" +
  "Musicians played from the gallery above while the harvest feast ran from dusk " +
  "until the first light of the following day.\n\n" +
  "Look up as you pass the archway: the carved faces are said to be the master " +
  "mason and his seven apprentices, watching over the hall they built.";

const canvasRoot = document.getElementById("canvas-root");
const statusEl = document.getElementById("status");
const swapButton = document.getElementById("swap");
if (canvasRoot === null) {
  throw new Error("#canvas-root not found");
}

const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvasRoot.clientWidth, canvasRoot.clientHeight);
renderer.xr.enabled = true;
canvasRoot.appendChild(renderer.domElement);

const scene = new Scene();
// Left transparent so an immersive-ar session shows passthrough; the page's dark
// body colour is what you see behind the canvas on desktop.
const grid = new GridHelper(20, 20, 0x33405a, 0x222a38);
scene.add(grid);

const camera = new PerspectiveCamera(
  60,
  canvasRoot.clientWidth / canvasRoot.clientHeight,
  0.1,
  100,
);
camera.position.set(0, 1.6, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, -1);
controls.update();

const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

const specs = [
  {
    id: "story-short",
    position: new Vector3(-0.55, 1.5, -1.2),
    text: SHORT_TEXT,
  },
  { id: "story-long", position: new Vector3(0.75, 1.5, -1.0), text: LONG_TEXT },
];

const labels: InWorldText[] = [];
for (const spec of specs) {
  const label = createInWorldText({
    id: spec.id,
    text: spec.text,
    position: spec.position,
    maxAnisotropy,
  });
  labels.push(label);
  scene.add(label.group);
}

function applyHit(id: string, uv: { u: number; v: number }): void {
  const label = labels.find((candidate) => candidate.id === id);
  if (label === undefined) {
    return;
  }
  const intent = label.hitTest(uv);
  if (intent?.type === "next") {
    label.next();
  } else if (intent?.type === "prev") {
    label.prev();
  }
}

createTextInteraction({
  domElement: renderer.domElement,
  camera,
  getPickTargets: () => labels.map((label) => label.pickMesh),
  onHit: applyHit,
});

// XR: the controller's `select` ray reuses the exact same hit-mapping.
const controller = renderer.xr.getController(0);
scene.add(controller);
const xrRaycaster = new Raycaster();
const xrRotation = new Matrix4();
controller.addEventListener("select", () => {
  xrRotation.identity().extractRotation(controller.matrixWorld);
  xrRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  xrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(xrRotation);
  const hit = xrRaycaster.intersectObjects(
    labels.map((label) => label.pickMesh),
    false,
  )[0];
  if (hit?.uv !== undefined) {
    const data = hit.object.userData as Partial<TextLabelUserData>;
    if (data.textLabelId !== undefined) {
      applyHit(data.textLabelId, { u: hit.uv.x, v: hit.uv.y });
    }
  }
});

let swapped = false;
swapButton?.addEventListener("click", () => {
  swapped = !swapped;
  labels[0]?.setText(swapped ? ALT_SHORT : SHORT_TEXT);
  labels[1]?.setText(swapped ? ALT_LONG : LONG_TEXT);
});

document.body.appendChild(
  ARButton.createButton(renderer, { optionalFeatures: ["local-floor"] }),
);

attachResize(camera, renderer, canvasRoot);

function updateHud(): void {
  if (statusEl === null) {
    return;
  }
  statusEl.textContent = labels
    .map((label) => `${label.id} · ${label.activeBackend} · ${label.pageLabel}`)
    .join("\n");
}

const cameraWorld = new Vector3();
renderer.setAnimationLoop(() => {
  controls.update();
  camera.getWorldPosition(cameraWorld);
  for (const label of labels) {
    label.faceCamera(cameraWorld);
  }
  updateHud();
  renderer.render(scene, camera);
});
