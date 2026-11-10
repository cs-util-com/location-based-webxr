import type { TourCharacterBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  Group,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type Object3D,
} from "three";
import { describe, expect, it, vi } from "vitest";

import type { FigureSource } from "../../character-canvas.js";
import type * as CharacterLookModule from "../../character-look.js";
import type { CharacterLook } from "../../character-look.js";
import { fakeCharacterPainters } from "../../test-support/fake-character-painters.js";
import type { WorldEnv, WorldMode } from "../../world-part.js";
import { SILENT_SOUND } from "../../world-sound.js";
import {
  EDITOR_CHARACTER_VIEW,
  PICKED_CHARACTER_PARTS,
  characterWorld,
  editorCharacterView,
} from "./world.js";

/**
 * Why these tests matter: the editor's 3D view drew no character at all,
 * so a creator placing one saw nothing where he stands. He is drawn now
 * through the visitor's own look, which turns toward the camera by at most
 * 60 degrees: drawn flat at a fixed turn he would vanish edge-on from the
 * side. These hold that he stands only in the editor (the visitor's free
 * host is untouched), in the look of his view (the old `stage` view in
 * the default story look), never edge-on from any heading round him (his
 * back turns to a camera behind him, the swing eased), and that a
 * file that cannot be read takes the part out and a dispose frees it.
 */

/** Every look the part made, with the options it was made from. */
const made = vi.hoisted(
  () => [] as { view: string; noCard: boolean; look: CharacterLook }[],
);
vi.mock("../../character-look.js", async (importOriginal) => {
  const real = await importOriginal<typeof CharacterLookModule>();
  return {
    ...real,
    createCharacterLook: (
      options: Parameters<typeof real.createCharacterLook>[0],
    ) => {
      const look = real.createCharacterLook(options);
      made.push({ view: options.view, noCard: options.noCard === true, look });
      return look;
    },
  };
});

const NOW = "2026-11-09T12:00:00.000Z";

function blockOf(over: Partial<TourCharacterBlock> = {}): TourCharacterBlock {
  return {
    id: "herald",
    kind: "character",
    view: "speak",
    name: "Herald",
    image: "knight",
    caption: "Hear ye!",
    createdAtIso: NOW,
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ...over,
  };
}

function envOf(mode: WorldMode, files: readonly string[] = ["knight"]) {
  const env: WorldEnv = {
    mode,
    loadAsset: (id) =>
      files.includes(id)
        ? Promise.resolve(new Blob([]))
        : Promise.reject(new Error(`no file ${id}`)),
    canvasTexture: () => {
      throw new Error("not used");
    },
    loadModel: () => Promise.reject(new Error("no model")),
    enableClipping: () => undefined,
    sound: () => SILENT_SOUND,
  };
  return env;
}

/** A decoder that hands back a 100 x 200 px figure and counts closes. */
function decoder() {
  const closed = { count: 0 };
  const decode = () =>
    Promise.resolve({
      width: 100,
      height: 200,
      close: () => {
        closed.count++;
      },
    } as unknown as FigureSource);
  return { decode, closed };
}

async function standing(over: Partial<TourCharacterBlock> = {}) {
  const { painters } = fakeCharacterPainters();
  const { decode, closed } = decoder();
  const part = characterWorld(blockOf(over), envOf("edit"), {
    decode,
    painters,
  });
  if (part === null) throw new Error("no part");
  await part.ready;
  return { part, closed };
}

/** The look the part stands (its root carries it). */
function lookOf(part: { object: Group | { children: unknown[] } }) {
  return (part.object as Group).children[0];
}

describe("editorCharacterView", () => {
  it("keeps a story view, stands stage in the default story look, and the card stands nothing", () => {
    expect(editorCharacterView("bubble")).toBe("bubble");
    expect(editorCharacterView("popup")).toBe("popup");
    expect(editorCharacterView("stage")).toBe(EDITOR_CHARACTER_VIEW);
    expect(EDITOR_CHARACTER_VIEW).toBe("speak");
    expect(editorCharacterView("card")).toBeNull();
  });
});

