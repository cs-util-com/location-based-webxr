/**
 * Tests for the deferred anchors (`deferredAnchor`).
 *
 * Why these tests matter: a deferred anchor is content that must not move
 * on screen while someone looks at it, yet must land on the corrected pose
 * as soon as nobody does. Each case below pins one rule of that contract:
 * when content may move (out of view for two frames at both poses, a code
 * lock, a frame switch, the immature phase), when it must not (in view,
 * under the noise epsilon), and the bookkeeping that keeps those rules
 * honest (the release is one-shot and per session, the window closes, the
 * traversal budget holds). Scenes are synthetic; the view comes from a
 * camera under the AR world group, as in a session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  GPS_POINT_SOURCE_SYNTHETIC_QR,
  recordGpsEventBatch,
  setZeroPos,
} from 'gps-plus-slam-js';
import {
  ANCHOR_SPHERE_CAP,
  createAnchorView,
  updateAnchorView,
} from './anchor-visibility';
import {
  __resetAnchorReleaseForTests,
  hasCodeVoted,
  registerReleaseReceiver,
  requestAnchorRelease,
} from './anchor-release';
import {
  FRAME_JUMP_THRESHOLD_M,
  WINDOW_MAX_S,
  WINDOW_MIN_S,
  __runPassForTests,
  deferredAnchor,
  observeDeferredAnchorPasses,
  type DeferredAnchorPassSample,
} from './deferred-anchors';
import { LogLevel, subscribeToLogs, type LogEntry } from '../utils/logger';
import { clearFrameUpdates, runFrameUpdates } from './frame-loop';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from './session-disposers';
import { enableArWorldGroupAlignment } from '../visualization/ar-world-group-alignment';
import { createSlamAppStore } from '../state/create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { buildQrGpsVotes } from './qr/qr-gps-vote';
import type { SubscribableStore } from '../state/subscribe-to-selector';

const DT = 1 / 20;

interface Point {
  id: string;
  timestamp: number;
  coordinates: [number, number, number];
}

let pointSeq = 0;
function deviceFixes(spanM: number): Point[] {
  return [0, spanM].map((n) => ({
    id: `f${(pointSeq += 1)}`,
    timestamp: pointSeq,
    coordinates: [n, 0, 0] as [number, number, number],
  }));
}

/** A store with just what the binding and P1 read. */
function makeStore(opts: { extentM: number; epochSlice?: boolean }) {
  const listeners = new Set<() => void>();
  let alignment: number[] = new THREE.Matrix4().toArray();
  let positions = deviceFixes(opts.extentM);
  let epoch = 0;
  const build = () => ({
    gpsData: {
      zero: { lat: 47, lon: 8 },
      gpsEvents: { alignmentMatrix: alignment, gpsPositions: positions },
    },
    ...(opts.epochSlice === false ? {} : { qrDetected: { frameEpoch: epoch } }),
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
    setT(m: THREE.Matrix4) {
      alignment = m.toArray();
      emit();
    },
    setExtent(m: number) {
      positions = [...positions, ...deviceFixes(m)];
      emit();
    },
    bumpEpoch() {
      epoch += 1;
      emit();
    },
  } as unknown as SubscribableStore & {
    setT(m: THREE.Matrix4): void;
    setExtent(m: number): void;
    bumpEpoch(): void;
  };
}

function tOf(north: number, yawDeg = 0, east = 0): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(north, 0, east)
    .multiply(
      new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg))
    );
}

/**
 * A session: scene, world group with its binding, and a camera under it.
 * `realHierarchy` puts the camera where an app has it, under the WebXR to
 * NUE basis node and the AR pose node (`createSceneHierarchy`), at the same
 * group-local pose.
 */
function session(
  opts: { mature?: boolean; epochSlice?: boolean; realHierarchy?: boolean } = {}
) {
  const store = makeStore({
    extentM: opts.mature === false ? 20 : 40,
    epochSlice: opts.epochSlice,
  });
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const binding = enableArWorldGroupAlignment({ store, arWorldGroup: group });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const basis = new THREE.Group();
  if (opts.realHierarchy === true) {
    basis.matrix.copy(WEBXR_TO_NUE);
    basis.matrixAutoUpdate = false;
    const arpose = new THREE.Object3D();
    group.add(basis);
    basis.add(arpose);
    arpose.add(camera);
  } else {
    group.add(camera);
  }
  /** Camera at group-local (0, 0, 8), turned `yaw` about the group's up. */
  const placeCamera = (yaw: number): void => {
    new THREE.Matrix4()
      .compose(
        new THREE.Vector3(0, 0, 8),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          yaw
        ),
        new THREE.Vector3(1, 1, 1)
      )
      .premultiply(basis.matrix.clone().invert())
      .decompose(camera.position, camera.quaternion, camera.scale);
  };
  placeCamera(0);
  let t = 0;
  const run = (n = 1) => {
    let last = __runPassForTests(group, camera, DT, t);
    for (let i = 1; i < n; i += 1) {
      t += DT;
      last = __runPassForTests(group, camera, DT, t);
    }
    t += DT;
    return last;
  };
  return {
    store,
    scene,
    group,
    camera,
    binding,
    run,
    /** Run passes until the clock reaches `untilS` (exclusive). */
    runUntil(untilS: number) {
      let last = null as ReturnType<typeof run> | null;
      while (t < untilS - 1e-9) last = run();
      return last;
    },
    now: () => t,
    setNow: (s: number) => {
      t = s;
    },
    /** Look at the content (origin of the parent frame) or away from it. */
    look(mode: 'in' | 'out') {
      const yaw = mode === 'in' ? 0 : Math.PI;
      // The plain rig keeps the camera position a test may have moved.
      if (opts.realHierarchy === true) placeCamera(yaw);
      else camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    },
  };
}

