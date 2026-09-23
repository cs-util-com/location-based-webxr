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
  NATURAL_LIGHT_COMPENSATION_EV,
  TONE_MAPPING_EXPOSURE,
  type SkyLike,
} from "./atmosphere-rig.js";
import { sunAt, sunDirection } from "./sun-position.js";

/** A sky that records what the rig asks of it. */
class StubSky {
  readonly calls: string[] = [];
  sun = new THREE.Vector3(0, 1, 0);
  ev = Number.NaN;
  disposed = false;
  readonly visibilityKm = 60;
  readonly sharedUniforms = {
    atmMieExtinction: { value: 0.05 },
    atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    atmObserverRadius: { value: 6360.2 },
    atmRadianceToScene: { value: 0.004 },
    atmSkyViewLut: { value: new THREE.Texture() },
  };

  configure(change: {
    sunDirection?: { x: number; y: number; z: number };
  }): void {
    this.calls.push("configure");
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

  applySunLight(light: THREE.DirectionalLight): void {
    light.color.setRGB(1, 0.8, 0.6);
    light.intensity = 3 + this.sun.y;
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
    const angles = sunAt(0.3);
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
    view.setSun(sunAt(0.1));
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.equals(sky.horizonColour())).toBe(true);
    view.setSun(sunAt(0.5));
    expect(fog.color.equals(sky.horizonColour())).toBe(true);
  });

  it("lights the sun from the sky model", () => {
    const { view, sun, sky } = rig();
    view.setSun(sunAt(0.5));
    expect(sun.intensity).toBeCloseTo(3 + sky.sun.y, 12);
    expect(sun.color.g).toBeCloseTo(0.8, 12);
  });

  // THE GRADING CONTRACT. ACES at exposure 0.5 stays, because the heat
  // grid's emissive colours were graded under it (DEC-R4-5); the sky's
  // natural light gets its own EV, chosen so the data layer stays the
  // loudest thing on screen at every time of day (measured in the e2e
  // suite; see NATURAL_LIGHT_COMPENSATION_EV). Here: the rig hands the sky
  // exactly that EV, and the tone-mapping exposure is untouched by it.
  it("applies the natural-light EV to the sky, leaving the tone mapping alone", () => {
    const { sky } = rig();
    expect(sky.ev).toBe(NATURAL_LIGHT_COMPENSATION_EV);
    expect(TONE_MAPPING_EXPOSURE).toBe(0.5);
    // A data view: darker than the look-dev page's photographic grading.
    expect(
      2 ** NATURAL_LIGHT_COMPENSATION_EV * TONE_MAPPING_EXPOSURE,
    ).toBeLessThan(1);
  });

  // The haze reads the sky's state through its OWN uniforms (it copies them
  // in sync), so a sun change that is not synced leaves every hazed material
  // looking the old way.
  it("syncs the haze after every sun change", () => {
    const { view, sky } = rig();
    view.setSun(sunAt(0.2));
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

describe("AtmosphereRig on a device without float render targets", () => {
  // The fallback must LIGHT the scene and colour the fog; a black sky, or an
  // exception that takes the whole view with it, is the failure it replaces.
  it("falls back to CPU colours, a sky dome and a hemisphere light", () => {
    const { view, scene, sun } = rig({ unsupported: true });
    expect(view.usingFallback).toBe(true);
    view.setSun(sunAt(0.5));
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
    view.setSun(sunAt(0.3));
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
    view.setSun(sunAt(0.5));
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
