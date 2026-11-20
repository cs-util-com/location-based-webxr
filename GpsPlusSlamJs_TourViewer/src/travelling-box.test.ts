import { beforeEach, describe, expect, it } from "vitest";
import type { Texture } from "three";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector4,
  type Camera,
  type ShaderMaterial,
  type WebGLRenderer,
} from "three";

import type {
  TravelLayout,
  TravelPress,
  TravelSurface,
} from "./travel-surface.js";
import {
  createTravellingBox,
  type TravelPointer,
  type TravellingBox,
} from "./travelling-box.js";
import {
  easeInOutCubic,
  flightClip,
  letterGate,
  quadOfClip,
  TRAVELLING_BOX_DEFAULTS,
  type TravelHideWhy,
} from "./travelling-box-rules.js";
import { CLOSING_TAP_GRACE_MS } from "./view-switch.js";

/**
 * The controller in node with a real camera and a fake surface: a plate
 * of the travel box's shape (272 x 108 CSS px, 16 px font, one em
 * 0.136 m) standing 1.5 m up at the origin, facing +z, seen from 1.6 m up
 * on a 390 x 844 view. One em is about 123 / d px there, so the plate is
 * readable to about 10 m and docks beyond (the threshold is 12 px).
 */
const VIEW = { left: 0, top: 0, width: 390, height: 844 };
const LAYOUT: TravelLayout = {
  cssW: 272,
  cssH: 108,
  fontPx: 16,
  lineHeightPx: 22,
  canvasW: 680,
  canvasH: 270,
};
const PLATE_W = (272 * 0.136) / 16;
const PLATE_H = (108 * 0.136) / 16;
const REST = { x: 59, y: 844 - 18 - 108, w: 272, h: 108 };
const FRAME_MS = 16;

interface FakeSurface extends TravelSurface {
  key: string;
  hide: TravelHideWhy | null;
  paints: number;
  layouts: number;
  pointer: boolean | null;
  presses: TravelPress[];
  ends: string[];
  down: boolean;
  onLayout: (() => void) | null;
  hung: Texture | null;
}

function fakeSurface(): FakeSurface {
  const plate = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ transparent: true }),
  );
  plate.scale.set(PLATE_W, PLATE_H, 1);
  plate.position.set(0, 1.5, 0);
  const s: FakeSurface = {
    id: "words:test",
    kind: "words",
    slot: "bottom",
    voiced: true,
    answersTo: () => "test",
    plate,
    key: "a",
    hide: null,
    paints: 0,
    layouts: 0,
    pointer: null,
    presses: [],
    ends: [],
    down: false,
    onLayout: null,
    hung: null,
    travelling: () => true,
    hideWhy: () => s.hide,
    canFold: () => false,
    gates: (m, k) => [letterGate(m, k)],
    layout() {
      s.layouts += 1;
      s.onLayout?.();
      return LAYOUT;
    },
    paintKey: () => s.key,
    paint() {
      s.paints += 1;
    },
    hang(texture) {
      s.hung = texture;
      plate.material.map = texture;
    },
    unhang() {
      s.hung = null;
    },
    restingRect: () => REST,
    setGhost: () => undefined,
    setPointer(on) {
      s.pointer = on;
    },
    beginPress(press) {
      if (s.down) return false;
      s.down = true;
      s.presses.push(press);
      return true;
    },
    movePress: () => undefined,
    endPress(kind) {
      s.down = false;
      s.ends.push(kind);
    },
    pressing: () => s.down,
  };
  return s;
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({}),
  } as unknown as HTMLCanvasElement;
}

/** A pointer target that records capture and forwards events. */
class Target extends EventTarget {
  captured: number[] = [];
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}

function pointer(
  type: string,
  x: number,
  y: number,
  id = 1,
): Event & TravelPointer {
  return Object.assign(new Event(type), {
    pointerId: id,
    clientX: x,
    clientY: y,
  });
}

let surface: FakeSurface;
let camera: PerspectiveCamera;
let scene: Scene;
let t: number;
let reduce: boolean;
let box: TravellingBox;