/** A pose-free root holding one small mesh at `at` (root-local). */
function contentRoot(at = new THREE.Vector3()): THREE.Group {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.2),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.copy(at);
  root.add(mesh);
  return root;
}

function expectMatrixClose(
  a: THREE.Matrix4,
  b: THREE.Matrix4,
  tol = 1e-9
): void {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 16; i += 1) {
    expect(Math.abs(ea[i]! - eb[i]!)).toBeLessThanOrEqual(tol);
  }
}

const inv = (m: THREE.Matrix4) => m.clone().invert();
const IDENTITY = new THREE.Matrix4();

function cameraRelative(camera: THREE.Camera, root: THREE.Object3D) {
  camera.updateWorldMatrix(true, false);
  return camera.matrixWorld.clone().invert().multiply(root.matrixWorld);
}

beforeEach(() => {
  __resetAnchorReleaseForTests();
});

afterEach(() => {
  runSessionDisposers();
  clearSessionDisposers();
  clearFrameUpdates();
  __resetAnchorReleaseForTests();
  vi.restoreAllMocks();
});

describe('deferredAnchor: in view', () => {
  it('keeps the camera-relative pose through a T change of 2 m and 5 deg (mature)', () => {
    const s = session();
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run();
    const before = cameraRelative(s.camera, root);
    s.store.setT(tOf(2, 5));
    for (let i = 0; i < 120; i += 1) {
      s.run();
      expectMatrixClose(cameraRelative(s.camera, root), before);
    }
  });
});

describe('deferredAnchor: the two-pass dwell', () => {
  function pendingInView() {
    const s = session();
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(3);
    s.store.setT(tOf(3, 4));
    return { s, root, before: root.matrix.clone() };
  }

  it('in, out, in gives no commit', () => {
    const { s, root, before } = pendingInView();
    for (const mode of ['in', 'out', 'in'] as const) {
      s.look(mode);
      s.run();
      expectMatrixClose(root.matrix, before);
    }
  });

  it('in, out, out commits exactly at the third pass', () => {
    const { s, root, before } = pendingInView();
    s.look('in');
    s.run();
    s.look('out');
    s.run();
    expectMatrixClose(root.matrix, before);
    s.run();
    expectMatrixClose(root.matrix, inv(tOf(3, 4)));
  });

  it("never commits out of view in the set's first pass", () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.store.setT(tOf(3));
    s.run();
    expectMatrixClose(root.matrix, IDENTITY);
    s.run();
    expectMatrixClose(root.matrix, inv(tOf(3)));
  });

  it('lands on the latest of several T changes in one commit', () => {
    const { s, root } = pendingInView();
    const commits: number[] = [];
    const root2 = contentRoot(new THREE.Vector3(0.5, 0, 0));
    deferredAnchor(s.group, 'b').add(root2, {
      onCommit: () => commits.push(1),
    });
    s.store.setT(tOf(4, 8));
    s.run(2);
    s.store.setT(tOf(5, -12, 2));
    s.run(2);
    s.look('out');
    s.run(3); // the dwell pass, then one key's confirmation per pass
    expectMatrixClose(root.matrix, inv(tOf(5, -12, 2)));
    expectMatrixClose(root2.matrix, inv(tOf(5, -12, 2)));
    // First placement plus one out-of-view commit.
    expect(commits).toHaveLength(2);
  });
});

describe('deferredAnchor: the epsilon at the content', () => {
  // A renderable 500 m from the root's origin turns a tiny yaw into a
  // visible move there; the epsilon is measured where the content is.
  const cases: [string, THREE.Matrix4, boolean][] = [
    ['0.0001 deg yaw (0.0009 m at 500 m)', tOf(0, 0.0001), false],
    ['0.002 deg yaw (0.0175 m)', tOf(0, 0.002), false],
    ['0.0025 deg yaw (0.0218 m)', tOf(0, 0.0025), true],
    ['0.01 deg yaw (0.087 m)', tOf(0, 0.01), true],
    ['0.005 m translation', tOf(0.005), false],
    ['0.019 m translation', tOf(0.019), false],
    ['0.021 m translation', tOf(0.021), true],
  ];
  for (const [label, t, pending] of cases) {
    it(`${label} is ${pending ? '' : 'not '}pending`, () => {
      const s = session();
      s.look('in'); // the content is behind the camera
      const root = contentRoot(new THREE.Vector3(0, 0, 500));
      deferredAnchor(s.group, 'far').add(root);
      s.run(2);
      s.store.setT(t);
      s.run(3);
      expectMatrixClose(root.matrix, pending ? inv(t) : IDENTITY, 1e-9);
    });
  }
});

