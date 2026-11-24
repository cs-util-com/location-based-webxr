/**
 * Tests for the WS-5 QR debug controller (the store-driven consumer).
 *
 * Why this matters: this is the orchestration that turns recorded RAW detections
 * into the live/replay debug axis+cube. We pin the behaviour that the plan
 * promises — render a sizeable marker, render NOTHING (no throw) when it isn't
 * sizeable yet, PERSIST a view across a transient miss, dispose a view when its
 * marker leaves the store, feed the depth resolver even before AR starts, and
 * tear everything down on dispose. PnP/size numerics are injected (covered by the
 * framework tests), so these tests isolate the controller's logic.
 */

import { describe, it, expect } from 'vitest';
import { Group, type Object3D } from 'three';
import type { Pose } from 'gps-plus-slam-app-framework/ar';
import type {
  DerivedQrPlacement,
  IncrementalQrPlacement,
  RawQrObservation,
  QrDebugView,
} from 'gps-plus-slam-app-framework/ar';
import type {
  QrMarkerState,
  QrDetectedState,
} from 'gps-plus-slam-app-framework/state';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';
import type { QrDepthResolver } from './qr-depth-resolver';
import {
  createQrDebugController,
  type QrDebugControllerState,
} from './qr-debug-controller';

const pose: Pose = { position: [1, 2, 3], rotation: [0, 0, 0, 1] };

/**
 * A fake incremental deriver: `update` returns whatever `fn` decides per call,
 * and `reset` records which markers were reset (so the dispose path can be
 * asserted). The real deriver's fold/memo math is covered by the framework tests.
 */
function fakeDeriver(
  fn: (
    text: string,
    observations: readonly RawQrObservation[]
  ) => DerivedQrPlacement | null
): IncrementalQrPlacement & { resets: string[] } {
  const resets: string[] = [];
  return {
    update: (text, observations) => fn(text, observations),
    reset: (text) => {
      resets.push(text);
    },
    resets,
  };
}

/** A fake debug view that records update/dispose calls. */
function fakeView(): {
  view: QrDebugView;
  updates: Array<[Pose, number | null]>;
  capturedAts: Array<number | undefined>;
  readonly disposed: number;
} {
  const updates: Array<[Pose, number | null]> = [];
  const capturedAts: Array<number | undefined> = [];
  let disposed = 0;
  const view: QrDebugView = {
    update: (p, s, t) => {
      updates.push([p, s]);
      capturedAts.push(t);
    },
    clear: () => {},
    dispose: () => {
      disposed += 1;
    },
  };
  return {
    view,
    updates,
    capturedAts,
    get disposed() {
      return disposed;
    },
  };
}

/** Minimal marker (only the key matters; placement is injected). */
function marker(text: string): QrMarkerState {
  return {
    text,
    detections: [],
    size: { status: 'unknown', estimateM: null, sampleCount: 0, spreadM: 0 },
  };
}

function makeState(
  markerTexts: string[],
  latestDepthSample: DepthSample | null = null
): QrDebugControllerState {
  const markers: Record<string, QrMarkerState> = {};
  for (const t of markerTexts) markers[t] = marker(t);
  const qrDetected: QrDetectedState = { maxHistory: 100, markers };
  return { qrDetected, recording: { latestDepthSample } };
}

/** A resolver spy: records appends, never resolves (placement is injected). */
function spyResolver(): QrDepthResolver & {
  appends: DepthSample[];
  resets: number;
} {
  const appends: DepthSample[] = [];
  let resets = 0;
  return {
    appends,
    get resets() {
      return resets;
    },
    append: (s) => appends.push(s),
    resolveDepthAt: () => null,
    reset: () => {
      resets += 1;
    },
  };
}

const fakeArGroup = {} as Object3D;
const fakeSample = (timestamp: number): DepthSample => ({
  timestamp,
  cameraPos: [0, 0, 0],
  cameraRot: [0, 0, 0, 1],
  points: [],
});

