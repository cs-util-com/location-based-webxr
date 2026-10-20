/**
 * The AR entry's session end (QR near-frontal pose plan §61-§64).
 *
 * Why these tests matter: the milestone review of b4b (§64 #4) found that
 * reverting the session end's `endQrPipeline(ctx)` to a bare
 * `ctx.qrController = null` passed every unit test - only the helper was
 * tested, never the call site. A QR decode still in flight when the session
 * ends then lands in the NEXT session (a dead-frame detection, stale status
 * lines). This drives the real `wireArEntry`: tap "Enter AR", take the
 * session callbacks it hands the AR controller, and end the session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESH_DEPTH } from "./mesh-surface.js";
import type { EnableGpsArConfig } from "gps-plus-slam-app-framework/ar";
import { wireArEntry, type ArEntryDom } from "./ar-entry.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
  type TourViewerSession,
} from "./tour-viewer-session.js";
import type { TourViewerSeams } from "./seams.js";
import {
  headingPendingSet,
  presenceCleared,
  presenceJudged,
  selectPresentStationId,
} from "./visitor-guide-slice.js";
import { RECORDING_DEPTH } from "./authoring-recording.js";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourOf } from "./test-support/v3-tour.js";
import {
  endSession,
  recordGpsEvent,
  selectGpsPositions,
  resetGpsSessionData,
  setZeroPos,
  reportUpdated,
  type TrackingQualityReport,
} from "gps-plus-slam-app-framework/state";

/** A stand-in element: the fields `wireArEntry` writes, and click handlers. */
function el() {
  const handlers = new Map<string, () => void>();
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    dataset: {} as Record<string, string>,
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

/** A tour with one station: finished (`tour-unfinished.ts`). */
const FINISHED_TOUR = tourOf([
  {
    id: "p1",
    kind: "pin",
    label: "Gate",
    geo: { lat: 47, lon: 8, alt: 400, rotation: [0, 0, 0, 1] },
    createdAtIso: "2026-10-20T00:00:00.000Z",
  } as unknown as TourObject,
]);

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function harness(
  options: {
    arStatus?: string;
    records?: boolean;
    enableOk?: boolean;
    mode?: "visitor" | "creator";
    locationPending?: () => boolean;
    codesOnly?: () => boolean;
    recheck?: () => Promise<void>;
    request?: () => Promise<unknown>;
    copyText?: (text: string) => Promise<void>;
    meshCursor?: boolean;
  } = {},
) {
  // The entry flags a running session on `document.body.dataset`; the
  // package tests run in node, so the page body is stood in.
  vi.stubGlobal("document", { body: { dataset: {} } });
  vi.stubGlobal("location", { href: "https://example.test/tour/?qr=abc" });
  const ctx = createTourViewerSession();
  // A finished tour (one station) unless a test closes it: a visitor's
  // line about an open tour assumes one with something to show.
  ctx.tourDocument.open(FINISHED_TOUR);
  const dispose = vi.fn();
  let enabled: EnableGpsArConfig | null = null;
  /** The controller's status, settable so a test can walk a session. */
  const ar = { status: options.arStatus ?? "ready" };
  const arController = {
    getState: () => ({ status: ar.status }),
    subscribe: () => () => undefined,
    refreshSupport: () => Promise.resolve(),
    enable: vi.fn((config: EnableGpsArConfig) => {
      enabled = config;
      // By default report a failed start: the session callbacks are already
      // handed over, and nothing after the enable needs a scene.
      return Promise.resolve({ ok: options.enableOk === true });
    }),
    disable: vi.fn(() => Promise.resolve()),
  };
  const hooks = createUnwiredHooks();
  // The viewer pipeline (stood in here) owns the controller and its source.
  hooks.startViewerPipeline = () => {
    ctx.qrController = { dispose } as unknown as NonNullable<
      typeof ctx.qrController
    >;
    ctx.fusedPose = {} as NonNullable<typeof ctx.fusedPose>;
    return true;
  };
  hooks.startAuthorPipeline = () => true;
  const dom = {
    arRoot: el(),
    arStatus: el(),
    arHint: el(),
    enterArButton: el(),
    sizeInput: el(),
    errorBox: el(),
    escapeButton: el(),
    arDebug: el(),
    arStatusLive: el(),
    scanCard: el(),
    scanCardLine: el(),
  };
  const arStore = createTourViewerStore();
  const seams = {
    stopCameraFrameCapture: () => undefined,
    // Enough of a scene for the runtime start to go through.
    getArWorldGroup: () => ({}),
    enableArWorldGroupAlignment: () => undefined,
    startCameraFrameCapture: () => undefined,
    createQrDebugView: () => ({
      update: () => undefined,
      dispose: () => undefined,
    }),
    startDepthCapture: vi.fn(),
    stopDepthCapture: vi.fn(),
    copyText: vi.fn(options.copyText ?? (() => Promise.resolve())),
    startHitTestReticle: vi.fn(() => ({
      isVisible: () => false,
      getWorldPosition: (out: unknown) => out,
      dispose: () => undefined,
    })),
    startMeshSurface: vi.fn(() => meshSurface),
  };
  const meshSurface = {
    pick: vi.fn(() => ({ position: "the mesh point" })),
    stats: () => ({
      frame: { p50: 16, p95: 30, p99: 38, max: 40, count: 120 },
      triangles: 1200,
    }),
    reset: vi.fn(),
    dispose: vi.fn(),
  };
  const entry = wireArEntry({
    ctx,
    mode: options.mode ?? "visitor",
    arStore,
    arController: arController as never,
    gpsHandler: () => undefined,
    seams: seams as unknown as TourViewerSeams,
    locationGate: {
      pending: options.locationPending ?? (() => false),
      busy: () => false,
      codesOnly: options.codesOnly ?? (() => false),
      recheck: options.recheck ?? (() => Promise.resolve()),
      request: options.request ?? (() => Promise.resolve()),
    } as never,
    dom: dom as unknown as ArEntryDom,
    hooks,
    ...(options.records === undefined
      ? {}
      : { recording: { beginOnArEntry: () => options.records === true } }),
    ...(options.meshCursor === undefined
      ? {}
      : { meshCursor: options.meshCursor }),
  });
  return {
    ctx,
    dom,
    entry,
    hooks,
    dispose,
    arStore,
    seams,
    arController,
    enabledConfig: () => enabled,
    meshSurface,
    setArStatus(status: string) {
      ar.status = status;
    },
    async enter() {
      dom.enterArButton.click();
      await settle();
    },
    async enterAndEnd() {
      dom.enterArButton.click();
      await settle();
      expect(arController.enable).toHaveBeenCalledTimes(1);
      enabled!.callbacks?.onSessionEnd?.({ requestedByApp: false });
    },
  };
}

describe("wireArEntry session end", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("settles the creator's visit BEFORE the store teardown resets the alignment", async () => {
    // Why this test matters (authoring plan 2026-09-28-0953 §3.2, M2c): the
    // settle recomputes the visit's geo through the store's alignment, and
    // `teardownArSessionState` (endSession, then resetGpsSessionData)
    // drops it. Settled after the teardown, every note would keep its
    // tap-time geo with nothing to say so. And the settle must still see
    // THIS visit's number, before the generation bump.
    const h = harness({ mode: "creator" });
    const order: string[] = [];
    const dispatch = h.arStore.dispatch.bind(h.arStore);
    h.arStore.dispatch = ((action: { type: string }) => {
      order.push(action.type);
      return dispatch(action as never);
    }) as typeof h.arStore.dispatch;
    h.hooks.endAuthorVisit = () => {
      order.push(`settle visit ${String(h.ctx.arSessionGeneration)}`);
    };

    await h.enterAndEnd();

    const settle = order.indexOf("settle visit 0");
    expect(settle).toBeGreaterThanOrEqual(0);
    expect(settle).toBeLessThan(order.indexOf(endSession.type));
    expect(settle).toBeLessThan(order.indexOf(resetGpsSessionData.type));
  });

  // Why this test matters: the station guide's end of session
  // dispatches into the store (its presence cleared). While the placement
  // trigger was still subscribed, that dispatch re-entered the placement
  // and the guide's tick mid-teardown - harmless only because the gate had
  // been set idle first. The trigger now ends before the guide's teardown,
  // so no order of the resets can place or re-publish presence.
  it("ends the placement trigger before the guide's teardown: a dispatch from it places nothing and ticks no station", async () => {
    const h = harness({ enableOk: true });
    await h.enter();
    expect(h.ctx.placementUnsubscribe).not.toBeNull();
    let attempts = 0;
    let ticks = 0;
    h.hooks.tryPlaceTour = () => {
      attempts += 1;
    };
    h.hooks.tickStations = () => {
      ticks += 1;
    };
    h.hooks.stopStations = () => {
      // A gate that still allows placement, whatever the reset order.
      h.ctx.scanGate = { kind: "passed", via: "code" };
      h.arStore.dispatch(presenceCleared());
    };
    h.enabledConfig()!.callbacks?.onSessionEnd?.({ requestedByApp: false });
    expect(attempts).toBe(0);
    expect(ticks).toBe(0);
    expect(h.ctx.placementUnsubscribe).toBeNull();
  });

  // Why this test matters (code book plan M6 v5.1): the settle compares the
  // odometry frame's epoch with the one at the visit's start, and decides no
  // automatic code move in a visit whose frame changed (two frames mixed).
  // A snapshot taken at the wrong moment, or never, would compare against
  // a stale epoch and judge every visit after a page's first restart.
  it("snapshots the odometry frame's epoch when the session's runtime starts", async () => {
    const h = harness({ mode: "creator", enableOk: true });
    h.arStore.dispatch({ type: "qrDetected/qrFrameChanged" } as never);
    h.arStore.dispatch({ type: "qrDetected/qrFrameChanged" } as never);
    expect(h.arStore.getState().qrDetected.frameEpoch).toBe(2);
    await h.enter();
    expect(h.ctx.frameEpochAtSessionStart).toBe(2);
  });

  it("does not settle anything when a visitor's session ends", async () => {
    const h = harness();
    let settled = 0;
    h.hooks.endAuthorVisit = () => {
      settled += 1;
    };
    await h.enterAndEnd();
    expect(settled).toBe(0);
  });

  it("disposes the QR controller and drops the session's fused pose source", async () => {
    const h = harness();
    await h.enterAndEnd();
    expect(h.dispose).toHaveBeenCalledTimes(1);
    expect(h.ctx.qrController).toBeNull();
    expect(h.ctx.fusedPose).toBeNull();
  });

  // Why (PR #624 review): the voted-lock count is per entry - the status
  // line's "N of 10 vote batches" and the hold line read it - so a count the
  // session end left behind would describe the previous entry's scan.
  it("zeroes the voted-lock count, so the next entry's scan counts afresh", async () => {
    const h = harness();
    await h.enter();
    h.ctx.viewerVotedLocks = 8;
    h.enabledConfig()!.callbacks?.onSessionEnd?.({ requestedByApp: false });
    expect(h.ctx.viewerVotedLocks).toBe(0);
  });

  // Why this test matters (owner report 2026-10-07): the pipeline starts
  // BEFORE the session is requested, and a declined permission prompt
  // fails the start. No session ever ran, so no session end disposed it,
  // and every "Try again" built another on top of it.
  it("disposes the QR controller it started when AR does not start", async () => {
    const h = harness();
    await h.enter();
    expect(h.arController.enable).toHaveBeenCalledTimes(1);
    expect(h.dispose).toHaveBeenCalledTimes(1);
    expect(h.ctx.qrController).toBeNull();
    // The half that keeps a late evaluation of a dead pipeline out of the
    // next entry (webxr PR #559 review).
    expect(h.ctx.fusedPose).toBeNull();
  });
});

