/**
 * Why these tests matter: a tour model's world view changes how the
 * visitor sees one file - glass, cut open, carrying notes, a toy - and
 * each change must be exactly the view's: a ghost that left its own
 * materials behind would leak them, a cutaway that removed the far half
 * would show nothing of the inside, a note drawn off its point would
 * describe the wrong part, and a toy that kept its size after "Back to
 * its place" would no longer be the tour's model. The notes live on the
 * block, so they must survive a replaced model file.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { TOY_MAX_SIZE_M } from "./model-gestures.js";
import {
  mountModelView,
  mountedModelViews,
  sectionColour,
  type TourModelBlock,
} from "./model-views.js";

const NOW = "2026-10-28T12:00:00.000Z";

/** A model block in `view`, at the origin, `sizeM` 3. */
function block(
  view: TourModelBlock["view"],
  extra: Partial<TourModelBlock> = {},
): TourModelBlock {
  return {
    id: "bell",
    kind: "model",
    view,
    asset: "bell",
    sizeM: 3,
    createdAtIso: NOW,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ...extra,
  };
}

/** A 2 m wide, 1 m tall box standing on the ground (its base at y 0),
 *  scaled to 3 m (factor 1.5) under a parent at `parentPos`. */
function standing(parentPos: [number, number, number] = [0, 0, 0]) {
  const parent = new THREE.Group();
  parent.position.set(...parentPos);
  const model = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: "#336699" });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), material);
  mesh.position.y = 0.5;
  model.add(mesh);
  model.scale.setScalar(1.5);
  parent.add(model);
  parent.updateMatrixWorld(true);
  return { parent, model, mesh, material };
}

