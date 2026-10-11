// Why this test matters: on the night of 2026-10-03/04 two sessions' gates,
// sweeps and 3D browser suites overlapped on one 8-CPU machine; a file that
// takes 32 s quiet took 308 s, and stages that take seconds timed out after
// 30 minutes in files nobody had touched. Each session's own lock serialised
// only its own agents. The machine slot is ONE queue for every session, so
// what must hold here is exactly what a shared queue gets wrong:
//
//   - a holder with a fresh heartbeat is waited for, never stolen from;
//   - a holder whose heartbeat stopped is reclaimed, WHATEVER its pid says
//     (milestone review R1: Windows reuses pids, so a dead-pid check could
//     keep a killed gate's slot until the 3 h cap);
//   - two waiters that both see the same stale lock cannot both end up
//     owning the slot (the steal race), and a lost steal never spins (R2);
//   - a run nested inside the holder re-enters instead of queueing behind its
//     own parent, which would deadlock;
//   - a queued run SAYS it is queued and names the holder, and a queue
//     timeout says it is not a test failure and exits 75, not 1 (R3).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  HEARTBEAT_STALE_MS,
  OWNER_FILE,
  QUEUE_TIMEOUT_EXIT,
  SLOT_HELD_ENV,
  SLOT_OPT_IN_ENV,
  acquireMachineSlot,
  ancestorChain,
  ancestorPids,
  decideMachineSlot,
  holdMachineSlotForProcess,
  parseProcessTable,
  quoteForShell,
  readSlot,
  resolveSlotDir,
  shellLine,
  stageRunTakesSlot,
  startHeartbeat,
  stealSlot,
  tryCreateSlot,
} from './machine-slot.mjs';

const MODULE = fileURLToPath(new URL('./machine-slot.mjs', import.meta.url));

/** @param {Partial<import('./machine-slot.mjs').SlotRecord>} [over] */
const record = (over = {}) => ({
  token: 'tok-a',
  pid: 4321,
  startedAt: 1_000_000,
  command: 'pnpm test',
  cwd: 'C:/gps/wt-a',
  ...over,
});

const noHeartbeat = () => () => {};

function freshDir() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'machine-slot-')), 'gate');
}

/** Sets the heartbeat (owner.json mtime) of a slot to a fixed instant. */
function setHeartbeat(dir, at) {
  utimesSync(path.join(dir, OWNER_FILE), new Date(at), new Date(at));
}

const T0 = 1_700_000_000_000;

describe('decideMachineSlot', () => {
  const decide = (over) =>
    decideMachineSlot({
      present: true,
      existing: record({ startedAt: T0 }),
      heartbeatMs: T0,
      inheritedToken: undefined,
      now: T0 + 60_000,
      ...over,
    });

  it('acquires a free slot', () => {
    expect(decide({ present: false, existing: null, heartbeatMs: null }).action).toBe(
      'acquire'
    );
  });

  it('waits behind a holder whose heartbeat is fresh', () => {
    expect(decide({ now: T0 + HEARTBEAT_STALE_MS }).action).toBe('wait');
  });

  it('steals once the heartbeat is older than the staleness limit', () => {
    const decision = decide({ now: T0 + HEARTBEAT_STALE_MS + 1 });
    expect(decision.action).toBe('steal');
    expect(decision.reason).toMatch(/no heartbeat/);
  });

  // R1: there is no pid input at all. A reused pid that happens to be alive
  // cannot keep a silent slot, and a dead pid with a fresh heartbeat (a
  // holder that recorded the wrong pid) is not stolen.
  it('decides on the heartbeat alone, never on the pid', () => {
    for (const pid of [1, 4321, 999_999]) {
      expect(
        decide({ existing: record({ pid, startedAt: T0 }), now: T0 + HEARTBEAT_STALE_MS + 1 })
          .action
      ).toBe('steal');
      expect(decide({ existing: record({ pid, startedAt: T0 }) }).action).toBe('wait');
    }
  });

  it('steals a record past the 3 h cap even with a fresh heartbeat (a wedged holder)', () => {
    const now = T0 + 3 * 60 * 60 * 1000 + 1;
    expect(decide({ heartbeatMs: now, now }).action).toBe('steal');
  });

  it('re-enters when the holder is its own ancestor run', () => {
    expect(
      decide({
        existing: record({ token: 'tok-parent', startedAt: T0 }),
        inheritedToken: 'tok-parent',
      }).action
    ).toBe('reenter');
  });

  it('does not re-enter on a token that names someone else', () => {
    // A fresh, beating holder (startedAt T0, well inside the 3 h cap).
    expect(
      decide({
        existing: record({ token: 'tok-other', startedAt: T0 }),
        inheritedToken: 'tok-parent',
      }).action
    ).toBe('wait');
  });

  it('ages a record-less slot by its heartbeat, so a holder mid-write is not stolen from', () => {
    expect(decide({ existing: null, now: T0 + 2_000 }).action).toBe('wait');
    expect(decide({ existing: null, now: T0 + HEARTBEAT_STALE_MS + 1 }).action).toBe(
      'steal'
    );
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
    expect(onDisk).toMatchObject({ pid: 4321, startedAt: 1_000_000, command: 'pnpm test' });
  });

  it("reads the heartbeat from owner.json's mtime", () => {
    const dir = freshDir();
    tryCreateSlot(dir, record());
    setHeartbeat(dir, T0);
    expect(Math.abs(/** @type {number} */ (readSlot(dir).heartbeatMs) - T0)).toBeLessThan(
      1_000
    );
  });

  it("falls back to the directory's mtime when there is no record", () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    utimesSync(dir, new Date(T0), new Date(T0));
    const seen = readSlot(dir);
    expect(seen.existing).toBeNull();
    expect(Math.abs(/** @type {number} */ (seen.heartbeatMs) - T0)).toBeLessThan(1_000);
  });

  // R4: a bare `mkdir` or a hand-written shell record does not beat, so it is
  // reclaimed after the staleness limit. The documented way for a shell job
  // is the CLI, tested below.
  it('reclaims a hand-written shell record once it has gone silent', () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid: 99, startedAt: T0 }));
    setHeartbeat(dir, T0);
    expect(
      decideMachineSlot({
        ...readSlot(dir),
        inheritedToken: undefined,
        now: T0 + HEARTBEAT_STALE_MS + 1,
      }).action
    ).toBe('steal');
  });
});

