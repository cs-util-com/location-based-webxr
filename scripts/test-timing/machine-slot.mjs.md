# machine-slot.mjs

## Purpose

One machine-wide slot for every session's gates, sweeps and browser suites
(gate-speed plan 2026-10-04, TS-3 / G1). A run that finds the slot taken
QUEUES, saying so, until the holder is done. Liveness is a heartbeat, not a
pid (milestone review R1).

## Why it exists

The per-tree lock (`gate-lock.mjs`) keeps two gates out of one working tree.
It cannot see a second worktree or a second session. On the night of
2026-10-03/04 two sessions' gates, sweeps and 3D browser suites overlapped on
one 8-CPU machine: `cloud-slab.test.ts` took 308 s against 32 s quiet, and
stages that take seconds timed out after 30 minutes in files nobody had
touched. Each session's own lock serialised only its own agents.

## Scope

**webxr runners only**: `run-gate.mjs` (every `pnpm test`), `timed-stage.mjs`
(every single stage run) and `test-changed.mjs` in `location-based-webxr`,
plus anything run through this module's CLI. The primary repo's gates
(`GpsPlusSlamJs`, `GpsPlusSlamJs_Investigation`, `GpsPlusSlamJs_Docs`), the
Investigation sweeps and the Atlas e2e do **not** take it (yet); until they
do, the sessions' quiet flag stays the way to keep them apart.

## Public API

- CLI: `node scripts/test-timing/machine-slot.mjs run -- <command...>` takes
  the slot with a proper record and heartbeat, runs the command through the
  shell with the slot's token in its environment (gates inside re-enter),
  frees the slot, and exits with the command's code (75 if it gave up in the
  queue, 2 on a usage error). **This is the way for shell jobs and sweeps to
  take the slot.**
  - ONE argument is run as a raw shell line (`run -- "pnpm test && echo ok"`);
    SEVERAL are quoted one by one (`quoteForShell`: double quotes for cmd.exe,
    single quotes for a POSIX shell) so each reaches the program exactly as
    given. A real run first joined them unquoted, and `node -e "()=>{}"` lost
    its `>` to a shell redirect.
- `acquireMachineSlot({ dir, env, command, log, now?, sleep?, timeoutMs?,
  pollMs?, pid?, cwd?, listAncestors?, heartbeat?, steal? }) ->
  Promise<{ outcome, release }>`
  - `outcome`: `acquired` (this run holds the slot and its heartbeat runs),
    `reentered` (an ancestor run holds it and exported its token),
    `timed-out` (gave up in the queue), `held-by-ancestor` (a beating holder
    is one of this run's own ancestors without a matching token), `off` (no
    slot on this machine).
  - `release()` stops the heartbeat and frees the slot only if this run still
    holds it; a no-op for every other outcome.
  - On `acquired` it writes the token to `env[SLOT_HELD_ENV]`, so with
    `process.env` every child inherits it and re-enters.
- `holdMachineSlotForProcess(command, deps?)` - the shells' one-liner:
  takes the slot and frees it on every way out. Exits `QUEUE_TIMEOUT_EXIT`
  (75) on a queue timeout, 1 on an ancestor holder, 130 on SIGINT / SIGTERM.
- `decideMachineSlot({ present, existing, heartbeatMs, inheritedToken, now })
  -> { action, reason }` - the whole rule, pure. `action` is `acquire`,
  `reenter`, `wait` or `steal`. No pid input: liveness is the heartbeat.
- `startHeartbeat(file, ms?) -> stop` - the worker-thread heartbeat.
- `parseProcessTable(text) -> Map` and `ancestorChain(parentOf, pid)` - the
  pure parts of `ancestorPids()`, tested with injected text.
- `stealSlot`, `tryCreateSlot`, `readSlot`, `resolveSlotDir`,
  `describeHolder`, `stageRunTakesSlot`, `runCli`, `quoteForShell`, `shellLine`.
