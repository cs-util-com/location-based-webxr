/**
 * A selected model's own parts in the 3D view: its notes as numbered discs
 * over the canvas (a click brings one into the inspector's focus), its
 * cutaway's sections as see-through planes, and the click on its surface
 * the inspector asked for (`editorView.modelPick`): a note added or placed
 * again where the ray meets the model, a section cut through that point
 * facing the camera. Places are the format's: the model file's own space
 * (`TourModelVector`), before its size scales it and its pose places it.
 *
 * @see editor3d-model-parts.ts.md
 */
import * as THREE from "three";

import type { TourModelBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";

import type { ModelFocus, ModelPick } from "../editor/editor-view.js";
import type { ModelEdit, ModelSpot } from "../editor/model-edits.js";
import type { ScreenPoint } from "./gizmo-maths.js";

/** A model-space number as written: a millimetre in the file's metres,
 *  enough for a note's place and short in the saved file. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000 + 0;

const tuple = (v: THREE.Vector3): readonly [number, number, number] => [
  round3(v.x),
  round3(v.y),
  round3(v.z),
];

/** The first visible mesh of `model` a ray meets, or null. */
export function hitModel(
  raycaster: THREE.Raycaster,
  model: THREE.Object3D,
): THREE.Intersection | null {
  model.updateMatrixWorld(true);
  for (const hit of raycaster.intersectObject(model, true)) {
    if (hit.object.visible && hit.face !== null && hit.face !== undefined) {
      return hit;
    }
  }
  return null;
}

/** A hit on `model` as a note's spot in the model's own space: the point,
 *  and the surface's outward direction there (unit, then rounded). */
export function noteSpotOf(
  model: THREE.Object3D,
  hit: THREE.Intersection,
): ModelSpot | null {
  const face = hit.face;
  if (face === null || face === undefined) return null;
  model.updateMatrixWorld(true);
  const position = model.worldToLocal(hit.point.clone());
  const toModel = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const normal = face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld)
    .applyQuaternion(toModel)
    .normalize();
  return { position: tuple(position), normal: tuple(normal) };
}

/** A section through a hit on `model`: the point, and the model's axis
 *  nearest the way to the camera, so the side facing the creator is cut
 *  away (the format: what lies on the side its normal points to). */
export function sectionSpotOf(
  model: THREE.Object3D,
  hit: THREE.Intersection,
  camera: THREE.Vector3,
): ModelSpot {
  model.updateMatrixWorld(true);
  const position = model.worldToLocal(hit.point.clone());
  const toCamera = model.worldToLocal(camera.clone()).sub(position);
  const axes = [toCamera.x, toCamera.y, toCamera.z];
  let best = 0;
  for (let i = 1; i < 3; i++) {
    if (Math.abs(axes[i]!) > Math.abs(axes[best]!)) best = i;
  }
  const normal: [number, number, number] = [0, 0, 0];
  normal[best] = (axes[best] ?? 0) < 0 ? -1 : 1;
  return { position: tuple(position), normal };
}

/** The edit a click on the model answers `pick` with. */
export function pickedEdit(pick: ModelPick, spot: ModelSpot): ModelEdit {
  switch (pick.what) {
    case "note-add":
    case "section-add":
      return { kind: pick.what, at: spot };
    case "note-place":
    case "section-place":
      return { kind: pick.what, index: pick.index, at: spot };
  }
}

/** Said when a click waited for meets no part of the model. */
export const MISSED_MODEL = "Click the model itself";

