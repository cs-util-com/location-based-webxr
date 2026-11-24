/**
 * Property tests for the phase-marker tap flow.
 *
 * Why these tests matter: the offline analysis splits a test-protocol
 * recording into phases by marker number, so two properties have to hold for
 * EVERY tap sequence, not just the ones a hand-written test thinks of:
 * - the numbers a recording carries are 1, 2, 3, ... strictly increasing,
 *   however taps interleave with the stop window, with taps outside a
 *   recording and with double taps (all refused, never numbered);
 * - what the store holds survives the session round trip: the persisted
 *   actions, serialised the way the zip stores them and replayed into a fresh
 *   store, rebuild exactly the same markers.
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createRecorderStore } from '../state/recorder-store';
import type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  startSession,
  endSession,
} from 'gps-plus-slam-app-framework/state/recording-slice';
import { selectPhaseMarkers } from '../state/phase-markers-slice';
import { createPhaseMarkerHandler } from './phase-marker-handler';

vi.mock('../ui/toast', () => ({
  showToast: vi.fn(),
  isAlertToastShowing: vi.fn(() => false),
}));
vi.mock('../ui/hud', () => ({ setPhaseMarkButtonLabel: vi.fn() }));

/** In-memory backend: keeps every persisted action in write order. */
function capturingBackend(): StorageBackend & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    createSession: () => Promise.resolve({ sessionName: 'prop' }),
    listSessions: () => Promise.resolve([]),
    writeAction: (action: unknown) => {
      written.push(action);
      return Promise.resolve();
    },
    writeFrame: () => Promise.resolve(),
    writeSessionMetadata: () => Promise.resolve(),
  };
}

type Step = 'tap' | 'stopWindow' | 'tapOutside';

/** The model: a tap in a running recording, 500 ms or more after the last accepted one. */
function tapCounts(
  step: Step,
  clock: number,
  lastAcceptedAt: number | null
): boolean {
  if (step !== 'tap') return false;
  return lastAcceptedAt === null || clock - lastAcceptedAt >= 500;
}

describe('phase-marker handler properties', () => {
  // The gaps straddle the 500 ms double-tap guard, so the property also pins
  // that a tap counts exactly when it is at least 500 ms after the last
  // accepted one.
  it('numbers every accepted tap 1..n, strictly increasing, and the markers survive a round trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            step: fc.constantFrom<Step>('tap', 'stopWindow', 'tapOutside'),
            gapMs: fc.integer({ min: 0, max: 1500 }),
          }),
          { maxLength: 30 }
        ),
        fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
        async (steps, t0) => {
          const backend = capturingBackend();
          const store = createRecorderStore({ storageBackend: backend });
          let stopping = false;
          let recording = false;
          let clock = t0;
          const handler = createPhaseMarkerHandler({
            getStore: () => store,
            isStopInProgress: () => stopping,
            now: () => clock,
          });

          let accepted = 0;
          let lastAcceptedAt: number | null = null;
          const returned: Array<number | null> = [];
          const expected: Array<number | null> = [];
          for (const { step, gapMs } of steps) {
            clock += gapMs;
            if (step === 'tapOutside') {
              if (recording) {
                store.dispatch(endSession());
                recording = false;
              }
            } else if (!recording) {
              store.dispatch(
                startSession({
                  contextTag: 'prop',
                  sessionName: 'prop',
                  startTime: clock,
                })
              );
              recording = true;
            }
            stopping = step === 'stopWindow';
            returned.push(handler.markPhase());
            stopping = false;
            const counts = tapCounts(step, clock, lastAcceptedAt);
            if (counts) {
              accepted += 1;
              lastAcceptedAt = clock;
            }
            expected.push(counts ? accepted : null);
          }
          expect(returned).toEqual(expected);
          await store.flushPendingActionWrites();

          const markers = selectPhaseMarkers(store.getState());
          expect(markers.map((m) => m.number)).toEqual(
            Array.from({ length: accepted }, (_, i) => i + 1)
          );
          for (let i = 1; i < markers.length; i++) {
            expect(markers[i]!.timestamp).toBeGreaterThan(
              markers[i - 1]!.timestamp
            );
          }

          // The session round trip: JSON as the zip stores each action,
          // replayed into a fresh store.
          const replay = createRecorderStore({
            storageBackend: new NullStorageBackend(),
          });
          for (const action of backend.written) {
            replay.dispatch(JSON.parse(JSON.stringify(action)));
          }
          expect(selectPhaseMarkers(replay.getState())).toEqual(markers);
        }
      ),
      { numRuns: 40 }
    );
  });
});