// Plan §66-§67: the render reads the fused pose's debug state and hint. It
// runs per camera frame and had no unit harness (§67 review, "the #ar-debug
// render call"); this drives the real renderArStatus.
describe("wireArEntry QR readout and visitor hint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why (polish round C4, the M0a review #3): the store's median folds the
  // code's synthetic votes (5 m each) in, which would make poor indoor GPS
  // read about 5 m. The block's GPS line counts device fixes only.
  it("reads the GPS line's accuracy from device fixes only, not the code's votes", () => {
    const h = harness();
    const fix = (i: number, accuracy: number, source?: string) =>
      h.arStore.dispatch(
        recordGpsEvent({
          odomPosition: [i, 0, 0],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `fix-${String(i)}`,
            latitude: 47.5 + i * 1e-5,
            longitude: 8.7,
            altitude: 400,
            latLongAccuracy: accuracy,
            timestamp: 1_790_000_000_000 + i * 1000,
            ...(source === undefined ? {} : { source }),
          },
        } as never),
      );
    h.arStore.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    for (let i = 0; i < 3; i += 1) fix(i, 8.3);
    for (let i = 3; i < 9; i += 1) fix(i, 5, "synthetic-qr");
    h.ctx.debug = true;
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toMatch(
      /gps: ±8\.3 m median, extent [\d.]+ m over 3 fixes/,
    );
  });

  // Why (PR #583 review, rejected with this test): the review read the GPS
  // line's fix count as missing fixes that carry no accuracy (the field is
  // optional), so a device sending none would read "no fix yet" while their
  // extent was known. The store keeps no such fix, so the count is every
  // fix there is; if the store ever starts keeping them, this fails first.
  it("sees no fix without an accuracy: the store keeps none", () => {
    const h = harness();
    for (let i = 0; i < 4; i += 1) {
      h.arStore.dispatch(
        recordGpsEvent({
          odomPosition: [i, 0, 0],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `fix-${String(i)}`,
            latitude: 47.5 + i * 1e-5,
            longitude: 8.7,
            altitude: 400,
            timestamp: 1_790_000_000_000 + i * 1000,
          },
        } as never),
      );
    }
    h.arStore.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    expect(selectGpsPositions(h.arStore.getState())).toHaveLength(0);
    h.ctx.debug = true;
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toContain("gps: no fix yet");
  });

  it("writes the ?debug=1 block only with the flag", () => {
    const h = harness();
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toBe("");
    h.ctx.debug = true;
    h.entry.renderArStatus();
    // The GPS line (polish round C4) says there is no fix in the harness.
    expect(h.dom.arDebug.textContent).toBe(
      "qr: off\ngps: no fix yet\nno code evaluated yet",
    );
  });

  // Milestone review of b4c #2: the creator pipeline never writes the
  // viewer's status, so the block reads the running controller's own.
  it("heads the block with the running controller's status", () => {
    const h = harness();
    h.ctx.debug = true;
    h.ctx.qrController = { status: "tracking" } as never;
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent.split("\n")[0]).toBe("qr: tracking");
  });

  it("tells a visitor of a tour not finished yet so, without the scan card", () => {
    // Why: a tour without stations may carry its measured code; the line
    // says the tour is not finished (with the contact the tour names) and
    // the scan card, which would ask for the code, stays closed.
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.tourDocument.open({
      ...tourOf([]),
      contact: "guide@example.org",
    });
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).toBe(
      "This tour is not finished yet. Questions about this tour? Contact its maker: guide@example.org",
    );
    expect(h.dom.scanCard.hidden).toBe(true);
    expect(h.dom.arStatus.hidden).toBe(false);
    // A zip without tour.json is not finished either.
    h.ctx.tourDocument.close();
    h.ctx.tourDocument.open(null);
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).toBe("This tour is not finished yet.");
  });

  it("shows the fused pose's hint from the last evaluation while tracking", () => {
    const h = harness({ arStatus: "running" });
    // A tour is open, as on a phone (with none, the visitor reads "No tour
    // is open" since the U1 review, #6).
    h.ctx.session = {} as never;
    h.ctx.viewerQrStatus = "tracking";
    h.ctx.viewerLastEvaluation = {
      text: "https://gps.csutil.com/tour/?qr=x",
      result: { status: "measuring", notStableReason: "fit" } as never,
      atMs: performance.now(),
    };
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).toContain(
      "Measuring the code: keep moving slowly, still measuring.",
    );
  });

  // Why (r881 re-review L-F, L1): after a veto the voted count is 0, so
  // the code-measuring hint would show again. For the ignored code it
  // promised "Code measured - placing the tour.", which it cannot keep;
  // but a veto must not hide the hint of ANOTHER code (B) the visitor now
  // measures - the ignored text stays set until a code votes again.
  it("after a veto hides the ignored code's hint, never another code's", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.viewerQrStatus = "tracking";
    veto(h.ctx, "a");
    h.ctx.viewerLastEvaluation = {
      text: "https://gps.csutil.com/tour/?qr=b",
      result: { status: "measuring", notStableReason: "fit" } as never,
      atMs: performance.now(),
    };
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).toContain(
      "Measuring the code: keep moving slowly, still measuring.",
    );
    h.ctx.viewerLastEvaluation = {
      text: "https://gps.csutil.com/tour/?qr=a",
      result: { status: "stable" } as never,
      atMs: performance.now(),
    };
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).not.toContain("Code measured");
    expect(h.dom.arStatus.textContent).not.toContain("Measuring the code");
  });

  // Why: the status line names only the LATEST veto, and forgets it at
  // each AR entry, while the veto memory keeps every vetoed code for the
  // tour. Guarding the hint by the line's text let an earlier vetoed code,
  // or a vetoed code in a later AR entry, promise "placing the tour" again
  // although its votes are never counted.
  it("hides the hint of a code vetoed before the latest veto", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.viewerQrStatus = "tracking";
    veto(h.ctx, "a");
    veto(h.ctx, "b");
    h.ctx.viewerLastEvaluation = stableEvaluation("a");
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).not.toContain("Code measured");
  });

  it("hides the hint of a vetoed code in a later AR entry", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.viewerQrStatus = "tracking";
    veto(h.ctx, "a");
    // A new AR entry forgets the line's text; the memory stays.
    h.ctx.viewerIgnoredText = null;
    h.ctx.viewerLastEvaluation = stableEvaluation("a");
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).not.toContain("Code measured");
    // The control: a code nobody vetoed still promises it.
    h.ctx.viewerLastEvaluation = stableEvaluation("c");
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).toContain("Code measured");
  });
});

