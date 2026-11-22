# run-guard.ts

## Purpose

Guards a long timing run of the feature matching page's speed test on a phone: it holds the screen wake lock while the run goes, and records whether the page was hidden at any moment. A hidden page, or one whose screen went dark, is throttled by the browser, so its numbers are not the device's; the report must say so.

## Public API

- `HIDDEN_DURING_RUNS` (`"page was hidden during runs"`): the text the page pushes into the report's errors, which `formatTimingReport` prints as `ERROR page was hidden during runs`.
- `RunGuardEnv`: `doc` (visibility state and `visibilitychange` listeners; `document` fits), `wakeLock` (`navigator.wakeLock`, or `undefined` where the browser has none) and `log(line)`.
- `guardRun(env): RunGuard`: starts at once.
  - `wasHidden()`: true once the page was hidden since the start, also when it was hidden at the start.
  - `end()`: stops listening and releases the lock; a second call does nothing.

## Invariants and assumptions

- The lock is asked for only while the page is visible, one request at a time; the browser drops it when the page is hidden, and the guard asks again when the page is visible again.
- A refused request is logged as `screen wake lock refused: <reason>` and the run goes on.
- A lock granted after `end()` is released at once; a release that rejects is swallowed (a sentinel the browser already released may reject).
- No timers and no state outside the returned closure; the caller calls `end()` in a `finally`.

## Example

```ts
const guard = guardRun({ doc: document, wakeLock: navigator.wakeLock, log });
try {
  results = await runTimingByGroup(arms, { runs }, hooks);
} finally {
  guard.end();
}
if (guard.wasHidden()) errors.push(HIDDEN_DURING_RUNS);
```

## Tests

`run-guard.test.ts` with a fake page and lock: held for the run and released at the end, a hidden page recorded and the lock taken again when visible, a page hidden at the start, a refused lock logged, a lock granted after the end released, and no wake lock API. `playwright-tests/feature-match-check.spec.js` checks the report line for a page hidden during a speed test.
