/**
 * The viewer placement and a tour's debug camera captures, with the
 * framework's controller config captured (as `viewer-placement-viewing-log`
 * does), the photo decoder faked.
 *
 * Why this test matters: a visitor sees the tour's own content only. The
 * frames a recording captured by itself are debug data, which a tour.json
 * may still carry as `captureSpots` (the format keeps them, deprecated);
 * the viewer must draw none of them and read none of their files.
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

import type { TourViewerSeams } from "./seams.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { showAllContentSet } from "./visitor-guide-slice.js";

interface Fakes {
  configs: QrTrackingControllerConfig[];
  /** The decoder's answer per photo name; a promise holds it back. */
  decode: (name: string) => unknown;
  names: WeakMap<object, string>;
}

const fake = vi.hoisted((): Fakes => ({
  configs: [],
  decode: () => null,
  names: new WeakMap<object, string>(),
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
  /** Debug camera captures the tour.json carries (`captureSpots`), each
   *  held by the station of the object it names. */
  baked?: { holder: string }[];
  /** The zip carries a walk recording and its frames. */
  walkInZip?: boolean;
}) {
  fake.configs.length = 0;
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

describe("a visitor never sees a debug camera capture", () => {
  it("draws no frame of a tour.json that carries capture spots, and reads none", async () => {
    // Why: the frames a recording captures by itself are debug data, shown
    // only in the desktop editor's debug layer. They were once drawn for a
    // visitor as photo planes at their stations, from the `captureSpots` a
    // creator's open baked into tour.json; a visitor now draws none of
    // them, reads none of their files, and the line says nothing of them,
    // whatever the file carries (the zip's walk and images included).
    const decoded: string[] = [];
    fake.decode = (name) => {
      decoded.push(name);
      return new Texture();
    };
    const h = harness({
      objects: [pin("a", 0, 0), pin("b", 100, 0)],
      baked: [{ holder: "a" }, { holder: "a" }, { holder: "b" }],
      walkInZip: true,
    });
    await h.lock();
    // The session's placement trigger, as the AR entry subscribes it.
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    await h.showAll();
    expect(h.ctx.placement).toEqual({ kind: "idle" });
    expect(decoded).toEqual([]);
    expect(h.loaded).toEqual([]);
    // The pins stand at their stations: the tour's own content still shows.
    expect(h.groups().sort()).toEqual([
      "station-content:st-a",
      "station-content:st-b",
    ]);
  });
});
