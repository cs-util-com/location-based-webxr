/**
 * The near clouds' drawing pass, over a renderer that draws nothing.
 *
 * Why this file matters: what the shader cannot check for itself is what
 * this pass hands it: the march's sphere against the ellipsoid, the map's
 * own latitude and longitude with its drift, the share of a target
 * allocated once, and the moment it may draw at all. A slip in any of them
 * draws plausible clouds in the wrong place, which no picture test tells
 * from weather.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it, vi } from "vitest";

import { CLOUD_BAKE_SIZES, type CloudBakes } from "./globe-cloud-bake.js";
import {
  type CloudMarchFrame,
  type GlobeCloudMarch,
  createGlobeCloudMarch,
} from "./globe-cloud-march-pass.js";
import { CLOUD_MARCH_LAYER } from "./globe-cloud-march-law.js";
import { GLOBE_QUALITIES } from "./globe-quality.js";

const fakeBakes = (): CloudBakes => ({
  shape: new Uint8Array(CLOUD_BAKE_SIZES.shape ** 3),
  detail: new Uint8Array(CLOUD_BAKE_SIZES.detail ** 3),
  domes: new Uint8Array(4 * CLOUD_BAKE_SIZES.domes ** 2),
  region: new Uint8Array(4 * CLOUD_BAKE_SIZES.region ** 2),
  blue: new Uint8Array(CLOUD_BAKE_SIZES.blue ** 2),
  lifeGain: 0.83,
  detailMean: 0.5,
});

/** A renderer that records what is drawn into which target. */
function fakeRenderer() {
  let target: THREE.WebGLRenderTarget | null = null;
  const draws: (THREE.WebGLRenderTarget | null)[] = [];
  const renderer = {
    getSize: (v: THREE.Vector2) => v.set(1000, 500),
    getPixelRatio: () => 2,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    render: () => {
      draws.push(target);
    },
    compileAsync: () => Promise.resolve(),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws };
}

const toRad = Math.PI / 180;

