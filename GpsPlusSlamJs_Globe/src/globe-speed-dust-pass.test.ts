/**
 * The speed dust's drawing pass, moved out of the globe lab so the Tour
 * Viewer's editor draws the same streaks.
 *
 * Why this file matters: the pure model (`globe-speed-dust.ts`) is tested
 * on its own; these tests pin what the pass adds around it, under Node with
 * a recording fake renderer: a camera that flies fast and high shows
 * streaks, a stopped or low one shows none, `on: false` draws nothing, a
 * `reset` forgets the speed (a placed view is a teleport, not a speed), the
 * draw happens only while shown and at a positive weight, the panel's
 * knobs fall back to their defaults when a pasted link crosses them (no
 * throw every frame), the count knob draws a prefix of the field, the
 * dust camera takes the view's orientation, and `sample` projects only
 * visible streaks on screen. The pixels are the lab's
 * `globe-dust.smoke.spec.mjs` and the editor's start e2e.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GLOBE_SPEED_DUST } from "./globe-speed-dust.js";
import {
  SPEED_DUST_COLORS,
  SPEED_DUST_LOOK,
  SPEED_DUST_MAX_COUNT,
  createSpeedDustPass,
  type SpeedDustFrame,
} from "./globe-speed-dust-pass.js";

const R = 6_378_137;

/** The uniforms of the streaks' material in a drawn dust scene. */
function uniformsOf(scene: THREE.Scene): Record<string, THREE.IUniform> {
  const mesh = scene.children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  return mesh.material.uniforms;
}

/** A renderer that records its draws (with the weight and the streaks'
 *  size at each) and has a 800 x 400 buffer at pixel ratio 2. */
function fakeRenderer() {
  const draws: {
    camera: THREE.Camera;
    weight: number;
    widthPx: number;
    size: [number, number];
  }[] = [];
  const renderer = {
    getDrawingBufferSize: (target: THREE.Vector2) => target.set(800, 400),
    getPixelRatio: () => 2,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      const u = uniformsOf(scene);
      const size = u.uViewport?.value as THREE.Vector2;
      draws.push({
        camera,
        weight: u.uWeight?.value as number,
        widthPx: u.uWidthPx?.value as number,
        size: [size.x, size.y],
      });
    },
  };
  return { renderer, draws };
}

/** The camera `altitudeM` over the equator at longitude 0, looking down. */
function poseAt(altitudeM: number) {
  const position = new THREE.Vector3(R + altitudeM, 0, 0);
  // Looking toward the centre (-x): the camera's -z on -x.
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
  );
  return { position, quaternion };
}

type Frame = Omit<SpeedDustFrame, "renderer">;

/** One frame's input: the camera at `altitudeM`, at `nowMs`. */
function frameAt(
  nowMs: number,
  altitudeM: number,
  extra: Partial<Frame> = {},
): Frame {
  const { position, quaternion } = poseAt(altitudeM);
  return {
    nowMs,
    position,
    quaternion,
    altitudeM,
    fovDeg: 50,
    aspect: 2,
    on: true,
    exposureMs: SPEED_DUST_LOOK.exposureMs,
    widthPx: SPEED_DUST_LOOK.widthPx,
    ...extra,
  };
}

/**
 * Flies the pass down from `fromM` at `mps` for `frames` frames at 60 Hz
 * (straight toward the centre), returning the time of the last.
 */
function dive(
  pass: ReturnType<typeof createSpeedDustPass>,
  renderer: ReturnType<typeof fakeRenderer>["renderer"],
  {
    fromM = 20_000_000,
    mps = 3_000_000,
    frames = 30,
    extra = {},
  }: {
    fromM?: number;
    mps?: number;
    frames?: number;
    extra?: Partial<Frame>;
  } = {},
): number {
  let t = 0;
  for (let i = 0; i < frames; i++) {
    t = i * (1000 / 60);
    pass.update({
      ...frameAt(t, fromM - (mps * t) / 1000, extra),
      renderer,
    });
  }
  return t;
}

