/**
 * Stations as deferred anchors, end to end in real three: the station
 * side table (`station-content.ts`) under a real AR world group, bound by
 * the framework's `enableArWorldGroupAlignment` to a store whose alignment
 * the test moves, with the framework's anchor pass run frame by frame.
 *
 * Why these tests matter: this is the visible behaviour change of stations
 * becoming anchors. Each case pins one rule a visitor sees: while the
 * alignment is young a station follows it at once (as before); once it is
 * mature a station in view keeps its place on the screen and lands where
 * its coordinates say once looked away from; a code lock or a tracking
 * frame switch places it at once; and the edge hint's tag, placed against
 * the station every frame, is never drawn against the station matrix of
 * the frame before in a frame where the station commits (between commits
 * the page's own tick places it).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization/ar-world-group-alignment";
import {
  __runPassForTests,
  DEFERRED_ANCHOR_EPSILON_M,
} from "gps-plus-slam-app-framework/ar/deferred-anchors";
import { clearFrameUpdates } from "gps-plus-slam-app-framework/ar/frame-loop";
import {
  clearSessionDisposers,
  runSessionDisposers,
} from "gps-plus-slam-app-framework/ar/session-disposers";
import { createQrTrackingController } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import type { SubscribableStore } from "gps-plus-slam-app-framework/state/subscribe-to-selector";

import { edgeHintPart } from "./kinds/short-text/edge-hint.js";
import {
  buildViewerControllerConfig,
  MAX_VOTED_LOCKS_PER_CODE,
} from "./qr-viewer-mode.js";
import { createStationContent, type ContentPart } from "./station-content.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import { tickWorldParts, worldEnv, type WorldPart } from "./world-part.js";

// The vote builder's geodesy is licence-gated; the store's construction
// activates it, as main.ts does at boot.
createTourViewerStore();

const DT = 1 / 30;
const ZERO = { lat: 47.5, lon: 8.7, alt: 400 };
/** The station's ring, in GPS-world NUE: 10 m ahead of the camera. */
const RING_NUE = new THREE.Vector3(0, 0, -10);
/** Where the edge hint stands: far to the side, so its tag sits at the screen edge. */
const HINT_NUE = new THREE.Vector3(40, 0, -2);
const TOL = 1e-6;

/** The part of the store the binding reads: zero, alignment, the GPS
 *  positions whose spread makes the alignment mature, the frame epoch. */
function makeStore(extentM: number) {
  const listeners = new Set<() => void>();
  let alignment: number[] = new THREE.Matrix4().toArray();
  let epoch = 0;
  const positions = [0, extentM].map((n, i) => ({
    id: `p${i}`,
    timestamp: i,
    coordinates: [n, 0, 0] as [number, number, number],
  }));
  const build = () => ({
    gpsData: {
      zero: ZERO,
      gpsEvents: { alignmentMatrix: alignment, gpsPositions: positions },
    },
    qrDetected: { frameEpoch: epoch },
  });
  let state = build();
  const emit = () => {
    state = build();
    for (const l of [...listeners]) l();
  };
  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** An alignment moving the GPS world north by `north` m (yaw in deg). */
    setNorth(north: number, yawDeg = 0) {
      alignment = new THREE.Matrix4()
        .makeTranslation(north, 0, 0)
        .multiply(
          new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg)),
        )
        .toArray();
      emit();
    },
    bumpEpoch() {
      epoch += 1;
      emit();
    },
  } as unknown as SubscribableStore & {
    setNorth(north: number, yawDeg?: number): void;
    bumpEpoch(): void;
  };
}

const block = {
  id: "toilets",
  kind: "shortText",
  view: "edgeHint",
  caption: "Toilets",
} as Parameters<typeof edgeHintPart>[0];

/** A station of a ring 10 m ahead and, with `hint`, an edge hint far to
 *  the side, entered as an anchor under the world group. */
