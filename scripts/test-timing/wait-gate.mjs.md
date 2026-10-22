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

Start the gate first (its `> <log>` redirect empties the log), then the wait.
The gate's exit code has to land in the log as a whole `GATE-RC=<n>` line
(what `gateRc` reads), and the gate does not write it: the launch command
does. Braces rather than a subshell, so the redirect covers the `echo` too:

```bash
{ pnpm test; echo "GATE-RC=$?"; } > <log> 2>&1 &
node scripts/test-timing/wait-gate.mjs <log>
node scripts/test-timing/wait-gate.mjs <log> --long-run "seed sweep" --quiet-min 60
```

- Exit codes, none of which a gate returns for itself:
  - the gate's own code on a `GATE-RC=<n>` line that appears while waiting;
  - `QUIET_EXIT` (3) on a quiet log;
  - `USAGE_EXIT` (64) on a usage error (not 2, which a gate returns for a
    lint or tsc failure);
  - `ALREADY_DONE_EXIT` (65) when the log already holds a `GATE-RC` line as
    the wait starts; the message names that code.
- `WAIT_GATE_POLL_MS` sets how often the log is looked at (default 30 s);
  the tests shorten it.
- A harness cuts a background command after about 30 min: start the wait
  again on the same log. It counts the silence from the log's last change,
  so the window is reached however often it is restarted; and if the gate
  finished in between, the restarted wait exits 65 with the gate's code in
  its message.

## Public API

- `parseWaitArgs(argv)` - `{ log, longRun, quietMin }` or `{ error }`.
  `--quiet-min` is accepted only together with `--long-run "<name>"`: the
  carve-out for a run known to be silent longer than a gate stage must say
  which run it is.
- `quietWindow(env, quietMin, logText)` - `{ ms, basis }`. The named
  override (`basis: 'named'`); else the watchdog limit the GATE wrote into
  its log (`watchLine` / `parseWatchLine` in `stall-watch.mjs`; `'log'`, or
  `'log-off'` for a watch that is off, sized as the default 20) plus
  `QUIET_MARGIN_MIN` (5); else, while the log says nothing yet (still
  queued, an older gate, not a gate), this wait's own `GATE_STALL_MIN`
  (`'env'`, default 20, also 20 when `off` or malformed) plus the margin.
  25 min by default.
- `gateRc(text)` - the code on the last whole `GATE-RC=<n>` line, or null.
- `decideWait({ rc, lastChangeMs, nowMs, quietMs })` - done, quiet or wait.
- `quietReport({ log, silentMs, window, longRun, slot, nowMs, platform })` -
  the "quiet" text: the silence, where the hang can be as far as the log
  shows it, the slot holder from `owner.json` (via `machine-slot.mjs`), and
  the action.
- `runWait(argv, env)` - the CLI loop.

## Invariants and assumptions

- **The window is the GATE's watchdog limit plus a margin**, read from the
  gate's own log, because this wait runs in a shell of its own whose
  `GATE_STALL_MIN` need not be the gate's. With the limit known, a stage
  that hangs is always killed by the watchdog first, its banner lands in the
  log and the log moves, so "quiet" means a hang outside a stage. The report
  says that only in that case (`basis: 'log'`); with the watch off (also a
  gate whose output was a terminal, which watches nothing and says so), or
  the limit unknown, it says the hang may be inside a stage as well.
- **Silence counts from the log's last change** (its mtime when the wait
  starts, then every size or mtime move), never from the start of this
  wait; an absent log counts from the start.
- **A GATE-RC line already there at the start is refused, not returned:** it
  belongs to a run that ended before this wait (this one, or an earlier one
  whose log was reused), and returning it could pass a gate that never ran.
- **A queued gate is not quiet:** while it waits for the machine slot it
  prints a "still queued" reminder every `REMIND_EVERY_MS` (5 min,
  `machine-slot.mjs`), a fifth of the default window; a test pins that
  margin. A window set far below the default (a tiny `GATE_STALL_MIN`) can
  read a long queue as quiet.
- **The action names the holder and does not kill it.** The holder may be
  another session's run, which only whoever started it ends; and a gate
  relaunched meanwhile would only queue behind the run that holds the slot.

## Tests

- `wait-gate.test.mjs` - argument rules (the named carve-out), the window
  and where its limit comes from (the gate's log over this env), the GATE-RC
  parse (last whole line), the boundary, the report's wording per basis and
  for a held, free, off and unreadable slot on Windows and POSIX, and the
  CLI end to end on temp logs: a GATE-RC that arrives, one that was already
  there (65), a restarted wait on a log quiet for 61 min with a 60 min named
  window, a window sized from the log's line, and the usage exit 64.
- `test-changed.test.mjs` pins that the commit gate writes the line.
