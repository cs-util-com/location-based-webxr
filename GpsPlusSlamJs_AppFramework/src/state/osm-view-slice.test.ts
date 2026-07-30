/**
 * `createOsmViewSlice` — the shared state four OSM-affordance views read from.
 *
 * Why this test matters:
 * The slice's whole job is to let a map, a 3D scene, a legend and a details
 * panel agree without any of them talking to each other, so every assertion
 * here is about a transition several views observe at once. The load-bearing
 * one is the failure split (DEC-16): a DATA failure must clear the snapshot,
 * because leaving it up is the stale-map defect that prompted this work, while
 * a VIEW that throws while drawing a valid snapshot must NOT clear it — the
 * other view is showing the right thing and discarding it destroys good state.
 * Those two live one line apart in the reducer and are easy to collapse into
 * one action, which is exactly what this file exists to prevent.
 *
 * @see osm-view-slice.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-07-29-0739-osm-demo-feedback-round-1-plan.md §2.1, W1
 */

import { describe, it, expect } from 'vitest';
import { createOsmViewSlice, type OsmViewLatLng } from './osm-view-slice';

/** Stands in for the demo's `DemoSnapshot`; the slice never inspects it. */
interface TestSnapshot {
  readonly cells: number;
}

const COLOGNE: OsmViewLatLng = { lat: 50.9413, lng: 6.9583 };
const SNAPSHOT: TestSnapshot = { cells: 931 };

function makeSlice() {
  return createOsmViewSlice<TestSnapshot>({
    initialPosition: COLOGNE,
    initialCategory: 'walkable',
  });
}

/** Reduce a sequence of actions from the initial state, for terse arrange steps. */
function reduceAll(
  slice: ReturnType<typeof makeSlice>,
  ...actions: readonly { type: string; payload?: unknown }[]
) {
  let state = slice.reducer(undefined, { type: '@@INIT' });
  for (const action of actions) state = slice.reducer(state, action);
  return state;
}

describe('createOsmViewSlice — initial state', () => {
  it('starts at the caller-supplied position and category, idle, with nothing selected', () => {
    const state = makeSlice().reducer(undefined, { type: '@@INIT' });
    expect(state.position).toEqual(COLOGNE);
    expect(state.category).toBe('walkable');
    expect(state.showBelowThreshold).toBe(false);
    expect(state.selectedCell).toBeUndefined();
    expect(state.snapshot).toBeUndefined();
    expect(state.loading.phase).toBe('idle');
  });

  it('namespaces the action types, so two slices in one store cannot collide', () => {
    const a = createOsmViewSlice<TestSnapshot>({
      name: 'osmLeft',
      initialPosition: COLOGNE,
      initialCategory: 'walkable',
    });
    const b = createOsmViewSlice<TestSnapshot>({
      name: 'osmRight',
      initialPosition: COLOGNE,
      initialCategory: 'walkable',
    });
    expect(a.actions.categoryChanged('x').type).toBe('osmLeft/categoryChanged');
    expect(b.actions.categoryChanged('x').type).toBe(
      'osmRight/categoryChanged'
    );
  });
});