/** The moved-code check's veto of `?qr=<id>`, as the placement records it:
 *  the memory by level id, and the line's text. */
function veto(
  ctx: Pick<
    TourViewerSession,
    "levelIdByText" | "ignoredCodes" | "viewerIgnoredText"
  >,
  id: string,
): void {
  const text = `https://gps.csutil.com/tour/?qr=${id}`;
  ctx.levelIdByText.set(text, id);
  ctx.ignoredCodes.set(id, { text, vetoSpreadM: 1 });
  ctx.viewerIgnoredText = text;
}

function stableEvaluation(
  id: string,
): TourViewerSession["viewerLastEvaluation"] {
  return {
    text: `https://gps.csutil.com/tour/?qr=${id}`,
    result: { status: "stable" } as never,
    atMs: performance.now(),
  };
}

// The creator's troubleshooting recording (authoring recording plan
// 2026-09-28-0953, M1a, decision D4): a recorded entry carries depth samples
// instead of camera pictures. Why these tests matter: depth is requested at
// session start and sampled only once the runtime runs - wired at the wrong
// moment it is either never requested (no samples, no error) or requested
// for every visitor (a cost the isolation flags exist to avoid).
describe("wireArEntry depth for a recorded entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an entry the recording does not record asks for no depth and starts no sampler", async () => {
    const h = harness({ records: false, enableOk: true });
    await h.enter();

    expect(h.enabledConfig()?.isolationOptions?.enableDepthSensingFeature).toBe(
      false,
    );
    expect(h.enabledConfig()?.callbacks?.depth).toBeUndefined();
    expect(h.seams.startDepthCapture).not.toHaveBeenCalled();
  });

  it("a recorded entry requests depth, samples at the recording's rate, dispatches each sample, and stops at the session end", async () => {
    const h = harness({ records: true, enableOk: true });
    await h.enter();

    const config = h.enabledConfig();
    expect(config?.isolationOptions?.enableDepthSensingFeature).toBe(true);
    expect(h.seams.startDepthCapture).toHaveBeenCalledWith(RECORDING_DEPTH);

    const sample = { timestamp: 7, points: [] };
    config?.callbacks?.depth?.onCaptured(sample as never);
    expect(h.arStore.getState().recording.latestDepthSample).toEqual(sample);

    config?.callbacks?.onSessionEnd?.({ requestedByApp: false });
    expect(h.seams.stopDepthCapture).toHaveBeenCalledTimes(1);
  });
});

