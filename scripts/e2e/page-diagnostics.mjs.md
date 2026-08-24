# `page-diagnostics.mjs`

**Purpose:** put the browser's own account of a failure — console errors,
uncaught exceptions, failed requests, 4xx/5xx responses — into the Playwright
failure report of the test that failed.

## Why it exists

On 2026-08-16 a suite failed 45 times with one message, "waited 60 s for
`#status`". The browser had already printed the line that named the cause:

```
Failed to load resource: the server responded with a status of 404 (Not Found)
  /@fs/…/GpsPlusSlamJs_Osm/dist/mesh-CZafImwM.js
```

Playwright does not include console output in its failure report, the suites
captured none, and `trace` is `on-first-retry` with `retries: 0` locally — so no
trace is kept on a local failure at all. The line was reachable only by
re-running with `PLAYWRIGHT_CAPTURE=1` and unzipping the trace. Two wrong
diagnoses and a commit published as `[KNOWN RED]` came out of that gap; the code
was never broken.

The companion guard that prevents the underlying condition is
[`dev-server-freshness.mjs`](dev-server-freshness.mjs.md). This module is the
half that makes *any* future boot failure legible, not only that one.

## Public API

- `createPageDiagnostics(page, { baseUrl? })` → `{ entries, reset(), summary() }`.
  Subscribes to `console`, `pageerror`, `requestfailed` and `response`.
  `summary()` returns `''` when nothing was recorded.
- `attachOnFailure(diagnostics, testInfo)` — attaches `summary()` as
  `browser-console` when `testInfo.status !== testInfo.expectedStatus` and the
  summary is non-empty.
- `MAX_ENTRIES` — the cap (20), after which the summary reports how many were
  withheld.

Takes any object with playwright's `page.on` surface, so it carries **no
`@playwright/test` import**: the workspace root cannot resolve that package, only
the individual packages can, and importing it here would also risk two distinct
copies of the runner in one process.

## Invariants & assumptions

- **Diagnosis only.** Nothing here can make a passing test fail. It observes, and
  attaches after a test has already failed.
- **Origin filter.** Events carrying a URL are kept only when that URL is
  same-origin with `baseUrl`; events with no URL (uncaught exceptions) are always
  kept. The suites deliberately abort or 4xx-stub third-party requests — the rule
  sheet, Overpass, DEM tiles — on nearly every test, and reporting those would put
  fixture-by-design noise in every attachment.
- **De-duplicated**, because one failing module is typically requested by several
  importers.
- **`reset()` is for shared pages**, where one collector serves many tests. It
  clears the de-duplication set as well as the entries, or the same failure in a
  later test would be swallowed as already seen.
- **Not covered:** a failure in `beforeAll` itself. Attachment happens at
  test-scoped teardown, and a hook that throws never reaches one. Also, an
  attachment written during teardown can be lost if teardown is itself starved —
  a failure mode the OsmDemo config already records (`Tearing down "context"
  exceeded the test timeout`).

## Wiring

Each package has `playwright-tests/e2e-test.js`, which re-exports a `test` whose
**`page` fixture is overridden** to create a collector and attach on failure.
Specs import `{ test, expect }` from there instead of from `@playwright/test`.

Overriding `page` rather than adding an `auto` fixture is deliberate: an auto
fixture that destructures `page` would instantiate a browser context for every
test that deliberately takes none, in suites documented as contention-bound at
one worker.

A page created directly via `browser.newPage()` is therefore not covered by the
wrapper. `GpsPlusSlamJs_OsmDemo/playwright-tests/map-and-cells.spec.js` — the
largest spec file in the workspace, which shares one page across its tests —
wires `createPageDiagnostics` / `attachOnFailure` itself for that reason.

## Example

```js
import { test, expect, createPageDiagnostics, attachOnFailure } from "./e2e-test.js";

test.beforeAll(async ({ browser }) => {
  shared = await browser.newPage();
  diagnostics = createPageDiagnostics(shared, { baseUrl: test.info().project.use.baseURL });
});

test.afterEach(async ({}, testInfo) => {
  await attachOnFailure(diagnostics, testInfo);
  diagnostics.reset();
});
```

## Tests

`page-diagnostics.test.mjs`, run by the **root** vitest config (see the
`scripts/e2e/**/*.test.mjs` include). Covered: the incident's own 404 line being
captured, third-party stub noise being dropped, same-origin failures kept,
URL-less exceptions always kept, non-error console output ignored,
de-duplication, the cap and its overflow note, `reset()` clearing both entries
and the seen-set, and each `attachOnFailure` branch.
