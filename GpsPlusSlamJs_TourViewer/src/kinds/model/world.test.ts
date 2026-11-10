import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AnimationClip,
  Box3,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from "three";

import { mountedModelViews, type TourModelBlock } from "../../model-views.js";
import type { WorldEnv, WorldMode } from "../../world-part.js";
import { SILENT_SOUND } from "../../world-sound.js";
import { modelWorld } from "./world.js";

/**
 * Why these tests matter: a placed model stands in the world through the
 * same door as every other kind, so its part must do on its own what the
 * renderer used to do for it - load its file, take the size the tour
 * names, wear its world view - and free all of it with its station, also
 * when the station goes before the file lands. The editor builds the same
 * part in `edit`, where it must stand still.
 */

const NOW = "2026-09-08T16:00:00.000Z";

function blockOf(over: Partial<TourModelBlock> = {}): TourModelBlock {
  return {
    id: "m1",
    kind: "model",
    view: "placed",
    asset: "horse",
    sizeM: 3,
    createdAtIso: NOW,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ...over,
  };
}

/** A box model (2 x 0.5 x 1 m unless given) whose geometry and material
 *  count their frees. */
function boxModel(size: readonly [number, number, number] = [2, 0.5, 1]) {
  const freed = { geometry: 0, material: 0 };
  const geometry = new BoxGeometry(...size);
  geometry.dispose = () => {
    freed.geometry += 1;
  };
  const material = new MeshBasicMaterial();
  material.dispose = () => {
    freed.material += 1;
  };
  const mesh = new Mesh(geometry, material);
  mesh.animations = [new AnimationClip("trot", 1, [])];
  return { mesh, freed };
}

function envOf(
  load: (id: string) => Promise<Object3D>,
  mode: WorldMode = "play",
): WorldEnv & { clipping: number; asked: string[] } {
  const env = {
    mode,
    clipping: 0,
    asked: [] as string[],
    loadAsset: () => Promise.reject(new Error("no plain file here")),
    loadModel(id: string) {
      env.asked.push(id);
      return load(id);
    },
    enableClipping() {
      env.clipping += 1;
    },
    canvasTexture: () => {
      throw new Error("a model paints no canvas");
    },
    sound: () => SILENT_SOUND,
  };
  return env;
}

