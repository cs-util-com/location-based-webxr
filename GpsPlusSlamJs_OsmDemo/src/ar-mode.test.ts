/**
 * @vitest-environment jsdom
 *
 * AR mode — entering, framing the city, and giving it back.
 *
 * Why these tests matter: every failure this milestone can produce is SILENT.
 * A session that starts without a GPS fix anchors the city to nothing; content
 * attached to `arWorldGroup` instead of the scene root pins it to the session's
 * arbitrary start pose; content attached without the frame argument renders it
 * 90° off; and content left on the framework's scene at teardown vanishes from
 * the desktop view, because the framework discards that scene at session end.
 * None of those throw.
 *
 * The framework's session module is mocked, following the reference consumer
 * (`WayfindingHudDemo/src/ar-mode.test.ts`): a real `initAR` needs a WebXR
 * device, and what this module is responsible for is the WIRING either side of
 * it.
 *
 * @see ar-mode.ts.md
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

/**
 * IN `vi.hoisted`, WHICH IS NOT OPTIONAL HERE.
 *
 * `vi.mock` is hoisted above every `const` in the file, so a factory that
 * closes over plain top-level bindings throws "Cannot access 'initAR' before
 * initialization" — and it throws in a way that is easy to misread: the FILE
 * fails while every test in it still reports as passed, so a single-file run
 * looks green and only the suite's exit code disagrees. That is exactly how
 * this was missed on the first pass.
 *
 * The spies are then referenced directly rather than re-wrapped: a wrapper
 * spreading `unknown[]` into them returns `any`, which this package's lint
 * bans, and it bought nothing since `vi.fn()` is already the callable.
 */
const mocks = vi.hoisted(() => ({
  initAR: vi.fn<(...args: unknown[]) => Promise<void>>(),
  endARSession: vi.fn(),
  getScene: vi.fn(),
  getArWorldGroup: vi.fn(),
  getCamera: vi.fn(),
  getRenderer: vi.fn(),
  getCurrentArPose: vi.fn(),
  startDepthCapture: vi.fn(),
  registerXrFrameUpdate: vi.fn(),
  unregisterFrame: vi.fn(),
  alignmentDispose: vi.fn(),
  enableArWorldGroupAlignment: vi.fn(),
}));

vi.mock("gps-plus-slam-app-framework/ar", () => ({
  initAR: mocks.initAR,
  endARSession: mocks.endARSession,
  getScene: mocks.getScene,
  getArWorldGroup: mocks.getArWorldGroup,
  getCamera: mocks.getCamera,
  getRenderer: mocks.getRenderer,
  getCurrentArPose: mocks.getCurrentArPose,
  startDepthCapture: mocks.startDepthCapture,
  registerXrFrameUpdate: mocks.registerXrFrameUpdate,
}));
vi.mock("gps-plus-slam-app-framework/visualization", () => ({
  enableArWorldGroupAlignment: mocks.enableArWorldGroupAlignment,
}));
// The real action creator runs the library's licence check when invoked
// outside a licensed store — irrelevant here, where only "dispatch was
// called" matters (same stub as `ar-mode.depth-wiring.test.ts`).
vi.mock("gps-plus-slam-app-framework/core", () => ({
  odometryTrackingRestarted: (payload: unknown) => ({
    type: "odometry/trackingRestarted",
    payload,
  }),
}));

const {
  initAR,
  endARSession,
  getScene,
  getArWorldGroup,
  getCamera,
  getRenderer,
  getCurrentArPose,
  startDepthCapture,
  registerXrFrameUpdate,
  unregisterFrame,
  alignmentDispose,
  enableArWorldGroupAlignment,
} = mocks;

const scene = new THREE.Scene();
const arWorldGroup = new THREE.Group();
// REBUILT PER TEST rather than shared like the scene above, because
// `applyArEnvironment` mutates it too — and the shared scene already caused
// exactly that failure once (see the reset in `beforeEach`).
let camera: THREE.PerspectiveCamera;
/** A settings bag, not a real renderer — nothing here draws. */
let renderer: THREE.WebGLRenderer;

import {
  makeWorldPointSample,
  surfacePatch,
} from "gps-plus-slam-app-framework/test-utils/synthetic-depth-samples";
import type { DepthSample } from "gps-plus-slam-app-framework/ar/depth-sampler";

import { startArMode, type ArModeDeps } from "./ar-mode.js";
import { AR_DEPTH_SAMPLER_CONFIG } from "./ar-depth-pipeline.js";
import { nueBearingDeg } from "./ar-origin.js";
import { AR_CAMERA_FAR_M, AR_CAMERA_NEAR_M } from "./ar-scene-environment.js";

const COLOGNE = { lat: 50.9413, lon: 6.9583 };

/** A `BuildingView` stand-in recording where its content was sent. */
function fakeView() {
  const localRoot = new THREE.Scene();
  // `| undefined` rather than `?`, because this package sets
  // `exactOptionalPropertyTypes` — an absent property and one explicitly set to
  // `undefined` are different types, and the recorder always writes the key.
  const attachedTo: {
    root: THREE.Object3D;
    frame: string;
    offset: { north: number; up: number; east: number } | undefined;
  }[] = [];
  const shellCalls: (THREE.Material | undefined)[] = [];
  return {
    localRoot,
    attachedTo,
    // THE OFFSET IS RECORDED, because dropping it is a silent failure: the city
    // renders at the right orientation and the wrong place, and a fixture that
    // ignored the third argument would pass either way.
    attachContentTo: (
      root: THREE.Object3D,
      frame: string,
      offset?: { north: number; up: number; east: number },
    ) => {
      attachedTo.push({ root, frame, offset });
    },
    // RECORDED, not ignored: the swap and the restore are a pair, and a fake
    // that swallowed them would let a session leave an additive, depth-write-free
    // material on the desktop view — which is invisible until someone looks at
    // the map again.
    shellCalls,
    setArShellMaterial: (material: THREE.Material | undefined) => {
      shellCalls.push(material);
    },
  };
}

