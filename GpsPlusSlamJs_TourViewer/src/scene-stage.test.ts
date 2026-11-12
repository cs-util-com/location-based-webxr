import { describe, expect, it, vi } from "vitest";
import {
  Group,
  Mesh,
  PerspectiveCamera,
  RingGeometry,
  Texture,
  Vector3,
  type Object3D,
} from "three";

import { CHARACTER_HEIGHT_M, createSceneStage } from "./scene-stage";
import { createFigureMemo } from "./figure-memo";
import type { CharacterLook } from "./character-look";
import type * as CharacterLookModule from "./character-look";
import { fakeCharacterPainters } from "./test-support/fake-character-painters";
import { inheritedScaleOf } from "./placement/place-scale";

/**
 * Why these tests matter: the character has to stand ON his place at the
 * station, feet on its altitude - a figure floating at the zero is the
 * first thing a visitor would notice. A story that moved on before a big
 * decode landed must not leave a stale figure in the scene, and every
 * figure taken away must free its GPU memory.
 */

/** Every look the stage makes, with the presence it was last given and
 *  how often: the stage fades a look by its presence alone. */
const made = vi.hoisted(
  () =>
    [] as {
      look: CharacterLook;
      presence: number;
      writes: number;
      disposed: boolean;
    }[],
);
vi.mock("./character-look", async (importOriginal) => {
  const real = await importOriginal<typeof CharacterLookModule>();
  return {
    ...real,
    createCharacterLook: (
      ...args: Parameters<typeof real.createCharacterLook>
    ) => {
      const look = real.createCharacterLook(...args);
      const entry = { look, presence: 1, writes: 0, disposed: false };
      const setPresence = look.setPresence.bind(look);
      const dispose = look.dispose.bind(look);
      look.setPresence = (alpha) => {
        entry.presence = alpha;
        entry.writes += 1;
        setPresence(alpha);
      };
      look.dispose = () => {
        entry.disposed = true;
        dispose();
      };
      made.push(entry);
      return look;
    },
  };
});
const lastLook = () => made[made.length - 1]!;

function textureOf(width: number, height: number): Texture {
  const t = new Texture();
  t.image = { width, height };
  return t;
}

const ANN = { view: "speak", name: "Ann", line: "Hello." } as const;

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
    lookPainters: fakeCharacterPainters().painters,
  };
  return { scene, deps, stage: createSceneStage(deps) };
}

