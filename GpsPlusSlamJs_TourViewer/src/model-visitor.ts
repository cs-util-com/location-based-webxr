/**
 * The visitor's 3D models in AR: each frame it moves every shown model's
 * view on (`model-views.ts`: the clip, the ghost's sweep, the cut turning
 * to the visitor) and the `hotspots` notes' discs (`note-markers.ts`);
 * and it owns the model card, the one card a model opens on a tap.
 *
 * The gesture rule (`model-gestures.ts`): a tap on a note's disc opens
 * that note in the card ("Note 2 of 5", Previous / Next); a tap on a model
 * opens the model's own card where it has one - a cutaway's sections
 * ("Section 1 of 3", Previous / Next steps the cut), a toy's ("Back to
 * its place"), or a model's title. While a toy's card is open the screen
 * takes its pinches (resize) and drags (move); a tap there puts the toy
 * down (closes the card). In any other view a pinch or a drag does
 * nothing.
 *
 * @see model-visitor.ts.md
 */

import * as THREE from "three";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";

import {
  modelGestureAction,
  toyDragMetres,
  type ModelGesture,
} from "./model-gestures.js";
import { modelViewOf, type ModelViewHandle } from "./model-views.js";
import {
  createNoteMarkers,
  noteKey,
  type NoteMarkersDom,
} from "./note-markers.js";

/** The model card's elements. */
export interface ModelCardDom {
  readonly card: HTMLElement;
  readonly num: HTMLElement;
  readonly title: HTMLElement;
  readonly text: HTMLElement;
  readonly prev: HTMLButtonElement;
  readonly next: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
  /** Covers the screen while a toy is in hand: takes its pinches and
   *  drags. */
  readonly gestures: HTMLElement;
}

export interface ModelVisitorDeps {
  readonly dom: ModelCardDom & NoteMarkersDom;
  /** The scene the stations' content hangs under, or null outside AR. */
  scene(): THREE.Object3D | null;
  /** The visitor's camera, or null outside AR. */
  camera(): THREE.Camera | null;
  /** The model under the tap (`seams.pickObjectInView`), by block id. */
  pick(
    targets: ReadonlyMap<string, THREE.Object3D>,
    tap: SelectTargetRay | null,
  ): string | null;
}

/** What the card shows. */
type Open =
  | { readonly as: "note"; readonly handle: ModelViewHandle; index: number }
  | { readonly as: "model"; readonly handle: ModelViewHandle };

export interface ModelVisitor {
  /** One camera frame at `nowMs`. */
  tick(nowMs: number): void;
  /** A tap in AR: true when it hit a model with a card (opened); false
   *  otherwise (the card closed; the tap is the next sheet's). */
  tapped(tap: SelectTargetRay | null): boolean;
  /** Open note `index` of the model `handle` (a disc's tap). */
  openNote(handle: ModelViewHandle, index: number): void;
  /** Close the card (its close button). */
  close(): void;
  /** The session's end: the card closed, every note's disc removed. */
  stop(): void;
  /** What the card shows: `note:<key>`, `model:<block id>` or null. */
  openKey(): string | null;
}

/** Whether `object` and every ancestor is visible. */
function shown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o !== null; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/** Every shown model view under a station's content group. */
export function shownModelViews(scene: THREE.Object3D): ModelViewHandle[] {
  const handles: ModelViewHandle[] = [];
  for (const group of scene.children) {
    if (!group.name.startsWith("station-content:")) continue;
    group.traverse((object) => {
      const handle = modelViewOf(object);
      if (handle !== null && shown(object)) handles.push(handle);
    });
  }
  return handles;
}

/** Whether a tap on the model opens a card of its own: a toy, a cutaway
 *  with sections, or a model with a title. */
export function hasModelCard(handle: ModelViewHandle): boolean {
  if (handle.view === "toy") return true;
  if (handle.view === "cutaway" && (handle.block.sections?.length ?? 0) > 0) {
    return true;
  }
  return (handle.block.title ?? "") !== "";
}

/**
 * The card, the toy's gesture layer and the notes' layers, built under
 * `parent` (the AR overlay's root, so their taps are the overlay's): one
 * builder for the visitor's page and the views' check page.
 */