function deps(overrides: Partial<ArModeDeps> = {}): ArModeDeps {
  const view = fakeView();
  return {
    container: document.createElement("div"),
    store: { getState: () => ({}), subscribe: () => () => undefined },
    buildingView: view as unknown as ArModeDeps["buildingView"],
    origin: COLOGNE,
    // The demo's scene anchor, deliberately DIFFERENT from the GPS origin —
    // the offset between them is what `ar-mode` has to apply, and a fixture
    // where they coincide would let a missing offset pass.
    sceneAnchor: { lat: 50.9423, lng: 6.9593 },
    enuFrameAt: (o: { lat: number; lng: number }) => ({
      toEnu: (p: { lat: number; lng: number }) => ({
        x: (p.lng - o.lng) * 70_000,
        y: (p.lat - o.lat) * 111_320,
      }),
    }),
    onError: vi.fn(),
    ...overrides,
  } as ArModeDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
  // SEVERAL TESTS MOUNT THE HUD INTO `document.body`, so without this each one
  // reads the leftovers of every earlier one — and an assertion that something
  // is ABSENT then fails against a previous test's output rather than its own.
  document.body.innerHTML = "";
  // THE SCENE IS SHARED ACROSS TESTS AND `applyArEnvironment` MUTATES IT, so
  // without this a test that leaves fog on makes the next one's "previous"
  // state wrong — and the restore assertions then check that the fog came
  // BACK. Found by exactly that failure.
  scene.background = null;
  scene.environment = null;
  scene.fog = null;
  initAR.mockResolvedValue(undefined);
  getScene.mockReturnValue(scene);
  getArWorldGroup.mockReturnValue(arWorldGroup);
  // The framework's own planes, so a test can tell "restored" from "never set".
  camera = new THREE.PerspectiveCamera(70, 1, 0.01, 200);
  getCamera.mockReturnValue(camera);
  // The framework's renderer settings, which is to say: none. It sets no tone
  // mapping at all, so this fixture starts where a real session starts and a
  // test can tell "graded" from "left alone".
  renderer = {
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    // `info.render` is what the M4 readout samples. Present on every real
    // renderer, so a fixture without it would make the sampler look fragile
    // when it is not.
    info: { render: { calls: 0, triangles: 0 } },
    // `setClearAlpha` is what the Q5 entry fade drives — one animated number on
    // the `scene.background === null` path. Present on every real renderer, so
    // a fixture without it would make the fade look fragile when it is not, and
    // would fail fifteen unrelated tests the first time the frame loop touches
    // it. Same argument as `info.render` above.
    setClearAlpha: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
  getRenderer.mockReturnValue(renderer);
  getCurrentArPose.mockReturnValue(null);
  registerXrFrameUpdate.mockReturnValue(unregisterFrame);
  enableArWorldGroupAlignment.mockReturnValue({ dispose: alignmentDispose });
});

describe("entering AR", () => {
  it("refuses without a GPS fix, and does not prompt for a session", () => {
    // DEC-R11-6 rejected re-anchoring on the first non-null `zero`, so there is
    // no correcting an early entry. Asserted on `initAR` NOT being called
    // because the cost of getting this wrong is a camera-permission prompt
    // followed by a scene anchored to nothing.
    const d = deps({ origin: null });

    return startArMode(d).then(() => {
      expect(initAR).not.toHaveBeenCalled();
      expect(d.onError).toHaveBeenCalledWith(expect.stringContaining("GPS"));
    });
  });

  it("attaches the city to the SCENE ROOT in the GPS-world frame", async () => {
    // The two things this milestone exists to get right, and both are silent
    // when wrong: the scene root is the GPS-world frame (content on
    // `arWorldGroup` would be pinned to the session's arbitrary start pose),
    // and the frame argument converts the demo's X=East/Y=Up/Z=−North axes to
    // NUE (without it the city renders 90° off).
    const view = fakeView();
    await startArMode(
      deps({ buildingView: view as unknown as ArModeDeps["buildingView"] }),
    );

    expect(view.attachedTo).toHaveLength(1);
    expect(view.attachedTo[0]?.root).toBe(scene);
    expect(view.attachedTo[0]?.frame).toBe("gps-world-nue");
    // NOT `arWorldGroup`, asserted against the actual alternative rather than
    // implied by the line above — content there is pinned to the session's
    // arbitrary start pose, which is the failure two readers of the framework
    // docs previously talked themselves into.
    expect(view.attachedTo[0]?.root).not.toBe(arWorldGroup);
    // AND THE OFFSET IS APPLIED. The fixture's scene anchor is deliberately not
    // the GPS origin, so a dropped offset shows up here as `undefined` or zero
    // rather than passing silently.
    expect(view.attachedTo[0]?.offset?.north).toBeCloseTo(111.32, 1);
    expect(view.attachedTo[0]?.offset?.east).toBeCloseTo(70, 1);
  });

  it("subscribes the world group to the fusion's alignment", async () => {
    await startArMode(deps());

    expect(enableArWorldGroupAlignment).toHaveBeenCalledWith(
      expect.objectContaining({ arWorldGroup }),
    );
  });

  it("asks for no camera, depth or hit-test features while auto elevation is off", async () => {
    // Camera access and texture acquisition default ON and are never used: the
    // city's position comes from GPS, not from vision. Depth-sensing is the
    // KILL-SWITCH path now — without the `autoElevation` dep the session must
    // be byte-identical to the pre-auto behaviour, including no depth texture
    // (which would override the camera's near/far planes) and no capture cost.
    await startArMode(deps());

    expect(initAR).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      }),
      {},
      expect.anything(),
    );
    expect(startDepthCapture).not.toHaveBeenCalled();
  });
});

/**
 * Why these tests matter: the auto offset is three real modules (grid, floor
 * estimator, offset estimator) chained through two frame conversions, and the
 * chain has exactly one observable end — the `up` component that reaches
 * `attachContentTo`. Each module is proven in isolation elsewhere; what only
 * this file can see is that `ar-mode` CONNECTS them: depth samples reach the
 * grid, the tick reads the live alignment, the published value shares the
 * manual nudge's channel, and the HUD names what was applied.
 */
