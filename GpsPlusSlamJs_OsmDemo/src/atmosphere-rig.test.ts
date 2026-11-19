/**
 * The desktop view's physical sky (plan 2026-09-23-0048, M3).
 *
 * WHY THESE TESTS MATTER, AND WHY THEY ARE NOT ABOUT PIXELS. CI's unit stage
 * has no GPU; the look-dev page's smoke owns the pixels. What can go wrong
 * silently HERE is the wiring between the sky and everything that must agree
 * with it: the fog that must be the sky's horizon colour (it was a constant
 * that was wrong at every time of day but one), the sun light that must come
 * from the same model, the haze that must be re-applied to materials built
 * after the sky, the grading that must leave the heat grid alone, and the
 * fallback a device without float render targets gets instead of a black sky.
 */

import * as THREE from "three";
import { SkyAtmosphereUnsupportedError } from "gps-plus-slam-app-framework/visualization/atmosphere/sky-atmosphere";
import { describe, expect, it } from "vitest";

import {
  AtmosphereRig,
  BUILDING_SKY_LIGHT,
  HAZE_START_RATIO,
  HAZE_VISIBILITY_KM,
  NATURAL_LIGHT_ADAPTATION,
  NATURAL_LIGHT_COMPENSATION_EV,
  NIGHT_FLOOR,
  NIGHT_FLOOR_NAME,
  nightFloorWeight,
  surfaceGainAt,
  CLOUD_COVER,
  NOON_SURFACE_GAIN,
  TONE_MAPPING,
  TONE_MAPPING_EXPOSURE,
  type SkyLike,
  HAZE_RIM_INNER_RATIO,
} from "./atmosphere-rig.js";
import { veilDisplayLinear, veilSceneColour } from "./haze-veil.js";
import { sunDirection, type SunAngles } from "./sun-position.js";
import { blendVeils, veilBlendOf } from "./veil-blend.js";

/** A sun at an elevation and an azimuth, degrees (the rig does not care how it was chosen). */
const sunAt = (elevationDeg: number, azimuthDeg = 250): SunAngles => ({
  elevationRad: (elevationDeg * Math.PI) / 180,
  azimuthRad: (azimuthDeg * Math.PI) / 180,
});

/** A sky that records what the rig asks of it. */
class StubSky {
  readonly calls: string[] = [];
  sun = new THREE.Vector3(0, 1, 0);
  ev = Number.NaN;
  disposed = false;
  visibilityKm = 60;
  readonly sharedUniforms = {
    atmMieExtinction: { value: 0.05 },
    atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    atmObserverRadius: { value: 6360.2 },
    atmRadianceToScene: { value: 0.004 },
    atmSkyViewLut: { value: new THREE.Texture() },
  };

  cloudCover: number | undefined = undefined;
  /** Every `configure` change, in order. */
  readonly configured: object[] = [];
  /** How often the rig re-read the sky's light (`applySunLight`). */
  syncs = 0;

  configure(change: {
    sunDirection?: { x: number; y: number; z: number };
    cloudCover?: number;
    visibilityKm?: number;
    skyBalance?: readonly [number, number, number] | null;
  }): void {
    this.calls.push("configure");
    this.configured.push(change);
    if (change.skyBalance !== undefined) this.skyBalance = change.skyBalance;
    if (change.cloudCover !== undefined) this.cloudCover = change.cloudCover;
    if (change.visibilityKm !== undefined) {
      this.visibilityKm = change.visibilityKm;
    }
    if (change.sunDirection) {
      this.sun
        .set(
          change.sunDirection.x,
          change.sunDirection.y,
          change.sunDirection.z,
        )
        .normalize();
      this.sharedUniforms.atmSunDirection.value.copy(this.sun);
    }
  }

  setExposureCompensation(ev: number): void {
    this.ev = ev;
  }

  /** The framework's default, until the rig hands the sky OsmDemo's own. */
  adaptation = 0.75;
  setAutoExposureAdaptation(adaptation: number): void {
    this.adaptation = adaptation;
  }

  applySunLight(light: THREE.DirectionalLight): void {
    this.syncs++;
    light.color.setRGB(1, 0.8, 0.6);
    // Exposure-dependent, like the real sky: the light holds a COPY.
    light.intensity =
      (3 + this.sun.y) *
      2 ** (this.ev - NATURAL_LIGHT_COMPENSATION_EV) *
      (this.adaptation / NATURAL_LIGHT_ADAPTATION);
  }

  /** The horizon veil the rig set (not a call: a uniform, nothing rebuilt). */
  horizonVeil: { colour: readonly number[]; riseDeg: number } | null = null;
  horizonVeilStrength = 1;
  setHorizonVeil(
    colour: readonly [number, number, number] | null,
    riseDeg = 0,
    strength = 1,
  ): void {
    this.horizonVeil = colour === null ? null : { colour, riseDeg };
    this.horizonVeilStrength = strength;
  }

