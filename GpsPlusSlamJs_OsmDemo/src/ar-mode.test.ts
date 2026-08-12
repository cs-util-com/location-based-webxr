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
}));
vi.mock("gps-plus-slam-app-framework/visualization", () => ({
  enableArWorldGroupAlignment: mocks.enableArWorldGroupAlignment,
}));

const {
  initAR,
  endARSession,
  getScene,
  getArWorldGroup,
  getCamera,
  getRenderer,
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

import { startArMode, type ArModeDeps } from "./ar-mode.js";
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
  } as THREE.WebGLRenderer;
  getRenderer.mockReturnValue(renderer);
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

  it("asks for no camera, depth or hit-test features", async () => {
    // Every one of these defaults ON and none is used: the city's position
    // comes from GPS, not from vision. Depth-sensing matters most — it
    // OVERRIDES the camera's near/far planes when a texture is present, which
    // would silently invalidate M4's far-plane work.
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
