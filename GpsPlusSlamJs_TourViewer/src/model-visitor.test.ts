// @vitest-environment jsdom
/**
 * Why these tests matter: the visitor's taps and gestures on a 3D model
 * follow one rule - a tap opens a note or the model's card, a pinch or a
 * drag acts only on a toy in hand - and the card must say exactly what is
 * open ("Note 2 of 5", "Section 1 of 2") and go with its model. A drag
 * that moved a model in any other view, or a card left open over a model
 * the visitor walked away from, would break the tour's own placement.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { mountModelView, type TourModelBlock } from "./model-views.js";
import {
  createModelVisitor,
  hasModelCard,
  mountModelVisitorDom,
  shownModelViews,
} from "./model-visitor.js";
import { cancelsXrSelect } from "./pin-sheet.js";

const NOW = "2026-10-28T12:00:00.000Z";

function block(
  id: string,
  view: TourModelBlock["view"],
  extra: Partial<TourModelBlock> = {},
): TourModelBlock {
  return {
    id,
    kind: "model",
    view,
    asset: id,
    sizeM: 1,
    createdAtIso: NOW,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ...extra,
  };
}

/** A scene with one station's content group holding `blocks`' models,
 *  each mounted in its view, 4 m in front of a camera at the origin. */
function world(blocks: readonly TourModelBlock[]) {
  const scene = new THREE.Scene();
  const station = new THREE.Group();
  station.name = "station-content:s1";
  scene.add(station);
  const handles = blocks.map((b) => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    model.position.set(0, 0, -4);
    model.userData["objectId"] = b.id;
    station.add(model);
    const handle = mountModelView(model, b, 1);
    model.userData["modelView"] = handle;
    return handle;
  });
  const camera = new THREE.PerspectiveCamera(60, 0.5, 0.05, 100);
  scene.updateMatrixWorld(true);
  return { scene, station, handles, camera };
}

function visitorFor(w: ReturnType<typeof world>, hit: () => string | null) {
  const root = document.createElement("div");
  document.body.append(root);
  const dom = mountModelVisitorDom(root);
  for (const el of [dom.layer, dom.gestures]) {
    Object.defineProperty(el, "clientWidth", { value: 400 });
    Object.defineProperty(el, "clientHeight", { value: 800 });
  }
  const picked: string[][] = [];
  const visitor = createModelVisitor({
    dom,
    scene: () => w.scene,
    camera: () => w.camera,
    pick: (targets) => {
      picked.push([...targets.keys()]);
      return hit();
    },
  });
  return { dom, visitor, picked };
}

