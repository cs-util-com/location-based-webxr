/**
 * The print panel's pure rules: which spelling of the tour link step 3
 * shows, the PDF's inputs, the poster range and its numbering. The DOM
 * wiring is covered by the Playwright specs (this package's unit tests are
 * pure by convention: no jsdom).
 *
 * Since polish round M0b the code is printed by PDF only: the browser's own
 * print (and the `--print-side` stylesheet the first tests here guarded,
 * second testing session F1) is gone, because its dialog owns a "fit to
 * page" that rescales the code (A10).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_PRINTED_CODES,
  highestPrintedCode,
  orphanScanCovers,
  printCountFromInput,
  printPdfFilename,
  printUrlDisplay,
} from "./print-panel.js";
import { nextCodeIndex } from "./print-link.js";

describe("printUrlDisplay (second testing session, F7)", () => {
  it("asks for the link only while no tour is open", () => {
    // Why this matters: F7 is the owner reporting that step 2 asked again
    // for the link they had just given in step 1. Once a tour is open the
    // code carries THAT link, so the field is replaced by the link as
    // text - there is nothing left to decide.
    expect(printUrlDisplay("https://h/t.zip")).toEqual({
      askVisible: false,
      shownVisible: true,
      shownText: "https://h/t.zip",
    });
  });

  it("keeps the field when no tour is open, so a code can be printed first", () => {
    // The other half, and the reason the field was not simply deleted:
    // printing the code before the zip is hosted is a flow the owner kept
    // on purpose (flows plan DEC-F2), and with no tour open this field is
    // the only place the link can come from.
    expect(printUrlDisplay(null)).toEqual({
      askVisible: true,
      shownVisible: false,
      shownText: "",
    });
    // An empty string is "no tour", not "a tour with no link": the other
    // reading leaves a creator with nowhere to type and nothing to read.
    expect(printUrlDisplay("")).toEqual({
      askVisible: true,
      shownVisible: false,
      shownText: "",
    });
  });

  it("marks a link step 2 could not confirm as not verified yet (polish round M2)", () => {
    // Why: an own server's link can come before its file, and the owner
    // asked for the link to be given once - so it reaches this step
    // unconfirmed, and that must stay visible until the check before the
    // PDF settles it.
    expect(printUrlDisplay("https://h/t.zip", { verified: false })).toEqual({
      askVisible: false,
      shownVisible: true,
      shownText: "https://h/t.zip - not verified yet",
    });
    expect(
      printUrlDisplay("https://h/t.zip", { verified: true }).shownText,
    ).toBe("https://h/t.zip");
  });

  it("never shows both spellings at once, and never neither (property)", () => {
    // The invariant that stops the two from disagreeing about which link
    // the printed code carries - and the other half, that the creator is
    // never left with no way to see or set it. A real property: this used
    // to be a four-case loop wearing the word "property", which reads as
    // covered without being it.
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (url) => {
        const view = printUrlDisplay(url);
        expect(view.askVisible).not.toBe(view.shownVisible);
        // Whatever is shown is what was given, trimmed - never invented.
        // Unconditional so the assertion cannot be skipped by the very case
        // it is meant to cover (vitest/no-conditional-expect).
        expect(view.shownText).toBe(view.shownVisible ? url?.trim() : "");
      }),
    );
  });
});

describe("the printable PDF's inputs (second testing session, M4)", () => {
  it("takes a whole number of posters, replaces nonsense with one, and caps a runaway", () => {
    // Why the cap is not taste: each poster is its own QR build and its own
    // page of vector rectangles, all on the main thread. A creator who
    // types 5000 (or leaves a stray digit) would freeze the phone they are
    // standing at a printer with.
    expect(printCountFromInput("3")).toEqual({
      count: 3,
      coerced: false,
      clamped: false,
    });
    expect(printCountFromInput("")).toEqual({
      count: 1,
      coerced: false,
      clamped: false,
    });
    for (const bad of ["0", "-2", "2.5", "abc"]) {
      expect(printCountFromInput(bad), bad).toEqual({
        count: 1,
        coerced: true,
        clamped: false,
      });
    }
    expect(printCountFromInput("5000")).toEqual({
      count: MAX_PRINTED_CODES,
      coerced: false,
      clamped: true,
    });
  });

  it("never reports a count outside 1..MAX (property)", () => {
    // The count is fed straight to a loop that builds QR codes; anything
    // outside this range is either a wasted file or a hung page.
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const { count } = printCountFromInput(raw);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(MAX_PRINTED_CODES);
      }),
    );
  });

  it("names the file after what is in it", () => {
    // A downloads folder full of `codes.pdf` is a folder of files nobody
    // can tell apart, and a creator prints several rounds.
    expect(printPdfFilename(1, 3, 0.16)).toBe("tour-codes-1-to-3-16cm.pdf");
    // A second download continues the numbering, and the name says so -
    // two files called tour-codes-3x are two files nobody can tell apart.
    expect(printPdfFilename(4, 3, 0.16)).toBe("tour-codes-4-to-6-16cm.pdf");
    expect(printPdfFilename(2, 1, 0.125)).toBe("tour-code-2-12-5cm.pdf");
  });
});

describe("the poster range a print covers", () => {
  // Why this test matters: the orphaning warning asks whether any
  // measurement is still reachable from the current link, and to ask that
  // it has to know which code NUMBERS this creator prints. The PDF numbers
  // them `startIndex .. startIndex + count - 1`, so the highest is a SUM.
  // Taking the max instead covered 1..3 for a creator starting at 3 with
  // three posters - whose posters are 3, 4 and 5 - so a measurement on
  // code 5 looked unreachable and the warning fired at someone who had
  // changed nothing (PR #443 review).
  // These used to call a two-line COPY of the rule declared in this file,
  // and so reduced to `1 + 50 - 1 === 50` and `50 > 24`: both hold for any
  // budget, so reverting the cap to 24 left the suite green. They call the
  // production functions now (PR #445 review).

  it("ends at start + count - 1, not at whichever input is larger", () => {
    expect(highestPrintedCode(3, 3)).toBe(5);
    expect(highestPrintedCode(1, 1)).toBe(1);
    expect(highestPrintedCode(1, 6)).toBe(6);
    expect(highestPrintedCode(7, 2)).toBe(8);
    // The shape that was wrong: max(3, 3) is 3, and the creator's last
    // poster is 5.
    expect(highestPrintedCode(3, 3)).toBeGreaterThan(Math.max(3, 3));
  });

  it("covers the largest run the count cap allows", () => {
    // The budget was an arbitrary 24 while the count cap is 50, so a legal
    // set - 50 posters, a measurement on poster 30 - fell outside the range
    // checked and the warning fired at a creator who had changed nothing
    // (PR #444 review). THIS is the assertion that dies if the budget goes
    // back to 24.
    // Pinned from BOTH sides, which fixes the budget exactly at the count
    // cap without exporting the constant: a run of 50 starting at 1 is
    // covered (this fails if the budget drops back to 24), and the same run
    // starting at 2 is not (this fails if the budget is ever raised past
    // the cap, which would make the check hash numbers no poster carries).
    expect(orphanScanCovers(1, MAX_PRINTED_CODES)).toBe(true);
    expect(orphanScanCovers(2, MAX_PRINTED_CODES)).toBe(false);
  });

  it("goes silent for a run it cannot cover, rather than guessing", () => {
    // The limitation the previous comment denied: the COUNT is capped, the
    // START is not, so a creator printing code 60 is past the budget. The
    // check must then say nothing - a half-scanned range can only produce a
    // false warning (PR #445 review).
    expect(orphanScanCovers(60, 1)).toBe(false);
    expect(orphanScanCovers(MAX_PRINTED_CODES, 2)).toBe(false);
    // The boundary itself is covered, which is the off-by-one this whole
    // area has now produced twice.
    expect(orphanScanCovers(MAX_PRINTED_CODES, 1)).toBe(true);
  });

  it("only ever loses coverage as the run grows", () => {
    // A property rather than a restatement of the formula: coverage is
    // monotone in both inputs. If it holds for a run, it holds for every
    // shorter run and every earlier start - so no input can be covered
    // while a smaller one is not, which is the shape both off-by-ones took.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 200 }),
        fc.integer({ min: 2, max: MAX_PRINTED_CODES }),
        (codeIndex, count) => {
          const covered = orphanScanCovers(codeIndex, count);
          // The implication is written as a disjunction rather than an
          // early return, so the assertion runs on EVERY generated case
          // including the uncovered ones. An `if` here would skip exactly
          // the inputs the property is about (vitest/no-conditional-expect,
          // and the reason this file states elsewhere).
          expect(!covered || orphanScanCovers(codeIndex, count - 1)).toBe(true);
          expect(!covered || orphanScanCovers(codeIndex - 1, count)).toBe(true);
        },
      ),
    );
  });
});

describe("nextCodeIndex (polish round M0b)", () => {
  // Why: more posters for a tour must continue its numbering. Two posters
  // with the same printed text are ONE code to the level lookup, and an
  // author who hung both would get one of the two positions at random. A
  // tour files codes under a hash of their text, so the number is found by
  // computing each number's id.
  const idOf = (index: number) => Promise.resolve(`id-${String(index)}`);

  it("continues after the highest number the tour holds, gaps included", async () => {
    expect(
      await nextCodeIndex(new Set(["id-1", "id-4", "id-2"]), idOf, 50),
    ).toBe(5);
  });

  it("starts at 1 for a tour with no codes, or none of this link's", async () => {
    expect(await nextCodeIndex(new Set(), idOf, 50)).toBe(1);
    expect(await nextCodeIndex(new Set(["other-link"]), idOf, 50)).toBe(1);
  });

  // PR #586 review: each number is a launch-URL build and a hash on the
  // main thread, run on every creator open of a tour with codes. Once every
  // id is found no higher number can match, so the common case stops.
  it("stops once every code the tour holds is found", async () => {
    const asked: number[] = [];
    const counting = (index: number) => {
      asked.push(index);
      return idOf(index);
    };
    expect(await nextCodeIndex(new Set(["id-1"]), counting, 50)).toBe(2);
    expect(asked).toEqual([1]);
  });

  it("looks no further than the limit", async () => {
    expect(await nextCodeIndex(new Set(["id-60"]), idOf, 50)).toBe(1);
    expect(await nextCodeIndex(new Set(["id-50"]), idOf, 50)).toBe(51);
  });
});
