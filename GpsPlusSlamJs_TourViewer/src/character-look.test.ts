import {
  Box3,
  Mesh,
  type MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { createCharacterLook } from "./character-look";
import type { StageCharacterView } from "./character-views";
import { fakeCharacterPainters } from "./test-support/fake-character-painters";

function setup(
  view: StageCharacterView,
  extra: { restYaw?: number; voiced?: boolean; sheet?: boolean } = {},
) {
  const { painters, painted } = fakeCharacterPainters();
  const look = createCharacterLook({
    view,
    name: "Wendel",
    line: "Good day, traveller.",
    figure: { width: 100, height: 200 } as unknown as HTMLCanvasElement,
    painters,
    ...extra,
  });
  const camera = new PerspectiveCamera(50, 1, 0.05, 600);
  /** The camera at eye height, `north` and `east` metres from him, looking
   *  at his chest. */
  const standAt = (north: number, east: number) => {
    camera.position.set(north, 1.6, east);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld();
  };
  let now = 1000;
  const tick = (ms = 0, snap = false) => {
    now += ms;
    look.update({ nowMs: now, camera, snap });
  };
  return { look, camera, standAt, tick, painted };
}

describe("createCharacterLook: the bubble and the name tag", () => {
  // Why this test matters: the prototype's rule - the bubble near (within
  // 9 m), the name tag farther - is what a visitor sees first.
  it("opens the bubble near and shows the name tag far", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 5);
    tick(0, true);
    expect(look.state()).toMatchObject({ bubble: 1, pip: 0 });
    expect(look.parts.bubble.visible).toBe(true);
    standAt(0, 20);
    tick(0, true);
    expect(look.state()).toMatchObject({ bubble: 0, pip: 1 });
    expect(look.parts.bubble.visible).toBe(false);
    expect(look.parts.pip.visible).toBe(true);
  });

  it("opens at the prototype's rate, not at once", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 20);
    tick(0, true);
    standAt(0, 5);
    tick(100);
    expect(look.state().bubble).toBeCloseTo(0.26, 5);
  });

  // Why this test matters: the bubble hangs by its tail's tip beside his
  // head, above it, facing the camera - never over his face or the ground.
  it("hangs above his head beside it, facing the camera", () => {
    const { look, camera, standAt, tick } = setup("bubble");
    standAt(0, 4);
    tick(0, true);
    const bubble = look.parts.bubble;
    expect(look.state().side).toBe("right");
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(bubble.position.dot(right)).toBeGreaterThan(0);
    expect(bubble.position.y).toBeGreaterThan(1.7 * 0.86);
    expect(bubble.quaternion.angleTo(camera.quaternion)).toBeCloseTo(0, 5);
  });

  // Why this test matters: the reading floor keeps the text as large on
  // the screen at 8 m as at 2.4 m, so the bubble grows with the distance.
  it("grows with the distance beyond 2.4 m", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 2);
    tick(0, true);
    const nearW = look.parts.bubble.scale.x;
    standAt(0, 8);
    tick(0, true);
    expect(look.parts.bubble.scale.x / nearW).toBeGreaterThan(2.5);
  });

  it("hides everything while the station is faded out", () => {
    const { look, standAt, tick } = setup("bubble");
    look.setPresence(0);
    standAt(0, 5);
    tick(0, true);
    expect(look.parts.figure.visible).toBe(false);
    expect(look.parts.bubble.visible).toBe(false);
    expect(look.parts.pip.visible).toBe(false);
  });
});

