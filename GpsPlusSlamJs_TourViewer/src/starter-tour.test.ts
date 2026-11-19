import { describe, expect, it } from "vitest";
import { packNewTour } from "./starter-tour.js";
import { tourFileKeyOfFile } from "./tour-session.js";

/**
 * Why this test matters: the start page's starter zip used to carry no
 * tour id, so two downloaded starters were byte-identical, opened in the
 * editor under one content key, and the second was offered the first
 * one's draft. Each starter now mints its own id.
 */
describe("the start page's starter zip", () => {
  it("opens under a key of its own on every download", async () => {
    const asFile = (blob: Blob) =>
      new File([blob], "starter.zip", { type: "application/zip" });
    const first = await tourFileKeyOfFile(asFile(await packNewTour()));
    const second = await tourFileKeyOfFile(asFile(await packNewTour()));
    expect(first).toMatch(/tour:[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});