describe("the button is the way out of AR (UI round 1, U2, review F2)", () => {
  // Why: with no exit control a visitor who was done, or a creator who
  // wanted to stop without finishing, had to guess at the back gesture.
  it("ends a running session instead of starting one", async () => {
    const h = harness({ arStatus: "running" });
    await h.enter();
    expect(h.arController.disable).toHaveBeenCalledTimes(1);
    expect(h.arController.enable).not.toHaveBeenCalled();
  });
});

describe("the status line's channels (U1 milestone review #8, #9)", () => {
  // Why: the live region is what a screen reader announces; written per
  // camera frame it would re-announce endlessly, and the creator lost every
  // announcement when the visible line stopped being live. data-gate is the
  // e2e's proof that the CODE passed the gate (not GPS).
  it("writes the visitor's live sentence only when it changes", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    let writes = 0;
    let text = "";
    Object.defineProperty(h.dom.arStatusLive, "textContent", {
      get: () => text,
      set: (v: string) => {
        writes += 1;
        text = v;
      },
    });
    h.entry.renderArStatus();
    h.entry.renderArStatus();
    h.ctx.cameraFrameCount = 99;
    h.entry.renderArStatus();
    expect(writes).toBe(1);
    expect(text).toBe("Point your phone at the tour's code (on the poster).");
  });

  it("announces a creator's failed start, with its cause", () => {
    const h = harness({ arStatus: "error", mode: "creator" });
    h.entry.renderArStatus();
    expect(h.dom.arStatusLive.textContent).toBe("Creator mode — error");
  });

  it("names the gate on the line, for tests and styling", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.scanGate = { kind: "passed", via: "code" };
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset.gate).toBe("passed-code");
  });
});