async function world({
  extentM = 40,
  hint = false,
}: { extentM?: number; hint?: boolean } = {}) {
  const store = makeStore(extentM);
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  enableArWorldGroupAlignment({ store, arWorldGroup: group });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);
  group.add(camera);
  const hintParts: WorldPart[] = [];
  const env = worldEnv("play", [], () => Promise.reject(new Error("none")));
  let nowMs = 0;
  const commits: THREE.Object3D[] = [];
  const ring = new THREE.Mesh(
    new THREE.SphereGeometry(0.5),
    new THREE.MeshBasicMaterial(),
  );
  ring.position.copy(RING_NUE);
  const tick = (root: THREE.Object3D | null) => {
    tickWorldParts(root, camera, nowMs, hintParts, 800);
  };
  const part: ContentPart = {
    render(parent) {
      parent.add(ring);
      if (hint) {
        const p = edgeHintPart(block, env);
        p.object.position.copy(HINT_NUE);
        parent.add(p.object);
        hintParts.push(p);
      }
      return Promise.resolve({ count: 1, skipped: [], dispose: () => {} });
    },
  };
  const content = createStationContent({
    scene,
    now: () => nowMs,
    fadeMs: 1,
    anchorParent: () => group,
    onAnchorCommit: (root) => {
      commits.push(root);
      tick(root);
    },
  });
  // One pass at the identity: the group and camera hold their matrices.
  let elapsed = 0;
  const pass = () => {
    const counts = __runPassForTests(group, camera, DT, elapsed);
    elapsed += DT;
    nowMs += DT * 1000;
    return counts;
  };
  pass();
  content.setPart("s", "items", part);
  content.show(new Set(["s"]));
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  content.update(nowMs);
  const station = group.getObjectByName("station-content:s");
  if (station === undefined) throw new Error("the station did not enter");
  return {
    store,
    scene,
    group,
    camera,
    content,
    commits,
    ring,
    hintParts,
    station,
    pass,
    /** One frame as the page runs it: the page's own tick of the world
     *  parts (the store subscription), the frame loop (binding step and
     *  anchor pass, with any commit's re-tick), then the render's matrix
     *  update. */
    frame() {
      scene.updateMatrixWorld();
      tick(scene);
      const counts = pass();
      scene.updateMatrixWorld();
      return counts;
    },
    /** The ring's pose in the camera's frame. */
    ringInCamera(): THREE.Vector3 {
      scene.updateMatrixWorld();
      return ring
        .getWorldPosition(new THREE.Vector3())
        .applyMatrix4(camera.matrixWorld.clone().invert());
    },
    /** The ring's world position's distance from its NUE. */
    ringError(): number {
      scene.updateMatrixWorld();
      return ring.getWorldPosition(new THREE.Vector3()).distanceTo(RING_NUE);
    },
    look(dir: "in" | "out") {
      camera.rotation.set(0, dir === "in" ? 0 : Math.PI, 0);
    },
  };
}

afterEach(() => {
  runSessionDisposers();
  clearSessionDisposers();
  clearFrameUpdates();
});

