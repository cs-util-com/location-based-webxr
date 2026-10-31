/**
 * The viewer placement and a station's reached story blocks (station
 * blocks plan, step 2), and a visitor's view choice redrawing them.
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
import { guideTourChanged, showAllContentSet } from "./visitor-guide-slice.js";
import { blockShown, walkStarted } from "./visitor-walk-slice.js";
import type { NarrationVerdict } from "./narration-timing.js";
import {
  selectVisitorPrefs,
  visitorPrefsLoaded,
  type VisitorPrefsState,
} from "./visitor-prefs-slice.js";
import { storeVisitorChoice, withPreferredView } from "./visitor-prefs.js";

/** A visitor's choice the way the page makes it (no device storage
 *  here): merged into the store's value and dispatched. */
function chooseView(
  store: {
    getState(): { readonly visitorPrefs: VisitorPrefsState };
    dispatch(action: ReturnType<typeof visitorPrefsLoaded>): unknown;
  },
  view: string | null,
): void {
  const { value } = storeVisitorChoice(
    undefined,
    selectVisitorPrefs(store.getState()),
    "longText",
    "world",
    view,
  );
  store.dispatch(visitorPrefsLoaded(value));
}

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

// The stands draw on a 2D canvas, which node has not; each stand here is
// an empty object named as the real one is, so a test reads the view a
// block was drawn in.
vi.mock("./lectern-view.js", async () => {
  const { Object3D: O } = await import("three");
  return {
    mountLectern: (block: { id: string }) => {
      const object = new O();
      object.name = "lectern";
      return { blockId: block.id, object, page: object, dispose: () => {} };
    },
  };
});
vi.mock("./reading-sign.js", async () => {
  const { Object3D: O } = await import("three");
  return {
    mountReadingSign: (block: unknown) => {
      const object = new O();
      object.name = "reading-sign";
      return { block, object, plate: object, dispose: () => {} };
    },
  };
});

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

function harness(
  stations: readonly TourStation[] = [STATION],
  narration?: {
    verdictOf(block: unknown): NarrationVerdict | undefined;
    revision(): number;
  },
) {
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
  ctx.tourDocument.open(tourOf([], { stations: [...stations] }));
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
    ...(narration === undefined ? {} : { narration }),
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
  return { ctx, store, scene, placement, lock, sync, drawn, frames, labels };
}

describe("a station's reached story blocks (B2b)", () => {
  it("stand in the station's world once reached, for a tour with no free block, and go with a new walk", async () => {
    const h = harness();
    h.store.dispatch(
      walkStarted({ order: "fixed", route: walkRoute([STATION], new Set()) }),
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
      walkStarted({ order: "fixed", route: walkRoute([STATION], new Set()) }),
    );
    await h.sync();
    expect(h.drawn()).toEqual([]);
  });
});

