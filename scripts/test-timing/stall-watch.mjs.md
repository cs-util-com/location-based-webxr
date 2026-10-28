# stall-watch.mjs - the no-output watchdog for one gate stage

- **Purpose:** a gate stage whose process tree prints nothing for the
  silence limit is killed and reported as `STALLED` with exit `STALL_EXIT`
  (124), instead of holding the machine slot until the slot's 3 h cap while
  every waiter reads the run as still going. This module is the pure half;
  `run-stage.mjs` pipes, re-emits, polls and kills.
- **What it is for:** a hang that prints nothing: a test or tool call that
  never returns, a deadlock, a stuck worker. A failing fast-check property
  that cannot finish shrinking used to be the commonest such hang; the
  shared property time limit (`fast-check-time-limit.mjs`) now turns that
  into a red test long before this fires, which is why the banner does not
  send the reader looking for one.

## Public API

- `stallLimitMs(stage, env, { filtered })` - the limit in ms, or `null`
  when the run is not watched:
  - `stage.nestedGate` (a root cascade row that runs a whole package gate):
    its own leaf stages are watched one level down, so the banner names the
    leaf that hung;
  - `GATE_STALL_MIN=off` (any case);
  - a FILTERED run (forwarded args) unless `GATE_STALL_MIN` is a positive
    number: a filtered sweep under `CI=1` can be silent far longer than any
    gate stage (25 min observed) and opts in explicitly.
  - Precedence: `GATE_STALL_MIN` minutes, then `stage.stallMinutes`, then
    `DEFAULT_STALL_MIN` (20). A malformed or non-positive value falls back;
    only `off` switches the watch off.
- `stallPollMs(env)` - `GATE_STALL_POLL_MS` when positive, else
  `STALL_POLL_MS` (5 s). Tests shorten it.
- `silenceClock(limitMs, startMs)` - `heard(now)` on each chunk,
  `check(now)` -> `{ silentMs, stalled }`, `longest(now)`.
- `shouldReportSilence(longestMs, limitMs)` / `silenceLine(...)` - the
  calibration line, printed only past a quarter of the limit (5 min at the
  default).
- `stallMessage(stageName, silentMs, kill)` - the banner; `kill` is
  `{ killed: true }` or `{ killed: false, error }`, and a failed kill is
  never reported as a kill. To find the file it gives the command that works
  for a vitest stage: `GATE_SLOT=take GATE_STALL_MIN=<minutes> pnpm run
  test:unit --reporter=verbose` (a filtered run skips the slot and the watch
  unless asked).
- `watchLine(env, { watched })` / `parseWatchLine(text)` - the line a gate
  writes at its start, `stage watchdog: 20 min (GATE_STALL_MIN; ...)` or
  `stage watchdog: off (GATE_STALL_MIN=off)`, and its parse (the last whole
  line wins, null when there is none). `watched: false` (stdout is a
  terminal, so no stage is piped or watched) gives `stage watchdog: off
  (output is a terminal, so no stage is watched)` whatever the limit, which
  parses as off. `run-gate.mjs` and `test-changed.mjs` write it with
  `watched: !process.stdout.isTTY`; `wait-gate.mjs` reads it.
- `STALL_SUMMARY` - the reason in the one-line verdict `run-gate.mjs` and
  `test-changed.mjs` print after a stage was killed. It names the limit by
  its source (`GATE_STALL_MIN`), never as a number of minutes, since the
  limit can differ per stage; the banner above it says how long.
- Constants: `STALL_EXIT`, `STALL_ENV`, `STALL_POLL_ENV`,
  `DEFAULT_STALL_MIN`, `STALL_POLL_MS`, `STALL_KILL_GRACE_MS`.

## Invariants and assumptions

- **Silence is measured in BYTES of stdout and stderr, not lines.** The
  Playwright dot reporter prints dots without newlines: a 16.6 min Tour
  Viewer e2e run never went 15 s without a byte, but went 378 s between
  lines.
- **The limit, and what reverses it.** Measured healthy silences: 58 s at
  most across a full fast cascade of 109 watched stages; recorded stage
  durations (a silent stage is silent for about its duration) reach 589 s
  (a cold framework lint) and 446 s (Osm lint), 10-30x their medians.
  - 5 or 10 min would kill those cold lints;
  - 15 min (1.5x the worst) is workable, 20 min (2x) is the default, 30 min
    (3x) also safe at 10 more minutes per real stall;
  - a healthy stage silent for 20 min would reverse the default; none is
    recorded, and a machine under full load has inflated stages 21x before,
    which is what `GATE_STALL_MIN` is for.
- **No automatic retry.** A retry draws a new random seed, so a stage that
  hung on a seed-dependent defect would very likely pass the second time and
  bury the defect in a green gate. Exit 124 and its banner are the signal.
- `run-stage.mjs` pipes the output only when its own stdout is not a
  terminal, so an interactive run is unchanged. The kill takes the whole
  tree: `taskkill /T /F` on Windows; on POSIX the stage runs in its own
  process group (`detached`), which gets SIGTERM and, after
  `STALL_KILL_GRACE_MS`, SIGKILL (the grace lets Playwright close the
  browsers it starts in groups of their own).
- **Cannot catch:** a hang that still prints; a hang outside a stage
  (`pnpm install`, the framework build in `test-changed.mjs`; the waiter's
  `wait-gate.mjs` is the net there); a run in a terminal (its watch line
  says the watch is off); and under `CI=1`
  it cannot name the FILE, only the stage.

## Examples

```bash
GATE_STALL_MIN=30 pnpm run test:changed      # a longer limit for a loaded machine
GATE_STALL_MIN=off pnpm test                 # no watch at all
GATE_SLOT=take GATE_STALL_MIN=40 pnpm run test:unit src/x   # opt a filtered run in
```

## Tests

- `stall-watch.test.mjs` - the limit's precedence, the filtered opt-in,
  nested gates, the clock, the calibration threshold, the banner wording,
  the watch line (watched and unwatched) and its parse, and the stall
  summary's wording.
- `stall-watch.property.test.mjs` - the clock never stalls while chunks
  arrive closer than the limit, and always does after a full limit of
  silence.
- `stall-watch.integration.test.mjs` - a real silent fixture stage through
  `runStage`, with a tiny limit: exit 124, the banner, and a forked
  grandchild gone afterwards (Windows locally, Linux in CI); and a caller
  that ends without `process.exit` is not held for the 10 s exit cap after
  the verdict (only a POSIX run can fail that one: on Windows the kill is
  synchronous and the cap is always armed before the stage's exit).