  /** The sky balance the rig set (a re-bake in the real sky, not a call here). */
  skyBalance: readonly number[] | null = null;
  setSkyBalance(gain: readonly [number, number, number] | null): void {
    this.skyBalance = gain;
  }

  horizonColour(): THREE.Color {
    // Depends on the sun, so a fog colour taken once would go stale.
    return new THREE.Color(0.2, 0.3 + 0.1 * this.sun.y, 0.5);
  }

  dispose(): void {
    this.disposed = true;
  }
}

function rig(options: { unsupported?: boolean } = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 100, 200);
  const sun = new THREE.DirectionalLight();
  const sky = new StubSky();
  const view = new AtmosphereRig({
    renderer: {} as unknown as THREE.WebGLRenderer,
    scene,
    sun,
    createSky: () => {
      if (options.unsupported) throw new SkyAtmosphereUnsupportedError();
      return sky as unknown as SkyLike;
    },
  });
  return { view, scene, sun, sky };
}

describe("AtmosphereRig with the physical sky", () => {
  // One sun vector, every consumer: the sky, the light's placement (the
  // caller's), and the haze's lookup.
  it("points the sky at the sun and returns the same unit direction", () => {
    const { view, sky } = rig();
    const angles = sunAt(45, 150);
    const direction = view.setSun(angles);
    const expected = sunDirection(angles);
    expect(direction.x).toBeCloseTo(expected.x, 12);
    expect(direction.y).toBeCloseTo(expected.y, 12);
    expect(sky.sun.y).toBeCloseTo(expected.y, 12);
  });

  // THE FOG FOLLOWS THE SKY (far-field's old check could only confirm a
  // constant was a colour). The horizon changes with the sun, so it is read
  // on every sun change.
  it("takes the fog colour from the sky's horizon at every sun change", () => {
    const { view, scene, sky } = rig();
    view.setSun(sunAt(17, 108));
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.equals(sky.horizonColour())).toBe(true);
    view.setSun(sunAt(55, 180));
    expect(fog.color.equals(sky.horizonColour())).toBe(true);
  });

  it("lights the sun from the sky model", () => {
    const { view, sun, sky } = rig();
    view.setSun(sunAt(55, 180));
    expect(sun.intensity).toBeCloseTo(3 + sky.sun.y, 12);
    expect(sun.color.g).toBeCloseTo(0.8, 12);
  });

  // THE GRADING CONTRACT. Khronos Neutral since plan 2026-09-23-2149 M3
  // (DEC-SUN-9), at exposure 0.5 / 0.6: three's ACES divided the exposure by
  // 0.6 before its curve and Neutral does not, so without the correction the
  // whole frame, the heat grid included, would enter 0.74 EV darker
  // (DEC-SUN-12 keeps the heat grid's brightness). The sky's natural light
  // gets its own EV, chosen so the data layer stays the loudest thing on
  // screen at every sun (measured in the e2e suite; see
  // NATURAL_LIGHT_COMPENSATION_EV). Here: the rig hands the sky exactly that
  // EV, and the tone-mapping exposure is untouched by it.
  it("applies the natural-light EV to the sky, leaving the tone mapping alone", () => {
    const { sky } = rig();
    expect(sky.ev).toBe(NATURAL_LIGHT_COMPENSATION_EV);
    // And OsmDemo's own adaptation: the sky's default is the framework's.
    expect(sky.adaptation).toBe(NATURAL_LIGHT_ADAPTATION);
    expect(TONE_MAPPING).toBe(THREE.NeutralToneMapping);
    expect(TONE_MAPPING_EXPOSURE).toBeCloseTo(0.5 / 0.6, 12);
    // A data view: darker than the look-dev page's photographic grading.
    expect(
      2 ** NATURAL_LIGHT_COMPENSATION_EV * TONE_MAPPING_EXPOSURE,
    ).toBeLessThan(1);
  });

  // THE OWNER'S LIGHT DEFAULTS (light dialog plan 2026-09-24-2140 §13-§15,
  // DEC-LIGHT-9/10): picked in the dialog, the gain raised so June noon
  // keeps its approved brightness, the adaptation raised so the 3.6°
  // morning keeps the lit-city floor. Each was measured at every DEC-R4-5
  // sun point; changing one re-opens that measurement.
  // The sky light was re-measured in r1158 (1.4 -> 3, owner 2026-11-09: keep
  // the linear building colours and raise the light; sweep in the constant).
  it("ships the owner's light defaults", () => {
    expect(NATURAL_LIGHT_COMPENSATION_EV).toBe(-3.15);
    expect(NATURAL_LIGHT_ADAPTATION).toBe(0.83);
    expect(BUILDING_SKY_LIGHT).toBe(3);
    expect(NOON_SURFACE_GAIN).toEqual({ max: 1.8, fromDeg: 18, fullDeg: 40 });
  });

  // The noon brightening (plan 2026-09-24-0901; the ramp from DEC-LIGHT-9):
  // the building and road colour factor is 1 up to an 18° sun (the boot,
  // mornings, evenings and twilight keep their look), rises linearly, and
  // is x1.8 from 40° up.
  it("brightens the neutral surfaces only at a high sun", () => {
    const at = (deg: number) => surfaceGainAt((deg * Math.PI) / 180);
    expect(at(-6)).toBe(1);
    expect(at(0)).toBe(1);
    expect(at(18)).toBe(1);
    expect(at(29)).toBeCloseTo(1.4, 12);
    expect(at(40)).toBeCloseTo(1.8, 12);
    expect(at(62.5)).toBeCloseTo(1.8, 12);
    expect(at(90)).toBeCloseTo(1.8, 12);
    for (let deg = -10; deg < 90; deg += 0.5) {
      expect(at(deg + 0.5)).toBeGreaterThanOrEqual(at(deg));
    }
    expect(() => surfaceGainAt(Number.NaN)).toThrow(RangeError);
  });

  // The owner's first look at the r718 preview: the physical sky without
  // its clouds read as "the old sky" (plan 2026-09-24-0706). The rig turns
  // the look-dev page's cloud layer on.
  it("turns the sky's clouds on", () => {
    const { sky } = rig();
    expect(sky.cloudCover).toBe(CLOUD_COVER);
    expect(CLOUD_COVER).toBeGreaterThan(0);
  });

  // The haze reads the sky's state through its OWN uniforms (it copies them
  // in sync), so a sun change that is not synced leaves every hazed material
  // looking the old way.
  it("syncs the haze after every sun change", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(32, 126));
    expect(view.haze.uniforms.atmSunDirection.value.equals(sky.sun)).toBe(true);
    expect(view.haze.uniforms.atmHazeMode.value).toBe(1);
  });

  // Materials are built long after the sky (buildings, cells, the route):
  // the pre-frame pass is what hazes them. It would also heal a hook a later
  // installer re-assigned (a guard; none does today).
  it("hazes materials added after construction, and heals replaced hooks", () => {
    const { view, scene } = rig();
    const material = new THREE.MeshStandardMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    view.prepareFrame(new THREE.PerspectiveCamera());
    const hazed = material.onBeforeCompile;
    expect(material.customProgramCacheKey()).toContain("atmosphere-haze");
    material.onBeforeCompile = () => {};
    view.prepareFrame(new THREE.PerspectiveCamera());
    expect(material.onBeforeCompile).not.toBe(hazed);
    expect(material.customProgramCacheKey()).toContain("atmosphere-haze");
  });

  it("disposes the sky and the haze", () => {
    const { view, sky } = rig();
    view.dispose();
    expect(sky.disposed).toBe(true);
  });
});

