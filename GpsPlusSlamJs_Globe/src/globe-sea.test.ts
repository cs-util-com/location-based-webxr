import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_SEA,
  GLOBE_SEA_SHADOW_GLSL,
  createGlobeSea,
  createGlobeSeaUniforms,
  globeSeaShareAt,
  seaFresnel,
  seaSlopeVariance,
  seaWavePhase,
} from "./globe-sea.js";

const QUALITY = { waveOctaves: 8, shortestWaveM: 8 };

/** A camera on the equator at 1 km, looking along any rotation. */
const POSE = {
  position: new THREE.Vector3(6_379_137, 0, 0),
  quaternion: new THREE.Quaternion(),
};

const frame = (over: Record<string, unknown> = {}) => ({
  position: POSE.position,
  quaternion: POSE.quaternion,
  altitudeKm: 1,
  timeS: 10,
  pixelRad: 0.001,
  ...over,
});

const SKY = () => ({
  atmSkyViewLut: { value: new THREE.Texture() },
  atmTransmittanceLut: { value: new THREE.Texture() },
  atmObserverRadius: { value: 6361 },
  atmRadianceToScene: { value: 0.002 },
});

describe("globeSeaShareAt", () => {
  // Why: the waves hand over to the flat globe's glint with height; the
  // share must reach both ends exactly or one of them is never whole.
  it("is whole low down, gone at height, and falls between", () => {
    const [low, high] = GLOBE_SEA.fadeKm;
    expect(globeSeaShareAt(0)).toBe(1);
    expect(globeSeaShareAt(low)).toBe(1);
    expect(globeSeaShareAt(high)).toBe(0);
    expect(globeSeaShareAt(1000)).toBe(0);
    const mid = globeSeaShareAt((low + high) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it("reads an altitude not known as no sea", () => {
    expect(globeSeaShareAt(Number.NaN)).toBe(0);
  });
});

describe("seaSlopeVariance", () => {
  // Why: Cox and Munk's fit is the sea's roughness; the wind sets it.
  it("is Cox-Munk's at the wind's speed", () => {
    const { upwind, crosswind } = seaSlopeVariance(5);
    expect(upwind).toBeCloseTo(0.0198, 6);
    expect(crosswind).toBeCloseTo(0.0126, 6);
  });
});

describe("seaFresnel", () => {
  // Why: the sea is a mirror at a grazing view and nearly black head on;
  // that ratio is what makes the far sea take the sky's colour.
  it("reflects 2 % head on and everything at grazing, rising between", () => {
    expect(seaFresnel(1)).toBeCloseTo(0.02, 2);
    expect(seaFresnel(0)).toBeCloseTo(1, 6);
    expect(seaFresnel(0.5)).toBeLessThan(seaFresnel(0.2));
  });
});

describe("createGlobeSea", () => {
  // Why: without the production atmosphere there is no sky to reflect,
  // and a dark sea is worse than the flat glint it replaces.
  it("stays off until it has a sky", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    sea.step(frame());
    expect(uniforms.uSeaOn.value).toBe(0);
    sea.setSky(SKY());
    sea.step(frame());
    expect(uniforms.uSeaOn.value).toBe(1);
    sea.setSky(null);
    sea.step(frame());
    expect(uniforms.uSeaOn.value).toBe(0);
  });

  it("follows its switch and the height's share", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    sea.setSky(SKY());
    sea.step(frame({ altitudeKm: 1000 }));
    expect(uniforms.uSeaOn.value).toBe(0);
    sea.setOn(false);
    sea.step(frame());
    expect(uniforms.uSeaOn.value).toBe(0);
    sea.setOn(true);
    sea.step(frame());
    expect(uniforms.uSeaOn.value).toBe(1);
  });

  it("hands the atmosphere's tables and scale to the shader", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    const sky = SKY();
    sea.setSky(sky);
    sea.step(frame());
    expect(uniforms.uSeaSkyView.value).toBe(sky.atmSkyViewLut.value);
    expect(uniforms.uSeaTransmittance.value).toBe(
      sky.atmTransmittanceLut.value,
    );
    expect(uniforms.uSeaObserverR.value).toBe(6361);
    expect(uniforms.uSeaRadianceToScene.value).toBe(0.002);
  });

  it("carries the camera's rotation into ECEF", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 2,
    );
    sea.setSky(SKY());
    sea.step(frame({ quaternion }));
    const seen = new THREE.Vector3(1, 0, 0).applyMatrix3(
      uniforms.uSeaEcefFromView.value,
    );
    expect(seen.y).toBeCloseTo(1, 6);
  });

  // Why: a wind that is not in the sea's plane tilts every slope.
  it("keeps the wind in the plane of the sea, at the pole too", () => {
    for (const position of [
      POSE.position,
      new THREE.Vector3(0, 0, 6_357_000),
      new THREE.Vector3(3e6, -4e6, 2e6),
    ]) {
      const uniforms = createGlobeSeaUniforms();
      const sea = createGlobeSea(uniforms, QUALITY);
      sea.setSky(SKY());
      sea.step(frame({ position }));
      const wind = uniforms.uSeaWind.value;
      expect(wind.length()).toBeCloseTo(1, 6);
      expect(wind.dot(position.clone().normalize())).toBeCloseTo(0, 6);
    }
  });

  it("wraps every octave's phase so the shader's floats stay exact", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    sea.setSky(SKY());
    sea.step(frame({ timeS: 1.8e9 }));
    expect(uniforms.uSeaPhase.value).toHaveLength(QUALITY.waveOctaves);
    for (const phase of uniforms.uSeaPhase.value) {
      expect(phase.x).toBeGreaterThanOrEqual(0);
      expect(phase.x).toBeLessThan(GLOBE_SEA.noiseCells);
      expect(phase.y).toBeGreaterThanOrEqual(0);
      expect(phase.y).toBeLessThan(GLOBE_SEA.noiseCells);
    }
  });

  // Why: the waves belong to the sea. A camera flying over it must see
  // them pass, so its travel goes into the phase, along the wind's frame.
  it("moves the phase by the camera's travel", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    sea.setSky(SKY());
    sea.step(frame());
    const first = uniforms.uSeaPhase.value[0]!.clone();
    const wind = uniforms.uSeaWind.value.clone();
    sea.step(
      frame({ position: POSE.position.clone().addScaledVector(wind, 3) }),
    );
    const [x, y] = seaWavePhase([3, 0], 10, 0, QUALITY.shortestWaveM);
    const [x0, y0] = seaWavePhase([0, 0], 10, 0, QUALITY.shortestWaveM);
    const moved = uniforms.uSeaPhase.value[0]!;
    expect(moved.x - first.x).toBeCloseTo(x - x0, 4);
    expect(moved.y - first.y).toBeCloseTo(y - y0, 4);
  });

  it("refuses a time that is not finite", () => {
    const sea = createGlobeSea(createGlobeSeaUniforms(), QUALITY);
    sea.setSky(SKY());
    expect(() => sea.step(frame({ timeS: Number.NaN }))).toThrow(RangeError);
  });

  it("refuses a quality the shader cannot draw", () => {
    expect(() =>
      createGlobeSea(createGlobeSeaUniforms(), {
        waveOctaves: 0,
        shortestWaveM: 8,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createGlobeSea(createGlobeSeaUniforms(), {
        waveOctaves: 8,
        shortestWaveM: 0,
      }),
    ).toThrow(RangeError);
  });

  it("reports what a page's diagnostics need", () => {
    const uniforms = createGlobeSeaUniforms();
    const sea = createGlobeSea(uniforms, QUALITY);
    expect(sea.state()).toEqual({
      on: true,
      sky: false,
      share: 0,
      octaves: 8,
      shortestWaveM: 8,
    });
  });
});

describe("the sea's shadow interface", () => {
  // Why: the near clouds shadow the sea through this one function, so the
  // sea's code never learns where a shadow comes from.
  it("is one named function of the point's own shadow value", () => {
    expect(GLOBE_SEA_SHADOW_GLSL).toContain(
      "float globeSeaSunShadow( float cloudShadow )",
    );
  });
});
