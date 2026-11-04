import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { GlobeCityState } from "gps-plus-slam-globe/view";

import {
  EDITOR_CITY,
  mountEditorCity,
  patchSeeThrough,
} from "./editor3d-globe-city.js";

const BERN = { lat: 46.948, lng: 7.4474 };

/** A city as the Globe package's: its loads recorded, its state set by
 *  the test, its fade kept. */
function fakeCity() {
  const root = new THREE.Group();
  const loads: { target: unknown; zoom: number; fresh: boolean }[] = [];
  let state: GlobeCityState = { phase: "idle", fade: 1, shown: 0, load: null };
  let throws: Error | null = null;
  const handle = {
    progress: () => 0,
    done: false,
    finished: new Promise<never>(() => undefined),
    stats: () => ({ counts: {}, inFlight: 0, bytesStored: 0 }),
    abort() {},
  };
  const city = {
    root,
    load: vi.fn(
      (target: unknown, options: { zoom: number; fresh?: boolean }) => {
        if (throws !== null) throw throws;
        loads.push({
          target,
          zoom: options.zoom,
          fresh: options.fresh === true,
        });
        state = { ...state, phase: "loading" };
        return handle as never;
      },
    ),
    setFade: vi.fn((value: number) => {
      state = { ...state, fade: value };
    }),
    state: () => state,
    dispose: vi.fn(),
  };
  return {
    city,
    loads,
    set(next: Partial<GlobeCityState>) {
      state = { ...state, ...next };
    },
    failWith(error: Error) {
      throws = error;
    },
  };
}

/** A mesh of the city's kind: its layer and its own material. */
function cityMesh(layer: string, material = new THREE.MeshStandardMaterial()) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.userData.cityLayer = layer;
  return mesh;
}

/** The standard material's shaders, as three.js hands them to the patch. */
function standardShader() {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, unknown>,
  };
}

const compile = (material: THREE.Material) => {
  const shader = standardShader();
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
};