describe('the heartbeat', () => {
  // Real worker, real file: the claim is that a holder's owner.json keeps
  // getting touched. A fixed old instant is set, and the test waits until
  // the mtime moves past it; no clock arithmetic.
  it('touches owner.json from a worker thread until stopped', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record());
    setHeartbeat(dir, T0);
    const stop = startHeartbeat(path.join(dir, OWNER_FILE), 20);
    try {
      await vi.waitFor(
        () => expect(statSync(path.join(dir, OWNER_FILE)).mtimeMs).toBeGreaterThan(T0 + 1_000),
        { timeout: 4_000, interval: 20 }
      );
    } finally {
      stop();
    }
  });

  // The reason it is a WORKER: `test-changed.mjs` holds the slot through
  // `spawnSync`, which blocks the main thread for the whole run. A
  // main-thread timer would never fire and the slot would be stolen.
  it('keeps beating while the main thread is blocked', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record());
    setHeartbeat(dir, T0);
    const stop = startHeartbeat(path.join(dir, OWNER_FILE), 20);
    try {
      // Wait for the worker's first touch (it may start slowly under load),
      // then rewind the heartbeat and block the main thread.
      await vi.waitFor(
        () => expect(statSync(path.join(dir, OWNER_FILE)).mtimeMs).toBeGreaterThan(T0 + 1_000),
        { timeout: 4_000, interval: 20 }
      );
      setHeartbeat(dir, T0);
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 400)']);
      expect(statSync(path.join(dir, OWNER_FILE)).mtimeMs).toBeGreaterThan(T0 + 1_000);
    } finally {
      stop();
    }
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
  let sleeps = 0;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => {
      sleeps += 1;
      t += ms;
      onTick(t);
    },
    sleeps: () => sleeps,
  };
}