describe("AtmosphereRig.setExposure (light dialog, plan 2026-09-24-2140)", () => {
  // WHY (cold review H1): the sun light, the fog colour and the haze hold
  // COPIES of the sky's exposure; changing the EV or the adaptation on the
  // sky alone would leave the main light at the old exposure until the sun
  // moved. The rig re-syncs every copy.
  it("reaches the sky and every copy of its exposure", () => {
    const { view, sun, sky } = rig();
    view.setSun(sunAt(55, 180));
    const before = sun.intensity;
    view.setExposure({
      ev: NATURAL_LIGHT_COMPENSATION_EV + 1,
      adaptation: 0.6,
    });
    expect(sky.ev).toBe(NATURAL_LIGHT_COMPENSATION_EV + 1);
    expect(sky.adaptation).toBe(0.6);
    expect(sun.intensity).toBeCloseTo(
      before * 2 * (0.6 / NATURAL_LIGHT_ADAPTATION),
      12,
    );
  });

  it("before any sun, sets the sky and syncs with the first sun", () => {
    const { view, sun, sky } = rig();
    view.setExposure({ ev: -2, adaptation: NATURAL_LIGHT_ADAPTATION });
    expect(sky.ev).toBe(-2);
    view.setSun(sunAt(55, 180));
    expect(sun.intensity).toBeCloseTo(
      (3 + sky.sun.y) * 2 ** (-2 - NATURAL_LIGHT_COMPENSATION_EV),
      12,
    );
  });

  // WHY: on the fallback the same sliders must do the same thing.
  it("brightens the fallback's sun by the EV", () => {
    const { view, sun } = rig({ unsupported: true });
    view.setSun(sunAt(55, 180));
    const before = sun.intensity;
    view.setExposure({
      ev: NATURAL_LIGHT_COMPENSATION_EV + 1,
      adaptation: NATURAL_LIGHT_ADAPTATION,
    });
    expect(sun.intensity).toBeCloseTo(before * 2, 9);
  });

  it("refuses a value it cannot use, changing nothing", () => {
    const { view, sky } = rig();
    expect(() =>
      view.setExposure({ ev: Number.NaN, adaptation: 0.75 }),
    ).toThrow(RangeError);
    expect(() => view.setExposure({ ev: -2, adaptation: 2 })).toThrow(
      RangeError,
    );
    expect(sky.ev).toBe(NATURAL_LIGHT_COMPENSATION_EV);
    expect(sky.adaptation).toBe(NATURAL_LIGHT_ADAPTATION);
  });
});