describe("modelWorld", () => {
  it("stands a placed model at the size the tour names, wearing its view", async () => {
    const { mesh } = boxModel();
    const env = envOf(() => Promise.resolve(mesh));
    const part = modelWorld(blockOf(), env);
    expect(part).not.toBeNull();
    await part!.ready;
    expect(env.asked).toEqual(["horse"]);
    expect(part!.object.children).toEqual([mesh]);
    // Its largest side (2 m) made 3 m: the factor 1.5, the shared rule.
    expect(mesh.scale.x).toBeCloseTo(1.5, 12);
    expect(mesh.userData["tourScale"]).toBeCloseTo(1.5, 12);
    expect(mesh.userData["tourSizeM"]).toBe(3);
    const view = mountedModelViews().find((h) => h.model === mesh);
    expect(view?.view).toBe("placed");
    part!.dispose();
    expect(mountedModelViews().some((h) => h.model === mesh)).toBe(false);
  });

  // Why: the card view stands nothing in the station's world, and a model with no size cannot be scaled
  // by the shared rule: none of them is a part, and none reads its file.
  it("gives no part for a view that stands nothing, or a model with no size", () => {
    const env = envOf(() => Promise.reject(new Error("never read")));
    expect(modelWorld(blockOf({ view: "card" }), env)).toBeNull();
    const { sizeM: _drop, ...noSize } = blockOf();
    expect(modelWorld(noSize as TourModelBlock, env)).toBeNull();
    expect(env.asked).toEqual([]);
  });

  it("a cutaway switches the page's clipping on; ghost glass gives the model's own material back", async () => {
    const cut = boxModel();
    const cutEnv = envOf(() => Promise.resolve(cut.mesh));
    const cutPart = modelWorld(blockOf({ view: "cutaway" }), cutEnv);
    await cutPart!.ready;
    expect(cutEnv.clipping).toBeGreaterThan(0);
    // Every material the cutaway made (its cut faces) is freed exactly
    // once with the part: by the view, and not again with the model.
    const fills: number[] = [];
    cut.mesh.traverse((o) => {
      if (o.name !== "cutaway-fill" || !(o instanceof Mesh)) return;
      const material = o.material as MeshBasicMaterial;
      const at = fills.push(0) - 1;
      const free = material.dispose.bind(material);
      material.dispose = () => {
        fills[at]! += 1;
        free();
      };
    });
    expect(fills.length).toBeGreaterThan(0);
    cutPart!.dispose();
    expect(
      fills.every((n) => n === 1),
      String(fills),
    ).toBe(true);
    expect(cut.freed).toEqual({ geometry: 1, material: 1 });

    const glass = boxModel();
    const own = glass.mesh.material;
    const part = modelWorld(
      blockOf({ view: "ghost" }),
      envOf(() => Promise.resolve(glass.mesh)),
    );
    await part!.ready;
    expect(glass.mesh.material).not.toBe(own);
    const ghost = glass.mesh.material;
    let ghostFreed = 0;
    const freeGhost = ghost.dispose.bind(ghost);
    ghost.dispose = () => {
      ghostFreed += 1;
      freeGhost();
    };
    part!.dispose();
    expect(ghostFreed, "the ghost glass is freed exactly once").toBe(1);
    expect(glass.mesh.material).toBe(own);
    expect(glass.freed).toEqual({ geometry: 1, material: 1 });
  });

  // Why: a station is drawn and freed again as the visitor walks; a file
  // that lands after its station went must be freed, never added.
  it("frees a model whose file lands after the part went", async () => {
    const { mesh, freed } = boxModel();
    let land: (model: Object3D) => void = () => undefined;
    const part = modelWorld(
      blockOf(),
      envOf(
        () =>
          new Promise<Object3D>((resolve) => {
            land = resolve;
          }),
      ),
    );
    part!.dispose();
    land(mesh);
    await part!.ready;
    expect(part!.object.children).toEqual([]);
    expect(freed).toEqual({ geometry: 1, material: 1 });
    expect(mountedModelViews().some((h) => h.model === mesh)).toBe(false);
  });

  // Why: the renderer names a model whose file cannot be read in
  // `skipped`, so the page can say so; the part's `ready` is how it learns.
  it("rejects ready when the file cannot be read, and stands nothing", async () => {
    const part = modelWorld(
      blockOf(),
      envOf(() => Promise.reject(new Error("bad glb"))),
    );
    await expect(part!.ready).rejects.toThrow("bad glb");
    expect(part!.object.children).toEqual([]);
    part!.dispose();
  });

  // Why: the editor draws no frame for a model's view - nothing there
  // lifts a ghost's ground, switches clipping on or plays a clip - so a
  // view mounted in `edit` would show a half-made look. The editor shows
  // the plain model at its tour size (as it did before models came
  // through the door), still and in its own materials, in every world
  // view; `play` wears the view.
  it("stands the plain model in edit, without its view, in every world view", async () => {
    const animation = { name: "trot", autoplay: true };
    const playing = boxModel();
    const play = modelWorld(
      blockOf({ animation, view: "ghost" }),
      envOf(() => Promise.resolve(playing.mesh)),
    );
    await play!.ready;
    const handle = (model: Object3D) =>
      mountedModelViews().find((h) => h.model === model);
    expect(handle(playing.mesh)?.block.animation?.autoplay).toBe(true);
    play!.dispose();
    for (const view of [
      "placed",
      "ghost",
      "hotspots",
      "cutaway",
      "toy",
    ] as const) {
      const still = boxModel();
      const own = still.mesh.material;
      const env = envOf(() => Promise.resolve(still.mesh), "edit");
      const edit = modelWorld(blockOf({ animation, view }), env);
      await edit!.ready;
      expect(handle(still.mesh), view).toBeUndefined();
      expect(still.mesh.material, view).toBe(own);
      expect(env.clipping, view).toBe(0);
      // 2 m made 3 m: the tour size, a toy too.
      expect(still.mesh.scale.x, view).toBeCloseTo(1.5, 12);
      expect(still.mesh.userData["tourScale"], view).toBe(still.mesh.scale.x);
      edit!.dispose();
      expect(still.freed, view).toEqual({ geometry: 1, material: 1 });
    }
  });

  // Why: a toy starts smaller than its tour size; the editor scales a
  // dragged size from `tourScale`, so it must be the scale drawn, or the
  // toy would jump to its full size at the first drag.
  it("records the scale the view drew as tourScale (a toy starts smaller)", async () => {
    const { mesh } = boxModel();
    const part = modelWorld(
      blockOf({ view: "toy", sizeM: 100 }),
      envOf(() => Promise.resolve(mesh)),
    );
    await part!.ready;
    // Its 2 m side made 100 m is a factor 50; the toy starts at 50 m.
    expect(mesh.scale.x).toBeCloseTo(25, 9);
    expect(mesh.userData["tourScale"]).toBe(mesh.scale.x);
    expect(mesh.userData["tourSizeM"]).toBe(100);
    part!.dispose();
  });

  // Why: whatever the file's own size, the model stands at the size the
  // tour names (its largest side), so a creator's choice holds on every
  // page.
  it("property: the drawn largest side is the tour's sizeM", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.double({ min: 0.01, max: 100, noNaN: true }),
          fc.double({ min: 0.01, max: 100, noNaN: true }),
          fc.double({ min: 0.01, max: 100, noNaN: true }),
        ),
        fc.double({ min: 0.05, max: 50, noNaN: true }),
        async (size, sizeM) => {
          const { mesh } = boxModel(size);
          const part = modelWorld(
            blockOf({ sizeM }),
            envOf(() => Promise.resolve(mesh)),
          );
          await part!.ready;
          part!.object.updateMatrixWorld(true);
          const box = new Box3().setFromObject(part!.object);
          const side = box.getSize(new Vector3());
          const largest = Math.max(side.x, side.y, side.z);
          part!.dispose();
          expect(largest).toBeCloseTo(sizeM, 6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// Why: a free that throws half way (a material whose dispose fails) must
// not leave the model behind for a second dispose to free again, and when
// both the view and the model fail to free, the caller is told the first
// failure, not the one that came after it.
describe("modelWorld dispose", () => {
  it("frees the model once when its free throws, and keeps the first error", async () => {
    const { mesh, freed } = boxModel();
    const material = mesh.material;
    material.dispose = () => {
      freed.material += 1;
      throw new Error("material free failed");
    };
    const part = modelWorld(
      blockOf(),
      envOf(() => Promise.resolve(mesh)),
    );
    await part!.ready;
    const view = mountedModelViews().find((h) => h.model === mesh);
    expect(view).toBeDefined();
    const viewDispose = view!.dispose.bind(view);
    view!.dispose = () => {
      viewDispose();
      throw new Error("view free failed");
    };
    expect(() => part!.dispose()).toThrow("view free failed");
    expect(freed).toEqual({ geometry: 1, material: 1 });
    expect(mesh.parent).toBeNull();
    // Again: nothing left to free, nothing thrown.
    expect(() => part!.dispose()).not.toThrow();
    expect(freed).toEqual({ geometry: 1, material: 1 });
  });
});