describe("createSceneStage", () => {
  // Why: a character in a scaled folder is drawn that much larger, in the
  // visitor as in the editor; the look's own height must grow with it.
  it("draws a character as much larger as the scale it is given", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, {
      ...ANN,
      scale: 2,
    });
    const root = h.scene.getObjectByName("station-character")!;
    expect(root.scale.toArray()).toEqual([2, 2, 2]);
    expect(inheritedScaleOf(root)).toBe(2);
  });

  it("stands a character on the station's spot, feet on its altitude, his height kept", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, ANN);
    expect(h.scene.children).toHaveLength(1);
    const holder = h.scene.children[0]!;
    expect(holder.position.toArray()).toEqual([10, 400, -5]);
    // The look's feet are its root's origin.
    const root = holder.getObjectByName("station-character")!;
    expect(root.getWorldPosition(new Vector3()).toArray()).toEqual([
      10, 400, -5,
    ]);
    const front = holder.getObjectByName("character-front") as Mesh;
    front.geometry.computeBoundingBox();
    const box = front.geometry.boundingBox!;
    // The fake painter cuts a 200 px figure with a 3 px rim around it.
    const rim = (3 * CHARACTER_HEIGHT_M) / 200;
    expect(box.min.y + rim).toBeCloseTo(0);
    expect(box.max.y - rim).toBeCloseTo(CHARACTER_HEIGHT_M);
  });

  it("replaces what it shows, and clear frees the GPU memory", async () => {
    const h = harness();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, ANN);
    const first = lastLook();
    await h.stage.showCharacter("gate", new Blob(["png2"]), undefined, ANN);
    expect(h.scene.children).toHaveLength(1);
    expect(first.disposed).toBe(true);
    const second = lastLook();
    expect(second.disposed).toBe(false);
    h.stage.clear();
    expect(second.disposed).toBe(true);
    expect(h.scene.children).toHaveLength(0);
  });

  it("drops a figure whose decode lands after the stage moved on", async () => {
    let land: (t: Texture | null) => void = () => undefined;
    const h = harness();
    h.deps.decodeTexture.mockImplementationOnce(
      () => new Promise((r) => (land = r)),
    );
    const pending = h.stage.showCharacter(
      "gate",
      new Blob(["png"]),
      undefined,
      ANN,
    );
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
      h.stage.showCharacter("gate", new Blob(["x"]), undefined, ANN),
    ).rejects.toThrow(/did not decode/);
    expect(h.scene.children).toHaveLength(0);
  });

  it("waits for the station's position and mounts once it has one, instead of failing for good", async () => {
    // Why this test matters: a story replayed before the GPS zero existed
    // lost its figure for good ("could not be loaded").
    const h = harness();
    h.deps.poseOf.mockReturnValue(null);
    let settled = false;
    const shown = h.stage
      .showCharacter("gate", new Blob(["x"]), undefined, ANN)
      .then(() => {
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
    const shown = h.stage.showCharacter(
      "gate",
      new Blob(["x"]),
      undefined,
      ANN,
    );
    await new Promise((r) => setTimeout(r, 0));
    const parked = lastLook();
    h.stage.clear();
    await shown;
    expect(parked.disposed).toBe(true);
    h.deps.poseOf.mockReturnValue({
      positionNue: [1, 2, 3],
      rotationNue: [0, 0, 0, 1],
    });
    h.stage.faceVisitor([0, 0, 0]);
    expect(h.scene.children).toHaveLength(0);
  });

  // Why: the station guide holds the figure's pose back until the
  // alignment has a heading, which can take a walk. The story must be able
  // to say why the figure is not there yet, so the stage reports the
  // moment a decoded figure starts to wait - once, and never for a figure
  // that stands at once.
  it("reports once when a decoded figure starts waiting for its position, never when it stands at once", async () => {
    const h = harness();
    const atOnce = vi.fn();
    await h.stage.showCharacter("gate", new Blob(["x"]), atOnce, ANN);
    expect(atOnce).not.toHaveBeenCalled();
    h.deps.poseOf.mockReturnValue(null);
    const waits = vi.fn();
    const shown = h.stage.showCharacter("gate", new Blob(["x"]), waits, ANN);
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
  // Why this matters: the figure fades with its station while the story
  // panel and audio play on, and stepping back shows it again - so the
  // figure must leave the scene on leaving, come back on return without a
  // second decode, and never appear while its station's content is not
  // shown.
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
      lookPainters: fakeCharacterPainters().painters,
      now: () => clock.ms,
      fadeMs: FADE,
    });
    const show = () =>
      stage.showCharacter("gate", new Blob(["png"]), undefined, ANN);
    return { clock, scene, stage, decodeTexture, show };
  }

  it("fades out when its station stops showing, leaves the scene, and fades back in on return without decoding again", async () => {
    const h = following();
    await h.show();
    const look = lastLook();
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
    h.stage.follow((id) => id !== "gate");
    h.clock.ms += FADE / 2;
    h.stage.follow((id) => id !== "gate");
    expect(look.presence).toBeCloseTo(0.5, 6);
    h.clock.ms += FADE / 2;
    h.stage.follow((id) => id !== "gate");
    expect(h.scene.children).toHaveLength(0);
    expect(look.presence).toBe(0);
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
    h.clock.ms += FADE;
    h.stage.follow(() => true);
    expect(look.presence).toBe(1);
    expect(h.decodeTexture).toHaveBeenCalledTimes(1);
  });

  // Why: the page calls `follow` on every tick; a figure standing at its
  // settled presence must not have it rewritten each time.
  it("writes no presence while the figure stands settled", async () => {
    const h = following();
    await h.show();
    const look = lastLook();
    h.stage.follow(() => true);
    const before = look.writes;
    for (let i = 0; i < 5; i += 1) {
      h.clock.ms += 16;
      h.stage.follow(() => true);
    }
    expect(look.writes).toBe(before);
    // A fade still writes.
    h.clock.ms += FADE / 2;
    h.stage.follow(() => false);
    h.clock.ms += FADE / 4;
    h.stage.follow(() => false);
    expect(look.writes).toBeGreaterThan(before);
  });

  it("a figure decoded while its station is not shown waits off the scene", async () => {
    const h = following();
    h.stage.follow(() => false);
    await h.show();
    expect(h.scene.children).toHaveLength(0);
    expect(lastLook().presence).toBe(0);
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(1);
  });

  it("clear frees a figure that is off the scene", async () => {
    const h = following();
    await h.show();
    const look = lastLook();
    h.stage.follow(() => false);
    h.clock.ms += FADE;
    h.stage.follow(() => false);
    expect(h.scene.children).toHaveLength(0);
    expect(look.disposed).toBe(false);
    h.stage.clear();
    expect(look.disposed).toBe(true);
    expect(h.scene.children).toHaveLength(0);
  });
});

