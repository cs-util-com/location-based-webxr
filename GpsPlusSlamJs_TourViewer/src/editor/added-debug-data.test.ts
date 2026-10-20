/**
 * The editor's "Add debug data…" words (M2 step 5 of the debug-captures
 * plan, Q-C): an added file is shown, never refused for being another
 * tour's, and the line under the debug layer says whose it is and that it
 * is shown in place of the tour's own walk.
 *
 * Why these tests matter: the added file is never saved, and the creator
 * cannot tell from the map whether the captures are this tour's - the line
 * is the only place that says so, and it must never call another tour's
 * walk this tour's.
 */
import { describe, expect, it } from "vitest";

import {
  ADD_DEBUG_LABELS,
  addedDebugLine,
  notAddedLine,
} from "./added-debug-data.js";

describe("addedDebugLine", () => {
  it("names the added file and says it is not saved with the tour", () => {
    const line = addedDebugLine({
      fileName: "castle-debug.zip",
      match: "this-tour",
      identity: { tour: "Castle", file: "castle.zip" },
      tourCarriesWalk: false,
    });
    expect(line).toBe("Added from castle-debug.zip, not saved with the tour.");
  });

  it("says a bundle saved from another tour is another tour's, naming it", () => {
    const line = addedDebugLine({
      fileName: "x-debug.zip",
      match: "other-tour",
      identity: { tour: "Harbour", file: "harbour.zip" },
      tourCarriesWalk: false,
    });
    expect(line).toBe(
      'Added from x-debug.zip, not saved with the tour. It was saved from another tour ("Harbour", harbour.zip), not this one.',
    );
    // An identity without a title or a file name says only that.
    expect(
      addedDebugLine({
        fileName: "x-debug.zip",
        match: "other-tour",
        identity: { tour: null, file: null },
        tourCarriesWalk: false,
      }),
    ).toBe(
      "Added from x-debug.zip, not saved with the tour. It was saved from another tour, not this one.",
    );
  });

  it("says a plain recording is a recording, not saved from this tour", () => {
    expect(
      addedDebugLine({
        fileName: "walk.zip",
        match: "recording",
        identity: null,
        tourCarriesWalk: false,
      }),
    ).toBe(
      "Added from walk.zip, not saved with the tour. It is a recording, not saved from this tour.",
    );
  });

  it("says the added file is shown in place of the tour's own walk", () => {
    // Why (plan M2 step 5): the creator chose the added file, so it wins -
    // and the line must say which one the map shows.
    expect(
      addedDebugLine({
        fileName: "castle-debug.zip",
        match: "this-tour",
        identity: { tour: "Castle", file: "castle.zip" },
        tourCarriesWalk: true,
      }),
    ).toBe(
      "Added from castle-debug.zip, not saved with the tour. It is shown in place of the tour's own walk.",
    );
  });
});

describe("the add's other words", () => {
  it("says why a file was not added", () => {
    expect(notAddedLine("This file carries no recording.")).toBe(
      "Not added: This file carries no recording.",
    );
  });

  it("labels the button idle and while it reads", () => {
    expect(ADD_DEBUG_LABELS).toEqual({
      idle: "Add debug data…",
      adding: "Adding the debug data…",
    });
  });
});
