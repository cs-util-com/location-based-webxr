# machine-slot.mjs

## Purpose

One machine-wide slot for every session's gates, sweeps and browser suites
(gate-speed plan 2026-10-04, TS-3 / G1). A run that finds the slot taken
QUEUES, saying so, until the holder is done.

## Why it exists

The per-tree lock (`gate-lock.mjs`) keeps two gates out of one working tree.
It cannot see a second worktree or a second session. On the night of
2026-10-03/04 two sessions' gates, sweeps and 3D browser suites overlapped on
one 8-CPU machine: `cloud-slab.test.ts` took 308 s against 32 s quiet, and
stages that take seconds timed out after 30 minutes in files nobody had
touched. Each session's own lock serialised only its own agents.

## Public API

- `acquireMachineSlot({ dir, env, command, log, now?, sleep?, isAlive?,
  timeoutMs?, pollMs?, pid?, cwd?, listAncestors? }) -> Promise<{ outcome,
  release }>`
  - `outcome`: `acquired` (this run holds the slot), `reentered` (an
    ancestor holds it and exported its token), `timed-out` (gave up in the
    queue), `held-by-ancestor` (the holder's pid is one of this run's own
    ancestors without a matching token, see below), `off` (no slot on this
    machine).
  - `release()` frees the slot only if this run still holds it; a no-op for
    every other outcome.
  - On `acquired` it writes the token to `env[SLOT_HELD_ENV]`, so with
    `process.env` every child inherits it and re-enters.
- `holdMachineSlotForProcess(command)` - the CLI shells' one-liner: takes the
  slot, releases it on exit, SIGINT and SIGTERM, exits 1 on a queue timeout
  or an ancestor holder.
- `ancestorPids() -> number[]` - this process's ancestors, nearest first, from
  one process listing (PowerShell `Get-CimInstance Win32_Process` on Windows,
  `ps` elsewhere); on any failure just `process.ppid`.
- `decideMachineSlot({ present, existing, dirMtimeMs, inheritedToken,
  isAlive, now }) -> { action, reason }` - the whole rule, pure. `action` is
  `acquire`, `reenter`, `wait` or `steal`.
- `stealSlot(dir, judgedStale) -> 'stolen' | 'lost' | 'restored' |
  'displaced'`, `tryCreateSlot(dir, record) -> boolean`, `readSlot(dir)`,
  `resolveSlotDir(env, exists?)`, `describeHolder(record, now)`.
- `stageRunTakesSlot({ stage, forwardedArgs, env }) -> { take, reason }` -
  pure: whether a `timed-stage.mjs` run takes the slot (see "Who takes it").
- Constants: `SLOT_HELD_ENV` (`GATE_MACHINE_SLOT_TOKEN`), `SLOT_DIR_ENV`
  (`GATE_SLOT_DIR`), `SLOT_OPT_IN_ENV` (`GATE_SLOT`, value `take`),
  `SLOT_TIMEOUT_ENV` (`GATE_SLOT_TIMEOUT_MIN`),
  `SLOTS_PARENT`, `OWNER_FILE`, `MIN_STALE_AGE_MS`, `DEFAULT_TIMEOUT_MS`,
  `DEFAULT_POLL_MS`, `REMIND_EVERY_MS`.

## Who takes it

- `run-gate.mjs` (every `pnpm test`, root or package), at the outermost run.
- `timed-stage.mjs` (every single stage run, including `pnpm run test:e2e`
  and filtered browser runs `pnpm run test:e2e <spec>`), **except a
  filtered unit-test run** (`stageRunTakesSlot`, the peer session's change,
  2026-10-04):
  - A vitest stage (`test:unit`, `test:repo-config`) with file arguments
    does NOT take the slot: a 1-5 s TDD step must not queue behind a browser
    run that holds it for minutes. It prints one line,
    `machine slot: not taken (filtered unit-test run); set GATE_SLOT=take for a long sweep`.
  - **`GATE_SLOT=take` opts such a run back in.** Use it for measurement
    sweeps run as `pnpm run test:unit <file>` (10-25 min, e.g. the
    left-behind sweeps with `VISIT_SETTLE_*_SWEEP=1`): they are heavy and
    must queue like any gate.
  - A bare pnpm-style `--` does not count as a filter.
- `test-changed.mjs` (the commit gate), so one `test:changed` run holds the
  slot from its repo-config tests to its last dependent instead of
  releasing it between package gates.
- Every nested run (the cascade's package gates, a stage that calls
  `pnpm run`) inherits the token and re-enters.