describe("AtmosphereRig.setHaze (light dialog, haze inside the city)", () => {
  // WHY: the shipped look must not move. The sky is built at today's
  // visibility and the haze starts at today's share of the draw distance
  // until the dialog says otherwise.
  it("starts at today's haze", () => {
    let built: number | undefined;
    const view = new AtmosphereRig({
      renderer: {} as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      sun: new THREE.DirectionalLight(),
      createSky: (o) => {
        built = o.visibilityKm;
        return new StubSky() as unknown as SkyLike;
      },
    });
    expect(built).toBe(HAZE_VISIBILITY_KM);
    expect(view.hazeStartRatio).toBe(HAZE_START_RATIO);
  });

  // WHY: the visibility is the AIR's, so the sky and the haze on the city
  // must change together (the rig's one invariant); a haze-only change would
  // fade the city toward a sky drawn for other air.
  it("moves the sky's visibility and the haze on the city together", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    const before = view.haze.uniforms.atmHazeExtinction.value.x;
    view.setHaze({ visibilityKm: 15, startRatio: 0.2 });
    expect(sky.visibilityKm).toBe(15);
    expect(view.haze.uniforms.atmHazeExtinction.value.x).toBeGreaterThan(
      before * 2,
    );
    expect(view.hazeStartRatio).toBe(0.2);
  });

  // WHY: every dialog change re-applies all settings; a visibility that did
  // not change must not rebuild the sky's tables on every exposure drag.
  it("leaves the sky alone when the visibility is unchanged", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    view.setHaze({ visibilityKm: 15, startRatio: 0.66 });
    const calls = sky.calls.length;
    view.setHaze({ visibilityKm: 15, startRatio: 0.3 });
    expect(sky.calls.length).toBe(calls);
    expect(view.hazeStartRatio).toBe(0.3);
  });

  it("refuses a value it cannot use, changing nothing", () => {
    const { view, sky } = rig();
    for (const bad of [
      { visibilityKm: 0, startRatio: 0.5 },
      { visibilityKm: Number.NaN, startRatio: 0.5 },
      { visibilityKm: 20, startRatio: 1 },
      { visibilityKm: 20, startRatio: -0.1 },
    ]) {
      expect(() => view.setHaze(bad)).toThrow(RangeError);
    }
    expect(sky.visibilityKm).toBe(60);
    expect(view.hazeStartRatio).toBe(HAZE_START_RATIO);
  });

  // WHY: on the fallback the same slider must reach the fallback's colours.
  it("re-derives the fallback's horizon from the new visibility", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(25, 200));
    const before = (scene.fog as THREE.Fog).color.clone();
    view.setHaze({ visibilityKm: 9, startRatio: HAZE_START_RATIO });
    expect((scene.fog as THREE.Fog).color.equals(before)).toBe(false);
  });
});