describe('createOsmViewSlice — user intent', () => {
  it('moving the user clears the selected cell, because it belongs to the old place', () => {
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.cellSelected('8d1fb46622d8dbf'),
      slice.actions.positionChanged({ lat: 51, lng: 7 })
    );
    expect(state.position).toEqual({ lat: 51, lng: 7 });
    expect(state.selectedCell).toBeUndefined();
  });

  it('changing the category KEEPS the selected cell — the same cell in a new category is a real question', () => {
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.cellSelected('8d1fb46622d8dbf'),
      slice.actions.categoryChanged('battleArea')
    );
    expect(state.category).toBe('battleArea');
    expect(state.selectedCell).toBe('8d1fb46622d8dbf');
  });

  it('selects a FEATURE, and that clears any selected cell', () => {
    // WHY THESE TWO ARE MUTUALLY EXCLUSIVE. There is one details panel, so there
    // is one selection. Holding both would make the panel's contents depend on
    // which branch of the renderer ran last — a coin-toss the user cannot see and
    // no test would reliably catch.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.cellSelected('8d1fb46622d8dbf'),
      slice.actions.featureSelected({
        feature: 'node/4242',
        kind: 'amenity=cafe',
        label: 'Café Schmitz',
      })
    );
    expect(state.selectedFeature?.label).toBe('Café Schmitz');
    expect(state.selectedCell).toBeUndefined();
  });

  it('selecting a cell clears any selected feature, for the same reason', () => {
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.featureSelected({
        feature: 'node/4242',
        kind: 'amenity=cafe',
        label: 'Café Schmitz',
      }),
      slice.actions.cellSelected('8d1fb46622d8dbf')
    );
    expect(state.selectedCell).toBe('8d1fb46622d8dbf');
    expect(state.selectedFeature).toBeUndefined();
  });

  it('moving the user clears the selected FEATURE too', () => {
    // A marker belongs to a working set. After a move it may not be in the new
    // one at all, and a panel describing something no longer on screen is the
    // half-swapped scene in its most damaging form — it reads as current.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.featureSelected({
        feature: 'node/4242',
        kind: 'amenity=cafe',
        label: 'Café Schmitz',
      }),
      slice.actions.positionChanged({ lat: 51, lng: 7 })
    );
    expect(state.selectedFeature).toBeUndefined();
  });

  it('toggles the below-threshold band and clears the selection on demand', () => {
    const slice = makeSlice();
    const shown = reduceAll(
      slice,
      slice.actions.showBelowThresholdChanged(true)
    );
    expect(shown.showBelowThreshold).toBe(true);

    const cleared = slice.reducer(
      slice.reducer(shown, slice.actions.cellSelected('8d1fb4')),
      slice.actions.cellSelected(undefined)
    );
    expect(cleared.selectedCell).toBeUndefined();
  });
});

describe('createOsmViewSlice — the refresh cycle', () => {
  it('reports fetching then scoring, and a ready snapshot returns it to idle', () => {
    const slice = makeSlice();
    const fetching = reduceAll(slice, slice.actions.fetchStarted('Fetching…'));
    expect(fetching.loading).toEqual({
      phase: 'fetching',
      message: 'Fetching…',
    });

    const scoring = slice.reducer(fetching, slice.actions.scoringStarted());
    expect(scoring.loading.phase).toBe('scoring');

    const ready = slice.reducer(scoring, slice.actions.snapshotReady(SNAPSHOT));
    expect(ready.snapshot).toBe(SNAPSHOT);
    expect(ready.loading).toEqual({ phase: 'idle', message: '' });
  });

  it('keeps the previous snapshot visible WHILE the next fetch runs', () => {
    // Blanking on `fetchStarted` would flash the map empty on every click. The
    // stale picture is only wrong once the refresh has FAILED, not while it runs.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.snapshotReady(SNAPSHOT),
      slice.actions.fetchStarted('Fetching…')
    );
    expect(state.snapshot).toBe(SNAPSHOT);
  });
});

describe('createOsmViewSlice — the failure split (DEC-16)', () => {
  it('a DATA failure clears the snapshot, so no view can keep drawing the old place', () => {
    // The reported defect: `Failed: …` in the status line while the map still
    // showed the previous category's cells, asserting a state nothing produced.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.snapshotReady(SNAPSHOT),
      slice.actions.fetchFailed('Overpass said no')
    );
    expect(state.snapshot).toBeUndefined();
    expect(state.loading).toEqual({
      phase: 'error',
      message: 'Overpass said no',
    });
  });

  it('a VIEW failure keeps the snapshot, because the other view drew it correctly', () => {
    // If the 3D scene throws after the map drew, the map is showing the right
    // thing. Modelling this as `fetchFailed` would blank a correct picture.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.snapshotReady(SNAPSHOT),
      slice.actions.nonFatalError('WebGL context lost')
    );
    expect(state.snapshot).toBe(SNAPSHOT);
    expect(state.loading).toEqual({
      phase: 'error',
      message: 'WebGL context lost',
    });
  });

  it('a successful refresh after a failure clears the error', () => {
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.fetchFailed('boom'),
      slice.actions.fetchStarted('Fetching…'),
      slice.actions.snapshotReady(SNAPSHOT)
    );
    expect(state.loading.phase).toBe('idle');
    expect(state.snapshot).toBe(SNAPSHOT);
  });

  it('a data failure also drops the selection, since the cell it named is gone', () => {
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.snapshotReady(SNAPSHOT),
      slice.actions.cellSelected('8d1fb46622d8dbf'),
      slice.actions.fetchFailed('boom')
    );
    expect(state.selectedCell).toBeUndefined();
  });
});