/** A camera at `at` looking at `target`. */
function cameraAt(
  at: [number, number, number],
  target: [number, number, number],
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  camera.position.set(...at);
  camera.lookAt(...target);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("mountModelView", () => {
  // Why: placed is the model as it is - nothing added, nothing swapped.
  it("leaves a placed model as it is", () => {
    const { model, mesh, material } = standing();
    const view = mountModelView(model, block("placed"), 1.5);
    expect(view.view).toBe("placed");
    expect(mesh.material).toBe(material);
    expect(mesh.children).toHaveLength(0);
    expect(model.scale.x).toBe(1.5);
    expect(view.notes).toEqual([]);
    view.dispose();
  });

  // Why: the ghost is glass over a depth pass, and disposing gives the
  // model its own material back, so the caller frees it as usual and the
  // view frees its own.
  it("draws a ghost as glass over a depth pass, and gives the materials back", () => {
    const { model, mesh, material } = standing();
    const view = mountModelView(model, block("ghost"), 1.5);
    const glass = mesh.material as unknown as THREE.ShaderMaterial;
    expect(glass).toBeInstanceOf(THREE.ShaderMaterial);
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBe(2);
    const depth = mesh.children[0] as THREE.Mesh;
    expect(depth.name).toBe("ghost-depth");
    expect((depth.material as THREE.MeshBasicMaterial).colorWrite).toBe(false);
    expect(depth.renderOrder).toBe(1);
    // The station's fade writes the glass's opacity: the shader reads it.
    glass.opacity = 0.4;
    view.update(0.1, null);
    expect(glass.uniforms["uAppear"]?.value).toBe(0.4);
    expect(glass.uniforms["uGround"]?.value).toBe(0);
    let freed = 0;
    glass.addEventListener("dispose", () => {
      freed += 1;
    });
    view.dispose();
    expect(mesh.material).toBe(material);
    expect(mesh.renderOrder).toBe(0);
    expect(mesh.children).toHaveLength(0);
    expect(freed).toBe(1);
  });

  // Why: the ghost's feet fade into the ground the model stands on, so
  // the ground follows the model wherever its station puts it.
  it("puts the ghost's ground at the model's own height in the world", () => {
    const { model, mesh } = standing([0, 7, 0]);
    const view = mountModelView(model, block("ghost"), 1.5);
    view.update(0.016, null);
    const glass = mesh.material as unknown as THREE.ShaderMaterial;
    expect(glass.uniforms["uGround"]?.value).toBe(7);
    view.dispose();
  });

  // Why: a model whose origin is not at its feet (a centred origin is
  // common in exported files) had its ground at its middle, so its lower
  // half faded out; and a fade a fixed 0.7 m tall hid a small model
  // entirely. The ground is the model's lowest point, and the fade is at
  // most 0.3 of its height.
  it("fades a ghost from its lowest point, over at most 0.3 of its height", () => {
    const parent = new THREE.Group();
    parent.position.set(0, 7, 0);
    const model = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1));
    model.add(mesh);
    model.scale.setScalar(1.5);
    parent.add(model);
    parent.updateMatrixWorld(true);
    const view = mountModelView(model, block("ghost"), 1.5);
    view.update(0.016, null);
    const glass = mesh.material as unknown as THREE.ShaderMaterial;
    expect(glass.uniforms["uGround"]?.value).toBeCloseTo(7 - 0.75, 9);
    expect(glass.uniforms["uFade"]?.value).toBeCloseTo(0.3 * 1.5, 9);
    view.dispose();

    const small = new THREE.Group();
    const pebble = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    pebble.position.y = 0.05;
    small.add(pebble);
    small.updateMatrixWorld(true);
    const tiny = mountModelView(small, block("ghost", { sizeM: 0.1 }), 1);
    tiny.update(0.016, null);
    const tinyGlass = pebble.material as unknown as THREE.ShaderMaterial;
    // The geometry is float32: six decimals is its precision.
    expect(tinyGlass.uniforms["uGround"]?.value).toBeCloseTo(0, 6);
    expect(tinyGlass.uniforms["uFade"]?.value).toBeCloseTo(0.03, 6);
    tiny.dispose();

    const { model: tall, mesh: tallMesh } = standing();
    const big = mountModelView(tall, block("ghost"), 1.5);
    big.update(0.016, null);
    const bigGlass = tallMesh.material as unknown as THREE.ShaderMaterial;
    // 1.5 m tall: 0.3 of it is 0.45 m, under the 0.7 m cap.
    expect(bigGlass.uniforms["uFade"]?.value).toBeCloseTo(0.45, 9);
    big.dispose();
  });

  // Why: the cutaway without sections removes the NEAR half - the side
  // toward the visitor - so the inside shows; the far half stays.
  it("cuts a cutaway with a plane facing the visitor, removing the near half", () => {
    const { model, mesh, material } = standing();
    let clipping = 0;
    const view = mountModelView(model, block("cutaway"), 1.5, {
      enableClipping: () => {
        clipping += 1;
      },
    });
    expect(clipping).toBe(1);
    const plane = material.clippingPlanes?.[0];
    expect(plane).toBeDefined();
    expect(material.side).toBe(THREE.FrontSide);
    const fill = mesh.children.find((c) => c.name === "cutaway-fill") as
      THREE.Mesh | undefined;
    expect(fill).toBeDefined();
    const fillMaterial = fill!.material as THREE.MeshBasicMaterial;
    expect(fillMaterial.side).toBe(THREE.BackSide);
    expect(fillMaterial.clippingPlanes?.[0]).toBe(plane);
    expect(fillMaterial.color.getHexString()).toBe("336699");
    // The visitor 10 m south (+z) of the model: the near side is +z.
    view.update(0.016, cameraAt([0, 1.6, 10], [0, 0.75, 0]));
    const near = new THREE.Vector3(0, 0.75, 0.5);
    const far = new THREE.Vector3(0, 0.75, -0.5);
    // Three keeps a point whose distance to a clipping plane is >= 0.
    expect(plane!.distanceToPoint(near)).toBeLessThan(0);
    expect(plane!.distanceToPoint(far)).toBeGreaterThan(0);
    // The frame faces the cut, at the model's centre.
    const frame = model.children.find((c) => c.name === "cutaway-frame");
    expect(frame).toBeDefined();
    expect(frame!.position.y).toBeCloseTo(0.5, 9);
    view.dispose();
    expect(material.clippingPlanes).toBeNull();
    expect(mesh.children).toHaveLength(0);
    expect(model.children.some((c) => c.name === "cutaway-frame")).toBe(false);
  });

  // Why: the facing cut turns after the visitor smoothly, not in a jump:
  // a visitor stepping round the model sees the cut follow.
  it("turns the facing cut toward a visitor who walked round, smoothed", () => {
    const { model, material } = standing();
    const view = mountModelView(model, block("cutaway"), 1.5);
    view.update(0.016, cameraAt([0, 1.6, 10], [0, 0.75, 0]));
    const plane = material.clippingPlanes![0]!;
    const before = plane.normal.clone();
    view.update(0.016, cameraAt([10, 1.6, 0], [0, 0.75, 0]));
    const after = plane.normal.clone();
    expect(after.angleTo(before)).toBeGreaterThan(0);
    expect(after.angleTo(before)).toBeLessThan(Math.PI / 4);
    for (let i = 0; i < 200; i++) {
      view.update(0.05, cameraAt([10, 1.6, 0], [0, 0.75, 0]));
    }
    // Settled: the plane's normal points away from the visitor (-x).
    expect(plane.normal.x).toBeCloseTo(-1, 3);
    view.dispose();
  });

  // Why: a station is moved after its content is drawn (its anchor is
  // refined as the alignment improves); a section placed once, at mount,
  // would keep cutting where the model used to stand.
  it("keeps a section on the model when its station moves after mounting", () => {
    const { parent, model, material } = standing();
    const view = mountModelView(
      model,
      block("cutaway", {
        sections: [
          { name: "Across", position: [0.2, 0.5, 0], normal: [1, 0, 0] },
        ],
      }),
      1,
    );
    parent.position.set(10, 0, -4);
    parent.rotation.y = Math.PI / 2;
    parent.updateMatrixWorld(true);
    view.update(0.016, cameraAt([5, 1, 5], [0, 0, 0]));
    const plane = material.clippingPlanes![0]!;
    const at = (x: number, y: number, z: number) =>
      plane.distanceToPoint(model.localToWorld(new THREE.Vector3(x, y, z)));
    expect(at(0.2, 0.5, 0)).toBeCloseTo(0, 9);
    expect(at(0.5, 0.5, 0)).toBeLessThan(0);
    expect(at(-0.5, 0.5, 0)).toBeGreaterThan(0);
    view.dispose();
  });

  // Why: a section removes the side its normal points to, in the model's
  // own space (it turns and scales with the model), and the visitor steps
  // through the sections in a loop.
  it("cuts by the current section, removing the side its normal points to, and steps through them", () => {
    const { parent, model, material } = standing();
    parent.rotation.y = Math.PI / 2;
    parent.updateMatrixWorld(true);
    const view = mountModelView(
      model,
      block("cutaway", {
        sections: [
          { name: "Across", position: [0.2, 0.5, 0], normal: [1, 0, 0] },
          { name: "Lengthways", position: [0, 0.5, 0], normal: [0, 0, 2] },
        ],
      }),
      1.5,
    );
    expect(view.section()).toBe(0);
    const plane = material.clippingPlanes![0]!;
    // The model's +x is the world's -z (turned 90 degrees left); its
    // section at x 0.2 is at world z -0.3 (scaled by 1.5).
    const at = (x: number, y: number, z: number) =>
      plane.distanceToPoint(model.localToWorld(new THREE.Vector3(x, y, z)));
    expect(at(0.5, 0.5, 0)).toBeLessThan(0);
    expect(at(-0.5, 0.5, 0)).toBeGreaterThan(0);
    expect(at(0.2, 0.5, 0)).toBeCloseTo(0, 9);
    // A camera does not turn a section.
    view.update(0.1, cameraAt([5, 1, 5], [0, 0, 0]));
    expect(at(0.5, 0.5, 0)).toBeLessThan(0);
    view.setSection(1);
    expect(view.section()).toBe(1);
    expect(at(0, 0.5, 0.4)).toBeLessThan(0);
    expect(at(0, 0.5, -0.4)).toBeGreaterThan(0);
    view.setSection(2);
    expect(view.section()).toBe(0);
    view.setSection(-1);
    expect(view.section()).toBe(1);
    view.setSection(0.5);
    expect(view.section()).toBe(1);
    view.dispose();
  });

  // Why: only a hotspots model carries its notes; their points follow the
  // model's pose and size, and each marker floats off its surface along
  // the note's normal by a share of the model's size (held in 4 cm-4 m).
  it("places a hotspots model's notes on its surface, in the world", () => {
    const { parent, model } = standing([10, 0, 0]);
    parent.rotation.y = Math.PI;
    parent.updateMatrixWorld(true);
    const notes = [
      { position: [0, 1, 0.5], normal: [0, 0, 3], title: "Front" },
      { position: [1, 0.5, 0], normal: [1, 0, 0], title: "Side", text: "x" },
    ] as const;
    const hot = mountModelView(
      model,
      block("hotspots", { annotations: notes }),
      1.5,
    );
    expect(hot.notes).toBe(notes);
    const points = hot.notePoints();
    expect(points).toHaveLength(2);
    // Turned half round about the parent at x 10: the front faces -z.
    expect(points[0]!.surface.toArray().map((v) => +v.toFixed(9))).toEqual([
      10, 1.5, -0.75,
    ]);
    expect(points[0]!.normal.z).toBeCloseTo(-1, 9);
    // The largest side is 3 m: 0.13 x 3 = 0.39 m off the surface.
    expect(points[0]!.marker.z).toBeCloseTo(-0.75 - 0.39, 9);
    hot.dispose();
    for (const view of ["placed", "ghost", "cutaway", "toy"] as const) {
      const other = mountModelView(
        model,
        block(view, { annotations: notes }),
        1.5,
      );
      expect(other.notes, view).toEqual([]);
      expect(other.notePoints(), view).toEqual([]);
      other.dispose();
    }
  });

  // Why: the notes are the block's, written in the model's own space, so
  // a creator replacing the model's file keeps every note.
  it("reads the notes from the block, so a model of another file carries the same notes", () => {
    const notes: TourModelBlock["annotations"] = [
      { position: [0, 1, 0], normal: [0, 1, 0], title: "Top" },
    ];
    const b = block("hotspots", { annotations: notes });
    const first = mountModelView(standing().model, b, 1.5);
    const replaced = new THREE.Group();
    replaced.add(new THREE.Mesh(new THREE.SphereGeometry(4)));
    const second = mountModelView(replaced, { ...b, asset: "bell2" }, 3 / 8);
    expect(second.notes).toEqual(first.notes);
    expect(second.notePoints()).toHaveLength(1);
  });

  // Why: the clip loops where the tour asks for it, and hotspots holds it
  // at rest so a note stays on the part it describes.
  it("plays the named clip by itself, except in hotspots", () => {
    const track = new THREE.VectorKeyframeTrack(
      "swinger.position",
      [0, 1],
      [0, 0, 0, 5, 0, 0],
    );
    const clip = new THREE.AnimationClip("swing", 1, [track]);
    const animated = () => {
      const model = new THREE.Group();
      const swinger = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      swinger.name = "swinger";
      model.add(swinger);
      model.animations = [clip];
      return { model, swinger };
    };
    const animation = { name: "swing", autoplay: true };
    for (const view of ["placed", "ghost", "cutaway", "toy"] as const) {
      const { model, swinger } = animated();
      const v = mountModelView(model, block(view, { animation }), 1);
      v.update(0.05, null);
      expect(swinger.position.x, view).toBeGreaterThan(0);
      v.dispose();
    }
    const hot = animated();
    const held = mountModelView(hot.model, block("hotspots", { animation }), 1);
    held.update(0.05, null);
    expect(hot.swinger.position.x).toBe(0);
    held.dispose();
    // Not autoplay, or a name the file lacks: nothing plays.
    for (const a of [
      { name: "swing", autoplay: false },
      { name: "ring", autoplay: true },
    ]) {
      const still = animated();
      const v = mountModelView(
        still.model,
        block("placed", { animation: a }),
        1,
      );
      v.update(0.05, null);
      expect(still.swinger.position.x).toBe(0);
      v.dispose();
    }
  });

  // Why: the toy starts at the tour's size and pose; a pinch resizes it
  // within its limits through the same shared scale, a drag moves it in
  // the world (whatever the station's heading), and "Back to its place"
  // restores both. In any other view the same calls do nothing.
  it("plays a toy within its limits and puts it back", () => {
    const { parent, model } = standing([4, 0, 0]);
    parent.rotation.y = Math.PI / 2;
    parent.updateMatrixWorld(true);
    const toy = mountModelView(model, block("toy"), 1.5);
    expect(toy.toyFactor()).toBe(1);
    expect(toy.toyMoved()).toBe(false);
    toy.pinchToy(100, 200);
    expect(toy.toyFactor()).toBe(2);
    expect(model.scale.x).toBe(3);
    toy.pinchToy(100, 1000);
    expect(toy.toyFactor()).toBe(3);
    toy.pinchToy(1000, 1);
    expect(toy.toyFactor()).toBeCloseTo(0.1, 12);
    const before = model.getWorldPosition(new THREE.Vector3());
    toy.moveToy(1, -2);
    parent.updateMatrixWorld(true);
    const after = model.getWorldPosition(new THREE.Vector3());
    expect(after.x - before.x).toBeCloseTo(1, 9);
    expect(after.z - before.z).toBeCloseTo(-2, 9);
    expect(toy.toyMoved()).toBe(true);
    toy.resetToy();
    expect(toy.toyFactor()).toBe(1);
    expect(model.scale.x).toBe(1.5);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    expect(toy.toyMoved()).toBe(false);
    toy.dispose();

    const placed = mountModelView(model, block("placed"), 1.5);
    placed.pinchToy(100, 200);
    placed.moveToy(1, 1);
    expect(model.scale.x).toBe(1.5);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    placed.dispose();
  });

  // Why: a drag that kept going (or a jump in the gesture's ray near the
  // horizon) carried a toy kilometres away, out of sight with no way back
  // but Reset. Its offset from its place is held within 10 m plus three
  // of its sizes.
  it("keeps a toy within 10 m plus three of its sizes of its place", () => {
    const { model } = standing([4, 0, 0]);
    const toy = mountModelView(model, block("toy"), 1.5);
    toy.moveToy(100, 0);
    expect(model.position.length()).toBeCloseTo(10 + 3 * 3, 9);
    toy.moveToy(-2, 0);
    expect(model.position.x).toBeCloseTo(17, 9);
    toy.moveToy(0, 1000);
    expect(model.position.length()).toBeCloseTo(19, 9);
    toy.dispose();
  });

  // Why: the reach used the model's tour size, not the size the toy is
  // shown at: a 500 m model shown as a 50 m toy could be dragged 1.5 km.
  // The reach is 10 m plus three of the SHOWN sizes, swept over the sizes
  // a tour may carry, and a pinch that shrinks a dragged toy pulls it back
  // within its new reach.
  it("keeps a toy within reach of its shown size, for every tour size, also after a pinch", () => {
    for (const sizeM of [0.1, 0.5, 1, 3, 10, 16.7, 40, 50, 100, 200, 500]) {
      const { model } = standing();
      const toy = mountModelView(model, block("toy", { sizeM }), sizeM / 2);
      const shown = () => Math.min(sizeM * toy.toyFactor(), TOY_MAX_SIZE_M);
      toy.moveToy(5000, 0);
      expect(shown(), String(sizeM)).toBeLessThanOrEqual(TOY_MAX_SIZE_M);
      expect(model.position.length(), String(sizeM)).toBeCloseTo(
        10 + 3 * shown(),
        6,
      );
      toy.pinchToy(1000, 1);
      expect(model.position.length(), `${sizeM} pinched`).toBeLessThanOrEqual(
        10 + 3 * shown() + 1e-9,
      );
      toy.pinchToy(1, 1000);
      toy.moveToy(5000, 0);
      expect(model.position.length(), `${sizeM} grown`).toBeCloseTo(
        10 + 3 * shown(),
        6,
      );
      toy.dispose();
    }
  });

  // Why: the toy's cap is a size in metres - a 40 m model may grow to
  // 50 m, never 3x - and a model placed larger than 50 m starts at 50 m.
  it("caps a toy's largest side at 50 m", () => {
    const { model } = standing();
    const big = mountModelView(model, block("toy", { sizeM: 40 }), 20);
    big.pinchToy(1, 1000);
    expect(big.toyFactor() * 40).toBeCloseTo(TOY_MAX_SIZE_M, 9);
    big.dispose();
    const huge = mountModelView(model, block("toy", { sizeM: 200 }), 100);
    expect(huge.toyFactor() * 200).toBeCloseTo(TOY_MAX_SIZE_M, 9);
    expect(model.scale.x).toBeCloseTo(25, 9);
    huge.dispose();
    expect(model.scale.x).toBe(100);
  });

  // Why: a flat model (a sign, a floor plan) is zero tall, so 0.3 of its
  // height is a fade of 0 m, and the shader's smoothstep(0, 0, h) is
  // undefined in GLSL - it may draw the glass or nothing. The fade is held
  // at 1 mm at least.
  it("gives a flat ghost a fade of at least 1 mm", () => {
    const flat = new THREE.Group();
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    );
    flat.add(sheet);
    flat.updateMatrixWorld(true);
    const view = mountModelView(flat, block("ghost", { sizeM: 2 }), 1);
    view.update(0.016, null);
    const glass = sheet.material as unknown as THREE.ShaderMaterial;
    expect(glass.uniforms["uFade"]?.value).toBe(1e-3);
    view.dispose();
  });

  // Why: defensive - a scale that is not finite and > 0 would put the
  // model nowhere.
  it("refuses a scale that is not finite and > 0", () => {
    const { model } = standing();
    expect(() => mountModelView(model, block("placed"), 0)).toThrow(RangeError);
    expect(() => mountModelView(model, block("placed"), Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("mountedModelViews and sectionColour", () => {
  // Why: the visitor's frame loop finds the views it updates through this
  // one registry: a view is in it from its mount to its dispose, never
  // after (a disposed view updated each frame would move a freed model).
  it("lists a view from its mount to its dispose", () => {
    const { model } = standing();
    const view = mountModelView(model, block("placed"), 1.5);
    expect(mountedModelViews()).toContain(view);
    expect(mountedModelViews().find((h) => h.model === model)).toBe(view);
    view.dispose();
    expect(mountedModelViews()).not.toContain(view);
  });

  // Why: a cut face takes its material's colour; a material with none
  // (a shader) gets the warm fallback.
  it("colours a cut face by its material", () => {
    expect(
      sectionColour(
        new THREE.MeshStandardMaterial({ color: "#123456" }),
      ).getHexString(),
    ).toBe("123456");
    expect(sectionColour(new THREE.ShaderMaterial()).getHexString()).toBe(
      "e0a060",
    );
  });
});

/** A rigged model: a skinned bar bound to one bone, with a morph target,
 *  beside three instances of a box. */
function rigged() {
  const model = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = "arm";
  const geometry = new THREE.BoxGeometry(1, 0.2, 0.2);
  const count = geometry.attributes["position"]!.count;
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
  geometry.morphAttributes["position"] = [
    geometry.attributes["position"]!.clone(),
  ];
  const skinned = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial(),
  );
  skinned.morphTargetInfluences = [0.5];
  model.add(bone, skinned);
  model.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton([bone]));
  const instanced = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
    3,
  );
  model.add(instanced);
  model.updateMatrixWorld(true);
  return { model, skinned, instanced, bone };
}

/** The companion `name` the view hung on `mesh`. */
function companion(mesh: THREE.Object3D, name: string): THREE.Mesh {
  const found = mesh.children.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found as THREE.Mesh;
}

// Why: a rigged model with its clip playing moves its vertices on the GPU
// (bones, morph targets, instances). A pass drawn as a plain mesh of the
// same geometry, or a glass shader without three's skinning and morph
// code, stays frozen in the bind pose while the model moves - a glass
// shell and cut faces that no longer sit on the model.
describe("mountModelView on a rigged model", () => {
  it("draws the ghost's glass through three's skinning, morph and instancing code", () => {
    const { model, skinned } = rigged();
    const view = mountModelView(model, block("ghost"), 1);
    const glass = skinned.material as unknown as THREE.ShaderMaterial;
    for (const chunk of ["skinning_pars_vertex", "morphtarget_pars_vertex"]) {
      expect(glass.vertexShader, chunk).toContain(`#include <${chunk}>`);
    }
    // The body's chunks in the order three r185's meshbasic vertex shader
    // runs them: each reads what the one before wrote (`objectNormal`,
    // `transformed`, `mvPosition`), so a chunk out of order compiles and
    // draws the bind pose, or fails to compile. Substrings alone would pass
    // a shader with every include in the wrong place.
    const order = [
      "morphinstance_vertex",
      "batching_vertex",
      "beginnormal_vertex",
      "morphnormal_vertex",
      "skinbase_vertex",
      "skinnormal_vertex",
      "defaultnormal_vertex",
      "begin_vertex",
      "morphtarget_vertex",
      "skinning_vertex",
      "project_vertex",
    ];
    const at = order.map((chunk) =>
      glass.vertexShader.indexOf(`#include <${chunk}>`),
    );
    for (const [i, chunk] of order.entries()) {
      expect(at[i], chunk).toBeGreaterThan(-1);
      if (i > 0) expect(at[i], chunk).toBeGreaterThan(at[i - 1]!);
    }
    view.dispose();
  });

  for (const [view, name] of [
    ["ghost", "ghost-depth"],
    ["cutaway", "cutaway-fill"],
  ] as const) {
    it(`keeps the ${view}'s pass on a skinned, morphed or instanced mesh moving with it`, () => {
      const { model, skinned, instanced } = rigged();
      const handle = mountModelView(model, block(view), 1);
      const pass = companion(skinned, name) as THREE.SkinnedMesh;
      expect(pass.isSkinnedMesh).toBe(true);
      expect(pass.skeleton).toBe(skinned.skeleton);
      expect(pass.bindMatrix.equals(skinned.bindMatrix)).toBe(true);
      expect(pass.bindMode).toBe(skinned.bindMode);
      // The same influences, not a copy: the clip writes them each frame.
      expect(pass.morphTargetInfluences).toBe(skinned.morphTargetInfluences);
      const many = companion(instanced, name) as THREE.InstancedMesh;
      expect(many.isInstancedMesh).toBe(true);
      expect(many.count).toBe(3);
      expect(many.instanceMatrix).toBe(instanced.instanceMatrix);
      handle.dispose();
      expect(skinned.children).toHaveLength(0);
      expect(instanced.children).toHaveLength(0);
    });
  }
});