describe("a character in a story view stands as a character look", () => {
  // Why these tests matter: a look turns itself against the camera every
  // frame and fades by its own presence; a holder turned by faceVisitor or
  // a material opacity cached by the plain fade would fight it, and a look
  // that never ticks would stand frozen with its bubble closed.
  // Why: a die-cut figure paints for hundreds of milliseconds on the main
  // thread, measured on one return, and each visitor's return repainted it.
  // Stages share what was painted, by the file, so he comes back at once
  // with no second decode; each look still owns its textures.
  describe("a figure painted before", () => {
    function remembering() {
      const decodes = vi.fn(() => Promise.resolve(textureOf(100, 200)));
      const { painters } = fakeCharacterPainters();
      const paints = vi.spyOn(painters, "figure");
      const sheets = vi.spyOn(painters, "frames");
      const figures = createFigureMemo();
      const stage = () =>
        createSceneStage({
          getScene: () => new Group(),
          poseOf: () => ({
            positionNue: [0, 400, 0] as [number, number, number],
            rotationNue: [0, 0, 0, 1] as [number, number, number, number],
          }),
          decodeTexture: decodes,
          lookPainters: painters,
          figures,
        });
      return { decodes, paints, sheets, stage };
    }
    const look = { view: "speak", name: "Ann", line: "Hello." } as const;

    it("is neither decoded nor painted again, on any stage", async () => {
      const { decodes, paints, stage } = remembering();
      const image = new Blob(["ann"]);
      const first = stage();
      await first.showCharacter("s", image, undefined, look);
      first.clear();
      await first.showCharacter("s", image, undefined, look);
      await stage().showCharacter("s", image, undefined, look);
      expect(decodes).toHaveBeenCalledTimes(1);
      expect(paints).toHaveBeenCalledTimes(1);
    });

    it("keeps files and sheets apart", async () => {
      const { paints, sheets, stage } = remembering();
      const image = new Blob(["ann"]);
      await stage().showCharacter("s", image, undefined, look);
      await stage().showCharacter("s", new Blob(["bob"]), undefined, look);
      await stage().showCharacter("s", image, undefined, {
        ...look,
        sheet: true,
      });
      expect(paints).toHaveBeenCalledTimes(2);
      expect(sheets).toHaveBeenCalledTimes(1);
    });

    // Why: two figures of one file can stand at once, and the second's
    // decode must not paint what the first just painted.
    it("two stages asking at once paint once", async () => {
      const { paints, stage } = remembering();
      const image = new Blob(["ann"]);
      await Promise.all([
        stage().showCharacter("s", image, undefined, look),
        stage().showCharacter("s", image, undefined, look),
      ]);
      expect(paints).toHaveBeenCalledTimes(1);
    });

    it("a figure gone before its decode lands paints nothing", async () => {
      const { paints, stage } = remembering();
      const one = stage();
      const shown = one.showCharacter("s", new Blob(["a"]), undefined, look);
      one.clear();
      await shown;
      expect(paints).not.toHaveBeenCalled();
    });
  });

  function looking(cameraAt: [number, number, number] | null = [0, 401.6, 5]) {
    const clock = { ms: 1000 };
    const scene = new Group();
    const frames = new Set<() => void>();
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    if (cameraAt !== null) {
      camera.position.set(...cameraAt);
      camera.lookAt(0, 401.2, 0);
    }
    const { painters, painted } = fakeCharacterPainters();
    const beckonOf = vi.fn(() => ({ dx: 30, dz: 0, title: "East road" }));
    const stage = createSceneStage({
      getScene: () => scene,
      poseOf: () => ({
        positionNue: [0, 400, 0] as [number, number, number],
        rotationNue: [0, 0, 0, 1] as [number, number, number, number],
      }),
      decodeTexture: () => Promise.resolve(textureOf(100, 200)),
      now: () => clock.ms,
      fadeMs: 400,
      registerFrame: (fn) => {
        frames.add(fn);
        return () => frames.delete(fn);
      },
      getCamera: () => (cameraAt === null ? null : camera),
      beckonOf,
      lookPainters: painters,
    });
    const frame = (ms: number) => {
      clock.ms += ms;
      for (const fn of [...frames]) fn();
    };
    const look = {
      view: "two-stations",
      name: "Wendel",
      line: "Hello.",
    } as const;
    return {
      clock,
      scene,
      stage,
      frames,
      frame,
      camera,
      beckonOf,
      look,
      painted,
    };
  }

  const bubbleOf = (scene: Group) =>
    scene
      .getObjectByName("station-character")
      ?.children.find((c) => c.renderOrder === 20);

  it("stands at the station, opens to the camera at once and keeps ticking each frame", async () => {
    const h = looking();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, h.look);
    const holder = h.scene.children[0]!;
    expect(holder.position.toArray()).toEqual([0, 400, 0]);
    expect(bubbleOf(h.scene)?.visible).toBe(true);
    expect(h.frames.size).toBe(1);
    h.stage.faceVisitor([20, 401.6, 0]);
    expect(holder.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    h.camera.position.set(0, 401.6, 30);
    h.camera.lookAt(0, 401.2, 0);
    for (let i = 0; i < 20; i++) h.frame(50);
    expect(bubbleOf(h.scene)?.visible).toBe(false);
  });

  // Why this test matters: a declared character's frames sheet reaches the
  // stage as one image, and only the look knows to slice it into poses.
  it("has the look slice a frames sheet, and a plain figure not", async () => {
    const sheet = looking();
    await sheet.stage.showCharacter("gate", new Blob(["png"]), undefined, {
      ...sheet.look,
      sheet: true,
    });
    expect(sheet.painted.sheets).toHaveLength(1);
    const plain = looking();
    await plain.stage.showCharacter(
      "gate",
      new Blob(["png"]),
      undefined,
      plain.look,
    );
    expect(plain.painted.sheets).toHaveLength(0);
  });

  it("follows the voice set before the figure stood, and beckons once spoken", async () => {
    const h = looking();
    h.stage.setVoice("spoken");
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, h.look);
    h.frame(16);
    expect(h.beckonOf).toHaveBeenCalledWith("gate");
  });

  it("fades by the look's presence and leaves the scene, and clear stops its frames", async () => {
    const h = looking();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, h.look);
    h.stage.follow(() => false);
    h.clock.ms += 500;
    h.stage.follow(() => false);
    expect(h.scene.children).toHaveLength(0);
    h.stage.clear();
    expect(h.frames.size).toBe(0);
  });

  // Why this test matters: the creator places him with the block's pose
  // in the station's frame - where he stands and which way he faces - and
  // the pop-up stage keeps that facing, while a flat figure faces the
  // visitor fully. A figure standing on the station's centre, or a pop-up
  // ignoring the creator's facing, would ignore the pose.
  it("stands at the block's pose in the station's frame; the figure faces the visitor, the pop-up rests at its facing", async () => {
    const h = looking([2, 401.6, -30]);
    const s45 = Math.SQRT1_2;
    const turned = createSceneStage({
      getScene: () => h.scene,
      // The station turned 90 degrees about Up: its +Z (east) now north.
      poseOf: () => ({
        positionNue: [0, 400, 0] as [number, number, number],
        rotationNue: [0, s45, 0, s45] as [number, number, number, number],
      }),
      decodeTexture: () => Promise.resolve(textureOf(100, 200)),
      getCamera: () => h.camera,
      lookPainters: fakeCharacterPainters().painters,
    });
    await turned.showCharacter("gate", new Blob(["png"]), undefined, {
      ...h.look,
      view: "speak",
      pose: { position: [0, 0, 2], rotation: [0, 0, 0, 1] },
    });
    const holder = h.scene.children[0]!;
    // 2 m along the station's +Z, which points north.
    expect(holder.position.x).toBeCloseTo(2, 9);
    expect(holder.position.y).toBeCloseTo(400, 9);
    expect(holder.position.z).toBeCloseTo(0, 9);
    expect(holder.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    // He rests facing north (pi/2); the camera is due west of him (-z, a
    // turn of pi), and a flat figure faces it fully.
    const look = h.scene.getObjectByName("station-character") ?? null;
    expect(look).not.toBeNull();
    const turn = look!.children[0]!;
    expect(Math.cos(turn.rotation.y - Math.PI)).toBeCloseTo(1, 9);
    // The pop-up stage keeps the creator's facing, north.
    await turned.showCharacter("gate-popup", new Blob(["png"]), undefined, {
      ...h.look,
      view: "popup",
      pose: { position: [0, 0, 2], rotation: [0, 0, 0, 1] },
    });
    const popupLooks = h.scene.children
      .map((c) => c.getObjectByName("station-character"))
      .filter((o) => o !== undefined);
    const popupTurn = popupLooks[popupLooks.length - 1]!.children[0]!;
    expect(popupTurn.rotation.y).toBeCloseTo(Math.PI / 2, 9);
  });

  // Why this test matters: after his step he stays in the world (the plan:
  // a story view stays, as world blocks do), idle, beckoning in two
  // stations; he goes once his station is left and does not come back.
  it("keeps a released look standing, beckoning, until its station is left, and never brings it back", async () => {
    const h = looking();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, h.look);
    h.stage.follow(() => true);
    h.beckonOf.mockClear();
    h.stage.release();
    expect(h.scene.children).toHaveLength(1);
    expect(h.frames.size).toBeGreaterThan(0);
    h.frame(16);
    expect(h.beckonOf).toHaveBeenCalledWith("gate");
    expect(h.stage.characterTapTargets()).not.toEqual([]);
    h.stage.follow(() => false);
    h.clock.ms += 500;
    h.stage.follow(() => false);
    expect(h.scene.children).toHaveLength(0);
    expect(h.stage.characterTapTargets()).toEqual([]);
    h.stage.follow(() => true);
    h.clock.ms += 500;
    h.stage.follow(() => true);
    expect(h.scene.children).toHaveLength(0);
    expect(h.frames.size).toBe(0);
  });

  // Why this test matters: a tap on him after his story plays his voice
  // again (the prototype's tap works whenever he stands), so the voice
  // that tap sets must reach the released look: the portrait's ring
  // pulses while he speaks.
  it("lets a voice reach a released look, so a tap after the story animates him", async () => {
    const h = looking();
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, {
      ...h.look,
      view: "portrait",
    });
    h.stage.follow(() => true);
    h.stage.release();
    const ring = (): boolean => {
      let on = false;
      h.scene.traverse((o) => {
        if (
          o instanceof Mesh &&
          o.geometry instanceof RingGeometry &&
          o.visible
        ) {
          on = true;
        }
      });
      return on;
    };
    h.frame(16);
    expect(ring()).toBe(false);
    h.stage.setVoice("speaking");
    h.frame(16);
    expect(ring()).toBe(true);
  });

  it("releases a look still waiting by clearing it", async () => {
    const h = looking();
    const parked = createSceneStage({
      getScene: () => h.scene,
      poseOf: () => null,
      decodeTexture: () => Promise.resolve(textureOf(100, 200)),
      lookPainters: fakeCharacterPainters().painters,
    });
    const shown = parked.showCharacter(
      "gate",
      new Blob(["png"]),
      undefined,
      h.look,
    );
    await new Promise((r) => setTimeout(r, 0));
    parked.release();
    await shown;
    expect(h.scene.children).toHaveLength(0);
  });

  // Why this test matters: the visitor's tap is cast against what he
  // draws, so the stage names his visible parts only while he stands in
  // the scene - a shut bubble is no target (three's raycaster does not
  // skip hidden meshes); the bubble view's tap shuts his bubble.
  it("names the look's visible parts for a tap only while it stands, and shuts the bubble view's bubble", async () => {
    const h = looking();
    const names = () => h.stage.characterTapTargets().map((o) => o.name);
    expect(names()).toEqual([]);
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, {
      ...h.look,
      view: "bubble",
    });
    expect(names()).toContain("character-bubble");
    expect(names()).toContain("character-front");
    expect(bubbleOf(h.scene)?.visible).toBe(true);
    h.stage.toggleBubble();
    for (let i = 0; i < 20; i++) h.frame(50);
    expect(bubbleOf(h.scene)?.visible).toBe(false);
    expect(names()).not.toContain("character-bubble");
    expect(names()).toContain("character-front");
    h.stage.clear();
    expect(names()).toEqual([]);
  });

  it("stands still, with no error, while there is no camera", async () => {
    const h = looking(null);
    await h.stage.showCharacter("gate", new Blob(["png"]), undefined, h.look);
    expect(() => h.frame(16)).not.toThrow();
    expect(h.scene.children).toHaveLength(1);
  });
});

describe("a look's figure", () => {
  // Why this test matters: the decoder flips a bitmap for WebGL, and a look
  // draws that bitmap on a canvas, where the flip stays: every character of
  // a real tour stood on his head while the check page, which hands the look
  // a plain image, looked right.
  it.each([
    { flipY: false, flips: 1 },
    { flipY: true, flips: 0 },
  ])(
    "turns a figure decoded for WebGL upright (flipY $flipY)",
    async ({ flipY, flips }) => {
      const { painters, painted } = fakeCharacterPainters();
      const texture = textureOf(100, 200);
      texture.flipY = flipY;
      const stage = createSceneStage({
        getScene: () => new Group(),
        poseOf: () => ({
          positionNue: [0, 0, 0],
          rotationNue: [0, 0, 0, 1],
        }),
        decodeTexture: () => Promise.resolve(texture),
        lookPainters: painters,
      });
      await stage.showCharacter("gate", new Blob(["png"]), undefined, {
        view: "speak",
        name: "Wendel",
        line: "Hello.",
      });
      expect(painted.flips).toBe(flips);
    },
  );
});
