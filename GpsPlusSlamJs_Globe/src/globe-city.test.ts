/**
 * The globe's city, moved out of the globe lab.
 *
 * Why this file matters: the city talks to its worker by messages and
 * hands the flight a prefetch-shaped handle it paces on. A wrong id check
 * draws a superseded place; a reuse that ignores a failure never asks
 * again; a handle that reads the full progress lands the flight late; a
 * fade written with transparency reorders the city against the relief.
 * These tests pin the messages posted, the handle's answers, the objects
 * placed on the root and their materials, with a recording fake worker,
 * a fake of the library's three.js entry and a clock; the buildings
 * themselves, built by the Osm library, are the lab's city smokes.
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  CITY_ARRIVAL_FADE_MS,
  type GlobeCityThree,
  createGlobeCity,
} from "./globe-city.js";
import { ecefFromCityAt } from "./globe-frame.js";

const BERN = { lat: 46.948, lng: 7.4474 };
const ZURICH = { lat: 47.3769, lng: 8.5417 };
const MAPTERHORN = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
const COUNTS = {
  overpass: { total: 4, warm: 1, fetched: 2, failed: 0 },
  dem: { total: 9, warm: 0, fetched: 9, failed: 0 },
};

/** A worker that records what it is told and answers when the test says. */
function fakeWorker() {
  const posted: unknown[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  let terminated = 0;
  const worker = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    postMessage(message: unknown) {
      posted.push(message);
    },
    terminate() {
      terminated += 1;
    },
  };
  return {
    worker,
    posted,
    terminated: () => terminated,
    reply(data: unknown) {
      for (const l of listeners.message ?? []) l({ data });
    },
    crash(message: string) {
      for (const l of listeners.error ?? []) l({ message });
    },
  };
}

/**
 * The library's three.js entry: one mesh per building name, a road mesh
 * per road name (`userData.cityLayer`), trees with two materials.
 */