describe('deferredAnchor: caches and commits', () => {
  it('does not commit when the cache says out but a fresh traversal says in, and keeps the new cache', () => {
    const s = session();
    s.look('in');
    // Behind the camera at first.
    const root = contentRoot(new THREE.Vector3(0, 0, 20));
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    // A part mounted in front of the camera without boundsChanged().
    const late = new THREE.Mesh(
      new THREE.SphereGeometry(0.2),
      new THREE.MeshBasicMaterial()
    );
    root.add(late);
    s.store.setT(tOf(2));
    const counts = s.run();
    expect(counts.traversals).toBe(1);
    expectMatrixClose(root.matrix, IDENTITY);
    // The replaced cache now says in: no further confirmation is spent.
    const next = s.run();
    expect(next.traversals).toBe(0);
    expectMatrixClose(root.matrix, IDENTITY);
  });

  it('refreshes world matrices before onCommit', () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    const seen: THREE.Matrix4[] = [];
    deferredAnchor(s.group, 'a').add(root, {
      onCommit: (r) => {
        seen.push(r.matrixWorld.clone());
        expectMatrixClose(
          r.matrixWorld,
          s.group.matrixWorld.clone().multiply(r.matrix),
          1e-12
        );
      },
    });
    s.run(2);
    s.store.setT(tOf(3, 10));
    s.run(3);
    expect(seen).toHaveLength(2);
  });

  it('fires onCommit once per commit (first, out of view, release, window entry), never for follow steps', () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    const onCommit = vi.fn();
    deferredAnchor(s.group, 'a').add(root, { onCommit });
    expect(onCommit).toHaveBeenCalledTimes(1); // first
    s.run(2);
    s.store.setT(tOf(2));
    s.run(3);
    expect(onCommit).toHaveBeenCalledTimes(2); // out of view
    s.look('in');
    s.store.setT(tOf(4));
    s.run();
    requestAnchorRelease('code-lock');
    s.run();
    expect(onCommit).toHaveBeenCalledTimes(3); // release
    s.store.setT(tOf(6));
    s.run(2);
    s.store.bumpEpoch();
    s.run();
    expect(onCommit).toHaveBeenCalledTimes(4); // window entry
    for (let i = 0; i < 20; i += 1) {
      s.store.setT(tOf(6 + i * 0.2));
      s.run();
    }
    expect(onCommit).toHaveBeenCalledTimes(4); // follow steps
  });

  // A window entry or follow start whose key already sits within epsilon of
  // its NUE pose writes the matrix all the same; a consumer that re-places
  // labels on onCommit must hear of it like any other placement.
  it('fires onCommit for a window entry that moves the key by less than epsilon', () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    const onCommit = vi.fn();
    deferredAnchor(s.group, 'a').add(root, { onCommit });
    s.store.setT(tOf(2));
    s.run(3);
    expect(onCommit).toHaveBeenCalledTimes(2); // first, out of view
    expectMatrixClose(root.matrix, inv(tOf(2)));
    s.store.bumpEpoch();
    expect(s.run().windowOpen).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(3); // window entry, sub-epsilon
  });
});

describe('deferredAnchor: the immature phase', () => {
  it('follows the alignment (world pose = NUE) in view or not, until the alignment is mature', () => {
    const s = session({ mature: false });
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    for (let i = 0; i < 10; i += 1) {
      s.look(i % 2 === 0 ? 'in' : 'out');
      s.store.setT(tOf(i * 0.7, i * 3));
      for (let k = 0; k < 5; k += 1) {
        s.run();
        expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
      }
    }
    s.store.setExtent(40);
    s.run(40); // follow on until the key is at T^-1, then defer
    s.look('in');
    const held = root.matrix.clone();
    s.store.setT(tOf(9, 9));
    s.run(30);
    expectMatrixClose(root.matrix, held);
  });

  it('places a first root of an immature set as a follow start', () => {
    const s = session({ mature: false });
    s.store.setT(tOf(5, 20));
    s.run();
    const onCommit = vi.fn();
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root, { onCommit });
    expect(onCommit).toHaveBeenCalledTimes(1);
    root.updateMatrixWorld(true);
    expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
  });
});