describe("AtmosphereRig on a device without float render targets", () => {
  // The fallback must LIGHT the scene and colour the fog; a black sky, or an
  // exception that takes the whole view with it, is the failure it replaces.
  it("falls back to CPU colours, a sky dome and a hemisphere light", () => {
    const { view, scene, sun } = rig({ unsupported: true });
    expect(view.usingFallback).toBe(true);
    view.setSun(sunAt(55, 180));
    const hemisphere = scene.children.find(
      (c) => c instanceof THREE.HemisphereLight,
    );
    expect(hemisphere).toBeDefined();
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.b).toBeGreaterThan(0);
    expect(sun.intensity).toBeGreaterThan(0);
    // A noon-ish sky is blue at the top of the dome.
    const dome = scene.getObjectByName("fallback-sky-dome") as THREE.Mesh;
    expect(dome).toBeDefined();
    expect(dome.frustumCulled).toBe(false);
    // No LUT exists, so the haze stays on three's stock fog.
    expect(view.haze.uniforms.atmHazeMode.value).toBe(0);
  });

  it("keeps the dome on the camera, so it never clips", () => {
    const { view, scene } = rig({ unsupported: true });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(120, 40, -300);
    view.prepareFrame(camera);
    const dome = scene.getObjectByName("fallback-sky-dome") as THREE.Mesh;
    expect(dome.position.equals(camera.position)).toBe(true);
  });

  it("removes what it added on dispose", () => {
    const { view, scene } = rig({ unsupported: true });
    view.dispose();
    expect(scene.getObjectByName("fallback-sky-dome")).toBeUndefined();
    expect(scene.children.some((c) => c instanceof THREE.HemisphereLight)).toBe(
      false,
    );
  });

  // Only the missing capability selects the fallback; any other failure is a
  // defect and must surface.
  it("does not swallow other construction errors", () => {
    expect(
      () =>
        new AtmosphereRig({
          renderer: {} as unknown as THREE.WebGLRenderer,
          scene: new THREE.Scene(),
          sun: new THREE.DirectionalLight(),
          createSky: () => {
            throw new TypeError("boom");
          },
        }),
    ).toThrow(TypeError);
  });
});

describe("AtmosphereRig, M3 review fixes", () => {
  // FINDING 1. three's stock fog blends AFTER tone mapping, in display
  // space, toward an un-tone-mapped fog colour; the fallback's haze stays on
  // that stock fog. A tone-mapped dome therefore met its own fogged geometry
  // at a different brightness (1.3-2.2x off, measured). The dome must skip
  // tone mapping too, and its horizon must BE the fog colour.
  it("grades the fallback dome like the fog it meets", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(45, 150));
    const dome = scene.getObjectByName("fallback-sky-dome") as THREE.Mesh<
      THREE.SphereGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(dome.material.toneMapped).toBe(false);
    const positions = dome.geometry.attributes.position!;
    const colours = dome.geometry.attributes.color!;
    const fog = (scene.fog as THREE.Fog).color;
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > 0) continue; // at and below the horizon
      expect(colours.getX(i)).toBeCloseTo(fog.r, 6);
      expect(colours.getY(i)).toBeCloseTo(fog.g, 6);
      expect(colours.getZ(i)).toBeCloseTo(fog.b, 6);
    }
  });

  // FINDING 5. A context restore rebuilds the sky and re-measures its
  // exposure, but the sun light, the fog colour and the haze hold COPIES of
  // exposure-dependent values; they must be re-read after the rebuild, not
  // only at the next sun change.
  it("re-syncs the sun light, fog and haze after a WebGL context restore", () => {
    const canvas = new EventTarget();
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 100, 200);
    const sun = new THREE.DirectionalLight();
    const sky = new StubSky();
    const view = new AtmosphereRig({
      renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
      scene,
      sun,
      createSky: () => sky as unknown as SkyLike,
    });
    view.setSun(sunAt(55, 180));
    // The rebuild changed what the sky reports.
    sky.sharedUniforms.atmRadianceToScene.value = 0.02;
    sky.horizonColour = () => new THREE.Color(0.9, 0.1, 0.1);
    sky.applySunLight = (light) => {
      light.intensity = 42;
    };
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(sun.intensity).toBe(42);
    expect(scene.fog.color.r).toBeCloseTo(0.9, 6);
    expect(view.haze.uniforms.atmRadianceToScene.value).toBeCloseTo(0.02, 12);
    view.dispose();
    sky.applySunLight = (light) => {
      light.intensity = 7;
    };
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(sun.intensity).toBe(42);
  });
});