export function mountModelVisitorDom(
  parent: HTMLElement,
): ModelCardDom & NoteMarkersDom {
  const doc = parent.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    id: string,
    className: string,
    text = "",
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.id = id;
    e.className = className;
    e.dataset["testid"] = id;
    if (text !== "") e.textContent = text;
    return e;
  };
  const leaders = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.id = "note-leaders";
  leaders.setAttribute("class", "note-leaders");
  leaders.setAttribute("aria-hidden", "true");
  const layer = el("div", "note-markers", "note-markers");
  const gestures = el("div", "model-gestures", "model-gestures");
  gestures.hidden = true;
  const card = el("section", "model-card", "model-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("aria-labelledby", "model-card-title");
  card.hidden = true;
  const close = el("button", "model-card-close", "model-card-close", "\u00d7");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  const num = el("div", "model-card-num", "model-card-num");
  const title = el("h3", "model-card-title", "model-card-title");
  const text = el("p", "model-card-text", "model-card-text");
  const row = el("div", "model-card-row", "model-card-row");
  const prev = el("button", "model-card-prev", "", "\u2039 Previous");
  const reset = el("button", "model-card-reset", "", "Back to its place");
  const next = el("button", "model-card-next", "", "Next \u203a");
  for (const b of [prev, reset, next]) b.type = "button";
  reset.hidden = true;
  row.append(prev, reset, next);
  card.append(close, num, title, text, row);
  parent.append(leaders, layer, gestures, card);
  return {
    card,
    num,
    title,
    text,
    prev,
    next,
    close,
    reset,
    gestures,
    layer,
    leaders,
  };
}

/** A finger on the gesture layer. */
interface Finger {
  x: number;
  y: number;
}

/** A tap moves less than this (px). */
const TAP_SLOP_PX = 8;

