import { describe, expect, it, vi } from "vitest";
import {
  Vector3,
  type Color,
  type DirectionalLight,
  type PerspectiveCamera,
  type Scene,
} from "three";
import type { QualityTier } from "../capability";
import { getPalette } from "./palette";
import {
  createSceneController,
  type ComposerLike,
  type RendererLike,
} from "./scene-controller";

// Why this test matters: the controller is the only stateful glue between
// scroll input, the anime.js timeline, and the WebGL renderer. Its
// contracts — render-on-demand (no busy re-render), smoothing that
// converges, reduced-motion end-state seeks, theme application, and a null
// return when WebGL fails (the static-dom floor) — are all invisible in
// unit tests of the parts, so they are pinned here against a fake renderer.

const TIER: QualityTier = {
  mode: "scroll",
  dprCap: 2,
  shadows: true,
  geometryDetail: "low",
  postprocessing: false,
};

function makeFakeRenderer() {
  const renderer: RendererLike & { renders: number } = {
    renders: 0,
    shadowMap: { enabled: false },
    domElement: {} as HTMLCanvasElement,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(function (this: void) {
      renderer.renders++;
    }),
    dispose: vi.fn(),
  };
  return renderer;
}

function makeController(tier: QualityTier = TIER) {
  const renderer = makeFakeRenderer();
  const appended: unknown[] = [];
  const controller = createSceneController({
    container: {
      clientWidth: 1200,
      clientHeight: 800,
      appendChild: (el: unknown) => {
        appended.push(el);
      },
    },
    tier,
    initialTheme: "dark",
    createRenderer: () => renderer,
  });
  return { controller, renderer, appended };
}