describe("AtmosphereRig night floor (r1155, owner: Nachts Grundhelligkeit)", () => {
  // WHY: below about -6 deg the physical sky's environment goes to nothing and
  // the city went black. The owner wants it still clearly night, but the
  // buildings, trees and roads just distinguishable. A faint, cool ambient
  // light that fades in only after civil twilight is that floor. It must not
  // touch the day or the twilight looks the DEC-R4-5 sweep approved, so the
  // weight is pinned to exactly 0 above the ramp.
  const floorOf = (scene: THREE.Scene) =>
    scene.getObjectByName(NIGHT_FLOOR_NAME) as THREE.AmbientLight | undefined;

  it("fades in only after civil twilight, full from the ramp's end down", () => {
    const at = (deg: number) => nightFloorWeight((deg * Math.PI) / 180);
    expect(at(30)).toBe(0);
    expect(at(0)).toBe(0);
    expect(at(-2.9)).toBe(0);
    expect(at(NIGHT_FLOOR.fromDeg)).toBe(0);
    expect(at((NIGHT_FLOOR.fromDeg + NIGHT_FLOOR.fullDeg) / 2)).toBeCloseTo(
      0.5,
      12,
    );
    expect(at(NIGHT_FLOOR.fullDeg)).toBe(1);
    expect(at(-30)).toBe(1);
    expect(at(-90)).toBe(1);
    expect(() => nightFloorWeight(Number.NaN)).toThrow(RangeError);
  });

  it("adds one cool ambient light, off by day, at the floor at night", () => {
    const { view, scene } = rig();
    const floor = floorOf(scene);
    expect(floor).toBeInstanceOf(THREE.AmbientLight);
    view.setSun(sunAt(45));
    expect(floor!.intensity).toBe(0);
    view.setSun(sunAt(-2.9));
    expect(floor!.intensity).toBe(0);
    view.setSun(sunAt(-30));
    expect(floor!.intensity).toBeCloseTo(NIGHT_FLOOR.intensity, 12);
    expect(NIGHT_FLOOR.intensity).toBeGreaterThan(0);
    // Cool: moonlight and city glow read blue, never warm like the sun.
    expect(floor!.color.b).toBeGreaterThan(floor!.color.r);
    expect(
      scene.children.filter((c) => c.name === NIGHT_FLOOR_NAME),
    ).toHaveLength(1);
  });

  // The light dialog's exposure must not move the floor: it is a fixed
  // display-level light, not a copy of the sky's exposure.
  it("keeps the floor through an exposure change", () => {
    const { view, scene } = rig();
    view.setSun(sunAt(-30));
    view.setExposure({ ev: -1, adaptation: 0.5 });
    expect(floorOf(scene)!.intensity).toBeCloseTo(NIGHT_FLOOR.intensity, 12);
  });

  it("lights the fallback's night the same way", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(-30));
    expect(floorOf(scene)!.intensity).toBeCloseTo(NIGHT_FLOOR.intensity, 12);
    view.setSun(sunAt(20));
    expect(floorOf(scene)!.intensity).toBe(0);
  });

  it("removes the floor on dispose, on both paths", () => {
    for (const unsupported of [false, true]) {
      const { view, scene } = rig({ unsupported });
      view.dispose();
      expect(floorOf(scene)).toBeUndefined();
    }
  });
});

describe("AtmosphereRig.setHazeVeil (city look, a bright bluish veil)", () => {
  // WHY: the shipped look must not move: until the dialog sets a veil, the
  // haze takes the sky's colour, exactly as before.
  it("starts with no veil", () => {
    const { view } = rig();
    expect(view.haze.veil).toBeNull();
    expect(view.haze.uniforms.atmHazeVeilOn.value).toBe(0);
  });

  // WHY: the veil is a colour on SCREEN; the haze blends before tone
  // mapping, so the rig hands it the scene colour that shows it at the
  // renderer's exposure. Uniforms only: the sky is neither rebuilt nor
  // re-read, and the fog object (which AR swaps for its own) is untouched.
  it("sets the haze colour, and touches neither the sky nor the fog", () => {
    const { view, sky, scene } = rig();
    view.setSun(sunAt(25, 200));
    const calls = sky.calls.length;
    const fog = (scene.fog as THREE.Fog).color.clone();
    const veil = { lightness: 80, tint: -4 };
    view.setHazeVeil(veil);
    expect(view.haze.veil).toEqual(
      veilSceneColour(veil, TONE_MAPPING_EXPOSURE),
    );
    expect(sky.calls.length).toBe(calls);
    expect((scene.fog as THREE.Fog).color.equals(fog)).toBe(true);
    view.setHazeVeil(null);
    expect(view.haze.veil).toBeNull();
  });

  // WHY: a sun move or an exposure change re-syncs the haze from the sky;
  // the veil is the dialog's and must survive both.
  it("keeps the veil through a sun move and an exposure change", () => {
    const { view } = rig();
    view.setSun(sunAt(25, 200));
    view.setHazeVeil({ lightness: 75, tint: -6 });
    const set = view.haze.veil;
    view.setSun(sunAt(40, 180));
    view.setExposure({ ev: -2, adaptation: 0.8 });
    expect(view.haze.veil).toEqual(set);
  });

  // WHY: on the fallback the haze is three's stock fog, whose colour is the
  // scene fog's; the veil must reach it there, and leave it for the
  // fallback's horizon again when cleared.
  it("colours the fallback's fog, and gives it back to the horizon", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(25, 200));
    const horizon = (scene.fog as THREE.Fog).color.clone();
    const veil = { lightness: 80, tint: -4 };
    view.setHazeVeil(veil);
    const fog = (scene.fog as THREE.Fog).color;
    const want = veilDisplayLinear(veil);
    expect([fog.r, fog.g, fog.b]).toEqual([...want]);
    view.setHazeVeil(null);
    expect((scene.fog as THREE.Fog).color.equals(horizon)).toBe(true);
  });

  // WHY: the rise reaches the sky last, after the haze and the veil were
  // set; a rise the sky refuses must be refused before any of it changes.
  it("refuses a rise that is not a number in 0..90, changing nothing", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    view.setHazeVeil({ lightness: 70, tint: -4, riseDeg: 3 });
    const set = view.haze.veil;
    const skyVeil = sky.horizonVeil;
    for (const riseDeg of [Number.NaN, -1, 91, Number.POSITIVE_INFINITY]) {
      expect(() =>
        view.setHazeVeil({ lightness: 80, tint: -6, riseDeg }),
      ).toThrow(RangeError);
      expect(view.haze.veil).toEqual(set);
      expect(sky.horizonVeil).toEqual(skyVeil);
    }
  });

  it("refuses a veil it cannot show, changing nothing", () => {
    const { view } = rig();
    view.setHazeVeil({ lightness: 70, tint: -4 });
    const set = view.haze.veil;
    expect(() => view.setHazeVeil({ lightness: 99, tint: -4 })).toThrow(
      RangeError,
    );
    expect(view.haze.veil).toEqual(set);
  });
});