describe('acquireMachineSlot', () => {
  it('takes a free slot, starts its heartbeat, exports the token, and releases it', async () => {
    const dir = freshDir();
    const env = /** @type {Record<string, string | undefined>} */ ({});
    const stops = [];
    const slot = await acquireMachineSlot({
      dir,
      env,
      command: 'pnpm test',
      log: () => {},
      heartbeat: (file) => {
        expect(file).toBe(path.join(dir, OWNER_FILE));
        const stop = vi.fn();
        stops.push(stop);
        return stop;
      },
      ...fakeClock(1_000),
    });
    expect(slot.outcome).toBe('acquired');
    expect(existsSync(dir)).toBe(true);
    expect(env[SLOT_HELD_ENV]).toBe(readSlot(dir).existing?.token);
    slot.release();
    expect(existsSync(dir)).toBe(false);
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it('a nested run re-enters and its release touches nothing', async () => {
    const dir = freshDir();
    const env = /** @type {Record<string, string | undefined>} */ ({});
    const outer = await acquireMachineSlot({
      dir, env, command: 'pnpm test', log: () => {}, heartbeat: noHeartbeat, ...fakeClock(1_000),
    });
    const inner = await acquireMachineSlot({
      dir, env: { ...env }, command: 'pnpm --filter x test', log: () => {}, heartbeat: noHeartbeat, ...fakeClock(1_000),
    });
    expect(inner.outcome).toBe('reentered');
    inner.release();
    expect(existsSync(dir)).toBe(true);
    outer.release();
    expect(existsSync(dir)).toBe(false);
  });

  it('queues behind a beating holder, names it, and takes the slot when it is freed', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'peer', pid: 777, startedAt: T0, command: 'pnpm run test:e2e' }));
    setHeartbeat(dir, T0);
    /** @type {string[]} */
    const lines = [];
    const clock = fakeClock(T0, (t) => {
      setHeartbeat(dir, t); // the holder keeps beating...
      if (t >= T0 + 7 * 60_000) stealSlot(dir, readSlot(dir).existing); // ...and finishes at 7 min
    });
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'test:unit in GpsPlusSlamJs_AppFramework',
      log: (line) => lines.push(line),
      listAncestors: () => [1, 2],
      heartbeat: noHeartbeat,
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
    expect(lines.length).toBeLessThan(10);
    expect(text).toMatch(/still queued/);
  });

  it('gives up after its timeout, says it is not a test failure, and never takes the slot', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'peer', pid: 777, startedAt: T0 }));
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      listAncestors: () => [],
      heartbeat: noHeartbeat,
      timeoutMs: 10 * 60_000,
      pollMs: 5_000,
      ...fakeClock(T0, (t) => setHeartbeat(dir, t)),
    });
    expect(slot.outcome).toBe('timed-out');
    const text = lines.join('\n');
    expect(text).toMatch(/QUEUE TIMEOUT \(exit 75\)/);
    expect(text).toMatch(/NOT a test failure/);
    expect(readSlot(dir).existing?.token).toBe('peer');
  });

  it('reclaims a silent holder and says so', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'gone', pid: process.pid, startedAt: T0 }));
    setHeartbeat(dir, T0);
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      heartbeat: noHeartbeat,
      ...fakeClock(T0 + HEARTBEAT_STALE_MS + 1),
    });
    expect(slot.outcome).toBe('acquired');
    expect(lines.join('\n')).toMatch(/reclaim/i);
  });

  // R2: a steal another waiter keeps winning must sleep between passes and
  // still honour the timeout, never spin.
  it('sleeps and honours the timeout when every steal is lost', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, record({ token: 'gone', startedAt: T0 }));
    setHeartbeat(dir, T0);
    const clock = fakeClock(T0 + HEARTBEAT_STALE_MS + 1, () => {
      // Another waiter "restores" a different live record each pass, so this
      // waiter's steal judges a record that is no longer there.
    });
    const lost = vi.fn(() => 'lost');
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: () => {},
      heartbeat: noHeartbeat,
      timeoutMs: 60_000,
      pollMs: 5_000,
      ...clock,
      steal: lost,
    });
    expect(slot.outcome).toBe('timed-out');
    expect(clock.sleeps()).toBeGreaterThan(5);
    expect(lost.mock.calls.length).toBeLessThanOrEqual(clock.sleeps() + 1);
  });

  it('is a no-op where no slot directory is configured', async () => {
    const slot = await acquireMachineSlot({
      dir: null, env: {}, command: 'pnpm test', log: () => {}, ...fakeClock(0),
    });
    expect(slot.outcome).toBe('off');
    slot.release();
  });

  it('release never removes a slot that someone else now holds', async () => {
    const dir = freshDir();
    const slot = await acquireMachineSlot({
      dir, env: {}, command: 'pnpm test', log: () => {}, heartbeat: noHeartbeat, ...fakeClock(0),
    });
    stealSlot(dir, readSlot(dir).existing);
    tryCreateSlot(dir, record({ token: 'next' }));
    slot.release();
    expect(readSlot(dir).existing?.token).toBe('next');
  });

  // The coordinator's and the peer's concern: a shell that creates the slot
  // itself and then runs a node gate would make that gate queue behind its
  // own parent for the whole timeout. It must fail at once, saying why.
  it('refuses at once, naming the cause, when a beating holder is its own ancestor', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, { pid: 4242, startedAt: T0 });
    setHeartbeat(dir, T0);
    /** @type {string[]} */
    const lines = [];
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: (line) => lines.push(line),
      listAncestors: () => [100, 4242, 1],
      heartbeat: noHeartbeat,
      ...fakeClock(T0 + 1_000),
    });
    expect(slot.outcome).toBe('held-by-ancestor');
    const text = lines.join('\n');
    expect(text).toMatch(/ANCESTOR/);
    expect(text).toContain('machine-slot.mjs run --');
    expect(readSlot(dir).existing?.pid).toBe(4242);
  });

  // R1: a silent slot whose recorded pid was reused by one of the waiter's
  // own ancestors is reclaimed, never reported as an ancestor holder.
  it('reclaims a silent slot even when its pid is one of the ancestors', async () => {
    const dir = freshDir();
    tryCreateSlot(dir, { pid: 4242, startedAt: T0 });
    setHeartbeat(dir, T0);
    const listAncestors = vi.fn(() => [4242]);
    const slot = await acquireMachineSlot({
      dir,
      env: {},
      command: 'pnpm test',
      log: () => {},
      listAncestors,
      heartbeat: noHeartbeat,
      ...fakeClock(T0 + HEARTBEAT_STALE_MS + 1),
    });
    expect(slot.outcome).toBe('acquired');
    expect(listAncestors).not.toHaveBeenCalled();
  });
});

