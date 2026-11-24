/**
 * The RecorderApp content correction, end to end through the real recorder
 * store, the real GPS marker subscriber, the real frame tile feed and the
 * real QR debug view. Each relocalization is a raw frame switch `J` seen by
 * a still camera, so the physical place of content of the old frame is `J`
 * applied to its raw pose; the expected poses below are built from `J`
 * alone, never read back from the module.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  add2dImage,
  recordGpsEvent,
  setZeroPos,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  relocalizationObserved,
  type RelocalizationObservation,
} from 'gps-plus-slam-app-framework/state/ar-space-correction-slice';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import { GpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { createQrDebugView } from 'gps-plus-slam-app-framework/ar/qr/qr-debug-view';
import { WEBXR_TO_NUE } from 'gps-plus-slam-app-framework/ar/webxr-nue-basis';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  createRecorderStore,
  type RecorderStore,
} from '../state/recorder-store';
import { createStoreRef, type StoreRef } from '../state/store-ref';
import { FrameTileVisualizer } from '../visualization/frame-tile-visualizer';
import { wireFrameTileSubscribers } from '../visualization/wire-frame-tile-subscribers';
import { wireArSpaceCorrection } from './wire-ar-space-correction';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const B = WEBXR_TO_NUE;
const T0 = 1_700_000_000_000;

/** A rigid raw-WebXR frame switch: a yaw (gravity is known) and a shift. */
const rawRigid = (yaw: number, x: number, y: number, z: number) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    ONE
  );

function poseOf(m: THREE.Matrix4): Pose {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/** The observation of the raw frame switch `jump` at `t`, camera still. */
function stillJump(t: number, jump: THREE.Matrix4): RelocalizationObservation {
  const camera = new THREE.Matrix4().makeTranslation(0, 1.5, 0);
  return {
    t,
    tLast: t - 33,
    lastPose: poseOf(camera),
    tPrev: null,
    prevPose: null,
    newPose: poseOf(jump.clone().multiply(camera)),
  };
}

/** The raw switch `jump` as it acts in arWorldGroup's local (NUE) space. */
const inO = (jump: THREE.Matrix4) =>
  B.clone().multiply(jump).multiply(B.clone().invert());

/** An object's local matrix, read the way three.js draws it. */
const localOf = (o: THREE.Object3D): THREE.Matrix4 =>
  new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);

const maxDiff = (a: THREE.Matrix4, b: THREE.Matrix4): number =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i]!)));

/** The tile's raw capture pose (see `frame`), with the tile's own scale. */
const rawTile = (tile: THREE.Object3D): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(0.4, 1.2, -2),
    new THREE.Quaternion(0, Math.sin(0.3), 0, Math.cos(0.3)),
    tile.scale
  );

const newStore = (): RecorderStore => {
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
  });
  store.dispatch(setZeroPos({ lat: 50, lon: 8 }));
  return store;
};

const fix = (i: number, odom: [number, number, number]) =>
  recordGpsEvent({
    odomPosition: odom,
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `fix-${i}`,
      latitude: 50 + i * 1e-5,
      longitude: 8,
      latLongAccuracy: 5,
      timestamp: T0 + i * 1000,
    },
  });

const frame = (imageFile: string, capturedAt: number) => ({
  imageFile,
  position: [0.4, 1.2, -2] as [number, number, number],
  rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)] as [
    number,
    number,
    number,
    number,
  ],
  screenRotation: 0,
  capturedAt,
});

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** The scene a RecorderApp session builds, with every content kind. */
function scene(storeRef: StoreRef<RecorderStore>, enabled = true) {
  const root = new THREE.Scene();
  const arWorldGroup = new THREE.Group();
  // A non-trivial alignment: the correction works in arWorldGroup's local
  // space, so the alignment above it must not matter.
  arWorldGroup.matrixAutoUpdate = false;
  arWorldGroup.matrix.compose(
    new THREE.Vector3(5, 0, -3),
    new THREE.Quaternion().setFromAxisAngle(UP, 0.7),
    ONE
  );
  root.add(arWorldGroup);
  const correction = wireArSpaceCorrection({ arWorldGroup, storeRef, enabled });

  const markers = new GpsEventVisualizer();
  markers.setSceneSource({
    getScene: () => root,
    getArWorldGroup: () => correction.arContent ?? arWorldGroup,
  });
  const unsubscribeMarkers = wireStoreSubscribers(storeRef.get(), {
    applyAlignmentMatrix: () => {},
    gpsEventVisualizer: markers,
  });

  const tiles = new FrameTileVisualizer(
    arWorldGroup,
    correction.onPlaced ? { onPlaced: correction.onPlaced } : {}
  );
  const unsubscribeTiles = wireFrameTileSubscribers({
    storeRef,
    visualizer: tiles,
    blobSource: () =>
      Promise.resolve(
        new Blob([new Uint8Array(20_000)], { type: 'image/jpeg' })
      ),
    decodeTexture: () => Promise.resolve(new THREE.Texture()),
  });

  const qr = createQrDebugView(
    arWorldGroup,
    correction.onPlaced ? { onPlaced: correction.onPlaced } : {}
  );

  /** The i-th fused (odometry) marker, in insertion order. */
  const fused = (i: number): THREE.Object3D => {
    const found: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name.startsWith('fused')) found.push(o);
    });
    return found[i]!;
  };
  const tile = (file: string) => root.getObjectByName(`frame-tile-${file}`)!;
  const qrObjects = () => {
    const basis = arWorldGroup.getObjectByName('qr-debug-basis')!;
    return { axis: basis.children[0]!, cube: basis.children[1]! };
  };
  return {
    root,
    arWorldGroup,
    correction,
    markers,
    tiles,
    qr,
    fused,
    tile,
    qrObjects,
    dispose() {
      unsubscribeMarkers();
      unsubscribeTiles();
      qr.dispose();
      tiles.dispose();
      markers.clearAll();
      correction.dispose();
    },
  };
}

