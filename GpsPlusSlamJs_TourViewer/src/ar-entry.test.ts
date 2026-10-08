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
import type { EnableGpsArConfig } from "gps-plus-slam-app-framework/ar";
import { wireArEntry, type ArEntryDom } from "./ar-entry.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  createUnwiredHooks,
} from "./tour-viewer-session.js";
import type { TourViewerSeams } from "./seams.js";
import { RECORDING_DEPTH } from "./authoring-recording.js";
import {
  endSession,
  resetGpsSessionData,
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
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function harness(
  options: {
    arStatus?: string;
    records?: boolean;
    enableOk?: boolean;
    mode?: "visitor" | "creator";
  } = {},
) {
  // The entry flags a running session on `document.body.dataset`; the
  // package tests run in node, so the page body is stood in.
  vi.stubGlobal("document", { body: { dataset: {} } });
  const ctx = createTourViewerSession();
  const dispose = vi.fn();
  let enabled: EnableGpsArConfig | null = null;
  const arController = {
    getState: () => ({ status: options.arStatus ?? "ready" }),
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
  };
  const entry = wireArEntry({
    ctx,
    mode: options.mode ?? "visitor",
    arStore,
    arController: arController as never,
    gpsHandler: () => undefined,
    seams: seams as unknown as TourViewerSeams,
    locationGate: {
      pending: () => false,
      busy: () => false,
      request: () => Promise.resolve(),
    } as never,
    dom: dom as unknown as ArEntryDom,
    hooks,
    ...(options.records === undefined
      ? {}
      : { recording: { beginOnArEntry: () => options.records === true } }),
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

  it("writes the ?debug=1 block only with the flag", () => {
    const h = harness();
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toBe("");
    h.ctx.debug = true;
    h.entry.renderArStatus();
    expect(h.dom.arDebug.textContent).toBe("qr: off\nno code evaluated yet");
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
});

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