describe("the automatic elevation offset", () => {
  /** Deps with the auto feature wired to a flat DEM at 100 m ellipsoidal. */
  const autoDeps = (
    view: ReturnType<typeof fakeView>,
    container: HTMLElement,
  ) =>
    deps({
      container,
      buildingView: view as unknown as ArModeDeps["buildingView"],
      autoElevation: { terrainHeightM: () => 100 },
    });

  /** The captured initAR callbacks, typed to what these tests reach into. */
  const sessionCallbacks = () =>
    initAR.mock.calls[0]?.[3] as {
      depth?: { onCaptured: (sample: DepthSample) => void };
      tracking: { onRestarted: (payload: unknown) => void };
    };

  type FrameFn = (ctx: { dt: number; elapsed: number }) => void;
  const frameFn = () => registerXrFrameUpdate.mock.calls[0]?.[0] as FrameFn;

  /** Metres per second of simulated walking (see {@link walkFrames}). */
  const WALK_SPEED_M_PER_S = 1.5;

  /**
   * Run frames from `fromS` to `toS` while WALKING east at
   * {@link WALK_SPEED_M_PER_S}.
   *
   * Walking is not cosmetic here (cold-review F1): the offset estimator's
   * novelty weighting deliberately deflates a standstill — correlated
   * re-observations are not new evidence — so a stationary stream saturates
   * around 0.1 confidence and never clears the demo's engage gate. The walk is
   * carried by the ALIGNMENT translation, which moves camera and floor hits
   * together in ENU while the raw-AR plate stays under the camera; that is
   * what lets one fixed synthetic grid stand in for a walked one.
   */
  const walkFrames = (fromS: number, toS: number, stepS = 1 / 60): number => {
    const onFrame = frameFn();
    let elapsed = fromS;
    for (; elapsed <= toS; elapsed += stepS) {
      arWorldGroup.matrix.elements[14] = elapsed * WALK_SPEED_M_PER_S;
      onFrame({ dt: stepS, elapsed });
    }
    return elapsed;
  };

  it("requests depth sensing and starts the reconstruction-cadence capture", async () => {
    await startArMode(deps({ autoElevation: { terrainHeightM: () => 100 } }));

    expect(initAR).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enableDepthSensingFeature: true }),
      {},
      expect.anything(),
    );
    expect(sessionCallbacks().depth?.onCaptured).toBeDefined();
    // The EXPLICIT reconstruction config, not the library fallback — the
    // fallback builds the grid 8× slower and the floor with it.
    expect(startDepthCapture).toHaveBeenCalledWith(AR_DEPTH_SAMPLER_CONFIG);
  });

  it("applies floor − DEM + baseline through the nudge channel, composed with the trim", async () => {
    // THE FULL CHAIN, on real framework modules. Floor plate at raw-AR
    // y = 3.0 under a camera at 4.6; baseline 98.4; DEM+N = 100. The sign
    // test in `ar-elevation-auto.test.ts` owns the arithmetic: the city must
    // RISE by 98.4 + (3.0 − 100) = +1.4 m. Here that value must actually
    // REACH `attachContentTo` — the "typechecks but never renders" gap.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[13] = 98.4;
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    await startArMode(autoDeps(view, container));
    const { depth } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    // Twice: the production grid counts a cell occupied at ≥2 observations.
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);

    // Walk far enough to clear the confidence gate (cold-review F1 — the
    // estimator's confidence climbs ~0.1 per moving tick, so ~5 s), then
    // enough further for the application-time ease (1.5 m/s, cold-review F4)
    // to converge on the 1.4 m target — the ease itself is pinned in its own
    // test below; this one pins the CONVERGED value reaching the scene.
    walkFrames(1, 9);

    const attached = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(attached.at(-1)?.offset?.up).toBeCloseTo(1.4, 1);
    // The north/east terms survive — auto must not repeat the bug the manual
    // nudge's test guards against.
    expect(attached.at(-1)?.offset?.north).toBeCloseTo(111.32, 1);
    // AND THE HUD SAYS WHAT WAS APPLIED, beside the raw residual it pairs
    // with — the two lines are the M5 field instrument. (The HUD reports the
    // estimator's PUBLISHED value; the eased application catches up to it.)
    expect(document.body.textContent).toContain("auto +1.4 m");

    // Manual trim COMPOSES on top of auto (the owner's escape hatch): +1 m
    // by button lands at auto + trim, not at trim alone.
    const plus = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "+",
    );
    plus?.click();
    const trimmed = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(trimmed.at(-1)?.offset?.up).toBeCloseTo(2.4, 1);

    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });

  it("contributes nothing before an alignment exists", async () => {
    // The identity matrix's element 13 is a perfectly real 0 — publishing a
    // "world floor 0" offset before the fusion has said anything is the exact
    // trap `worldBaselineY` already refuses. The nudge channel must stay pure
    // manual until an alignment lands.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    await startArMode(autoDeps(view, container));
    const { depth } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);
    const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
      dt: number;
      elapsed: number;
    }) => void;
    onFrame({ dt: 1 / 60, elapsed: 1 });

    const attached = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(attached.at(-1)?.offset?.up).toBe(0);
    expect(document.body.textContent ?? "").not.toContain("auto ");

    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });

  it("eases the FIRST auto value in — never a one-frame step (cold-review F4)", async () => {
    // The estimator's slew limiter shapes the signal BETWEEN ticks, but the
    // cold-start first value reaches this module as a step — and a step is
    // exactly what the content must never do (a city that snaps 1.4 m on one
    // frame reads as a glitch, and a first value of 5 m would be violent).
    // The applied value must move toward the target at the bounded
    // AUTO_APPLY_RATE_M_PER_S, so one 1/60 s frame moves it centimetres.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[13] = 98.4;
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    await startArMode(autoDeps(view, container));
    const { depth } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);

    // Walk frame by frame and catch the FIRST frame on which the content
    // moves at all. Since the confidence gate (cold-review F1) that first
    // motion is the ENGAGE moment rather than the estimator's first publish —
    // which makes the step it would take even larger, and the ease even more
    // load-bearing.
    const onFrame = frameFn();
    let firstStep = 0;
    for (let elapsed = 1; elapsed <= 9 && firstStep === 0; elapsed += 1 / 60) {
      arWorldGroup.matrix.elements[14] = elapsed * WALK_SPEED_M_PER_S;
      onFrame({ dt: 1 / 60, elapsed });
      const applied = view.attachedTo
        .filter((a) => a.frame === "gps-world-nue")
        .at(-1)?.offset?.up;
      firstStep = applied ?? 0;
    }
    // Moved, but by at most one frame's rate budget (1.5 m/s × 1/60 s), not
    // by the full 1.4 m target.
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(0.1);

    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });

  it("resets the estimator in the SAME callback that re-bases the odometry (cold-review F2)", async () => {
    // The grid is cleared on `odometryTrackingRestarted` because its cells
    // were measured in the odometry frame that just died — but the ESTIMATOR
    // WINDOW holds samples from the same dead frame, and its hold branch
    // would keep publishing a dead-frame value for up to 45 s while the grid
    // refills. The restart callback must reset both in the same breath.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[13] = 98.4;
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });
    const d = deps({
      container,
      buildingView: view as unknown as ArModeDeps["buildingView"],
      autoElevation: { terrainHeightM: () => 100 },
      store: {
        getState: () => ({}),
        subscribe: () => () => undefined,
        dispatch: vi.fn(),
      } as unknown as ArModeDeps["store"],
    });

    await startArMode(d);
    const { depth, tracking } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);

    const onFrame = frameFn();
    // Warm the chain by WALKING, until the value clears the confidence gate
    // and the eased application converges on +1.4 m. Walking matters here:
    // with a standstill stream the applied offset never leaves 0, and the
    // "eases back to zero" assertion at the end of this test would hold
    // vacuously — it would pass on an estimator that was never engaged.
    const resumeS = walkFrames(1, 9);
    expect(document.body.textContent).toContain("auto +1.4 m");
    const beforeRestart = view.attachedTo
      .filter((a) => a.frame === "gps-world-nue")
      .at(-1)?.offset?.up;
    expect(beforeRestart).toBeCloseTo(1.4, 1);

    tracking.onRestarted({ some: "payload" });

    // The next tick sees a cleared grid AND a cold estimator: the publish
    // must return to null (HUD line gone). WITHOUT the reset the hold branch
    // keeps the dead frame's +1.4 m alive here — this is the discriminator.
    // +1.5 s so both the ~1 Hz estimator tick and the throttled HUD write
    // land — a single 1/60 s frame would leave the previous readout on screen
    // and the assertion below would be about staleness, not about the reset.
    const restartS = resumeS + 1.5;
    onFrame({ dt: 1 / 60, elapsed: restartS });
    expect(document.body.textContent ?? "").not.toContain("auto ");
    // And the APPLIED offset eases back toward the auto-off contribution of
    // zero rather than holding the dead-frame value.
    for (let i = 1; i <= 120; i++) {
      onFrame({ dt: 1 / 60, elapsed: restartS + i / 60 });
    }
    const attached = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(attached.at(-1)?.offset?.up ?? NaN).toBeCloseTo(0, 5);

    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });

  it("never moves the content on a LOW-CONFIDENCE stream (cold-review F1)", async () => {
    // WHY THIS TEST MATTERS — this is the whole finding. The framework
    // estimator FLOORS a bad hit's weight rather than rejecting it, so a
    // stream it rates as near-worthless still accumulates enough mass to
    // publish an `offsetM`. Ungated, that eased the entire city vertically at
    // 1.5 m/s on evidence the estimator was itself reporting as ~0.1. A
    // standstill is the production shape of that stream (novelty weighting
    // deliberately deflates correlated re-observations), and it is what a
    // user does while looking at the result.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[13] = 98.4;
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    await startArMode(autoDeps(view, container));
    const { depth } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);

    // STANDING STILL — no alignment translation change — for 30 s: far longer
    // than the ~5 s a walked stream needs to engage.
    const onFrame = frameFn();
    for (let elapsed = 1; elapsed <= 31; elapsed += 1 / 60) {
      onFrame({ dt: 1 / 60, elapsed });
    }

    const attached = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(attached.at(-1)?.offset?.up ?? NaN).toBeCloseTo(0, 5);
    // AND THE READOUT IS HONEST ABOUT IT: the measurement is real and still
    // shown, tagged as not applied rather than implying the city carries it.
    expect(document.body.textContent).toContain("auto +1.4 m (conf");
    expect(document.body.textContent).toContain(", low)");
    // The manual trim still works exactly as before the feature existed.
    const plus = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "+",
    );
    plus?.click();
    const trimmed = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(trimmed.at(-1)?.offset?.up).toBeCloseTo(1, 5);

    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });

  it("EASES back to zero when the auto RELEASES, never snapping (cold-review F1)", async () => {
    // The release path is not the null path: `autoM` is still published (a
    // held value), only the confidence has decayed through the hysteresis
    // band. The contribution must therefore leave the content the same way it
    // arrived — through the 1.5 m/s ease — because a gate that wrote 0
    // directly would drop the city 1.4 m in a single frame, which is exactly
    // the glitch the ease exists to prevent.
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[13] = 98.4;
    getCurrentArPose.mockReturnValue({
      position: { x: 0, y: 4.6, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    });

    await startArMode(autoDeps(view, container));
    const { depth } = sessionCallbacks();
    const sample = makeWorldPointSample(
      [0, 4.6, 0],
      surfacePatch(() => 3, 1, 0.2),
    );
    depth?.onCaptured(sample);
    depth?.onCaptured(sample);

    const appliedNow = () =>
      view.attachedTo.filter((a) => a.frame === "gps-world-nue").at(-1)?.offset
        ?.up ?? Number.NaN;

    let elapsed = walkFrames(1, 9);
    expect(appliedNow()).toBeCloseTo(1.4, 1);

    // TRACKING IS LOST. The value is HELD (cold-review F3 — a blip must not
    // teleport the city), but its confidence decays at a 10 s e-folding, so
    // after ~12 s it crosses the 0.3 release threshold and the contribution
    // must come off.
    getCurrentArPose.mockReturnValue(null);
    const onFrame = frameFn();
    const trail: number[] = [];
    for (; elapsed <= 30; elapsed += 1 / 20) {
      onFrame({ dt: 1 / 20, elapsed });
      trail.push(appliedNow());
    }

    // It came off...
    expect(trail.at(-1) ?? Number.NaN).toBeCloseTo(0, 5);
    // ...and it EASED: no single frame moved more than one frame's rate
    // budget (1.5 m/s × 1/20 s = 0.075 m), so there is no snap anywhere in
    // the trail. A `targetM = 0` written straight to the scene would show up
    // here as one 1.4 m step.
    const biggestStep = trail.reduce(
      (m, v, i) =>
        i === 0 ? m : Math.max(m, Math.abs(v - (trail[i - 1] ?? v))),
      0,
    );
    expect(biggestStep).toBeLessThanOrEqual(1.5 / 20 + 1e-9);
    // And the descent was gradual rather than instant — several frames spent
    // strictly between the two ends.
    expect(trail.filter((v) => v > 0.05 && v < 1.3).length).toBeGreaterThan(5);
    // The HUD still shows the held measurement, tagged as not applied.
    expect(document.body.textContent).toContain(", low)");

    arWorldGroup.matrix.identity();
    getCurrentArPose.mockReturnValue(null);
    container.remove();
  });
});