- **Browser suites take it whole.** Per-spec-file splitting inside the e2e
  stage was not wired: both long suites (`GpsPlusSlamJs_DesignSystem`'s
  `DS_E2E_TIER=full` and OsmDemo's) run as one `playwright test` through
  `timed-stage.mjs`, and splitting would need a per-file loop with its own
  web-server start-up per file and a merge of the JSON test counts. A session
  that runs the full tier and wants to let others in between files runs it
  file by file instead (`pnpm run test:e2e <spec>` per file), and each such
  run takes and frees the slot on its own.

## Invariants & assumptions

- **The slot is a directory**, `C:\gps\.e2e-slots\gate`; `mkdir` is the
  arbiter, so exactly one run takes a free slot. `owner.json` inside records
  `token`, `pid` (a Windows pid, `process.pid`), `startedAt` (epoch ms),
  `command` and `cwd`. A shell-written record without `token` is accepted;
  such a holder is waited for and reclaimed like any other, but nothing
  re-enters it.
- **A shell must never take the slot around a node gate** without exporting
  `GATE_MACHINE_SLOT_TOKEN` equal to the token it wrote: the gate inside
  would queue behind its own parent until the timeout. The gate detects it:
  before it first queues, it lists its ancestors once (about 1 s on
  Windows), and if the holder's pid is among them it stops at once with an
  `ERROR ... ANCESTOR of this run` line saying exactly this, and exits 1.
  Verified for real: a bash script that wrote its own Windows pid
  (`/proc/$$/winpid`) into `owner.json` and then ran `timed-stage.mjs` got
  the error after 1 s.
- **Stale** only when `decideGateLock` says the owner is gone (dead pid, or
  past its 3 h cap against pid reuse) AND the lock is at least
  `MIN_STALE_AGE_MS` (1 min) old. A slot whose record is missing or
  unreadable is aged by the directory's mtime: a holder between `mkdir` and
  its write is never stolen from.
- **The steal renames first.** A waiter renames the stale directory to a
  unique name, then checks that the moved record is the one it judged stale.
  If not (another waiter stole and re-took the slot in between), it moves the
  live slot back (`restored`). Only if a third run took the empty path in
  that microsecond window can it not be moved back (`displaced`), which is
  logged as a warning: two runs then share the machine, which degrades the
  slot, never the gate.
- **Lock order**: the machine slot outside, the per-tree lock inside. The
  per-tree lock refuses and never waits, so they cannot deadlock. In
  `run-gate.mjs` the tree lock's exit handler is prepended so the inner lock
  is freed before the outer.
- **The queue line** names this run's command and the holder's pid, start
  time, age, command and cwd, and says `QUEUED (not hung)`; it is reprinted
  every `REMIND_EVERY_MS` (5 min), never once per poll.
- **Off where the convention does not exist**: no `C:\gps\.e2e-slots` and no
  `GATE_SLOT_DIR` means every call is a no-op (CI runners).
- **The general escape is `GATE_SLOT_DIR=off`**: it switches the slot off for
  that run and everything it spawns, by name, whatever the run is (an
  emergency, or a run that must not wait). The narrower knobs are
  `GATE_SLOT=take` (a filtered unit run opts IN) and `GATE_SLOT_TIMEOUT_MIN`
  (how long to queue).
- Errors: a failed release is swallowed (the staleness rule covers it); a
  failed `mkdir` other than `EEXIST` throws, so a misconfigured slot path is
  loud.

## Thresholds, and what would reverse them

- `MIN_STALE_AGE_MS` = 1 min (agreed with the peer session). Plausible range
  10 s to 5 min: below ~10 s a slow holder between `mkdir` and its record
  write under 100 % CPU could be stolen from; above a few minutes a crashed
  gate blocks the machine for that long. Anything from 30 s to 2 min gives
  the same behaviour in practice; it would be reversed only by a holder
  that legitimately needs more than a minute to write a small JSON file.
- `DEFAULT_TIMEOUT_MS` = 2 h. The whole-run holds are a full cascade
  (~23 min quiet) and OsmDemo's e2e (~17-22 min); 30 min would time out
  behind one of them plus anything else, and 3 h is the staleness cap. It is
  reversed if one hold routinely exceeds ~2 h, which is exactly the
  design-system full tier taken whole, hence the file-by-file advice above.
- `DEFAULT_POLL_MS` = 5 s: one stat and one small read per poll; a hand-over
  costs at most 5 s.

## Examples

```js
import { holdMachineSlotForProcess } from './machine-slot.mjs';
await holdMachineSlotForProcess('test:unit in GpsPlusSlamJs_AppFramework');
// ... run the work; the slot is released when the process exits.
```

## Tests

- `machine-slot.test.mjs`: the decision table, the on-disk create/read, the
  steal race (two waiters on one stale lock, and a stealer that finds it
  gone), the queue (names the holder, reminds every 5 min, takes the slot
  when freed), the timeout, the reclaim, re-entry, an ancestor holder
  (refused at once), the real `ancestorPids()` probe (contains
  `process.ppid`), and a release that never removes someone else's slot.
  Real temp directories, a fake clock.
- End to end, by hand (2026-10-04, `GATE_SLOT_DIR` on a scratch dir): a
  `timed-stage.mjs` run queued 14 s behind a live node holder with the
  `QUEUED (not hung)` line and took the slot when it was freed; a shell
  holder that was the run's own parent produced the ancestor error after
  1 s; a child spawned by a holder re-entered without a queue line.
- `machine-slot.property.test.mjs`: a live holder below the 3 h cap is never
  stolen from; nothing is stolen inside the grace; re-entry only on an exact
  token match; a free slot is always acquired.