describe('deferredAnchor: the code-lock release', () => {
  it('commits a pending in-view key at once, leaves a settled key alone, and is one-shot', () => {
    const s = session();
    s.look('in');
    const a = contentRoot();
    const onA = vi.fn();
    deferredAnchor(s.group, 'a').add(a, { onCommit: onA });
    s.run(2);
    s.store.setT(tOf(3, 6));
    s.run(2);
    const b = contentRoot(new THREE.Vector3(1, 0, 0));
    const onB = vi.fn();
    deferredAnchor(s.group, 'b').add(b, { onCommit: onB }); // placed at the new T
    requestAnchorRelease('code-lock');
    requestAnchorRelease('code-lock');
    s.run();
    expectMatrixClose(a.matrix, inv(tOf(3, 6)));
    expect(onA).toHaveBeenCalledTimes(2);
    expect(onB).toHaveBeenCalledTimes(1);
    // The pass after: a new in-view change defers again.
    s.store.setT(tOf(5, 6));
    s.run(20);
    expectMatrixClose(a.matrix, inv(tOf(3, 6)));
  });

  it('ends the immature phase for the session', () => {
    const s = session({ mature: false });
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    s.store.setT(tOf(2, 5));
    s.run(); // following
    requestAnchorRelease('code-lock');
    s.run();
    expectMatrixClose(root.matrix, inv(tOf(2, 5)));
    s.store.setT(tOf(4, 5));
    s.run(30);
    expectMatrixClose(root.matrix, inv(tOf(2, 5)));
  });

  it('closes the current window; a later epoch opens a new one', () => {
    const s = session();
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    s.store.bumpEpoch();
    s.run();
    s.store.setT(tOf(3, 10));
    requestAnchorRelease('code-lock');
    const counts = s.run();
    expect(counts.windowOpen).toBe(false);
    expectMatrixClose(root.matrix, inv(tOf(3, 10)));
    // The first T change after the epoch change is a correction: the group
    // landed on it in the same frame.
    expectMatrixClose(s.group.matrix, tOf(3, 10));
    for (let i = 0; i < 30; i += 1) {
      s.run();
      expectMatrixClose(root.matrix, inv(tOf(3, 10)));
    }
    s.store.setT(tOf(6, 10));
    s.store.bumpEpoch();
    expect(s.run().windowOpen).toBe(true);
    expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
  });

  it('is per session: a request before the flush does not reach the next session', () => {
    const s1 = session();
    s1.look('in');
    deferredAnchor(s1.group, 'a').add(contentRoot());
    s1.run(2);
    requestAnchorRelease('code-lock');
    runSessionDisposers();
    expect(hasCodeVoted()).toBe(false);

    const s2 = session();
    s2.look('in');
    const root = contentRoot();
    const onCommit = vi.fn();
    deferredAnchor(s2.group, 'a').add(root, { onCommit });
    s2.run();
    s2.store.setT(tOf(3));
    s2.run(10);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expectMatrixClose(root.matrix, IDENTITY);
  });

  it('leaves no one-shot request behind when no set is live', () => {
    const s = session();
    requestAnchorRelease('code-lock');
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run();
    s.store.setT(tOf(3));
    s.run(10);
    expectMatrixClose(root.matrix, IDENTITY);
  });

  // Content that loads after the session's first code lock must not
  // fall back into the follow phase just because the extent is still short.
  it('starts a set created after a code vote with the immature phase ended', () => {
    const s = session({ mature: false });
    requestAnchorRelease('code-lock');
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run();
    s.store.setT(tOf(2));
    s.run(20);
    expectMatrixClose(root.matrix, IDENTITY);
  });

  // The keep-alive ring and device fixes go to the store, never through the
  // controller, so they must never release.
  it('is not called by a recordGpsEventBatch of synthetic code votes', () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    const group = new THREE.Group();
    enableArWorldGroupAlignment({ store, arWorldGroup: group });
    deferredAnchor(group, 'a').add(contentRoot());
    const receiver = vi.fn();
    registerReleaseReceiver(receiver);
    const votes = buildQrGpsVotes({
      qrPoseWorld: { position: [2, 1.4, -3], rotation: [0, 0, 0, 1] },
      sizeM: 0.4,
      qrGeo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
      syntheticAccuracyM: 5,
      baselineM: 30,
      count: 8,
      timestamp: 1000,
    });
    expect(votes[0]?.rawGpsPoint).toMatchObject({});
    store.dispatch(recordGpsEventBatch({ events: votes }));
    expect(
      store
        .getState()
        .gpsData?.gpsEvents?.gpsPositions.some(
          (p: { source?: string }) => p.source === GPS_POINT_SOURCE_SYNTHETIC_QR
        )
    ).toBe(true);
    expect(receiver).not.toHaveBeenCalled();
    expect(hasCodeVoted()).toBe(false);
  });
});

describe('deferredAnchor: the frame-switch window', () => {
  it('opens on an epoch change, follows through steps, closes when quiet', () => {
    const s = session();
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    s.store.setT(tOf(1));
    s.runUntil(0.3); // pending, held in view
    s.store.bumpEpoch();
    expect(s.run().windowOpen).toBe(true);
    expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
    let latest = tOf(1);
    for (const at of [0.5, 1.5, 2.5, 3.5]) {
      s.runUntil(at);
      latest = tOf(1 + (at + 0.5) * 0.5);
      s.store.setT(latest);
      s.run();
      expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
    }
    s.runUntil(4.5);
    expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
    expectMatrixClose(root.matrix, inv(latest), 1e-3);
    expect(s.runUntil(5.4)?.windowOpen).toBe(true);
    expect(s.runUntil(5.6)?.windowOpen).toBe(false);
    s.runUntil(7);
    const held = root.matrix.clone();
    s.store.setT(tOf(5));
    s.run(20);
    expectMatrixClose(root.matrix, held);
  });

  // The cap scales with the session (0.2 x elapsed, within [10, 120] s), so
  // a long session's slow origin reset is not cut off at 10 s.
  for (const [sessionS, capS] of [
    [0, WINDOW_MIN_S],
    [30, WINDOW_MIN_S],
    [100, 20],
    [1000, WINDOW_MAX_S],
  ] as const) {
    it(`closes at its cap (${capS} s at ${sessionS} s into the session) though T keeps stepping`, () => {
      const s = session();
      s.look('in');
      // Far back, so the content stays in view while T walks it 18 m.
      s.camera.position.z = 40;
      const root = contentRoot();
      deferredAnchor(s.group, 'a').add(root);
      s.run(2);
      s.setNow(Math.max(s.now(), sessionS));
      s.run();
      const start = s.now();
      s.store.bumpEpoch();
      expect(s.run().windowOpen).toBe(true);
      // Steps above the noise floor every second keep it from closing by quiet.
      for (let k = 1; k < capS; k += 1) {
        s.runUntil(start + k);
        s.store.setT(tOf(0.15 * k));
        expect(s.run().windowOpen).toBe(true);
      }
      s.runUntil(start + capS - 2 * DT);
      expect(s.run().windowOpen).toBe(true);
      s.runUntil(start + capS + DT);
      expect(s.run().windowOpen).toBe(false);
      s.run(20); // follow ends once the key is at T^-1
      const held = root.matrix.clone();
      s.store.setT(tOf(0.15 * capS));
      s.run(20);
      expectMatrixClose(root.matrix, held);
    });
  }

  it('follows on past the close until the key is within epsilon of T^-1', () => {
    const s = session();
    s.look('in');
    s.camera.position.z = 40; // keeps the content in view as T walks it
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    const start = s.now();
    s.store.bumpEpoch();
    s.run();
    for (let k = 1; k < WINDOW_MIN_S; k += 1) {
      s.runUntil(start + k);
      s.store.setT(tOf(0.3 * k));
      s.run();
    }
    s.runUntil(start + WINDOW_MIN_S - 0.1);
    s.store.setT(tOf(6));
    s.run();
    const closed = s.runUntil(start + WINDOW_MIN_S + 0.1);
    expect(closed?.windowOpen).toBe(false);
    // Still following: the world pose is the NUE pose.
    expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
    s.run(30);
    expectMatrixClose(root.matrix, inv(tOf(6)), 1e-9);
    const held = root.matrix.clone();
    s.store.setT(tOf(8));
    s.run(20);
    expectMatrixClose(root.matrix, held);
  });

  describe('the jump detector', () => {
    for (const [stepM, opens] of [
      [0.5, false],
      [0.9, false],
      [1.1, true],
      [1.5, true],
      [3, true],
    ] as const) {
      it(`a ${stepM} m camera step between two passes ${opens ? 'opens' : 'does not open'} the window`, () => {
        const s = session();
        deferredAnchor(s.group, 'a').add(contentRoot());
        s.run(3);
        s.camera.position.x += stepM;
        expect(s.run().windowOpen).toBe(opens);
      });
    }

    it('does not open over 200 passes of 0.05 m (10 m walked)', () => {
      const s = session();
      deferredAnchor(s.group, 'a').add(contentRoot());
      s.run();
      for (let i = 0; i < 200; i += 1) {
        s.camera.position.x += 0.05;
        expect(s.run().windowOpen).toBe(false);
      }
    });

    it("does not open in a set's first pass, wherever the camera is", () => {
      const s = session();
      s.camera.position.set(500, 0, 0);
      deferredAnchor(s.group, 'a').add(contentRoot());
      expect(s.run().windowOpen).toBe(false);
    });

    it('is the only trigger without a frame-epoch slice', () => {
      const s = session({ epochSlice: false });
      deferredAnchor(s.group, 'a').add(contentRoot());
      for (let i = 0; i < 50; i += 1) expect(s.run().windowOpen).toBe(false);
      s.camera.position.x += FRAME_JUMP_THRESHOLD_M * 2;
      expect(s.run().windowOpen).toBe(true);
    });
  });
});