function fakeThree() {
  const disposed: THREE.Object3D[][] = [];
  const asked: unknown[] = [];
  const lib: GlobeCityThree = {
    cityObjects(city) {
      asked.push(city);
      const mesh = (name: string, layer: string) => {
        const m = new THREE.Mesh<
          THREE.BufferGeometry,
          THREE.Material | THREE.Material[]
        >(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
        m.name = name;
        m.userData.cityLayer = layer;
        return m;
      };
      const out: THREE.Object3D[] = [];
      for (const n of city.buildings as string[])
        out.push(mesh(n, "buildings"));
      for (const n of city.roads as string[]) out.push(mesh(n, "roads"));
      for (const n of city.trees as string[]) {
        const tree = mesh(n, "trees");
        tree.material = [
          new THREE.MeshBasicMaterial(),
          new THREE.MeshBasicMaterial(),
        ];
        out.push(tree);
      }
      return out;
    },
    disposeCityObjects(objects) {
      disposed.push([...objects]);
    },
  };
  return { lib, disposed, asked };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A city with fakes; `workers` lists every worker made. */
function setup(
  options: {
    roads?: boolean;
    roadLiftM?: number;
    roadOffset?: number;
    heightsUrl?: string;
    three?: () => Promise<GlobeCityThree>;
  } = {},
) {
  const { three: loadThree, ...rest } = options;
  const parent = new THREE.Group();
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const three = fakeThree();
  let threeAsked = 0;
  let t = 0;
  const city = createGlobeCity({
    parent,
    ellipsoid: WGS84_ELLIPSOID,
    createWorker: () => {
      const w = fakeWorker();
      workers.push(w);
      return w.worker;
    },
    loadCityThree:
      loadThree ??
      (() => {
        threeAsked += 1;
        return Promise.resolve(three.lib);
      }),
    now: () => t,
    ...rest,
  });
  return {
    city,
    parent,
    workers,
    three,
    threeAsked: () => threeAsked,
    at(ms: number) {
      t = ms;
    },
  };
}

const delivery = (id: number, over: Record<string, unknown> = {}) => ({
  kind: "city",
  id,
  ok: true,
  stage: "first",
  buildings: ["b1", "b2"],
  roads: ["r1"],
  trees: ["t1"],
  counts: COUNTS,
  groundM: 540,
  ...over,
});

describe("createGlobeCity: the root and the options", () => {
  it("puts an unmoved root on the parent and makes no worker before a load", () => {
    const { city, parent, workers } = setup();
    expect(city.root.parent).toBe(parent);
    expect(city.root.name).toBe("globe-city");
    expect(city.root.matrixAutoUpdate).toBe(false);
    expect(workers).toHaveLength(0);
    expect(city.state()).toEqual({
      phase: "idle",
      fade: 1,
      shown: 0,
      load: null,
    });
  });

  it("refuses a heights source that is not a {z}/{x}/{y} template", () => {
    expect(() => setup({ heightsUrl: "https://x/{z}/{x}.png" })).toThrow(
      RangeError,
    );
    expect(() => setup({ heightsUrl: MAPTERHORN })).not.toThrow();
  });
});

describe("createGlobeCity: load", () => {
  it("posts the place, the zoom and the heights source to one worker", () => {
    const { city, workers } = setup({ heightsUrl: MAPTERHORN });
    city.load(BERN, { zoom: 12 });
    city.load(ZURICH, { zoom: 11 });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toEqual([
      { kind: "load", id: 1, target: BERN, zoom: 12, heightsUrl: MAPTERHORN },
      { kind: "load", id: 2, target: ZURICH, zoom: 11, heightsUrl: MAPTERHORN },
    ]);
    expect(city.state()).toMatchObject({ phase: "loading", target: ZURICH });
    expect(city.state().load).toEqual({
      outcome: null,
      ended: false,
      stages: [],
      counts: {
        overpass: { total: 0, warm: 0, fetched: 0, failed: 0 },
        dem: { total: 0, warm: 0, fetched: 0, failed: 0 },
      },
      progress: 0,
    });
  });

  it("refuses a target that is not finite and a zoom that is not 1-15", () => {
    const { city, workers } = setup();
    expect(() => city.load({ lat: Number.NaN, lng: 7 }, { zoom: 12 })).toThrow(
      RangeError,
    );
    // The message names the bad value: JSON would have printed NaN as null.
    expect(() =>
      city.load({ lat: Number.POSITIVE_INFINITY, lng: 7 }, { zoom: 12 }),
    ).toThrow("got Infinity,7");
    for (const zoom of [0, 16, 12.5]) {
      expect(() => city.load(BERN, { zoom })).toThrow(RangeError);
    }
    expect(workers).toHaveLength(0);
  });

  it("returns the running load for the same place, a new one when fresh", async () => {
    const { city, workers } = setup();
    const first = city.load(BERN, { zoom: 12 });
    const again = city.load(BERN, { zoom: 12 });
    expect(workers[0]?.posted).toHaveLength(1);
    expect(again.finished).toBe(first.finished);
    const fresh = city.load(BERN, { zoom: 12, fresh: true });
    expect(workers[0]?.posted).toHaveLength(2);
    expect(fresh.finished).not.toBe(first.finished);
    // The superseded load settles aborted.
    expect(await first.finished).toMatchObject({ outcome: "aborted" });
    expect(first.done).toBe(true);
  });

  it("paces the flight on the first delivery's jobs, and reports the counts", () => {
    const { city, workers } = setup();
    const handle = city.load(BERN, { zoom: 12 });
    workers[0]?.reply({
      kind: "progress",
      id: 1,
      counts: COUNTS,
      progress: 0.2,
      landing: 0.6,
    });
    expect(handle.progress()).toBe(0.6);
    expect(handle.stats()).toEqual({
      counts: COUNTS,
      inFlight: 0,
      bytesStored: 0,
    });
    workers[0]?.reply({
      kind: "progress",
      id: 1,
      counts: COUNTS,
      progress: 0.3,
    });
    expect(handle.progress()).toBe(0.3);
    expect(handle.done).toBe(false);
  });

  it("settles on the first pass and ends on finished", async () => {
    const { city, workers } = setup();
    const handle = city.load(BERN, { zoom: 12 });
    workers[0]?.reply({
      kind: "settled",
      id: 1,
      outcome: "complete",
      counts: COUNTS,
      bytes: 7,
    });
    expect(await handle.finished).toEqual({
      outcome: "complete",
      counts: COUNTS,
      kind: "settled",
      id: 1,
      bytes: 7,
    });
    expect(handle.progress()).toBe(1);
    expect(handle.done).toBe(true);
    expect(city.state().load?.ended).toBe(false);
    workers[0]?.reply({ kind: "finished", id: 1, outcome: "partial" });
    expect(city.state().load).toMatchObject({
      ended: true,
      outcome: "complete", // settled once
    });
    // A finished load of the place is reused.
    city.load(BERN, { zoom: 12 });
    expect(workers[0]?.posted).toHaveLength(1);
  });

  it("ignores a superseded load's replies", async () => {
    const { city, workers, three } = setup();
    const first = city.load(BERN, { zoom: 12 });
    city.load(ZURICH, { zoom: 12 });
    workers[0]?.reply({ kind: "progress", id: 1, progress: 0.9, counts: {} });
    workers[0]?.reply(delivery(1));
    workers[0]?.reply(null);
    await flush();
    expect(first.progress()).toBe(0);
    expect(three.asked).toHaveLength(0);
    expect(city.state().phase).toBe("loading");
  });

  it("draws nothing of a delivery whose load was superseded while the module loaded", async () => {
    const { city, workers, three } = setup();
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    city.load(ZURICH, { zoom: 12 }); // before the three.js entry resolved
    await flush();
    expect(three.asked).toHaveLength(0);
    expect(city.root.children).toEqual([]);
    expect(city.state()).toMatchObject({ phase: "loading", target: ZURICH });
  });

  it("aborts its own load in the worker, freezing its progress", async () => {
    const { city, workers } = setup();
    const first = city.load(BERN, { zoom: 12 });
    workers[0]?.reply({ kind: "progress", id: 1, progress: 0.4, counts: {} });
    first.abort();
    first.abort();
    expect(workers[0]?.posted.at(-1)).toEqual({ kind: "abort", id: 1 });
    expect(workers[0]?.posted).toHaveLength(2);
    expect(await first.finished).toMatchObject({ outcome: "aborted" });
    workers[0]?.reply({ kind: "progress", id: 1, progress: 0.8, counts: {} });
    expect(first.progress()).toBe(0.4);
    // An aborted place is loaded again; aborting a superseded load posts
    // nothing.
    const second = city.load(BERN, { zoom: 12 });
    city.load(ZURICH, { zoom: 12 });
    second.abort();
    expect(workers[0]?.posted).toHaveLength(4);
  });
});

describe("createGlobeCity: a delivery drawn", () => {
  it("places the library's objects on the root at the target's frame", async () => {
    const { city, workers, three } = setup({ roadLiftM: 3, roadOffset: 2 });
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    await flush();
    expect(three.asked).toEqual([
      { buildings: ["b1", "b2"], trees: ["t1"], roads: ["r1"] },
    ]);
    expect(city.root.children.map((o) => o.name)).toEqual([
      "b1",
      "b2",
      "r1",
      "t1",
    ]);
    const expected = ecefFromCityAt(WGS84_ELLIPSOID, BERN, new THREE.Matrix4());
    expect(city.root.matrix.elements).toEqual(expected.elements);
    const road = city.root.children[2] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material
    >;
    expect(road.position.y).toBe(3);
    expect(road.material.polygonOffset).toBe(true);
    expect(road.material.polygonOffsetFactor).toBe(-2);
    expect(road.material.polygonOffsetUnits).toBe(-2);
    const building = city.root.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material
    >;
    expect(building.position.y).toBe(0);
    expect(building.material.polygonOffset).toBe(false);
    expect(city.state()).toMatchObject({
      phase: "ready",
      target: BERN,
      stage: "first",
      counts: COUNTS,
      groundM: 540,
      objects: 4,
      mainMs: 0,
    });
    expect(city.state().load?.stages).toEqual(["first"]);
  });

  it("lifts the roads by 2 m without an offset by default, and draws none when off", async () => {
    const lifted = setup();
    lifted.city.load(BERN, { zoom: 12 });
    lifted.workers[0]?.reply(delivery(1));
    await flush();
    const road = lifted.city.root.children[2] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material
    >;
    expect(road.position.y).toBe(2);
    expect(road.material.polygonOffset).toBe(false);
    const off = setup({ roads: false });
    off.city.load(BERN, { zoom: 12 });
    off.workers[0]?.reply(delivery(1));
    await flush();
    expect(off.three.asked).toEqual([
      { buildings: ["b1", "b2"], trees: ["t1"], roads: [] },
    ]);
  });

  it("fades a new place in over its arrival, dithered, and keeps it on a later stage", async () => {
    const { city, workers, three, at } = setup();
    city.load(BERN, { zoom: 12 });
    at(1000);
    workers[0]?.reply(delivery(1));
    await flush();
    expect(city.state().shown).toBe(0);
    expect(city.root.visible).toBe(false);
    at(1000 + CITY_ARRIVAL_FADE_MS / 2);
    city.setFade(1);
    const tree = city.root.children[3] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material[]
    >;
    expect(city.state().shown).toBe(0.5);
    expect(city.root.visible).toBe(true);
    for (const m of tree.material) {
      expect(m.alphaHash).toBe(true);
      expect(m.opacity).toBe(0.5);
    }
    at(1000 + CITY_ARRIVAL_FADE_MS);
    city.setFade(1);
    expect(city.state().shown).toBe(1);
    expect(tree.material[0]?.alphaHash).toBe(false);
    expect(tree.material[0]?.opacity).toBe(1);
    // The next stage replaces the objects and keeps the city shown.
    const before = [...city.root.children];
    at(9000);
    workers[0]?.reply(delivery(1, { stage: "all", buildings: ["b3"] }));
    await flush();
    expect(three.disposed.at(-1)).toEqual(before);
    expect(city.state().shown).toBe(1);
    expect(city.state().load?.stages).toEqual(["first", "all"]);
    city.setFade(0.25);
    expect(city.state()).toMatchObject({ fade: 0.25, shown: 0.25 });
    city.setFade(0);
    expect(city.root.visible).toBe(false);
    expect(CITY_ARRIVAL_FADE_MS).toBe(1500);
  });

  it("refuses a fade outside 0-1", () => {
    const { city } = setup();
    for (const v of [-0.1, 1.1, Number.NaN]) {
      expect(() => city.setFade(v)).toThrow(RangeError);
    }
  });

  it("asks for the library's three.js entry once", async () => {
    const { city, workers, threeAsked } = setup();
    expect(threeAsked()).toBe(0);
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    workers[0]?.reply(delivery(1, { stage: "all" }));
    await flush();
    expect(threeAsked()).toBe(1);
  });

  it("fails when the library's three.js entry does not load", async () => {
    const { city, workers } = setup({
      three: () => Promise.reject(new Error("no module")),
    });
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    await flush();
    expect(city.state()).toMatchObject({
      phase: "failed",
      message: "Error: no module",
    });
  });
});

describe("createGlobeCity: failures", () => {
  it("leaves no city drawn after a failed build, and loads the place again", async () => {
    const { city, workers, three } = setup();
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    await flush();
    workers[0]?.reply({ kind: "city", id: 1, ok: false, message: "a gap" });
    await flush();
    expect(city.state()).toMatchObject({ phase: "failed", message: "a gap" });
    expect(city.root.children).toEqual([]);
    expect(three.disposed).toHaveLength(2); // the draw's clear, the failure's
    city.load(BERN, { zoom: 12 });
    expect(workers[0]?.posted).toHaveLength(2);
  });

  it("ends a crashed worker, settles its load unavailable and makes a new one", async () => {
    const { city, workers } = setup();
    const handle = city.load(BERN, { zoom: 12 });
    workers[0]?.crash("");
    expect(workers[0]?.terminated()).toBe(1);
    expect(await handle.finished).toMatchObject({ outcome: "unavailable" });
    expect(city.state()).toMatchObject({
      phase: "failed",
      message: "the city's worker failed",
    });
    expect(city.state().load?.ended).toBe(true);
    city.load(BERN, { zoom: 12 });
    expect(workers).toHaveLength(2);
    expect(workers[1]?.posted).toEqual([
      { kind: "load", id: 2, target: BERN, zoom: 12, heightsUrl: undefined },
    ]);
  });
});

describe("createGlobeCity: dispose", () => {
  it("frees the objects, takes the root off and ends the worker", async () => {
    const { city, parent, workers, three } = setup();
    city.load(BERN, { zoom: 12 });
    workers[0]?.reply(delivery(1));
    await flush();
    const drawn = [...city.root.children];
    city.dispose();
    await flush();
    expect(three.disposed.at(-1)).toEqual(drawn);
    expect(city.root.parent).toBeNull();
    expect(parent.children).toEqual([]);
    expect(workers[0]?.terminated()).toBe(1);
  });
});
