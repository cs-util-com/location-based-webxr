// Why this test matters: three consecutive full-cascade runs were lost on
// 2026-08-20 because several gate runs were executing against the SAME working
// tree at once. Two of them failed on wall-clock budgets they only missed
// because they were competing for CPU, and the third failed with
// `Cannot find package 'gps-plus-slam-app-framework/state'` — one run was
// rewriting the framework's `dist/` while another imported from it. Every one
// of those tests passes in isolation, so each failure read as a flaky test and
// invited a threshold change in a package nobody had touched. That is the
// expensive part: the wrong diagnosis was cheaper to act on than the right one.
//
// The lock makes the real cause say its own name. It is deliberately NOT a
// mutex that queues — it refuses, loudly, naming the run that already owns the
// tree, because two cascades wanting the same tree is a mistake to see rather
// than a wait to schedule.

import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  GATE_ALLOW_CONCURRENT_ENV,
  GATE_RUN_ENV,
  MAX_LOCK_AGE_MS,
  decideGateLock,
  describeRefusal,
  pidAlive,
} from './gate-lock.mjs';

/** @param {Partial<import('./gate-lock.mjs').LockRecord>} [over] */
const lockRecord = (over = {}) => ({
  runId: 'run-a',
  pid: 4321,
  project: 'location-based-webxr',
  startedAt: 1_000_000,
  ...over,
});

const alive = () => true;
const dead = () => false;

