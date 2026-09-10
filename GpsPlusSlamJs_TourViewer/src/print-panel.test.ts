/**
 * Why these tests matter (second testing session, F1). The printed size did
 * not follow the input: the owner set 30 cm, pressed Print, and got the
 * previous size, because `--print-side` is written only inside
 * `generatePrintCode` - so Print alone reuses whatever the last *generate*
 * left behind. Nothing errors; the paper is simply the wrong size, and a
 * code printed at the wrong size is one whose pose solve assumes a length
 * the poster does not have.
 *
 * The decision is tested here as a pure function rather than through the
 * DOM: this package's unit tests are pure by convention (there is no jsdom
 * environment configured) and DOM wiring is covered by the Playwright
 * specs, which is where the click and `beforeprint` paths are asserted.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_ORPHAN_SCAN_CODES,
  MAX_PRINTED_CODES,
  highestPrintedCode,
  orphanScanCovers,
  printCountFromInput,
  printedCodeCaption,
  printedSideToApply,
  printPdfFilename,
  printUrlDisplay,
} from "./print-panel.js";

describe("printedSideToApply", () => {
  it("gives the size that is in the box, so a changed size prints changed", () => {
    // The reported bug, reduced to its decision: at print time the answer
    // must come from the input's CURRENT value, never from what generate
    // happened to leave behind.
    expect(printedSideToApply("0.3", true)).toBe("30cm");
    expect(printedSideToApply("0.25", true)).toBe("25cm");
    expect(printedSideToApply("0.2", true)).toBe("20cm");
  });

  it("gives nothing when there is no code to print", () => {
    // Why this matters: with no generated code the print stylesheet shows
    // nothing, and writing a size for a code that does not exist is a claim
    // the next generate would have to clean up.
    expect(printedSideToApply("0.3", false)).toBeNull();
  });

  it("gives nothing for a size a printer could not use", () => {
    // `printedSideCss` throws on these. At print time that must not escape
    // into a click handler: the previous value stays and the author still
    // gets their dialog. Empty is the case that matters most - the input
    // ships with a default, but a creator can clear it.
    for (const bad of ["", "0", "-1", "abc", "NaN", "Infinity"]) {
      expect(printedSideToApply(bad, true), bad).toBeNull();
    }
  });

  it("rounds the way the print stylesheet does, not the way a person would", () => {
    // Pinned because the pose solve reads this number: printedSideCss
    // rounds to 0.1 mm, so an off-step hand-typed size prints at a
    // predictable length rather than a rounded-to-the-millimetre one.
    expect(printedSideToApply("0.1634", true)).toBe("16.34cm");
  });
});

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

  it("captions each code with its number, its size and the scale rule", () => {
    // The caption is read while hanging posters, so it has to say WHICH
    // poster this is; the size and the scale rule are there because a
    // reprint from the wrong dialog settings is the failure that put the
    // whole PDF path in this round.
    // Its own NUMBER, not "2 of 3": the PDF starts where the code-number
    // field says, so "of 3" would be a claim about a series the next
    // download continues.
    expect(printedCodeCaption(2, 0.16)).toBe("Code 2 - 16cm - print at 100%");
  });

  it("keeps captions to characters a PDF string can carry (property)", () => {
    // qr-print-pdf strips anything outside printable ASCII; a caption that
    // arrives already clean cannot lose its number to that filter.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (index, _count) => {
          const caption = printedCodeCaption(index, 0.16);
          expect(caption).toMatch(/^[\x20-\x7e]+$/);
          expect(caption).toContain(`Code ${String(index)} `);
        },
      ),
    );
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
    expect(orphanScanCovers(1, MAX_PRINTED_CODES)).toBe(true);
    expect(MAX_ORPHAN_SCAN_CODES).toBeGreaterThanOrEqual(MAX_PRINTED_CODES);
  });

  it("goes silent for a run it cannot cover, rather than guessing", () => {
    // The limitation the previous comment denied: the COUNT is capped, the
    // START is not, so a creator printing code 60 is past the budget. The
    // check must then say nothing - a half-scanned range can only produce a
    // false warning (PR #445 review).
    expect(orphanScanCovers(60, 1)).toBe(false);
    expect(orphanScanCovers(MAX_ORPHAN_SCAN_CODES, 2)).toBe(false);
    // The boundary itself is covered, which is the off-by-one this whole
    // area has now produced twice.
    expect(orphanScanCovers(MAX_ORPHAN_SCAN_CODES, 1)).toBe(true);
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