describe('deferredAnchor: keys and roots', () => {
  it('commits all roots of a key in one pass; one root in view holds both', () => {
    const s = session();
    s.look('in');
    const front = contentRoot();
    // Never in view: far to the side of both camera directions.
    const behind = contentRoot(new THREE.Vector3(100, 0, 0));
    const anchor = deferredAnchor(s.group, 'station');
    anchor.add(front);
    anchor.add(behind);
    s.run(2);
    s.store.setT(tOf(3));
    s.run(5);
    expectMatrixClose(front.matrix, IDENTITY);
    expectMatrixClose(behind.matrix, IDENTITY);
    s.look('out');
    s.run(2);
    expectMatrixClose(front.matrix, inv(tOf(3)));
    expectMatrixClose(behind.matrix, inv(tOf(3)));
  });

  it('drops a key with its last root; re-adding it is a first placement', () => {
    const s = session();
    s.look('in');
    const root = contentRoot();
    const anchor = deferredAnchor(s.group, 'a');
    anchor.add(root);
    s.run(2);
    s.store.setT(tOf(3));
    s.run(2);
    anchor.remove(root);
    expect(root.parent).toBeNull();
    const onCommit = vi.fn();
    anchor.add(root, { onCommit });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expectMatrixClose(root.matrix, inv(tOf(3)));
  });

  it('refuses nesting in both orders', () => {
    const s = session();
    const outer = contentRoot();
    deferredAnchor(s.group, 'outer').add(outer);
    const inner = new THREE.Group();
    outer.add(inner);
    expect(() => deferredAnchor(s.group, 'inner').add(inner)).toThrow(/nest/);

    const holder = new THREE.Group();
    const held = contentRoot();
    deferredAnchor(s.group, 'held').add(held);
    holder.add(held); // an app moved it under a group it then adds
    expect(() => deferredAnchor(s.group, 'holder').add(holder)).toThrow(/nest/);
  });

  it('excludes, with an error, a root found inside another anchor root at a rebuild', () => {
    const s = session();
    s.look('out');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outer = contentRoot();
    const inner = contentRoot(new THREE.Vector3(1, 0, 0));
    deferredAnchor(s.group, 'outer').add(outer);
    const innerAnchor = deferredAnchor(s.group, 'inner');
    innerAnchor.add(inner);
    s.run(2);
    outer.add(inner); // moved by the app
    innerAnchor.boundsChanged();
    const innerBefore = inner.matrix.clone();
    s.store.setT(tOf(3));
    s.run(4);
    expect(error).toHaveBeenCalled();
    expectMatrixClose(inner.matrix, innerBefore);
    expectMatrixClose(outer.matrix, inv(tOf(3)));
  });

  it('throws without an alignment binding for the parent', () => {
    expect(() => deferredAnchor(new THREE.Group(), 'a')).toThrow(
      /enableArWorldGroupAlignment/
    );
  });

  it('tolerates remove and boundsChanged after the session flush', () => {
    const s = session();
    const root = contentRoot();
    const anchor = deferredAnchor(s.group, 'a');
    anchor.add(root);
    runSessionDisposers();
    expect(() => {
      anchor.remove(root);
      anchor.boundsChanged();
    }).not.toThrow();
  });
});

