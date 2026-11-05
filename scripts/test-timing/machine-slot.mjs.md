# machine-slot.mjs

## Purpose

One machine-wide slot for every session's gates, sweeps and browser suites
(since 2026-10-04). A run that finds the slot taken
QUEUES, saying so, until the holder is done. Liveness is a heartbeat, not a
pid. The waiters queue in a fair order: runs that start no browser first,
browser runs after them unless they have waited an hour.

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
  pollMs?, pid?, cwd?, listAncestors?, heartbeat?, steal?, queueClass?,
  onExit? }) ->
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
  - `queueClass`: `fast` for a run that starts no browser, `browser`
    (the default, also the CLI's) for anything else.
- `holdMachineSlotForProcess(command, { queueClass?, ... })` - the shells' one-liner:
  takes the slot and frees it on every way out. Exits `QUEUE_TIMEOUT_EXIT`
  (75) on a queue timeout, 1 on an ancestor holder, 130 on SIGINT / SIGTERM.
- `decideMachineSlot({ present, existing, heartbeatMs, inheritedToken, now })
  -> { action, reason }` - the whole rule, pure. `action` is `acquire`,
  `reenter`, `wait` or `steal`. No pid input: liveness is the heartbeat.
- `rankQueue(tickets, now, { agingMs?, staleMs? }) -> QueueTicket[]` - the
  queue's whole ordering rule, pure (see "The queue").
- `queueClassOf({ skipBrowser, runsBrowser }) -> 'fast' | 'browser'`.
- `describePlace(ranked, token)` - `2nd of 3 in the queue, behind "<command>"`.
- `writeTicket`, `readQueue`, `removeTicket`, `queueDirOf` - the tickets on
  disk.
- `startHeartbeat(file, ms?) -> stop` - the worker-thread heartbeat.
- `parseProcessTable(text) -> Map` and `ancestorChain(parentOf, pid)` - the
  pure parts of `ancestorPids()`, tested with injected text.
- `stealSlot`, `tryCreateSlot`, `readSlot`, `resolveSlotDir`,
  `describeHolder`, `stageRunTakesSlot`, `runCli`, `quoteForShell`, `shellLine`.
- Constants: `SLOT_HELD_ENV` (`GATE_MACHINE_SLOT_TOKEN`), `SLOT_DIR_ENV`
  (`GATE_SLOT_DIR`), `SLOT_OPT_IN_ENV` (`GATE_SLOT`, value `take`),
  `SLOT_TIMEOUT_ENV` (`GATE_SLOT_TIMEOUT_MIN`), `SLOTS_PARENT`, `OWNER_FILE`,
  `HEARTBEAT_MS`, `HEARTBEAT_STALE_MS`, `DEFAULT_TIMEOUT_MS`,
  `DEFAULT_POLL_MS`, `REMIND_EVERY_MS`, `QUEUE_TIMEOUT_EXIT`, `QUEUE_SUFFIX`,
  `QUEUE_AGING_MS`, `TICKET_STALE_MS`, `QUEUE_MAX_FAILURES`.
- `stageQueueClass(stage)` - the class of a single stage run, from the stage
  alone; `ticketCleanupOnExit(cleanup, proc?)` - removes a waiter's ticket
  on exit, SIGINT and SIGTERM.

## Who takes it

- `run-gate.mjs` (every `pnpm test`, root or package), at the outermost run.
- `timed-stage.mjs` (every single stage run, including `pnpm run test:e2e`
  and filtered browser runs `pnpm run test:e2e <spec>`), **except a
  filtered unit-test run** (`stageRunTakesSlot`, a change made by another session,
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
  `pnpm run`) inherits the token and re-enters, so only the outermost run's
  queue class counts.
- **Queue classes, by caller:** `test-changed.mjs` is `fast` with
  `GATE_SKIP_BROWSER_STAGES=1` (the per-commit gate) and `browser` without;
  `run-gate.mjs` is `fast` when browser stages are skipped or its project has
  no browser stage, and the ROOT gate is always `browser` (its stages are the
  package gates, which start browsers); `timed-stage.mjs` decides from the
  stage alone (`stageQueueClass`), since it runs the stage whatever
  `GATE_SKIP_BROWSER_STAGES` says: `browser` for a `playwright` stage or an
  unknown one; the CLI is always `browser`.
- **Browser suites take it whole.** Per-spec-file splitting inside the e2e
  stage was not wired: both long suites (`GpsPlusSlamJs_DesignSystem`'s
  `DS_E2E_TIER=full` and OsmDemo's) run as one `playwright test` through
  `timed-stage.mjs`, and splitting would need a per-file loop with its own
  web-server start-up per file and a merge of the JSON test counts. A session
  that runs the full tier and wants to let others in between files runs it
  file by file instead (`pnpm run test:e2e <spec>` per file), and each such
  run takes and frees the slot on its own.

## The queue

Without it the slot went to whichever waiter's 5 s poll hit the free slot
first: a 3-minute per-commit gate could wait behind two browser runs that
arrived after it. Now:

- **Tickets.** A waiter writes `<token>.json` (`token`, `pid`, `enqueuedAt`,
  `queueClass`, `command`, `cwd`) into `<slot dir>-queue/`, BESIDE the slot,
  not inside it, so an older copy of this script sees the slot exactly as
  before. The write is atomic (a temporary file renamed into place). The
  file's mtime is the waiter's heartbeat, touched on every poll; a ticket
  silent for `TICKET_STALE_MS` (60 s) is dead, never ranks, and is deleted
  by whoever reads the queue. A ticket is removed when its waiter takes the
  slot, re-enters, times out, stops on an ancestor holder, exits, or gets
  SIGINT / SIGTERM (handlers registered when the ticket is first written);
  a hard kill runs nothing, and the 60 s window covers it.
- **The ranking** (`rankQueue`, pure): first the `fast` runs together with
  the browser runs that have queued `QUEUE_AGING_MS` or longer, in arrival
  order, so an aged browser run passes younger fast runs but never an older
  one; then younger browser runs and any unknown class, in arrival order.
  The token breaks a tie, so exactly one waiter is first.
- **Taking a free slot.** A run that finds the slot free and no other live
  ticket takes it at once and writes no ticket (the uncontended case is as
  before). If live tickets exist, it joins the queue and takes the slot only
  when it ranks first; otherwise it waits, saying `the machine slot is free,
  but this run is 2nd of 3 in the queue, behind "..."`.
- **Mixed versions never deadlock.** An older copy writes no ticket and still
  races for `mkdir`; it may win, and the queue simply waits for it like any
  holder. On a poll whose ticket write fails, the waiter races as an older
  copy does and tries the queue again on the next poll; after
  `QUEUE_MAX_FAILURES` (5) failures in a row it logs `the queue is
  unusable` and stops trying. Nothing in the queue can hold a free slot for
  longer than one dead ticket's 60 s.
- **The QUEUED line names the place**, e.g. `...; 2nd of 3 in the queue,
  behind "test:changed in C:\gps\wt-x"` (the run directly ahead).

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
  check could keep a killed gate's slot until that cap. A slot
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
  re-checks the timeout before trying again; it never spins.
- **Lock order**: the machine slot outside, the per-tree lock inside. The
  per-tree lock refuses and never waits, so they cannot deadlock. On a
  normal exit AND on SIGINT / SIGTERM the inner lock is freed first:
  `run-gate.mjs` prepends its tree-lock exit listener, and the slot's signal
  handler only calls `exit(130)`, so the release happens in the exit
  listeners in that order (pinned by a test).
- **A queue timeout exits 75** (EX_TEMPFAIL) with `machine slot: QUEUE
  TIMEOUT (exit 75) - this is NOT a test failure`, never with a red test's
  code.
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
- `DEFAULT_TIMEOUT_MS` = 4 h. Holds that take the slot whole reach about
  2.5 h (a full browser run), and an aged browser run may wait the aging
  bound plus one such hold before its turn (60 + 150 min, pinned by a test),
  so the earlier 2 h made it give up just before it would start; the
  simulation below puts the worst browser wait at 274-314 min at
  utilisation 0.85-0.95. The timeout is not the fix for long holds: the
  per-PR browser tier, which runs a smaller browser suite per commit range,
  is what brings the holds back down, and with it this value can come down
  again. It is reversed upward if waits time out while the queue moves.
- `DEFAULT_POLL_MS` = 5 s: one stat and one small read per poll (plus, while
  queued, one ticket touch and one listing of the queue); a hand-over costs
  at most 5 s.
- `TICKET_STALE_MS` = 60 s: tickets are touched every poll (5 s), but the
  first ancestor check can block a waiter's main thread for up to 30 s, so
  30 s would be too tight; the slot's 3 min would let a killed waiter hold a
  free slot for 3 min.
- `QUEUE_MAX_FAILURES` = 5 consecutive failed ticket writes (about 25 s):
  far longer than a transient Windows EPERM from an indexer or virus scanner,
  short enough that an unusable queue costs only a few failed writes. While
  writes fail the waiter races anyway, so the number only decides when it
  stops trying.
- `QUEUE_AGING_MS` = 60 min: a browser run queued this long joins the fast
  runs in arrival order. The aging bound plus the longest hold must stay
  below the queue timeout (60 + 150 min against 4 h), and it should stay well
  above the fast holds (3-25 min), or a browser run that waited one fast gate
  passes the rest. Swept (2026-11-05, a scratch simulation of the single
  slot: 8 h of arrivals, a third of them browser runs of 20-60 min with one
  in eight 150 min, fast runs of 5-25 min, 40 seeds, utilisation 0.5-0.95)
  over 15, 30, 45, 60, 75, 90, 120 min and no aging:
  - At utilisation 0.5 every value behaves the same (fast mean wait 7.5-8.7
    min, browser 9.9-11.1).
  - At 0.85: fast mean wait 34, 34, 32, **31**, 30, 29, 25, 19 min; the
    worst browser wait is 274 min for every finite value and 293 without
    aging; waits over 4 h: 9, 9, 9, **9**, 9, 9, 7, 8 (of about 1 700).
  - So with the arrival-order rule the bound mostly trades the fast runs'
    mean wait (lower bound, longer fast waits) and hardly moves the browser
    runs' worst case. No aging at all gives the fastest gates but no bound
    on a browser wait.
  - What would reverse 60: fast gates still waiting behind aged browser
    runs (raise it, to 90-120); browser runs timing out while fast runs
    flow (lower it, to 30).

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
  wiring on an injected process (75, 1, release on exit, and the inner
  lock freed first on SIGINT), and the CLI end to end (holds the slot with a record and the
  token while the command runs, frees it, returns the command's code; usage
  exit 2; several arguments with spaces and shell characters arrive exactly;
  one argument runs as a raw shell line). A real two-process run on a
  scratch slot (2026-10-04): the second CLI run queued behind the first with
  the QUEUED line, took the slot after 11 s and returned its command's code. Real temp directories, a fake clock.
- `machine-slot.queue.test.mjs`: the ranking by example (a fast run beats a
  younger browser run; first come first served; an aged browser run passes
  a younger fast run but not an older one, at the bound and 1 ms short of
  it; dead tickets left out, a ticket dead after 60 s; an unknown class
  ranks as browser), `describePlace`, `queueClassOf`, `stageQueueClass`
  (`test:e2e` is browser whatever the skip variable says), the queue
  timeout covering the aging bound plus the longest hold, the tickets on
  disk (written, read, removed; dead tickets and junk cleaned; a missing
  queue reads empty; removed on exit, SIGINT and SIGTERM), a transient
  file error retried and five in a row giving up,
  and `acquireMachineSlot` with a queue in real temp directories: two
  waiters in one process (the fast one takes the freed slot though it queued
  second; two of one class go first come first served), a newcomer does not
  take a free slot while a live waiter ranks ahead, a dead head ticket never
  blocks, a waiter with no ticket (an older copy) wins the race and the queue
  continues behind it, the QUEUED line names the place, a timeout removes
  the ticket, and an uncontended run writes no ticket.
- `machine-slot.property.test.mjs`: a beating holder below the 3 h cap is
  never stolen from; a silent holder is always reclaimed unless the waiter is
  part of its run; re-entry only on an exact token match; a free slot is
  always acquired. The queue: the ranking is a total order (one first, the
  same for any input order); dead tickets never rank and live ones always
  do; a fast run beats every browser run younger than the aging bound; no
  browser run ever ranks ahead of an older fast run; and in a simulated
  single slot fed any stream of arrivals, a browser run starts within the
  aging bound plus one longest hold per older run of any class, plus one.