describe("a station as a deferred anchor", () => {
  it("enters under the world group at its NUE pose", async () => {
    const w = await world();
    expect(w.station.parent).toBe(w.group);
    expect(w.scene.children).not.toContain(w.station);
    expect(w.ringError()).toBeLessThan(TOL);
  });

  it("follows a young alignment at once, in view (as before)", async () => {
    // Extent 20 m: the alignment is not mature, no code voted.
    const w = await world({ extentM: 20 });
    for (const north of [0.5, 1, 2, -1.5, 3]) {
      w.store.setNorth(north, north * 2);
      w.frame();
      expect(w.ringError()).toBeLessThan(TOL);
    }
  });

  it("keeps its place on the screen in view once mature, and lands at its NUE once looked away from", async () => {
    // The 2 m change is far above the 2 cm epsilon; extents 40 m and
    // 200 m are both mature (the threshold is 40 m).
    for (const extentM of [40, 200]) {
      const w = await world({ extentM });
      const before = w.ringInCamera();
      w.store.setNorth(2, 3);
      for (let i = 0; i < 60; i += 1) {
        w.frame();
        expect(w.ringInCamera().distanceTo(before)).toBeLessThan(TOL);
      }
      expect(w.ringError()).toBeGreaterThan(1);
      w.look("out");
      w.frame();
      w.frame();
      w.frame();
      expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
      runSessionDisposers();
      clearSessionDisposers();
      clearFrameUpdates();
    }
  });

  it("does not commit for one pass out of view between passes in view", async () => {
    const w = await world();
    w.store.setNorth(2);
    w.frame();
    const commitsBefore = w.commits.length;
    w.look("out");
    w.frame();
    w.look("in");
    w.frame();
    w.frame();
    expect(w.commits.length).toBe(commitsBefore);
    expect(w.ringError()).toBeGreaterThan(1);
  });

  it("corrects at once in view after a tracking frame switch", async () => {
    const w = await world();
    w.store.bumpEpoch();
    w.store.setNorth(0.5);
    w.frame();
    expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
  });

  it("corrects at once in view after a camera jump of more than a metre", async () => {
    const w = await world();
    w.store.setNorth(2);
    w.frame();
    expect(w.ringError()).toBeGreaterThan(1);
    w.camera.position.x += 1.5;
    w.frame();
    expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
  });

  it("counts a part mounted after the station entered at the next pass", async () => {
    // Why: a part that lands in a standing station changes what the view
    // test must see; without `boundsChanged` the cached bounds would miss it.
    // A pending change keeps the station's view test running each pass.
    const w = await world();
    w.store.setNorth(2);
    w.frame();
    w.frame(); // the first view test builds the bounds
    expect(w.frame().traversals).toBe(0);
    const late = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    w.content.setPart("s", "late", {
      render(parent) {
        parent.add(late);
        return Promise.resolve({ count: 1, skipped: [], dispose: () => {} });
      },
    });
    for (let i = 0; i < 3; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.frame().traversals).toBeGreaterThan(0);
  });

  it("leaves the world group when it fades out", async () => {
    const w = await world();
    w.content.show(new Set());
    w.content.update(1e9);
    w.content.update(2e9);
    expect(w.group.getObjectByName("station-content:s")).toBeUndefined();
    // Left the anchor too, not only the group: the anchor gave its matrix
    // back (a group still held by it would be re-placed off the scene).
    expect(w.station.matrixAutoUpdate).toBe(true);
  });
});

describe("the edge hint on an anchored station", () => {
  it("does not hold the station: its tag stands in view while the station is out of view", async () => {
    const w = await world({ hint: true });
    w.store.setNorth(2);
    w.look("out");
    w.frame();
    w.frame();
    w.frame();
    // The tag is drawn in front of the camera, yet the station landed.
    const tags = w.hintParts[0]!.object.children.filter(
      (c) => c.visible && c.renderOrder === 999,
    );
    expect(tags).toHaveLength(1);
    expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
  });

  it("draws its tag against the committed station in the frame of a commit", async () => {
    // Why: the tag's local matrix is computed against the station's world
    // matrix; a commit after the page's tick would leave it, for that
    // frame, placed against the station of the frame before. Compared
    // after the render's matrix update, never right after the commit.
    const w = await world({ hint: true });
    w.look("out");
    w.frame();
    w.frame();
    w.store.setNorth(2, 5);
    const tag = w.hintParts[0]!.object.children.find(
      (c) => c.renderOrder === 999,
    )!;
    // Frames until the one that commits, and the check right after it:
    // a later frame's page tick would re-place the tag anyway.
    const commitsBefore = w.commits.length;
    for (let i = 0; i < 6 && w.commits.length === commitsBefore; i += 1) {
      w.frame();
    }
    expect(w.commits.length).toBeGreaterThan(commitsBefore);
    const drawn = tag.matrixWorld.clone();
    // A fresh tick against the committed station places it where it was drawn.
    tickWorldParts(w.scene, w.camera, 0, w.hintParts, 800);
    w.scene.updateMatrixWorld();
    const fresh = tag.matrixWorld;
    const a = new THREE.Vector3().setFromMatrixPosition(drawn);
    const b = new THREE.Vector3().setFromMatrixPosition(fresh);
    expect(a.distanceTo(b)).toBeLessThan(TOL);
  });
});