/** A camera `altitudeM` over a place, looking straight down. */
function cameraOver(latDeg: number, lonDeg: number, altitudeM: number) {
  const camera = new THREE.PerspectiveCamera(50, 2, 1, 1e8);
  const up = WGS84_ELLIPSOID.getCartographicToNormal(
    latDeg * toRad,
    lonDeg * toRad,
    new THREE.Vector3(),
  );
  const at = WGS84_ELLIPSOID.getCartographicToPosition(
    latDeg * toRad,
    lonDeg * toRad,
    altitudeM,
    new THREE.Vector3(),
  );
  camera.position.copy(at);
  camera.up.set(0, 0, 1);
  camera.lookAt(at.clone().sub(up));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function make(lonOffset = 0) {
  const { renderer, draws } = fakeRenderer();
  const surfaceUniforms = {
    uClouds: { value: new THREE.Texture() },
    uCloudLonOffset: { value: lonOffset },
  };
  const march = createGlobeCloudMarch(renderer, {
    ellipsoid: WGS84_ELLIPSOID,
    surfaceUniforms,
  });
  return { march, draws, surfaceUniforms, renderer };
}

const frameAt = (
  camera: THREE.PerspectiveCamera,
  over: Partial<CloudMarchFrame> = {},
): CloudMarchFrame => ({
  camera,
  worldFromEcef: new THREE.Matrix4(),
  sunEcef: new THREE.Vector3(1, 0, 0),
  timeS: 0,
  quality: GLOBE_QUALITIES.high.clouds,
  pixelScale: 1,
  sceneDepth: null,
  shadow: 0,
  ...over,
});

/** The map's uv the march reads straight under the camera. */
function mapUvUnder(march: GlobeCloudMarch): [number, number] {
  const u = march.uniforms();
  const n = new THREE.Vector3(0, 1, 0)
    .applyMatrix3(u.uEcef.value)
    .multiply(u.uMapSkew.value)
    .normalize();
  return [Math.atan2(n.y, n.x), Math.asin(n.z)];
}

describe("createGlobeCloudMarch: the shader's first compile", () => {
  // Why this test matters: a compile on the frame that first draws is a
  // long stall in the middle of a flight; until it is done the old clouds
  // draw.
  it("is ready only once its shaders are compiled", async () => {
    let finish = () => {};
    const compiled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { march, renderer } = make();
    const compile = vi.fn(() => compiled);
    (renderer as unknown as { compileAsync: unknown }).compileAsync = compile;
    march.setBakes(fakeBakes());
    expect(compile).toHaveBeenCalledTimes(2);
    expect(march.ready).toBe(false);
    finish();
    await vi.waitFor(() => expect(march.ready).toBe(true));
  });

  // Why this test matters: three polls the programs by a timer, and a
  // material freed under it throws there, where nothing can catch it: a
  // view closed while the shader compiles.
  it("frees its materials only after the compile", async () => {
    const { march, renderer } = make();
    let finish = () => {};
    const compiled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const freed: string[] = [];
    const compile = vi.fn((scene: THREE.Scene) => {
      const quad = scene.children[0] as THREE.Mesh;
      (quad.material as THREE.Material).addEventListener("dispose", () =>
        freed.push("material"),
      );
      return compiled;
    });
    (renderer as unknown as { compileAsync: unknown }).compileAsync = compile;
    march.setBakes(fakeBakes());
    march.dispose();
    expect(freed).toEqual([]);
    finish();
    await vi.waitFor(() => expect(freed).toHaveLength(2));
  });

  // Why this test matters: a browser that fails the wait can still compile
  // on the first draw; the new clouds must not stay off for that.
  it("is ready after a failed compile too", async () => {
    const { march, renderer } = make();
    (renderer as unknown as { compileAsync: unknown }).compileAsync = () =>
      Promise.reject(new Error("no"));
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
  });
});

describe("createGlobeCloudMarch", () => {
  // Why this test matters: the textures come from a worker, seconds after
  // the view; the pass must say it has nothing to draw until then, so the
  // clouds it replaces keep drawing.
  it("draws nothing before the bakes arrive", async () => {
    const { march, draws } = make();
    expect(march.ready).toBe(false);
    expect(march.render(frameAt(cameraOver(53, 10, 20_000)))).toBe(false);
    expect(draws).toHaveLength(0);
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    expect(march.render(frameAt(cameraOver(53, 10, 20_000)))).toBe(true);
    expect(draws).toHaveLength(1);
  });

  it("does not draw without the map", async () => {
    const { march, surfaceUniforms } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    (surfaceUniforms.uClouds as { value: THREE.Texture | null }).value = null;
    expect(march.ready).toBe(false);
  });

  // Why this test matters: the map's clouds, the shell's and these must be
  // the same clouds; the shell reads the map by the ellipsoid's normal, not
  // by the march's sphere (0.19 degrees apart at 45 N, 20 km), and shifted
  // by the drift. At 60 km the two must agree or the hand-over slides.
  it("reads the map where the shell reads it, drift included", async () => {
    for (const offset of [0, 0.4]) {
      for (const lat of [-70, -30, 0, 45, 78]) {
        const { march } = make(offset);
        march.setBakes(fakeBakes());
        await vi.waitFor(() => expect(march.ready).toBe(true));
        march.render(frameAt(cameraOver(lat, 10, 30_000)));
        const [lon, latRead] = mapUvUnder(march);
        expect(lon).toBeCloseTo(10 * toRad - offset, 4);
        expect(latRead).toBeCloseTo(lat * toRad, 4);
      }
    }
  });

  it("puts the camera at its height over the sphere", async () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    march.render(frameAt(cameraOver(53, 10, 20_000)));
    expect(march.uniforms().uH.value).toBeCloseTo(20, 0);
  });

  // Why this test matters: the march's y is up at the camera; a view axis
  // in the wrong frame draws the clouds overhead when looking down.
  it("gives the view's axes in the march's frame", async () => {
    const { march } = make(0.4);
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    march.render(frameAt(cameraOver(53, 10, 20_000)));
    expect(march.uniforms().uFwd.value.y).toBeCloseTo(-1, 2);
    expect(march.uniforms().uRight.value.length()).toBeCloseTo(1, 6);
  });

  // Why this test matters: the target is allocated once; the scale moves a
  // share of it each frame. A reallocation per frame would be a hitch per
  // frame through every descent.
  it("draws a share of one target as the distance changes", async () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    const sizes = new Set<number>();
    const shares = new Set<number>();
    for (const km of [40, 12, 6, 4, 2, 0.5]) {
      march.render(frameAt(cameraOver(53, 10, km * 1000)));
      sizes.add((march.texture.image as { width: number }).width);
      shares.add(march.uv.x);
    }
    expect(sizes).toEqual(new Set([1500]));
    expect(shares.size).toBeGreaterThan(1);
  });

  // Why this test matters: the wind must not slide the clouds relative to
  // the map: the drift is the camera moving over the map, so a growing
  // offset must move the weather position with it, in the camera's frame.
  it("moves through the weather as the map drifts", async () => {
    const { march, surfaceUniforms } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    const camera = cameraOver(0, 10, 10_000);
    march.render(frameAt(camera));
    const start = march.uniforms().uQ0.value.clone();
    surfaceUniforms.uCloudLonOffset.value = 0.001;
    march.render(frameAt(camera));
    const moved = march.uniforms().uQ0.value.distanceTo(start);
    expect(moved).toBeCloseTo(0.001 * 6371, 0);
  });

  // Why this test matters: the sun set is a long, finite path, not a NaN
  // over half the Earth.
  it("is dark and finite on the night side", async () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    const camera = cameraOver(0, 10, 2_000);
    march.render(frameAt(camera, { sunEcef: new THREE.Vector3(-1, 0, 0) }));
    const u = march.uniforms();
    expect(Number.isFinite(u.uCloudSun.value.x)).toBe(true);
    expect(u.uCloudSun.value.x).toBeLessThan(0.01);
  });

  // Why this test matters: the haze ends the march. Its reach is what
  // decides a ray's budget, at every height from the street to the top.
  it("ends the march where the haze has closed", async () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    for (const km of [0.3, 3, 20, 60]) {
      march.render(frameAt(cameraOver(53, 10, km * 1000)));
      const u = march.uniforms();
      expect(u.uTFade.value).toBeGreaterThan(0);
      expect(u.uTMax.value).toBeGreaterThanOrEqual(u.uTFade.value);
    }
  });

  it("takes the layer and the tier's refinement", async () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    march.render(
      frameAt(cameraOver(53, 10, 20_000), {
        quality: GLOBE_QUALITIES.low.clouds,
      }),
    );
    const u = march.uniforms();
    expect(u.uCB.value).toBe(CLOUD_MARCH_LAYER.baseKm);
    expect(u.uCT.value).toBe(CLOUD_MARCH_LAYER.topKm);
    expect(u.uRefDiv.value).toBe(2);
  });

  it("draws the shadow only when asked", async () => {
    const { march, draws } = make();
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    march.render(frameAt(cameraOver(53, 10, 5_000)));
    expect(draws).toHaveLength(1);
    march.render(frameAt(cameraOver(53, 10, 5_000), { shadow: 0.5 }));
    expect(draws).toHaveLength(3);
    expect(new Set(draws).size).toBe(2);
  });

  it("leaves the render target as it found it", async () => {
    const { renderer } = fakeRenderer();
    const held = new THREE.WebGLRenderTarget(1, 1);
    renderer.setRenderTarget(held);
    const march = createGlobeCloudMarch(renderer, {
      ellipsoid: WGS84_ELLIPSOID,
      surfaceUniforms: {
        uClouds: { value: new THREE.Texture() },
        uCloudLonOffset: { value: 0 },
      },
    });
    march.setBakes(fakeBakes());
    await vi.waitFor(() => expect(march.ready).toBe(true));
    march.render(frameAt(cameraOver(53, 10, 5_000)));
    expect(renderer.getRenderTarget()).toBe(held);
  });

  it("refuses bakes of the wrong size", () => {
    const { march } = make();
    expect(() =>
      march.setBakes({ ...fakeBakes(), shape: new Uint8Array(3) }),
    ).toThrow(RangeError);
    expect(march.ready).toBe(false);
  });

  it("frees its textures once", () => {
    const { march } = make();
    march.setBakes(fakeBakes());
    march.dispose();
    march.dispose();
    expect(march.ready).toBe(false);
    expect(march.render(frameAt(cameraOver(53, 10, 5_000)))).toBe(false);
  });
});