describe('deferredAnchor: binding lifecycle', () => {
  it('ticks itself after its binding is disposed mid-session', () => {
    const s = session();
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    s.store.setT(tOf(4, 7));
    s.binding.dispose();
    requestAnchorRelease('code-lock');
    runFrameUpdates(DT, s.now());
    expectMatrixClose(root.matrix, inv(tOf(4, 7)));
  });

  // The world-group binding and the anchors read one composed T, dev jump
  // included, so content and the world group agree after the jump lands.
  it('agrees with the world group on T with the dev jump on, for a set created after the first target', () => {
    const g = globalThis as { location?: unknown };
    const before = g.location;
    g.location = { search: '?devWorldJumpM=3&devWorldJumpDeg=10' };
    try {
      const s = session();
      s.store.setT(tOf(2, 5));
      s.run(5);
      s.look('out');
      const root = contentRoot();
      deferredAnchor(s.group, 'a').add(root);
      s.runUntil(12); // the first jump lands at 10 s
      s.run(80);
      root.updateMatrixWorld(true);
      expectMatrixClose(root.matrixWorld, IDENTITY, 1e-3);
      expect(root.matrix.equals(inv(tOf(2, 5)))).toBe(false);
    } finally {
      g.location = before;
    }
  });
});

describe('deferredAnchor: budget', () => {
  // 20 keys of 30 renderables: the cached tests may touch every key, but at
  // most one key's traversal (cache build, refresh or confirmation) runs per
  // pass, and the sphere tests stay within (keys + 1 confirmation) x cap x 3
  // tests, follow phases and window entries included.
  it('holds the traversal and sphere-test budget per pass', () => {
    const s = session();
    for (let k = 0; k < 20; k += 1) {
      const root = new THREE.Group();
      for (let m = 0; m < 30; m += 1) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.1),
          new THREE.MeshBasicMaterial()
        );
        mesh.position.set(k - 10, m * 0.05, -k);
        root.add(mesh);
      }
      deferredAnchor(s.group, `k${k}`).add(root);
    }
    const limit = 21 * ANCHOR_SPHERE_CAP * 3;
    for (let i = 0; i < 200; i += 1) {
      if (i % 7 === 0) s.store.setT(tOf(i * 0.1, i));
      if (i === 90) s.store.bumpEpoch();
      s.look(Math.floor(i / 11) % 2 === 0 ? 'in' : 'out');
      const counts = s.run();
      expect(counts.traversals).toBeLessThanOrEqual(1);
      expect(counts.sphereTests).toBeLessThanOrEqual(limit);
      expect(counts.followUpdates).toBeLessThanOrEqual(20);
    }
  });

  // Why: a follow step writes every root's matrix and refreshes its
  // subtree; between two alignment changes the parent stands still, and
  // re-writing the same matrix each frame is pure cost.
  it('skips follow updates while the parent matrix does not change', () => {
    const s = session({ mature: false });
    for (let k = 0; k < 3; k += 1) {
      deferredAnchor(s.group, `k${k}`).add(
        contentRoot(new THREE.Vector3(k, 0, 0))
      );
    }
    s.run(2);
    s.store.setT(tOf(0.3)); // the group lands on T in this pass
    expect(s.run().followUpdates).toBe(3);
    expect(s.run().followUpdates).toBe(0);
    expect(s.run().followUpdates).toBe(0);
  });
});

// Why: the world group lands on every new T in the frame it arrives, while
// a deferred anchor in view still holds its pose relative to the camera in
// that same frame. Built on an app's hierarchy (camera under the basis and
// AR pose nodes), where a direct-child camera would hide a frame mistake.
describe('deferredAnchor: a correction frame', () => {
  it('lands the group on T in one frame; a visible anchor does not move, the world does', () => {
    const s = session({ realHierarchy: true });
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    const world = contentRoot(); // scene-root content at its NUE pose
    s.scene.add(world);
    s.run(2);
    const anchorBefore = cameraRelative(s.camera, root);
    const worldBefore = cameraRelative(s.camera, world);
    s.store.setT(tOf(5, 20));
    s.run();
    expectMatrixClose(s.group.matrix, tOf(5, 20));
    expectMatrixClose(root.matrix, IDENTITY);
    expectMatrixClose(cameraRelative(s.camera, root), anchorBefore);
    expectMatrixClose(
      cameraRelative(s.camera, world),
      worldBefore.clone().multiply(inv(tOf(5, 20))),
      1e-9
    );
  });
});