/** What the parts read of the view and ask of the page. */
export interface ModelPartsDeps {
  /** The view's box: the discs sit in it, over the canvas. */
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** The selection, its part in focus and the click the inspector waits
   *  for (the store's `editorView`). */
  view(): {
    readonly selected: string | null;
    readonly focus: ModelFocus | null;
    readonly pick: ModelPick | null;
  };
  /** The selected model as the tour has it, or null for none. */
  model(id: string): TourModelBlock | null;
  /** Its drawing (the glb under its pose and size), or null until drawn. */
  drawn(id: string): THREE.Object3D | null;
  /** A note's disc pressed: the inspector's focus toggled. */
  focusNote(index: number): void;
}

/** A see-through plane per section: the focused one darker. */
const PLANE_COLOUR = 0x2f80ed;

/**
 * The parts on the view, until `dispose`; `update` each frame before the
 * drawing.
 */
export function createModelParts(deps: ModelPartsDeps) {
  const discs = document.createElement("div");
  discs.className = "model-notes";
  deps.container.append(discs);
  discs.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-note]",
    );
    if (button === null) return;
    deps.focusNote(Number(button.dataset["note"]));
  });

  const planes = new THREE.Group();
  planes.name = "model-sections";
  deps.scene.add(planes);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = () =>
    new THREE.MeshBasicMaterial({
      color: PLANE_COLOUR,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

  const at = new THREE.Vector3();
  let crosshair = false;
  const facing = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);

  const screenOf = (world: THREE.Vector3): ScreenPoint | null => {
    const p = world.clone().project(deps.camera);
    if (p.z > 1 || p.z < -1) return null;
    const r = deps.canvas.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height };
  };

  const clearPlanes = () => {
    for (const plane of [...planes.children]) {
      plane.removeFromParent();
      ((plane as THREE.Mesh).material as THREE.Material).dispose();
    }
  };

  const drawDiscs = (
    model: TourModelBlock | null,
    drawn: THREE.Object3D | null,
    focus: ModelFocus | null,
  ) => {
    const notes = drawn === null ? [] : (model?.annotations ?? []);
    while (discs.children.length > notes.length)
      discs.lastElementChild?.remove();
    while (discs.children.length < notes.length) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "note-disc";
      discs.append(b);
    }
    notes.forEach((note, i) => {
      const b = discs.children[i] as HTMLButtonElement;
      const n = String(i + 1);
      if (b.textContent !== n) b.textContent = n;
      b.dataset["note"] = String(i);
      b.title = note.title;
      b.setAttribute("aria-label", `Note ${n}: ${note.title}`);
      const on = focus?.part === "note" && focus.index === i;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      const where =
        drawn === null
          ? null
          : screenOf(drawn.localToWorld(at.set(...note.position)));
      b.hidden = where === null;
      if (where !== null) {
        b.style.transform = `translate(${String(where.x)}px, ${String(where.y)}px)`;
      }
    });
  };

  const drawPlanes = (
    model: TourModelBlock | null,
    drawn: THREE.Object3D | null,
    focus: ModelFocus | null,
  ) => {
    const sections = drawn === null ? [] : (model?.sections ?? []);
    if (planes.children.length !== sections.length) {
      clearPlanes();
      for (let i = 0; i < sections.length; i++) {
        const plane = new THREE.Mesh(geometry, material());
        plane.renderOrder = 2;
        plane.raycast = () => undefined;
        planes.add(plane);
      }
    }
    if (drawn === null || model === null) return;
    drawn.updateMatrixWorld(true);
    const turned = drawn.getWorldQuaternion(new THREE.Quaternion());
    const sizeM = model.sizeM ?? 1;
    sections.forEach((section, i) => {
      const plane = planes.children[i] as THREE.Mesh;
      plane.position.copy(drawn.localToWorld(at.set(...section.position)));
      const normal = new THREE.Vector3(...section.normal)
        .normalize()
        .applyQuaternion(turned);
      plane.quaternion.copy(facing.setFromUnitVectors(Z, normal));
      plane.scale.setScalar(sizeM * 1.2);
      const on = focus?.part === "section" && focus.index === i;
      (plane.material as THREE.MeshBasicMaterial).opacity = on ? 0.45 : 0.22;
    });
  };

  return {
    /** Each frame: the selected model's discs and planes where it stands
     *  now (a gesture's preview included); none without a model. */
    update() {
      const view = deps.view();
      const model = view.selected === null ? null : deps.model(view.selected);
      const drawn = model === null ? null : deps.drawn(model.id);
      drawDiscs(model, drawn, view.focus);
      drawPlanes(model, drawn, view.focus);
      // A click waited for: the cross over the canvas until it comes.
      const waiting = view.pick !== null && model !== null;
      if (waiting !== crosshair) {
        crosshair = waiting;
        deps.canvas.style.cursor = waiting ? "crosshair" : "";
      }
    },
    /** For the page's checks: each note's disc on the canvas (CSS px),
     *  or null where it does not show; the planes drawn. */
    stats() {
      return {
        discs: [...discs.children].map((b) => {
          const el = b as HTMLElement;
          if (el.hidden) return null;
          const r = el.getBoundingClientRect();
          const c = deps.canvas.getBoundingClientRect();
          const centre: readonly [number, number] = [
            r.left + r.width / 2 - c.left,
            r.top + r.height / 2 - c.top,
          ];
          return centre;
        }),
        planes: planes.children.length,
      };
    },
    dispose() {
      clearPlanes();
      geometry.dispose();
      planes.removeFromParent();
      discs.remove();
    },
  };
}