describe('createQrDebugController', () => {
  it('renders a debug view (pose + size) for a sizeable marker', () => {
    const views: ReturnType<typeof fakeView>[] = [];
    const placement: DerivedQrPlacement = { pose, sizeM: 0.2 };
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => fakeArGroup,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      deriver: fakeDeriver(() => placement),
    });

    controller.update();
    expect(views).toHaveLength(1);
    expect(views[0]!.updates).toEqual([[pose, 0.2]]);
  });

  it('dates every view update with the newest observation it was solved from', () => {
    // Why this test matters: the placement pose is the PnP solve of the
    // newest observation, and the AR-space correction re-dates the debug
    // objects by this time; a missing or older time would apply the wrong
    // relocalizations to a QR cube drawn after a jump.
    const views: ReturnType<typeof fakeView>[] = [];
    let observations = [{ text: 'm', timestamp: 500 }];
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => fakeArGroup,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      selectObservations: () => observations as unknown as RawQrObservation[],
      deriver: fakeDeriver(() => ({ pose, sizeM: 0.2 })),
    });
    controller.update();
    observations = [...observations, { text: 'm', timestamp: 900 }];
    controller.update();
    controller.update();
    expect(views[0]!.capturedAts).toEqual([500, 900, 900]);
  });

  it('the default view reports its rewritten objects through onObjectPlaced', () => {
    // Why this test matters: the live wiring passes no view factory, so the
    // hook must reach the default view, or the QR cube is never corrected.
    const parent = new Group();
    const placed: Array<[Object3D, number]> = [];
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => parent,
      selectObservations: () =>
        [{ text: 'm', timestamp: 700 }] as unknown as RawQrObservation[],
      deriver: fakeDeriver(() => ({ pose, sizeM: 0.2 })),
      onObjectPlaced: (object, capturedAt) => placed.push([object, capturedAt]),
    });
    controller.update();
    expect(placed.map(([, t]) => t)).toEqual([700, 700]);
    expect(placed.every(([o]) => o.parent?.parent === parent)).toBe(true);
    controller.dispose();
  });

  it('feeds the marker raw observations (selectObservations) into the deriver', () => {
    const sentinel = [
      { text: 'm', timestamp: 1 },
    ] as unknown as readonly RawQrObservation[];
    let received: readonly RawQrObservation[] | undefined;
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => fakeArGroup,
      createView: () => fakeView().view,
      selectObservations: () => sentinel as RawQrObservation[],
      deriver: fakeDeriver((_text, observations) => {
        received = observations;
        return { pose, sizeM: 0.2 };
      }),
    });

    controller.update();
    expect(received).toBe(sentinel);
  });

  it('renders nothing (no view, no throw) when a marker is not sizeable yet', () => {
    const views: ReturnType<typeof fakeView>[] = [];
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => fakeArGroup,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      deriver: fakeDeriver(() => null), // not sizeable
    });

    expect(() => controller.update()).not.toThrow();
    expect(views).toHaveLength(0);
  });

  it('persists an existing view across a transient miss (no dispose, no re-update)', () => {
    const views: ReturnType<typeof fakeView>[] = [];
    let sizeable = true;
    const controller = createQrDebugController({
      getState: () => makeState(['m']),
      getArWorldGroup: () => fakeArGroup,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      deriver: fakeDeriver(() => (sizeable ? { pose, sizeM: 0.2 } : null)),
    });

    controller.update(); // sizeable → view created + updated
    sizeable = false;
    controller.update(); // miss → view kept, not updated, not disposed

    expect(views).toHaveLength(1);
    expect(views[0]!.updates).toHaveLength(1); // only the first update
    expect(views[0]!.disposed).toBe(0);
  });

  it('disposes a view + resets the deriver when its marker leaves the store', () => {
    const views: ReturnType<typeof fakeView>[] = [];
    let texts = ['m'];
    const deriver = fakeDeriver((text) =>
      text === 'm' ? { pose, sizeM: 0.2 } : null
    );
    const controller = createQrDebugController({
      getState: () => makeState(texts),
      getArWorldGroup: () => fakeArGroup,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      deriver,
    });

    controller.update(); // creates the 'm' view
    texts = []; // clearQrMarker → marker gone
    controller.update();

    expect(views[0]!.disposed).toBe(1);
    // The marker's accumulated derive state must be cleared too (no stale size
    // if the same payload reappears).
    expect(deriver.resets).toContain('m');
  });

  it('feeds the depth resolver even before AR starts (no arWorldGroup yet)', () => {
    const resolver = spyResolver();
    const sample = fakeSample(100);
    const controller = createQrDebugController({
      getState: () => makeState(['m'], sample),
      getArWorldGroup: () => null, // AR not started
      resolver,
      deriver: fakeDeriver(() => ({ pose, sizeM: 0.2 })),
      createView: () => fakeView().view,
    });

    controller.update();
    expect(resolver.appends).toEqual([sample]); // depth captured...
    // ...but nothing rendered (no parent yet) — covered by no throw.
  });

  it('appends a depth sample only once across repeated ticks (identity de-dup)', () => {
    const resolver = spyResolver();
    const sample = fakeSample(100);
    const controller = createQrDebugController({
      getState: () => makeState([], sample),
      getArWorldGroup: () => fakeArGroup,
      resolver,
    });

    controller.update();
    controller.update(); // same latestDepthSample object → no second append
    expect(resolver.appends).toHaveLength(1);
  });

  it('dispose() tears down all views and resets the resolver', () => {
    const views: ReturnType<typeof fakeView>[] = [];
    const resolver = spyResolver();
    const controller = createQrDebugController({
      getState: () => makeState(['m', 'n']),
      getArWorldGroup: () => fakeArGroup,
      resolver,
      createView: () => {
        const v = fakeView();
        views.push(v);
        return v.view;
      },
      deriver: fakeDeriver(() => ({ pose, sizeM: 0.2 })),
    });

    controller.update(); // two views
    controller.dispose();

    expect(views).toHaveLength(2);
    expect(views.every((v) => v.disposed === 1)).toBe(true);
    expect(resolver.resets).toBe(1);
  });
});