describe("createCharacterLook: facing and the beckon", () => {
  // Why this test matters: the prototype rests him at the creator's
  // facing and turns him toward the visitor by at most 60 degrees, so a
  // visitor walking round him sees him from the side and behind, not a
  // card spinning to follow them.
  it("turns from the creator's facing toward the camera, by at most 60 degrees", () => {
    const cap = Math.PI / 3;
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 5);
    tick(0, true);
    expect(look.state().turn).toBeCloseTo(0, 5);
    standAt(5, 0);
    tick(0, true);
    expect(look.state().turn).toBeCloseTo(cap, 5);
    standAt(0, -5);
    tick(0, true);
    expect(Math.abs(look.state().turn)).toBeCloseTo(cap, 5);
    // Facing north (the creator's rotation): a camera east is 90 degrees
    // off, so he turns 60 toward it.
    const north = setup("speak", { restYaw: Math.PI / 2 });
    north.standAt(0, 5);
    north.tick(0, true);
    expect(north.look.state().turn).toBeCloseTo(Math.PI / 2 - cap, 5);
    north.standAt(5, 0);
    north.tick(0, true);
    expect(north.look.state().turn).toBeCloseTo(Math.PI / 2, 5);
  });

  // Why this test matters: the ground arrows are the creator's own blocks
  // (the owner's verdict), so the beckon is his frame and the footer
  // naming the next station - nothing drawn on the ground.
  it("beckons in two-stations once heard: the footer naming the next station, no arrow on the ground, still facing the visitor", () => {
    const { look, standAt, tick, painted } = setup("two-stations");
    look.setBeckon({ dx: 30, dz: 0, title: "East road" });
    standAt(0, 5);
    tick(0, true);
    look.setVoice("speaking");
    tick(16);
    expect(look.state().beckoning).toBe(false);
    expect(look.state().footer).toBe("Speaking");
    look.setVoice("spoken");
    tick(0, true);
    expect(look.state().beckoning).toBe(true);
    expect(look.state().turn).toBeCloseTo(0, 5);
    expect(look.state().footer).toBe("Next: East road");
    expect(painted.bubbles).toContain("Next: East road");
    expect(look.state()).not.toHaveProperty("arrow");
    expect(look.parts).not.toHaveProperty("arrow");
    expect(look.root.getObjectByName("character-arrow")).toBeUndefined();
    // No mesh he draws reaches out along the ground: the widest is his
    // shadow (under 1 m), not a plane running toward the next station.
    look.root.updateWorldMatrix(true, true);
    const size = new Vector3();
    look.root.traverse((o) => {
      let drawn = (o as { isMesh?: boolean }).isMesh === true;
      o.traverseAncestors((up) => {
        if (!up.visible) drawn = false;
      });
      if (!drawn || !o.visible) return;
      if (o.name === "character-bubble" || o.name === "character-pip") return;
      new Box3().setFromObject(o).getSize(size);
      expect(Math.max(size.x, size.z), o.name).toBeLessThan(2);
    });
    standAt(0, 20);
    tick(0, true);
    expect(look.state().beckoning).toBe(false);
  });

  // Why this test matters: the beckon waits for him to have been heard,
  // and the story's next step sets his voice back to idle - he must still
  // beckon then (the prototype's `spoken` stays with him).
  it("keeps beckoning once heard, when the voice goes idle again", () => {
    const { look, standAt, tick } = setup("two-stations");
    look.setBeckon({ dx: 30, dz: 0, title: "East road" });
    standAt(0, 5);
    look.setVoice("spoken");
    tick(16);
    look.setVoice("idle");
    tick(16);
    expect(look.state().beckoning).toBe(true);
  });

  it("beckons after six seconds open even when the line has no voice", () => {
    const { look, standAt, tick } = setup("two-stations");
    look.setBeckon({ dx: 30, dz: 0, title: "East road" });
    standAt(0, 5);
    tick(0, true);
    for (let i = 0; i < 59; i++) tick(100);
    expect(look.state().beckoning).toBe(false);
    tick(100);
    tick(100);
    expect(look.state().beckoning).toBe(true);
  });

  it("never beckons in the other views, nor with no next station", () => {
    const bubble = setup("bubble");
    bubble.look.setBeckon({ dx: 30, dz: 0, title: "East road" });
    bubble.look.setVoice("spoken");
    bubble.standAt(0, 5);
    bubble.tick(0, true);
    expect(bubble.look.state().beckoning).toBe(false);
    const two = setup("two-stations");
    two.look.setBeckon(null);
    two.look.setVoice("spoken");
    two.standAt(0, 5);
    two.tick(0, true);
    expect(two.look.state().beckoning).toBe(false);
  });
});