const qrPose: Pose = {
  position: [0.3, 1.1, -1.5],
  rotation: [0, Math.sin(-0.2), 0, Math.cos(-0.2)],
};

let open: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const s of open) s.dispose();
  open = [];
});

describe('wireArSpaceCorrection (RecorderApp content)', () => {
  it('W1: after a jump every marker, tile and QR object of the old frame sits on J applied to its raw pose; GPS-space markers stay', async () => {
    // Why this test matters: this is the feature. Content placed before an
    // ARCore relocalization must move back onto its physical place in the
    // jump's own frame, by the jump measured in the store, while the
    // GPS-space markers (scene root) never move.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    open.push(s);
    storeRef.get().dispatch(fix(1, [1, 0, -2]));
    storeRef.get().dispatch(add2dImage(frame('f/a.jpg', T0 + 100)));
    await flush();
    s.qr.update(qrPose, 0.2, T0 + 150);

    const marker = s.fused(0);
    expect(marker.parent).toBe(s.correction.arContent);
    const rawMarker = s.root.children.find((c) =>
      c.name.startsWith('raw-gps')
    )!;
    const before = {
      marker: localOf(marker),
      rawMarker: rawMarker.position.clone(),
      tile: localOf(s.tile('f/a.jpg')),
      axis: localOf(s.qrObjects().axis),
      cube: localOf(s.qrObjects().cube),
    };

    const J = rawRigid(0.4, 2, 0.1, -3);
    storeRef.get().dispatch(relocalizationObserved(stillJump(T0 + 1000, J)));

    // arContent is an identity child of arWorldGroup: P = I, the jump acts
    // in O. Tiles and QR objects ride a WEBXR_TO_NUE basis: P = B, the
    // jump acts on their raw local pose directly.
    expect(
      maxDiff(localOf(marker), inO(J).multiply(before.marker))
    ).toBeLessThan(1e-9);
    expect(
      maxDiff(localOf(s.tile('f/a.jpg')), J.clone().multiply(before.tile))
    ).toBeLessThan(1e-9);
    expect(
      maxDiff(localOf(s.qrObjects().axis), J.clone().multiply(before.axis))
    ).toBeLessThan(1e-9);
    expect(
      maxDiff(localOf(s.qrObjects().cube), J.clone().multiply(before.cube))
    ).toBeLessThan(1e-9);
    expect(rawMarker.position.toArray()).toEqual(before.rawMarker.toArray());

    // The QR view rewrites the raw pose from the same old observation on
    // the next frame: re-dated, it lands on the same corrected place.
    s.qr.update(qrPose, 0.2, T0 + 150);
    expect(
      maxDiff(localOf(s.qrObjects().axis), J.clone().multiply(before.axis))
    ).toBeLessThan(1e-9);
    // A new detection after the jump is already in the new frame.
    s.qr.update(qrPose, 0.2, T0 + 1500);
    expect(maxDiff(localOf(s.qrObjects().axis), before.axis)).toBeLessThan(
      1e-12
    );
  });

  it('W2: with the setting off the observation is still recorded and nothing moves', async () => {
    // Why this test matters: off must stop only the scene correction, never
    // the recording of the relocalization (the corpus needs it either way).
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef, false);
    open.push(s);
    expect(s.correction.arContent).toBeNull();
    expect(s.correction.onPlaced).toBeUndefined();
    storeRef.get().dispatch(fix(1, [1, 0, -2]));
    storeRef.get().dispatch(add2dImage(frame('f/a.jpg', T0 + 100)));
    await flush();
    s.qr.update(qrPose, 0.2, T0 + 150);
    const before = [s.fused(0), s.tile('f/a.jpg'), s.qrObjects().cube].map(
      localOf
    );

    storeRef
      .get()
      .dispatch(
        relocalizationObserved(stillJump(T0 + 1000, rawRigid(0.4, 2, 0, -3)))
      );

    expect(
      storeRef.get().getState().arSpaceCorrection.observations
    ).toHaveLength(1);
    const after = [s.fused(0), s.tile('f/a.jpg'), s.qrObjects().cube].map(
      localOf
    );
    after.forEach((m, i) => expect(maxDiff(m, before[i]!)).toBe(0));
    expect(s.arWorldGroup.getObjectByName('arContent')).toBeUndefined();
  });

  it('W3: a GPS fix dispatched after a jump takes the epoch at dispatch and receives only later jumps', () => {
    // Why this test matters: a fix taken before the jump but dispatched
    // after it carries an odometry pose read after the jump, so it is
    // already in the new frame; correcting it again would push it off.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    open.push(s);
    const J1 = rawRigid(0.4, 2, 0, -3);
    const J2 = rawRigid(-0.25, -1, 0, 1.5);
    storeRef.get().dispatch(relocalizationObserved(stillJump(T0 + 1000, J1)));
    storeRef.get().dispatch(fix(1, [1, 0, -2]));
    const placed = localOf(s.fused(0));
    expect(s.fused(0).parent).toBe(s.correction.arContent);

    storeRef.get().dispatch(relocalizationObserved(stillJump(T0 + 2000, J2)));

    expect(maxDiff(localOf(s.fused(0)), inO(J2).multiply(placed))).toBeLessThan(
      1e-9
    );
  });

  it('W6: content captured in the jump frame itself belongs to the new frame', async () => {
    // Why this test matters: the observation carries the jump frame's time
    // t, and epochs count observations at or before a capture time; a tile
    // captured at t was posed in the new frame and must not move, while one
    // captured a millisecond earlier must.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    open.push(s);
    const t = T0 + 1000;
    const J = rawRigid(0.4, 2, 0, -3);
    storeRef.get().dispatch(relocalizationObserved(stillJump(t, J)));
    storeRef.get().dispatch(add2dImage(frame('f/at.jpg', t)));
    storeRef.get().dispatch(add2dImage(frame('f/before.jpg', t - 1)));
    await flush();
    expect(
      maxDiff(localOf(s.tile('f/at.jpg')), rawTile(s.tile('f/at.jpg')))
    ).toBeLessThan(1e-12);
    expect(
      maxDiff(
        localOf(s.tile('f/before.jpg')),
        J.clone().multiply(rawTile(s.tile('f/before.jpg')))
      )
    ).toBeLessThan(1e-9);
  });

  it('W7: a tile whose texture arrives after the jump is shown corrected', async () => {
    // Why this test matters: decoding is asynchronous, so a frame captured
    // and dispatched before a jump may join the scene after it; it must
    // still receive that jump.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    open.push(s);
    const J = rawRigid(0.4, 2, 0, -3);
    storeRef.get().dispatch(add2dImage(frame('f/slow.jpg', T0 + 100)));
    // The observation lands before the decode resolves.
    storeRef.get().dispatch(relocalizationObserved(stillJump(T0 + 1000, J)));
    expect(s.root.getObjectByName('frame-tile-f/slow.jpg')).toBeUndefined();
    await flush();
    expect(
      maxDiff(
        localOf(s.tile('f/slow.jpg')),
        J.clone().multiply(rawTile(s.tile('f/slow.jpg')))
      )
    ).toBeLessThan(1e-9);
  });

  it('W8: a tile captured before a jump and dispatched after it receives the jump', async () => {
    // Why this test matters: the capture is encoded off the frame loop, so
    // its add2dImage can be dispatched after the jump; the capture time,
    // not the dispatch, dates it. Replay builds this same wiring from the
    // recorded actions, so this holds in replay alike.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    open.push(s);
    const J = rawRigid(0.4, 2, 0, -3);
    storeRef.get().dispatch(relocalizationObserved(stillJump(T0 + 1000, J)));
    storeRef.get().dispatch(add2dImage(frame('f/late.jpg', T0 + 900)));
    await flush();
    expect(
      maxDiff(
        localOf(s.tile('f/late.jpg')),
        J.clone().multiply(rawTile(s.tile('f/late.jpg')))
      )
    ).toBeLessThan(1e-9);
  });

  it('W9: after a store swap the tiles of the first recording are gone, its jumps move nothing, and content left in the scene takes each new jump once', async () => {
    // Why this test matters: each recording in one AR session has its own
    // store. The tile feed clears on the swap, so the registry keeps none
    // of the first recording's tiles; a jump recorded into the old store
    // must no longer move anything; content still in the scene (a fused
    // marker until the next recording clears it) must receive the new
    // store's first jump exactly once.
    const first = newStore();
    const storeRef = createStoreRef(first);
    const s = scene(storeRef);
    open.push(s);
    first.dispatch(fix(1, [1, 0, -2]));
    first.dispatch(add2dImage(frame('f/a.jpg', T0 + 100)));
    await flush();
    const J1 = rawRigid(0.4, 2, 0, -3);
    first.dispatch(relocalizationObserved(stillJump(T0 + 1000, J1)));
    const afterFirst = localOf(s.fused(0));

    const second = newStore();
    storeRef.set(second);
    expect(s.root.getObjectByName('frame-tile-f/a.jpg')).toBeUndefined();
    first.dispatch(
      relocalizationObserved(stillJump(T0 + 2000, rawRigid(1, 5, 0, 5)))
    );
    expect(maxDiff(localOf(s.fused(0)), afterFirst)).toBe(0);

    const J2 = rawRigid(-0.3, 1, 0, 2);
    second.dispatch(relocalizationObserved(stillJump(T0 + 3000, J2)));
    expect(
      maxDiff(localOf(s.fused(0)), inO(J2).multiply(afterFirst))
    ).toBeLessThan(1e-9);
    // A tile of the second recording captured before its jump is corrected.
    second.dispatch(add2dImage(frame('f/b.jpg', T0 + 2500)));
    await flush();
    expect(
      maxDiff(
        localOf(s.tile('f/b.jpg')),
        J2.clone().multiply(rawTile(s.tile('f/b.jpg')))
      )
    ).toBeLessThan(1e-9);
  });

  it('dispose removes arContent and stops correcting; it is idempotent', async () => {
    // Why this test matters: re-entering AR builds a new wiring; the old
    // one must not keep moving tiles of the scene it leaves behind.
    const storeRef = createStoreRef(newStore());
    const s = scene(storeRef);
    storeRef.get().dispatch(add2dImage(frame('f/a.jpg', T0 + 100)));
    await flush();
    const before = localOf(s.tile('f/a.jpg'));
    s.correction.dispose();
    s.correction.dispose();
    expect(s.arWorldGroup.getObjectByName('arContent')).toBeUndefined();
    storeRef
      .get()
      .dispatch(
        relocalizationObserved(stillJump(T0 + 1000, rawRigid(0.4, 2, 0, -3)))
      );
    expect(maxDiff(localOf(s.tile('f/a.jpg')), before)).toBe(0);
    s.dispose();
  });

  it('a wiring that cannot be built is off, so Enter AR and replay go on uncorrected', () => {
    // Why this test matters: both call sites build the scene after this; a
    // throw here would stop Enter AR (or replay) for a feature that only
    // moves content.
    const wiring = wireArSpaceCorrection({
      arWorldGroup: { name: 'not an Object3D' } as unknown as THREE.Object3D,
      storeRef: createStoreRef(newStore()),
      enabled: true,
    });
    expect(wiring.arContent).toBeNull();
    expect(wiring.onPlaced).toBeUndefined();
    expect(() => wiring.dispose()).not.toThrow();
  });

  it('a placement that cannot be corrected is logged once and never thrown into the caller', () => {
    // Why this test matters: the hook runs inside tile and QR updates; an
    // object outside arWorldGroup (a caller bug) must not break them.
    const storeRef = createStoreRef(newStore());
    const arWorldGroup = new THREE.Group();
    const correction = wireArSpaceCorrection({
      arWorldGroup,
      storeRef,
      enabled: true,
    });
    const stray = new THREE.Object3D();
    stray.scale.set(1, 2, 3);
    const elsewhere = new THREE.Group();
    elsewhere.scale.set(1, 2, 3);
    arWorldGroup.add(elsewhere);
    elsewhere.add(stray);
    expect(() => correction.onPlaced!(stray, T0)).not.toThrow();
    expect(() => correction.onPlaced!(stray, T0)).not.toThrow();
    correction.dispose();
  });
});
