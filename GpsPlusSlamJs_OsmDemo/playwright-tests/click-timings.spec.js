/**
 * The click-path breakdown, end to end in a real browser with a real worker.
 *
 * WHAT THIS DOES AND DOES NOT ANSWER — read before quoting a number from it.
 *
 * **It does NOT answer the owner's question.** The plan's §0.3 item 3 is
 * explicit: the deliverable is a ranked breakdown of a REAL click over REAL
 * cached tiles, and substituting a fixture-driven harness "is precisely what
 * produced the gap" the plan exists to close. This suite is hostname-blocked
 * from Overpass by design, so the fetch stages here are a 242-feature fixture,
 * i.e. ~0.2–0.6 % of a res-7 tile. **Any ranking read off this run is a
 * ranking of the wrong input.**
 *
 * **What it DOES answer is the thing unit tests structurally cannot: does the
 * instrument compose across the worker boundary in a real browser.** Every
 * cross-boundary risk in the design is live here and nowhere else —
 *
 *  - a real dedicated worker with its own `performance.timeOrigin`, which is
 *    why stage 8 is derived rather than timestamped across the boundary;
 *  - a real structured clone of the snapshot, carrying `timings` and
 *    `workerTimings` as plain data;
 *  - the real three-pass widening, so the per-ring tagging is exercised;
 *  - and the real reconciliation, against a wall clock the page measures.
 *
 * A unit test can assert the arithmetic. Only this can assert that the numbers
 * survive the trip and add up on the other side.
 */

import { test, expect } from "@playwright/test";
import { AT_FIXTURE, stubNetwork, waitForRefresh } from "./fixtures.js";

/** Every `click ring …` line the app printed. */
function collectTimingLines(page) {
  const lines = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("click ring ")) lines.push(text);
  });
  return lines;
}

test.describe("the click-path breakdown survives the worker boundary", () => {
  test("prints one reconciling line per ring, with shares and a residual", async ({
    page,
  }) => {
    const lines = collectTimingLines(page);
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // ONE PER RING. The widening publishes three times per click and the
    // stages that only happen once (terrain join, full mesh build) are zero on
    // the later two by design — which is why the line is per pass and carries
    // its ring rather than being summed per click.
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line).toMatch(/^click ring [234]: \d+ ms total/);
      // §0.3 item 1: every stage reported with its share of the whole.
      expect(line).toMatch(/ \d+ ms \(\d+ %\)/);
      // §5: the residual is printed always, even when small.
      expect(line).toContain("residual ");
      expect(line).toContain("tiles ");
    }

    // EVERY STAGE HAS A NUMBER — which is the thing that was actually broken
    // the first time this ran, and which no unit test could have caught. The
    // fetch stages read `0 ms` with `1 unmeasured` because a REUSED dev server
    // was serving a pre-change build of the library (see
    // `reuseExistingServer` in the config, and the lessons-learned entry).
    // A run against a fresh server populates all fourteen.
    for (const line of lines) {
      expect(line, `no tile was measured in: ${line}`).not.toContain(
        "unmeasured",
      );
    }

    // **DELIBERATELY NOT ASSERTING `reconciles` HERE, and the reason matters
    // more than the assertion would.** The first real in-browser run produced a
    // residual of ~3 % — above the 20 ms / 2 % tolerance, so the line says DOES
    // NOT RECONCILE. That tolerance was always a guess (plan §10.6) and one
    // sample is not enough to re-fit it.
    //
    // The two ways to make this assertion pass are both worse than leaving it
    // out: loosening the tolerance to fit a single observation is exactly the
    // "renormalise until it closes" move the plan forbids, and asserting the
    // current behaviour would freeze a guess as a requirement. So this test
    // pins what is genuinely known — the line is emitted, complete, and
    // self-consistent — and the tolerance stays an open question for the owner
    // with a real number attached to it.
    for (const line of lines) {
      const wall = /^click ring \d+: (\d+) ms total/.exec(line)?.[1];
      expect(Number(wall)).toBeGreaterThan(0);
    }
  });

  test("names the stages the plan enumerates, including the ones that are zero", async ({
    page,
  }) => {
    // The two zeros that discriminate the plan's competing predictions: `parse`
    // is genuinely 0 on a cache hit and `terrain-wait` is 0 on a widening ring.
    // Dropping them would leave the line unable to falsify the thing it exists
    // to test, which is what the first implementation did.
    const lines = collectTimingLines(page);
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const first = lines[0] ?? "";
    for (const stage of [
      "fetch",
      "parse",
      "merge",
      "score",
      "derive",
      "terrain-wait",
      "mesh",
      "boundary",
      "draw",
    ]) {
      expect(first, `${stage} missing from: ${first}`).toContain(`${stage} `);
    }
  });
});