describe("createCharacterLook: the portrait and the pop-up", () => {
  it("pulses the ring at his feet only while the voice plays (portrait)", () => {
    const { look, standAt, tick } = setup("portrait");
    standAt(0, 5);
    tick(0, true);
    const ring = look.root.children.find(
      (c) => c.type === "Mesh" && c.position.y === 0.02,
    );
    expect(ring?.visible).toBe(false);
    expect(look.state().bubble).toBe(0);
    look.setVoice("speaking");
    tick(16);
    expect(ring?.visible).toBe(true);
  });

  // Why this test matters: the pop-up unfolds within 12 m, stays until
  // 16 m, shows the line on its scroll and no standing figure, and keeps
  // the facing it had when it unfolded.
  it("unfolds the pop-up near, keeps the creator's facing, and draws no standing figure", () => {
    const { look, standAt, tick } = setup("popup", { restYaw: 0.4 });
    standAt(0, 10);
    tick(0, true);
    expect(look.state().unfold).toBe(1);
    expect(look.parts.popup.visible).toBe(true);
    expect(look.parts.scroll.visible).toBe(true);
    expect(look.parts.figure.visible).toBe(false);
    const facing = look.state().turn;
    expect(facing).toBeCloseTo(0.4, 12);
    standAt(10, 0);
    tick(0, true);
    expect(look.state().turn).toBe(facing);
    standAt(0, 15);
    tick(0, true);
    expect(look.state().unfold).toBe(1);
    standAt(0, 17);
    tick(0, true);
    expect(look.state().unfold).toBe(0);
  });

  it("lets go of what it drew", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 5);
    tick(0, true);
    look.dispose();
    expect(() => tick(16)).not.toThrow();
  });
});

describe("createCharacterLook: the bubble stays on the screen", () => {
  // Why this test matters: on a phone held upright the screen is narrow,
  // and the prototype's estimate of the bubble's width left out the gap
  // between his head and the tail's tip, so its bubble ran off the right
  // edge at 390x844 (seen side by side). A bubble that fits the screen is
  // slid back wholly onto it, for every place of his head across the
  // screen (swept), on either side.
  it("keeps every corner of a bubble that fits inside the screen", () => {
    // A bubble as wide as the real one (`BUBBLE.maxW`, a long line).
    const { painters } = fakeCharacterPainters();
    const look = createCharacterLook({
      view: "bubble",
      name: "Wendel",
      line: "Good day, traveller! My keep stood behind that broken wall.",
      figure: { width: 100, height: 200 } as unknown as HTMLCanvasElement,
      heightM: 1.85,
      painters: {
        ...painters,
        bubble: (c) => ({
          image: { width: 1024, height: 420 } as unknown as HTMLCanvasElement,
          w: 1024,
          h: 420,
          tipX: c.side === "right" ? 30 : 1024 - 30,
        }),
      },
    });
    const camera = new PerspectiveCamera(50, 1, 0.05, 600);
    const tick = (): void => look.update({ nowMs: 1000, camera, snap: true });
    camera.aspect = 390 / 844;
    camera.fov = 72.3;
    camera.updateProjectionMatrix();
    const corner = new Vector3();
    for (let east = -1.6; east <= 1.6001; east += 0.2) {
      camera.position.set(0.3, 1.6, 4.8);
      camera.lookAt(0.3, 1.4, east);
      camera.updateMatrixWorld();
      tick();
      const bubble = look.parts.bubble;
      expect(bubble.visible).toBe(true);
      bubble.updateWorldMatrix(true, false);
      let minX = Infinity;
      let maxX = -Infinity;
      for (const [x, y] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const) {
        corner.set(x, y, 0).applyMatrix4(bubble.matrixWorld).project(camera);
        minX = Math.min(minX, corner.x);
        maxX = Math.max(maxX, corner.x);
      }
      if (maxX - minX > 1.94) continue;
      expect(maxX, `east ${east.toFixed(1)}`).toBeLessThanOrEqual(0.9701);
      expect(minX, `east ${east.toFixed(1)}`).toBeGreaterThanOrEqual(-0.9701);
    }
  });
});