describe("the visitor's step marker (polish round M4a, the owner's V4)", () => {
  // Why: the round button carries "1 of 2" while its tap only asks for the
  // location, and "2 of 2" after it, so the first tap reads as progress;
  // a visitor whose location was already allowed sees no marker at all.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves from 1 of 2 to 2 of 2 across the location tap", async () => {
    let pending = true;
    const h = harness({ locationPending: () => pending });
    expect(h.dom.enterArButton.dataset["step"]).toBe("1 of 2");
    await h.enter();
    pending = false;
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.dataset["step"]).toBe("2 of 2");
  });

  it("carries no marker when the location was already allowed", () => {
    const h = harness();
    expect(h.dom.enterArButton.dataset["step"]).toBeUndefined();
  });
});

describe("a visitor of a tour not finished yet gets no Start", () => {
  // Why: such a tour has nothing to show. A Start there asked for the
  // location (and, denied on a tour without codes, told the visitor to
  // change a browser setting) and opened an empty AR session; the start
  // page's sentence is the visitor's whole answer.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function unfinishedVisitor(manifest: "no stations" | "no tour.json") {
    const request = vi.fn(() => Promise.resolve("granted"));
    const h = harness({ locationPending: () => true, request });
    h.ctx.session = {} as never;
    h.ctx.tourDocument.close();
    h.ctx.tourDocument.open(manifest === "no stations" ? tourOf([]) : null);
    h.entry.renderArEntry();
    return { h, request };
  }

  it.each(["no stations", "no tour.json"] as const)(
    "hides the button and its hint (%s), and a tap asks for nothing",
    async (manifest) => {
      const { h, request } = unfinishedVisitor(manifest);
      expect(h.dom.enterArButton.hidden).toBe(true);
      expect(h.dom.arHint.hidden).toBe(true);
      // The page hides "What happens?" by this mark (index.html): it
      // describes a session the visitor cannot start.
      expect(h.dom.enterArButton.dataset["start"]).toBe("withheld");
      await h.enter();
      expect(request).not.toHaveBeenCalled();
      expect(h.arController.enable).not.toHaveBeenCalled();
    },
  );

  it("shows them while the tour.json is still being read, and for a finished tour", () => {
    // Tapped before the manifest settles, the session's status line says
    // the tour is not finished (`unfinishedTour`).
    const { h } = unfinishedVisitor("no tour.json");
    h.ctx.tourManifestStatus = "pending";
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.hidden).toBe(false);
    expect(h.dom.arHint.hidden).toBe(false);
    h.ctx.tourManifestStatus = "settled";
    h.ctx.tourDocument.close();
    h.ctx.tourDocument.open(FINISHED_TOUR);
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.hidden).toBe(false);
    expect(h.dom.arHint.hidden).toBe(false);
    expect(h.dom.enterArButton.dataset["start"]).toBe("offered");
  });

  it("keeps the button while a session runs: it is the way out", () => {
    const { h } = unfinishedVisitor("no stations");
    h.setArStatus("running");
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.hidden).toBe(false);
  });

  it("never hides a creator's button: the tour is the one being made", () => {
    const h = harness({ mode: "creator" });
    h.ctx.session = {} as never;
    h.ctx.tourDocument.close();
    h.ctx.tourDocument.open(tourOf([]));
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.hidden).toBe(false);
  });
});

describe("a visitor's phone without AR copies the link (polish round M4a, V4)", () => {
  // Why: a visitor who scanned the poster with a phone that cannot run AR
  // had a dead grey button. V4 makes it the way on: copy this page's link
  // and open it on a phone that can. The async-UI rule asks for the
  // outcome on the button, and a failure on the page's error channel.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies the page's link and says so", async () => {
    const h = harness({ arStatus: "unsupported" });
    expect(h.dom.enterArButton.textContent).toBe("Copy link");
    expect(h.dom.enterArButton.disabled).toBe(false);
    // The page's CSS steps the round button down on this state.
    expect(h.dom.enterArButton.dataset["arState"]).toBe("unsupported");
    await h.enter();
    expect(h.seams.copyText).toHaveBeenCalledWith(
      "https://example.test/tour/?qr=abc",
    );
    expect(h.dom.enterArButton.textContent).toBe("Link copied");
    expect(h.arController.enable).not.toHaveBeenCalled();
  });

  it("shows the busy state while the copy runs, and a failure on the error line", async () => {
    let fail: (err: Error) => void = () => undefined;
    const h = harness({
      arStatus: "unsupported",
      copyText: () => new Promise((_, reject) => (fail = reject)),
    });
    h.dom.enterArButton.click();
    expect(h.dom.enterArButton.textContent).toBe("Copying…");
    expect(h.dom.enterArButton.disabled).toBe(true);
    // The copy starts inside the chain, a microtask after the tap.
    await settle();
    fail(new Error("denied"));
    await settle();
    expect(h.dom.enterArButton.textContent).toBe("Copy link");
    expect(h.dom.enterArButton.disabled).toBe(false);
    expect(h.dom.errorBox.textContent).toMatch(/address bar/);
  });

  it("hides the AR hint, which would describe a session that cannot start", () => {
    const h = harness({ arStatus: "unsupported" });
    expect(h.dom.arHint.hidden).toBe(true);
  });
});

