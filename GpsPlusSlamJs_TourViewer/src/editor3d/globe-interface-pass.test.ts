import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_INTERFACE,
  createGlobeInterfacePass,
  isInterfacePart,
} from "./globe-interface-pass.js";

/** A small tour: a billboard, a ring with a child, a pole, a lit model. */
function tour() {
  const root = new THREE.Group();
  const billboard = new THREE.Sprite(new THREE.SpriteMaterial());
  billboard.name = "billboard 1";
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1, 2),
    new THREE.MeshBasicMaterial(),
  );
  ring.name = "found-radius";
  const ringChild = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  ring.add(ringChild);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(),
    new THREE.MeshLambertMaterial(),
  );
  pole.name = "pole";
  const model = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  const overlay = new THREE.Mesh(
    new THREE.CircleGeometry(),
    new THREE.MeshBasicMaterial({ depthTest: false }),
  );
  root.add(billboard, ring, pole, model, overlay);
  return { root, billboard, ring, ringChild, pole, model, overlay };
}

const onLayer = (o: THREE.Object3D, layer: number) => o.layers.isEnabled(layer);

describe("isInterfacePart", () => {
  // Why: the rule decides what the clouds' shadow may darken: sprites and
  // overlays (no depth test) are the interface; a lit or depth-tested mesh
  // (a model, the ground) is the world.
  it("takes sprites and overlays, never a depth-tested mesh", () => {
    const t = tour();
    expect(isInterfacePart(t.billboard)).toBe(true);
    expect(isInterfacePart(t.overlay)).toBe(true);
    expect(isInterfacePart(t.model)).toBe(false);
    expect(isInterfacePart(t.ring)).toBe(false);
    expect(isInterfacePart(new THREE.Group())).toBe(false);
    const mixed = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshBasicMaterial({ depthTest: false }),
      new THREE.MeshBasicMaterial(),
    ]);
    expect(isInterfacePart(mixed)).toBe(false);
  });
});

describe("createGlobeInterfacePass", () => {
  function setup() {
    const t = tour();
    const scene = new THREE.Scene();
    scene.add(t.root);
    const light = new THREE.HemisphereLight();
    scene.add(light);
    const camera = new THREE.PerspectiveCamera();
    const drawn: {
      cameraLayer: boolean;
      lifted: THREE.Object3D[];
      model: boolean;
      auto: boolean;
    }[] = [];
    const renderer = {
      render(s: THREE.Object3D, c: THREE.Camera) {
        expect(s).toBe(scene);
        const lifted: THREE.Object3D[] = [];
        s.traverse((o) => {
          if (o.layers.test(c.layers)) lifted.push(o);
        });
        drawn.push({
          cameraLayer: c.layers.isEnabled(GLOBE_INTERFACE.layer),
          lifted,
          model: t.model.layers.test(c.layers),
          auto: scene.matrixWorldAutoUpdate,
        });
      },
    };
    const pass = createGlobeInterfacePass({
      renderer,
      scene,
      camera,
      roots: () => [t.root],
      lights: [light],
    });
    return { t, scene, camera, light, drawn, pass };
  }

  // Why: between `lift` and `draw` the scene's own pass must not see the
  // interface (else the shadow composited after it darkens it), and the
  // draw after the air must see exactly the interface and its lights.
  it("lifts the interface out of the scene's pass and draws it alone", () => {
    const { t, camera, light, drawn, pass } = setup();
    pass.lift();
    expect(pass.lifted()).toBe(5);
    for (const o of [t.billboard, t.ring, t.ringChild, t.pole, t.overlay]) {
      expect(o.layers.test(camera.layers)).toBe(false);
    }
    expect(t.model.layers.test(camera.layers)).toBe(true);
    pass.draw();
    expect(drawn).toHaveLength(1);
    const [d] = drawn;
    expect(d?.cameraLayer).toBe(true);
    expect(d?.model).toBe(false);
    expect(d?.auto).toBe(false);
    expect(new Set(d?.lifted)).toEqual(
      new Set([t.billboard, t.ring, t.ringChild, t.pole, t.overlay, light]),
    );
  });

  // Why: the hit tests (a click on a billboard, the gizmo's disc) run
  // between frames on the default layer: after the draw every object, and
  // the camera, are back on their own layers.
  it("puts every object and the camera back after the draw", () => {
    const { t, scene, camera, pass } = setup();
    t.pole.layers.enable(3);
    const before = [t.billboard, t.ring, t.ringChild, t.pole, t.overlay].map(
      (o) => o.layers.mask,
    );
    const cameraMask = camera.layers.mask;
    pass.lift();
    pass.draw();
    expect(
      [t.billboard, t.ring, t.ringChild, t.pole, t.overlay].map(
        (o) => o.layers.mask,
      ),
    ).toEqual(before);
    expect(camera.layers.mask).toBe(cameraMask);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(onLayer(t.billboard, 0)).toBe(true);
  });

  // Why: a frame that throws between its lift and its draw must not leave
  // the interface lifted for good (the next lift would save the lifted
  // masks); and a hidden object is neither lifted nor walked.
  it("recovers a frame without a draw and skips hidden objects", () => {
    const { t, pass, camera } = setup();
    pass.lift();
    pass.lift();
    pass.draw();
    expect(t.billboard.layers.test(camera.layers)).toBe(true);
    t.ring.visible = false;
    pass.lift();
    expect(pass.lifted()).toBe(3);
    expect(t.ringChild.layers.test(camera.layers)).toBe(true);
    pass.draw();
  });

  // Why: a code's square (a lit, depth-tested mesh named "code") is the
  // interface by its name, with its face under it; without the name it
  // was taken for the world and darkened by the clouds' shadow.
  it("lifts a code's square and its face by the name", () => {
    const { t, pass, camera } = setup();
    const square = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshLambertMaterial(),
    );
    square.name = "code";
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshLambertMaterial(),
    );
    square.add(face);
    t.root.add(square);
    pass.lift();
    expect(pass.lifted()).toBe(7);
    expect(face.layers.test(camera.layers)).toBe(false);
    pass.draw();
    expect(face.layers.test(camera.layers)).toBe(true);
  });

  // Why: nothing to draw, no second pass over the scene.
  it("draws nothing when nothing is lifted", () => {
    const { t, drawn, pass } = setup();
    t.root.visible = false;
    pass.lift();
    pass.draw();
    expect(drawn).toHaveLength(0);
  });

  // Why: the draw restores the camera and the objects even when the
  // renderer throws (a lost context), so the next frame starts clean.
  it("restores the layers when the draw throws", () => {
    const t = tour();
    const scene = new THREE.Scene();
    scene.add(t.root);
    const camera = new THREE.PerspectiveCamera();
    const pass = createGlobeInterfacePass({
      renderer: {
        render() {
          throw new Error("context lost");
        },
      },
      scene,
      camera,
      roots: () => [t.root],
      lights: [],
    });
    pass.lift();
    expect(() => {
      pass.draw();
    }).toThrow("context lost");
    expect(t.billboard.layers.test(camera.layers)).toBe(true);
    expect(camera.layers.isEnabled(GLOBE_INTERFACE.layer)).toBe(false);
  });
});
