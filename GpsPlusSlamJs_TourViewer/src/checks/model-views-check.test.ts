/**
 * Why these tests matter: the check page is driven by a test and by a
 * person comparing it with the views' prototype. A block it quietly
 * repaired would show something the caller never asked for, and a field of
 * view other than the prototype's would make every side-by-side
 * comparison differ for a reason that is not the view's.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  checkModelBlock,
  checkPageMode,
  demoBlock,
  demoCamera,
  freeShown,
  viewerFovDeg,
} from "./model-views-check.js";

const good = {
  id: "bell",
  kind: "model",
  view: "hotspots",
  asset: "bell",
  sizeM: 2.7,
  createdAtIso: "2026-10-28T12:00:00.000Z",
  pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
};

describe("checkModelBlock", () => {
  it("passes a model block in every world view", () => {
    for (const view of ["placed", "ghost", "hotspots", "cutaway", "toy"]) {
      expect(checkModelBlock({ ...good, view }).view).toBe(view);
    }
  });

  it("refuses what is not a model block in a world view, naming the field", () => {
    expect(() => checkModelBlock(null)).toThrow(/object/);
    expect(() => checkModelBlock({ ...good, kind: "picture" })).toThrow(/kind/);
    expect(() => checkModelBlock({ ...good, view: "stage" })).toThrow(/view/);
    expect(() => checkModelBlock({ ...good, sizeM: 0 })).toThrow(/sizeM/);
    expect(() => checkModelBlock({ ...good, sizeM: Number.NaN })).toThrow(
      /sizeM/,
    );
    expect(() => checkModelBlock({ ...good, id: "" })).toThrow(/id/);
  });
});

describe("viewerFovDeg", () => {
  it("spans 45 degrees across the screen's short side", () => {
    expect(viewerFovDeg(1440, 900)).toBe(45);
    expect(viewerFovDeg(844, 390)).toBe(45);
    const portrait = viewerFovDeg(390, 844);
    // The horizontal span of a portrait screen is the 45 degrees.
    const horizontal =
      2 * Math.atan(Math.tan((portrait * Math.PI) / 360) * (390 / 844));
    expect((horizontal * 180) / Math.PI).toBeCloseTo(45, 9);
    expect(viewerFovDeg(0, 100)).toBe(45);
  });
});

// Why: a person opening the page must see the views without a test
// driving it, and the e2e must keep a page nothing else draws on. The mode
// is read from the URL, so a wrong reading would either leave the owner
// with an empty sky again or put a demo under the layout e2e.
describe("checkPageMode", () => {
  it("is the demo for a person, the hook only when the URL asks for it", () => {
    expect(checkPageMode("")).toBe("demo");
    expect(checkPageMode("?view=ghost")).toBe("demo");
    expect(checkPageMode("?hook=0")).toBe("demo");
    expect(checkPageMode("?hook=1")).toBe("hook");
    expect(checkPageMode("?a=b&hook")).toBe("hook");
  });
});

// Why: the demo is the one sample every view is judged by, so it must
// carry what each view shows (notes, named sections, a clip that plays)
// and pass the same block check the hook's callers pass.
describe("demoBlock", () => {
  it("is a valid block in every view, with notes, two named sections and the swing clip", () => {
    for (const view of ["placed", "ghost", "hotspots", "cutaway", "toy"]) {
      const block = checkModelBlock(demoBlock(view));
      expect(block.view).toBe(view);
      expect(block.annotations?.length).toBeGreaterThanOrEqual(2);
      expect(block.annotations?.length).toBeLessThanOrEqual(3);
      expect(block.sections?.map((s) => s.name)).toHaveLength(2);
      for (const s of block.sections ?? []) expect(s.name).not.toBe("");
      expect(block.animation).toEqual({ name: "swing", autoplay: true });
    }
  });

  it("falls back to the placed view for a view it does not know", () => {
    expect(demoBlock("stage").view).toBe("placed");
  });
});

// Why: the camera must frame the model on a phone held upright, where the
// field of view is widest vertically and narrowest across; too near and
// the arm leaves the screen, too far and the notes' discs crowd together.
describe("demoCamera", () => {
  it("looks at the model's middle from about two and a half sizes away", () => {
    const { eye, target } = demoCamera(2);
    expect(target).toEqual([0, 1, 0]);
    const d = Math.hypot(
      eye[0] - target[0],
      eye[1] - target[1],
      eye[2] - target[2],
    );
    expect(d).toBeGreaterThan(2 * 2);
    expect(d).toBeLessThan(2 * 3.5);
    expect(eye[1]).toBeGreaterThan(target[1]);
  });

  it("scales with the model and refuses a size that is not positive", () => {
    const a = demoCamera(1);
    const b = demoCamera(4);
    expect(b.eye[2] / a.eye[2]).toBeCloseTo(4, 9);
    expect(() => demoCamera(0)).toThrow(RangeError);
    expect(() => demoCamera(Number.NaN)).toThrow(RangeError);
  });
});

// Why: `show` puts the model at the block's pose with fromArray, which
// reads a short or non-numeric array as NaN or undefined without a word:
// the model would vanish and the check would compare nothing.
describe("checkModelBlock's pose", () => {
  it("refuses a pose that is not three finite numbers and four, naming it", () => {
    const at = (pose: unknown) => () => checkModelBlock({ ...good, pose });
    expect(at(undefined)).toThrow(/"pose"/);
    expect(at({ position: [0, 0], rotation: [0, 0, 0, 1] })).toThrow(
      /"pose.position"/,
    );
    expect(
      at({ position: [0, Number.NaN, 0], rotation: [0, 0, 0, 1] }),
    ).toThrow(/"pose.position"/);
    expect(at({ position: [0, 0, 0], rotation: [0, 0, 1] })).toThrow(
      /"pose.rotation"/,
    );
    expect(at({ position: [0, 0, 0], rotation: [0, 0, "0", 1] })).toThrow(
      /"pose.rotation"/,
    );
    expect(checkModelBlock(good).pose.position).toEqual([0, 0, 0]);
  });
});

// Why: the page shows one model after another; a model taken off the
// page but not freed keeps its geometry and materials on the GPU, so a
// long side-by-side session would grow without end.
describe("freeShown", () => {
  it("takes the view off, removes the model and frees its geometry and materials", () => {
    const station = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const model = new THREE.Mesh(geometry, material);
    station.add(model);
    const order: string[] = [];
    geometry.addEventListener("dispose", () => order.push("geometry"));
    material.addEventListener("dispose", () => order.push("material"));
    const handle = {
      dispose: () => {
        order.push(model.parent === station ? "view" : "view-late");
      },
    };
    freeShown(station, { model, handle });
    expect(model.parent).toBeNull();
    expect(order[0]).toBe("view");
    expect(order).toContain("geometry");
    expect(order).toContain("material");
  });
});
