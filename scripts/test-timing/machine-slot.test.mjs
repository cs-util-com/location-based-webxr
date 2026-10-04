// Why this test matters: on the night of 2026-10-03/04 two sessions' gates,
// sweeps and 3D browser suites overlapped on one 8-CPU machine; a file that
// takes 32 s quiet took 308 s, and stages that take seconds timed out after
// 30 minutes in files nobody had touched. Each session's own lock serialised
// only its own agents. The machine slot is ONE queue for every session, so
// what must hold here is exactly what a shared queue gets wrong:
//
//   - a live holder is waited for, never stolen from;
//   - a dead holder is reclaimed, but only after the one-minute grace (its
//     record may be mid-write, or the holder a shell script that has not
//     recorded its pid yet);
//   - two waiters that both see the same stale lock cannot both end up
//     owning the slot (the steal race);
//   - a run nested inside the holder (the cascade's package gates, a stage
//     that calls `pnpm run`) re-enters instead of queueing behind its own
//     parent, which would deadlock;
//   - a queued run SAYS it is queued and names the holder, so a wait is never
//     mistaken for a hang (the peer session's request for its browser runs).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MIN_STALE_AGE_MS,
  OWNER_FILE,
  SLOT_HELD_ENV,
  SLOT_OPT_IN_ENV,
  acquireMachineSlot,
  ancestorPids,
  decideMachineSlot,
  readSlot,
  resolveSlotDir,
  stageRunTakesSlot,
  stealSlot,
  tryCreateSlot,
} from './machine-slot.mjs';

const alive = () => true;
const dead = () => false;

/** @param {Partial<import('./machine-slot.mjs').SlotRecord>} [over] */
const record = (over = {}) => ({
  token: 'tok-a',
  pid: 4321,
  startedAt: 1_000_000,
  command: 'pnpm test',
  cwd: 'C:/gps/wt-a',
  ...over,
});

function freshDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'machine-slot-')), 'gate');
}

describe('decideMachineSlot', () => {
  it('acquires a free slot', () => {
    expect(
      decideMachineSlot({
        present: false,
        existing: null,
        dirMtimeMs: null,
        inheritedToken: undefined,
        isAlive: alive,
        now: 5,
      }).action
    ).toBe('acquire');
  });

  it('waits behind a live holder', () => {
    const decision = decideMachineSlot({
      present: true,
      existing: record(),
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: alive,
      now: 1_000_000 + 10 * 60_000,
    });
    expect(decision.action).toBe('wait');
  });

  it('re-enters when the holder is its own ancestor', () => {
    const decision = decideMachineSlot({
      present: true,
      existing: record({ token: 'tok-parent' }),
      dirMtimeMs: 1_000_000,
      inheritedToken: 'tok-parent',
      isAlive: alive,
      now: 1_000_000,
    });
    expect(decision.action).toBe('reenter');
  });

  it('does not re-enter on a token that names someone else', () => {
    // An inherited token that does not match the holder means the ancestor no
    // longer holds the slot (its lock was reclaimed). Re-entering would put
    // two sessions on the machine at once.
    const decision = decideMachineSlot({
      present: true,
      existing: record({ token: 'tok-other' }),
      dirMtimeMs: 1_000_000,
      inheritedToken: 'tok-parent',
      isAlive: alive,
      now: 1_000_000,
    });
    expect(decision.action).toBe('wait');
  });

  it('steals from a dead holder once the lock is older than a minute', () => {
    const decision = decideMachineSlot({
      present: true,
      existing: record(),
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: dead,
      now: 1_000_000 + MIN_STALE_AGE_MS + 1,
    });
    expect(decision.action).toBe('steal');
    expect(decision.reason).toContain('4321');
  });

  it('waits on a dead holder inside the one-minute grace', () => {
    const decision = decideMachineSlot({
      present: true,
      existing: record(),
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: dead,
      now: 1_000_000 + MIN_STALE_AGE_MS - 1,
    });
    expect(decision.action).toBe('wait');
  });

  it('steals a lock past the 3 h cap even when the pid looks alive (pid reuse)', () => {
    const decision = decideMachineSlot({
      present: true,
      existing: record(),
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: alive,
      now: 1_000_000 + 3 * 60 * 60 * 1000 + 1,
    });
    expect(decision.action).toBe('steal');
  });

  it('ages an unreadable record by the directory, so a mid-write holder is not stolen from', () => {
    const young = decideMachineSlot({
      present: true,
      existing: null,
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: alive,
      now: 1_000_000 + 2_000,
    });
    expect(young.action).toBe('wait');
    const old = decideMachineSlot({
      present: true,
      existing: null,
      dirMtimeMs: 1_000_000,
      inheritedToken: undefined,
      isAlive: alive,
      now: 1_000_000 + MIN_STALE_AGE_MS + 1,
    });
    expect(old.action).toBe('steal');
  });
});

