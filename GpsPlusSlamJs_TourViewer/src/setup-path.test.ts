/**
 * The creator's setup path: the one question of step 1 and the checklist
 * each answer leads to.
 *
 * Why these tests matter: step 1 only routes, so the four answers ARE the
 * flow. A wrong path sends a maker who has no host yet into the link step,
 * or a maker who opened a file on this phone into a print step that cannot
 * print without a link. The answer is remembered on the device, so a
 * stored value from anywhere (an older page, a hand edit) must read as
 * "no answer" rather than as a path that does not exist.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  answerForOpenedTour,
  firstStepOf,
  parseSetupAnswer,
  readSetupAnswer,
  selectSetupAnswer,
  setupAnswered,
  setupPathReducer,
  SETUP_ANSWER_KEY,
  SETUP_ANSWERS,
  SETUP_PATHS,
  stepAfterTourOpens,
  writeSetupAnswer,
  type SetupAnswer,
} from "./setup-path.js";
import { WIZARD_STEPS } from "./wizard.js";

describe("the four answers and their checklists", () => {
  it("routes each answer to its own short checklist", () => {
    expect(SETUP_ANSWERS).toEqual([
      "share-now",
      "have-link",
      "file-here",
      "start-here",
    ]);
    expect(SETUP_PATHS["share-now"]).toEqual([
      "host",
      "link",
      "print",
      "hang",
      "measure",
      "done",
    ]);
    expect(SETUP_PATHS["have-link"]).toEqual([
      "link",
      "print",
      "hang",
      "measure",
      "done",
    ]);
    expect(SETUP_PATHS["file-here"]).toEqual(["file", "measure", "done"]);
    expect(SETUP_PATHS["start-here"]).toEqual(["starter", "measure", "done"]);
  });

  it("every path is wizard steps, each once, ending in create then done (property)", () => {
    // Why: the stage draws a path as stations on the map and Back/Next
    // walk it, so a repeated or unknown step would strand the creator, and
    // every path must reach "Start creating" and the completion step.
    fc.assert(
      fc.property(fc.constantFrom(...SETUP_ANSWERS), (answer) => {
        const path = SETUP_PATHS[answer];
        expect(new Set(path).size).toBe(path.length);
        for (const step of path) expect(WIZARD_STEPS).toContain(step);
        expect(path.slice(-2)).toEqual(["measure", "done"]);
      }),
    );
  });

  it("starts at the first step of the path, and skips the storage step for a maker who already chose one", () => {
    expect(firstStepOf("share-now", false)).toBe("host");
    expect(firstStepOf("share-now", true)).toBe("link");
    expect(firstStepOf("have-link", false)).toBe("link");
    expect(firstStepOf("file-here", true)).toBe("file");
    expect(firstStepOf("start-here", true)).toBe("starter");
  });
});

describe("a tour that opens", () => {
  it("goes on to print where a link exists, and to create where the tour is a file on this phone", () => {
    // Why: a file has no link, and a code is made from a link, so the
    // file and starter paths skip print and go straight to placing.
    expect(stepAfterTourOpens("share-now")).toBe("print");
    expect(stepAfterTourOpens("have-link")).toBe("print");
    expect(stepAfterTourOpens("file-here")).toBe("measure");
    expect(stepAfterTourOpens("start-here")).toBe("measure");
    expect(stepAfterTourOpens(null)).toBe("print");
  });

  it("keeps a chosen answer, and infers one from how a tour opened with none", () => {
    // Why: a tour can open with no answer given (a launch link, a stored
    // link, the "already have a tour" section); the checklist then follows
    // how it opened instead of showing the question over an open tour.
    expect(answerForOpenedTour(null, "link")).toBe("have-link");
    expect(answerForOpenedTour(null, "file")).toBe("file-here");
    fc.assert(
      fc.property(
        fc.constantFrom(...SETUP_ANSWERS),
        fc.constantFrom("link" as const, "file" as const),
        (answer, how) => {
          expect(answerForOpenedTour(answer, how)).toBe(answer);
        },
      ),
    );
  });
});

describe("the answer on the device", () => {
  it("parses only the four answers (property)", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null)), (raw) => {
        const parsed = parseSetupAnswer(raw);
        expect(
          parsed === null ||
            (SETUP_ANSWERS as readonly string[]).includes(raw ?? ""),
        ).toBe(true);
      }),
    );
    for (const answer of SETUP_ANSWERS) {
      expect(parseSetupAnswer(answer)).toBe(answer);
    }
    expect(parseSetupAnswer(" share-now")).toBeNull();
    expect(parseSetupAnswer("constructor")).toBeNull();
  });

  it("round-trips through the store, forgets on null, and survives a store that throws", () => {
    const items = new Map<string, string>();
    const store = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
    };
    writeSetupAnswer(store, "start-here");
    expect(items.get(SETUP_ANSWER_KEY)).toBe("start-here");
    expect(readSetupAnswer(store)).toBe("start-here");
    writeSetupAnswer(store, null);
    expect(readSetupAnswer(store)).toBeNull();

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSetupAnswer(broken)).toBeNull();
    expect(() => {
      writeSetupAnswer(broken, "file-here");
    }).not.toThrow();
    expect(readSetupAnswer(undefined)).toBeNull();
  });
});

describe("the setupPath slice", () => {
  it("holds the chosen answer, and null for the question", () => {
    let state = setupPathReducer(undefined, { type: "init" });
    expect(selectSetupAnswer({ setupPath: state })).toBeNull();
    const answers: (SetupAnswer | null)[] = ["file-here", null, "share-now"];
    for (const answer of answers) {
      state = setupPathReducer(state, setupAnswered(answer));
      expect(selectSetupAnswer({ setupPath: state })).toBe(answer);
    }
  });
});
