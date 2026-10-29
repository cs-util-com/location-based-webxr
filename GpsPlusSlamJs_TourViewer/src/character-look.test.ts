import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createCharacterLook } from "./character-look";
import type { StageCharacterView } from "./character-views";
import { fakeCharacterPainters } from "./test-support/fake-character-painters";

function setup(view: StageCharacterView) {
  const { painters, painted } = fakeCharacterPainters();
  const look = createCharacterLook({
    view,
    name: "Wendel",
    line: "Good day, traveller.",
    figure: { width: 100, height: 200 } as unknown as HTMLCanvasElement,
    painters,
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
  it("turns to face the camera wherever it stands", () => {
    const { look, standAt, tick } = setup("bubble");
    standAt(0, 5);
    tick(0, true);
    expect(look.state().turn).toBeCloseTo(0, 5);
    standAt(5, 0);
    tick(0, true);
    expect(look.state().turn).toBeCloseTo(Math.PI / 2, 5);
  });

  // Why this test matters: the beckon rule - two-stations only, once he
  // was heard, near him - shown as the prototype shows it: gold chevrons
  // on the ground running toward the next station, the footer naming it.
  // He keeps facing the visitor: a flat cut-out turned away reads as a
  // squashed card (seen side by side with the prototype).
  it("beckons in two-stations once heard: chevrons toward the next station, the footer naming it, still facing the visitor", () => {
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
    expect(look.state().arrow).toBeCloseTo(0.85, 5);
    expect(look.state().footer).toBe("Next: East road");
    expect(painted.bubbles).toContain("Next: East road");
    // The chevrons lie on the ground, ahead of him toward the next
    // station (30 m north), not toward the visitor.
    const arrow = look.parts.arrow;
    expect(arrow.visible).toBe(true);
    look.root.updateWorldMatrix(true, true);
    const at = new Vector3();
    arrow.getWorldPosition(at);
    expect(at.x).toBeGreaterThan(2);
    expect(Math.abs(at.z)).toBeLessThan(1e-6);
    expect(at.y).toBeLessThan(0.05);
    standAt(0, 20);
    tick(0, true);
    expect(look.state().beckoning).toBe(false);
    expect(look.state().arrow).toBe(0);
    expect(arrow.visible).toBe(false);
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
  it("unfolds the pop-up near, keeps its facing, and draws no standing figure", () => {
    const { look, standAt, tick } = setup("popup");
    standAt(0, 10);
    tick(0, true);
    expect(look.state().unfold).toBe(1);
    expect(look.parts.popup.visible).toBe(true);
    expect(look.parts.scroll.visible).toBe(true);
    expect(look.parts.figure.visible).toBe(false);
    const facing = look.state().turn;
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