describe('deferredAnchor: the three view tests', () => {
  // T turns the view about the camera's own position, so the camera does
  // not move while the content swings across the side
  // plane: 7 m to the side and 8 m ahead it sits about 41 deg off axis,
  // outside the 30 deg half angle plus the 5 deg margin.
  function aboutCamera(yawDeg: number): THREE.Matrix4 {
    return new THREE.Matrix4()
      .makeTranslation(0, 0, 8)
      .multiply(
        new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(yawDeg))
      )
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, -8));
  }

  function outAtCurrentPose() {
    const s = session();
    s.look('in');
    const root = contentRoot(new THREE.Vector3(7, 0, 0));
    deferredAnchor(s.group, 'a').add(root);
    s.run(3);
    return { s, root };
  }

  it('does not commit when the content is out of view now but in view at its new pose', () => {
    const { s, root } = outAtCurrentPose();
    s.store.setT(aboutCamera(-10)); // T^-1 turns the content to about 31 deg
    for (let i = 0; i < 8; i += 1) {
      s.run();
      expectMatrixClose(root.matrix, IDENTITY);
    }
  });

  it('commits when the new pose is out of view too', () => {
    const { s, root } = outAtCurrentPose();
    s.store.setT(aboutCamera(10)); // T^-1 turns the content to about 51 deg
    s.run(3);
    expectMatrixClose(root.matrix, inv(aboutCamera(10)));
  });

  // The previous view is re-expressed by the parent's motion. A correction
  // that moves the parent far in one frame, with the look turned away in
  // that same frame, must still count the content as seen last frame.
  it('carries the previous view by the parent motion through a one-frame jump', () => {
    const s = session();
    s.store.setT(tOf(5, 40));
    s.run(2);
    s.look('in');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(3);
    const before = root.matrix.clone();
    s.store.setT(tOf(25, 100));
    s.look('out');
    s.run();
    expectMatrixClose(root.matrix, before);
    s.run();
    expectMatrixClose(root.matrix, inv(tOf(25, 100)));
  });
});

describe('deferredAnchor: bounds and frames', () => {
  // The epsilon is measured over the root's own box: a root that arrives
  // with a pose of its own (which add() replaces) must not have its box
  // measured where that pose put it.
  it('measures the epsilon in the root frame when the root arrives with a pose', () => {
    const s = session();
    s.look('in');
    const root = contentRoot();
    root.position.set(300, 0, 0);
    root.updateMatrix(); // the pose is in its matrix when add() measures the box
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    // 0.05 m at 300 m, nothing near the root. The release decides in the
    // same pass, before any traversal could renew the corners.
    s.store.setT(tOf(0, 0.01));
    requestAnchorRelease('code-lock');
    s.run();
    expectMatrixClose(root.matrix, IDENTITY);
  });

  // A part mounted far from the root without boundsChanged(): the next
  // fresh traversal of the key also renews its corners, so a later yaw
  // that only moves that part is still seen as a move.
  it('renews the corners at a fresh traversal', () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.run(2);
    const far = new THREE.Mesh(
      new THREE.SphereGeometry(0.2),
      new THREE.MeshBasicMaterial()
    );
    far.position.set(500, 0, 0); // off to the side of both looks
    root.add(far);
    s.store.setT(tOf(3));
    s.run(3);
    expectMatrixClose(root.matrix, inv(tOf(3)));
    s.store.setT(tOf(3, 0.01)); // 0.087 m at the far part
    s.run(4);
    expectMatrixClose(root.matrix, inv(tOf(3, 0.01)));
  });

  it('follows in the parent frame under a scene root that is not at identity', () => {
    const s = session({ mature: false });
    s.scene.position.set(4, 0, -2);
    s.scene.rotation.y = 0.5;
    s.scene.updateMatrixWorld(true);
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    s.store.setT(tOf(2, 5));
    s.run(3);
    expectMatrixClose(root.matrix, inv(s.group.matrix), 1e-9);
    root.updateMatrixWorld(true);
    expectMatrixClose(root.matrixWorld, s.scene.matrixWorld, 1e-9);
  });

  // The jump detector watches the raw camera in the group's frame: a
  // correction that moves the group (and the camera with it) is not an
  // odometry jump.
  it('opens no window for a 5 m T step while the raw camera stands still', () => {
    const s = session();
    deferredAnchor(s.group, 'a').add(contentRoot());
    s.run(3);
    s.store.setT(tOf(5));
    expect(s.run().windowOpen).toBe(false);
    expect(s.run().windowOpen).toBe(false);
  });
});

describe('deferredAnchor: the window rules', () => {
  function openWindowAt10(contentAt?: THREE.Vector3) {
    const s = session();
    s.look('in');
    s.camera.position.z = 40;
    deferredAnchor(s.group, 'a').add(contentRoot(contentAt));
    s.run(2);
    s.setNow(10);
    s.store.bumpEpoch();
    expect(s.run().windowOpen).toBe(true);
    return s;
  }

  it('closes exactly 2 s after its last step, not before', () => {
    const s = openWindowAt10();
    s.setNow(11.95);
    expect(s.run().windowOpen).toBe(true);
    s.setNow(12);
    expect(s.run().windowOpen).toBe(false);
  });

  // The noise floor (0.1 m at the content) sits between these two step
  // sizes: 0.12 m steps keep the window open, 0.08 m steps do not.
  for (const [stepM, open] of [
    [0.12, true],
    [0.08, false],
  ] as const) {
    it(`${open ? 'stays open' : 'closes'} with a ${stepM} m T step each second`, () => {
      const s = openWindowAt10();
      for (let k = 1; k <= 4; k += 1) {
        s.runUntil(10 + k);
        s.store.setT(tOf(stepM * k));
        s.run();
      }
      expect(s.runUntil(14.5)?.windowOpen).toBe(open);
    });
  }

  it('measures the T step at the content, so a yaw far from the origin keeps it open', () => {
    const s = openWindowAt10(new THREE.Vector3(0, 0, -50));
    for (let k = 1; k <= 4; k += 1) {
      s.runUntil(10 + k);
      s.store.setT(tOf(0, 0.2 * k)); // 0.17 m at the content, 0 at the origin
      s.run();
    }
    expect(s.runUntil(14.5)?.windowOpen).toBe(true);
  });

  it('re-arms its cap at a second trigger while open', () => {
    const s = openWindowAt10();
    for (let k = 1; k <= 14; k += 1) {
      s.runUntil(10 + k);
      if (k === 5) s.store.bumpEpoch();
      s.store.setT(tOf(0.15 * k));
      expect(s.run().windowOpen, `k=${k}`).toBe(true); // 21 s to 24 s included
    }
    expect(s.runUntil(25.2)?.windowOpen).toBe(false);
  });

  it('a release absorbs an epoch change of its own pass', () => {
    const s = session();
    s.look('in');
    deferredAnchor(s.group, 'a').add(contentRoot());
    s.run(2);
    s.store.bumpEpoch();
    requestAnchorRelease('code-lock');
    expect(s.run().windowOpen).toBe(false);
    expect(s.run().windowOpen).toBe(false);
  });

  it('a release absorbs a camera jump of its own pass', () => {
    const s = session();
    s.look('in');
    deferredAnchor(s.group, 'a').add(contentRoot());
    s.run(2);
    s.camera.position.x += 3;
    requestAnchorRelease('code-lock');
    expect(s.run().windowOpen).toBe(false);
    expect(s.run().windowOpen).toBe(false);
  });
});