describe("mountEditorCity", () => {
  // Why: a tour opened from orbit must not ask Overpass for anything; the
  // city loads at the tour's centre on the relief's own zoom once it
  // could be seen (below 30 km, the globe lab's), and fades in by altitude.
  it("loads at the tour's centre on the relief's zoom only below its top, faded by altitude", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    city.step({ altitudeM: 400_000, selection: null });
    expect(fake.loads).toEqual([]);
    expect(fake.city.setFade).toHaveBeenLastCalledWith(0);
    city.step({ altitudeM: 25_000, selection: null });
    expect(fake.loads).toEqual([{ target: BERN, zoom: 12, fresh: false }]);
    city.step({ altitudeM: 500, selection: null });
    expect(fake.loads).toHaveLength(1);
    expect(fake.city.setFade).toHaveBeenLastCalledWith(1);
  });

  // Why: the approach warms the city's data during the fall (a fresh
  // load), so the buildings are there on landing; the frame's own load of
  // the same place then reuses it (the city answers it with the same load).
  it("warms up with a fresh load at the approach's start", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    city.warmUp();
    expect(fake.loads).toEqual([{ target: BERN, zoom: 12, fresh: true }]);
    city.step({ altitudeM: 1_000, selection: null });
    expect(fake.loads.at(-1)?.fresh).toBe(false);
  });

  // Why: the view's toggle: hidden, the city neither loads (no Overpass
  // traffic) nor draws, nor stands in the clouds' depth; shown again, it
  // carries on.
  it("hides: no load, no fade, nothing for the clouds; shown again it loads", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    fake.city.root.visible = true;
    expect(city.extra()).toEqual([fake.city.root]);
    city.setShown(false);
    expect(fake.city.setFade).toHaveBeenLastCalledWith(0);
    expect(city.extra()).toEqual([]);
    city.warmUp();
    city.step({ altitudeM: 500, selection: null });
    expect(fake.loads).toEqual([]);
    expect(city.stats(null).shown).toBe(false);
    city.setShown(true);
    city.step({ altitudeM: 500, selection: null });
    expect(fake.loads).toHaveLength(1);
  });

  // Why: a worker that cannot be made (a browser without module workers)
  // throws from the city's load; the frame must not stop on it, the city
  // is held off and says why.
  it("holds a city that throws off, and says why, without throwing", () => {
    const fake = fakeCity();
    fake.failWith(new Error("no module workers here"));
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    expect(() => {
      city.warmUp();
      city.step({ altitudeM: 500, selection: null });
    }).not.toThrow();
    expect(fake.city.load).toHaveBeenCalledTimes(1);
    const stats = city.stats(null);
    expect(stats.worker).toBe("unavailable");
    expect(stats.message).toBe("no module workers here");
  });

  // Why: a camera not placed yet reads no altitude; that frame is
  // skipped, not taken for a failed city.
  it("skips a frame without an altitude", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    city.step({ altitudeM: Number.NaN, selection: null });
    city.step({ altitudeM: 500, selection: null });
    expect(fake.loads).toHaveLength(1);
    expect(city.stats(null).worker).toBe("loading");
  });

  // Why: the page's checks read the tiles, the buildings and the worker's
  // phase, the geometry's size (memory), and the height parity: the city
  // must stand on the ground the relief draws (difference near 0).
  it("reports the counts, the geometry's bytes and the height parity", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    const mesh = cityMesh("buildings");
    mesh.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(9), 3),
    );
    mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(3), 1));
    fake.city.root.add(mesh);
    fake.set({
      phase: "ready",
      objects: 1,
      groundM: 541.5,
      counts: { tiles: 4, volumes: 26, features: 30, missingTiles: 0 },
      load: {
        outcome: "settled",
        ended: true,
        stages: ["first"],
        progress: 1,
        counts: {
          overpass: { total: 4, warm: 0, fetched: 4, failed: 0 },
          dem: { total: 2, warm: 0, fetched: 2, failed: 0 },
        },
      },
    });
    const stats = city.stats(541);
    expect(stats).toMatchObject({
      worker: "ready",
      tiles: 4,
      buildings: 26,
      features: 30,
      objects: 1,
      geometryBytes: 9 * 4 + 3 * 4,
      groundM: 541.5,
      reliefGroundM: 541,
      parityM: 0.5,
      load: { outcome: "settled", ended: true, progress: 1 },
    });
    expect(city.stats(null).parityM).toBeNull();
  });

  // Why: a station inside a block must stay visible: the buildings and
  // trees around the selection are drawn as a screen door (the roads lie
  // flat and are left alone); with nothing selected nothing is cut.
  it("turns the buildings and trees around the selection see-through, not the roads", () => {
    const fake = fakeCity();
    const city = mountEditorCity({ city: fake.city, place: BERN, zoom: 12 });
    const building = cityMesh("buildings");
    const tree = cityMesh("trees");
    const road = cityMesh("roads");
    fake.city.root.add(building, tree, road);
    const at = new THREE.Vector3(10, 2, -5);
    city.step({
      altitudeM: 500,
      selection: { at, up: new THREE.Vector3(0, 2, 0), radiusM: 5 },
    });
    expect(city.stats(null).seeThrough).toEqual({
      on: true,
      radiusM: 5 + EDITOR_CITY.seeThroughM,
      materials: 2,
    });
    const shader = compile(building.material);
    expect(shader.fragmentShader).toContain("discard");
    expect(shader.uniforms["uSeeCentre"]).toEqual({ value: at });
    expect(shader.uniforms["uSeeUp"]).toEqual({
      value: new THREE.Vector3(0, 1, 0),
    });
    expect(compile(road.material).fragmentShader).not.toContain("uSeeOn");
    city.step({ altitudeM: 500, selection: null });
    expect(city.stats(null).seeThrough.on).toBe(false);
  });

  // Why: the trees' materials are shared with every later city, so a
  // second view's mount meets a material already patched: it must not
  // declare the see-through twice (the shader would not compile), and the
  // newer view's uniforms must drive it.
  it("patches a shared material once across views, with the newer view's uniforms", () => {
    const shared = new THREE.MeshStandardMaterial();
    const first = fakeCity();
    first.city.root.add(cityMesh("trees", shared));
    mountEditorCity({ city: first.city, place: BERN, zoom: 12 }).step({
      altitudeM: 500,
      selection: null,
    });
    const second = fakeCity();
    second.city.root.add(cityMesh("trees", shared));
    const view = mountEditorCity({ city: second.city, place: BERN, zoom: 12 });
    const at = new THREE.Vector3(1, 2, 3);
    view.step({
      altitudeM: 500,
      selection: { at, up: new THREE.Vector3(0, 1, 0), radiusM: 1 },
    });
    const shader = compile(shared);
    expect(shader.vertexShader.split("varying vec3 vSeeWorld;")).toHaveLength(
      2,
    );
    expect(shader.uniforms["uSeeCentre"]).toEqual({ value: at });
  });

  // Why: the view's dispose frees the city (its worker and its objects).
  it("disposes the city", () => {
    const fake = fakeCity();
    mountEditorCity({ city: fake.city, place: BERN, zoom: 12 }).dispose();
    expect(fake.city.dispose).toHaveBeenCalledTimes(1);
  });

  // Why: whatever the camera's altitude, the fade handed to the city is a
  // share in 0..1, and 0 at or above the city's top (no city from orbit).
  it("hands the city a fade in 0..1, 0 at or above its top (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e8, noNaN: true }), (altitudeM) => {
        const fake = fakeCity();
        const city = mountEditorCity({
          city: fake.city,
          place: BERN,
          zoom: 12,
        });
        city.step({ altitudeM, selection: null });
        const fade = fake.city.setFade.mock.calls.at(-1)?.[0] ?? Number.NaN;
        expect(fade).toBeGreaterThanOrEqual(0);
        expect(fade).toBeLessThanOrEqual(1);
        expect(altitudeM < EDITOR_CITY.topM || fade === 0).toBe(true);
      }),
    );
  });
});

describe("patchSeeThrough", () => {
  const uniforms = () => ({
    uSeeOn: { value: 1 },
    uSeeCentre: { value: new THREE.Vector3() },
    uSeeUp: { value: new THREE.Vector3(0, 1, 0) },
    uSeeRadius: { value: 10 },
  });

  // Why: the patch is anchored on three.js's own shader chunks; the
  // instanced trees need the instance's matrix in the world position.
  it("carries the world position, instanced too, and cuts inside the cylinder", () => {
    const shader = standardShader();
    expect(patchSeeThrough(shader, uniforms())).toBe(true);
    expect(shader.vertexShader).toContain("vSeeWorld = (modelMatrix * seeAt)");
    expect(shader.vertexShader).toContain("seeAt = instanceMatrix * seeAt");
    expect(shader.fragmentShader).toContain("length(seeFlat) < uSeeRadius");
    expect(Object.keys(shader.uniforms)).toEqual([
      "uSeeOn",
      "uSeeCentre",
      "uSeeUp",
      "uSeeRadius",
    ]);
  });

  // Why: a material whose shader lacks the anchors is left as it is (no
  // half-patched shader that would not compile).
  it("leaves a shader without its anchors unchanged", () => {
    const shader = {
      vertexShader: "void main() {}",
      fragmentShader: "void main() {}",
      uniforms: {},
    };
    expect(patchSeeThrough(shader, uniforms())).toBe(false);
    expect(shader.vertexShader).toBe("void main() {}");
    expect(shader.uniforms).toEqual({});
  });
});
