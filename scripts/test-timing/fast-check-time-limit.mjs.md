# fast-check-time-limit.mjs - the property time limit for every vitest run

- **Purpose:** a vitest setup module that caps every fast-check property at
  `PROPERTY_TIME_LIMIT_MS` (120 s) and marks any interruption as a failure.
  A failing property whose shrink would run for hours then goes red at the
  limit, with its seed, path and current counterexample, instead of wedging
  its worker silently.
- **Why vitest cannot do this itself:** `fc.assert` runs and shrinks
  synchronously, and `testTimeout` / `hookTimeout` are timers on the
  worker's event loop, which never turns meanwhile (vitest issue #2920). A
  float input near a bound shrinks a few bits per step, thousands of steps a
  minute, so such a shrink can outlast any gate.
- **Who lists it:** every vitest config whose tests import fast-check, in
  `test.setupFiles`, by a path resolved from the config file
  (`fileURLToPath(new URL('../scripts/...', import.meta.url))`): the
  framework, Osm, Globe, Recorder, Tour Viewer, OsmDemo, Landing,
  PhysicsDemo, SiteWorker and the root `vitest.config.js`.

## Public API

- `PROPERTY_TIME_LIMIT_MS` - `120_000`.
- `propertyTimeLimitSettings(limitMs?)` -
  `{ interruptAfterTimeLimit: limitMs, markInterruptAsFailure: true }`;
  throws `RangeError` unless `limitMs` is a positive finite number.
- `applyPropertyTimeLimit(api, limitMs?)` - `api.configureGlobal` with the
  settings above MERGED over `api.readConfigureGlobal()`, so a seed, run
  count or verbosity configured elsewhere survives.
- Side effect on import: `applyPropertyTimeLimit(fc)` on the module's own
  `fast-check` import.

## Invariants and assumptions

- **Both settings or neither.** fast-check reports an interruption DURING
  SHRINKING as a failure whatever `markInterruptAsFailure` says, but an
  interruption while still EXPLORING as a pass with however many runs it
  managed. A limit alone would therefore turn a slow failing property into a
  green one. With the flag every interruption is red.
- **The value sits above every per-test timeout** (vitest's 5 s default,
  30 s where a package raised it, up to 60 s on single slow properties), so
  it only stops a property that would otherwise not end. Setting it "just
  under each package's `testTimeout`" was rejected: packages on the 5 s
  default have single properties that raise their own timeout to 30-60 s,
  and would be cut short.
- **One fast-check instance.** The module's `import fc from 'fast-check'`
  must resolve to the same module the package's tests import, or the limit
  is set on an instance nobody uses. Today every package resolves the one
  `fast-check@4.9.0` in the pnpm store; the probe below is what catches a
  drift.
- A local `fc.assert(..., { interruptAfterTimeLimit })` overrides the
  global; none exists today.
- **Cannot catch:** a single predicate call that never returns (fast-check
  checks the clock between runs), and anything that is not a property test.
  The gate's stage watchdog (`stall-watch.mjs`) is the net for those.

## Examples

```js
// a vitest config next to package.json
setupFiles: [
  fileURLToPath(
    new URL('../scripts/test-timing/fast-check-time-limit.mjs', import.meta.url)
  ),
],
```

```js
// a test with its own small limit
fc.check(property, { ...propertyTimeLimitSettings(300), seed: 4242 });
```

## Tests

- `fast-check-time-limit.test.mjs` - a property that shrinks forever goes
  red at a 300 ms fixture limit with its seed and counterexample; an
  exploring run interrupted under a limit alone passes (why the flag is
  needed) and fails under the shared settings; the merge keeps other keys.
- `fast-check-time-limit.property.test.mjs` - for any prior global
  settings, applying the limit keeps every other key.
- `tests/repo-config/fast-check-time-limit.test.js` - every package whose
  tests import fast-check lists this module in the config its vitest stage
  uses, and carries the probe.
- `<package>/src/fast-check-time-limit.test.ts` - the probe: reads
  `fc.readConfigureGlobal()` in that package's own run.