describe('createOsmViewSlice — serialisability', () => {
  it('holds nothing RTK would reject: the state survives a JSON round-trip', () => {
    // RTK's default middleware throws on non-serialisable state in development.
    // The slice must therefore never grow a Map, a Leaflet layer or a three.js
    // object — the raw OsmFeature map deliberately stays in the demo pipeline.
    const slice = makeSlice();
    const state = reduceAll(
      slice,
      slice.actions.snapshotReady(SNAPSHOT),
      slice.actions.cellSelected('8d1fb46622d8dbf'),
      slice.actions.showBelowThresholdChanged(true)
    );
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('createOsmViewSlice — the layer set', () => {
  /**
   * WHY THE LAYER SET IS STRUCTURAL HERE. This package is published and
   * `gps-plus-slam-osm` is not, so any reference to it — including a type-only
   * import, which lands in the emitted `.d.ts` — 404s every consumer's install.
   * That is why `TSnapshot` is a generic, and a layer union would hit the same wall.
   * So the slice stores `Record<string, boolean>` and knows nothing about names.
   */
  it('defaults to no layers, so a consumer must opt in', () => {
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 0, lng: 0 },
      initialCategory: 'walkable',
    });
    const state = slice.reducer(undefined, { type: '@@INIT' });
    expect(state.layers).toEqual({});
  });

  it('takes the consumer initial set verbatim', () => {
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 0, lng: 0 },
      initialCategory: 'walkable',
      initialLayers: { buildings: true, roads: false },
    });
    const state = slice.reducer(undefined, { type: '@@INIT' });
    expect(state.layers).toEqual({ buildings: true, roads: false });
  });

  it('replaces the whole set, and touches nothing else', () => {
    // Whole-set replacement rather than a per-layer pair: a per-layer action would
    // need the consumer's union as its payload type, which this package cannot name.
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 1, lng: 2 },
      initialCategory: 'walkable',
      initialLayers: { buildings: true },
    });
    const before = slice.reducer(undefined, { type: '@@INIT' });
    const after = slice.reducer(
      before,
      slice.actions.layersChanged({ buildings: false, poi: true })
    );

    expect(after.layers).toEqual({ buildings: false, poi: true });
    // Everything else survives — the layer set is presentation, not data.
    expect(after.position).toEqual(before.position);
    expect(after.category).toBe(before.category);
    expect(after.snapshot).toBe(before.snapshot);
    expect(after.loading).toEqual(before.loading);
  });

  it('does not mutate the previous state in place', () => {
    // Subscribers only fire on a new reference; an in-place write would update the
    // store invisibly and the views would keep drawing the previous layers.
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 0, lng: 0 },
      initialCategory: 'walkable',
      initialLayers: { buildings: true },
    });
    const before = slice.reducer(undefined, { type: '@@INIT' });
    slice.reducer(before, slice.actions.layersChanged({ buildings: false }));
    expect(before.layers).toEqual({ buildings: true });
  });
});

describe('groundMode (W11)', () => {
  /**
   * Why these tests matter:
   * The ground mode is exclusive while `layers` is a set of independent
   * switches, and the reason it is a separate field rather than another layer is
   * that merging them would make "no ground" expressible as more than one state.
   * These pin that separation, plus the publish-boundary shape (a plain string,
   * because this package may not name an OSM type).
   */
  it('starts at whatever the consumer named, and is a plain string', () => {
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 1, lng: 2 },
      initialCategory: 'walkable',
      initialGroundMode: 'cpu',
    });
    const state = slice.reducer(undefined, { type: '@@init' });

    expect(state.groundMode).toBe('cpu');
  });

  it('switches without disturbing the layer set', () => {
    // The separation, as a behaviour: switching the ground must not silently
    // change which layers are drawn, and vice versa.
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 1, lng: 2 },
      initialCategory: 'walkable',
      initialLayers: { cells: true, plates: true },
      initialGroundMode: 'cpu',
    });
    const before = slice.reducer(undefined, { type: '@@init' });

    const after = slice.reducer(
      before,
      slice.actions.groundModeChanged('none')
    );

    expect(after.groundMode).toBe('none');
    expect(after.layers).toEqual(before.layers);
  });

  it('and a layer change leaves the ground mode alone', () => {
    const slice = createOsmViewSlice<string>({
      initialPosition: { lat: 1, lng: 2 },
      initialCategory: 'walkable',
      initialGroundMode: 'gpu',
    });
    const before = slice.reducer(undefined, { type: '@@init' });

    const after = slice.reducer(
      before,
      slice.actions.layersChanged({ cells: false })
    );

    expect(after.groundMode).toBe('gpu');
  });
});