describe("when AR cannot start", () => {
  it("reports a failed session and returns an inert handle", async () => {
    initAR.mockRejectedValueOnce(new Error("no session"));
    const d = deps();

    const mode = await startArMode(d);

    expect(d.onError).toHaveBeenCalledWith("no session");
    expect(() => {
      mode.dispose();
    }).not.toThrow();
    // AND THE CONTAINER IS CLEARED. `initAR` inserts its canvas before
    // `requestSession`, so a rejection leaves it behind — and `#ar-root` is
    // `position: fixed; inset: 0` the moment it stops being `:empty`, i.e. an
    // invisible click-eating layer over the whole page. The framework's own
    // re-entry guard would also refuse every later attempt.
    expect(endARSession).toHaveBeenCalled();
  });

  it("survives a throw AFTER the session opened, rather than rejecting", async () => {
    // Why this test matters (PR #316 review): the docstring promises
    // startArMode NEVER REJECTS, but only the initAR call sat inside a try.
    // Everything from the elevation attach to bootCompleted = true ran
    // unguarded, and a throw there left the worst available state: the XR
    // session LIVE, the city already reparented onto the framework scene so the
    // desktop map is empty with nothing to give it back, bootCompleted still
    // false so onSessionEnd returns early and release() never runs -- and a
    // rejected promise that main.ts consumes with a bare void ... .then(), no
    // catch, so it surfaced only as an unhandled rejection. No toast, no
    // onError, and the button still read "Enter AR".
    const view = fakeView();
    const boom = new Error("attach exploded");
    const d = deps({
      buildingView: {
        ...view,
        attachContentTo: (
          root: THREE.Object3D,
          frame: string,
          offset?: { north: number; up: number; east: number },
        ) => {
          // Only the AR attach throws; the desktop restore must still work, or
          // the test could not tell "recovered" from "never got that far".
          if (frame === "gps-world-nue") throw boom;
          view.attachContentTo(root, frame, offset);
        },
      } as unknown as ArModeDeps["buildingView"],
    });

    // THE CONTRACT ITSELF: resolves, never rejects.
    const mode = await startArMode(d);

    expect(mode.started).toBe(false);
    expect(d.onError).toHaveBeenCalled();
    // The session must not be left running with the city detached.
    expect(endARSession).toHaveBeenCalled();
    // And the city goes back to the desktop scene rather than staying orphaned.
    expect(view.attachedTo.map((a) => a.frame)).toContain("demo-scene");
    expect(() => {
      mode.dispose();
    }).not.toThrow();
  });

  it("reports NOT started, so the button never offers to exit nothing", async () => {
    // The flag added for the "error toast plus an Exit AR button" bug, which
    // had no test at all until the r507 review said so.
    initAR.mockRejectedValueOnce(new Error("no session"));

    expect((await startArMode(deps())).started).toBe(false);
  });

  it("reports STARTED when a session really began", async () => {
    // The counterweight: a `started` hard-coded to `false` would pass the test
    // above and silently make AR unenterable.
    expect((await startArMode(deps())).started).toBe(true);
  });

  it("does not strand the city when the scene is missing", async () => {
    // The bail-out path. `initAR` resolved but the scene graph is not there —
    // if the content had already moved, the desktop view would be empty with
    // no session to give it back.
    getScene.mockReturnValueOnce(null);
    const view = fakeView();
    const d = deps({
      buildingView: view as unknown as ArModeDeps["buildingView"],
    });

    await startArMode(d);

    expect(d.onError).toHaveBeenCalledWith("AR scene not ready.");
    expect(view.attachedTo).toEqual([]);
    expect(endARSession).toHaveBeenCalled();
  });

  it("bails out when the camera is missing rather than keeping 0.01 / 200", async () => {
    // The camera is in the same guard as the scene DELIBERATELY. Treating it as
    // optional and carrying on would leave the framework's planes in place, so
    // the city would clip at 200 m — with no error, no log, and a 2.8 km mesh
    // mostly invisible. A bail-out is the honest outcome; there is no session
    // worth having without a camera anyway.
    getCamera.mockReturnValueOnce(null);
    const view = fakeView();
    const d = deps({
      buildingView: view as unknown as ArModeDeps["buildingView"],
    });

    const mode = await startArMode(d);

    expect(mode.started).toBe(false);
    expect(d.onError).toHaveBeenCalledWith("AR scene not ready.");
    expect(view.attachedTo).toEqual([]);
    expect(endARSession).toHaveBeenCalled();
  });

  it("widens the camera's depth budget for the session", async () => {
    // §2.3. The framework's 0.01 / 200 is both too near (~55 cm of depth
    // quantisation at 300 m) and too short (the demo builds a 2.8 km mesh).
    // Asserted here, not only in `ar-scene-environment.test.ts`, because that
    // file proves the function works while this one proves it is CALLED — the
    // exact gap that made three of M1's central claims false.
    await startArMode(deps());

    expect(camera.near).toBe(AR_CAMERA_NEAR_M);
    expect(camera.far).toBe(AR_CAMERA_FAR_M);
  });

  it("grades the session's renderer to match the desktop view", async () => {
    // Also a wiring assertion rather than a behaviour one: `getRenderer()` is a
    // framework accessor added for this, and forgetting to CALL it would leave
    // AR at `NoToneMapping` — every colour in the demo authored under ACES at
    // 0.5, rendered at exposure 1.0.
    await startArMode(deps());

    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(0.5);
  });

  it("samples the AR renderer's OWN draw cost, not the desktop view's", async () => {
    // M4's whole point. `renderer.info` is per-renderer and the session builds
    // a second one, so the desktop status line's figure describes a renderer
    // that is not producing the frames. This asserts the readout reads the one
    // `getRenderer()` returns — and that it is fed from the frame loop at all,
    // which is the M1-shaped gap: a HUD nothing calls shows nothing forever.
    Object.assign(renderer, {
      info: { render: { calls: 37, triangles: 4242 } },
    });
    await startArMode(deps({ container: document.body }));

    const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
      dt: number;
      elapsed: number;
    }) => void;
    expect(onFrame).toBeDefined();
    // TWO frames: the window opens at the first one (`elapsed` is page-relative,
    // so it cannot be assumed to start at zero), which means the first frame
    // spans no time and has no rate to report. The second closes a real window.
    onFrame({ dt: 1 / 60, elapsed: 10 });
    onFrame({ dt: 1 / 60, elapsed: 10.5 });

    expect(document.body.textContent).toContain("37 draws");
    // One frame across a 0.5 s window = 2 fps. Low, but REAL — and that is the
    // point: it is measured, not assumed from `1/dt`.
    expect(document.body.textContent).toContain("2 fps");
  });

  it("asks the caller for the GPS-side numbers at the same cadence", async () => {
    // Pulled rather than pushed, because fixes arrive ~1 Hz while draw cost
    // changes every frame. Asserted because a `liveMeasurements` nobody calls
    // is the same silent nothing as a HUD nobody feeds.
    const liveMeasurements = vi.fn(() => ({
      fixAccuracyM: 6.2,
      metresFromAnchor: 145,
      // THE VERTICAL PAIR TOO. The height residual reported from the field is
      // ~10 m, and telling 'the GPS altitude is wrong' from 'the solve
      // mishandled a good altitude' needs the RAW value on screen beside the
      // aligned baseline. A field that typechecks but never reaches the DOM is
      // the same silent nothing this test already guards against.
      altitudeM: 51.4,
      altitudeAccuracyM: 3.5,
    }));
    await startArMode(deps({ container: document.body, liveMeasurements }));

    const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
      dt: number;
      elapsed: number;
    }) => void;
    onFrame({ dt: 1 / 60, elapsed: 0 });

    expect(liveMeasurements).toHaveBeenCalled();
    expect(document.body.textContent).toContain("gps ±6.2 m");
    expect(document.body.textContent).toContain("alt 51.4 m ±3.5 m");
    expect(document.body.textContent).toContain("145 m from anchor");
  });

  it("starts anyway when the framework has no renderer to grade", async () => {
    // The asymmetry with the camera, at the session level: no renderer must not
    // fail a session, because the only cost is a look. A `getRenderer()` that
    // returns null is also what an older framework build returns, and AR
    // becoming unenterable after a version skew would be a bad trade.
    getRenderer.mockReturnValueOnce(null);

    const mode = await startArMode(deps());

    expect(mode.started).toBe(true);
  });
});

