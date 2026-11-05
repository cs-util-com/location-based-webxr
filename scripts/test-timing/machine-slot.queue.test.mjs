// Why this test matters (measured 2026-11-05): the machine slot was a `mkdir`
// race polled by every waiter, with no order. A gate with no browser stage
// that queued at 23:05 was still waiting at 00:46: when the 2.5 h browser run
// that held the slot ended, ANOTHER 2.5 h browser run that had started
// queueing later won the race, and three 10-25 min gates waited behind it.
// Waiters now register a ticket beside the slot and only the first-ranked one
// takes it: runs with no browser stage first, then first come first served,
// with aging so a browser run cannot starve. What must hold is what a queue
// gets wrong: the order, a dead waiter that never blocks the queue, and a
// waiter running an older copy of the script (no ticket) that can never
// cause a deadlock.

import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HEARTBEAT_STALE_MS,
  OWNER_FILE,
  QUEUE_AGING_MS,
  acquireMachineSlot,
  describePlace,
  queueClassOf,
  queueDirOf,
  rankQueue,
  readQueue,
  readSlot,
  removeTicket,
  stealSlot,
  tryCreateSlot,
  writeTicket,
} from './machine-slot.mjs';

const T0 = 1_700_000_000_000;

/** @param {Partial<import('./machine-slot.mjs').SlotRecord>} [over] */
const record = (over = {}) => ({
  token: 'tok-a',
  pid: 4321,
  startedAt: T0,
  command: 'pnpm test',
  cwd: 'C:/gps/wt-a',
  ...over,
});

/** @param {Partial<import('./machine-slot.mjs').QueueTicket>} [over] */
const ticket = (over = {}) => ({
  token: 't',
  pid: 1,
  enqueuedAt: T0,
  queueClass: /** @type {'fast' | 'browser'} */ ('browser'),
  command: 'pnpm test',
  heartbeatMs: T0,
  ...over,
});

const noHeartbeat = () => () => {};

function freshDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'machine-slot-queue-')), 'gate');
}

/** @param {string} dir @param {number} at */
function setHeartbeat(dir, at) {
  utimesSync(path.join(dir, OWNER_FILE), new Date(at), new Date(at));
}

/** A fake clock whose `sleep` advances time. */
function fakeClock(start, onTick = (/** @type {number} */ _t) => {}) {
  let t = start;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => {
      t += ms;
      onTick(t);
    },
  };
}

/**
 * One shared fake clock for several waiters in one process: each sleep
 * yields to the event loop, then advances time, so the waiters interleave.
 */
