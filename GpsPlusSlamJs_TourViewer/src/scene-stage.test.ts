import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
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

  it("rejects, so the story can say so, when a figure does not decode or the station cannot be placed", async () => {
    const h = harness();
    h.deps.decodeTexture.mockResolvedValueOnce(null);
    await expect(
      h.stage.showCharacter("gate", new Blob(["x"])),
    ).rejects.toThrow(/did not decode/);
    h.deps.poseOf.mockReturnValueOnce(null);
    await expect(h.stage.showModel("gate", new Blob(["x"]))).rejects.toThrow(
      /no position/,
    );
    expect(h.scene.children).toHaveLength(0);
  });
});
