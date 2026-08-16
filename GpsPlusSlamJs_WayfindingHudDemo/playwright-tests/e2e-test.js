// @ts-check
/**
 * The suite's `test`, wrapped so that a FAILING test carries the browser's own
 * account of what went wrong.
 *
 * On 2026-08-16 a suite failed 45 times with one message — "waited 60 s for a
 * status element" — while the browser had already printed the single line that
 * named the cause (a 404 on a stale content-hashed module). Playwright does not
 * put console output in its failure report, and traces are kept only
 * `on-first-retry` with retries at 0 locally, so that line was reachable only by
 * re-running with tracing forced and unzipping the result. Two wrong diagnoses
 * came out of that gap.
 *
 * @see ../../scripts/e2e/page-diagnostics.mjs.md
 */

import { test as base, expect } from "@playwright/test";

import {
  attachOnFailure,
  createPageDiagnostics,
} from "../../scripts/e2e/page-diagnostics.mjs";

export const test = base.extend({
  // OVERRIDES `page` RATHER THAN BEING AN `auto` FIXTURE, and the difference
  // matters. An auto fixture that destructures `page` instantiates a browser
  // context for EVERY test — including the ones that deliberately take none and
  // share a page created in `beforeAll` — in suites documented as
  // contention-bound at one worker. Overriding `page` runs only where a test
  // actually asks for a page.
  //
  // A page created directly via `browser.newPage()` is therefore NOT covered
  // here; those files wire `createPageDiagnostics` themselves.
  page: async ({ page, baseURL }, use, testInfo) => {
    const diagnostics = createPageDiagnostics(page, { baseUrl: baseURL });
    await use(page);
    await attachOnFailure(diagnostics, testInfo);
  },
});

export { expect, attachOnFailure, createPageDiagnostics };
