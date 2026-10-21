/**
 * Why this test matters (S1 milestone review #4): a tour opened INTO a
 * running AR session is placed from the open path at once
 * (`hooks.tryPlaceTour()`), and its content lives in `tour.json`. The
 * content's placement waits while the manifest is "pending" - but only if
 * the open has SAID it is pending before it calls the trigger. Called
 * first, the trigger sees the teardown's "settled" with no manifest,
 * places nothing, and latches that for the whole session. The order is a
 * property of one function's source, which no behavioural test of the
 * open (its session is mocked away) reaches.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./archive-open.ts", import.meta.url)),
  "utf8",
);

describe("the open marks the manifest pending before it places the tour", () => {
  it("sets the pending status before the first placement trigger after the session is installed", () => {
    const installed = source.indexOf("ctx.session = opened;");
    expect(installed).toBeGreaterThan(-1);
    const after = source.slice(installed);
    const pending = after.indexOf('ctx.tourManifestStatus = "pending";');
    const trigger = after.indexOf("hooks.tryPlaceTour();");
    expect(pending).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(-1);
    expect(pending).toBeLessThan(trigger);
  });
});

describe("only the open in place marks the tour settled (follow-up F14)", () => {
  // Why: the e2e read "settled" as "this tour is open". An older open whose
  // continuations end after a newer open began must not mark the newer
  // one settled before its own work has run; the open's session is mocked
  // away in the behavioural tests, so the guard is pinned in the source.
  it("guards the settled mark with the open's own session", () => {
    const mark = source.indexOf('markReadiness("settled")');
    expect(mark).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, mark - 120), mark);
    expect(before).toContain("if (ctx.session === opened)");
    // And it waits for both continuations, never only one of them.
    const wait = source.lastIndexOf("Promise.allSettled([", mark);
    expect(source.slice(wait, mark)).toContain("manifestDone, levelsDone");
  });
});
