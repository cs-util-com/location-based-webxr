/**
 * The walk's photos and the ring around a code, placed per station
 * through the viewer placement with the
 * framework's controller config captured (as `viewer-placement-viewing-log`
 * does), the bake and the photo decoder faked.
 *
 * Why these tests matter: the status line must say what
 * actually stands. Photos that decode up front (content no station holds)
 * report their progress and then the count that decoded; photos held by
 * stations are counted where they wait, never as placed; a walk or a ring
 * none of whose photos loads says so; and a code far from every station
 * still shows its ring after the lock.
 */
import { describe, expect, it, vi } from "vitest";
import { Scene, Texture } from "three";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import {
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import type * as CaptureBake from "./capture-bake.js";
import type * as ImagePlanes from "./image-planes.js";
import type { TourViewerSeams } from "./seams.js";
import { tourOf } from "./test-support/v3-tour.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";

interface Fakes {
  configs: QrTrackingControllerConfig[];
  /** The bake's answer: the walk's photos at their spots. */
  bake: unknown;
  /** The decoder's answer per photo name; a promise holds it back. */
  decode: (name: string) => unknown;
  names: WeakMap<object, string>;
  /** Whether the plane constructors throw (a GPU-side failure). */
  planesThrow: boolean;
}

const fake = vi.hoisted((): Fakes => ({
  configs: [],
  bake: null,
  decode: () => null,
  names: new WeakMap<object, string>(),
  planesThrow: false,
}));

vi.mock("gps-plus-slam-app-framework/ar/qr/qr-tracking-controller", () => ({
  createQrTrackingController: (config: QrTrackingControllerConfig) => {
    fake.configs.push(config);
    return {
      offerFrame: () => undefined,
      isBusy: () => false,
      status: "idle",
      reset: () => undefined,
      dispose: () => undefined,
    };
  },
}));
vi.mock("./capture-bake.js", async (importOriginal) => ({
  ...(await importOriginal<typeof CaptureBake>()),
  bakeCaptureSpots: () => Promise.resolve(fake.bake),
}));
vi.mock("./image-planes.js", async (importOriginal) => {
  const real = await importOriginal<typeof ImagePlanes>();
  return {
    ...real,
    placeCapturedImagePlanes: (
      ...args: Parameters<typeof real.placeCapturedImagePlanes>
    ) => {
      if (fake.planesThrow) throw new Error("no GPU memory");
      return real.placeCapturedImagePlanes(...args);
    },
    placeImagePlanes: (...args: Parameters<typeof real.placeImagePlanes>) => {
      if (fake.planesThrow) throw new Error("no GPU memory");
      return real.placeImagePlanes(...args);
    },
  };
});
vi.mock(
  "gps-plus-slam-app-framework/visualization/frame-texture-decoder",
  () => ({
    decodeFrameTexture: (blob: Blob) =>
      Promise.resolve(fake.decode(fake.names.get(blob) ?? "")),
  }),
);

const TEXT = "https://example.test/t?c=1";
const ZERO = { lat: 47.5, lon: 8.7 };
const FLAT: [number, number, number, number] = [0, 0, 0, 1];

/** A geo pose `north` / `east` metres from the zero. */
function at(north: number, east: number) {
  const g = calcGpsCoords(ZERO, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt: 400, rotation: FLAT };
}

function level(north: number, east: number): QrLevel {
  const g = at(north, east);
  return {
    version: 1,
    qr: {
      physicalSizeM: 0.2,
      geo: { lat: g.lat, lon: g.lon, alt: 400, headingDeg: 0 },
    },
  };
}

function detection(): QrDetectionEvent {
  return {
    text: TEXT,
    qrPoseWorld: { position: [0, 1, -2], rotation: FLAT },
    qrPoseInCamera: { position: [0, 0, -2], rotation: FLAT },
    reprojectionErrorPx: 0.5,
    timestamp: 0,
    corners: [],
    cameraPose: { position: [0, 1.5, 0], rotation: FLAT },
    imageWidth: 640,
    imageHeight: 480,
    intrinsics: { fx: 500, fy: 500, cx: 320, cy: 240 },
  } as unknown as QrDetectionEvent;
}

function vote(): RecordGpsEventPayload {
  return {
    odomPosition: [0, 0, -2],
    odomRotation: FLAT,
    rawGpsPoint: {
      id: "vote-0",
      latitude: ZERO.lat,
      longitude: ZERO.lon,
      altitude: 400,
      latLongAccuracy: 5,
      timestamp: 0,
    },
  };
}

/** A pin standing `north` / `east` metres from the zero (its own station,
 *  `st-<id>`, `tourOf`). */
function pin(id: string, north: number, east: number): TourObject {
  return {
    id,
    kind: "pin",
    label: id,
    createdAtIso: "2026-10-19T08:00:00.000Z",
    geo: at(north, east),
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

function harness(input: {
  /** The tour's objects (each its own station). */
  objects?: TourObject[];
  /** The walk's photos at these spots, joined live (no station). */
  walk?: { north: number; east: number }[];
  /** A ring of these image entries (a tour without a walk). */
  ringImages?: string[];
  /** Where the code hangs. */
  code?: { north: number; east: number };
}) {
  fake.configs.length = 0;
  fake.planesThrow = false;
  const ctx = createTourViewerSession();
  const code = input.code ?? { north: 0, east: 0 };
  ctx.levelByText.set(TEXT, level(code.north, code.east));
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  const scene = new Scene();
  fake.bake =
    input.walk === undefined
      ? { kind: "declined", reason: "no recording in this tour" }
      : {
          kind: "baked",
          spots: {
            fixes: 4,
            gpsAccuracyMedianM: 3,
            captures: input.walk.map((p, i) => ({
              image: `images/frame-${String(i)}.png`,
              geo: at(p.north, p.east),
            })),
          },
        };
  const loadEntry = (name: string) => {
    const blob = new Blob([name]);
    fake.names.set(blob, name);
    return Promise.resolve(blob);
  };
  ctx.session = {
    hasRecording: input.walk !== undefined,
    archive: { url: "https://example.test/tour.zip" },
    entries: (input.ringImages ?? []).map((filename) => ({
      filename,
      isImage: true,
      size: 3,
    })),
    loadEntry,
    loadContentEntry: loadEntry,
  } as unknown as TourSession;
  ctx.tourDocument.open(tourOf(input.objects ?? []));
  ctx.tourManifestStatus = "settled";
  ctx.scanGate = { kind: "passed", via: "code" };
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => scene,
    createLabel: () => ({
      object: new Scene(),
      dispose: () => undefined,
    }),
  } as unknown as TourViewerSeams;
  const placement = createViewerPlacement({
    ctx,
    mode: "visitor",
    arStore: store,
    arController: { getState: () => ({ status: "running" }) } as never,
    seams,
    errorBox: { textContent: "" } as HTMLElement,
    escapeButton: {
      hidden: true,
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement,
    hooks: createUnwiredHooks(),
    now: () => 1000,
  });
  placement.startViewerPipeline();
  const config = fake.configs[0];
  if (config === undefined) throw new Error("no controller was built");
  const lock = async () => {
    config.onDetection?.(detection());
    config.dispatchVotes([vote()]);
    await flush();
  };
  const groups = () => scene.children.map((c) => c.name);
  return { ctx, store, scene, placement, lock, groups };
}

/** A decoder that holds every photo until released, in order. */
function heldDecoder() {
  const waiting: (() => void)[] = [];
  fake.decode = () =>
    new Promise((resolve) => {
      waiting.push(() => {
        resolve(new Texture());
      });
    });
  return {
    releaseOne: async () => {
      waiting.shift()?.();
      await flush();
    },
  };
}

describe("the walk's photos and the ring, said as they stand", () => {
  it("a walk no station holds says how far its photos have loaded, then how many stand", async () => {
    const decoder = heldDecoder();
    const h = harness({
      walk: [
        { north: 1, east: 0 },
        { north: 2, east: 0 },
        { north: 3, east: 0 },
      ],
    });
    await h.lock();
    expect(h.ctx.placement).toEqual({
      kind: "placing",
      phase: "loading-photos",
      done: 0,
      total: 3,
    });
    await decoder.releaseOne();
    expect(h.ctx.placement).toMatchObject({
      kind: "placing",
      phase: "loading-photos",
      done: 1,
      total: 3,
    });
    await decoder.releaseOne();
    await decoder.releaseOne();
    expect(h.ctx.placement).toEqual({
      kind: "placed",
      placedKind: "capture-spots",
      count: 3,
      atStations: 0,
      fixes: 4,
      gpsAccuracyMedianM: 3,
    });
    expect(h.groups()).toEqual(["station-content:loose:always"]);
    expect(h.ctx.viewerPlanesError).toBeNull();
  });

  it("a walk none of whose photos loads says so, and places nothing", async () => {
    fake.decode = () => null;
    const h = harness({
      walk: [
        { north: 1, east: 0 },
        { north: 2, east: 0 },
      ],
    });
    await h.lock();
    expect(h.ctx.placement).toMatchObject({
      kind: "placed",
      placedKind: "capture-spots",
      count: 0,
    });
    expect(h.ctx.viewerPlanesError).not.toBeNull();
  });

  it("a ring none of whose images loads says so", async () => {
    fake.decode = () => null;
    const h = harness({ ringImages: ["a.png", "b.png", "c.png"] });
    await h.lock();
    expect(h.ctx.placement).toMatchObject({
      kind: "placed",
      placedKind: "ring",
      count: 0,
    });
    expect(h.ctx.viewerPlanesError).not.toBeNull();
  });

  // Why: a walk or a ring whose planes cannot be built must neither leak
  // the photos it decoded nor leave the line on "Loading the photos…"
  // forever.
  it.each(["walk", "ring"] as const)(
    "a %s whose planes cannot be built frees its decoded photos and says so",
    async (what) => {
      const textures: Texture[] = [];
      const disposed = new Set<Texture>();
      fake.decode = () => {
        const texture = new Texture();
        textures.push(texture);
        texture.addEventListener("dispose", () => disposed.add(texture));
        return texture;
      };
      const h = harness(
        what === "walk"
          ? {
              walk: [
                { north: 1, east: 0 },
                { north: 2, east: 0 },
              ],
            }
          : { ringImages: ["a.png", "b.png"] },
      );
      fake.planesThrow = true;
      await h.lock();
      expect(textures).toHaveLength(2);
      expect(disposed.size).toBe(2);
      expect(h.ctx.placement).toMatchObject({ kind: "placed", count: 0 });
      expect(h.ctx.viewerPlanesError).not.toBeNull();
    },
  );

  it("a code outside every station's radius shows its ring after the lock, with no station present", async () => {
    fake.decode = () => new Texture();
    const h = harness({
      objects: [pin("far", 100, 0)],
      ringImages: ["a.png", "b.png", "c.png"],
    });
    await h.lock();
    expect(h.groups()).toEqual(["station-content:loose:always"]);
    expect(h.ctx.placement).toEqual({
      kind: "placed",
      placedKind: "ring",
      count: 3,
      atStations: 0,
    });
  });

  it("a ring held by a station is counted where it waits, not as placed, and decodes nothing until the station shows", async () => {
    const decoded: string[] = [];
    fake.decode = (name) => {
      decoded.push(name);
      return new Texture();
    };
    const h = harness({
      objects: [pin("near", 10, 0)],
      ringImages: ["a.png", "b.png", "c.png"],
    });
    await h.lock();
    expect(h.ctx.placement).toEqual({
      kind: "placed",
      placedKind: "ring",
      count: 0,
      atStations: 3,
    });
    expect(decoded).toEqual([]);
    expect(h.ctx.stationContent?.showsAny()).toBe(false);
  });

  it("a walk held by stations is counted at its stations, decoded only there", async () => {
    const decoded: string[] = [];
    fake.decode = (name) => {
      decoded.push(name);
      return new Texture();
    };
    const h = harness({
      objects: [pin("near", 0, 0)],
      walk: [
        { north: 1, east: 0 },
        { north: 2, east: 0 },
      ],
    });
    await h.lock();
    expect(h.ctx.placement).toEqual({
      kind: "placed",
      placedKind: "capture-spots",
      count: 0,
      atStations: 2,
      fixes: 4,
      gpsAccuracyMedianM: 3,
    });
    expect(decoded).toEqual([]);
  });
});