function pointer(
  target: HTMLElement,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

describe("the model card", () => {
  // Why: only a model with something to show opens a card on a tap: a
  // toy, a cutaway with sections, a model with a title.
  it("opens on a tap only for a model with a card of its own", () => {
    const w = world([
      block("plain", "placed"),
      block("named", "ghost", { title: "The bell" }),
      block("cut", "cutaway"),
      block("toy", "toy"),
      block("sections", "cutaway", {
        sections: [{ name: "A", position: [0, 0, 0], normal: [1, 0, 0] }],
      }),
    ]);
    expect(w.handles.map(hasModelCard)).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
    const { visitor, picked, dom } = visitorFor(w, () => "named");
    expect(visitor.tapped(null)).toBe(true);
    expect(picked[0]).toEqual(["named", "toy", "sections"]);
    expect(dom.card.hidden).toBe(false);
    expect(dom.title.textContent).toBe("The bell");
    expect(dom.num.textContent).toBe("3D model");
    expect(dom.gestures.hidden).toBe(true);
    expect(visitor.openKey()).toBe("model:named");
  });

  // Why: a tap on nothing closes the card and is the next sheet's.
  it("closes on a tap that hits no model", () => {
    const w = world([block("toy", "toy")]);
    let hit: string | null = "toy";
    const { visitor, dom } = visitorFor(w, () => hit);
    visitor.tapped(null);
    hit = null;
    expect(visitor.tapped(null)).toBe(false);
    expect(dom.card.hidden).toBe(true);
    expect(visitor.openKey()).toBeNull();
  });

  // Why: a note's card counts the notes and steps through them in a loop.
  it("shows a note as 'Note i of n' and steps through the notes", () => {
    const notes = [
      { position: [0, 0, 0.5], normal: [0, 0, 1], title: "One", text: "First" },
      { position: [0, 0.5, 0], normal: [0, 1, 0], title: "Two" },
    ] as const;
    const w = world([block("bell", "hotspots", { annotations: notes })]);
    const { visitor, dom } = visitorFor(w, () => null);
    visitor.openNote(w.handles[0]!, 1);
    expect(dom.num.textContent).toBe("Note 2 of 2");
    expect(dom.title.textContent).toBe("Two");
    expect(dom.text.textContent).toBe("");
    dom.next.click();
    expect(dom.num.textContent).toBe("Note 1 of 2");
    expect(dom.text.textContent).toBe("First");
    dom.prev.click();
    expect(dom.num.textContent).toBe("Note 2 of 2");
    expect(visitor.openKey()).toBe("note:bell#1");
    visitor.openNote(w.handles[0]!, 5);
    expect(visitor.openKey()).toBe("note:bell#1");
    dom.close.click();
    expect(dom.card.hidden).toBe(true);
  });

  // Why: a cutaway's card steps the cut through its sections.
  it("steps a cutaway through its sections", () => {
    const w = world([
      block("cut", "cutaway", {
        sections: [
          { name: "Across", position: [0, 0, 0], normal: [1, 0, 0] },
          { name: "Along", position: [0, 0, 0], normal: [0, 0, 1] },
        ],
      }),
    ]);
    const { visitor, dom } = visitorFor(w, () => "cut");
    visitor.tapped(null);
    expect(dom.num.textContent).toBe("Section 1 of 2");
    expect(dom.title.textContent).toBe("Across");
    dom.next.click();
    expect(w.handles[0]!.section()).toBe(1);
    expect(dom.title.textContent).toBe("Along");
    dom.next.click();
    expect(w.handles[0]!.section()).toBe(0);
  });

  // Why: a card goes with its model - the station's content hidden as
  // the visitor walks away closes it.
  it("closes when its model is no longer shown", () => {
    const w = world([block("toy", "toy")]);
    const { visitor, dom } = visitorFor(w, () => "toy");
    visitor.tapped(null);
    visitor.tick(0);
    expect(dom.card.hidden).toBe(false);
    w.station.visible = false;
    expect(shownModelViews(w.scene)).toEqual([]);
    visitor.tick(16);
    expect(dom.card.hidden).toBe(true);
  });
});

describe("the toy in hand", () => {
  // Why: the gesture rule - while a toy's card is open, one finger drags
  // it, two pinch it, and a tap puts it down; "Back to its place" undoes
  // both.
  it("drags, pinches and is put back", () => {
    const w = world([block("toy", "toy", { sizeM: 1 })]);
    const { visitor, dom } = visitorFor(w, () => "toy");
    visitor.tapped(null);
    expect(dom.gestures.hidden).toBe(false);
    expect(dom.reset.hidden).toBe(false);
    expect(dom.reset.disabled).toBe(true);
    const toy = w.handles[0]!;
    // A drag right moves it right (+x for a camera looking along -z).
    pointer(dom.gestures, "pointerdown", 1, 100, 400);
    pointer(dom.gestures, "pointermove", 1, 200, 400);
    pointer(dom.gestures, "pointerup", 1, 200, 400);
    expect(toy.model.position.x).toBeGreaterThan(0);
    expect(dom.card.hidden).toBe(false);
    expect(dom.reset.disabled).toBe(false);
    // Two fingers spreading to twice their distance: twice the size.
    pointer(dom.gestures, "pointerdown", 1, 100, 400);
    pointer(dom.gestures, "pointerdown", 2, 200, 400);
    pointer(dom.gestures, "pointermove", 2, 300, 400);
    pointer(dom.gestures, "pointerup", 2, 300, 400);
    pointer(dom.gestures, "pointerup", 1, 100, 400);
    expect(toy.toyFactor()).toBeCloseTo(2, 9);
    dom.reset.click();
    expect(toy.toyFactor()).toBe(1);
    expect(toy.model.position.toArray()).toEqual([0, 0, -4]);
    // A tap on the layer puts the toy down.
    pointer(dom.gestures, "pointerdown", 1, 100, 400);
    pointer(dom.gestures, "pointerup", 1, 101, 400);
    expect(dom.card.hidden).toBe(true);
    expect(dom.gestures.hidden).toBe(true);
  });

  // Why: in any other view the same fingers do nothing to the model.
  it("leaves a model in any other view where it is", () => {
    const w = world([block("bell", "placed", { title: "Bell" })]);
    const { visitor, dom } = visitorFor(w, () => "bell");
    visitor.tapped(null);
    expect(dom.gestures.hidden).toBe(true);
    pointer(dom.gestures, "pointerdown", 1, 100, 400);
    pointer(dom.gestures, "pointermove", 1, 300, 400);
    pointer(dom.gestures, "pointerdown", 2, 200, 400);
    pointer(dom.gestures, "pointermove", 2, 390, 400);
    expect(w.handles[0]!.model.position.toArray()).toEqual([0, 0, -4]);
    expect(w.handles[0]!.model.scale.x).toBe(1);
  });

  // Why: the overlay's own taps are never an AR select: the card, the
  // toy's gesture layer and a note's disc (a button).
  it("keeps the card, the gesture layer and the discs from being AR selects", () => {
    const root = document.createElement("div");
    const dom = mountModelVisitorDom(root);
    expect(cancelsXrSelect(dom.card)).toBe(true);
    expect(cancelsXrSelect(dom.title)).toBe(true);
    expect(cancelsXrSelect(dom.gestures)).toBe(true);
    expect(cancelsXrSelect(dom.layer)).toBe(false);
  });

  // Why: stopping the session removes every disc and closes the card.
  it("clears the card and the discs on stop", () => {
    const notes: TourModelBlock["annotations"] = [
      { position: [0, 0, 0.5], normal: [0, 0, 1], title: "One" },
    ];
    const w = world([block("bell", "hotspots", { annotations: notes })]);
    const { visitor, dom } = visitorFor(w, () => null);
    visitor.tick(0);
    expect(dom.layer.querySelectorAll("button")).toHaveLength(1);
    visitor.openNote(w.handles[0]!, 0);
    visitor.stop();
    expect(dom.card.hidden).toBe(true);
    expect(dom.layer.querySelectorAll("button")).toHaveLength(0);
  });
});