describe('resolveSlotDir', () => {
  it('uses the override when set', () => {
    expect(resolveSlotDir({ GATE_SLOT_DIR: 'X:/slots/gate' }, () => false)).toBe(
      'X:/slots/gate'
    );
  });

  it('is off where the machine convention does not exist (CI runners)', () => {
    expect(resolveSlotDir({}, () => false)).toBeNull();
  });

  it('is the shared machine dir where its parent exists', () => {
    expect(resolveSlotDir({}, () => true)).toMatch(/\.e2e-slots[\\/]gate$/);
  });

  it('can be switched off, by name', () => {
    expect(resolveSlotDir({ GATE_SLOT_DIR: 'off' }, () => true)).toBeNull();
  });
});

describe('the slot on disk', () => {
  it('creates the slot exactly once (mkdir is the arbiter)', () => {
    const dir = freshDir();
    expect(tryCreateSlot(dir, record({ token: 'a' }))).toBe(true);
    expect(tryCreateSlot(dir, record({ token: 'b' }))).toBe(false);
    expect(readSlot(dir).existing?.token).toBe('a');
  });

  it('records pid, start time, command and cwd for the queue line', () => {
    const dir = freshDir();
    tryCreateSlot(dir, record());
    const onDisk = JSON.parse(readFileSync(path.join(dir, OWNER_FILE), 'utf8'));
    expect(onDisk).toMatchObject({
      pid: 4321,
      startedAt: 1_000_000,
      command: 'pnpm test',
    });
  });

  it('reads a hand-written shell record without a token', () => {
    // The peer's shell scripts may write the record themselves; `token` is
    // then absent and such a holder simply never matches a re-entry.
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, OWNER_FILE),
      JSON.stringify({ pid: 99, startedAt: 7 })
    );
    expect(readSlot(dir).existing).toMatchObject({ pid: 99, startedAt: 7 });
  });
});

describe('the steal race', () => {
  it('two waiters that saw the same stale lock: exactly one owns the slot afterwards', () => {
    const dir = freshDir();
    const stale = record({ token: 'dead', pid: 1 });
    tryCreateSlot(dir, stale);

    // Both waiters read the SAME stale record...
    const seenByA = readSlot(dir).existing;
    const seenByB = readSlot(dir).existing;

    // ...A steals and acquires first...
    expect(stealSlot(dir, seenByA)).toBe('stolen');
    expect(tryCreateSlot(dir, record({ token: 'A', pid: 2 }))).toBe(true);

    // ...then B's steal, judged on the old view, moves A's FRESH lock. It must
    // notice and put it back, never delete it.
    expect(stealSlot(dir, seenByB)).toBe('restored');
    expect(readSlot(dir).existing?.token).toBe('A');
    expect(tryCreateSlot(dir, record({ token: 'B', pid: 3 }))).toBe(false);
  });

  it('a second stealer that finds the lock already gone just competes for mkdir', () => {
    const dir = freshDir();
    const stale = record({ token: 'dead', pid: 1 });
    tryCreateSlot(dir, stale);
    expect(stealSlot(dir, stale)).toBe('stolen');
    expect(stealSlot(dir, stale)).toBe('lost');
    expect(tryCreateSlot(dir, record({ token: 'A' }))).toBe(true);
    expect(tryCreateSlot(dir, record({ token: 'B' }))).toBe(false);
  });

  it('leaves no renamed leftovers behind after a steal', () => {
    const dir = freshDir();
    const stale = record({ token: 'dead', pid: 1 });
    tryCreateSlot(dir, stale);
    stealSlot(dir, stale);
    expect(readdirSync(path.dirname(dir))).toEqual([]);
  });
});

