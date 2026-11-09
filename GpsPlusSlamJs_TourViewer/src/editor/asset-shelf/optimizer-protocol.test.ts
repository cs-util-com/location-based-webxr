/**
 * Why these tests matter: the Worker takes messages from whatever posts to
 * it, and its sidecar promises that a non-object or an unknown message is
 * ignored rather than thrown on (a throw in the Worker's message handler
 * would surface as its error event, which the page reads as a crash and
 * retries). `inboundOf` is that promise, kept pure so it can be tested
 * without a Worker.
 */
import { describe, expect, it } from "vitest";

import { inboundOf } from "./optimizer-protocol.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";

describe("inboundOf: what the Worker takes", () => {
  it("takes a run and a cancel of the protocol", () => {
    const run = {
      type: "run",
      job: 1,
      kind: "image",
      payload: new Blob(["x"]),
      settings: OPTIMIZER_SETTINGS,
    };
    expect(inboundOf(run)).toBe(run);
    expect(inboundOf({ type: "cancel", job: 2 })).toEqual({
      type: "cancel",
      job: 2,
    });
  });

  it.each([
    ["null", null],
    ["a string", "run"],
    ["a number", 3],
    ["an unknown type", { type: "nonsense", job: 1 }],
    ["no job", { type: "cancel" }],
    ["a job that is no whole number", { type: "cancel", job: 1.5 }],
    [
      "an unknown kind",
      { type: "run", job: 1, kind: "text", settings: OPTIMIZER_SETTINGS },
    ],
    ["no settings", { type: "run", job: 1, kind: "image", settings: null }],
  ])("ignores %s", (_what, data) => {
    expect(inboundOf(data)).toBeNull();
  });
});