describe("the visitor's scan card (polish round M4b, the owner's S1)", () => {
  // Why: while the gate waits the card in the middle of the camera view
  // says what to do, so the same sentence must not also sit at the top
  // (the status line steps aside), and the card must close by itself when
  // the gate passes. With ?debug=1 the technical line stays visible.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the visitor's sentence in the card while the gate scans, and steps the line aside", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    h.entry.renderArStatus();
    expect(h.dom.scanCard.hidden).toBe(false);
    // The visitor's own sentence (here: no tour open in the harness),
    // the one the live region reads to a screen reader too.
    expect(h.dom.scanCardLine.textContent).not.toBe("");
    expect(h.dom.scanCardLine.textContent).toBe(h.dom.arStatusLive.textContent);
    expect(h.dom.arStatus.hidden).toBe(true);
  });

  it("closes once the gate passes, and gives the line back", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    h.entry.renderArStatus();
    h.ctx.scanGate = { kind: "passed", via: "code" };
    h.entry.renderArStatus();
    expect(h.dom.scanCard.hidden).toBe(true);
    expect(h.dom.scanCardLine.textContent).toBe("");
    expect(h.dom.arStatus.hidden).toBe(false);
  });

  it("keeps the technical line visible under ?debug=1", () => {
    const h = harness({ arStatus: "running" });
    h.ctx.debug = true;
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    h.entry.renderArStatus();
    expect(h.dom.scanCard.hidden).toBe(false);
    expect(h.dom.arStatus.hidden).toBe(false);
  });
});

describe("the visitor's button after the M4 review", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Why (review #1): without a clipboard (an http page, some in-app
  // browsers) the seam throws before it returns a promise; the button
  // stayed "Copying…" and disabled, and nothing was said.
  it("recovers from a clipboard that throws at once, and says so", async () => {
    const h = harness({
      arStatus: "unsupported",
      copyText: () => {
        throw new Error("no clipboard");
      },
    });
    await h.enter();
    expect(h.dom.enterArButton.textContent).toBe("Copy link");
    expect(h.dom.enterArButton.disabled).toBe(false);
    expect(h.dom.errorBox.textContent).toMatch(/address bar/);
  });

  it("clears an earlier failure once a copy works, and keeps its label through a re-render", async () => {
    let fail = true;
    let finish: () => void = () => undefined;
    const h = harness({
      arStatus: "unsupported",
      copyText: () =>
        fail
          ? Promise.reject(new Error("denied"))
          : new Promise<void>((resolve) => (finish = resolve)),
    });
    await h.enter();
    expect(h.dom.errorBox.textContent).toMatch(/address bar/);
    fail = false;
    h.dom.enterArButton.click();
    // A render while the copy runs (the permission query answering) must
    // not hand the button back mid-copy.
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.textContent).toBe("Copying…");
    expect(h.dom.enterArButton.disabled).toBe(true);
    await settle();
    finish();
    await settle();
    expect(h.dom.enterArButton.textContent).toBe("Link copied");
    expect(h.dom.errorBox.textContent).toBe("");
  });

  // Why (review #6): the marker counts the two taps of ONE start; after a
  // session the visitor's next start is a single tap again.
  it("drops the step marker once the session it led to has started", async () => {
    let pending = true;
    const h = harness({ locationPending: () => pending, enableOk: true });
    await h.enter();
    pending = false;
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.dataset["step"]).toBe("2 of 2");
    await h.enter();
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.dataset["step"]).toBeUndefined();
  });

  // Why (review #11): the marker is generated content, which a screen
  // reader would read run into the label ("1 of 2Allow location").
  it("names the step in the button's accessible name", () => {
    const h = harness({ locationPending: () => true });
    expect(h.dom.enterArButton.attributes.get("aria-label")).toBe(
      "Allow location, step 1 of 2",
    );
    const plain = harness();
    expect(plain.dom.enterArButton.attributes.has("aria-label")).toBe(false);
  });
});

describe("the scan card when the session ends under it (M4 review #8)", () => {
  // Why: the card hides the status line while it shows; a session that
  // ends while the gate still scans must take the card away AND give the
  // line back, or the visitor is left on the start page with no status.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes the card and restores the line", async () => {
    const h = harness({ enableOk: true });
    await h.enter();
    h.setArStatus("running");
    h.ctx.scanGate = { kind: "scanning", escapeOffered: false };
    h.entry.renderArStatus();
    expect(h.dom.scanCard.hidden).toBe(false);
    expect(h.dom.arStatus.hidden).toBe(true);
    h.setArStatus("ready");
    h.enabledConfig()!.callbacks?.onSessionEnd?.({ requestedByApp: false });
    await settle();
    expect(h.dom.scanCard.hidden).toBe(true);
    expect(h.dom.arStatus.hidden).toBe(false);
  });
});

