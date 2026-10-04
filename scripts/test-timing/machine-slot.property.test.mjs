// Why this test matters: the example tests pin the cases someone thought of;
// these pin the safety properties of the machine slot for EVERY input, since
// one missed combination is either two sessions on the machine at once (the
// load this slot exists to stop) or a slot that can never be taken again.
//
//   1. A live holder younger than the 3 h cap is NEVER stolen from, whatever
//      its age, record or the waiter's inherited token.
//   2. Nothing is ever stolen inside the one-minute grace.
//   3. Re-entry happens only on an exact token match with the record on disk.
//   4. A free slot is always acquired.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_LOCK_AGE_MS } from './gate-lock.mjs';
import { MIN_STALE_AGE_MS, decideMachineSlot } from './machine-slot.mjs';

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
  it('a live holder below the 3 h cap is never stolen from', () => {
    fc.assert(
      fc.property(
        arbRecord,
        fc.integer({ min: 0, max: MAX_LOCK_AGE_MS }),
        arbToken,
        (existing, age, inheritedToken) => {
          const decision = decideMachineSlot({
            present: true,
            existing,
            dirMtimeMs: existing.startedAt,
            inheritedToken,
            isAlive: () => true,
            now: existing.startedAt + age,
          });
          expect(decision.action).not.toBe('steal');
          expect(decision.action).not.toBe('acquire');
        }
      )
    );
  });

  it('nothing is stolen inside the one-minute grace, dead holder or not', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        fc.integer({ min: 0, max: MIN_STALE_AGE_MS - 1 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 10_000_000 }),
        (existing, age, alive, t0) => {
          const startedAt = existing?.startedAt ?? t0;
          const decision = decideMachineSlot({
            present: true,
            existing,
            dirMtimeMs: startedAt,
            inheritedToken: undefined,
            isAlive: () => alive,
            now: startedAt + age,
          });
          expect(decision.action).not.toBe('steal');
        }
      )
    );
  });

  it('re-entry only on an exact token match', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        arbToken,
        fc.boolean(),
        fc.integer({ min: 0, max: 20_000_000 }),
        (existing, inheritedToken, alive, now) => {
          const decision = decideMachineSlot({
            present: true,
            existing,
            dirMtimeMs: 0,
            inheritedToken,
            isAlive: () => alive,
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
          dirMtimeMs: null,
          inheritedToken: tok,
          isAlive: () => true,
          now,
        });
        expect(decision.action).toBe('acquire');
        expect(decision.reason.length).toBeGreaterThan(0);
      })
    );
  });
});
