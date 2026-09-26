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

/** A stand-in element: the fields `wireArEntry` writes, and click handlers. */
function el() {
  const handlers = new Map<string, () => void>();
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function harness(options: { arStatus?: string } = {}) {
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
      // Report a failed start: the session callbacks are already handed
      // over, and nothing after the enable needs a scene.
      return Promise.resolve({ ok: false });
    }),
    disable: () => Promise.resolve(),
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
  const dom = {
    arRoot: el(),
    arStatus: el(),
    arHint: el(),
    enterArButton: el(),
    sizeInput: el(),
    errorBox: el(),
    escapeButton: el(),
    arDebug: el(),
  };
  const entry = wireArEntry({
    ctx,
    mode: "visitor",
    arStore: createTourViewerStore(),
    arController: arController as never,
    gpsHandler: () => undefined,
    seams: {
      stopCameraFrameCapture: () => undefined,
    } as unknown as TourViewerSeams,
    locationGate: {
      pending: () => false,
      busy: () => false,
      request: () => Promise.resolve(),
    } as never,
    dom: dom as unknown as ArEntryDom,
    hooks,
  });
  return {
    ctx,
    dom,
    entry,
    dispose,
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

  it("disposes the QR controller and drops the session's fused pose source", async () => {
    const h = harness();
    await h.enterAndEnd();
    expect(h.dispose).toHaveBeenCalledTimes(1);
    expect(h.ctx.qrController).toBeNull();
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

  it("shows the fused pose's hint from the last evaluation while tracking", () => {
    const h = harness({ arStatus: "running" });
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