/**
 * A fake clock whose `sleep` advances time, so the queue runs in microseconds.
 * @param {number} start
 * @param {(t: number) => void} [onTick]
 */
function fakeClock(start, onTick = () => {}) {
  let t = start;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => {
      t += ms;
      onTick(t);
    },
  };
}

describe('acquireMachineSlot', () => {
  it('takes a free slot, exports the token to children, and releases it', async () => {
    const dir = freshDir();
    const env = /** @type {Record<string, string | undefined>} */ ({});
    const slot = await acquireMachineSlot({
      dir,
      env,
      command: 'pnpm test',
      log: () => {},
      ...fakeClock(1_000),
    });
    expect(slot.outcome).toBe('acquired');
    expect(existsSync(dir)).toBe(true);
    expect(env[SLOT_HELD_ENV]).toBe(readSlot(dir).existing?.token);
    slot.release();
    expect(existsSync(dir)).toBe(false);
  });

  it('a nested run re-enters and its release touches nothing', async () => {
    const dir = freshDir();
    const env = /** @type {Record<string, string | undefined>} */ ({});
    const outer = await acquireMachineSlot({
      dir,
      env,
      command: 'pnpm test',
      log: () => {},
      ...fakeClock(1_000),
    });
    const inner = await acquireMachineSlot({
      dir,
      env: { ...env },
      command: 'pnpm --filter x test',
      log: () => {},
      ...fakeClock(1_000),
    });
    expect(inner.outcome).toBe('reentered');
    inner.release();
    expect(existsSync(dir)).toBe(true);
    outer.release();
    expect(existsSync(dir)).toBe(false);
  });

  it('queues behind a live holder, names it, and takes the slot when it is freed', async () => {
    const dir = freshDir();
    tryCreateSlot(
      dir,
      record({ token: 'peer', pid: 777, startedAt: 0, command: 'pnpm run test:e2e' })
    );
    /** @type {string[]} */
    const lines = [];
    const clock = fakeClock(60_000, (t) => {
      if (t >= 60_000 + 7 * 60_000) {
        // The holder finishes after seven minutes.
        stealSlot(dir, readSlot(dir).existing);
      }
    });
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'test:unit in GpsPlusSlamJs_AppFramework',
      log: (line) => lines.push(line),
      isAlive: alive,
      listAncestors: () => [1, 2],
      timeoutMs: 60 * 60_000,
      pollMs: 5_000,
      ...clock,
    });
    expect(slot.outcome).toBe('acquired');
    const text = lines.join('\n');
    expect(text).toMatch(/QUEUED/);
    expect(text).toContain('pid 777');
    expect(text).toContain('pnpm run test:e2e');
    expect(text).toContain('test:unit in GpsPlusSlamJs_AppFramework');
    // A periodic reminder, not one line per poll: seven minutes of 5 s polls
    // would otherwise be 84 lines.
    expect(lines.length).toBeLessThan(10);
    expect(text).toMatch(/still queued/);
  });

  it('gives up after its timeout, naming the holder, and never takes the slot', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'peer', pid: 777, startedAt: 0 }));
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      isAlive: alive,
      listAncestors: () => [],
      timeoutMs: 10 * 60_000,
      pollMs: 5_000,
      ...fakeClock(0),
    });
    expect(slot.outcome).toBe('timed-out');
    expect(lines.join('\n')).toMatch(/gave up after 10 min/);
    expect(readSlot(dir).existing?.token).toBe('peer');
  });

  it('reclaims a dead holder after the grace and says so', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'gone', pid: 5, startedAt: 0 }));
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      isAlive: dead,
      ...fakeClock(MIN_STALE_AGE_MS + 1),
    });
    expect(slot.outcome).toBe('acquired');
    expect(lines.join('\n')).toMatch(/reclaim/i);
  });

  // The coordinator's and the peer's concern: a shell script that creates the
  // slot itself and then runs a node gate would make that gate queue behind
  // its own parent for the whole 2 h timeout. It must fail at once, saying why.
  it('refuses at once, naming the cause, when the holder is its own ancestor', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, { pid: 4242, startedAt: 0 });
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      isAlive: alive,
      listAncestors: () => [100, 4242, 1],
      ...fakeClock(1_000),
    });
    expect(slot.outcome).toBe('held-by-ancestor');
    const text = lines.join('\n');
    expect(text).toMatch(/ANCESTOR/);
    expect(text).toContain('GATE_MACHINE_SLOT_TOKEN');
    expect(readSlot(dir).existing?.pid).toBe(4242);
  });

  it('lists the real parent among its ancestors', () => {
    // The probe the rule above depends on, run for real: an injected list
    // cannot show that the process listing is parsed correctly.
    expect(ancestorPids()).toContain(process.ppid);
  }, 30_000);

  it('is a no-op where no slot directory is configured', async () => {
    const slot = await acquireMachineSlot({
      dir: null,
      env: {},
      command: 'pnpm test',
      log: () => {},
      ...fakeClock(0),
    });
    expect(slot.outcome).toBe('off');
    slot.release();
  });

  it('release never removes a slot that someone else now holds', async () => {
    const dir = freshDir();
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: () => {},
      ...fakeClock(0),
    });
    // Our lock was reclaimed (e.g. past the 3 h cap) and someone else took it.
    stealSlot(dir, readSlot(dir).existing);
    tryCreateSlot(dir, record({ token: 'next' }));
    slot.release();
    expect(readSlot(dir).existing?.token).toBe('next');
  });

  // A fixed instant, not the machine clock: the repo's wall-clock guard
  // (tests/repo-config/wall-clock-assertions.test.js) keeps verdicts off
  // `Date.now()` arithmetic, and the claim needs no clock.
  it('ages a record-less slot by its directory mtime', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    const set = 1_700_000_000_000;
    utimesSync(dir, new Date(set), new Date(set));
    const seen = readSlot(dir);
    expect(seen.existing).toBeNull();
    expect(Math.abs(/** @type {number} */ (seen.dirMtimeMs) - set)).toBeLessThan(
      1_000
    );
    expect(
      decideMachineSlot({
        ...seen,
        inheritedToken: undefined,
        isAlive: alive,
        now: set + 2 * MIN_STALE_AGE_MS,
      }).action
    ).toBe('steal');
  });
});