describe("leaving AR", () => {
  it("gives the city back to the desktop view", async () => {
    // THE FRAMEWORK DISCARDS ITS SCENE AT SESSION END. Content still attached
    // to it is content the desktop view no longer has and nothing else
    // reclaims — and three.js reports nothing, so the symptom is an empty map
    // view.
    const view = fakeView();
    const mode = await startArMode(
      deps({ buildingView: view as unknown as ArModeDeps["buildingView"] }),
    );

    mode.dispose();

    expect(view.attachedTo.at(-1)).toEqual({
      root: view.localRoot,
      frame: "demo-scene",
    });
  });

  it("restores the scene environment, so the framework scene is left clean", async () => {
    // M2. What this pins is that `release()` CALLS the restore — not that the
    // framework needs it to. `initAR` builds a fresh scene, camera and renderer
    // per session (r508 review corrected an earlier claim here that it reused
    // them), so nothing leaks either way; what matters is that the one function
    // both exits go through keeps doing the whole job as later milestones add
    // to it.
    //
    // Asserted through the real `applyArEnvironment` rather than a spy, because
    // the observable end state is the thing worth pinning.
    scene.background = null;
    const mode = await startArMode(deps());
    // Entering set fog; leaving must remove it.
    expect(scene.fog).not.toBeNull();

    mode.dispose();

    expect(scene.fog).toBeNull();
    expect(scene.background).toBeNull();
    expect(camera.near).toBe(0.01);
    expect(camera.far).toBe(200);
  });

  it("unregisters the frame sampler and takes the readout down", async () => {
    // The sampler reads the renderer and writes the DOM, and the session is
    // about to drop both. A callback left registered would keep sampling
    // against half-dead state on every frame of whatever runs next — and a HUD
    // left in `#ar-root` keeps a full-viewport layer over the page, which is a
    // regression this demo has already shipped once.
    const container = document.createElement("div");
    document.body.append(container);
    Object.assign(renderer, {
      info: { render: { calls: 5, triangles: 100 } },
    });
    const mode = await startArMode(deps({ container }));
    const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
      dt: number;
      elapsed: number;
    }) => void;
    onFrame({ dt: 1 / 60, elapsed: 0 });
    expect(container.children.length).toBeGreaterThan(0);

    mode.dispose();

    expect(unregisterFrame).toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
    container.remove();
  });

  it("restores the environment on a SYSTEM end too", async () => {
    // The Android back gesture calls no `dispose()`. This is the assertion that
    // makes the merged `release()` worth having — under the old split it would
    // have failed.
    await startArMode(deps());
    expect(scene.fog).not.toBeNull();

    const sessionOptions = initAR.mock.calls[0]?.[3] as {
      onSessionEnd: () => void;
    };
    sessionOptions.onSessionEnd();

    expect(scene.fog).toBeNull();
  });

  it("stops the alignment subscription and ends the session", async () => {
    const mode = await startArMode(deps());

    mode.dispose();

    expect(alignmentDispose).toHaveBeenCalledTimes(1);
    expect(endARSession).toHaveBeenCalledTimes(1);
  });

  it("survives a REAL back gesture followed by dispose, with one teardown", async () => {
    // REWRITTEN. The first version called `dispose()` twice and called that a
    // back gesture — the mocked `endARSession` never invokes `onSessionEnd`, so
    // the interleaving the title names was never exercised. This fires the
    // system end for real, then disposes on top of it.
    //
    // The ordering matters: the back gesture arrives first and must NOT call
    // `endARSession` (the session is already ending), and the later `dispose()`
    // must not end it a second time or re-attach content that is already home.
    const view = fakeView();
    const onEnded = vi.fn();
    const mode = await startArMode(
      deps({
        buildingView: view as unknown as ArModeDeps["buildingView"],
        onEnded,
      }),
    );

    const sessionOptions = initAR.mock.calls[0]?.[3] as {
      onSessionEnd: () => void;
    };
    sessionOptions.onSessionEnd();
    mode.dispose();

    // NEVER, on this path: the system already ended it.
    expect(endARSession).not.toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledTimes(1);
    // Released once, by whichever exit ran first.
    expect(alignmentDispose).toHaveBeenCalledTimes(1);
    // One attach on entry, one on teardown. Not three.
    expect(view.attachedTo).toHaveLength(2);
  });

  it("hands the city back when the SYSTEM ends the session", async () => {
    // The Android back gesture. Nothing calls `dispose()`, so if teardown only
    // lived there the desktop view would come back empty.
    const view = fakeView();
    const onEnded = vi.fn();
    await startArMode(
      deps({
        buildingView: view as unknown as ArModeDeps["buildingView"],
        onEnded,
      }),
    );

    const sessionOptions = initAR.mock.calls[0]?.[3] as {
      onSessionEnd: () => void;
    };
    sessionOptions.onSessionEnd();

    expect(view.attachedTo.at(-1)?.root).toBe(view.localRoot);
    expect(onEnded).toHaveBeenCalledTimes(1);
    // THE ASSERTION THAT WAS MISSING, and its absence is what let the teardown
    // split look safe: everything `dispose()` did beyond re-attaching had to
    // run on this path too. M2, M4 and M5 each add cleanup to it.
    expect(alignmentDispose).toHaveBeenCalledTimes(1);
  });
});

