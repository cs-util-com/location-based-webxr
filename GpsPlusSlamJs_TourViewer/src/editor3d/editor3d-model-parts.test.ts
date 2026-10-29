// @vitest-environment jsdom
/**
 * Why these tests matter: a note's place is written in the model file's
 * own space, so it must stay on the same spot of the model whatever its
 * size, its turn and its place in the world when it was clicked - a point
 * left in world metres would sit off the model as soon as it is moved or
 * resized. A section's normal must point toward the creator (the side
 * facing them is cut away, the format's rule), snapped to the model's
 * axes. The disc and the planes are the view's only feedback for them.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createModelParts,
  HELD_CLICK_MS,
  heldClickNext,
  hitModel,
  noteSpotOf,
  pickedEdit,
  sectionSpotOf,
} from "./editor3d-model-parts.js";

/** A 2 m cube (the file's metres) drawn 3x larger, turned 90 degrees
 *  about up, 10 m east. */
function drawnCube() {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  model.scale.setScalar(3);
  model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  model.position.set(10, 0, 0);
  model.updateMatrixWorld(true);
  return model;
}

function rayFrom(from: THREE.Vector3, to: THREE.Vector3) {
  return new THREE.Raycaster(from, to.clone().sub(from).normalize());
}

describe("a click on the model", () => {
  it("gives a note's spot in the model's own space, on its surface", () => {
    const model = drawnCube();
    // From the north, toward the cube's middle: the world's -z face, which
    // is the model's -x face after the turn.
    const hit = hitModel(
      rayFrom(new THREE.Vector3(10, 0.6, -20), new THREE.Vector3(10, 0.6, 0)),
      model,
    );
    expect(hit).not.toBeNull();
    const spot = noteSpotOf(model, hit!);
    expect(spot).toEqual({ position: [1, 0.2, 0], normal: [1, 0, 0] });
  });

  it("keeps a small model's note as precise as a large one's: the rounding follows the model's own size", () => {
    // A 1 cm part (the file's metres) shown 1 m tall. A fixed millimetre
    // step would snap its note to a tenth of the part; the step is about a
    // ten-thousandth of the model's largest side instead (1e-6 here).
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01)));
    model.scale.setScalar(100);
    model.updateMatrixWorld(true);
    const hit = hitModel(
      rayFrom(new THREE.Vector3(0, 0.123, -20), new THREE.Vector3(0, 0.123, 0)),
      model,
    );
    expect(noteSpotOf(model, hit!)).toEqual({
      position: [0, 0.00123, -0.005],
      normal: [0, 0, -1],
    });
    // A large model's place stays short in the file: a 1 km model rounds
    // to a tenth of a metre.
    const big = new THREE.Group();
    big.add(new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000)));
    big.updateMatrixWorld(true);
    const far = hitModel(
      rayFrom(
        new THREE.Vector3(0, 123.456, -2000),
        new THREE.Vector3(0, 123.456, 0),
      ),
      big,
    );
    expect(noteSpotOf(big, far!)?.position).toEqual([0, 123.5, -500]);
  });

  it("gives the surface's true direction under a stretch that is not the same on every axis", () => {
    // A 2 m cube turned 45 degrees about z inside a model stretched 2x
    // along x. The face's direction in the model's own space is the turn's
    // (0.707, 0.707, 0); carrying it as a plain direction through the
    // stretch would tilt it toward x (the normal needs the inverse
    // transpose).
    const model = new THREE.Group();
    const part = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    part.rotation.z = Math.PI / 4;
    model.add(part);
    model.scale.set(2, 1, 1);
    model.updateMatrixWorld(true);
    const centre = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0);
    const worldCentre = model.localToWorld(centre.clone());
    const worldNormal = new THREE.Vector3(0.5, 1, 0).normalize();
    const hit = hitModel(
      rayFrom(
        worldCentre.clone().addScaledVector(worldNormal, 10),
        worldCentre,
      ),
      model,
    );
    const spot = noteSpotOf(model, hit!);
    expect(spot?.normal).toEqual([0.707, 0.707, 0]);
    expect(spot?.position).toEqual([0.7071, 0.7071, 0]);
  });

  it("misses where the ray passes the model", () => {
    const model = drawnCube();
    expect(
      hitModel(
        rayFrom(new THREE.Vector3(30, 0, -20), new THREE.Vector3(30, 0, 0)),
        model,
      ),
    ).toBeNull();
  });

  it("cuts a section through the point, its normal toward the camera on the nearest axis", () => {
    const model = drawnCube();
    const camera = new THREE.Vector3(12, 2, -20);
    const hit = hitModel(rayFrom(camera, new THREE.Vector3(10, 0, 0)), model);
    const spot = sectionSpotOf(model, hit!, camera);
    expect(spot.normal).toEqual([1, 0, 0]);
    const behind = sectionSpotOf(model, hit!, new THREE.Vector3(10, 0, 40));
    expect(behind.normal).toEqual([-1, 0, 0]);
    expect(behind.position).toEqual(spot.position);
  });

  it("answers each wait with its edit", () => {
    const at = { position: [0, 1, 0], normal: [0, 1, 0] } as const;
    expect(pickedEdit({ what: "note-add" }, at)).toEqual({
      kind: "note-add",
      at,
    });
    expect(pickedEdit({ what: "section-place", index: 2 }, at)).toEqual({
      kind: "section-place",
      index: 2,
      at,
    });
  });
});

