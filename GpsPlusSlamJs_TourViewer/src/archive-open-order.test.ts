/**
 * Why this test matters (S1 milestone review #4): a tour opened INTO a
 * running AR session is placed from the open path at once
 * (`hooks.tryPlaceTour()`), and since scan-pass S1 its recorded photos'
 * spots live in `tour.json`. The placement trigger waits while the
 * manifest is "pending" - but only if the open has SAID it is pending
 * before it calls the trigger. Called first, the trigger sees the
 * teardown's "settled" with no manifest, declines a baked tour for having
 * no recording, and latches that for the whole session. The order is a
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
