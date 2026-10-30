/**
 * The air for an app's globe view, over recording fakes of its drawers.
 *
 * Why this file matters: the view core draws only the sun's disc, the stars
 * and navy space, so an app that mounts the view without the air sees a
 * black sky at noon (the 3D editor on the globe did). This mount is how an
 * app gets the lab's blue sky with one call; these tests pin what it tells
 * the drawers and when: the ground sky over the space sky, the hand-over
 * at the lab's edges in the view's local frame, the globe's sun at the
 * eased exposure, the space pass with no veil of its own below the
 * hand-over (no scene depth here), the haze over the tiles the app names,
 * and every drawer freed once.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GLOBE_ATMOSPHERE } from "./globe-atmosphere-frame.js";
import type { GlobeAtmosphere } from "./globe-atmosphere.js";
import type { GlobeGroundSky } from "./globe-ground-sky.js";
import { GLOBE_SKY_HAND_OVER } from "./globe-sky-hand-over.js";
import { mountGlobeViewAir } from "./globe-view-air.js";

/** The frames the air hands its drawers (the drawers' own types). */
type SpaceFrame = Parameters<GlobeAtmosphere["render"]>[1];
type SkyFrame = Parameters<GlobeGroundSky["update"]>[0];
type Drawers = ReturnType<
  NonNullable<NonNullable<Parameters<typeof mountGlobeViewAir>[1]>["drawers"]>
>;

const RADII = new THREE.Vector3(6378137, 6378137, 6356752.314245);

/** A view whose camera stands `altitudeM` over the equator at 0 deg. */
const fakeView = (altitudeM: number, framed = true) => {
  const camera = new THREE.PerspectiveCamera();
  const sun = { position: new THREE.Vector3(1, 0, 0), intensity: 5 };
  return {
    renderer: {} as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera,
    globe: {
      sun,
      group: { matrixWorld: new THREE.Matrix4() },
      tiles: {
        group: { matrixWorld: new THREE.Matrix4().makeTranslation(1, 2, 3) },
        ellipsoid: { radius: RADII },
      },
      surfaceUniforms: { uSunEcef: { value: new THREE.Vector3(1, 0, 0) } },
    },
    ecefCamera: () => ({
      position: new THREE.Vector3(RADII.x + altitudeM, 0, 0),
    }),
    frameTarget: () => (framed ? { lat: 0, lng: 0 } : null),
  };
};

/** Recording fakes of the three drawers; the ground sky returns `hand`. */
const fakeDrawers = (hand = { weight: 1, exposure: 3.5 }) => {
  const log: string[] = [];
  const updates: SkyFrame[] = [];
  const renders: SpaceFrame[] = [];
  const looks: unknown[] = [];
  const patched: unknown[] = [];
  let stage = "idle";
  const drawers = {
    spacePass: {
      setLook(look: unknown) {
        looks.push(look);
      },
      render(_camera: THREE.Camera, frame: SpaceFrame) {
        log.push("space");
        renders.push(frame);
      },
      dispose() {
        log.push("dispose space");
      },
    },
    groundSky: {
      // Only what the air reads of the ground sky's atmosphere.
      atmosphere: {
        sharedUniforms: {},
        visibilityKm: 60,
      } as unknown as GlobeGroundSky["atmosphere"],
      update(frame: SkyFrame) {
        updates.push(frame);
        return hand;
      },
      state: () => ({ lastStage: stage }),
      render(camera: THREE.Camera) {
        log.push(`ground ${camera.type}`);
      },
      dispose() {
        log.push("dispose ground");
      },
    },
    haze: {
      patch(tiles: unknown) {
        patched.push(tiles);
      },
      sync() {
        log.push("haze sync");
      },
      setWeight(weight: number, scale: number) {
        log.push(`haze ${weight} x ${scale}`);
      },
      dispose() {
        log.push("dispose haze");
      },
    },
    // A fake: only what the air calls (a partial state, a bare atmosphere).
  } as unknown as Drawers;
  return {
    drawers,
    log,
    updates,
    renders,
    looks,
    patched,
    setStage(next: string) {
      stage = next;
    },
  };
};

