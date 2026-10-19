import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
  type Object3D,
} from "three";

import { CHARACTER_HEIGHT_M, createSceneStage } from "./scene-stage";

/**
 * Why these tests matter: the knight has to stand ON the station's spot,
 * feet on its altitude, turned to the visitor - a figure facing away or
 * floating at the zero is the first thing a visitor would notice. A story
 * that moved on before a big decode landed must not leave a stale figure in
 * the scene, and every figure taken away must free its GPU memory.
 */

function textureOf(width: number, height: number): Texture {
  const t = new Texture();
  t.image = { width, height };
  return t;
}

function harness(
  pose = {
    positionNue: [10, 400, -5] as [number, number, number],
    rotationNue: [0, 0, 0, 1] as [number, number, number, number],
  },
) {
  const scene = new Group();
  const deps = {
    getScene: () => scene as Object3D,
    poseOf: vi.fn((): typeof pose | null => pose),
    decodeTexture: vi.fn((): Promise<Texture | null> =>
      Promise.resolve(textureOf(100, 200)),
    ),
    loadModel: vi.fn((): Promise<Object3D> => {
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
      return Promise.resolve(g);
    }),
  };
  return { scene, deps, stage: createSceneStage(deps) };
}

describe("createSceneStage", () => {
  it("stands a character on the station's spot, feet on its altitude, its aspect kept", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]));
    expect(h.scene.children).toHaveLength(1);
    const holder = h.scene.children[0]!;
    expect(holder.position.toArray()).toEqual([10, 400, -5]);
    const plane = holder.getObjectByName("station-character") as Mesh;
    plane.geometry.computeBoundingBox();
    const size = plane.geometry.boundingBox!.getSize(new Vector3());
    expect(size.y).toBeCloseTo(CHARACTER_HEIGHT_M);
    expect(size.x).toBeCloseTo(CHARACTER_HEIGHT_M / 2);
    const feet =
      plane.getWorldPosition(new Vector3()).y - CHARACTER_HEIGHT_M / 2;
    expect(feet).toBeCloseTo(400);
  });

  it("turns the character to face the visitor, about the vertical only", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]));
    // Visitor 10 m North of the station.
    h.stage.faceVisitor([20, 401.6, -5]);
    const holder = h.scene.children[0]!;
    const facing = new Vector3(0, 0, 1).applyQuaternion(holder.quaternion);
    expect(facing.x).toBeCloseTo(1);
    expect(facing.y).toBeCloseTo(0);
    expect(facing.z).toBeCloseTo(0);
  });

  it("places a model with the station's own rotation and never turns it", async () => {
    const turned = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] as [
      number,
      number,
      number,
      number,
    ];
    const h = harness({ positionNue: [1, 2, 3], rotationNue: turned });
    await h.stage.showModel("arch", new Blob(["glb"]));
    const holder = h.scene.children[0]!;
    expect(holder.getObjectByName("station-model")).toBeDefined();
    expect(holder.quaternion.toArray()).toEqual(turned);
    h.stage.faceVisitor([100, 0, 100]);
    expect(holder.quaternion.toArray()).toEqual(turned);
  });

  it("replaces what it shows, and clear frees the GPU memory", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]));
    const plane = h.scene.getObjectByName("station-character") as Mesh;
    const geometryDispose = vi.spyOn(plane.geometry, "dispose");
    const textureDispose = vi.spyOn(
      (plane.material as MeshBasicMaterial).map!,
      "dispose",
    );
    await h.stage.showModel("gate", new Blob(["glb"]));
    expect(h.scene.children).toHaveLength(1);
    expect(geometryDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
    h.stage.clear();
    expect(h.scene.children).toHaveLength(0);
  });

  it("frees every texture of a model it takes away, not only its colour map (R12)", async () => {
    // Why this test matters (K4 review R12): a GLB's materials carry normal,
    // roughness and emissive maps; freeing only `map` leaked them for every
    // model a story showed.
    const h = harness();
    const normalMap = new Texture();
    const emissiveMap = new Texture();
    h.deps.loadModel.mockImplementationOnce(() => {
      const g = new Group();
      g.add(
        new Mesh(
          new BoxGeometry(),
          new MeshStandardMaterial({ normalMap, emissiveMap }),
        ),
      );
      return Promise.resolve(g);
    });
    const normalDispose = vi.spyOn(normalMap, "dispose");
    const emissiveDispose = vi.spyOn(emissiveMap, "dispose");
    await h.stage.showModel("arch", new Blob(["glb"]));
    h.stage.clear();
    expect(normalDispose).toHaveBeenCalledOnce();
    expect(emissiveDispose).toHaveBeenCalledOnce();
  });

  it("drops a figure whose decode lands after the stage moved on", async () => {
    let land: (t: Texture | null) => void = () => undefined;
    const h = harness();
    h.deps.decodeTexture.mockImplementationOnce(
      () => new Promise((r) => (land = r)),
    );
    const pending = h.stage.showCharacter("gate", new Blob(["png"]));
    h.stage.clear();
    const late = textureOf(10, 10);
    const dispose = vi.spyOn(late, "dispose");
    land(late);
    await pending;
    expect(h.scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });

  it("rejects, so the story can say so, when a figure does not decode", async () => {
    const h = harness();
    h.deps.decodeTexture.mockResolvedValueOnce(null);
    await expect(
      h.stage.showCharacter("gate", new Blob(["x"])),
    ).rejects.toThrow(/did not decode/);
    expect(h.scene.children).toHaveLength(0);
  });

  it("waits for the station's position and mounts once it has one, instead of failing for good (R8)", async () => {
    // Why this test matters (K4 review R8): a story replayed before the GPS
    // zero existed lost its figure for good (\"could not be loaded\").
    const h = harness();
    h.deps.poseOf.mockReturnValue(null);
    let settled = false;
    const shown = h.stage.showModel("gate", new Blob(["x"])).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    expect(h.scene.children).toHaveLength(0);
    // Still no position: a visitor update changes nothing.
    h.stage.faceVisitor([0, 0, 0]);
    expect(h.scene.children).toHaveLength(0);
    h.deps.poseOf.mockReturnValue({
      positionNue: [1, 2, 3],
      rotationNue: [0, 0, 0, 1],
    });
    h.stage.faceVisitor([0, 0, 0]);
    await shown;
    expect(h.scene.children).toHaveLength(1);
  });

  it("a waiting mount taken away by the next step is freed, and the show settles", async () => {
    const h = harness();
    h.deps.poseOf.mockReturnValue(null);
    const shown = h.stage.showCharacter("gate", new Blob(["x"]));
    await new Promise((r) => setTimeout(r, 0));
    h.stage.clear();
    await shown;
    h.deps.poseOf.mockReturnValue({
      positionNue: [1, 2, 3],
      rotationNue: [0, 0, 0, 1],
    });
    h.stage.faceVisitor([0, 0, 0]);
    expect(h.scene.children).toHaveLength(0);
  });

  // Why (r881 re-review M-B): the station guide now holds the figure's
  // pose back until the alignment has a heading, which can take a walk.
  // The story must be able to say why the figure is not there yet, so the
  // stage reports the moment a decoded figure starts to wait - once, and
  // never for a figure that stands at once.
  it("reports once when a decoded figure starts waiting for its position, never when it stands at once", async () => {
    const h = harness();
    const atOnce = vi.fn();
    await h.stage.showCharacter("gate", new Blob(["x"]), atOnce);
    expect(atOnce).not.toHaveBeenCalled();
    h.deps.poseOf.mockReturnValue(null);
    const waits = vi.fn();
    const shown = h.stage.showModel("gate", new Blob(["x"]), waits);
    await new Promise((r) => setTimeout(r, 0));
    expect(waits).toHaveBeenCalledTimes(1);
    h.stage.faceVisitor([0, 0, 0]);
    expect(waits).toHaveBeenCalledTimes(1);
    h.deps.poseOf.mockReturnValue({
      positionNue: [1, 2, 3],
      rotationNue: [0, 0, 0, 1],
    });
    h.stage.faceVisitor([0, 0, 0]);
    await shown;
    expect(waits).toHaveBeenCalledTimes(1);
  });
});