describe("a creator's one way out of AR (polish round M3, Q-Done)", () => {
  // Why: Exit AR left without a word and Finish was a second button that
  // did the same and more (B6). The one button finishes when a finish can
  // run, else it just leaves - nothing is lost either way, the draft
  // keeps every change - and after a failed finish it only leaves.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finishes when a finish can start, and does not also end the session itself", async () => {
    const h = harness({ arStatus: "running", mode: "creator" });
    const finish = vi.fn(() => true);
    h.hooks.finishFromAr = finish;
    expect(h.dom.enterArButton.textContent).toBe("Done");
    await h.enter();
    expect(finish).toHaveBeenCalledTimes(1);
    // The finish ends the session itself, after the zip is written.
    expect(h.arController.disable).not.toHaveBeenCalled();
  });

  it("just leaves when no finish can start", async () => {
    const h = harness({ arStatus: "running", mode: "creator" });
    h.hooks.finishFromAr = vi.fn(() => false);
    await h.enter();
    expect(h.arController.disable).toHaveBeenCalledTimes(1);
  });

  it("only leaves after a failed finish", async () => {
    const h = harness({ arStatus: "running", mode: "creator" });
    const finish = vi.fn(() => true);
    h.hooks.finishFromAr = finish;
    h.ctx.finishError = "Finishing failed: offline";
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.textContent).toBe("Close AR");
    await h.enter();
    expect(finish).not.toHaveBeenCalled();
    expect(h.arController.disable).toHaveBeenCalledTimes(1);
  });

  it("leaves AR on a tap while saving, without starting another finish (M3 review #1, #3)", async () => {
    const h = harness({ arStatus: "running", mode: "creator" });
    const finish = vi.fn(() => true);
    h.hooks.finishFromAr = finish;
    h.ctx.finishing = true;
    h.entry.renderArEntry();
    expect(h.dom.enterArButton.textContent).toBe("Saving…");
    expect(h.dom.enterArButton.disabled).toBe(false);
    await h.enter();
    expect(finish).not.toHaveBeenCalled();
    expect(h.arController.disable).toHaveBeenCalledTimes(1);
  });

  it("a visitor's Exit AR never finishes", async () => {
    const h = harness({ arStatus: "running" });
    const finish = vi.fn(() => true);
    h.hooks.finishFromAr = finish;
    await h.enter();
    expect(finish).not.toHaveBeenCalled();
    expect(h.arController.disable).toHaveBeenCalledTimes(1);
  });
});

describe("the creator's mesh cursor (polish round M5; main.ts's default unless ?mesh=0)", () => {
  // Why: with `meshCursor` the creator's ring follows a mesh of the
  // surroundings: depth at the reconstruction density, the mesh under the
  // world group, its pick preferred by the reticle; without it (?mesh=0)
  // nothing changes (depth stays off unless the entry is recorded), and a
  // recorded entry keeps the recording's own density (its byte estimate
  // assumes it).
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for depth at the mesh density and hands the mesh's pick to the ring", async () => {
    const h = harness({ mode: "creator", enableOk: true, meshCursor: true });
    await h.enter();
    expect(h.seams.startDepthCapture).toHaveBeenCalledWith(MESH_DEPTH);
    expect(h.seams.startMeshSurface).toHaveBeenCalledTimes(1);
    const pick = (h.seams.startHitTestReticle.mock.calls[0] as unknown[])[2] as
      (() => unknown) | undefined;
    expect(pick?.()).toEqual({ position: "the mesh point" });
  });

  it("keeps the recording's density on a recorded entry", async () => {
    const h = harness({
      mode: "creator",
      enableOk: true,
      meshCursor: true,
      records: true,
    });
    await h.enter();
    expect(h.seams.startDepthCapture).toHaveBeenCalledWith(RECORDING_DEPTH);
    expect(h.seams.startMeshSurface).toHaveBeenCalledTimes(1);
  });

  it("changes nothing with the mesh off (?mesh=0)", async () => {
    const h = harness({ mode: "creator", enableOk: true });
    await h.enter();
    expect(h.seams.startDepthCapture).not.toHaveBeenCalled();
    expect(h.seams.startMeshSurface).not.toHaveBeenCalled();
    expect(
      (h.seams.startHitTestReticle.mock.calls[0] as unknown[])[2],
    ).toBeUndefined();
    // The restart hook is the mesh cursor's alone (F11, r837 review #7):
    // without the flag nothing listens for a restart.
    expect(h.enabledConfig()!.callbacks?.tracking?.onRestarted).toBeUndefined();
  });

  it("never builds a mesh for a visitor", async () => {
    const h = harness({ enableOk: true, meshCursor: true });
    await h.enter();
    expect(h.seams.startMeshSurface).not.toHaveBeenCalled();
    expect(h.enabledConfig()!.callbacks?.tracking?.onRestarted).toBeUndefined();
  });

  // Why (M5 review #9, follow-up F11): the grid's cells are raw WebXR
  // coordinates. After an origin reset they sit in a frame that no longer
  // exists, and the ring - and a pin placed on it - would snap to ghost
  // surfaces. The mesh starts again from nothing.
  it("starts the mesh again from nothing when tracking restarts at a new origin", async () => {
    const h = harness({ mode: "creator", enableOk: true, meshCursor: true });
    await h.enter();
    expect(h.enabledConfig()!.callbacks?.tracking?.onRestarted).toBeDefined();
    h.enabledConfig()!.callbacks!.tracking!.onRestarted!({} as never);
    expect(h.meshSurface.reset).toHaveBeenCalledTimes(1);
  });

  it("frees the mesh and stops the sampler when the session ends", async () => {
    const h = harness({ mode: "creator", enableOk: true, meshCursor: true });
    await h.enter();
    h.enabledConfig()!.callbacks?.onSessionEnd?.({ requestedByApp: false });
    await settle();
    expect(h.meshSurface.dispose).toHaveBeenCalledTimes(1);
    expect(h.seams.stopDepthCapture).toHaveBeenCalledTimes(1);
  });

  // Why (M5 review #11): a mesh that cannot be built must cost the creator
  // nothing but the mesh - the ring still runs on the hit-test.
  it("keeps the hit-test ring when the mesh cannot be built", async () => {
    const h = harness({ mode: "creator", enableOk: true, meshCursor: true });
    h.seams.startMeshSurface.mockImplementation(() => {
      throw new Error("no worker support");
    });
    await h.enter();
    expect(h.seams.startHitTestReticle).toHaveBeenCalledTimes(1);
    expect(
      (h.seams.startHitTestReticle.mock.calls[0] as unknown[])[2],
    ).toBeUndefined();
  });

  it("puts the frame time and the triangles in the ?debug=1 block", async () => {
    const h = harness({ mode: "creator", enableOk: true, meshCursor: true });
    h.ctx.debug = true;
    await h.enter();
    h.setArStatus("running");
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toContain(
      "mesh: 1200 triangles · frame 16/30/40 ms",
    );
  });
});