describe("the AR readout's frame rate", () => {
  it("AVERAGES over the window rather than reporting one frame's reciprocal", () => {
    // THE DIFFERENCE THAT MATTERS ON A PHONE (r510 review). A single `1/dt`
    // spikes on GC, a worker message, the terrain field landing — so at a 2 Hz
    // readout the number would flicker between plausible and alarming with no
    // way to tell a sustained drop from a hiccup. Telling those apart is
    // exactly what §4's "is rendering the constraint?" question needs.
    //
    // Thirty frames of 1/60 s, then ONE slow 100 ms frame that crosses the
    // sample window. `1/dt` on that frame would read 10 fps; the average over
    // the 0.6 s window is 31/0.6 ≈ 52.
    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      let elapsed = 0;
      for (let i = 0; i < 30; i++) {
        elapsed += 1 / 60;
        onFrame({ dt: 1 / 60, elapsed });
      }
      elapsed += 0.1;
      onFrame({ dt: 0.1, elapsed });

      // Parsed rather than matched against a hand-computed constant: the exact
      // figure depends on where the 500 ms window happens to close, and a
      // brittle equality here would be a test about arithmetic rather than
      // about smoothing. What must hold is that the reading is near the
      // SUSTAINED rate and nowhere near the one slow frame's 10 fps.
      const reported = Number(
        /(\d+) fps/.exec(document.body.textContent ?? "")?.[1],
      );
      expect(reported).toBeGreaterThan(40);
      expect(reported).toBeLessThanOrEqual(60);
    });
  });

  it("puts the alignment's vertical baseline on screen", () => {
    // §4 predicts the Y-baseline jump and names `matrix[13]` as the term. The
    // milestone is called "measure, then choose"; an instrument that could not
    // see the axis its own prediction is about would have a hole in it.
    arWorldGroup.matrix.elements[13] = -0.37;

    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      onFrame({ dt: 1 / 60, elapsed: 1 / 60 });

      expect(document.body.textContent).toContain("world floor -0.37 m");
      arWorldGroup.matrix.elements[13] = 0;
    });
  });
});

describe("the readout refuses to invent numbers (r511 review)", () => {
  it("opens the fps window at the FIRST frame, not at zero", () => {
    // `elapsed` is PAGE-relative — the frame loop computes it from the rAF
    // timestamp, and the framework's docstring saying "since the session
    // started" is what made seeding to 0 look safe. On a device, a session
    // entered 30 s after load then made the first window 30 s long and the
    // first reading "0 fps".
    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      // A session entered thirty seconds after page load, ONE frame in.
      //
      // Asserted on the FIRST accepted sample specifically, because that is the
      // only place the bug is observable: a second frame closes a real 0.5 s
      // window and overwrites the bad reading, so a two-frame version of this
      // test passes against the defect. (It did. That is how this comment
      // exists.)
      onFrame({ dt: 1 / 60, elapsed: 30 });

      // The window opened on this very frame, so it spans no time and there is
      // no rate yet — correct, and reported as silence. Seeded at zero the
      // window would have been the whole 30 s the page had been open, and the
      // first thing the user read would have been "0 fps".
      expect(document.body.textContent).not.toContain("fps");
    });
  });

  it("says nothing about the baseline until an alignment exists", () => {
    // `createSceneHierarchy` leaves the matrix at identity, whose element 13 is
    // a perfectly real `0` — so the readout claimed `baseline 0.00 m` before
    // the fusion had said anything. Zero is a plausible reading, which makes it
    // the worst possible placeholder.
    arWorldGroup.matrix.identity();

    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      onFrame({ dt: 1 / 60, elapsed: 1 });

      expect(document.body.textContent).not.toContain("baseline");
    });
  });

  it("reports a GENUINE zero baseline once an alignment has been written", () => {
    // The counterweight, and the reason the check is against the whole matrix
    // rather than against element 13: an alignment that happens to be level
    // must still be reportable, or the guard would hide the very reading that
    // says "no vertical error".
    arWorldGroup.matrix.identity();
    arWorldGroup.matrix.elements[12] = 5; // a northward alignment, level.

    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      onFrame({ dt: 1 / 60, elapsed: 1 });

      expect(document.body.textContent).toContain("world floor 0.00 m");
      arWorldGroup.matrix.identity();
    });
  });

  it("reports the bearing in WORLD space, so the alignment is carried", () => {
    // Why this test matters (PR #312 review): this call site is the one frame
    // choice in the file with no test, and it is the choice three independent
    // readers have already got backwards (`ar-scene-hierarchy.ts` records two,
    // an earlier HUD review a third). `nueBearingDeg`'s own tests cannot catch
    // a regression here — they take north/east as arguments, so swapping this
    // call site to `arWorldGroup.worldToLocal(...)` passes the whole suite.
    //
    // THE ASSERTION MUST BE A VALUE THE UN-ALIGNED READING CANNOT PRODUCE, or
    // it degrades to "some number appears". So the camera is parented under
    // `arWorldGroup` exactly as production parents it, the group carries a 90°
    // yaw, and the camera's LOCAL forward points along −Z. Relative to the
    // group that is bearing 90° (east, in the N=x/E=z convention); rotated by
    // the group's yaw it is a different bearing entirely. Only the world-space
    // reading can produce the latter.
    // The bearing is an EXPANDED-set line (`pushExpanded`), so a collapsed HUD
    // would show nothing and the assertion would pass vacuously in reverse.
    window.localStorage.setItem("osm-demo:ar-hud-expanded", "1");
    arWorldGroup.matrix.identity();
    arWorldGroup.rotation.set(0, Math.PI / 2, 0);
    arWorldGroup.updateMatrix();
    arWorldGroup.matrixAutoUpdate = false;
    arWorldGroup.add(camera);
    camera.rotation.set(0, 0, 0);
    arWorldGroup.updateMatrixWorld(true);

    // What the two frames actually give, computed from the same primitive the
    // production line uses, so the expectation is not a hand-copied constant.
    const local = new THREE.Vector3();
    camera.getWorldDirection(local);
    const worldBearing = nueBearingDeg(local.x, local.z);

    const relative = new THREE.Vector3(0, 0, -1);
    const unaligned = nueBearingDeg(relative.x, relative.z);

    // The fixture is only meaningful if the two frames DISAGREE.
    expect(worldBearing).toBeDefined();
    expect(worldBearing).not.toBeCloseTo(unaligned as number, 1);

    return startArMode(deps({ container: document.body })).then(() => {
      const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (ctx: {
        dt: number;
        elapsed: number;
      }) => void;
      onFrame({ dt: 1 / 60, elapsed: 1 });

      expect(document.body.textContent).toContain(
        `heading ${Math.round(worldBearing as number)}° fused`,
      );
      // And explicitly NOT the un-aligned reading, which is the regression this
      // test exists to catch rather than merely a different number.
      expect(document.body.textContent).not.toContain(
        `heading ${Math.round(unaligned as number)}° fused`,
      );

      window.localStorage.removeItem("osm-demo:ar-hud-expanded");
      arWorldGroup.remove(camera);
      arWorldGroup.rotation.set(0, 0, 0);
      arWorldGroup.matrix.identity();
      arWorldGroup.updateMatrixWorld(true);
    });
  });
});