describe("characterWorld", () => {
  it("stands nothing in play, where the free host stands him", () => {
    expect(characterWorld(blockOf(), envOf("play"))).toBeNull();
  });

  it("stands nothing for the card view", () => {
    expect(characterWorld(blockOf({ view: "card" }), envOf("edit"))).toBeNull();
  });

  it("stands his look once his image is read, and lets the decoded picture go", async () => {
    const { part, closed } = await standing();
    expect(lookOf(part)?.name).toBe("editor-character");
    expect(closed.count).toBe(1);
    part.dispose();
    expect(part.object.children).toHaveLength(0);
  });

  // Why: the default for a view with no world look; drawn as nothing,
  // the creator would again see no character where he stands.
  it("stands a stage view in the default story look, and a story view in its own", async () => {
    await standing({ view: "bubble" }).then(({ part }) => part.dispose());
    expect(made.at(-1)?.view).toBe("bubble");
    const { part } = await standing({ view: "stage" });
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    camera.position.set(0, 1.6, 6);
    camera.lookAt(0, 1.2, 0);
    part.update?.({ seconds: 1, viewer: [0, 1.6, 6], camera });
    const last = made.at(-1);
    expect(last?.view).toBe("speak");
    expect(last?.look.state().view).toBe("speak");
    // Outside a story: no card holds his line.
    expect(last?.noCard).toBe(true);
    part.dispose();
  });

  // Why: his bubble and name tag are drawn over everything; were they
  // picked, a press meant for an item behind his words would select him.
  it("is picked by his figure alone, not his words, shadow or ring", async () => {
    const firstHit: Record<string, string | undefined> = {};
    for (const view of ["speak", "popup"] as const) {
      const { part } = await standing({ view });
      let meshes = 0;
      part.object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        meshes++;
        const picked = PICKED_CHARACTER_PARTS.has(o.name);
        expect(o.raycast === Mesh.prototype.raycast, o.name).toBe(picked);
      });
      expect(meshes).toBeGreaterThan(4);
      // A ray at his chest from in front meets his figure (first of
      // what shows: a raycaster does not skip a hidden mesh, the editor's
      // pick does).
      const camera = new PerspectiveCamera(50, 1, 0.05, 600);
      camera.position.set(0, 1.6, 5);
      camera.lookAt(0, 1.2, 0);
      camera.updateMatrixWorld(true);
      part.update?.({ seconds: 1, viewer: [0, 1.6, 5], camera });
      part.object.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(0, 1.2, 5), new Vector3(0, 0, -1));
      const shows = (o: Object3D | null): boolean =>
        o === null || (o.visible && shows(o.parent));
      const hit = ray
        .intersectObject(part.object, true)
        .find((h) => shows(h.object));
      firstHit[view] = hit?.object.name;
      part.dispose();
    }
    expect(firstHit.speak).toBe("character-front");
    // The pop-up, unfolded at 5 m: its own figure on the stage.
    expect(firstHit.popup).toBe("character-popfigure");
  });

  it("rejects ready when his image cannot be read, and stands nothing", async () => {
    const { painters } = fakeCharacterPainters();
    const part = characterWorld(blockOf({ image: "gone" }), envOf("edit"), {
      decode: decoder().decode,
      painters,
    });
    await expect(part?.ready).rejects.toThrow("no file gone");
    expect(part?.object.children).toHaveLength(0);
    part?.dispose();
  });

  it("stands nothing when disposed before his image arrives", async () => {
    const { painters } = fakeCharacterPainters();
    const { decode, closed } = decoder();
    const part = characterWorld(blockOf(), envOf("edit"), { decode, painters });
    part?.dispose();
    await part?.ready;
    expect(part?.object.children).toHaveLength(0);
    expect(closed.count).toBe(1);
  });

  /**
   * How squarely his figure shows to a camera `relDeg` round from his
   * facing (|cos| of the angle between the figure's face and the camera,
   * 1 square on, 0 edge-on), once his eased turn has settled.
   */
  async function squareness(
    poseYawDeg: number,
    relDeg: number,
    distanceM: number,
  ): Promise<number> {
    const yaw = (poseYawDeg * Math.PI) / 180;
    const { part } = await standing();
    const placed = new Group();
    placed.position.set(10, 0, -5);
    placed.add(part.object);
    // The renderer turns the part to the block's pose.
    part.object.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    const h = yaw + (relDeg * Math.PI) / 180;
    camera.position.set(
      10 + distanceM * Math.sin(h),
      1.6,
      -5 + distanceM * Math.cos(h),
    );
    camera.lookAt(10, 1.2, -5);
    camera.updateMatrixWorld(true);
    for (let i = 0; i < 120; i++) {
      part.update?.({ seconds: i * 0.05, viewer: [0, 0, 0], camera });
    }
    placed.updateMatrixWorld(true);
    const figure = made.at(-1)?.look.parts.figure;
    if (figure === undefined) throw new Error("no look");
    const normal = figure.getWorldDirection(new Vector3()).setY(0).normalize();
    const toCamera = camera.position
      .clone()
      .sub(new Vector3(10, 0, -5))
      .setY(0)
      .normalize();
    part.dispose();
    return Math.abs(normal.dot(toCamera));
  }

  // Why: the reason he is drawn through the visitor's look. Seen from in
  // front, from either side and from straight behind (the four headings
  // round him), his figure turns to show a face (its back from behind)
  // at least half square on. Swept over two poses and two distances.
  it("shows a face to the camera from four headings round him: in front, either side and behind", async () => {
    for (const poseYawDeg of [0, 70]) {
      for (const distanceM of [4, 25]) {
        for (const relDeg of [0, 90, 180, 270]) {
          expect(
            await squareness(poseYawDeg, relDeg, distanceM),
            `pose ${poseYawDeg} deg, ${distanceM} m, ${relDeg} deg round`,
          ).toBeGreaterThanOrEqual(0.5 - 1e-6);
        }
      }
    }
  });

  // Why: in the editor he is drawn to be found and picked, so he must
  // never stand edge-on. The visitor's look, turning at most 60 degrees,
  // stands him edge-on 150 degrees round; the editor's turns his back to
  // a camera more than 90 degrees round instead. Swept every 5 degrees
  // all the way round, over two poses.
  it("never stands edge-on: at least 0.85 square on from every heading round him", async () => {
    for (const poseYawDeg of [0, 70]) {
      for (let relDeg = -180; relDeg <= 180; relDeg += 5) {
        expect(
          await squareness(poseYawDeg, relDeg, 8),
          `pose ${poseYawDeg} deg, ${relDeg} deg round`,
        ).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  // Why: crossing his side, his target turn jumps from one 60 degree
  // limit to the other (his face to his back). It must ease over several
  // frames, not snap in one.
  it("eases the swing as the camera crosses his side", async () => {
    const { part } = await standing();
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    const at = (relDeg: number) => {
      const h = (relDeg * Math.PI) / 180;
      camera.position.set(8 * Math.sin(h), 1.6, 8 * Math.cos(h));
      camera.lookAt(0, 1.2, 0);
      camera.updateMatrixWorld(true);
    };
    const yaw = () => {
      const figure = made.at(-1)?.look.parts.figure;
      if (figure === undefined) throw new Error("no look");
      part.object.updateMatrixWorld(true);
      const d = figure.getWorldDirection(new Vector3());
      return (Math.atan2(d.x, d.z) * 180) / Math.PI;
    };
    at(85);
    for (let i = 0; i < 120; i++) {
      part.update?.({ seconds: i * 0.05, viewer: [0, 0, 0], camera });
    }
    const before = yaw();
    expect(before).toBeCloseTo(60, 3);
    at(95);
    part.update?.({ seconds: 6.05, viewer: [0, 0, 0], camera });
    const after = yaw();
    // Turning toward -60 (his back to the camera), but less than a third
    // of the way in one 50 ms frame.
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThan(40);
    for (let i = 2; i < 120; i++) {
      part.update?.({ seconds: 6 + i * 0.05, viewer: [0, 0, 0], camera });
    }
    expect(yaw()).toBeCloseTo(-60, 3);
    part.dispose();
  });
});