// Why (QR-first plan 2026-10-14-0445 §7 #10, M1b-1): a visitor who declined
// location starts the tour on codes alone - AR without the location
// permission or a GPS watch - and the session says so, so the scan gate can
// hide its "Continue with GPS only" escape. A visitor with location keeps
// the framework's default.
describe("a visitor without location starts on codes alone (QR-first M1b-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts AR in the codes-only mode and marks the session", async () => {
    const h = harness({ codesOnly: () => true, enableOk: true });
    await h.enter();
    expect(h.enabledConfig()?.location).toBe("none");
    expect(h.ctx.codesOnly).toBe(true);
  });

  // Why (M1b-1 review #3): a codes-only start reads the permission again
  // first; when that re-offers the location, this tap is not a start.
  it("reads the permission again before a codes-only start, and does not start when that re-offers the location", async () => {
    let pending = false;
    const recheck = vi.fn(() => {
      pending = true;
      return Promise.resolve();
    });
    const h = harness({
      codesOnly: () => !pending,
      locationPending: () => pending,
      recheck,
      enableOk: true,
    });
    await h.enter();
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(h.arController.enable).not.toHaveBeenCalled();
  });

  it("starts with location as before when the visitor allowed it", async () => {
    const h = harness({ enableOk: true });
    await h.enter();
    expect(h.enabledConfig()?.location).toBeUndefined();
    expect(h.ctx.codesOnly).toBe(false);
  });
});

// Why (D34 of the tour editor plan 2026-10-17-1816): the visitor's line
// asks for a few steps while the guide waits for a heading, read from the
// store the guide writes; once the heading exists the placed line is back.
// Not before tracking reports at all (the coaching's hold steady, N8).
describe("wireArEntry: the wait for a heading (D34)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function trackingReport(
    state: TrackingQualityReport["state"],
  ): TrackingQualityReport {
    return {
      state,
      confidence: 0.3,
      subScores: {
        convergence: 1,
        residualConsensus: 1,
        gpsAccuracy: 1,
        coverage: 0.5,
      },
      diagnostics: {},
    } as TrackingQualityReport;
  }

  function placedVisitor() {
    const h = harness({ arStatus: "running" });
    h.ctx.session = {} as never;
    h.ctx.scanGate = { kind: "passed", via: "code" };
    // The code that passed the gate lines the tour up with its votes.
    h.ctx.viewerLockedText = "c";
    h.ctx.viewerVotedLocks = 3;
    h.ctx.stationContent = {
      has: () => true,
      shown: () => ({ count: 2, skipped: [] }),
      showsAny: () => true,
    } as never;
    return h;
  }

  // Why: between the stations nothing is drawn, so the line
  // must not say "Look around."; the page reads that from the side table.
  it("asks for a station while nothing shown holds content, and is the placed line again at one", () => {
    const h = placedVisitor();
    let showsAny = false;
    h.ctx.stationContent = {
      has: () => true,
      shown: () => ({ count: 0, skipped: [] }),
      showsAny: () => showsAny,
    } as never;
    // (The walk's recorded photos were placed here too; a visitor no
    // longer sees them, and the content in the side table is what places
    // the tour.)
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("to-station");
    expect(h.dom.arStatus.textContent).toBe(
      "Walk to a station to see its content.",
    );
    showsAny = true;
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("placed");
  });

  // Why: a station whose only content is a story or a figure draws nothing
  // in the side table, so "nothing shown" alone sent a visitor standing at
  // that station away to walk to one. Away means no content shown AND no
  // station present.
  it("does not ask for a station while one is present, even with nothing drawn", () => {
    const h = placedVisitor();
    h.ctx.stationContent = {
      has: () => true,
      shown: () => ({ count: 0, skipped: [] }),
      showsAny: () => false,
    } as never;
    // (The walk's recorded photos were placed here too; a visitor no
    // longer sees them, and the content in the side table is what places
    // the tour.)
    h.arStore.dispatch(
      presenceJudged({
        candidates: [{ id: "a", distanceM: 1, foundM: 5, foundExitM: 9 }],
        accuracyM: 4,
        codeLinedUp: false,
      }),
    );
    expect(selectPresentStationId(h.arStore.getState())).toBe("a");
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("placed");
    expect(h.dom.arStatus.textContent).toBe("Tour placed. Look around.");
    h.arStore.dispatch(presenceCleared());
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("to-station");
  });

  it("holds the placed line while tracking has not reported yet (initializing)", () => {
    const h = placedVisitor();
    h.arStore.dispatch(headingPendingSet(true));
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("placed");
  });

  it("shows the walk line while the store says the guide waits, and the placed line once it does not", () => {
    const h = placedVisitor();
    h.arStore.dispatch(reportUpdated(trackingReport("warming-up")));
    h.arStore.dispatch(headingPendingSet(true));
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("finding-direction");
    expect(h.dom.arStatus.textContent).toBe(
      "Walk a few steps so the guide knows the direction.",
    );
    h.arStore.dispatch(headingPendingSet(false));
    h.entry.renderArStatus();
    expect(h.dom.arStatus.dataset["state"]).toBe("placed");
  });

  it("never says it to a creator", () => {
    const h = harness({ arStatus: "running", mode: "creator" });
    h.ctx.session = {} as never;
    h.arStore.dispatch(headingPendingSet(true));
    h.entry.renderArStatus();
    expect(h.dom.arStatus.textContent).not.toContain("Walk a few steps");
  });
});