describe("AtmosphereRig: the veil up the sky and at the ground's rim", () => {
  // WHY: the far ground is hazed toward the veil; the sky right above it
  // must take the same colour at the horizon, or the two meet in a step.
  // The sky gets the very scene colour the haze gets, and the veil's rise.
  it("hands the sky the haze's veil colour and the rise, and takes it off with the veil", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    view.setHazeVeil({ lightness: 72, tint: -4, riseDeg: 3 });
    expect(sky.horizonVeil).toEqual({
      colour: veilSceneColour(
        { lightness: 72, tint: -4 },
        TONE_MAPPING_EXPOSURE,
      ),
      riseDeg: 3,
    });
    view.setHazeVeil({ lightness: 72, tint: -4 });
    expect(sky.horizonVeil?.riseDeg).toBe(0);
    view.setHazeVeil(null);
    expect(sky.horizonVeil).toBeNull();
  });

  // WHY: the ground is a tile of a few km and stops; with a veil on, its
  // edge must vanish into the veil like the horizon does. Scoped to the
  // veil, so the shipped look (no veil) keeps its haze exactly.
  it("hazes the ground's rim fully while a veil is on, and only then", () => {
    const { view } = rig();
    view.setSun(sunAt(25, 200));
    view.setGroundRim({ x: 100, z: -50 }, 2400);
    expect(view.haze.rim).toBeNull();
    view.setHazeVeil({ lightness: 72, tint: -4 });
    expect(view.haze.rim).toEqual({
      centre: { x: 100, z: -50 },
      innerM: 2400 * HAZE_RIM_INNER_RATIO,
      outerM: 2400,
      strength: 1,
    });
    view.setGroundRim({ x: 0, z: 0 }, 2400);
    expect(view.haze.rim?.centre).toEqual({ x: 0, z: 0 });
    view.setHazeVeil(null);
    expect(view.haze.rim).toBeNull();
  });

  it("refuses a ground extent that is not positive, changing nothing", () => {
    const { view } = rig();
    view.setHazeVeil({ lightness: 72, tint: -4 });
    view.setGroundRim({ x: 0, z: 0 }, 2400);
    expect(() => view.setGroundRim({ x: 0, z: 0 }, 0)).toThrow(RangeError);
    expect(() => view.setGroundRim({ x: Number.NaN, z: 0 }, 2400)).toThrow(
      RangeError,
    );
    expect(view.haze.rim?.outerM).toBe(2400);
  });
});

describe("AtmosphereRig.setVeilBlend (a veil at a strength)", () => {
  const full = veilBlendOf({ lightness: 72, tint: -4, riseDeg: 3 }, 1)!;
  const half = blendVeils([null, full], [0.5, 0.5])!;

  // WHY: a blend of looks draws a veil at a strength; the haze, the sky's
  // horizon and the ground's rim must all take the SAME strength, or the
  // ground's edge and the horizon fade in at different rates.
  it("hands the haze, the sky and the rim one strength", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    view.setGroundRim({ x: 0, z: 0 }, 2400);
    view.setVeilBlend(half);
    expect(view.haze.veil).toEqual(half.colour);
    expect(view.haze.veilStrength).toBe(0.5);
    expect(sky.horizonVeil).toEqual({ colour: half.colour, riseDeg: 3 });
    expect(sky.horizonVeilStrength).toBe(0.5);
    expect(view.haze.rim?.strength).toBe(0.5);
  });

  // WHY: on the fallback the veil is the fog colour; at a strength it must
  // keep the horizon's share, so a half veil is the mean, not a dark veil.
  it("mixes the fallback's fog with the horizon by the strength", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(25, 200));
    const horizon = (scene.fog as THREE.Fog).color.clone();
    view.setVeilBlend(half);
    const fog = (scene.fog as THREE.Fog).color;
    const want = horizon
      .toArray()
      .map((c, i) => c * 0.5 + (half.display[i] ?? 0));
    fog.toArray().forEach((c, i) => expect(c).toBeCloseTo(want[i] ?? 0, 6));
  });
});