describe("createSceneController", () => {
  it("reports a lost WebGL context so the caller can engage the static floor", () => {
    // Mobile GPUs (and CI under pressure) genuinely lose contexts; the
    // page must degrade to the DOM floor instead of freezing mid-story.
    const listeners = new Map<string, (event: unknown) => void>();
    const renderer = {
      ...makeFakeRenderer(),
      domElement: {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          listeners.set(type, handler);
        },
      } as unknown as HTMLCanvasElement,
    };
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const controller = createSceneController({
      container: { clientWidth: 800, clientHeight: 600, appendChild: () => {} },
      tier: TIER,
      initialTheme: "dark",
      createRenderer: () => renderer,
      onContextLost,
      onContextRestored,
    });
    expect(controller).not.toBeNull();
    listeners.get("webglcontextlost")?.({ preventDefault: () => {} });
    expect(onContextLost).toHaveBeenCalledOnce();
    // The browser may restore the context (preventDefault allows it, and
    // three.js re-uploads its resources) — the floor lifts again.
    listeners.get("webglcontextrestored")?.({});
    expect(onContextRestored).toHaveBeenCalledOnce();
  });

  it("returns null when renderer creation throws (static-dom floor)", () => {
    const controller = createSceneController({
      container: { clientWidth: 800, clientHeight: 600, appendChild: () => {} },
      tier: TIER,
      initialTheme: "dark",
      createRenderer: () => {
        throw new Error("no WebGL");
      },
    });
    expect(controller).toBeNull();
  });

  it("clickAt opens the geocache when aimed at it, misses do nothing (egg §2/№1)", () => {
    const { controller } = makeController();
    expect(controller).not.toBeNull();
    const chest = controller!.stage.world.getObjectByName("geocache-chest");
    expect(chest).toBeDefined();
    // Aim straight DOWN at the chest: the castle vignette shares the disc,
    // so a shallow angle would graze it — top-down isolates the chest.
    const chestPos = chest!.getWorldPosition(new Vector3());
    // Camera JUST above the chest looking straight down: any taller
    // castle tower sharing the column sits above/behind the camera, so
    // only the chest (nearest) is on the downward ray.
    const aimAtChest = () => {
      controller!.stage.camera.position.copy(
        chestPos.clone().add(new Vector3(0, 1.35, 0.001)),
      );
      controller!.stage.camera.lookAt(chestPos);
    };
    // A miss: aim at empty sky, nothing registered along the ray.
    controller!.stage.camera.position.copy(
      chestPos.clone().add(new Vector3(0, 3, 0)),
    );
    controller!.stage.camera.lookAt(
      chestPos.clone().add(new Vector3(0, 40, 0)),
    );
    expect(controller!.clickAt({ x: 0, y: 0 })).toBeNull();

    aimAtChest();
    const hit = controller!.clickAt({ x: 0, y: 0 });
    expect(hit).toEqual({ egg: "geocache", opened: true });
    // The tick loop animates the lid open (wall-clock transition).
    controller!.tick(0);
    controller!.tick(400);
    const lid = chest!.getObjectByName("geocache-lid");
    expect(lid!.rotation.x).toBeLessThan(-1.5);
    // Second aimed click closes it again.
    aimAtChest();
    expect(controller!.clickAt({ x: 0, y: 0 })).toEqual({
      egg: "geocache",
      opened: false,
    });
  });

  it("clickAt triggers the castle ghost-restore when aimed at it (egg §2/№3)", () => {
    const { controller } = makeController();
    const castle = controller!.stage.world.getObjectByName("vignette-castle");
    expect(castle).toBeDefined();
    const ghostMat = () => {
      let mat: { opacity: number } | undefined;
      castle!.getObjectByName("castle-ghost")?.traverse((obj) => {
        const m = obj as { isMesh?: boolean; material?: { opacity: number } };
        if (m.isMesh && m.material) {
          mat ??= m.material;
        }
      });
      return mat!;
    };
    const built = ghostMat().opacity;

    const castlePos = castle!.getWorldPosition(new Vector3());
    controller!.stage.camera.position.copy(
      castlePos.clone().add(new Vector3(0, 3, 14)),
    );
    controller!.stage.camera.lookAt(
      castlePos.clone().add(new Vector3(0, 2.5, 0)),
    );
    const hit = controller!.clickAt({ x: 0, y: 0 });
    expect(hit).toEqual({ egg: "ghost-restore" });
    // Mid-effect the ghost has solidified above its built opacity…
    controller!.tick(0);
    controller!.tick(400);
    expect(ghostMat().opacity).toBeGreaterThan(built + 0.2);
    // …and after the full cycle it melts back to the built value.
    controller!.tick(10_000);
    expect(ghostMat().opacity).toBeCloseTo(built, 5);
  });

  it("clickAt makes the dot-person hop and lands it back on the ground (egg §2/№2)", () => {
    const { controller } = makeController();
    const person = controller!.stage.person;
    // Put the walk somewhere on the ground and place the person there.
    controller!.stage.walk.t = 0.5;
    controller!.tick(0);
    const groundY = person.position.y;

    // Aim straight down at the person and click.
    const personPos = person.getWorldPosition(new Vector3());
    controller!.stage.camera.position.copy(
      personPos.clone().add(new Vector3(0, 4, 0.001)),
    );
    controller!.stage.camera.lookAt(personPos);
    expect(controller!.clickAt({ x: 0, y: 0 })).toEqual({ egg: "parkour" });

    // Mid-hop: airborne, clearly above the ground.
    controller!.tick(250);
    expect(person.position.y).toBeGreaterThan(groundY + 0.4);
    // After the hop: back on the ground (offset fully cleared).
    controller!.tick(1200);
    expect(person.position.y).toBeCloseTo(groundY, 5);
  });

  it("clickAt returns the bird egg when aimed at the hidden bird (egg §2/№10)", () => {
    const { controller } = makeController();
    const bird = controller!.stage.world.getObjectByName("hidden-bird");
    expect(bird).toBeDefined();
    const birdPos = bird!.getWorldPosition(new Vector3());
    // Straight down at the bird atop the sign; nothing taller shares the
    // column above it.
    controller!.stage.camera.position.copy(
      birdPos.clone().add(new Vector3(0, 2, 0.001)),
    );
    controller!.stage.camera.lookAt(birdPos);
    expect(controller!.clickAt({ x: 0, y: 0 })).toEqual({ egg: "bird" });
  });

  it("applies a small gyro rotation to the phone only while it's flown in (egg §2/№8)", () => {
    const { controller } = makeController();
    const phone = controller!.stage.phone;
    // Phone hidden away from the dive → gyro is ignored.
    phone.scale.setScalar(0.001);
    controller!.setGyroOrientation({ beta: 120, gamma: 40 });
    controller!.tick(0);
    expect(phone.rotation.y).toBe(0);

    // Phone flown in (dive) → the reading nudges it, but only slightly.
    phone.scale.setScalar(1);
    controller!.tick(16);
    expect(phone.rotation.y).not.toBe(0);
    expect(Math.abs(phone.rotation.y)).toBeLessThanOrEqual(0.12);
    expect(Math.abs(phone.rotation.x)).toBeLessThanOrEqual(0.12);
  });

  it("renders on demand only once away from the hero (battery)", () => {
    // The hero has an ambient drift (below), so render-on-demand is
    // asserted at a mid-story progress where the scene is truly idle.
    const { controller, renderer } = makeController();
    expect(controller).not.toBeNull();
    controller?.setTargetProgress(0.5);
    for (let i = 1; i <= 400; i++) {
      controller?.tick(i * 16);
    }
    const settledRenders = renderer.renders;
    expect(settledRenders).toBeGreaterThan(0);
    // Converged and away from the hero: further ticks must not re-render.
    controller?.tick(401 * 16);
    controller?.tick(402 * 16);
    expect(renderer.renders).toBe(settledRenders);
  });

  it("drifts the camera gently at the hero while idle (background life)", () => {
    // Round-1 feedback: a frozen hero reads as buggy — something should
    // move in the background until the visitor scrolls.
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const posA = camera.position.clone();
    for (let t = 100; t <= 4000; t += 100) {
      controller?.tick(t);
    }
    const drift = camera.position.distanceTo(posA);
    expect(drift).toBeGreaterThan(0.01);
    expect(drift).toBeLessThan(3); // gentle sway, not a fly-away
  });

  it("suppresses the ambient drift under reduced motion", () => {
    const { controller } = makeController({ ...TIER, mode: "reduced-motion" });
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const posA = camera.position.clone();
    for (let t = 100; t <= 4000; t += 100) {
      controller?.tick(t);
    }
    expect(camera.position.distanceTo(posA)).toBeLessThan(1e-6);
  });

  it("scroll progress smoothing converges on the target and moves the camera", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(16);
    const heroPos = camera.position.clone();

    controller?.setTargetProgress(0.99);
    for (let i = 1; i <= 200; i++) {
      controller?.tick(16 + i * 16);
    }
    // Converged near the CTA framing — far from the hero framing.
    expect(camera.position.distanceTo(heroPos)).toBeGreaterThan(5);
  });

  it("showChapterEndState seeks a chapter's end composition in one call", () => {
    const { controller, renderer } = makeController({
      ...TIER,
      mode: "reduced-motion",
    });
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(16);
    const before = camera.position.clone();
    controller?.showChapterEndState(4); // anywhere: high pull-back framing
    controller?.tick(32);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(10);
    expect(renderer.renders).toBeGreaterThan(1);
  });

  it("applyTheme moves the sun to the palette's light position, default when absent (golden-hour restyle)", () => {
    // Dusk's low-left sun is what produces the long golden-hour shadows;
    // every palette without an explicit position must return the light
    // to the shared default — a sticky dusk position would relight all
    // other themes from the wrong side after one visit to dusk.
    const { controller } = makeController();
    const scene = controller?.stage.camera.parent as Scene;
    const light = scene.children.find(
      (child) => (child as DirectionalLight).isDirectionalLight,
    ) as DirectionalLight;
    expect(light).toBeDefined();
    expect(light.position.toArray()).toEqual([18, 30, 14]); // default

    controller?.applyTheme("dusk");
    const dusk = getPalette("dusk").directional.position;
    expect(dusk).toBeDefined();
    expect(light.position.toArray()).toEqual([dusk!.x, dusk!.y, dusk!.z]);
    expect(dusk!.x).toBeLessThan(0); // low sun from the LEFT
    expect(dusk!.y).toBeLessThan(20); // low over the horizon

    controller?.applyTheme("light");
    expect(light.position.toArray()).toEqual([18, 30, 14]); // restored
  });

  it("applyTheme swaps the scene background and triggers a re-render", () => {
    const { controller, renderer } = makeController();
    controller?.tick(16);
    const scene = controller?.stage.camera.parent as Scene;
    const darkBackground = (scene.background as Color).getHex();
    const rendersBefore = renderer.renders;

    controller?.applyTheme("light");
    controller?.tick(32);
    expect((scene.background as Color).getHex()).not.toBe(darkBackground);
    expect(renderer.renders).toBeGreaterThan(rendersBefore);
  });

  it("plays the intro to completion via ticks and lands on the hero framing", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const heroPos = camera.position.clone();

    controller?.playIntro();
    controller?.tick(100); // intro started: camera pulled far away
    expect(camera.position.distanceTo(heroPos)).toBeGreaterThan(5);
    for (let t = 200; t <= 2300; t += 100) {
      controller?.tick(t);
    }
    // Intro over: on the hero framing (the ambient drift ramps in from
    // zero, so right after completion the offset is still ~0 — seamless).
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
    // Later the gentle sway plays, but stays bounded around the framing.
    for (let t = 2400; t <= 6000; t += 100) {
      controller?.tick(t);
    }
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(2);
  });

  it("skipIntro jumps straight to the hero framing (first scroll during intro)", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const heroPos = camera.position.clone();
    controller?.playIntro();
    controller?.tick(100);
    controller?.skipIntro();
    controller?.tick(116);
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
  });

  // Why these tests matter (v3 F2): the ambient particles moved the page
  // from strict render-on-demand to CONTINUOUS rendering — acceptable
  // only because it is gated by tab visibility and tier. If the gates
  // leak, hidden tabs and weak/reduced-motion devices burn GPU forever.
  it("renders continuously on the high scroll tier (particles), stopping while the tab is hidden", () => {
    const { controller, renderer } = makeController({
      ...TIER,
      geometryDetail: "high",
    });
    controller?.setTargetProgress(0.5);
    for (let i = 1; i <= 400; i++) {
      controller?.tick(i * 16);
    }
    const settled = renderer.renders;
    controller?.tick(401 * 16);
    controller?.tick(402 * 16);
    // Unlike the low tier, idle ticks KEEP rendering (particles move).
    expect(renderer.renders).toBeGreaterThan(settled);

    controller?.setPageVisible(false);
    const hiddenAt = renderer.renders;
    controller?.tick(403 * 16);
    controller?.tick(404 * 16);
    expect(renderer.renders).toBe(hiddenAt);

    controller?.setPageVisible(true);
    controller?.tick(405 * 16);
    expect(renderer.renders).toBeGreaterThan(hiddenAt);
  });

  it("builds no particles under reduced motion — idle ticks stay render-free", () => {
    const { controller, renderer } = makeController({
      ...TIER,
      geometryDetail: "high",
      mode: "reduced-motion",
    });
    controller?.showChapterEndState(2);
    controller?.tick(16);
    const settled = renderer.renders;
    controller?.tick(32);
    controller?.tick(48);
    expect(renderer.renders).toBe(settled);
  });

  // Why these composer tests matter (v3 F1): bloom runs through an
  // EffectComposer that REPLACES the plain render call on the high tier.
  // If the gate leaks, weak devices pay for bloom; if disposal on context
  // loss is missed, the restore path renders through dead GPU resources.
  function makeComposerFixture(tier: QualityTier) {
    const composer = {
      render: vi.fn<(deltaTimeSeconds?: number) => void>(),
      setSize: vi.fn<(width: number, height: number) => void>(),
      dispose: vi.fn<() => void>(),
    } satisfies ComposerLike;
    const createComposer = vi.fn(() => composer);
    const listeners = new Map<string, (event: unknown) => void>();
    // Built inline (NOT spread from makeFakeRenderer): the spread would
    // detach the render() closure from this object's `renders` counter.
    const renderer: RendererLike & { renders: number } = {
      renders: 0,
      shadowMap: { enabled: false },
      domElement: {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          listeners.set(type, handler);
        },
      } as unknown as HTMLCanvasElement,
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(function (this: void) {
        renderer.renders++;
      }),
      dispose: vi.fn(),
    };
    const controller = createSceneController({
      container: { clientWidth: 800, clientHeight: 600, appendChild: () => {} },
      tier,
      initialTheme: "dark",
      createRenderer: () => renderer,
      createComposer,
    });
    return { controller, renderer, composer, createComposer, listeners };
  }

  it("renders through the composer on the postprocessing tier, plain renderer otherwise", () => {
    const on = makeComposerFixture({ ...TIER, postprocessing: true });
    on.controller?.tick(16);
    expect(on.composer.render).toHaveBeenCalled();
    expect(on.renderer.renders).toBe(0);

    const off = makeComposerFixture({ ...TIER, postprocessing: false });
    off.controller?.tick(16);
    expect(off.createComposer).not.toHaveBeenCalled();
    expect(off.renderer.renders).toBeGreaterThan(0);
  });

  it("disposes the composer on context loss, falls back to plain rendering, and rebuilds on restore", () => {
    const { controller, renderer, composer, createComposer, listeners } =
      makeComposerFixture({ ...TIER, postprocessing: true });
    controller?.tick(16);
    expect(composer.render).toHaveBeenCalled();

    listeners.get("webglcontextlost")?.({ preventDefault: () => {} });
    expect(composer.dispose).toHaveBeenCalledOnce();
    const composerRenders = composer.render.mock.calls.length;
    controller?.setTargetProgress(0.4);
    controller?.tick(32);
    // Composer gone: the plain renderer carries the frame.
    expect(composer.render.mock.calls.length).toBe(composerRenders);
    expect(renderer.renders).toBeGreaterThan(0);

    listeners.get("webglcontextrestored")?.({});
    expect(createComposer).toHaveBeenCalledTimes(2);
  });

  it("forwards resizes to the composer so bloom buffers match the canvas", () => {
    const { controller, composer } = makeComposerFixture({
      ...TIER,
      postprocessing: true,
    });
    controller?.handleResize(1024, 512);
    expect(composer.setSize).toHaveBeenLastCalledWith(1024, 512);
  });

  it("applies the tier's DPR cap and shadow setting to the renderer", () => {
    const { renderer } = makeController({
      ...TIER,
      shadows: false,
      dprCap: 1.5,
    });
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it("resize updates renderer size and camera aspect", () => {
    const { controller, renderer } = makeController();
    controller?.handleResize(600, 900);
    expect(renderer.setSize).toHaveBeenLastCalledWith(600, 900, false);
    const camera = controller?.stage.camera as PerspectiveCamera;
    expect(camera.aspect).toBeCloseTo(600 / 900, 5);
  });
});
