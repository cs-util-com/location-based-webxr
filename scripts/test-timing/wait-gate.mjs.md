# wait-gate.mjs - the one background wait on a detached gate run

- **Purpose:** the agent's single wait on a gate started detached (its log
  ending in a `GATE-RC=<n>` line). It returns when that line appears, with
  the gate's own exit code, or when the log has not changed for the quiet
  window, and then says who holds the machine slot and what to do, instead
  of waiting on for hours.
- **Why it exists next to the stage watchdog:** the watchdog
  (`stall-watch.mjs`) sees only stages. A hang outside one (the framework
  build, `pnpm install`, a run with `GATE_STALL_MIN=off`) leaves the log
  quiet with nothing to end it but the slot's 3 h cap.

## Usage

```bash
node scripts/test-timing/wait-gate.mjs <log>
node scripts/test-timing/wait-gate.mjs <log> --long-run "seed sweep" --quiet-min 60
```

- Exit codes: the gate's own code on `GATE-RC=<n>`; `QUIET_EXIT` (3) on a
  quiet log; 2 on a usage error.
- `WAIT_GATE_POLL_MS` sets how often the log is looked at (default 30 s);
  the tests shorten it.

## Public API

- `parseWaitArgs(argv)` - `{ log, longRun, quietMin }` or `{ error }`.
  `--quiet-min` is accepted only together with `--long-run "<name>"`: the
  carve-out for a run known to be silent longer than a gate stage must say
  which run it is.
- `quietWindowMs(env, quietMin)` - the named override, else the watchdog's
  limit (`GATE_STALL_MIN`, default 20 min, also 20 when it is `off` or
  malformed) plus `QUIET_MARGIN_MIN` (5): 25 min by default.
- `gateRc(text)` - the code on the last whole `GATE-RC=<n>` line, or null.
- `decideWait({ rc, lastChangeMs, nowMs, quietMs })` - done, quiet or wait.
- `quietReport(...)` - the "quiet" text: the silence, the slot holder from
  `owner.json` (via `machine-slot.mjs`), and the action.
- `runWait(argv, env)` - the CLI loop.

## Invariants and assumptions

- **The window is the watchdog's limit plus a margin**, so a stage that
  hangs is always killed by the watchdog first, its banner lands in the log
  and the log moves; "quiet" therefore means a hang the watchdog could not
  see.
- **A change is the log's size or mtime moving**; an absent log counts as
  unchanged from the start of the wait.
- **The action names the holder and does not kill it.** The holder may be
  another session's run, which only whoever started it ends; and a gate relaunched
  meanwhile would only queue behind the run that holds the slot.

## Tests

- `wait-gate.test.mjs` - argument rules (the named carve-out), the window,
  the GATE-RC parse (last whole line), the boundary, the report for a held,
  free, off and unreadable slot on Windows and POSIX, and the CLI end to end
  on a temp log and a temp slot directory.