function standAt(d: number, yaw = 0): void {
  camera.position.set(0, 1.6, d);
  camera.rotation.set(0, yaw, 0, "YXZ");
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

/** Runs frames of 16 ms for `ms`, calling `each` after every frame. */
function run(ms: number, each?: () => void): void {
  for (let left = ms; left > 0; left -= FRAME_MS) {
    t += FRAME_MS;
    box.frame();
    each?.();
  }
}

/** Draws the quad for `cam` (what the render does), when it is shown. */
function render(cam: Camera = camera): void {
  const quad = scene.getObjectByName("travelling-box-quad") as Mesh;
  if (!quad.visible) return;
  quad.onBeforeRender(
    {} as WebGLRenderer,
    scene,
    cam,
    quad.geometry,
    quad.material as ShaderMaterial,
    new Group(),
  );
}

/** The plate's corners on screen for `cam`, TL TR BL BR clip order. */
function plateClip(cam: Camera): number[] {
  surface.plate.updateWorldMatrix(true, false);
  const out: number[] = [];
  for (const [x, y] of [
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ] as const) {
    const v = new Vector4(x, y, 0, 1)
      .applyMatrix4(surface.plate.matrixWorld)
      .applyMatrix4(cam.matrixWorldInverse)
      .applyMatrix4(cam.projectionMatrix);
    out.push(v.x, v.y, v.z, v.w);
  }
  return out;
}

function dockNdc(): number[] {
  const nx = (x: number) => (x / VIEW.width) * 2 - 1;
  const ny = (y: number) => 1 - (y / VIEW.height) * 2;
  const [x0, x1, y0, y1] = [REST.x, REST.x + REST.w, REST.y, REST.y + REST.h];
  return [nx(x0), ny(y0), nx(x1), ny(y0), nx(x0), ny(y1), nx(x1), ny(y1)];
}

beforeEach(() => {
  surface = fakeSurface();
  camera = new PerspectiveCamera(50, VIEW.width / VIEW.height, 0.05, 600);
  scene = new Scene();
  scene.add(surface.plate);
  t = 1000;
  reduce = false;
  standAt(3);
  box = createTravellingBox({
    surface,
    scene,
    camera,
    knobs: TRAVELLING_BOX_DEFAULTS,
    now: () => t,
    reduceMotion: () => reduce,
    viewRect: () => VIEW,
    createCanvas: fakeCanvas,
  });
});

describe("createTravellingBox", () => {
  // Why this test matters: the walk away is the feature: the words stay
  // on their plate while they are readable and go to the screen once
  // they are not, after the hold and a flight of the knob's length.
  it("shows the plate at 3 m and docks at 16 m after the hold", () => {
    box.frame();
    expect(box.state()).toMatchObject({ place: "plate", u: 0 });
    standAt(16);
    run(16 * 18);
    expect(box.state().place).toBe("plate");
    run(32);
    expect(box.state()).toMatchObject({ place: "dock", why: "too small" });
    expect(box.state().u).toBeLessThan(0.2);
    run(600);
    expect(box.state().u).toBe(1);
  });

  // Why: turning the phone away must not lose the words, and turning back
  // must bring them home onto the plate.
  it("docks when turned away and comes back when turned back", () => {
    box.frame();
    standAt(3, Math.PI);
    run(400);
    expect(box.state()).toMatchObject({ place: "dock", why: "out of view" });
    run(700);
    standAt(3, 0);
    run(400);
    expect(box.state().place).toBe("plate");
    run(700);
    expect(box.state().u).toBe(0);
  });

  // Why: the words under a finger must not fly away mid-drag; the place
  // and the flight wait for the release and the lock after it.
  it("freezes the place under a finger, then moves after the lock", () => {
    box.frame();
    // The words fade in over 0.3 s; a finger takes them once half there.
    run(320);
    const target = new Target();
    const c = box.state().plateQuad;
    if (c === null) throw new Error("no plate on screen");
    const cx = (c[0]![0] + c[2]![0]) / 2;
    const cy = (c[0]![1] + c[2]![1]) / 2;
    expect(box.pointerDown(pointer("pointerdown", cx, cy), target)).toBe(true);
    expect(target.captured).toEqual([1]);
    expect(surface.presses[0]?.linePx).toBeGreaterThan(40);
    standAt(16);
    run(1000);
    expect(box.state()).toMatchObject({ place: "plate", u: 0 });
    expect(box.ownsTap()).toBe(true);
    target.dispatchEvent(pointer("pointerup", cx, cy));
    expect(surface.ends).toEqual(["up"]);
    expect(box.ownsTap()).toBe(true);
    run(16 * 15);
    expect(box.state().place).toBe("plate");
    t += CLOSING_TAP_GRACE_MS;
    expect(box.ownsTap()).toBe(false);
    run(64);
    expect(box.state().place).toBe("dock");
  });

  // Why: a finger that catches the words mid-flight holds them there.
  it("freezes the flight under a finger", () => {
    box.frame();
    standAt(16);
    run(16 * 19 + 300);
    const u = box.state().u;
    expect(u).toBeGreaterThan(0.2);
    expect(u).toBeLessThan(0.8);
    surface.down = true;
    run(500);
    expect(box.state().u).toBe(u);
    surface.down = false;
    run(600);
    expect(box.state().u).toBe(1);
  });

  // Why: the flight leaves from where the plate was last seen on screen,
  // frozen there once the plate left the view, so the box never chases a
  // plate off the screen's edge.
  it("starts the flight from the last corners seen on screen", () => {
    box.frame();
    const seen = quadOfClip(plateClip(camera), VIEW.width, VIEW.height);
    standAt(3, Math.PI);
    run(16 * 19);
    run(16, () => undefined);
    expect(box.state().place).toBe("dock");
    render();
    const drawn = box.state().quad;
    if (seen === null || drawn === null) throw new Error("not drawn");
    const e = easeInOutCubic(box.state().u);
    expect(e).toBeLessThan(0.001);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(drawn[i]![0] - seen[i]![0])).toBeLessThan(1);
      expect(Math.abs(drawn[i]![1] - seen[i]![1])).toBeLessThan(1);
    }
  });

  // Why: the plate and the quad are the same texture in two places; both
  // shown at once doubles the words, neither loses them. The ghost takes
  // the fingers only once the quad sits exactly on it.
  it("shows the plate xor the quad, and the ghost's pointers only at u = 1", () => {
    const quad = scene.getObjectByName("travelling-box-quad") as Mesh;
    const check = (): void => {
      const s = box.state();
      expect(Number(surface.plate.visible) + Number(quad.visible)).toBe(
        s.presence > 0 ? 1 : 0,
      );
      expect(surface.plate.visible).toBe(s.presence > 0 && s.u === 0);
      expect(surface.pointer).toBe(s.u === 1 && s.presence > 0);
      expect((quad.material as ShaderMaterial).uniforms.map?.value).toBe(
        surface.hung,
      );
    };
    box.frame();
    check();
    for (const d of [7, 12, 16, 9, 3, 16]) {
      standAt(d);
      run(1200, check);
    }
    standAt(3, Math.PI);
    run(1200, check);
  });

  // Why: a paint is a canvas draw and a texture upload; it must happen
  // only when the words look different, and never while nobody sees them.
  it("repaints only on a key change, and never while hidden", () => {
    box.frame();
    expect(surface.paints).toBe(0);
    run(200);
    expect(surface.paints).toBe(1);
    run(200);
    expect(surface.paints).toBe(1);
    surface.key = "b";
    run(16);
    expect(surface.paints).toBe(2);
    surface.hide = "sheet open";
    run(16);
    expect(box.state()).toMatchObject({ place: "hidden", why: "sheet open" });
    run(400);
    expect(box.state().presence).toBe(0);
    const before = surface.paints;
    surface.key = "c";
    run(200);
    expect(surface.paints).toBe(before);
    surface.hide = null;
    run(16);
    expect(surface.paints).toBe(before + 1);
  });

  // Why: the page may call frame() on every store dispatch, many times in
  // one millisecond; those calls must add no hold time and no flight.
  it("adds nothing for a second frame in the same millisecond", () => {
    box.frame();
    standAt(16);
    run(16 * 18);
    for (let i = 0; i < 50; i++) box.frame();
    expect(box.state().place).toBe("plate");
    run(32);
    expect(box.state().place).toBe("dock");
    const u = box.state().u;
    for (let i = 0; i < 50; i++) box.frame();
    expect(box.state().u).toBe(u);
  });

  it("ignores a frame() called from inside a frame()", () => {
    // A later time, so only the re-entry guard can stop it.
    surface.onLayout = () => {
      t += FRAME_MS;
      box.frame();
    };
    box.frame();
    expect(surface.layouts).toBe(1);
  });

  // Why: the quad must sit where the render's camera (the XR eye's) sees
  // the plate, not where the frame's camera saw it a moment earlier.
  it("draws the corners for the render's camera, not the frame's", () => {
    box.frame();
    standAt(16);
    run(16 * 19 + 300);
    const other = new PerspectiveCamera(
      50,
      VIEW.width / VIEW.height,
      0.05,
      600,
    );
    other.position.set(0.4, 1.5, 15);
    other.updateMatrixWorld();
    render(other);
    const u = box.state().u;
    const want = quadOfClip(
      flightClip(plateClip(other), dockNdc(), easeInOutCubic(u), new Array(16)),
      VIEW.width,
      VIEW.height,
    );
    const drawn = box.state().quad;
    if (want === null || drawn === null) throw new Error("not drawn");
    for (let i = 0; i < 4; i++) {
      expect(drawn[i]![0]).toBeCloseTo(want[i]![0], 3);
      expect(drawn[i]![1]).toBeCloseTo(want[i]![1], 3);
    }
  });

  // Why: at the dock the ghost box takes the fingers itself; the page's
  // pointerdown must then not start a second press on it.
  it("takes no press at the dock and none off the words", () => {
    box.frame();
    const target = new Target();
    expect(box.pointerDown(pointer("pointerdown", 5, 5), target)).toBe(false);
    standAt(16);
    run(1200);
    expect(box.state().u).toBe(1);
    expect(
      box.pointerDown(pointer("pointerdown", 195, REST.y + 50), target),
    ).toBe(false);
    expect(surface.presses).toEqual([]);
  });

  // Why: with reduced motion the words jump, never fly.
  it("jumps with reduced motion", () => {
    reduce = true;
    box.frame();
    standAt(16);
    run(16 * 20);
    expect(box.state()).toMatchObject({ place: "dock", u: 1, presence: 1 });
  });

  // Why: the field log needs the place changes with their reasons and the
  // surface's id, and the phone budget reads the cost counters.
  it("logs each settled change and counts its frames", () => {
    const events: unknown[] = [];
    box.stop();
    box = createTravellingBox({
      surface,
      scene,
      camera,
      knobs: TRAVELLING_BOX_DEFAULTS,
      now: () => t,
      reduceMotion: () => reduce,
      viewRect: () => VIEW,
      createCanvas: fakeCanvas,
      onPlace: (e) => events.push(e),
    });
    box.frame();
    standAt(16);
    run(400);
    t += 60;
    box.frame();
    expect(events).toEqual([
      { at: 1000, surface: "words:test", place: "plate", why: "readable" },
      expect.objectContaining({
        surface: "words:test",
        place: "dock",
        why: "too small",
      }),
    ]);
    const cost = box.cost();
    expect(cost.frames).toBeGreaterThan(20);
    expect(cost.over33).toBe(1);
    expect(cost.over50).toBe(1);
    expect(cost.over100).toBe(0);
    expect(cost.paints).toBe(1);
  });

  it("takes its quad and texture away when stopped", () => {
    box.frame();
    box.stop();
    expect(scene.getObjectByName("travelling-box-quad")).toBeUndefined();
    expect(surface.hung).toBeNull();
    box.frame();
    expect(surface.layouts).toBe(1);
  });
});