// Why this test matters (the peer session's change, 2026-10-04): a TDD step of
// 1-5 s must not queue behind a browser run that holds the slot for minutes,
// so a FILTERED unit-test stage run does not take the slot. But this
// session's measurement sweeps also run as `pnpm run test:unit <file>`, for
// 10-25 min, and those must queue like any heavy run: `GATE_SLOT=take` opts
// them back in. Both directions are pinned, plus the cases the exemption
// must NOT reach (a filtered browser run, a full unit stage).
describe('stageRunTakesSlot', () => {
  const unit = { name: 'test:unit', command: 'vitest run', counts: 'vitest' };
  const e2e = {
    name: 'test:e2e',
    command: 'playwright test --config playwright-tests/playwright.config.js',
    counts: 'playwright',
  };

  it('a filtered unit run does not take the slot', () => {
    const decision = stageRunTakesSlot({
      stage: unit,
      forwardedArgs: ['src/x.test.ts'],
      env: {},
    });
    expect(decision.take).toBe(false);
    expect(decision.reason).toContain('GATE_SLOT=take');
  });

  it('a filtered unit run with GATE_SLOT=take does take it (long sweeps)', () => {
    expect(
      stageRunTakesSlot({
        stage: unit,
        forwardedArgs: ['src/sweep.test.ts'],
        env: { [SLOT_OPT_IN_ENV]: 'take' },
      }).take
    ).toBe(true);
  });

  it('a pnpm-style leading "--" alone does not make a run filtered', () => {
    expect(
      stageRunTakesSlot({ stage: unit, forwardedArgs: ['--'], env: {} }).take
    ).toBe(true);
  });

  it('a filtered browser run still takes it: it starts Chromium', () => {
    expect(
      stageRunTakesSlot({
        stage: e2e,
        forwardedArgs: ['playwright-tests/boot.spec.js'],
        env: {},
      }).take
    ).toBe(true);
  });

  it('a full unit stage run takes it', () => {
    expect(stageRunTakesSlot({ stage: unit, forwardedArgs: [], env: {} }).take).toBe(
      true
    );
  });

  it('an unknown stage takes it (the safe direction)', () => {
    expect(
      stageRunTakesSlot({ stage: undefined, forwardedArgs: ['x'], env: {} }).take
    ).toBe(true);
  });
});
