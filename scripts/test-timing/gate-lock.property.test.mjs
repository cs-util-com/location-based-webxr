// Why this test matters: the example tests pin the branches someone thought
// of. The properties below pin the two things that must hold for EVERY input,
// including the combinations nobody enumerated — and both of them are
// safety properties, where a single missed case is the whole bug.
//
//   1. A nested run never takes or releases the lock. If it could, the first
//      package gate of a cascade would steal the lock from the cascade that
//      spawned it, and releasing it at that gate's exit would leave the
//      remaining ~20 minutes of the run unprotected.
//   2. A live, recent, independently-owned lock is ALWAYS refused. This is the
//      property the guard exists for; anything else is a regression back to
//      the three lost cascades of 2026-08-20.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GATE_ALLOW_CONCURRENT_ENV,
  GATE_RUN_ENV,
  MAX_LOCK_AGE_MS,
  decideGateLock,
} from './gate-lock.mjs';

const arbRecord = fc.record({
  runId: fc.string({ minLength: 1, maxLength: 12 }),
  pid: fc.integer({ min: 1, max: 200_000 }),
  project: fc.string({ maxLength: 20 }),
  startedAt: fc.integer({ min: 0, max: 10_000_000 }),
});

describe('gate lock invariants', () => {
  it('a nested run never acquires or steals', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 20_000_000 }),
        (existing, inheritedRunId, alive, now) => {
          const decision = decideGateLock({
            existing,
            env: { [GATE_RUN_ENV]: inheritedRunId },
            isAlive: () => alive,
            now,
          });
          expect(['reenter', 'refuse']).toContain(decision.action);
        }
      )
    );
  });

  it('a live, recent lock owned by another run is always refused', () => {
    fc.assert(
      fc.property(
        arbRecord,
        fc.integer({ min: 0, max: MAX_LOCK_AGE_MS }),
        (existing, age) => {
          const decision = decideGateLock({
            existing,
            env: {},
            isAlive: () => true,
            now: existing.startedAt + age,
          });
          expect(decision.action).toBe('refuse');
        }
      )
    );
  });

  it('the override always lets the run proceed, but never seizes a live lock', () => {
    // The escape hatch has to be unconditional or it is not an escape hatch —
    // a guard that can wedge the gate with no way past it is a worse failure
    // than the concurrency it prevents.
    //
    // But "proceed" must not mean "take ownership": when a lock exists, the
    // overriding run has to leave it alone, or opting in for yourself disarms
    // the guard for whoever runs next. That is the PR #330 finding, pinned here
    // for every input rather than only the one case the example test covers.
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        fc.boolean(),
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
        (existing, alive, now, inheritedRunId) => {
          const decision = decideGateLock({
            existing,
            env: {
              [GATE_ALLOW_CONCURRENT_ENV]: '1',
              ...(inheritedRunId === undefined
                ? {}
                : { [GATE_RUN_ENV]: inheritedRunId }),
            },
            isAlive: () => alive,
            now,
          });
          // Always allowed to start...
          expect(['acquire', 'override']).toContain(decision.action);
          // ...but ownership is taken ONLY when the tree was free.
          expect(decision.action).toBe(existing === null ? 'acquire' : 'override');
        }
      )
    );
  });

  it('always returns one of the five known actions, with a reason', () => {
    fc.assert(
      fc.property(
        fc.option(arbRecord, { nil: null }),
        fc.dictionary(fc.string({ maxLength: 6 }), fc.string({ maxLength: 6 })),
        fc.boolean(),
        fc.integer({ min: 0, max: 20_000_000 }),
        (existing, env, alive, now) => {
          const decision = decideGateLock({
            existing,
            env,
            isAlive: () => alive,
            now,
          });
          expect(['acquire', 'reenter', 'steal', 'refuse', 'override']).toContain(
            decision.action
          );
          expect(typeof decision.reason).toBe('string');
          expect(decision.reason.length).toBeGreaterThan(0);
        }
      )
    );
  });
});