/**
 * Why these tests matter: the nudge is only a fix if it reaches the scene. The
 * arithmetic is covered in `elevation-nudge.test.ts` and the DOM in
 * `ar-elevation-control.test.ts`; what neither can see is whether the value ever
 * arrives at `attachContentTo` — the same "typechecks but never renders" gap the
 * live-measurements test above already guards.
 */
describe("the elevation nudge reaches the scene", () => {
  const pressIn = (container: HTMLElement, label: string) => {
    const target = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    if (target === undefined) throw new Error(`no ${label} button`);
    target.click();
  };

  it("re-attaches the content with the offset added to the geometric one", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = fakeView();
    await startArMode(
      deps({
        container,
        buildingView: view as unknown as ArModeDeps["buildingView"],
      }),
    );

    const arAttach = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(arAttach).toHaveLength(1);
    const base = arAttach[0]?.offset;
    expect(base).toBeDefined();

    pressIn(container, "+");

    const after = view.attachedTo.filter((a) => a.frame === "gps-world-nue");
    expect(after).toHaveLength(2);
    // SUMMED ONTO the geometric offset, not replacing it: the north/east terms
    // place the city and dropping them puts it in the wrong country.
    expect(after[1]?.offset?.north).toBe(base?.north);
    expect(after[1]?.offset?.east).toBe(base?.east);
    expect(after[1]?.offset?.up).toBe((base?.up ?? 0) + 1);
  });

  it("takes the control down when the session ends", async () => {
    // `#ar-root` is hidden only while `:empty`, so a control left behind keeps a
    // full-viewport layer over the page.
    const container = document.createElement("div");
    document.body.append(container);
    const mode = await startArMode(deps({ container }));
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);

    mode.dispose();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

/**
 * Why these tests matter: the compass slider is only a control if its four
 * settings reach the store, and the mapping test cannot see the wiring while the
 * DOM test cannot see the dispatch. The specific failure guarded here is a
 * slider wired to ONE setter — which looks completely correct on screen and
 * leaves the compass driving at the zero end, because at vote weight 0 the
 * steady-state formula is `1 − observability` and the cold-start override takes
 * over anyway.
 */
describe("the compass slider reaches the store", () => {
  const sliderIn = (container: HTMLElement): HTMLInputElement => {
    const found = container.querySelector("input[type=range]");
    if (found === null) throw new Error("no compass slider");
    return found as HTMLInputElement;
  };

  it("passes the FULL settings object through on a drag", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onCompassSettings = vi.fn();
    await startArMode(deps({ container, onCompassSettings }));

    const slider = sliderIn(container);
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));

    // ALL FOUR, and the zero end especially: one setter would leave the
    // cold-start override driving yaw while the label reads "GPS only".
    expect(onCompassSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rotationPriorEnabled: false,
        coldStartOverrideEnabled: false,
        experimentEnabled: false,
        voteWeight: 0,
      }),
    );
  });

  it("is usable immediately, because AR entry already required a fix", async () => {
    // The setters no-op while the store's gps state is null, so the control
    // starts disabled. Entry is gated on `canEnterAr`, i.e. a non-null `zero`,
    // so `ar-mode` may enable it at once — and if that call is ever dropped the
    // slider is permanently dead.
    const container = document.createElement("div");
    document.body.append(container);
    await startArMode(deps({ container, onCompassSettings: vi.fn() }));

    expect(sliderIn(container).disabled).toBe(false);
  });

  it("is absent when the caller cannot dispatch", async () => {
    // No `onCompassSettings` means no control, rather than a slider that
    // silently does nothing.
    const container = document.createElement("div");
    document.body.append(container);
    await startArMode(deps({ container }));

    expect(container.querySelector("input[type=range]")).toBeNull();
  });

  it("takes the slider down when the session ends", async () => {
    // `#ar-root` is hidden only while `:empty`.
    const container = document.createElement("div");
    document.body.append(container);
    const mode = await startArMode(
      deps({ container, onCompassSettings: vi.fn() }),
    );
    expect(container.querySelector("input[type=range]")).not.toBeNull();

    mode.dispose();
    expect(container.querySelector("input[type=range]")).toBeNull();
  });
});

/**
 * Why these tests matter: the AR shell material is applied to the shared
 * `BuildingView`, not to a copy — so a session that fails to restore it leaves an
 * ADDITIVE, depth-write-free material on the desktop view. That is invisible
 * until someone looks at the map again, and then reads as a rendering bug with no
 * obvious connection to AR having been used.
 */
describe("the AR building shell", () => {
  it("applies on entry and restores on dispose", async () => {
    const view = fakeView();
    const mode = await startArMode(
      deps({ buildingView: view as unknown as ArModeDeps["buildingView"] }),
    );

    expect(view.shellCalls[0]).toBeDefined();
    expect(view.shellCalls[0]).toBeInstanceOf(THREE.ShaderMaterial);

    mode.dispose();
    // The LAST call must be the restore, whatever happened in between.
    expect(view.shellCalls.at(-1)).toBeUndefined();
  });

  it("restores on a SYSTEM-initiated end too, not just dispose()", async () => {
    // The Android back gesture never calls `dispose()`. This is the path that
    // would leave the material behind.
    const view = fakeView();
    await startArMode(
      deps({ buildingView: view as unknown as ArModeDeps["buildingView"] }),
    );

    const sessionOptions = initAR.mock.calls[0]?.[3] as {
      onSessionEnd: () => void;
    };
    sessionOptions.onSessionEnd();

    expect(view.shellCalls.at(-1)).toBeUndefined();
  });
});