describe('decideGateLock', () => {
  it('acquires when nothing owns the tree', () => {
    const decision = decideGateLock({
      existing: null,
      env: {},
      isAlive: alive,
      now: 1_000_000,
    });
    expect(decision.action).toBe('acquire');
  });

  it('refuses a second independent run while the first is alive', () => {
    // THE CASE THIS FILE EXISTS FOR. Two bare `pnpm test` invocations, no
    // parent between them, first one still running.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: {},
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('refuse');
  });

  it('re-enters for the package gates the cascade itself spawns', () => {
    // The root cascade runs each package's gate via `pnpm --filter X test`,
    // which re-enters this same runner. A lock that did not distinguish those
    // from a competing run would refuse the very first stage of every cascade,
    // i.e. it would break the gate outright rather than protect it.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: { [GATE_RUN_ENV]: 'run-a' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('reenter');
  });

  it('steals a lock whose owner is gone', () => {
    // A killed or crashed cascade leaves its lock behind. Refusing forever
    // afterwards would make the guard worse than no guard, so a dead owner is
    // reclaimed rather than reported.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: {},
      isAlive: dead,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('steal');
  });

  it('steals a lock older than the ceiling even if the pid still answers', () => {
    // PID reuse is real, and on Windows it is not rare. Without an upper bound
    // an unrelated long-lived process that happens to inherit the recorded pid
    // would wedge the gate permanently — a failure mode with no obvious cause
    // and no way out short of deleting a file nobody knows about.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: {},
      isAlive: alive,
      now: 1_000_000 + MAX_LOCK_AGE_MS + 1,
    });
    expect(decision.action).toBe('steal');
  });

  it('refuses a nested run whose parent lock was taken over', () => {
    // The env says "I am part of run-a", the tree says run-b owns it. That can
    // only happen if run-a's owner died and run-b stole the lock, so run-a's
    // surviving children must not keep working the tree underneath run-b.
    const decision = decideGateLock({
      existing: lockRecord({ runId: 'run-b' }),
      env: { [GATE_RUN_ENV]: 'run-a' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('refuse');
  });

  it('lets a child with NO inherited runId reclaim a stale foreign lock', () => {
    // Why this test matters: this is the fallback the write-failure guard in
    // run-gate.mjs RELIES ON. When `writeLock` throws, the owner deliberately
    // stops exporting GATE_RUN_ID, so its children arrive here with no env var
    // and a lock on disk that belongs to someone else. If that combination
    // refused, a failed lock WRITE would turn a green gate red — the exact
    // opposite of the module's stated property that it degrades to absent,
    // never to fatal. The pair below pins both halves of that reasoning.
    // Found in review of PR #331.
    const withStaleInheritance = decideGateLock({
      existing: lockRecord({ runId: 'someone-else' }),
      env: { [GATE_RUN_ENV]: 'ours' },
      isAlive: dead,
      now: 1_000_000 + 60_000,
    });
    // Inheriting a runId we never wrote is what would have been fatal...
    expect(withStaleInheritance.action).toBe('refuse');

    // ...and exporting nothing is what makes it survivable.
    const withoutInheritance = decideGateLock({
      existing: lockRecord({ runId: 'someone-else' }),
      env: {},
      isAlive: dead,
      now: 1_000_000 + 60_000,
    });
    expect(withoutInheritance.action).toBe('steal');
  });

  it('re-enters when a nested run finds its parent lock already cleared', () => {
    // Losing the race with the parent's own cleanup must not fail the gate: a
    // nested run never owns the lock, so there is nothing for it to repair.
    const decision = decideGateLock({
      existing: null,
      env: { [GATE_RUN_ENV]: 'run-a' },
      isAlive: alive,
      now: 1_000_000,
    });
    expect(decision.action).toBe('reenter');
  });

  it('can be overridden, and says so rather than proceeding quietly', () => {
    // The repo's standing rule is that a run covering less than the full
    // guarantee announces it. An override that looked identical to an
    // uncontended run would put this failure right back where it started.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '1' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('override');
    expect(decision.reason).toMatch(/override/i);
  });

  it('overriding does NOT take the incumbent\'s lock away from it', () => {
    // Why this test matters: the first version returned `acquire` here, and
    // `acquire` makes the run write its own record over the incumbent's and
    // DELETE it on exit. So one person opting in to run concurrently silently
    // disarmed the guard for the NEXT run, which had opted in to nothing — a
    // guard you can switch off on someone else's behalf is worse than no guard,
    // because it still reads as protection.
    //
    // `override` is a distinct action precisely so `run-gate.mjs` can proceed
    // without setting `ownsLock`. Caught in review of PR #330, not by the
    // original tests, which only asserted that the override let the run start.
    const decision = decideGateLock({
      existing: lockRecord(),
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '1' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).not.toBe('acquire');
    expect(decision.action).not.toBe('steal');
    // It must still name who holds the tree, so the operator knows what they
    // are running alongside.
    expect(decision.reason).toContain('run-a');
  });

  it('flags an override STRUCTURALLY, not by the wording of its reason', () => {
    // Why this test matters: run-gate.mjs prints the 'the guard is off' banner
    // from this decision. It used to detect the override by regex-matching the
    // reason PROSE, so rewording one sentence in this file would have silently
    // stopped the warning printing while the override kept working - a guard
    // that is off and no longer says so. Found in review of PR #331.
    const contended = decideGateLock({
      existing: lockRecord(),
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '1' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    const free = decideGateLock({
      existing: null,
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '1' },
      isAlive: alive,
      now: 1_000_000,
    });
    // BOTH override paths must be flagged - the contended one and the free one.
    expect(contended.overridden).toBe(true);
    expect(free.overridden).toBe(true);

    // And a normal decision must not be.
    const normal = decideGateLock({
      existing: null,
      env: {},
      isAlive: alive,
      now: 1_000_000,
    });
    expect(normal.overridden).toBeUndefined();
  });

  it('overriding an UNCONTENDED tree still takes the lock normally', () => {
    // The override must not leave the tree unguarded when there was nothing to
    // override in the first place — otherwise habitually exporting the variable
    // would disable the guard permanently.
    const decision = decideGateLock({
      existing: null,
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '1' },
      isAlive: alive,
      now: 1_000_000,
    });
    expect(decision.action).toBe('acquire');
  });

  it('ignores an empty override value, which is how a unset shell var arrives', () => {
    const decision = decideGateLock({
      existing: lockRecord(),
      env: { [GATE_ALLOW_CONCURRENT_ENV]: '' },
      isAlive: alive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('refuse');
  });
});

describe('pidAlive', () => {
  // Why these tests matter: they are the ones that were MISSING when this
  // module shipped its first version. Every `decideGateLock` test injects the
  // probe, so all of them passed while the real probe reported every dead pid
  // as alive — `process.kill(pid, 0)` answers by throwing, and the throw was
  // being swallowed. The consequence was a lock that could never be reclaimed:
  // one killed cascade and the gate refuses to run again, forever, pointing at
  // a process that no longer exists.

  it('reports a running process as alive', () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it('reports a process that has exited as dead', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    const pid = /** @type {number} */ (child.pid);
    await new Promise((resolve) => child.on('exit', resolve));
    // The pid is released asynchronously on some platforms; a short settle
    // keeps this deterministic without a fixed sleep being load-bearing.
    for (let i = 0; i < 50 && pidAlive(pid); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pidAlive(pid)).toBe(false);
  });

  it('treats impossible pids as dead rather than throwing', () => {
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(Number.NaN)).toBe(false);
  });

  it('drives the steal branch end-to-end for a dead owner', () => {
    // The integration point that actually broke: the real probe, wired into the
    // real rule, must reclaim a lock left by a process that is gone.
    const decision = decideGateLock({
      existing: lockRecord({ pid: 999_999_998 }),
      env: {},
      isAlive: pidAlive,
      now: 1_000_000 + 60_000,
    });
    expect(decision.action).toBe('steal');
  });
});

describe('describeRefusal', () => {
  it('names the owner, its age and the way out', () => {
    // A refusal that does not identify the other run is a dead end: the reader
    // cannot tell whether to wait, to kill something, or to override.
    const message = describeRefusal(
      lockRecord({ pid: 4321, project: 'location-based-webxr' }),
      1_000_000 + 125_000
    );
    expect(message).toContain('4321');
    expect(message).toContain('location-based-webxr');
    expect(message).toMatch(/125\s*s|2m/);
    expect(message).toContain(GATE_ALLOW_CONCURRENT_ENV);
  });

  it('survives a lock file that has been hand-edited into nonsense', () => {
    // The file is plain JSON in a temp-ish location; assuming it is well-formed
    // is exactly the kind of trust this repo tells us not to extend to data we
    // did not just write.
    const message = describeRefusal(
      // @ts-expect-error deliberately malformed input
      { pid: 'not-a-pid', project: undefined, startedAt: Number.NaN },
      1_000_000
    );
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
  });
});
