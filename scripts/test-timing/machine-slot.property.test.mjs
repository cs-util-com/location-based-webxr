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
import {
  HEARTBEAT_STALE_MS,
  QUEUE_AGING_MS,
  decideMachineSlot,
  rankQueue,
} from './machine-slot.mjs';

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

// Why these matter (the fair queue, 2026-11-05): the ranking decides who gets
// the machine next, so a mistake is either two waiters both believing they are
// first (both mkdir: the old race again), a dead waiter blocking everyone for
// good, or a browser run starved by a steady stream of short gates.
//
//   5. The ranking is a total order: unique tokens, the same result for any
//      input order, so exactly one waiter is first.
//   6. Dead tickets (no heartbeat past the limit) never rank.
//   7. A run with no browser stage always beats a browser run younger than
//      the aging bound.
//   8. Aging bounds every browser wait: in a simulated single slot fed a
//      finite stream of arrivals, a browser run starts at most one hold after
//      it ages, plus one hold per older browser run.
describe('fair queue invariants', () => {
  const MIN = 60_000;
  const arbTicket = fc.record({
    token: fc.string({ minLength: 1, maxLength: 6 }),
    pid: fc.integer({ min: 1, max: 99 }),
    enqueuedAt: fc.integer({ min: 0, max: 600 * MIN }),
    queueClass: fc.constantFrom('fast', 'browser'),
    command: fc.constant('x'),
    silent: fc.integer({ min: 0, max: 2 * HEARTBEAT_STALE_MS }),
  });
  const NOW = 700 * MIN;
  /** @param {{ silent: number }} t */
  const withHeartbeat = ({ silent, ...t }) => ({ ...t, heartbeatMs: NOW - silent });
  const arbQueue = fc.uniqueArray(arbTicket, { selector: (t) => t.token, maxLength: 12 });

  it('is a total order: one first-ranked ticket, whatever the input order', () => {
    fc.assert(
      fc.property(arbQueue, fc.integer(), (raw, seed) => {
        const tickets = raw.map(withHeartbeat);
        const ranked = rankQueue(tickets, NOW).map((t) => t.token);
        expect(new Set(ranked).size).toBe(ranked.length);
        const shuffled = [...tickets].sort(
          (a, b) => ((a.token.charCodeAt(0) * seed) % 7) - ((b.token.charCodeAt(0) * seed) % 7)
        );
        expect(rankQueue(shuffled, NOW).map((t) => t.token)).toEqual(ranked);
      })
    );
  });

  it('never ranks a dead ticket, and ranks every live one', () => {
    fc.assert(
      fc.property(arbQueue, (raw) => {
        const tickets = raw.map(withHeartbeat);
        const ranked = new Set(rankQueue(tickets, NOW).map((t) => t.token));
        for (const t of tickets) {
          expect(ranked.has(t.token)).toBe(NOW - t.heartbeatMs <= HEARTBEAT_STALE_MS);
        }
      })
    );
  });

  it('a run with no browser stage beats every browser run younger than the aging bound', () => {
    fc.assert(
      fc.property(arbQueue, (raw) => {
        const ranked = rankQueue(raw.map(withHeartbeat), NOW);
        ranked.forEach((t, i) => {
          if (t.queueClass !== 'fast') return;
          for (const later of ranked.slice(0, i)) {
            if (later.queueClass === 'browser') {
              expect(NOW - later.enqueuedAt).toBeGreaterThanOrEqual(QUEUE_AGING_MS);
            }
          }
        });
      })
    );
  });

  it('aging bounds every browser wait, whatever the stream of runs with no browser stage', () => {
    const arbArrivals = fc.uniqueArray(
      fc.record({
        token: fc.string({ minLength: 1, maxLength: 6 }),
        at: fc.integer({ min: 0, max: 600 * MIN }),
        queueClass: fc.constantFrom('fast', 'browser'),
        hold: fc.integer({ min: 1, max: 150 * MIN }),
      }),
      { selector: (a) => a.token, minLength: 1, maxLength: 25 }
    );
    fc.assert(
      fc.property(arbArrivals, (arrivals) => {
        const maxHold = Math.max(...arrivals.map((a) => a.hold));
        /** @type {Map<string, number>} */
        const started = new Map();
        let free = 0;
        const waiting = [...arrivals];
        while (waiting.length > 0) {
          const now = Math.max(free, Math.min(...waiting.map((a) => a.at)));
          const present = waiting
            .filter((a) => a.at <= now)
            .map((a) => ({ token: a.token, pid: 1, enqueuedAt: a.at, queueClass: a.queueClass, command: 'x', heartbeatMs: now }));
          const first = rankQueue(present, now)[0];
          const run = waiting.splice(waiting.findIndex((a) => a.token === first.token), 1)[0];
          started.set(run.token, now);
          free = now + run.hold;
        }
        for (const b of arrivals.filter((a) => a.queueClass === 'browser')) {
          const older = arrivals.filter(
            (a) =>
              a.queueClass === 'browser' &&
              a !== b &&
              (a.at < b.at || (a.at === b.at && a.token < b.token))
          ).length;
          expect(started.get(b.token)).toBeLessThanOrEqual(
            b.at + QUEUE_AGING_MS + maxHold * (1 + older)
          );
        }
      })
    );
  });
});
