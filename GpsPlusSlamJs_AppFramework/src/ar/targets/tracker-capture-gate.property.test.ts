import '../../test-setup.js';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTrackerCaptureGate } from './tracker-capture-gate.js';
import type { NearbyPosition } from './nearby-position.js';
import type { Target, TargetKind } from './nearby-targets.js';

const NOW = 1_800_000_000_000;
const INTERVAL = 125;

const hz = fc.oneof(
  fc.constant(0),
  fc.constant(1),
  fc.constant(8),
  fc.double({ min: 0.1, max: 30, noNaN: true })
);

const tracker = fc.record({
  kind: fc.constantFrom<TargetKind>('qr', 'image', 'object'),
  busy: fc.boolean(),
  force: fc.boolean(),
  hitAgo: fc.option(fc.integer({ min: -5_000, max: 30_000 }), { nil: null }),
  cadence: fc.record({
    inGateHz: hz,
    outsideHz: hz,
    unknownHz: hz,
    burstHz: hz,
    burstMs: fc.integer({ min: 0, max: 20_000 }),
  }),
  targets: fc.array(
    fc.record({
      north: fc.double({ min: -100, max: 100, noNaN: true }),
      east: fc.double({ min: -100, max: 100, noNaN: true }),
      reachM: fc.double({ min: 0, max: 10, noNaN: true }),
    }),
    { maxLength: 8 }
  ),
});

const position = fc.oneof(
  fc.constant<NearbyPosition>({
    fixes: [],
    newestFixAtMs: null,
    arPoses: [],
    live: null,
  }),
  fc
    .record({
      north: fc.double({ min: -100, max: 100, noNaN: true }),
      east: fc.double({ min: -100, max: 100, noNaN: true }),
      accM: fc.double({ min: 0.5, max: 40, noNaN: true }),
    })
    .map(({ north, east, accM }): NearbyPosition => ({
      fixes: [{ t: NOW - 500, north, east, accM }],
      newestFixAtMs: NOW - 500,
      arPoses: [{ t: NOW - 500, pos: [0, 0, 0], device: true }],
      live: { t: NOW, north, east, ar: [0, 0, 0], accM },
    }))
);

describe('createTrackerCaptureGate properties', () => {
  // Why this test matters: the camera asks `wantsFrame` and the app routes
  // the captured frame by `kindsFor`; were they to disagree, a frame would
  // be captured for nobody, or a wanted one never taken.
  it('wantsFrame is true exactly when kindsFor is non-empty', () => {
    fc.assert(
      fc.property(
        fc.array(tracker, { maxLength: 3 }),
        position,
        fc.integer({ min: 0, max: 20_000 }),
        (trackers, pos, offset) => {
          const gate = createTrackerCaptureGate({
            position: () => pos,
            captureIntervalMs: INTERVAL,
          });
          for (const t of trackers) {
            const targets: Target[] = t.targets.map((x, i) => ({
              key: `${t.kind}-${String(i)}`,
              kind: t.kind,
              north: x.north,
              east: x.east,
              accM: 2,
              reachM: x.reachM,
            }));
            gate.register({
              kind: t.kind,
              targets: () => targets,
              cadence: t.cadence,
              isBusy: () => t.busy,
              lastHitAtMs: () => (t.hitAgo === null ? null : NOW - t.hitAgo),
              forceOn: () => t.force,
            });
          }
          const nowMs = NOW + offset;
          const routes = gate.kindsFor(nowMs);
          expect(gate.wantsFrame(nowMs)).toBe(routes.length > 0);
          // A busy tracker never gets a frame; no route exceeds the budget.
          const busyKinds = new Set(
            trackers.filter((t) => t.busy).map((t) => t.kind)
          );
          const freeKinds = new Set(
            trackers.filter((t) => !t.busy).map((t) => t.kind)
          );
          for (const r of routes) {
            expect(busyKinds.has(r.kind) && !freeKinds.has(r.kind)).toBe(false);
            expect(r.targetIds.length).toBeLessThanOrEqual(3);
          }
        }
      )
    );
  });
});