describe("the figure follows its station's presence (it fades, the story plays on)", () => {
  // Why this matters: the owner's decision is that the figure fades with
  // its station while the story panel and audio play on, and that stepping
  // back shows it again - so the figure must leave the scene on leaving,
  // come back on return without a second decode, and never appear while
  // its station's content is not shown.
  const FADE = 400;

  function following() {
    const clock = { ms: 1000 };
    const scene = new Group();
    const decodeTexture = vi.fn((): Promise<Texture | null> =>
      Promise.resolve(textureOf(100, 200)),
    );
    const stage = createSceneStage({
      getScene: () => scene,
      poseOf: () => ({
        positionNue: [0, 400, 0] as [number, number, number],
        rotationNue: [0, 0, 0, 1] as [number, number, number, number],
      }),
      decodeTexture,
      loadModel: () => Promise.resolve(new Group()),
      now: () => clock.ms,
      fadeMs: FADE,
    });
    const opacity = (): number => {
      const plane = scene.getObjectByName("station-character") as
        Mesh | undefined;
      return plane === undefined
        ? -1
        : (plane.material as MeshBasicMaterial).opacity;
    };
    return { clock, scene, stage, decodeTexture, opacity };
  }

  it("fades out when its station stops showing, leaves the scene, and fades back in on return without decoding again", async () => {
    const h = following();
    await h.stage.showCharacter("gate", new Blob(["png"]));
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
    h.stage.follow((id) => id !== "gate");
    h.clock.ms += FADE / 2;
    h.stage.follow((id) => id !== "gate");
    expect(h.opacity()).toBeCloseTo(0.5, 6);
    h.clock.ms += FADE / 2;
    h.stage.follow((id) => id !== "gate");
    expect(h.scene.children).toHaveLength(0);
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
    expect(h.opacity()).toBe(0);
    h.clock.ms += FADE;
    h.stage.follow(() => true);
    expect(h.opacity()).toBe(1);
    expect(h.decodeTexture).toHaveBeenCalledTimes(1);
  });

  it("a figure decoded while its station is not shown waits off the scene", async () => {
    const h = following();
    h.stage.follow(() => false);
    await h.stage.showCharacter("gate", new Blob(["png"]));
    expect(h.scene.children).toHaveLength(0);
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
  });

  it("clear frees a figure that is off the scene", async () => {
    const h = following();
    await h.stage.showCharacter("gate", new Blob(["png"]));
    h.stage.follow(() => false);
    h.clock.ms += FADE;
    h.stage.follow(() => false);
    const plane = h.scene.children.length === 0;
    expect(plane).toBe(true);
    const disposeSpy = vi.fn();
    // Reach the hidden figure through a return, then hide it again.
    h.stage.follow(() => true);
    const material = (h.scene.getObjectByName("station-character") as Mesh)
      .material as MeshBasicMaterial;
    material.dispose = disposeSpy;
    h.stage.follow(() => false);
    h.clock.ms += FADE;
    h.stage.follow(() => false);
    h.stage.clear();
    expect(disposeSpy).toHaveBeenCalled();
    expect(h.scene.children).toHaveLength(0);
  });
});