- Constants: `SLOT_HELD_ENV` (`GATE_MACHINE_SLOT_TOKEN`), `SLOT_DIR_ENV`
  (`GATE_SLOT_DIR`), `SLOT_OPT_IN_ENV` (`GATE_SLOT`, value `take`),
  `SLOT_TIMEOUT_ENV` (`GATE_SLOT_TIMEOUT_MIN`), `SLOTS_PARENT`, `OWNER_FILE`,
  `HEARTBEAT_MS`, `HEARTBEAT_STALE_MS`, `DEFAULT_TIMEOUT_MS`,
  `DEFAULT_POLL_MS`, `REMIND_EVERY_MS`, `QUEUE_TIMEOUT_EXIT`.

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
  `token`, `pid`, `startedAt` (epoch ms), `command` and `cwd`.
- **The heartbeat is `owner.json`'s mtime.** The holder touches it every
  `HEARTBEAT_MS` (30 s) from a WORKER THREAD. A worker because a holder may
  block its main thread for the whole run: `test-changed.mjs` spawns every
  gate with `spawnSync`, so a main-thread timer would never fire and the slot
  would be stolen 3 min into every commit gate (pinned by a test that blocks
  the main thread). The worker is `unref`'d and dies with its process, so a
  killed gate (TaskStop, the harness's cut-off) stops beating at once.
- **Stale** when the heartbeat is older than `HEARTBEAT_STALE_MS` (3 min),
  whatever the pid; or when the record is older than gate-lock's 3 h cap
  (`MAX_LOCK_AGE_MS`) even with a fresh heartbeat, a defence against a holder
  that is alive but wedged. Windows reuses pids quickly, so the old dead-pid
  check could keep a killed gate's slot until that cap (review R1). A slot
  with no readable record is aged by the directory's mtime: a holder between
  `mkdir` and its write is never stolen from.
- **A bare `mkdir`, or a bash record with `$$` or `/proc/$$/winpid`, is
  STOLEN** after 3 min: nothing touches it. Shell jobs take the slot through
  the CLI above instead.
- **The pid is used only for the ancestor check**, and only behind a FRESH
  heartbeat (a silent slot is stolen before the check runs), so a dead
  holder's pid reused by one of the waiter's own ancestors cannot produce a
  false ANCESTOR error. A beating holder that IS an ancestor (a shell that
  took the slot around a gate without exporting its token) stops the gate at
  once with an `ERROR ... ANCESTOR of this run` line, exit 1.
- **The steal renames first.** A waiter renames the stale directory to a
  unique name, then checks that the moved record is the one it judged stale.
  If not (another waiter stole and re-took the slot in between), it moves the
  live slot back (`restored`). Only if a third run took the empty path in
  that window can it not be moved back (`displaced`), which is logged as a
  warning. A `lost`, `restored` or `displaced` steal sleeps a poll and
  re-checks the timeout before trying again; it never spins (review R2).
- **Lock order**: the machine slot outside, the per-tree lock inside. The
  per-tree lock refuses and never waits, so they cannot deadlock. On a
  normal exit AND on SIGINT / SIGTERM the inner lock is freed first:
  `run-gate.mjs` prepends its tree-lock exit listener, and the slot's signal
  handler only calls `exit(130)`, so the release happens in the exit
  listeners in that order (review R6; pinned by a test).
- **A queue timeout exits 75** (EX_TEMPFAIL) with `machine slot: QUEUE
  TIMEOUT (exit 75) - this is NOT a test failure`, never with a red test's
  code (review R3).
- **The queue line** names this run's command and the holder's pid, start
  time, age, command and cwd, and says `QUEUED (not hung)`; it is reprinted
  every `REMIND_EVERY_MS` (5 min), never once per poll.
- **Off where the convention does not exist**: no `C:\gps\.e2e-slots` and no
  `GATE_SLOT_DIR` means every call is a no-op (CI runners).
- **The general escape is `GATE_SLOT_DIR=off`**: it switches the slot off for
  that run and everything it spawns, by name. The narrower knobs are
  `GATE_SLOT=take` (a filtered unit run opts IN) and `GATE_SLOT_TIMEOUT_MIN`
  (how long to queue).
- Errors: a failed release or heartbeat touch is swallowed (the staleness
  rule covers it); a failed `mkdir` other than `EEXIST` throws, so a
  misconfigured slot path is loud.

## Thresholds, and what would reverse them

- **Heartbeat lateness, measured** (2026-10-04, `scratchpad/speed/r1`): a
  worker heartbeat at a 1 s period, sampled every 200 ms for 12 minutes
  during a full-cascade gate (framework, Recorder and seven app gates), landed
  at p50 1012 ms, p99 1020 ms, worst 1174 ms: at most 174 ms late. Lateness
  is a scheduling delay, so it does not grow with the period.
- `HEARTBEAT_MS` = 30 s. Cost: one `utimes` per 30 s. Plausible range
  5 s to 60 s; anything in it behaves the same against a 3 min limit.
- `HEARTBEAT_STALE_MS` = 3 min, six missed beats. It is how long a killed
  gate blocks the machine. Plausible range 1 to 10 min. Against the measured
  174 ms worst lateness, even 1 min (two missed beats) would be safe on this
  evidence; 3 min leaves room for a disk stall or a sleeping laptop, which
  the measurement did not cover. It would be reversed if a live holder's
  heartbeat were ever seen silent for minutes (a suspended or swapped-out
  process): then raise it. It would be lowered if killed gates are common and
  3 min of blocked machine is felt.
- `DEFAULT_TIMEOUT_MS` = 2 h. The whole-run holds are a full cascade
  (~23 min quiet) and OsmDemo's e2e (~17-22 min); 30 min would time out
  behind one of them plus anything else, and 3 h is the staleness cap. It is
  reversed if one hold routinely exceeds ~2 h, which is exactly the
  design-system full tier taken whole, hence the file-by-file advice above.
- `DEFAULT_POLL_MS` = 5 s: one stat and one small read per poll; a hand-over
  costs at most 5 s.

## Examples

```bash
# A sweep from a shell, holding the slot for its whole run:
node scripts/test-timing/machine-slot.mjs run -- pnpm --filter gps-plus-slam-app-framework run test:unit src/x.sweep.test.ts
```

```js
import { holdMachineSlotForProcess } from './machine-slot.mjs';
await holdMachineSlotForProcess('test:unit in GpsPlusSlamJs_AppFramework');
// ... run the work; the slot is released when the process exits.
```

## Tests

- `machine-slot.test.mjs`: the decision table (heartbeat fresh, silent, the
  3 h cap, no pid input), the on-disk create and read (heartbeat from
  `owner.json`'s mtime, or the directory's), a hand-written shell record
  reclaimed once silent, the real worker heartbeat (touches the file; keeps
  beating while the main thread is blocked by `spawnSync`), the steal race,
  the queue (names the holder, reminds every 5 min, takes the slot when
  freed), the timeout (exit 75 text), a lost steal that sleeps and honours
  the timeout, the reclaim, re-entry, an ancestor holder (refused at once)
  and a reused ancestor pid on a silent slot (reclaimed, no false error), the
  process-table parser with injected text, `holdMachineSlotForProcess`'s exit
  wiring on an injected process (75, 1, release on exit, and the R6 order on
  SIGINT), and the CLI end to end (holds the slot with a record and the
  token while the command runs, frees it, returns the command's code; usage
  exit 2; several arguments with spaces and shell characters arrive exactly;
  one argument runs as a raw shell line). A real two-process run on a
  scratch slot (2026-10-04): the second CLI run queued behind the first with
  the QUEUED line, took the slot after 11 s and returned its command's code. Real temp directories, a fake clock.
- `machine-slot.property.test.mjs`: a beating holder below the 3 h cap is
  never stolen from; a silent holder is always reclaimed unless the waiter is
  part of its run; re-entry only on an exact token match; a free slot is
  always acquired.