describe("the AR entry fly-down (H5, Q5)", () => {
  /**
   * Why these tests matter: the descent moves the whole city on the same axis
   * the auto-elevation estimator and the manual trim already move it. The curve
   * is proven in `ar-descent.test.ts`; what only this file can prove is that it
   * reaches `attachContentTo` as a COMPOSED term rather than as its own write —
   * the "typechecks but never renders" gap, and here also the "gets clobbered by
   * the next auto tick" gap that `applyElevation` setting-rather-than-
   * accumulating creates. Those two ARE pinned here: mutating the descent so it
   * never lifts fails three of these.
   *
   * MUTATION-VERIFIED, and the route there is worth recording because the first
   * conclusion was wrong. A descent that never lands — `DESCENT_FALL_S` raised
   * so the fall outlives the session — fails three of these, including the
   * landing signal. A descent that never lifts fails three others.
   *
   * **But mutating `if (t >= 1) return 0;` to `return start` changes nothing
   * here, and that is NOT a gap in these tests.** That branch is unreachable
   * through the frame loop: `1 - smoothstep(t)` underflows to exactly 0 a frame
   * BEFORE `t` reaches 1, so the descent reports complete and the block stops
   * before that line can run. The branch still matters for a caller that skips
   * frames, and `ar-descent.test.ts` covers it directly at `end + 60`.
   *
   * The lesson, since half an hour went into it: **a surviving mutant is not
   * evidence of a weak test until the mutant is shown to be reachable.**
   */
  const START_M = 60;

  /**
   * A local frame driver rather than the walking one above: the descent is
   * driven purely by `elapsed`, and simulating a walk here would add motion the
   * feature does not read while making the test look like it depended on it.
   */
  const runFrames = (fromS: number, toS: number, stepS = 1 / 60): void => {
    const onFrame = registerXrFrameUpdate.mock.calls[0]?.[0] as (input: {
      dt: number;
      elapsed: number;
    }) => void;
    for (let elapsed = fromS; elapsed <= toS; elapsed += stepS) {
      onFrame({ dt: stepS, elapsed });
    }
  };

  const viewAtHeight = (heightM: number) => {
    const view = fakeView();
    Object.assign(view, { cameraHeightM: () => heightM });
    return view;
  };

  const applied = (view: ReturnType<typeof fakeView>): number[] =>
    view.attachedTo
      .filter((a) => a.frame === "gps-world-nue")
      .map((a) => a.offset?.up ?? 0);

  const upAt = (view: ReturnType<typeof fakeView>): number | undefined =>
    applied(view).at(-1);

  it("sinks the city to the 3D view's camera DEPTH and raises it to zero", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const view = viewAtHeight(START_M);

    await startArMode(
      deps({
        container,
        buildingView: view as unknown as ArModeDeps["buildingView"],
      }),
    );

    // The first frame SINKS it (DEC-Y14) — the hold is what makes the move
    // legible. r541 lifted it instead, putting the city over the user's head.
    runFrames(1, 1);
    expect(upAt(view)).toBeCloseTo(-START_M, 1);

    // And it is back on the ground once the hold plus the fall have run.
    runFrames(1, 10);
    expect(upAt(view)).toBeCloseTo(0, 2);

    // IT ANIMATED THROUGH THE COMPOSITION, rather than being lifted once and
    // set down once. Mutation testing found the first version of these
    // assertions green against a descent that STALLED at full height forever —
    // the exact failure the end-state signal exists to distinguish — because
    // nothing here looked at the values in between.
    const ups = applied(view);
    expect(ups.length).toBeGreaterThan(3);
    const between = ups.filter((up) => up < -1 && up > -START_M + 1);
    expect(
      between.length,
      "the ascent never passed through an intermediate depth",
    ).toBeGreaterThan(0);
    // And it is monotone UP FROM THE TROUGH, so it cannot have bounced.
    //
    // From the trough rather than from the first entry, because `ar-mode` calls
    // `applyElevation(0)` once at setup — so the recorded sequence legitimately
    // starts at 0, SINKS to the entry depth on the first frame, and only then
    // rises. Checking from index 0 fails on correct code, which is how this
    // assertion was written the first time. Inverted with DEC-Y14 along with
    // the direction it describes.
    const trough = ups.indexOf(Math.min(...ups));
    for (let i = trough + 1; i < ups.length; i += 1) {
      expect(ups[i]).toBeGreaterThanOrEqual((ups[i - 1] ?? 0) - 1e-6);
    }
  });

  it("does nothing at all when the 3D view was already at ground level", async () => {
    // The contract that keeps every existing session unchanged: entering AR
    // from a ground-level view must behave exactly as it did before Q5.
    const container = document.createElement("div");
    document.body.append(container);
    const view = viewAtHeight(0);

    await startArMode(
      deps({
        container,
        buildingView: view as unknown as ArModeDeps["buildingView"],
      }),
    );
    runFrames(1, 1);

    expect(upAt(view) ?? 0).toBeCloseTo(0, 5);
  });

  it("fades the camera feed in, and clears it fully on landing", async () => {
    // DEC-Y3: one animated number on `renderer.setClearAlpha`, valid because AR
    // entry sets `scene.background = null`. Hidden at the start (alpha 1) so the
    // first moment of AR looks like the 3D view the user was just in, and fully
    // transparent when the city lands.
    const container = document.createElement("div");
    document.body.append(container);
    const view = viewAtHeight(START_M);
    const setClearAlpha = renderer.setClearAlpha as unknown as ReturnType<
      typeof vi.fn
    >;
    setClearAlpha.mockClear();

    await startArMode(
      deps({
        container,
        buildingView: view as unknown as ArModeDeps["buildingView"],
      }),
    );
    runFrames(1, 1);
    expect(setClearAlpha.mock.calls.at(-1)?.[0]).toBeCloseTo(1, 2);

    runFrames(1, 10);
    expect(setClearAlpha.mock.calls.at(-1)?.[0]).toBe(0);
  });

  it("announces the landing, so a STALLED descent is distinguishable", async () => {
    // The end-state signal. Without it, a descent that stops half-way is
    // indistinguishable from the recorded "flying roughly 50 m above the OSM
    // buildings" datum bug — and that ambiguity is what would make a field
    // report unactionable.
    const container = document.createElement("div");
    document.body.append(container);
    const onDescentComplete = vi.fn();

    await startArMode(
      deps({
        container,
        buildingView: viewAtHeight(
          START_M,
        ) as unknown as ArModeDeps["buildingView"],
        onDescentComplete,
      }),
    );

    runFrames(1, 1);
    expect(onDescentComplete).not.toHaveBeenCalled();

    runFrames(1, 10);
    expect(onDescentComplete).toHaveBeenCalledTimes(1);

    // ONCE, not once per frame: a signal that repeats is a signal nobody reads.
    runFrames(1, 5);
    expect(onDescentComplete).toHaveBeenCalledTimes(1);
  });
});
