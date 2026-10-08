// Why this test matters: the example tests pin the cases someone thought of;
// these pin the safety properties of the machine slot for EVERY input, since
// one missed combination is either two sessions on the machine at once (the
// load this slot exists to stop) or a slot that can never be taken again.
//
//   1. A holder with a fresh heartbeat, below the 3 h cap, is NEVER stolen
//      from, whatever its record or the waiter's inherited token.
//   2. A silent holder (no heartbeat past the limit) is ALWAYS reclaimed
//      unless the waiter is part of its run: no pid can keep it (review R1).
//   3. Re-entry happens only on an exact token match with the record on disk.
//   4. A free slot is always acquired.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_LOCK_AGE_MS } from './gate-lock.mjs';
import { HEARTBEAT_STALE_MS, decideMachineSlot } from './machine-slot.mjs';

const arbRecord = fc.record({
  token: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
  pid: fc.integer({ min: 1, max: 200_000 }),
  startedAt: fc.integer({ min: 0, max: 10_000_000 }),
  command: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  cwd: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
});

const arbToken = fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
  nil: undefined,
});

describe('machine slot invariants', () => {
  it('a beating holder below the 3 h cap is never stolen from', () => {
    fc.assert(
      fc.property(
        arbRecord,
        fc.integer({ min: 0, max: HEARTBEAT_STALE_MS }),
        fc.integer({ min: 0, max: MAX_LOCK_AGE_MS }),
        arbToken,
        (existing, silent, age, inheritedToken) => {
          const now = existing.startedAt + age;
          const decision = decideMachineSlot({
            present: true,
            existing,
            heartbeatMs: now - silent,
            inheritedToken,
            now,
          });
          expect(['wait', 'reenter']).toContain(decision.action);
        }
      )
    );
  });

  it('a silent holder is always reclaimed unless the waiter is part of its run', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        fc.integer({ min: HEARTBEAT_STALE_MS + 1, max: 100 * HEARTBEAT_STALE_MS }),
        fc.integer({ min: 0, max: 10_000_000 }),
        arbToken,
        (existing, silent, heartbeatMs, inheritedToken) => {
          const decision = decideMachineSlot({
            present: true,
            existing,
            heartbeatMs,
            inheritedToken,
            now: heartbeatMs + silent,
          });
          const ownRun =
            inheritedToken !== undefined && existing?.token === inheritedToken;
          expect(decision.action).toBe(ownRun ? 'reenter' : 'steal');
        }
      )
    );
  });

  it('re-entry only on an exact token match', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        arbToken,
        fc.option(fc.integer({ min: 0, max: 20_000_000 }), { nil: null }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (existing, inheritedToken, heartbeatMs, now) => {
          const decision = decideMachineSlot({
            present: true,
            existing,
            heartbeatMs,
            inheritedToken,
            now,
          });
          if (decision.action === 'reenter') {
            expect(inheritedToken).toBeDefined();
            expect(existing?.token).toBe(inheritedToken);
          }
        }
      )
    );
  });

  it('a free slot is always acquired, with a reason', () => {
    fc.assert(
      fc.property(arbToken, fc.integer({ min: 0, max: 20_000_000 }), (tok, now) => {
        const decision = decideMachineSlot({
          present: false,
          existing: null,
          heartbeatMs: null,
          inheritedToken: tok,
          now,
        });
        expect(decision.action).toBe('acquire');
        expect(decision.reason.length).toBeGreaterThan(0);
      })
    );
  });
});