describe('deferredAnchor: an explicit view', () => {
  it('accepts a prepared view in place of a camera', () => {
    const s = session();
    s.look('out');
    const root = contentRoot();
    deferredAnchor(s.group, 'a').add(root);
    const view = createAnchorView();
    const pass = () => {
      updateAnchorView(view, s.camera);
      return __runPassForTests(s.group, view, DT, s.now());
    };
    pass();
    s.store.setT(tOf(3));
    s.setNow(s.now() + DT);
    pass();
    s.setNow(s.now() + DT);
    pass();
    expect(root.matrix.equals(IDENTITY)).toBe(false);
  });
});

/** Run `body` with the page address `search` (the dev readers' input). */
function withSearch(search: string, body: () => void): void {
  const g = globalThis as { location?: unknown };
  const before = g.location;
  g.location = { search };
  try {
    body();
  } finally {
    g.location = before;
  }
}

// Why: the field test compares frame time with the deferral on and off.
// With it off every correction must land at once, in view too and after a
// code lock, as content did before deferral existed; otherwise the "off"
// run measures some other behaviour. The control (on, in view, held) is
// the first test of this file.
describe('deferredAnchor: the deferral switch (?anchors=0)', () => {
  it('lands every correction at once while in view, before and after a release', () => {
    withSearch('?anchors=0', () => {
      const s = session();
      s.look('in');
      const root = contentRoot();
      deferredAnchor(s.group, 'a').add(root);
      s.run(2);
      const corrections = [tOf(2, 5), tOf(-3, 12, 1), tOf(0.5, -4)];
      corrections.forEach((t, i) => {
        if (i === 2) requestAnchorRelease('code-lock');
        s.store.setT(t);
        s.run();
        root.updateMatrixWorld(true);
        expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
      });
    });
  });
});

// Why: the field test's anchor pass time (p50/p95/max) and traversals per
// pass come from this observer; it must see the production pass (the one
// the frame loop runs, not the test seam), carry the frame's dt for the
// frame-time numbers, and stop cleanly so a closed readout costs nothing.
describe('deferredAnchor: the pass observer', () => {
  it('sees each production pass with its time, counts and dt, until stopped', () => {
    const s = session();
    deferredAnchor(s.group, 'a').add(contentRoot());
    const samples: DeferredAnchorPassSample[] = [];
    const stop = observeDeferredAnchorPasses((sample) => {
      samples.push(sample);
    });
    try {
      runFrameUpdates(DT, 1);
      runFrameUpdates(DT, 1 + DT);
      expect(samples).toHaveLength(2);
      expect(samples[0]).toMatchObject({
        dt: DT,
        deferring: true,
        counts: { windowOpen: false },
      });
      expect(samples[0]!.passMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(samples[0]!.counts.traversals)).toBe(true);
    } finally {
      stop();
    }
    runFrameUpdates(DT, 1 + 2 * DT);
    expect(samples).toHaveLength(2);
  });

  it('says the deferral is off, and a throwing observer does not stop the frame', () => {
    withSearch('?anchors=0', () => {
      const s = session();
      const root = contentRoot();
      deferredAnchor(s.group, 'a').add(root);
      const seen: boolean[] = [];
      const stop = observeDeferredAnchorPasses((sample) => {
        seen.push(sample.deferring);
        throw new Error('observer bug');
      });
      // The catch must log the throw, not swallow it in silence.
      const logged: LogEntry[] = [];
      const unsubscribe = subscribeToLogs((entry) => {
        logged.push(entry);
      });
      try {
        s.store.setT(tOf(3, 0));
        expect(() => {
          runFrameUpdates(DT, 1);
        }).not.toThrow();
        expect(seen).toEqual([false]);
        expect(
          logged.filter(
            (entry) =>
              entry.tag === 'DeferredAnchors' &&
              entry.level === LogLevel.ERROR &&
              entry.message.includes('pass observer threw')
          )
        ).toHaveLength(1);
        root.updateMatrixWorld(true);
        expectMatrixClose(root.matrixWorld, IDENTITY, 1e-9);
      } finally {
        unsubscribe();
        stop();
      }
    });
  });

  it('refuses an observer that is not a function', () => {
    expect(() => observeDeferredAnchorPasses(null as never)).toThrow(TypeError);
  });
});
