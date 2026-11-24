/**
 * Tests for `createArParentTarget` (P1) and the binding registry.
 *
 * Why these tests matter: the binding that moves the AR world group and the
 * deferred anchors that re-place content to T^-1 both read T from here. If
 * the two ever read different values, content carries part of the alignment
 * twice. Maturity decides whether anchors still follow the alignment, so its
 * input (device fixes only, never the synthetic code votes) is pinned too.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  GPS_POINT_SOURCE_DEVICE,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
} from 'gps-plus-slam-js';
import {
  ANCHOR_DEFERRAL_AB_PERIOD_S,
  DEV_WORLD_JUMP_PERIOD_S,
  anchorDeferralFromPage,
  createArParentTarget,
  devWorldJumpFromPage,
  getArParentBinding,
  parseAnchorDeferral,
  parseDevWorldJump,
  registerArParentBinding,
  type ArParentBinding,
} from './ar-parent-target';
import { makeNonTrivialAlignment } from '../test-utils/non-trivial-alignment';
import type { SubscribableStore } from '../state/subscribe-to-selector';

interface FakePoint {
  id: string;
  timestamp: number;
  coordinates: [number, number, number];
  source?: string;
}

interface FakeState {
  gpsData: {
    zero: { lat: number; lon: number } | null;
    gpsEvents: {
      alignmentMatrix: readonly number[] | null;
      gpsPositions: FakePoint[];
    };
  };
  qrDetected?: { frameEpoch?: unknown };
}

function fakeStore(initial: Partial<FakeState['gpsData']['gpsEvents']> = {}) {
  const listeners = new Set<() => void>();
  let state: FakeState = {
    gpsData: {
      zero: { lat: 47, lon: 8 },
      gpsEvents: {
        alignmentMatrix: initial.alignmentMatrix ?? null,
        gpsPositions: initial.gpsPositions ?? [],
      },
    },
  };
  const store = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(next: (s: FakeState) => FakeState) {
      state = next(state);
      for (const l of [...listeners]) l();
    },
  };
  return store as typeof store & SubscribableStore;
}

let pointId = 0;
/** `n` points along north, spanning `spanM` metres. */
function line(n: number, spanM: number, source?: string): FakePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${(pointId += 1)}`,
    timestamp: pointId,
    coordinates: [(spanM * i) / Math.max(1, n - 1), 0, 0] as [
      number,
      number,
      number,
    ],
    ...(source ? { source } : {}),
  }));
}

describe('createArParentTarget', () => {
  it('reads T as the store alignment, and follows it', () => {
    const a = makeNonTrivialAlignment(1);
    const store = fakeStore({ alignmentMatrix: a });
    const target = createArParentTarget(store);
    expect(target.target().toArray()).toEqual([...a]);
    const v = target.version();
    const b = makeNonTrivialAlignment(2);
    store.set((s) => ({
      ...s,
      gpsData: {
        ...s.gpsData,
        gpsEvents: { ...s.gpsData.gpsEvents, alignmentMatrix: b },
      },
    }));
    expect(target.target().toArray()).toEqual([...b]);
    expect(target.version()).toBe(v + 1);
    target.dispose();
  });

  it('ignores a null or non-finite alignment (keeps the last T)', () => {
    const a = makeNonTrivialAlignment(3);
    const store = fakeStore({ alignmentMatrix: a });
    const target = createArParentTarget(store);
    const bad = [...a];
    bad[12] = Number.NaN;
    for (const m of [null, bad]) {
      store.set((s) => ({
        ...s,
        gpsData: {
          ...s.gpsData,
          gpsEvents: { ...s.gpsData.gpsEvents, alignmentMatrix: m },
        },
      }));
      expect(target.target().toArray()).toEqual([...a]);
    }
  });

  it('reads the frame epoch structurally, 0 without the slice', () => {
    const store = fakeStore();
    const target = createArParentTarget(store);
    expect(target.frameEpoch()).toBe(0);
    store.set((s) => ({ ...s, qrDetected: { frameEpoch: 3 } }));
    expect(target.frameEpoch()).toBe(3);
    store.set((s) => ({ ...s, qrDetected: { frameEpoch: 'x' } }));
    expect(target.frameEpoch()).toBe(0);
  });

  // Why: synthetic code votes span tens of metres in one lock; counting them
  // would call a one-code alignment mature and stop the follow phase early.
  it('counts device fixes only for maturity, and keeps it once reached', () => {
    const a = makeNonTrivialAlignment(4);
    const store = fakeStore({
      alignmentMatrix: a,
      gpsPositions: [
        ...line(16, 60, GPS_POINT_SOURCE_SYNTHETIC_QR),
        ...line(5, 10, GPS_POINT_SOURCE_DEVICE),
      ],
    });
    const target = createArParentTarget(store);
    expect(target.isMature()).toBe(false);
    store.set((s) => ({
      ...s,
      gpsData: {
        ...s.gpsData,
        gpsEvents: {
          ...s.gpsData.gpsEvents,
          gpsPositions: [...s.gpsData.gpsEvents.gpsPositions, ...line(5, 40)],
        },
      },
    }));
    expect(target.isMature()).toBe(true);
    // A session data reset (positions and alignment gone) keeps it.
    store.set((s) => ({
      ...s,
      gpsData: {
        ...s.gpsData,
        gpsEvents: { alignmentMatrix: null, gpsPositions: [] },
      },
    }));
    expect(target.isMature()).toBe(true);
  });

  it('starts the session clock at the first tick', () => {
    const target = createArParentTarget(fakeStore());
    target.tick(100);
    expect(target.sessionElapsedS(130)).toBe(30);
    expect(target.sessionElapsedS(Number.NaN)).toBe(0);
  });

  it('composes the dev jump onto T (jump x alignment), once per period', () => {
    const a = makeNonTrivialAlignment(5);
    const store = fakeStore({ alignmentMatrix: a });
    const target = createArParentTarget(store, {
      devJump: { metres: 2, degrees: 10, periodS: DEV_WORLD_JUMP_PERIOD_S },
    });
    const v = target.version();
    target.tick(0);
    target.tick(9.9);
    expect(target.version()).toBe(v);
    target.tick(10);
    const jump = new THREE.Matrix4()
      .makeTranslation(2, 0, 0)
      .multiply(
        new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(10))
      );
    const want = jump.multiply(new THREE.Matrix4().fromArray([...a])).toArray();
    target
      .target()
      .toArray()
      .forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 9));
    expect(target.version()).toBe(v + 1);
    // The alignment changing keeps the jump on top of it.
    const b = makeNonTrivialAlignment(6);
    store.set((s) => ({
      ...s,
      gpsData: {
        ...s.gpsData,
        gpsEvents: { ...s.gpsData.gpsEvents, alignmentMatrix: b },
      },
    }));
    const want2 = new THREE.Matrix4()
      .makeTranslation(2, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(10)))
      .multiply(new THREE.Matrix4().fromArray([...b]))
      .toArray();
    target
      .target()
      .toArray()
      .forEach((v, i) => expect(v).toBeCloseTo(want2[i]!, 9));
  });

  it('refuses an invalid dev jump and ignores a zero one', () => {
    const store = fakeStore();
    expect(() =>
      createArParentTarget(store, {
        devJump: { metres: 1, degrees: 0, periodS: 0 },
      })
    ).toThrow(RangeError);
    const target = createArParentTarget(store, {
      devJump: { metres: 0, degrees: 0, periodS: 10 },
    });
    target.tick(0);
    target.tick(100);
    expect(target.version()).toBe(0);
  });
});

describe('the dev jump from the page', () => {
  it('parses metres and degrees, and nothing without them', () => {
    expect(parseDevWorldJump('?devWorldJumpM=3')).toEqual({
      metres: 3,
      degrees: 0,
      periodS: DEV_WORLD_JUMP_PERIOD_S,
    });
    expect(parseDevWorldJump('?devWorldJumpDeg=-5')).toMatchObject({
      degrees: -5,
    });
    expect(parseDevWorldJump('')).toBeNull();
    expect(parseDevWorldJump('?devWorldJumpM=abc')).toBeNull();
  });

  // Why: the reader exists only in development builds; vitest runs with
  // `import.meta.env.DEV === true`, a production bundle folds it away
  // (`ar-parent-target.build.test.ts`).
  it('reads the page only under import.meta.env.DEV', () => {
    const g = globalThis as { location?: unknown };
    const before = g.location;
    g.location = { search: '?devWorldJumpM=1' };
    try {
      expect((import.meta as { env?: { DEV?: boolean } }).env?.DEV).toBe(true);
      expect(devWorldJumpFromPage()).toMatchObject({ metres: 1 });
    } finally {
      g.location = before;
    }
  });
});

// Why: `?anchors=0` is the field test's switch for a frame-time comparison
// with the deferral off; any other value, or none, must keep it on, and a
// target says which it is to the anchor sets that read it.
describe('the anchor deferral switch from the page', () => {
  it('is off only for anchors=0', () => {
    expect(parseAnchorDeferral('?anchors=0')).toBe(false);
    expect(parseAnchorDeferral('?debug=1&anchors=0')).toBe(false);
    expect(parseAnchorDeferral('')).toBe(true);
    expect(parseAnchorDeferral('?anchors=1')).toBe(true);
    expect(parseAnchorDeferral('?anchors=')).toBe(true);
    expect(parseAnchorDeferral('?anchors=off')).toBe(true);
  });

  it('reads the page under import.meta.env.DEV, and a target carries it', () => {
    const g = globalThis as { location?: unknown };
    const before = g.location;
    g.location = { search: '?anchors=0' };
    try {
      expect(anchorDeferralFromPage()).toBe(false);
    } finally {
      g.location = before;
    }
    expect(createArParentTarget(fakeStore()).defersAnchors()).toBe(true);
    expect(
      createArParentTarget(fakeStore(), { deferAnchors: false }).defersAnchors()
    ).toBe(false);
  });

  // Why: the field test's frame-time comparison runs in ONE session
  // (`anchors=ab`), so both halves share the scene, the phone's heat and
  // the GPS; the target must say which half a frame belongs to, on the
  // session clock, starting with the deferral on.
  it('parses anchors=ab, and alternates on and off by the session clock', () => {
    expect(parseAnchorDeferral('?anchors=ab')).toBe('ab');
    expect(parseAnchorDeferral('?anchors=AB ')).toBe('ab');
    const target = createArParentTarget(fakeStore(), { deferAnchors: 'ab' });
    // Before the first tick the session has not started: on.
    expect(target.defersAnchors()).toBe(true);
    const p = ANCHOR_DEFERRAL_AB_PERIOD_S;
    const seen: boolean[] = [];
    for (const at of [0, p - 0.01, p, 2 * p - 0.01, 2 * p, 3 * p + 1]) {
      target.tick(100 + at);
      seen.push(target.defersAnchors());
    }
    expect(seen).toEqual([true, true, false, false, true, false]);
  });
});

describe('the binding registry', () => {
  it('registers one binding per group; unregister removes only its own', () => {
    const group = new THREE.Group();
    const make = (): ArParentBinding => ({
      group,
      target: createArParentTarget(fakeStore()),
      step: () => undefined,
      attachPass: () => () => undefined,
      onDispose: () => () => undefined,
    });
    const first = make();
    const second = make();
    const unFirst = registerArParentBinding(first);
    expect(getArParentBinding(group)).toBe(first);
    const unSecond = registerArParentBinding(second);
    unFirst();
    expect(getArParentBinding(group)).toBe(second);
    unSecond();
    expect(getArParentBinding(group)).toBeNull();
  });
});
