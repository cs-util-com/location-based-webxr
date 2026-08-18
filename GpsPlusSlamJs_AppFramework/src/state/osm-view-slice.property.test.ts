/**
 * `createOsmViewSlice` — invariants that must hold over ANY action sequence.
 *
 * Why this test matters:
 * The example tests pin the transitions that were designed; these pin the ones
 * nobody thought about. The failure split (DEC-16) is the invariant most likely
 * to be broken by a later "simplification" that merges the two error actions —
 * and it would break silently, because both still show an error message. Stating
 * it as "over every reachable state" rather than "from a snapshot-ready state"
 * is what makes the merge impossible to do accidentally.
 *
 * @see osm-view-slice.ts.md
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createOsmViewSlice, type OsmViewLatLng } from './osm-view-slice';

interface TestSnapshot {
  readonly cells: number;
}

interface TestGeoEvent {
  readonly eventTime: number;
}

const COLOGNE: OsmViewLatLng = { lat: 50.9413, lng: 6.9583 };

const slice = createOsmViewSlice<TestSnapshot, TestGeoEvent>({
  initialPosition: COLOGNE,
  initialCategory: 'walkable',
});
const { actions, reducer } = slice;

/** Every action the slice accepts, with plausible payloads. */
const anyAction = fc.oneof(
  fc
    .record({
      lat: fc.double({ min: -85, max: 85, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    })
    .map((p) => actions.positionChanged(p)),
  fc
    .record({
      lat: fc.double({ min: -85, max: 85, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    })
    .map((p) => actions.placeChanged(p)),
  fc.string().map((c) => actions.categoryChanged(c)),
  fc.boolean().map((b) => actions.showBelowThresholdChanged(b)),
  fc
    .option(fc.string(), { nil: undefined })
    .map((c) => actions.cellSelected(c)),
  fc.string().map((m) => actions.fetchStarted(m)),
  fc.string().map((m) => actions.scoringStarted(m)),
  fc.nat().map((n) => actions.snapshotReady({ cells: n })),
  fc
    .option(
      fc.nat().map((eventTime) => ({ eventTime })),
      { nil: undefined }
    )
    .map((e) => actions.geoEventFound(e)),
  fc.string().map((m) => actions.fetchFailed(m)),
  fc.string().map((m) => actions.nonFatalError(m))
);

const anySequence = fc.array(anyAction, { maxLength: 40 });

/** The state reached by applying `sequence` from the slice's initial state. */
function stateAfter(sequence: readonly { type: string }[]) {
  let state = reducer(undefined, { type: '@@INIT' });
  for (const action of sequence) state = reducer(state, action);
  return state;
}

describe('createOsmViewSlice invariants', () => {
  it('nonFatalError NEVER changes the snapshot, from any reachable state', () => {
    // The half of DEC-16 that a merge of the two error actions would destroy:
    // a view that fails while drawing a valid snapshot must not discard it.
    fc.assert(
      fc.property(anySequence, fc.string(), (sequence, message) => {
        const before = stateAfter(sequence);
        const after = reducer(before, actions.nonFatalError(message));
        expect(after.snapshot).toBe(before.snapshot);
        expect(after.selectedCell).toBe(before.selectedCell);
        expect(after.loading).toEqual({ phase: 'error', message });
      })
    );
  });

  it('fetchFailed ALWAYS clears the snapshot and the selection, from any reachable state', () => {
    // The other half: a data failure can never leave a picture on screen that
    // nothing produced. This is the defect the round-1 feedback reported.
    fc.assert(
      fc.property(anySequence, fc.string(), (sequence, message) => {
        const after = reducer(
          stateAfter(sequence),
          actions.fetchFailed(message)
        );
        expect(after.snapshot).toBeUndefined();
        expect(after.selectedCell).toBeUndefined();
        expect(after.loading.phase).toBe('error');
      })
    );
  });

  it('a geo-event NEVER outlives the category it was computed for', () => {
    // The reported bug as an invariant rather than an example: whatever
    // sequence got the state here, switching category must not leave an event
    // standing. An event is an answer about ONE category's scores and its
    // threshold, so a surviving one is a marker asserting something the map no
    // longer shows.
    fc.assert(
      fc.property(anySequence, fc.string(), (sequence, category) => {
        const after = reducer(
          stateAfter(sequence),
          actions.categoryChanged(category)
        );
        expect(after.geoEvent).toBeUndefined();
      })
    );
  });

  it('a geo-event ALWAYS survives a move, so it can be walked to', () => {
    // The counterweight, and the reason this is a pair. Without it, "clear on
    // anything that changes the view" would pass the invariant above and delete
    // the event on the user's first step towards it — the label says "640 m
    // NE", which is an instruction, not a description.
    fc.assert(
      fc.property(
        anySequence,
        fc.record({
          lat: fc.double({ min: -85, max: 85, noNaN: true }),
          lng: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        (sequence, position) => {
          const before = stateAfter(sequence);
          const after = reducer(before, actions.positionChanged(position));
          expect(after.geoEvent).toBe(before.geoEvent);
        }
      )
    );
  });

  it('a DECLARED place change ALWAYS clears the snapshot and the geo-event', () => {
    // The counterweight to the invariant above, and the pair is the point
    // (DEC-R12-8, DEC-R12-10). Whatever sequence got the state here, saying "I
    // am somewhere else" must leave nothing on screen that describes where the
    // user was — the scene the session watched persist for 20-30 s, and the
    // geo-event whose bearing now points across an ocean.
    fc.assert(
      fc.property(
        anySequence,
        fc.record({
          lat: fc.double({ min: -85, max: 85, noNaN: true }),
          lng: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        (sequence, position) => {
          const after = reducer(
            stateAfter(sequence),
            actions.placeChanged(position)
          );
          expect(after.snapshot).toBeUndefined();
          expect(after.geoEvent).toBeUndefined();
          expect(after.selectedCell).toBeUndefined();
        }
      )
    );
  });

  it('a DECLARED place change leaves the PRESENTATION untouched, from any reachable state', () => {
    // The other half of what makes this a place change rather than a reset: how
    // the user is looking does not change because they went somewhere else.
    fc.assert(
      fc.property(
        anySequence,
        fc.record({
          lat: fc.double({ min: -85, max: 85, noNaN: true }),
          lng: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        (sequence, position) => {
          const before = stateAfter(sequence);
          const after = reducer(before, actions.placeChanged(position));
          expect(after.category).toBe(before.category);
          expect(after.groundMode).toBe(before.groundMode);
          expect(after.layers).toBe(before.layers);
          expect(after.showBelowThreshold).toBe(before.showBelowThreshold);
        }
      )
    );
  });

  it('every reachable state survives a JSON round-trip', () => {
    // RTK's default middleware throws on non-serialisable state in development,
    // and the store is persisted/devtools-inspected in the consumer. A Map, a
    // Set or a class instance sneaking into a payload fails here first.
    fc.assert(
      fc.property(anySequence, (sequence) => {
        const state = stateAfter(sequence);
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      })
    );
  });

  it('position and category only ever change through their own actions', () => {
    // Guards against a future action quietly resetting the view — the kind of
    // coupling a store is supposed to remove, not introduce.
    //
    // TWO ACTIONS WRITE THE POSITION since DEC-R12-8, so the invariant is about
    // the last of EITHER rather than the last `positionChanged`. Naming only one
    // of them would let the other set the position unobserved, which is the
    // coupling this test exists to catch.
    const POSITION_WRITERS = new Set<string>([
      actions.positionChanged.type,
      actions.placeChanged.type,
    ]);
    fc.assert(
      fc.property(anySequence, (sequence) => {
        const state = stateAfter(sequence);
        const lastPosition = [...sequence]
          .reverse()
          .find((a) => POSITION_WRITERS.has(a.type));
        const lastCategory = [...sequence]
          .reverse()
          .find((a) => a.type === actions.categoryChanged.type);
        // SIGNED ZERO IS NORMALISED AWAY ON BOTH SIDES before comparing, with
        // `+ 0` mapping -0 to +0. `positionChanged` normalises the payload (see
        // the JSON round-trip invariant — `JSON.stringify(-0)` is `"0"`, so a
        // -0 latitude would not survive a reload), and `toEqual` distinguishes
        // the two zeroes, so a raw structural comparison fails on a difference
        // no consumer can observe. What this invariant is actually about is
        // WHICH action last set the position, not its bit pattern.
        const sameCoordinate = (p: { lat: number; lng: number }) => ({
          lat: p.lat + 0,
          lng: p.lng + 0,
        });
        expect(sameCoordinate(state.position)).toEqual(
          sameCoordinate(
            lastPosition === undefined
              ? COLOGNE
              : (lastPosition as ReturnType<typeof actions.positionChanged>)
                  .payload
          )
        );
        expect(state.category).toBe(
          lastCategory === undefined
            ? 'walkable'
            : (lastCategory as ReturnType<typeof actions.categoryChanged>)
                .payload
        );
      })
    );
  });
});
