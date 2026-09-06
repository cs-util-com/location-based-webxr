/**
 * Live-AR wiring tests for ar-mode.
 *
 * Why these tests matter: the AR path is mostly device-only WebXR glue
 * (verified manually, per the header of ar-mode.ts), but the CONFIG wiring
 * is testable and is exactly what drifts silently: the isolation options
 * (camera/depth features must stay OFF for this tap-to-place demo), the
 * hit-test request, the tracking store group, and the slider→HUD re-creation
 * contract. The framework calls are mocked at their deep subpaths.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as THREE from "three";

vi.mock("gps-plus-slam-app-framework/ar/webxr-session", () => ({
  initAR: vi.fn().mockResolvedValue(undefined),
  endARSession: vi.fn().mockResolvedValue(undefined),
  getArWorldGroup: vi.fn(() => new THREE.Group()),
  getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
}));
vi.mock("gps-plus-slam-app-framework/ar/xr-frame-loop", () => ({
  registerXrFrameUpdate: vi.fn(() => vi.fn()),
}));
// The store is incidental to this wiring test (the real one enforces
// licensing) — a dispatch stub is all ar-mode needs.
vi.mock("gps-plus-slam-app-framework/state/create-slam-app-store", () => ({
  createSlamAppStore: vi.fn(() => ({ dispatch: vi.fn() })),
}));
vi.mock("gps-plus-slam-app-framework/storage/null-storage-backend", () => ({
  NullStorageBackend: class {},
}));
// The shared hit-test reticle driver is mocked at its deep subpath: the tap
// contract under test is that ar-mode passes an `onSelect` that maps the
// driver's nullable position onto hint-vs-place (the driver's own lifecycle
// is covered by the framework's hit-test-reticle-driver tests).
const driverMock = vi.hoisted(() => ({
  capturedOnSelect: null as
    | ((worldPosition: THREE.Vector3 | null) => void)
    | null,
  disposeSpy: vi.fn(),
}));
vi.mock("gps-plus-slam-app-framework/ar/hit-test-reticle-driver", () => ({
  startHitTestReticle: vi.fn(
    (args: { onSelect?: (worldPosition: THREE.Vector3 | null) => void }) => {
      driverMock.capturedOnSelect = args.onSelect ?? null;
      return {
        isVisible: () => false,
        getWorldPosition: (out: THREE.Vector3) => out,
        dispose: driverMock.disposeSpy,
      };
    },
  ),
}));
vi.mock("gps-plus-slam-app-framework/visualization/wayfinding-hud", () => ({
  createWayfindingHud: vi.fn(() => ({
    update: vi.fn(),
    // Non-zero on purpose: the readout prints only while something animates,
    // so a zero fake could not tell a dropped argument from a quiet frame.
    entranceStats: vi.fn(() => ({
      redraws: 2,
      drawMs: 0.04,
      animating: 1,
      entranceMs: 0.5,
      peakDrawMs: 0.08,
    })),
    dispose: vi.fn(),
  })),
}));
// The accent token comes from the vendored design.css at runtime; jsdom has
// no sheet, so the reader is mocked to exercise both outcomes.
vi.mock("./design-token", () => ({
  readCssToken: vi.fn((): string | undefined => undefined),
}));
import { readCssToken } from "./design-token";

import { startArMode, type ArModeDeps } from "./ar-mode";
import { startHitTestReticle } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";
import { initAR } from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { createWayfindingHud } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

function makeDeps(configOverride?: { imageIndicators?: boolean }) {
  return {
    container: {} as HTMLElement,
    getConfig: () => ({
      distanceMin: 1.5,
      distanceMax: 3,
      indicatorScale: 1,
      imageIndicators: configOverride?.imageIndicators ?? false,
      entrance: true,
    }),
    onStatus: vi.fn((_text: string) => undefined),
    onHint: vi.fn((_message: string) => undefined),
    onError: vi.fn((_message: string) => undefined),
  } satisfies ArModeDeps;
}

/** Minimal XR frame context for the captured registerXrFrameUpdate callback
 * (the app's own callback only spawns examples + pushes the status line —
 * the hit-test plumbing lives in the mocked driver). */
function makeFrameContext() {
  return {
    frame: {},
    referenceSpace: {},
    session: {},
    dt: 0,
    elapsed: 0,
  };
}

/** Run the frame callback ar-mode registered with the (mocked) XR frame loop. */
function runXrFrame(context: unknown): void {
  const callback = vi.mocked(registerXrFrameUpdate).mock.calls[0]![0] as (
    ctx: unknown,
  ) => void;
  callback(context);
}

beforeEach(() => {
  vi.clearAllMocks();
  driverMock.capturedOnSelect = null;
});

