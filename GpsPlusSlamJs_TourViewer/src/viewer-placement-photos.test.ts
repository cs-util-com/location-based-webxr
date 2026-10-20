/**
 * The tour's recorded photos, placed per station through the viewer
 * placement with the framework's controller config captured (as
 * `viewer-placement-viewing-log` does), the photo decoder faked.
 *
 * Why these tests matter: a visitor sees only what the creator's open
 * baked into `tour.json`: each recorded photo at its spot, held by its
 * station and decoded only while that station shows. The status line says
 * how many wait at their stations, never more; a station none of whose
 * photos loads says so; and a tour without baked spots places no photo at
 * all, whatever the zip carries - not its walk, not its images.
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

import type * as ImagePlanes from "./image-planes.js";
import type { TourViewerSeams } from "./seams.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { presenceJudged, showAllContentSet } from "./visitor-guide-slice.js";

interface Fakes {
  configs: QrTrackingControllerConfig[];
  /** The decoder's answer per photo name; a promise holds it back. */
  decode: (name: string) => unknown;
  names: WeakMap<object, string>;
  /** Whether the plane constructor throws (a GPU-side failure). */
  planesThrow: boolean;
}

const fake = vi.hoisted((): Fakes => ({
  configs: [],
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
  /** The tour's objects (each its own station, `st-<id>`). */
  objects?: TourObject[];
  /** Recorded photos baked into the tour, each held by the station of the
   *  object it names. */
  baked?: { holder: string }[];
  /** The zip carries a walk recording and images (never shown). */
  walkInZip?: boolean;
}) {
  fake.configs.length = 0;
  fake.planesThrow = false;
  const ctx = createTourViewerSession();
  ctx.levelByText.set(TEXT, level(0, 0));
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  const scene = new Scene();
  const loaded: string[] = [];
  const loadEntry = (name: string) => {
    loaded.push(name);
    const blob = new Blob([name]);
    fake.names.set(blob, name);
    return Promise.resolve(blob);
  };
  ctx.session = {
    hasRecording: input.walkInZip === true,
    archive: { url: "https://example.test/tour.zip" },
    entries:
      input.walkInZip === true
        ? ["actions/000001.json", "images/frame-0.png", "a.png"].map(
            (filename) => ({
              filename,
              isImage: filename.endsWith(".png"),
              size: 3,
            }),
          )
        : [],
    loadEntry,
    loadContentEntry: loadEntry,
  } as unknown as TourSession;
  const baked = input.baked ?? [];
  ctx.tourDocument.open(
    tourOf(
      input.objects ?? [],
      baked.length === 0
        ? {}
        : {
            captureSpots: {
              fixes: 4,
              gpsAccuracyMedianM: 3,
              captures: baked.map((b, i) => ({
                image: `images/frame-${String(i)}.png`,
                station: stationIdOf(b.holder),
                pose: { position: [0, 0, 0], rotation: FLAT },
              })),
            },
          },
    ),
  );
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
  const showAll = async () => {
    store.dispatch(showAllContentSet(true));
    placement.syncContent();
    await flush();
  };
  const groups = () => scene.children.map((c) => c.name);
  return { ctx, store, scene, placement, lock, showAll, groups, loaded };
}

describe("the tour's recorded photos, said as they stand", () => {
  it("counts baked photos at their stations, and decodes none until a station shows", async () => {
    const decoded: string[] = [];
    fake.decode = (name) => {
      decoded.push(name);
      return new Texture();
    };
    const h = harness({
      objects: [pin("a", 0, 0), pin("b", 100, 0)],
      baked: [{ holder: "a" }, { holder: "a" }, { holder: "b" }],
    });
    await h.lock();
    expect(h.ctx.placement).toEqual({
      kind: "placed",
      placedKind: "capture-spots",
      count: 3,
      fixes: 4,
      gpsAccuracyMedianM: 3,
    });
    expect(decoded).toEqual([]);
    expect(h.ctx.stationContent?.showsAny()).toBe(false);
    // Every station shown: each photo in its own station's group.
    await h.showAll();
    expect(decoded.sort()).toEqual([
      "images/frame-0.png",
      "images/frame-1.png",
      "images/frame-2.png",
    ]);
    expect(h.groups().sort()).toEqual([
      "station-content:st-a",
      "station-content:st-b",
    ]);
  });

  it("places no photo for a tour without baked spots, whatever its zip carries", async () => {
    // Why: the walk and the zip's images were once shown to a visitor (a
    // live replay of the walk, or a ring of images around the code); a
    // visitor now sees only what the creator's open baked into the tour.
    fake.decode = () => new Texture();
    const h = harness({ objects: [pin("a", 0, 0)], walkInZip: true });
    await h.lock();
    await h.showAll();
    expect(h.ctx.placement).toEqual({ kind: "idle" });
    expect(h.ctx.imagePlanes).toBeNull();
    expect(h.loaded).toEqual([]);
    expect(h.ctx.viewerPlanesError).toBeNull();
  });

  it("a station none of whose photos loads says so", async () => {
    fake.decode = () => null;
    const h = harness({
      objects: [pin("a", 0, 0)],
      baked: [{ holder: "a" }, { holder: "a" }],
    });
    await h.lock();
    await h.showAll();
    expect(h.ctx.viewerPlanesError).toBe("2 photos could not be decoded");
  });

  // Why: a station whose planes cannot be built must not leak the photos
  // it decoded, and must say so.
  it("a station whose planes cannot be built frees its decoded photos and says so", async () => {
    const textures: Texture[] = [];
    const disposed = new Set<Texture>();
    fake.decode = () => {
      const texture = new Texture();
      textures.push(texture);
      texture.addEventListener("dispose", () => disposed.add(texture));
      return texture;
    };
    const h = harness({
      objects: [pin("a", 0, 0)],
      baked: [{ holder: "a" }, { holder: "a" }],
    });
    fake.planesThrow = true;
    await h.lock();
    await h.showAll();
    expect(textures).toHaveLength(2);
    expect(disposed.size).toBe(2);
    expect(h.ctx.viewerPlanesError).not.toBeNull();
  });

  it("a station whose photos all fail says so only until a later station's photos stand", async () => {
    // Why: the walk's parts mount per station visit, and a part none of
    // whose photos decodes says so on the photos' channel. Nothing cleared
    // it within a session, so one bad station left "could not be decoded"
    // on the line at every station after it, whose photos stood fine.
    fake.decode = (name) =>
      name === "images/frame-0.png" ? null : new Texture();
    const h = harness({
      objects: [pin("s1", 0, 0), pin("s2", 100, 0)],
      baked: [{ holder: "s1" }, { holder: "s2" }],
    });
    await h.lock();
    // The visitor at the first station: its photo fails.
    h.store.dispatch(
      presenceJudged({
        candidates: [{ id: "st-s1", distanceM: 0, foundM: 25, foundExitM: 30 }],
        accuracyM: null,
        codeLinedUp: true,
      }),
    );
    h.placement.syncContent();
    await flush();
    expect(h.ctx.viewerPlanesError).not.toBeNull();
    // The second station shows too, and its photo stands.
    await h.showAll();
    expect(h.ctx.viewerPlanesError).toBeNull();
  });
});
