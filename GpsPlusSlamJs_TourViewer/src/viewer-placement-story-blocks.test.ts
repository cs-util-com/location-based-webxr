/**
 * The viewer placement and a station's reached story blocks (station
 * blocks plan B2b step 2, B-Q4).
 *
 * Why this test matters: a story pin, picture or placed model stands in
 * the world from the step that reaches it for the rest of the visit, in
 * its station's frame beside the station's free blocks. A tour whose
 * stations hold no free block at all still has world content then, and a
 * new walk takes the reached blocks out again.
 */
import { describe, expect, it, vi } from "vitest";
import { Object3D, Scene } from "three";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  QrDetectionEvent,
  QrTrackingControllerConfig,
} from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  setZeroPos,
  type RecordGpsEventPayload,
} from "gps-plus-slam-app-framework/state";

import type { TourViewerSeams } from "./seams.js";
import { walkRoute } from "./station-run.js";
import { tourOf } from "./test-support/tour-of.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import { createViewerPlacement } from "./viewer-placement.js";
import { showAllContentSet } from "./visitor-guide-slice.js";
import { blockShown, walkStarted } from "./visitor-walk-slice.js";

const fake = vi.hoisted(() => ({
  configs: [] as QrTrackingControllerConfig[],
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

const TEXT = "https://example.test/t?c=1";
const ZERO = { lat: 47.5, lon: 8.7 };
const FLAT: [number, number, number, number] = [0, 0, 0, 1];
const POSE = {
  position: [1, 1.5, 0] as [number, number, number],
  rotation: FLAT,
};

const STATION: TourStation = {
  id: "gate",
  geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 400, rotation: FLAT },
  activateRadiusM: 20,
  foundRadiusM: 5,
  hint: "arrow",
  blocks: [
    {
      id: "sign",
      kind: "shortText",
      view: "pin",
      caption: "Old sign",
      pose: POSE,
    },
    {
      id: "words",
      kind: "longText",
      view: "card",
      title: "W",
      body: "W",
      pose: POSE,
    },
  ],
  steps: [
    {
      id: "s1",
      action: { kind: "show", block: "sign" },
      advance: { mode: "tap" },
    },
    {
      id: "s2",
      action: { kind: "show", block: "words" },
      advance: { mode: "tap" },
    },
  ],
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

function harness() {
  fake.configs.length = 0;
  const ctx = createTourViewerSession();
  const level: QrLevel = {
    version: 1,
    qr: {
      physicalSizeM: 0.2,
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 400, headingDeg: 0 },
    },
  };
  ctx.levelByText.set(TEXT, level);
  const store = createTourViewerStore();
  store.dispatch(setZeroPos(ZERO));
  const scene = new Scene();
  ctx.session = {
    hasRecording: false,
    archive: { url: "https://example.test/tour.zip" },
    entries: [],
    loadEntry: () => Promise.resolve(new Blob([])),
    loadContentEntry: () => Promise.resolve(new Blob([])),
  } as unknown as TourSession;
  ctx.tourDocument.open(tourOf([], { stations: [STATION] }));
  ctx.tourManifestStatus = "settled";
  ctx.scanGate = { kind: "passed", via: "code" };
  const labels: string[] = [];
  const seams = {
    schedule: () => () => undefined,
    createQrFrontEnd: () => ({
      kind: "barcode-detector",
      detect: () => Promise.resolve(null),
    }),
    solveQrPose: () => null,
    getIntrinsics: () => null,
    getScene: () => scene,
    createLabel: (text: string) => {
      labels.push(text);
      return { object: new Object3D(), dispose: () => undefined };
    },
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
    config.onDetection?.({
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
    } as unknown as QrDetectionEvent);
    const vote: RecordGpsEventPayload = {
      odomPosition: [0, 0, -2],
      odomRotation: FLAT,
      rawGpsPoint: {
        id: "v",
        latitude: ZERO.lat,
        longitude: ZERO.lon,
        altitude: 400,
        latLongAccuracy: 5,
        timestamp: 0,
      },
    };
    config.dispatchVotes([vote]);
    await flush();
  };
  const sync = async () => {
    placement.syncContent();
    await flush();
  };
  /** The object ids drawn under the station's content group. */
  const drawn = () => {
    const ids: string[] = [];
    scene.getObjectByName("station-content:gate")?.traverse((o) => {
      const id = o.userData["objectId"];
      if (typeof id === "string") ids.push(id);
    });
    return ids;
  };
  /** The parts the station's content group holds: one frame per drawn
   *  part, an empty one too - a block the renderer draws as nothing (a
   *  card) still leaves its frame, so this sees a part the ids cannot. */
  const frames = () =>
    scene.getObjectByName("station-content:gate")?.children.length ?? 0;
  return { ctx, store, placement, lock, sync, drawn, frames, labels };
}

describe("a station's reached story blocks (B2b)", () => {
  it("stand in the station's world once reached, for a tour with no free block, and go with a new walk", async () => {
    const h = harness();
    h.store.dispatch(
      walkStarted({ order: "fixed", route: walkRoute([STATION]) }),
    );
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    await h.sync();
    expect(h.drawn(), "nothing before its step").toEqual([]);
    h.store.dispatch(blockShown({ stationId: "gate", blockId: "sign" }));
    await h.sync();
    expect(h.drawn()).toEqual(["sign"]);
    expect(h.labels).toEqual(["Old sign"]);
    expect(h.frames()).toBe(1);
    // A card never stands in the world, reached or not: no part is made
    // for it. (The ids alone cannot tell - the renderer draws a card as
    // nothing, so a part made for it would leave the ids as they are.)
    h.store.dispatch(blockShown({ stationId: "gate", blockId: "words" }));
    await h.sync();
    expect(h.drawn()).toEqual(["sign"]);
    expect(h.frames(), "no part for the card").toBe(1);
    // A new walk starts without it.
    h.store.dispatch(
      walkStarted({ order: "fixed", route: walkRoute([STATION]) }),
    );
    await h.sync();
    expect(h.drawn()).toEqual([]);
  });
});