describe("startArMode", () => {
  it("boots initAR with camera/depth features OFF, hit-test ON, the tracking store, and a session-end callback", async () => {
    const mode = await startArMode(makeDeps());
    expect(initAR).toHaveBeenCalledWith(
      expect.anything(),
      {
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      { requestHitTest: true },
      {
        tracking: { store: expect.anything() },
        // Replaces the old inline session-'end' listener: the framework's
        // onSessionEnd drives dispose() + deps.onEnded for both the system
        // back gesture and the app-initiated end.
        onSessionEnd: expect.any(Function),
      },
    );
    // The shared reticle driver is started with a tap handler.
    expect(startHitTestReticle).toHaveBeenCalledTimes(1);
    expect(driverMock.capturedOnSelect).toBeTypeOf("function");
    mode.dispose();
    expect(driverMock.disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("creates the HUD in the default self-registering mode from the current config", async () => {
    const mode = await startArMode(makeDeps());
    expect(createWayfindingHud).toHaveBeenCalledTimes(1);
    const options = vi.mocked(createWayfindingHud).mock.calls[0]![0];
    expect(options.distanceMin).toBe(1.5);
    expect(options.distanceMax).toBe(3);
    // No explicit-tick override: inside a session the frame loop ticks it.
    expect(options.autoRegisterFrameUpdate).toBeUndefined();
    // Default config: procedural indicators — no sprite URLs passed.
    expect(options.arrowSprite).toBeUndefined();
    expect(options.circleSprite).toBeUndefined();
    expect(options.getTargets()).toEqual([]); // nothing placed yet
    mode.dispose();
  });

  // Why this test matters: the image-indicator toggle is the demo's (and the
  // repo's) only consumer of the framework's sprite-URL path — the wiring
  // must hand real asset URLs to createWayfindingHud, not booleans or paths
  // the bundler cannot fingerprint.
  it("passes the self-made sprite asset URLs when the config enables image indicators", async () => {
    const mode = await startArMode(makeDeps({ imageIndicators: true }));
    const options = vi.mocked(createWayfindingHud).mock.calls[0]![0];
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*\.svg$/);
    expect(options.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
    mode.dispose();
  });

  // Why this test matters: the design system's accent is the HUD's tint, and
  // the demo must hand the LIVE token to the framework — with the option
  // OMITTED (not empty) when the sheet is absent, so the framework default
  // applies instead of THREE.Color reading '' as black.
  it("passes the design system's accent token as the indicator tint, and omits it when the sheet has none", async () => {
    vi.mocked(readCssToken).mockReturnValueOnce("#123456");
    const tinted = await startArMode(makeDeps());
    expect(readCssToken).toHaveBeenCalledWith("--accent");
    expect(
      vi.mocked(createWayfindingHud).mock.calls[0]![0].indicatorColor,
    ).toBe("#123456");
    tinted.dispose();

    vi.mocked(createWayfindingHud).mockClear();
    const untinted = await startArMode(makeDeps());
    expect(
      "indicatorColor" in vi.mocked(createWayfindingHud).mock.calls[0]![0],
    ).toBe(false);
    untinted.dispose();
  });

  it("re-creates the HUD on refreshHud (slider change)", async () => {
    const mode = await startArMode(makeDeps());
    mode.refreshHud();
    expect(createWayfindingHud).toHaveBeenCalledTimes(2);
    mode.dispose();
  });

  // Why this test matters (AR-onboarding revision): without the spawned
  // examples the demo boots into "tap something and then nothing visible
  // happens" — the examples must appear exactly once, on the first tracked
  // frame, and land beyond the activation distance so the HUD is live in
  // second one.
  it("spawns the three example waypoints once, on the first XR frame", async () => {
    const deps = makeDeps();
    const mode = await startArMode(deps);
    const options = vi.mocked(createWayfindingHud).mock.calls[0]![0];
    expect(options.getTargets().length).toBe(0); // nothing before frame 1

    const context = makeFrameContext();
    runXrFrame(context);
    expect(options.getTargets().length).toBe(3);
    expect(mode.placedCount()).toBe(3);

    runXrFrame(context); // second frame must not duplicate
    expect(options.getTargets().length).toBe(3);
    mode.dispose();
  });

  // Why this test matters: a tap with no surface under the reticle used to
  // be silently ignored (against the repo's async-feedback rule) — it must
  // surface a hint and place nothing. The driver reports such taps as
  // `onSelect(null)`; the app owns the hint-vs-place decision.
  it("flashes a hint instead of placing when the reticle has no surface", async () => {
    const deps = makeDeps();
    const mode = await startArMode(deps);
    runXrFrame(makeFrameContext()); // spawns the examples

    driverMock.capturedOnSelect!(null); // surface-less tap
    expect(deps.onHint).toHaveBeenCalledWith(
      "Point the camera at the floor, then tap.",
    );
    expect(mode.placedCount()).toBe(3); // examples only — nothing placed

    driverMock.capturedOnSelect!(new THREE.Vector3(1, 0, 2));
    expect(mode.placedCount()).toBe(4); // surface tap places normally
    mode.dispose();
  });

  it("surfaces an initAR failure via onError and returns an inert handle", async () => {
    vi.mocked(initAR).mockRejectedValueOnce(new Error("no session"));
    const deps = makeDeps();
    const mode = await startArMode(deps);
    expect(deps.onError).toHaveBeenCalledWith("no session");
    expect(createWayfindingHud).not.toHaveBeenCalled();
    expect(mode.placedCount()).toBe(0);
    expect(() => {
      mode.refreshHud();
      mode.dispose();
    }).not.toThrow();
  });

  it("passes the HUD's entrance readout into the per-frame status line", async () => {
    // Why: this is the line the owner reads on the headset to judge the
    // entrance's cost, and nothing else exercises the AR host's wiring of
    // the fourth summarizeHudScene input (M4 milestone review, 2026-09-06).
    const deps = makeDeps();
    const mode = await startArMode(deps);
    runXrFrame(makeFrameContext());
    expect(vi.mocked(deps.onStatus)).toHaveBeenLastCalledWith(
      expect.stringContaining("entrance 1 animating · 2 redraws"),
    );
    mode.dispose();
  });
});