export function createModelVisitor(deps: ModelVisitorDeps): ModelVisitor {
  const { dom } = deps;
  let open: Open | null = null;
  let lastMs: number | null = null;

  const keyOf = (o: Open | null): string | null =>
    o === null
      ? null
      : o.as === "note"
        ? `note:${noteKey(o.handle.blockId, o.index)}`
        : `model:${o.handle.blockId}`;

  const render = (): void => {
    const held = open?.as === "model" && open.handle.view === "toy";
    dom.gestures.hidden = !held;
    if (open === null) {
      dom.card.hidden = true;
      dom.num.textContent = "";
      dom.title.textContent = "";
      dom.text.textContent = "";
      return;
    }
    dom.card.hidden = false;
    const { handle } = open;
    dom.reset.hidden = true;
    if (open.as === "note") {
      const notes = handle.notes;
      const note = notes[open.index];
      dom.num.textContent = `Note ${open.index + 1} of ${notes.length}`;
      dom.title.textContent = note?.title ?? "";
      dom.text.textContent = note?.text ?? "";
      dom.prev.hidden = dom.next.hidden = notes.length < 2;
      return;
    }
    const sections = handle.block.sections ?? [];
    if (handle.view === "cutaway" && sections.length > 0) {
      const i = Math.max(0, handle.section());
      dom.num.textContent = `Section ${i + 1} of ${sections.length}`;
      dom.title.textContent = sections[i]?.name ?? "";
      dom.text.textContent = handle.block.title ?? "";
      dom.prev.hidden = dom.next.hidden = sections.length < 2;
      return;
    }
    dom.prev.hidden = dom.next.hidden = true;
    dom.title.textContent = handle.block.title ?? "3D model";
    if (handle.view === "toy") {
      dom.num.textContent = "In your hand";
      dom.text.textContent = "Pinch to resize it, drag to move it.";
      dom.reset.hidden = false;
      dom.reset.disabled = !handle.toyMoved();
      return;
    }
    dom.num.textContent = "3D model";
    dom.text.textContent = "";
  };

  const close = (): void => {
    open = null;
    render();
  };

  const step = (by: number): void => {
    if (open === null) return;
    if (open.as === "note") {
      const n = open.handle.notes.length;
      if (n === 0) return;
      open.index = (((open.index + by) % n) + n) % n;
    } else {
      open.handle.setSection(open.handle.section() + by);
    }
    render();
  };

  const markers = createNoteMarkers(dom, (handle, index) => {
    visitor.openNote(handle, index);
  });

  dom.prev.addEventListener("click", () => step(-1));
  dom.next.addEventListener("click", () => step(1));
  dom.close.addEventListener("click", close);
  dom.reset.addEventListener("click", () => {
    if (open?.as !== "model") return;
    open.handle.resetToy();
    render();
  });

  // The toy in hand: one finger drags it, two pinch it, a tap puts it
  // down. Only while its card is open (the layer is hidden otherwise).
  const fingers = new Map<number, Finger>();
  let travelled = 0;
  const gesture = (kind: ModelGesture): ModelViewHandle | null => {
    if (open?.as !== "model") return null;
    const action = modelGestureAction(open.handle.view, kind, true);
    return action === "none" || action === "open" ? null : open.handle;
  };
  dom.gestures.addEventListener("pointerdown", (event) => {
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 1) travelled = 0;
  });
  dom.gestures.addEventListener("pointermove", (event) => {
    const finger = fingers.get(event.pointerId);
    if (finger === undefined) return;
    const dx = event.clientX - finger.x;
    const dy = event.clientY - finger.y;
    if (fingers.size >= 2) {
      const others = [...fingers.entries()].filter(
        ([id]) => id !== event.pointerId,
      );
      const other = others[0]?.[1];
      const handle = gesture("pinch");
      if (other !== undefined && handle !== null) {
        const from = Math.hypot(finger.x - other.x, finger.y - other.y);
        const to = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        handle.pinchToy(from, to);
      }
      travelled += TAP_SLOP_PX;
    } else {
      travelled += Math.hypot(dx, dy);
      const handle = gesture("drag");
      const camera = deps.camera();
      if (handle !== null && camera !== null) {
        const eye = camera.getWorldPosition(new THREE.Vector3());
        const at = handle.model.getWorldPosition(new THREE.Vector3());
        const look = camera.getWorldDirection(new THREE.Vector3());
        const fov =
          (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
            ? THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov)
            : Math.PI / 3;
        const [mx, mz] = toyDragMetres({
          dxPx: dx,
          dyPx: dy,
          heightPx: dom.gestures.clientHeight,
          distanceM: eye.distanceTo(at),
          fovYRad: fov,
          yawRad: Math.atan2(-look.x, -look.z),
        });
        handle.moveToy(mx, mz);
      }
    }
    finger.x = event.clientX;
    finger.y = event.clientY;
    render();
  });
  const lift = (event: PointerEvent): void => {
    if (!fingers.delete(event.pointerId)) return;
    if (fingers.size === 0 && travelled < TAP_SLOP_PX) close();
  };
  dom.gestures.addEventListener("pointerup", lift);
  dom.gestures.addEventListener("pointercancel", (event) => {
    fingers.delete(event.pointerId);
  });

  const visitor: ModelVisitor = {
    tick(nowMs) {
      const dtS =
        lastMs === null || !Number.isFinite(nowMs)
          ? 0
          : Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = Number.isFinite(nowMs) ? nowMs : lastMs;
      const scene = deps.scene();
      const handles = scene === null ? [] : shownModelViews(scene);
      const camera = deps.camera();
      for (const handle of handles) handle.update(dtS, camera);
      // A card goes with its model.
      if (open !== null && !handles.includes(open.handle)) close();
      const openNote =
        open?.as === "note" ? noteKey(open.handle.blockId, open.index) : null;
      markers.sync(
        handles.filter((h) => h.notes.length > 0),
        camera,
        openNote,
      );
    },
    tapped(tap) {
      const scene = deps.scene();
      const targets = new Map<string, THREE.Object3D>();
      const byId = new Map<string, ModelViewHandle>();
      for (const handle of scene === null ? [] : shownModelViews(scene)) {
        if (!hasModelCard(handle)) continue;
        targets.set(handle.blockId, handle.model);
        byId.set(handle.blockId, handle);
      }
      const hit = targets.size === 0 ? null : deps.pick(targets, tap);
      const handle = hit === null ? undefined : byId.get(hit);
      if (handle === undefined) {
        close();
        return false;
      }
      open = { as: "model", handle };
      render();
      return true;
    },
    openNote(handle, index) {
      if (!Number.isInteger(index) || handle.notes[index] === undefined) return;
      open = { as: "note", handle, index };
      render();
    },
    close,
    stop() {
      close();
      markers.clear();
      lastMs = null;
    },
    openKey: () => keyOf(open),
  };
  render();
  return visitor;
}