describe("createSpeedDustPass", () => {
  // Why: the whole point of the pass - a camera rushing at the Earth from
  // far out shows streaks, at the model's opacity, pointing along its
  // motion (toward the centre here).
  it("shows streaks for a fast, high camera", () => {
    const { renderer } = fakeRenderer();
    const pass = createSpeedDustPass();
    dive(pass, renderer);
    const s = pass.state();
    expect(s.shown).toBe(true);
    expect(s.opacity).toBeGreaterThan(0.5);
    expect(s.speedMps).toBeGreaterThan(1_000_000);
    expect(s.share).toBeGreaterThan(0.5);
    expect(s.direction[0]).toBeCloseTo(-1, 6);
    expect(s.count).toBe(SPEED_DUST_LOOK.count);
  });

  // Why: a stopped camera, one below the model's floor, or the switch off
  // must draw nothing - the editor turns the dust off by a link knob, and a
  // landed camera must not keep streaks.
  it("shows nothing when stopped, low or off", () => {
    const { renderer } = fakeRenderer();
    const still = createSpeedDustPass();
    dive(still, renderer, { mps: 0 });
    expect(still.state().shown).toBe(false);
    const low = createSpeedDustPass();
    dive(low, renderer, { fromM: 100_000, mps: 1_000 });
    expect(low.state().shown).toBe(false);
    const off = createSpeedDustPass();
    dive(off, renderer, { extra: { on: false } });
    expect(off.state().shown).toBe(false);
    expect(off.state().opacity).toBe(0);
    // The speed is still measured while off: turning it on mid-flight
    // shows the streaks at once.
    expect(off.state().speedMps).toBeGreaterThan(1_000_000);
  });

  // Why: a placed view is a teleport; after `reset` the next sample starts
  // a new velocity at 0 instead of the old flight's speed.
  it("forgets the speed on reset", () => {
    const { renderer } = fakeRenderer();
    const pass = createSpeedDustPass();
    const t = dive(pass, renderer);
    pass.reset();
    pass.update({ ...frameAt(t + 16, 15_000_000), renderer });
    expect(pass.state().speedMps).toBe(0);
    expect(pass.state().shown).toBe(false);
  });

  // Why: the lab and the editor draw the streaks twice a frame (behind the
  // Earth at 1 - over, over it at over); a hidden pass or a zero weight
  // must cost no draw at all, and the dust camera must carry the view's
  // orientation, lens and aspect at the origin (the field lives in ECEF
  // axes around the camera).
  it("draws only while shown and at a positive weight, with the view's lens", () => {
    const fake = fakeRenderer();
    const pass = createSpeedDustPass();
    pass.render(fake.renderer, 1);
    expect(fake.draws).toHaveLength(0);
    dive(pass, fake.renderer);
    pass.render(fake.renderer, 0);
    pass.render(fake.renderer, Number.NaN);
    expect(fake.draws).toHaveLength(0);
    pass.render(fake.renderer, 0.75);
    expect(fake.draws).toHaveLength(1);
    const camera = fake.draws[0]?.camera as THREE.PerspectiveCamera;
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(camera.position.length()).toBe(0);
    expect(camera.fov).toBe(50);
    expect(camera.aspect).toBe(2);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(look.x).toBeCloseTo(-1, 6);
  });

  // Why: the weight reaches the shader as its uniform for each draw; a
  // pass that kept the first weight would draw the over-Earth share at
  // the behind-Earth weight. The streaks are sized in drawing-buffer
  // pixels: a pass that ignored the pixel ratio would draw half-width
  // streaks on a phone.
  it("sets each draw's weight and sizes the streaks in buffer pixels", () => {
    const fake = fakeRenderer();
    const pass = createSpeedDustPass();
    dive(pass, fake.renderer);
    pass.render(fake.renderer, 0.75);
    pass.render(fake.renderer, 0.25);
    expect(fake.draws.map((d) => d.weight)).toEqual([0.75, 0.25]);
    expect(fake.draws[0]?.widthPx).toBe(SPEED_DUST_LOOK.widthPx * 2);
    expect(fake.draws[0]?.size).toEqual([800, 400]);
  });

  // Why: the panel's knobs come from a pasted link; crossed ranges or
  // values out of range fall back to the defaults instead of throwing on
  // every frame (the lab's F1b/D1b review).
  it("falls back to the defaults for knobs that are not a rising pair or in range", () => {
    const { renderer } = fakeRenderer();
    const pass = createSpeedDustPass();
    dive(pass, renderer, {
      extra: {
        look: {
          loMps: 5_000,
          hiMps: 1_000,
          driftMin: 3,
          driftMax: -1,
          gain: -2,
          farShare: 2,
          color: 7,
          count: 1e9,
        },
      },
    });
    const s = pass.state();
    expect([s.loMps, s.hiMps]).toEqual([
      GLOBE_SPEED_DUST.loMps,
      GLOBE_SPEED_DUST.hiMps,
    ]);
    expect([s.driftMin, s.driftMax]).toEqual([
      GLOBE_SPEED_DUST.driftMin,
      GLOBE_SPEED_DUST.driftMax,
    ]);
    expect(s.gain).toBe(SPEED_DUST_LOOK.gain);
    expect(s.farShare).toBe(GLOBE_SPEED_DUST.farShare);
    expect(s.color).toBe(0);
    expect(s.count).toBe(SPEED_DUST_MAX_COUNT);
    expect(SPEED_DUST_COLORS[s.color]).toBeDefined();
  });

  // Why: the count is a live knob; it draws a prefix of one field, so a
  // smaller count is the same streaks, fewer.
  it("draws a prefix of the field for the count knob", () => {
    const { renderer } = fakeRenderer();
    const many = createSpeedDustPass();
    const few = createSpeedDustPass();
    dive(many, renderer, { extra: { look: { count: 400 } } });
    dive(few, renderer, { extra: { look: { count: 100 } } });
    expect(many.state().count).toBe(400);
    expect(few.state().count).toBe(100);
    const a = many.sample(1_000).streaks;
    const b = few.sample(1_000).streaks;
    expect(b.length).toBeGreaterThan(0);
    expect(b.length).toBeLessThan(a.length);
    expect(a.slice(0, 3)).toEqual(b.slice(0, 3));
  });

  // Why: the smokes and the editor's checks read the streaks on screen;
  // every sampled streak lies on the screen, and the focus of expansion
  // of a dive straight down the view is the screen's centre.
  it("samples visible streaks on screen and the focus of expansion", () => {
    const { renderer } = fakeRenderer();
    const pass = createSpeedDustPass();
    dive(pass, renderer);
    const { streaks, focus } = pass.sample(50);
    expect(streaks.length).toBeGreaterThan(0);
    expect(streaks.length).toBeLessThanOrEqual(50);
    for (const s of streaks) {
      expect(s.head[0]).toBeGreaterThanOrEqual(0);
      expect(s.head[0]).toBeLessThanOrEqual(1);
      expect(s.head[1]).toBeGreaterThanOrEqual(0);
      expect(s.head[1]).toBeLessThanOrEqual(1);
      expect(s.alpha).toBeGreaterThan(0.05);
    }
    expect(focus?.[0]).toBeCloseTo(0.5, 6);
    expect(focus?.[1]).toBeCloseTo(0.5, 6);
  });

  // Why: the owner's pick of four A/B looks (DEC-R3-17) is the one look
  // both the lab and the editor draw; it must sit inside the pass's own
  // limits.
  it("keeps the shared look inside the pass's limits", () => {
    expect(SPEED_DUST_LOOK.count).toBeLessThanOrEqual(SPEED_DUST_MAX_COUNT);
    expect(SPEED_DUST_LOOK.over).toBeGreaterThanOrEqual(0);
    expect(SPEED_DUST_LOOK.over).toBeLessThanOrEqual(1);
    expect(SPEED_DUST_LOOK.gain).toBeGreaterThan(0);
  });

  // Why: with no gain given the pass must draw the shared look's gain (the
  // one look both pages draw), not a flat 1; a count that is not a number
  // (a pasted link) must fall back to the look's count, never reach the
  // geometry as an instance count of NaN.
  it("takes the shared look's gain and count when the knobs are absent or not numbers", () => {
    const { renderer } = fakeRenderer();
    const plain = createSpeedDustPass();
    dive(plain, renderer, { extra: { look: {} } });
    expect(plain.state().gain).toBe(SPEED_DUST_LOOK.gain);
    expect(plain.state().count).toBe(SPEED_DUST_LOOK.count);
    for (const count of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const odd = createSpeedDustPass();
      dive(odd, renderer, { extra: { look: { count, gain: Number.NaN } } });
      expect(odd.state().count).toBe(SPEED_DUST_LOOK.count);
      expect(odd.state().gain).toBe(SPEED_DUST_LOOK.gain);
    }
  });

  // Why: the pass runs every frame at 2,500 streaks on a phone. It must
  // write the streaks into its own attribute arrays (no typed array made
  // per frame: garbage at that rate shows as collector pauses) and step in
  // well under a frame. The budget is generous (Node, a loaded machine):
  // measured 0.14-0.20 ms a frame (2026-11-03) against 8 ms, 40x and more;
  // it catches an order-of-magnitude slip, not a phone's frame time.
  it("steps 2,500 streaks without making a typed array, in well under a frame", () => {
    const { renderer } = fakeRenderer();
    const pass = createSpeedDustPass();
    dive(pass, renderer, { frames: 5 });
    const Real = Float32Array;
    let made = 0;
    const Counting = new Proxy(Real, {
      construct(target, args: unknown[]) {
        made++;
        return Reflect.construct(target, args) as object;
      },
    });
    const frames = 120;
    /** Steps the frames with the counting constructor in place (ms). */
    const stepFrames = (): number => {
      globalThis.Float32Array = Counting;
      try {
        const t0 = performance.now();
        for (let i = 5; i < 5 + frames; i++) {
          const t = i * (1000 / 60);
          pass.update({
            ...frameAt(t, 20_000_000 - 3_000_000 * (t / 1000)),
            renderer,
          });
        }
        return performance.now() - t0;
      } finally {
        globalThis.Float32Array = Real;
      }
    };
    const elapsedMs = stepFrames();
    expect(pass.state().shown).toBe(true);
    expect(pass.state().count).toBe(2500);
    expect(made).toBe(0);
    expect(elapsedMs / frames).toBeLessThan(8);
  });

  // Why: an empty dispose would pass "does not throw"; the pass must free
  // its geometry and its material (each fires its dispose event once).
  it("frees its geometry and material on dispose, safe twice", () => {
    const scenes: THREE.Scene[] = [];
    const fake = fakeRenderer();
    const renderer = {
      ...fake.renderer,
      render(scene: THREE.Scene, camera: THREE.Camera) {
        scenes.push(scene);
        fake.renderer.render(scene, camera);
      },
    };
    const pass = createSpeedDustPass(10);
    dive(pass, renderer);
    pass.render(renderer, 1);
    const mesh = scenes[0]?.children[0] as THREE.Mesh;
    let geometries = 0;
    let materials = 0;
    mesh.geometry.addEventListener("dispose", () => geometries++);
    (mesh.material as THREE.Material).addEventListener(
      "dispose",
      () => materials++,
    );
    pass.dispose();
    expect([geometries, materials]).toEqual([1, 1]);
    expect(() => {
      pass.dispose();
    }).not.toThrow();
  });
});