describe("mountGlobeViewAir", () => {
  // Why: the blue sky is the ground sky's, drawn over the space sky with
  // the view's own camera; without this the sky at noon stays black.
  it("draws the ground sky with the view's camera after the sky pass", () => {
    const view = fakeView(2);
    const fakes = fakeDrawers();
    const air = mountGlobeViewAir(view, {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    air.step();
    air.afterSky();
    expect(fakes.log).toContain("ground PerspectiveCamera");
  });

  // Why: the hand-over is the lab's (the same edge, width and step), fed
  // from the view's camera height, and only in a local frame; the globe's
  // sun takes the eased exposure, from the view's own sun intensity above
  // the edge.
  it("steps the hand-over at the lab's edges and eases the globe's sun", () => {
    const view = fakeView(2);
    const fakes = fakeDrawers({ weight: 1, exposure: 3.5 });
    const air = mountGlobeViewAir(view, {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    air.step();
    const frame = fakes.updates[0];
    expect(frame?.framed).toBe(true);
    expect(frame?.edgeKm).toBe(GLOBE_SKY_HAND_OVER.edgeKm);
    expect(frame?.widthKm).toBe(GLOBE_SKY_HAND_OVER.widthKm);
    expect(frame?.stepPct).toBe(GLOBE_SKY_HAND_OVER.altitudeStepPct);
    expect(frame?.spaceExposure).toBe(5);
    expect(frame?.altitudeKm as number).toBeLessThan(1);
    expect(view.globe.sun.intensity).toBe(3.5);
    expect(air.state().weight).toBe(1);
    // A second frame still starts from the view's intensity, not the eased.
    air.step();
    expect(fakes.updates[1]?.spaceExposure).toBe(5);
    expect(fakes.updates.length).toBe(2);
  });

  // Why: with the world in ECEF "up" means nothing to a flat sky; the
  // ground sky is told so and stays out.
  it("tells the ground sky when the view has no local frame", () => {
    const fakes = fakeDrawers({ weight: 0, exposure: 5 });
    const air = mountGlobeViewAir(fakeView(2, false), {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    air.step();
    expect(fakes.updates[0]?.framed).toBe(false);
  });

  // Why: below the hand-over the space pass has no scene depth here, so its
  // veil over the ground would end at the ellipsoid, under the relief:
  // its ground share fades with its sky share, and at full weight it draws
  // nothing; above the edge it draws the halo in full.
  it("fades the space pass's sky and ground under the ground sky", () => {
    const low = fakeDrawers({ weight: 1, exposure: 3.5 });
    const view = fakeView(2);
    const air = mountGlobeViewAir(view, {
      coarsePointer: false,
      drawers: () => low.drawers,
    });
    air.step();
    air.afterScene();
    expect(low.renders[0]).toMatchObject({
      skyShare: 0,
      groundShare: 0,
      sceneDepth: null,
      sunEcef: view.globe.surfaceUniforms.uSunEcef.value,
      worldFromEcef: view.globe.tiles.group.matrixWorld,
    });
    const high = fakeDrawers({ weight: 0, exposure: 5 });
    const far = mountGlobeViewAir(fakeView(500_000), {
      coarsePointer: false,
      drawers: () => high.drawers,
    });
    far.step();
    far.afterScene();
    expect(high.renders[0]).toMatchObject({ skyShare: 1, groundShare: 1 });
  });

  // Why: the space pass's march is the expensive part; a touch screen gets
  // the lab's fewer samples.
  it("sets the space pass's look for the pointer, the lab's strength", () => {
    for (const [coarse, steps] of [
      [true, GLOBE_ATMOSPHERE.coarseSteps],
      [false, GLOBE_ATMOSPHERE.steps],
    ] as const) {
      const fakes = fakeDrawers();
      mountGlobeViewAir(fakeView(2), {
        coarsePointer: coarse,
        drawers: () => fakes.drawers,
      });
      expect(fakes.looks).toContainEqual({
        steps,
        strength: GLOBE_ATMOSPHERE.strength,
      });
    }
  });

  // Why: the haze covers only the tiles the app names, and follows the
  // ground sky's reads.
  it("hazes the named tiles and syncs after the ground sky's read", () => {
    const fakes = fakeDrawers({ weight: 1, exposure: 3.5 });
    const air = mountGlobeViewAir(fakeView(2), {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    const tiles = { addEventListener: () => undefined };
    air.haze(tiles);
    expect(fakes.patched).toEqual([tiles]);
    air.step();
    expect(fakes.log).not.toContain("haze sync");
    fakes.setStage("read");
    air.step();
    expect(fakes.log).toContain("haze sync");
    expect(fakes.log).toContain("haze 1 x 1");
  });

  // Why: the editor mounts and unmounts the view; every drawer is freed
  // once, and a frame after the dispose draws nothing.
  it("frees each drawer once and draws nothing afterwards", () => {
    const fakes = fakeDrawers();
    const air = mountGlobeViewAir(fakeView(2), {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    air.dispose();
    air.dispose();
    const freed = fakes.log.filter((l) => l.startsWith("dispose"));
    expect(freed.sort()).toEqual([
      "dispose ground",
      "dispose haze",
      "dispose space",
    ]);
    const before = fakes.log.length;
    air.step();
    air.afterSky();
    air.afterScene();
    expect(fakes.log.length).toBe(before);
  });

  // Why: the space pass needs a step's hand-over; a scene drawn before the
  // first step draws no air rather than throwing inside the frame.
  it("draws no air before the first step", () => {
    const fakes = fakeDrawers();
    const air = mountGlobeViewAir(fakeView(2), {
      coarsePointer: false,
      drawers: () => fakes.drawers,
    });
    air.afterSky();
    air.afterScene();
    expect(fakes.log).toEqual([]);
  });
});