describe("a code lock through the viewer's pipeline", () => {
  const TEXT = "https://example.test/tour/?qr=anchor";
  const LEVEL: QrLevel = {
    version: 1,
    qr: {
      physicalSizeM: 0.2,
      geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    },
  };
  let textId = "";
  beforeAll(async () => {
    textId = await qrCodeId(TEXT);
  });
  const frame: CapturedCameraFrame = {
    image: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    capturedAtMs: 1,
  };
  // A macrotask: the level lookup hashes the text with Web Crypto.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** The real controller over the viewer's config; each cast moves the
   *  store's alignment to `northOnCast()`. */
  function pipeline(onCast: () => void, { canAccept = true } = {}) {
    let casts = 0;
    const config = buildViewerControllerConfig({
      frontEnd: {
        kind: "barcode-detector",
        detect: () =>
          Promise.resolve({
            text: TEXT,
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          }),
      },
      solvePose: () => ({
        qrPoseWorld: { position: [0, 0, -2], rotation: [0, 0, 0, 1] },
        qrPoseInCamera: { position: [0, 0, -2], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 0.5,
      }),
      getIntrinsics: () => ({ fx: 600, fy: 600, cx: 320, cy: 240 }),
      getLevels: () => new Map([[textId, LEVEL]]),
      dispatchVotes: () => {
        casts += 1;
        onCast();
        return true;
      },
      canAcceptVotes: () => canAccept,
      resolveStablePose: () => ({
        position: [0, 0, -2],
        rotation: [0, 0, 0, 1],
      }),
      recordDetection: () => undefined,
      onError: () => undefined,
    });
    const controller = createQrTrackingController(config);
    return {
      /** Offer frames until one more lock cast or `max` frames went by:
       *  a lock takes a varying number of macrotasks (the level hash), so a
       *  fixed frame count would be flaky. */
      async lock(max = 30) {
        const before = casts;
        for (let i = 0; i < max && casts === before; i += 1) {
          controller.offerFrame(frame);
          await flush();
        }
      },
      casts: () => casts,
      dispose: () => controller.dispose(),
    };
  }

  it("snaps a pending station in view to the code-corrected place at the next pass", async () => {
    const w = await world();
    w.store.setNorth(2);
    w.frame();
    expect(w.ringError()).toBeGreaterThan(1);
    let casts = 0;
    const p = pipeline(() => {
      casts += 1;
      w.store.setNorth(3);
    });
    await p.lock();
    expect(casts).toBeGreaterThan(0);
    w.frame();
    expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
    p.dispose();
  });

  it("a spent code casts nothing and moves nothing", async () => {
    const w = await world();
    let casts = 0;
    let north = 0;
    const p = pipeline(() => {
      casts += 1;
      north += 0.5;
      w.store.setNorth(north);
    });
    // Spend the budget, every lock landing at once.
    for (
      let i = 0;
      i < MAX_VOTED_LOCKS_PER_CODE * 3 && casts < MAX_VOTED_LOCKS_PER_CODE;
      i += 1
    ) {
      await p.lock();
      w.frame();
    }
    expect(casts).toBe(MAX_VOTED_LOCKS_PER_CODE);
    // A GPS change in view now waits, and further locks of the code do not
    // release it.
    w.store.setNorth(north + 2);
    w.frame();
    const before = w.ringInCamera();
    await p.lock();
    w.frame();
    expect(casts).toBe(MAX_VOTED_LOCKS_PER_CODE);
    expect(w.ringInCamera().distanceTo(before)).toBeLessThan(TOL);
    p.dispose();
  });

  it("a lock whose votes the viewer refuses releases no station in view", async () => {
    // Why: the code-vote wrapper reports whether it cast. A wrapper that
    // refused the votes (no tour levels, no session) yet told the
    // controller it cast would release every pending station in view with
    // no correction behind it, a visible jump for nothing.
    const w = await world();
    w.store.setNorth(2);
    w.frame();
    const before = w.ringInCamera();
    let casts = 0;
    const p = pipeline(
      () => {
        casts += 1;
      },
      { canAccept: false },
    );
    await p.lock();
    w.frame();
    expect(casts).toBe(0);
    expect(w.ringInCamera().distanceTo(before)).toBeLessThan(TOL);
    expect(w.ringError()).toBeGreaterThan(1);
    p.dispose();
  });

  it("after a code lock, a young alignment's GPS change in view waits too", async () => {
    const w = await world({ extentM: 20 });
    const p = pipeline(() => w.store.setNorth(1));
    await p.lock();
    expect(p.casts()).toBe(1);
    w.frame();
    expect(w.ringError()).toBeLessThan(DEFERRED_ANCHOR_EPSILON_M);
    const before = w.ringInCamera();
    w.store.setNorth(3);
    w.frame();
    w.frame();
    expect(w.ringInCamera().distanceTo(before)).toBeLessThan(TOL);
    p.dispose();
  });
});