// Why: a model being drawn anew (its file loading again after an edit) is
// briefly not drawn. A click waited for on it then must not be said missed:
// it is held and answered once the model is drawn, dropped when the wait or
// the selection changed, and said missed only when the model never comes.
describe("a waited click while the model is drawn anew", () => {
  const held = {
    pointer: { x: 10, y: 20 },
    selected: "m",
    pick: { what: "note-place", index: 1 },
    atMs: 1000,
  } as const;
  const now = {
    selected: "m",
    pick: { what: "note-place", index: 1 },
    drawn: false,
    ms: 1000,
  } as const;

  it("waits while the model is not drawn, and answers once it is", () => {
    expect(heldClickNext(held, now)).toBe("wait");
    expect(heldClickNext(held, { ...now, ms: 1000 + HELD_CLICK_MS - 1 })).toBe(
      "wait",
    );
    expect(heldClickNext(held, { ...now, drawn: true, ms: 1500 })).toBe(
      "answer",
    );
  });

  it("drops the click when the wait or the selection changed", () => {
    expect(heldClickNext(held, { ...now, pick: null })).toBe("drop");
    expect(
      heldClickNext(held, { ...now, pick: { what: "note-place", index: 0 } }),
    ).toBe("drop");
    expect(heldClickNext(held, { ...now, pick: { what: "section-add" } })).toBe(
      "drop",
    );
    expect(heldClickNext(held, { ...now, selected: "other" })).toBe("drop");
    expect(heldClickNext(held, { ...now, selected: null, drawn: true })).toBe(
      "drop",
    );
  });

  it("says missed when the model is not drawn in time", () => {
    expect(heldClickNext(held, { ...now, ms: 1000 + HELD_CLICK_MS })).toBe(
      "missed",
    );
  });
});

describe("the parts drawn", () => {
  it("draws a disc per note, the focused one marked, and a plane per section; a press on a disc asks for its focus", () => {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    container.append(canvas);
    document.body.append(container);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 1000);
    camera.position.set(10, 0, -30);
    camera.lookAt(10, 0, 0);
    camera.updateMatrixWorld(true);
    const model = drawnCube();
    const focusNote = vi.fn();
    const block = {
      id: "m",
      kind: "model",
      view: "hotspots",
      asset: "a",
      sizeM: 6,
      annotations: [
        { position: [1, 0, 0], normal: [1, 0, 0], title: "Front" },
        { position: [-1, 0, 0], normal: [-1, 0, 0], title: "Back" },
      ],
      sections: [{ name: "Cut", position: [0, 0, 0], normal: [0, 1, 0] }],
    } as const;
    const parts = createModelParts({
      container,
      canvas,
      scene,
      camera,
      view: () => ({
        selected: "m",
        focus: { part: "note", index: 1 },
        pick: { what: "note-add" },
      }),
      model: (id) => (id === "m" ? (block as never) : null),
      drawn: (id) => (id === "m" ? model : null),
      focusNote,
    });
    parts.update();
    const discs = [
      ...container.querySelectorAll<HTMLButtonElement>(".note-disc"),
    ];
    expect(discs.map((d) => d.textContent)).toEqual(["1", "2"]);
    expect(discs.map((d) => d.classList.contains("on"))).toEqual([false, true]);
    expect(discs[0]?.getAttribute("aria-label")).toBe("Note 1: Front");
    expect(parts.stats().planes).toBe(1);
    // The note on the near face is drawn at the middle of the screen.
    expect(discs[0]?.style.transform).toBe("translate(200px, 150px)");
    expect(canvas.style.cursor).toBe("crosshair");
    discs[1]?.click();
    expect(focusNote).toHaveBeenCalledWith(1);
    parts.dispose();
    expect(container.querySelector(".note-disc")).toBeNull();
    expect(scene.getObjectByName("model-sections")).toBeUndefined();
  });
});