describe("AtmosphereRig.setLight (one combined update)", () => {
  const light = (visibilityKm: number) => ({
    exposure: { ev: -2.5, adaptation: 0.8 },
    haze: { visibilityKm, startRatio: 0.5 },
    veil: veilBlendOf({ lightness: 72, tint: -4 }, TONE_MAPPING_EXPOSURE),
    skyBalance: [0.9, 1, 1.1] as const,
  });

  // WHY: each setter configured or re-synced the sky on its own, so a step
  // that moves the visibility AND the balance cost two rebuilds or a
  // rebuild and a bake; the combined update configures once and re-reads
  // the sky's copies once (time-of-day plan, one rebuild per update).
  it("configures the sky once and re-reads it once", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    const configures = sky.calls.length;
    const syncs = sky.syncs;
    view.setLight(light(30));
    expect(sky.calls.length - configures).toBe(1);
    expect(sky.configured.at(-1)).toEqual({
      visibilityKm: 30,
      skyBalance: [0.9, 1, 1.1],
    });
    expect(sky.syncs - syncs).toBe(1);
    expect(sky.ev).toBe(-2.5);
    expect(view.hazeStartRatio).toBe(0.5);
    expect(view.haze.skyBalance).toEqual([0.9, 1, 1.1]);
    expect(view.haze.veil).toEqual(light(30).veil?.colour);
    // An unchanged visibility is not sent (it would rebuild every table).
    view.setLight(light(30));
    expect(sky.configured.at(-1)).toEqual({ skyBalance: [0.9, 1, 1.1] });
  });

  // WHY: a bad value must not half-apply (a new exposure with the old haze
  // would show a look nobody chose).
  it("refuses any bad value before anything changes", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(25, 200));
    view.setLight(light(30));
    const calls = sky.calls.length;
    const bad = [
      { ...light(30), exposure: { ev: Number.NaN, adaptation: 0.8 } },
      { ...light(30), haze: { visibilityKm: -1, startRatio: 0.5 } },
      { ...light(20), skyBalance: [1, Number.NaN, 1] as const },
      { ...light(20), veil: { ...light(20).veil!, strength: 2 } },
    ];
    for (const setting of bad) {
      expect(() => view.setLight(setting)).toThrow(RangeError);
      expect(sky.calls.length).toBe(calls);
      expect(sky.ev).toBe(-2.5);
      expect(sky.visibilityKm).toBe(30);
    }
  });
});

describe("AtmosphereRig.setSkyBalance (a colour cast on the sky)", () => {
  // WHY: the cast must reach the visible sky (and through it the bake) AND
  // the haze, or the distance fades toward a sky other than the one on
  // screen; null must take it off both.
  it("hands the same gain to the sky and the haze, and null takes it off", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(-1, 230));
    view.setSkyBalance([0.8, 1, 1.2]);
    expect(sky.skyBalance).toEqual([0.8, 1, 1.2]);
    expect(view.haze.skyBalance).toEqual([0.8, 1, 1.2]);
    view.setSkyBalance(null);
    expect(sky.skyBalance).toBeNull();
    expect(view.haze.skyBalance).toBeNull();
  });

  // WHY: the fallback sky is a dome of fixed colours with no radiance to
  // balance; the setting must not break it.
  it("is accepted on the fallback, where it changes nothing drawn", () => {
    const { view, scene } = rig({ unsupported: true });
    view.setSun(sunAt(25, 200));
    const fog = (scene.fog as THREE.Fog).color.clone();
    view.setSkyBalance([0.8, 1, 1.2]);
    expect((scene.fog as THREE.Fog).color.equals(fog)).toBe(true);
  });

  it("refuses a gain it cannot draw before anything changes", () => {
    const { view, sky } = rig();
    view.setSkyBalance([0.9, 1, 1.1]);
    expect(() => view.setSkyBalance([1, Number.NaN, 1])).toThrow(RangeError);
    expect(sky.skyBalance).toEqual([0.9, 1, 1.1]);
    expect(view.haze.skyBalance).toEqual([0.9, 1, 1.1]);
  });
});