describe("a visitor's view choice", () => {
  // Why this test matters: the choice reaches the blocks already standing
  // (station blocks design §4): a long text the creator set as a reading
  // sign is drawn again as a lectern once the visitor picks it, and as the
  // creator's sign again when the choice is cleared - without a new
  // placement or a new walk.
  it("draws a standing long text again in the chosen view, and back", async () => {
    const station: TourStation = {
      ...STATION,
      blocks: [
        {
          id: "essay",
          kind: "longText",
          view: "reading",
          title: "E",
          body: "Plain words.",
          pose: POSE,
        },
      ],
      steps: [],
    };
    const h = harness([station]);
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    await h.sync();
    const nameOf = (): string | undefined => {
      let name: string | undefined;
      h.scene.traverse((o) => {
        if (o.userData["objectId"] === "essay") name = o.name;
      });
      return name;
    };
    expect(nameOf()).toBe("reading-sign");
    const choose = (view: string | null) => {
      chooseView(h.store, view);
    };
    choose("lectern");
    await h.sync();
    expect(nameOf()).toBe("lectern");
    expect(h.frames(), "the old part is replaced, not added to").toBe(1);
    choose(null);
    await h.sync();
    expect(nameOf()).toBe("reading-sign");
  });

  // Why this test matters: captions are chosen before the text's
  // read-along has been read; when it turns out stale the text must fall
  // back to the creator's view in the world. Nothing but the settled
  // read-along changes then (no choice, no new placement), so the part is
  // drawn again only if the narration's revision is looked at.
  it("draws a captions text again in the creator's view once its read-along turns out stale", async () => {
    const station: TourStation = {
      ...STATION,
      blocks: [
        {
          id: "essay",
          kind: "longText",
          view: "lectern",
          title: "E",
          body: "Plain words.",
          narration: {
            audio: "voice",
            timing: "timing/essay.json",
            synthetic: true,
          },
          pose: POSE,
        },
      ],
      steps: [],
    };
    let verdict: NarrationVerdict = "live";
    let revision = 0;
    const h = harness([station], {
      verdictOf: () => verdict,
      revision: () => revision,
    });
    h.store.dispatch(
      visitorPrefsLoaded(
        withPreferredView(null, "longText", "world", "captions"),
      ),
    );
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    await h.sync();
    const nameOf = (): string | undefined => {
      let name: string | undefined;
      h.scene.traverse((o) => {
        if (o.userData["objectId"] === "essay") name = o.name;
      });
      return name;
    };
    expect(nameOf(), "captions draw the reading sign in the world").toBe(
      "reading-sign",
    );
    verdict = "stale";
    await h.sync();
    expect(nameOf(), "nothing settled yet: the part stands").toBe(
      "reading-sign",
    );
    revision = 1;
    await h.sync();
    expect(nameOf()).toBe("lectern");
    expect(h.frames(), "the old part is replaced, not added to").toBe(1);
  });

  /** The object a block is drawn as, by its id (null: not drawn). */
  function objectOf(scene: Scene, id: string): Object3D | null {
    let found: Object3D | null = null;
    scene.traverse((o) => {
      if (o.userData["objectId"] === id) found = o;
    });
    return found;
  }

  const choose = (h: ReturnType<typeof harness>, view: string | null) => {
    chooseView(h.store, view);
  };

  // Why this test matters: a station's part is drawn again only when what
  // one of its blocks shows changes. Rebuilding it otherwise re-parses its
  // models, snaps a moved toy back, closes an open model card and turns a
  // lectern back to its first page. The same choice stored again (a new
  // value, the same content), and a choice a block cannot follow (a body
  // with a picture stays a reading sign), keep the part as it stands.
  it("keeps a station's part when no block's shown view changes", async () => {
    const station: TourStation = {
      ...STATION,
      blocks: [
        {
          id: "plain",
          kind: "longText",
          view: "reading",
          title: "P",
          body: "Plain words.",
          pose: POSE,
        },
      ],
      steps: [],
    };
    const pictured: TourStation = {
      ...STATION,
      id: "mill",
      blocks: [
        {
          id: "pictured",
          kind: "longText",
          view: "reading",
          title: "M",
          body: "Before.\n\n![The mill](asset:mill)",
          pose: POSE,
        },
      ],
      steps: [],
    };
    const h = harness([station, pictured]);
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    await h.sync();
    const millSign = objectOf(h.scene, "pictured");
    expect(millSign?.name).toBe("reading-sign");
    choose(h, "lectern");
    await h.sync();
    const lectern = objectOf(h.scene, "plain");
    expect(lectern?.name).toBe("lectern");
    expect(objectOf(h.scene, "pictured"), "no picture on a lectern").toBe(
      millSign,
    );
    choose(h, "lectern");
    await h.sync();
    expect(objectOf(h.scene, "plain"), "the same choice again").toBe(lectern);
    expect(objectOf(h.scene, "pictured")).toBe(millSign);
  });

  // Why this test matters: a reached story block's part is replaced in
  // place when its shown view changes. Taking it out first left a
  // station that holds only story parts with none for a moment, which
  // tore its whole group down: everything it showed blinked out and
  // faded in again.
  it("replaces a story block's part without taking its station down", async () => {
    const station: TourStation = {
      ...STATION,
      blocks: [
        {
          id: "essay",
          kind: "longText",
          view: "reading",
          title: "E",
          body: "Plain words.",
          pose: POSE,
        },
      ],
      steps: [
        {
          id: "s1",
          action: { kind: "show", block: "essay" },
          advance: { mode: "tap" },
        },
      ],
    };
    const h = harness([station]);
    h.store.dispatch(
      walkStarted({ order: "fixed", route: walkRoute([station], new Set()) }),
    );
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    h.store.dispatch(blockShown({ stationId: "gate", blockId: "essay" }));
    await h.sync();
    expect(objectOf(h.scene, "essay")?.name).toBe("reading-sign");
    const group = h.scene.getObjectByName("station-content:gate");
    expect(group).toBeDefined();
    choose(h, "lectern");
    await h.sync();
    expect(objectOf(h.scene, "essay")?.name).toBe("lectern");
    expect(h.frames(), "replaced, not added to").toBe(1);
    expect(
      h.scene.getObjectByName("station-content:gate"),
      "the station's group stood throughout",
    ).toBe(group);
  });

  // Why this test matters: the choice is the device's, not the tour's. A
  // visitor's page has no way to open another tour without loading the
  // page again (the open form is a creator's), so the e2e reloads per
  // tour; this pins the in-page half: after the tour switch's teardown
  // (its content disposed, its guide reset) the next tour's long text is
  // placed in the view chosen in the last one.
  it("keeps the choice for the next tour opened in the same page", async () => {
    const first: TourStation = {
      ...STATION,
      blocks: [
        {
          id: "essay",
          kind: "longText",
          view: "reading",
          title: "E",
          body: "Plain words.",
          pose: POSE,
        },
      ],
      steps: [],
    };
    const h = harness([first]);
    await h.lock();
    h.ctx.placementUnsubscribe = () => undefined;
    h.placement.tryPlaceTour();
    h.store.dispatch(showAllContentSet(true));
    await h.sync();
    choose(h, "lectern");
    await h.sync();
    expect(objectOf(h.scene, "essay")?.name).toBe("lectern");
    // The tour switch's teardown (`archive-open.ts`), then the next tour.
    h.ctx.stationContent?.dispose();
    h.ctx.stationContent = null;
    h.ctx.contentAttempted = false;
    h.store.dispatch(guideTourChanged());
    h.ctx.tourDocument.close();
    h.ctx.tourDocument.open(
      tourOf([], {
        stations: [
          {
            ...first,
            id: "keep",
            blocks: [
              {
                id: "keep-essay",
                kind: "longText",
                view: "reading",
                title: "K",
                body: "Other words.",
                pose: POSE,
              },
            ],
          },
        ],
      }),
    );
    h.store.dispatch(showAllContentSet(true));
    h.placement.tryPlaceTour();
    await h.sync();
    expect(objectOf(h.scene, "essay"), "the first tour's text is gone").toBe(
      null,
    );
    expect(objectOf(h.scene, "keep-essay")?.name).toBe("lectern");
  });
});
