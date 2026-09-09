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
  MAX_PRINTED_CODES,
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
    expect(printPdfFilename(3, 0.16)).toBe("tour-codes-3x-16cm.pdf");
    expect(printPdfFilename(1, 0.125)).toBe("tour-codes-1x-12-5cm.pdf");
  });

  it("captions each code with its number, its size and the scale rule", () => {
    // The caption is read while hanging posters, so it has to say WHICH
    // poster this is; the size and the scale rule are there because a
    // reprint from the wrong dialog settings is the failure that put the
    // whole PDF path in this round.
    expect(printedCodeCaption(2, 3, 0.16)).toBe(
      "Code 2 of 3 - 16cm - print at 100%",
    );
  });

  it("keeps captions to characters a PDF string can carry (property)", () => {
    // qr-print-pdf strips anything outside printable ASCII; a caption that
    // arrives already clean cannot lose its number to that filter.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (index, count) => {
          const caption = printedCodeCaption(index, count, 0.16);
          expect(caption).toMatch(/^[\x20-\x7e]+$/);
          expect(caption).toContain(`Code ${String(index)} `);
        },
      ),
    );
  });
});
