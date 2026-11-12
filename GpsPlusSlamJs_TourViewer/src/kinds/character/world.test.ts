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
 * through the visitor's own look, which faces the camera fully: drawn flat
 * at a fixed turn he would vanish edge-on from the side. These hold that
 * he stands only in the editor (the visitor's free host is untouched), in
 * the look of his view (a view this viewer does not know in the default
 * look), square on to the camera from any heading round him (the swing
 * eased), with his full bubble only while he is selected, and that a file
 * that cannot be read takes the part out and a dispose frees it.
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
  it("keeps a look's view, stands a view the looks do not know in the default look, and the card stands nothing", () => {
    expect(editorCharacterView("bubble")).toBe("bubble");
    expect(editorCharacterView("popup")).toBe("popup");
    expect(editorCharacterView("juggle")).toBe(EDITOR_CHARACTER_VIEW);
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

  // Why: the default for a view the looks do not know (a newer
  // tour's); drawn as nothing,
  // the creator would again see no character where he stands.
  it("stands a view the looks do not know in the default look, and a look's view in its own", async () => {
    await standing({ view: "bubble" }).then(({ part }) => part.dispose());
    expect(made.at(-1)?.view).toBe("bubble");
    const { part } = await standing({
      view: "juggle" as TourCharacterBlock["view"],
    });
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
   * His part at a pose turned `poseYawDeg`, and how squarely his figure's
   * FRONT shows to a camera `relDeg` round from that pose at `distanceM`
   * (the cosine of the angle between the figure's face and the camera: 1
   * square on, 0 edge-on, below 0 his back), once his eased turn has
   * settled. One part serves every camera.
   */
  async function posedAt(poseYawDeg: number) {
    const yaw = (poseYawDeg * Math.PI) / 180;
    const { part } = await standing();
    const placed = new Group();
    placed.position.set(10, 0, -5);
    placed.add(part.object);
    // The renderer turns the part to the block's pose.
    part.object.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    let seconds = 0;
    const squareness = (relDeg: number, distanceM: number): number => {
      const h = yaw + (relDeg * Math.PI) / 180;
      camera.position.set(
        10 + distanceM * Math.sin(h),
        1.6,
        -5 + distanceM * Math.cos(h),
      );
      camera.lookAt(10, 1.2, -5);
      camera.updateMatrixWorld(true);
      for (let i = 0; i < 120; i++) {
        seconds += 0.05;
        part.update?.({ seconds, viewer: [0, 0, 0], camera });
      }
      placed.updateMatrixWorld(true);
      const figure = made.at(-1)?.look.parts.figure;
      if (figure === undefined) throw new Error("no look");
      const normal = figure
        .getWorldDirection(new Vector3())
        .setY(0)
        .normalize();
      const toCamera = camera.position
        .clone()
        .sub(new Vector3(10, 0, -5))
        .setY(0)
        .normalize();
      return normal.dot(toCamera);
    };
    return { squareness, dispose: () => part.dispose() };
  }

  // Why: in the editor he is drawn to be found and picked, and he is a
  // flat cut-out: he shows his front square on to the camera from every
  // heading round him, whatever his pose's facing (it turns only the
  // pop-up stage). Swept every 5 degrees all the way round, over three
  // poses and two distances.
  it("shows his front square on from every heading round him", async () => {
    for (const poseYawDeg of [0, 70, -150]) {
      const posed = await posedAt(poseYawDeg);
      for (const distanceM of [4, 25]) {
        for (let relDeg = -180; relDeg <= 180; relDeg += 5) {
          expect(
            posed.squareness(relDeg, distanceM),
            `pose ${poseYawDeg} deg, ${distanceM} m, ${relDeg} deg round`,
          ).toBeGreaterThan(1 - 1e-6);
        }
      }
      posed.dispose();
    }
  });

  // Why: a camera that jumps round him (a framing, an orbit flick) must
  // not snap the figure; his turn eases over several frames and settles
  // square on.
  it("eases the turn when the camera jumps round him", async () => {
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
    at(0);
    for (let i = 0; i < 120; i++) {
      part.update?.({ seconds: i * 0.05, viewer: [0, 0, 0], camera });
    }
    expect(yaw()).toBeCloseTo(0, 3);
    at(150);
    part.update?.({ seconds: 6.05, viewer: [0, 0, 0], camera });
    // The step from 5.95 s to 6.05 s is the look's 0.1 s clamp, so at its
    // ease rate of 4 a second he covers at most 1 - e^-0.4 of 150 degrees.
    const after = yaw();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(150 * (1 - Math.exp(-0.4)) + 1);
    for (let i = 2; i < 120; i++) {
      part.update?.({ seconds: 6 + i * 0.05, viewer: [0, 0, 0], camera });
    }
    expect(yaw()).toBeCloseTo(150, 3);
    part.dispose();
  });

  // Why: a close editing camera opened every character's full bubble and
  // they covered the scene. In the editor his name tag shows, and his
  // full bubble only while the editor's selection is him - at any
  // distance. Swept from 2 m to 30 m.
  it("opens his full bubble only while he is the editor's selection", async () => {
    const { part } = await standing({ view: "speak" });
    const look = made.at(-1)?.look;
    if (look === undefined) throw new Error("no look");
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    for (const r of [2, 5, 12, 30]) {
      camera.position.set(0, 1.6, r);
      camera.lookAt(0, 1.2, 0);
      camera.updateMatrixWorld(true);
      for (const [selected, open] of [
        [null, false],
        ["someone-else", false],
        ["herald", true],
        [undefined, false],
      ] as const) {
        for (let i = 0; i < 40; i++) {
          part.update?.({
            seconds: r * 100 + i * 0.05,
            viewer: [0, 1.6, r],
            camera,
            ...(selected === undefined ? {} : { selected }),
          });
        }
        expect(look.state().bubble, `${r} m, ${String(selected)}`).toBe(
          open ? 1 : 0,
        );
        expect(look.state().pip, `${r} m, ${String(selected)}`).toBe(
          open ? 0 : 1,
        );
      }
    }
    part.dispose();
  });
});
