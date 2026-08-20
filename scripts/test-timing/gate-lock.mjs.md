# gate-lock.mjs

## Purpose

One gate run at a time, per working tree. Decides whether a starting gate may
proceed, must re-enter as part of a run already in flight, may reclaim an
abandoned lock, or must refuse.

## Why it exists

On 2026-08-20 three consecutive full-cascade runs were lost, and each looked
like a different flaky test:

- two failed on wall-clock budgets (`terrarium.test.ts` `elapsed < 85`,
  a Playwright teardown timeout) that were only missed because several runs were
  competing for the same CPU
- one failed with `Cannot find package 'gps-plus-slam-app-framework/state'`,
  because one run's `build` stage was rewriting `GpsPlusSlamJs_AppFramework/dist/`
  while another run imported through it

All three pass in isolation. That is the trap: each failure invites a threshold
change in a package nobody touched, and the wrong diagnosis is cheaper to reach
than the right one. The guard's real product is not exclusion — it is a failure
message that names the actual cause.

The runs were concurrent because an agent launched the cascade again while an
earlier one was still alive, and because a killed cascade leaves orphaned
`vitest` workers behind. The lock addresses the first directly; the second only
insofar as an orphan's parent is gone, so its lock is reclaimable.

## Public API

- `decideGateLock({ existing, env, isAlive, now }) → { action, reason }` — the
  whole rule, pure. `action` is one of:
  - `acquire` — nothing owns the tree; take the lock
  - `reenter` — this gate is part of a run already holding the lock; touch nothing
  - `steal` — the recorded owner is gone or the lock is past `MAX_LOCK_AGE_MS`
  - `refuse` — another live run owns the tree; `reason` is the full message
  - `override` — the escape hatch was set AND someone else holds the lock:
    **proceed without taking ownership**. Distinct from `acquire` for a reason
    found in review of PR #330: the first version returned `acquire` here, so an
    overriding run overwrote the incumbent's record and then *deleted it on
    exit* — one person opting in silently disarmed the guard for the next run,
    which had opted in to nothing.
- `pidAlive(pid) → boolean` — the real liveness probe. Separate and exported
  **because it is the part that broke**: `process.kill(pid, 0)` reports by
  throwing, `ESRCH` means dead and `EPERM` means alive, and an inline version
  that treated every throw as "alive" made stale locks unreclaimable. Injected
  probes in the tests cannot catch that, so the probe has its own tests.
- `readLock(file)` / `writeLock(file, record)` / `clearLock(file)` — I/O.
  `readLock` returns `null` for absent, truncated, or hand-edited files.
- `lockPath(workspaceRoot)` → `node_modules/.cache/.gate-run.lock`
- Constants: `GATE_RUN_ENV`, `GATE_ALLOW_CONCURRENT_ENV`, `MAX_LOCK_AGE_MS`,
  `LOCK_FILE_NAME`

## Invariants & assumptions

- **A nested run never takes or releases the lock.** The root cascade runs each
  package gate via `pnpm --filter <pkg> test`, which re-enters `run-gate.mjs`.
  If those took the lock, the first package gate would steal it from the cascade
  that spawned it and release it on its own exit, leaving the remaining ~20
  minutes unprotected. Enforced by a property test.
- **A live, recent, independently-owned lock is always refused.** Also a
  property test — this is the guarantee the module exists for.
- **Re-entrancy travels by environment.** The outermost run writes
  `GATE_RUN_ID` into `process.env`; `run-stage.mjs` spawns children with
  `{ ...process.env }`, so they inherit it. A child whose inherited id does not
  match the lock on disk refuses — its parent's lock was taken over, so the
  tree is no longer its own.
- **It refuses rather than queues**, deliberately. Two cascades wanting one tree
  is a mistake to see, not a wait to schedule — and on a ~25-minute gate, queuing
  would hide it for a long time.
- **It degrades to absent, never to fatal.** An unreadable lock counts as no
  lock; a lock that cannot be written logs a warning and the gate runs anyway.
  A guard that can wedge the gate with no way past it is worse than the
  concurrency it prevents.
- **`MAX_LOCK_AGE_MS` is 3 h**, well above the slowest observed cascade (~23 min,
  2026-08-15). It exists for pid reuse, which on Windows is not rare.
- **Escape hatch:** `GATE_ALLOW_CONCURRENT=1` proceeds regardless, and announces
  itself on stderr — the same "never silent" rule the skip-browser banner follows.
  Empty string and `0` do not count as set, which is how an unset shell variable
  commonly arrives.
  - **It opts YOU in, never the next run.** With a lock present the decision is
    `override`, which leaves `ownsLock` false, so the incumbent's record is
    neither rewritten nor cleared. With no lock present it is a normal
    `acquire`, so habitually exporting the variable does not permanently
    disable the guard.
  - Children of an overriding run inherit the variable through `process.env`
    and take the same branch, which is why an overriding *cascade* still runs
    its package gates instead of refusing them.

## Examples

```bash
# Normal: takes the lock, releases it on exit (including on failure or Ctrl-C).
pnpm test

# A second run while the first is alive:
#   ✖ another gate run already owns this working tree.
#     owner:   gps-plus-slam-landing, pid 13384, started 1 s ago
#     ...
#     set GATE_ALLOW_CONCURRENT=1 to proceed anyway.

# Deliberately override (e.g. you are certain the owner is gone):
GATE_ALLOW_CONCURRENT=1 pnpm test
```

## Tests

- `gate-lock.test.mjs` — every branch of the decision, the refusal message's
  content, malformed-record tolerance, and `pidAlive` against a real process
  that has exited.
- `gate-lock.property.test.mjs` — the two safety invariants above, plus
  "the override always wins" and "always one of the four actions, with a reason".
- Wiring is exercised for real by every cascade run; the refusal and steal paths
  were verified end-to-end against a planted lock file (a live pid, then a dead
  one) on 2026-08-20.

## Related

- `run-gate.mjs` / `run-gate.mjs.md` — the only caller.
- `cascade-freshness.mjs` — the other half of the "was this tree actually gated"
  question: this module says *one run at a time*, that one says *a run happened
  against this commit*.
- Root `CLAUDE.md` → "THE COMMIT GATE" — what a gate run is and when it is required.