describe("createCharacterLook: the footer and the tap", () => {
  // Why this test matters: in the prototype his voice plays on a tap, and
  // the speak view's bubble says so ("Tap to hear him", then "Tap to hear
  // again"); a line with no voice offers no tap. The other views name no
  // tap in the bubble.
  it("asks for a tap in the speak view while he is not speaking, and only with a voice", () => {
    const { look, standAt, tick } = setup("speak", { voiced: true });
    standAt(0, 5);
    tick(0, true);
    expect(look.state().footer).toBe("Tap to hear him");
    look.setVoice("speaking");
    tick(16);
    expect(look.state().footer).toBe("Speaking");
    look.setVoice("spoken");
    tick(16);
    expect(look.state().footer).toBe("Tap to hear again");
    const mute = setup("speak", { voiced: false });
    mute.standAt(0, 5);
    mute.tick(0, true);
    expect(mute.look.state().footer).toBeNull();
    const two = setup("two-stations", { voiced: true });
    two.standAt(0, 5);
    two.tick(0, true);
    expect(two.look.state().footer).toBeNull();
    const bubble = setup("bubble", { voiced: true });
    bubble.standAt(0, 5);
    bubble.tick(0, true);
    expect(bubble.look.state().footer).toBeNull();
  });

  // Why this test matters: the pop-up's scroll names the tap on its stage
  // the same way.
  it("asks for a tap on the pop-up's scroll", () => {
    const { look, standAt, tick } = setup("popup", { voiced: true });
    standAt(0, 5);
    tick(0, true);
    expect(look.state().footer).toBe("Tap the stage to hear him");
    look.setVoice("spoken");
    tick(16);
    expect(look.state().footer).toBe("Tap the stage to hear him again");
  });

  // Why this test matters: the bubble view has no voice; a tap opens and
  // shuts its bubble, as in the prototype.
  it("shuts and opens the bubble on a tap in the bubble view", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 5);
    tick(0, true);
    expect(look.state().bubble).toBe(1);
    look.toggleBubble();
    tick(0, true);
    expect(look.state().bubble).toBe(0);
    expect(look.parts.bubble.visible).toBe(false);
    look.toggleBubble();
    tick(0, true);
    expect(look.state().bubble).toBe(1);
  });
});

/** The texture image a mesh shows now, and whether it is mirrored. */
function shown(mesh: Mesh): { image: unknown; mirrored: boolean } {
  const map = (mesh.material as MeshBasicMaterial).map;
  return { image: map?.image, mirrored: (map?.repeat.x ?? 1) < 0 };
}