function sharedClock(start, onTick) {
  let t = start;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => {
      await new Promise((resolve) => setImmediate(resolve));
      t += ms / 2;
      onTick(t);
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('rankQueue', () => {
  it('ranks a run with no browser stage before a younger browser run', () => {
    const ranked = rankQueue(
      [
        ticket({ token: 'b', queueClass: 'browser', enqueuedAt: T0 }),
        ticket({ token: 'f', queueClass: 'fast', enqueuedAt: T0 + 60_000 }),
      ],
      T0 + 120_000
    );
    expect(ranked.map((t) => t.token)).toEqual(['f', 'b']);
  });

  it('ranks first come first served within a class', () => {
    const ranked = rankQueue(
      [
        ticket({ token: 'late', queueClass: 'fast', enqueuedAt: T0 + 2 }),
        ticket({ token: 'early', queueClass: 'fast', enqueuedAt: T0 + 1 }),
      ],
      T0 + 10
    );
    expect(ranked.map((t) => t.token)).toEqual(['early', 'late']);
  });

  it('ranks a browser run that has waited past the aging bound ahead of every run with no browser stage', () => {
    const now = T0 + QUEUE_AGING_MS;
    const at = (browserEnqueuedAt) =>
      rankQueue(
        [
          ticket({ token: 'f', queueClass: 'fast', enqueuedAt: T0 - 1, heartbeatMs: now }),
          ticket({ token: 'b', queueClass: 'browser', enqueuedAt: browserEnqueuedAt, heartbeatMs: now }),
        ],
        now
      ).map((t) => t.token);
    expect(at(T0)).toEqual(['b', 'f']);
    // One millisecond younger, it still waits behind the run with no browser.
    expect(at(T0 + 1)).toEqual(['f', 'b']);
  });

  it('leaves out a ticket whose heartbeat is older than the staleness limit', () => {
    const now = T0 + HEARTBEAT_STALE_MS + 1;
    const ranked = rankQueue(
      [
        ticket({ token: 'dead', queueClass: 'fast', heartbeatMs: T0 }),
        ticket({ token: 'live', heartbeatMs: now }),
      ],
      now
    );
    expect(ranked.map((t) => t.token)).toEqual(['live']);
  });

  it('treats an unknown class as a browser run, the direction that never jumps the queue', () => {
    const ranked = rankQueue(
      [
        ticket({ token: 'odd', queueClass: /** @type {any} */ ('weird'), enqueuedAt: T0 }),
        ticket({ token: 'f', queueClass: 'fast', enqueuedAt: T0 + 5 }),
      ],
      T0 + 10
    );
    expect(ranked.map((t) => t.token)).toEqual(['f', 'odd']);
  });
});

describe('the place in the queue and the class of a run', () => {
  it('names the place in the queue and who is ahead', () => {
    const ranked = rankQueue(
      [
        ticket({ token: 'a', queueClass: 'fast', command: 'test:changed in C:/gps/wt-a' }),
        ticket({ token: 'me', enqueuedAt: T0 + 1 }),
        ticket({ token: 'c', enqueuedAt: T0 + 2 }),
      ],
      T0 + 3
    );
    expect(describePlace(ranked, 'me')).toBe(
      '2nd of 3 in the queue, behind "test:changed in C:/gps/wt-a"'
    );
    expect(describePlace(ranked, 'a')).toBe('1st of 3 in the queue');
    expect(describePlace(ranked, 'gone')).toBe('not in the queue');
  });

  it('classifies a run by whether it starts a browser', () => {
    expect(queueClassOf({ skipBrowser: true, runsBrowser: true })).toBe('fast');
    expect(queueClassOf({ skipBrowser: false, runsBrowser: false })).toBe('fast');
    expect(queueClassOf({ skipBrowser: false, runsBrowser: true })).toBe('browser');
  });
});

describe('tickets on disk', () => {
  it('writes a ticket beside the slot, reads it with its heartbeat, and removes it', () => {
    const dir = freshDir();
    const queue = queueDirOf(dir);
    expect(path.dirname(queue)).toBe(path.dirname(dir));
    writeTicket(queue, ticket({ token: 'w1' }), T0);
    const [read] = readQueue(queue, T0 + 1_000);
    expect(read).toMatchObject({ token: 'w1', queueClass: 'browser', enqueuedAt: T0 });
    expect(Math.abs(read.heartbeatMs - T0)).toBeLessThan(1_000);
    removeTicket(queue, 'w1');
    expect(readQueue(queue, T0 + 1_000)).toEqual([]);
  });

  it('cleans a dead ticket and ignores files that are not tickets', () => {
    const queue = queueDirOf(freshDir());
    writeTicket(queue, ticket({ token: 'dead' }), T0);
    writeFileSync(path.join(queue, 'junk.json'), '{ not json');
    writeFileSync(path.join(queue, 'notes.txt'), 'x');
    expect(readQueue(queue, T0 + HEARTBEAT_STALE_MS + 1)).toEqual([]);
    expect(existsSync(path.join(queue, 'dead.json'))).toBe(false);
  });

  it('reads a missing queue directory as an empty queue', () => {
    expect(readQueue(queueDirOf(freshDir()), T0)).toEqual([]);
  });
});

describe('acquireMachineSlot with a queue', () => {
  /** A beating holder that frees the slot at `freeAt`. */
  function holder(dir, freeAt) {
    tryCreateSlot(dir, record({ token: 'holder' }));
    setHeartbeat(dir, T0);
    let freed = false;
    return (/** @type {number} */ t) => {
      if (freed) return;
      if (t >= freeAt) {
        freed = true;
        stealSlot(dir, readSlot(dir).existing);
      } else {
        setHeartbeat(dir, t);
      }
    };
  }

  const waiter = (dir, clock, command, queueClass, order) =>
    acquireMachineSlot({
      dir,
      env: {},
      command,
      queueClass,
      log: () => {},
      listAncestors: () => [],
      heartbeat: noHeartbeat,
      timeoutMs: 60 * 60_000,
      pollMs: 5_000,
      ...clock,
    }).then((slot) => {
      order.push(command);
      slot.release();
      return slot.outcome;
    });

  it('two waiters in one process: the run with no browser stage gets the slot first, though it queued second', async () => {
    const dir = freshDir();
    /** @type {string[]} */
    const order = [];
    const clock = sharedClock(T0, holder(dir, T0 + 5 * 60_000));
    const browserRun = waiter(dir, clock, 'browser run', 'browser', order);
    await tick();
    const fastRun = waiter(dir, clock, 'fast run', 'fast', order);
    expect(await Promise.all([browserRun, fastRun])).toEqual(['acquired', 'acquired']);
    expect(order).toEqual(['fast run', 'browser run']);
    expect(readQueue(queueDirOf(dir), clock.now())).toEqual([]);
  });

  it('two waiters of one class: the one that queued first gets the slot first', async () => {
    const dir = freshDir();
    /** @type {string[]} */
    const order = [];
    const clock = sharedClock(T0, holder(dir, T0 + 5 * 60_000));
    const first = waiter(dir, clock, 'first', 'browser', order);
    for (let i = 0; i < 3; i++) await tick();
    const second = waiter(dir, clock, 'second', 'browser', order);
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('a newcomer does not take a free slot while a live waiter ranks ahead of it', async () => {
    const dir = freshDir();
    const queue = queueDirOf(dir);
    const ahead = ticket({ token: 'ahead', queueClass: 'fast', enqueuedAt: T0 - 1 });
    let ticks = 0;
    let takenWhileAhead = false;
    const clock = fakeClock(T0, (t) => {
      ticks += 1;
      if (existsSync(dir) && existsSync(path.join(queue, 'ahead.json'))) takenWhileAhead = true;
      if (ticks < 4) writeTicket(queue, ahead, t);
      else removeTicket(queue, 'ahead'); // it gave up after three polls
    });
    writeTicket(queue, ahead, T0);
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'browser run',
      queueClass: 'browser',
      log: () => {},
      heartbeat: noHeartbeat,
      timeoutMs: 60 * 60_000,
      pollMs: 5_000,
      ...clock,
    });
    expect(slot.outcome).toBe('acquired');
    expect(takenWhileAhead).toBe(false);
    expect(ticks).toBeGreaterThanOrEqual(4);
  });

  it('a dead waiter at the head of the queue never blocks it', async () => {
    const dir = freshDir();
    const queue = queueDirOf(dir);
    writeTicket(queue, ticket({ token: 'crashed', queueClass: 'fast', enqueuedAt: T0 - 1 }), T0);
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'browser run',
      queueClass: 'browser',
      log: () => {},
      heartbeat: noHeartbeat,
      timeoutMs: 60 * 60_000,
      ...fakeClock(T0 + HEARTBEAT_STALE_MS + 1),
    });
    expect(slot.outcome).toBe('acquired');
    expect(existsSync(path.join(queue, 'crashed.json'))).toBe(false);
  });

  // Other worktrees run older copies of the script until they merge main:
  // they write no ticket and just race for mkdir. They may win; the new
  // waiter must then simply wait for them, and take the slot after them.
  it('a waiter running an older copy (no ticket) may win the race, and the queue goes on after it', async () => {
    const dir = freshDir();
    let phase = 'held';
    const clock = fakeClock(T0, (t) => {
      if (phase === 'held') {
        if (t >= T0 + 60_000) {
          stealSlot(dir, readSlot(dir).existing);
          tryCreateSlot(dir, record({ token: 'old-copy', startedAt: t, command: 'old copy' }));
          phase = 'old';
        }
        setHeartbeat(dir, t);
      } else if (phase === 'old') {
        if (t >= T0 + 3 * 60_000) {
          stealSlot(dir, readSlot(dir).existing);
          phase = 'free';
        } else {
          setHeartbeat(dir, t);
        }
      }
    });
    tryCreateSlot(dir, record({ token: 'holder' }));
    setHeartbeat(dir, T0);
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'new copy',
      queueClass: 'fast',
      log: () => {},
      listAncestors: () => [],
      heartbeat: noHeartbeat,
      timeoutMs: 60 * 60_000,
      pollMs: 5_000,
      ...clock,
    });
    expect(slot.outcome).toBe('acquired');
    expect(phase).toBe('free');
    expect(readSlot(dir).existing?.command).toBe('new copy');
    expect(readQueue(queueDirOf(dir), clock.now())).toEqual([]);
  });

  it('says its place in the queue on the QUEUED line, and takes its ticket away on a timeout', async () => {
    const dir = freshDir();
    const queue = queueDirOf(dir);
    const ahead = ticket({
      token: 'ahead',
      queueClass: 'fast',
      enqueuedAt: T0 - 1,
      command: 'test:changed in C:/gps/wt-b',
    });
    tryCreateSlot(dir, record({ token: 'holder' }));
    setHeartbeat(dir, T0);
    writeTicket(queue, ahead, T0);
    /** @type {string[]} */
    const lines = [];
    const clock = fakeClock(T0, (t) => {
      setHeartbeat(dir, t);
      writeTicket(queue, ahead, t);
    });
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test in tour',
      queueClass: 'browser',
      log: (line) => lines.push(line),
      listAncestors: () => [],
      heartbeat: noHeartbeat,
      timeoutMs: 60_000,
      pollMs: 5_000,
      ...clock,
    });
    expect(slot.outcome).toBe('timed-out');
    const queued = lines.find((l) => l.includes('QUEUED (not hung)'));
    expect(queued).toContain('2nd of 2 in the queue, behind "test:changed in C:/gps/wt-b"');
    expect(readQueue(queue, clock.now()).map((t) => t.token)).toEqual(['ahead']);
  });

  it('an uncontended run writes no ticket at all', async () => {
    const dir = freshDir();
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      queueClass: 'fast',
      log: () => {},
      heartbeat: noHeartbeat,
      ...fakeClock(T0),
    });
    expect(slot.outcome).toBe('acquired');
    expect(existsSync(queueDirOf(dir))).toBe(false);
    slot.release();
  });
});