// R9: the ancestor probe's parser, with injected text, so it can fail.
describe('the process table', () => {
  it('parses PowerShell output, CRLF and blank lines included', () => {
    const table = parseProcessTable('  10 1\r\n20 10\r\n\r\n30 20\r\nnot a row\r\n40\r\n');
    expect([...table.entries()]).toEqual([
      [10, 1],
      [20, 10],
      [30, 20],
    ]);
  });

  it('walks the chain nearest first, and stops at pid 0, a gap or a cycle', () => {
    expect(ancestorChain(new Map([[30, 20], [20, 10], [10, 0]]), 30)).toEqual([20, 10]);
    expect(ancestorChain(new Map([[30, 20]]), 30)).toEqual([20]);
    expect(ancestorChain(new Map([[30, 20], [20, 30]]), 30)).toEqual([20]);
  });

  it('lists the real parent among its ancestors', () => {
    expect(ancestorPids()).toContain(process.ppid);
  }, 30_000);
});

// R9 and R6: the exit wiring, on an injected process, so nothing is killed.
describe('holdMachineSlotForProcess', () => {
  /** @param {string} outcome */
  function fakeProcess() {
    const proc = Object.assign(new EventEmitter(), { env: { GATE_SLOT_DIR: 'X:/s/gate' } });
    const order = [];
    proc.exit = vi.fn((code) => {
      order.push(`exit ${code}`);
      proc.emit('exit', code);
    });
    return { proc, order };
  }
  const acquired = (order) => async () => ({
    outcome: 'acquired',
    release: () => order.push('slot released'),
  });

  it('exits 75 on a queue timeout', async () => {
    const { proc } = fakeProcess();
    await holdMachineSlotForProcess('pnpm test', {
      proc,
      acquire: async () => ({ outcome: 'timed-out', release: () => {} }),
    });
    expect(proc.exit).toHaveBeenCalledWith(QUEUE_TIMEOUT_EXIT);
    expect(QUEUE_TIMEOUT_EXIT).toBe(75);
  });

  it('exits 1 when the holder is its own ancestor', async () => {
    const { proc } = fakeProcess();
    await holdMachineSlotForProcess('pnpm test', {
      proc,
      acquire: async () => ({ outcome: 'held-by-ancestor', release: () => {} }),
    });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('releases the slot on exit', async () => {
    const { proc, order } = fakeProcess();
    await holdMachineSlotForProcess('pnpm test', { proc, acquire: acquired(order) });
    proc.emit('exit', 0);
    expect(order).toEqual(['slot released']);
  });

  // R6: a signal must free the INNER lock first. The tree lock's listener is
  // prepended by run-gate.mjs; the signal handler only exits, so the slot is
  // released by the 'exit' listeners in their order, after the tree lock.
  it('on SIGINT frees a prepended inner lock before the slot', async () => {
    const { proc, order } = fakeProcess();
    await holdMachineSlotForProcess('pnpm test', { proc, acquire: acquired(order) });
    proc.prependListener('exit', () => order.push('tree lock cleared'));
    proc.emit('SIGINT');
    expect(order).toEqual(['exit 130', 'tree lock cleared', 'slot released']);
  });
});

// R4: the CLI is the documented way for shell jobs and sweeps to take the
// slot. It must hold it (with a record) while the command runs, pass the token
// on, free it afterwards, and leave with the command's exit code.
describe('the CLI', () => {
  it('holds the slot while the command runs, then frees it and returns its code', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'machine-slot-cli-'));
    const dir = path.join(base, 'gate');
    const probe = path.join(base, 'probe.mjs');
    writeFileSync(
      probe,
      [
        "import { existsSync, readFileSync } from 'node:fs';",
        "const owner = process.env.GATE_SLOT_DIR + '/owner.json';",
        'const record = existsSync(owner) ? JSON.parse(readFileSync(owner, "utf8")) : null;',
        "console.log(JSON.stringify({ held: record !== null, token: record?.token === process.env.GATE_MACHINE_SLOT_TOKEN }));",
        'process.exit(3);',
      ].join('\n')
    );
    const result = spawnSync(process.execPath, [MODULE, 'run', '--', 'node', probe], {
      encoding: 'utf8',
      env: { ...process.env, GATE_SLOT_DIR: dir, [SLOT_HELD_ENV]: '' },
    });
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout.trim().split('\n').pop())).toEqual({ held: true, token: true });
    expect(existsSync(dir)).toBe(false);
  }, 30_000);

  it('prints its usage and exits 2 without a command', () => {
    const result = spawnSync(process.execPath, [MODULE, 'run', '--'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/);
  }, 30_000);

  // Found by a real run (2026-10-04): the CLI joined its arguments unquoted,
  // so `node -e "setTimeout(()=>{},8000)"` reached the shell with `>` read as
  // a redirect. Several arguments must arrive exactly as given.
  it('passes several arguments through exactly, spaces and shell characters included', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'machine-slot-args-'));
    const probe = path.join(base, 'argv.mjs');
    writeFileSync(probe, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const args = ['a b', 'x>y', '()=>{}', 'p&q', 'r|s'];
    const result = spawnSync(process.execPath, [MODULE, 'run', '--', 'node', probe, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GATE_SLOT_DIR: path.join(base, 'gate'), [SLOT_HELD_ENV]: '' },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split('\n').pop())).toEqual(args);
  }, 30_000);

  it('quotes for cmd.exe and for a POSIX shell, and leaves plain words alone', () => {
    expect(quoteForShell('pnpm', 'win32')).toBe('pnpm');
    expect(quoteForShell('a b', 'win32')).toBe('"a b"');
    expect(quoteForShell('say "hi"', 'win32')).toBe('"say \\"hi\\""');
    expect(quoteForShell('x>y', 'linux')).toBe("'x>y'");
    expect(quoteForShell("it's", 'linux')).toBe("'it'\\''s'");
    expect(quoteForShell('', 'linux')).toBe("''");
    expect(shellLine(['pnpm test && echo ok'], 'win32')).toBe('pnpm test && echo ok');
    expect(shellLine(['node', 'a b'], 'win32')).toBe('node "a b"');
  });

  it('runs a single argument as a raw shell line (so && and pipes work)', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'machine-slot-line-'));
    const result = spawnSync(
      process.execPath,
      [MODULE, 'run', '--', 'node -e "process.exit(0)" && node -e "process.exit(6)"'],
      {
        encoding: 'utf8',
        env: { ...process.env, GATE_SLOT_DIR: path.join(base, 'gate'), [SLOT_HELD_ENV]: '' },
      }
    );
    expect(result.status).toBe(6);
  }, 30_000);
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
    const decision = stageRunTakesSlot({ stage: unit, forwardedArgs: ['src/x.test.ts'], env: {} });
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
    expect(stageRunTakesSlot({ stage: unit, forwardedArgs: ['--'], env: {} }).take).toBe(true);
  });

  it('a filtered browser run still takes it: it starts Chromium', () => {
    expect(
      stageRunTakesSlot({ stage: e2e, forwardedArgs: ['playwright-tests/boot.spec.js'], env: {} })
        .take
    ).toBe(true);
  });

  it('a full unit stage run takes it', () => {
    expect(stageRunTakesSlot({ stage: unit, forwardedArgs: [], env: {} }).take).toBe(true);
  });

  it('an unknown stage takes it (the safe direction)', () => {
    expect(stageRunTakesSlot({ stage: undefined, forwardedArgs: ['x'], env: {} }).take).toBe(
      true
    );
  });
});