// Why these tests matter: a character with a frames sheet (four poses:
// idle, mouth half open, mouth open, beckoning) talks and beckons as in the
// prototype - his mouth moves while a word sounds, the bubble reads along
// word by word, and in two stations he beckons with the arm toward the
// next station, mirrored when it lies to the left on the screen. Without
// a sheet he keeps his one pose.
describe("createCharacterLook: the frames sheet and the read-along", () => {
  it("slices the sheet into four frames and stands idle on the first", () => {
    const { look, standAt, tick, painted } = setup("speak", { sheet: true });
    standAt(0, 5);
    tick(0, true);
    expect(painted.sheets).toHaveLength(1);
    expect(look.state()).toMatchObject({
      frames: 4,
      frame: 0,
      mirrored: false,
    });
    expect(shown(look.parts.figure).image).toBe(painted.sheets[0]![0]!.front);
  });

  it("moves his mouth inside a word and reads the line along while he speaks", () => {
    const { look, standAt, tick, painted } = setup("speak", {
      sheet: true,
      voiced: true,
    });
    standAt(0, 5);
    tick(0, true);
    look.setVoice("speaking");
    tick(16);
    // Before the first word (260 ms): idle, every word still ahead.
    expect(look.state()).toMatchObject({ frame: 0, activeWord: -1 });
    tick(260);
    expect(look.state()).toMatchObject({ frame: 1, activeWord: 0 });
    expect(shown(look.parts.figure).image).toBe(painted.sheets[0]![1]!.front);
    tick(115);
    expect(look.state().frame).toBe(2);
    expect(painted.actives).toContain(0);
    look.setVoice("spoken");
    tick(16);
    expect(look.state()).toMatchObject({ frame: 0, activeWord: null });
    expect(painted.actives[painted.actives.length - 1]).toBeUndefined();
  });

  it("beckons with the beckon frame toward the next station, mirrored when it lies to the left", () => {
    const { look, standAt, tick, painted } = setup("two-stations", {
      sheet: true,
    });
    // The eye looks west at him from the east: north is to the right.
    standAt(0, 5);
    look.setBeckon({ dx: 10, dz: 0, title: "East road" });
    look.setVoice("spoken");
    tick(0, true);
    expect(look.state()).toMatchObject({
      beckoning: true,
      frame: 3,
      mirrored: false,
    });
    expect(shown(look.parts.figure)).toEqual({
      image: painted.sheets[0]![3]!.front,
      mirrored: false,
    });
    look.setBeckon({ dx: -10, dz: 0, title: "East road" });
    tick(16);
    expect(look.state()).toMatchObject({ frame: 3, mirrored: true });
    expect(shown(look.parts.figure).mirrored).toBe(true);
    // Seen from behind the silhouette is mirrored the other way.
    expect(
      (
        (look.parts.figure.parent!.children[1] as Mesh)
          .material as MeshBasicMaterial
      ).map?.repeat.x,
    ).toBe(1);
  });

  it("keeps his one pose without a sheet, and the bubble view's mouth still", () => {
    const plain = setup("two-stations", { voiced: true });
    plain.standAt(0, 5);
    plain.look.setBeckon({ dx: -10, dz: 0, title: "East road" });
    plain.look.setVoice("spoken");
    plain.tick(0, true);
    expect(plain.painted.sheets).toHaveLength(0);
    expect(plain.look.state()).toMatchObject({
      frames: 1,
      frame: 0,
      beckoning: true,
      mirrored: false,
    });
    plain.look.setVoice("speaking");
    plain.tick(400);
    expect(plain.look.state().frame).toBe(0);
    // The read-along needs no sheet.
    expect(plain.look.state().activeWord).toBe(0);
    const bubble = setup("bubble", { sheet: true });
    bubble.standAt(0, 5);
    bubble.tick(0, true);
    bubble.look.setVoice("speaking");
    bubble.tick(400);
    expect(bubble.look.state().frame).toBe(0);
  });

  it("moves the pop-up figure's mouth too", () => {
    const { look, standAt, tick, painted } = setup("popup", {
      sheet: true,
      voiced: true,
    });
    standAt(0, 5);
    tick(0, true);
    look.setVoice("speaking");
    tick(16);
    tick(260);
    let popFigure: Mesh | null = null;
    look.parts.popup.traverse((o) => {
      if (
        o instanceof Mesh &&
        painted.sheets[0]!.some(
          (f) => (o.material as MeshBasicMaterial).map?.image === f.front,
        )
      ) {
        popFigure = o;
      }
    });
    expect(popFigure).not.toBeNull();
    expect(shown(popFigure!).image).toBe(painted.sheets[0]![1]!.front);
  });
});
