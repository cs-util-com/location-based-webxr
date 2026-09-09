/**
 * Print a code (creator step zero, owner-requested 2026-08-26; on the page
 * for everyone since the flows plan M3; its own module since M6). The
 * measured launch URL renders as a QR at the TRUE physical size on paper:
 * print CSS cm units at 100% scale, the canvas carrying the SYMBOL only
 * (margin 0) with the quiet zone as CSS padding — so the printed side equals
 * the size an author later mints with. Author mode reads the size from the
 * same input (one input, two consumers - DEC-F2).
 */

import QRCode from "qrcode";
import {
  homePrintWarning,
  planPrintCode,
  printedSideCss,
} from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import {
  buildQrPrintPdf,
  maxPrintablePdfSideM,
  type PaperSize,
  type PrintablePdfCode,
} from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-pdf";

import type { ViewerMode } from "./mode.js";
import { codeIndexFromInput } from "./qr-author-mode.js";

/**
 * The CSS side length to write into `--print-side` right now, or null to
 * leave the property alone.
 *
 * Split out and exported so the decision is unit-testable without a DOM
 * (this package's units are pure; the wiring is covered by the e2e). It
 * exists because the property used to be written ONLY when a code was
 * generated, so changing the size and pressing Print reprinted at the old
 * size - silently, since nothing about a wrong physical size throws
 * (second testing session, F1).
 *
 * @param rawSize the size input's current value, in metres.
 * @param hasCode whether a generated code is on screen; with none, the
 *   print stylesheet shows nothing and a size would be a claim about a
 *   code that does not exist.
 */
export function printedSideToApply(
  rawSize: string,
  hasCode: boolean,
): string | null {
  if (!hasCode) return null;
  try {
    // printedSideCss throws a RangeError on non-positive / non-finite; at
    // print time that must not escape into a click handler, so a size the
    // printer could not use leaves the previous value in place.
    return printedSideCss(Number(rawSize));
  } catch {
    return null;
  }
}

/**
 * Which of the two spellings of the tour link step 2 shows.
 *
 * The rule (second testing session, F7): a creator who has already given
 * the link in step 1 must not be asked for it again - so once a tour is
 * open the field is replaced by the link as read-only text. The field
 * stays for the case where no tour is open, because printing the code
 * BEFORE hosting the zip is a flow the owner kept deliberately (flows plan
 * DEC-F2). The two are never both live, which is what stops them from
 * disagreeing about which link the code carries.
 */
export function printUrlDisplay(tourUrl: string | null): {
  askVisible: boolean;
  shownVisible: boolean;
  shownText: string;
} {
  // An empty string is "no tour", not "a tour with no link": showing an
  // empty read-only line in the field's place would leave a creator with
  // nowhere to type and nothing to read.
  const url = tourUrl?.trim() ?? "";
  return url === ""
    ? { askVisible: true, shownVisible: false, shownText: "" }
    : { askVisible: false, shownVisible: true, shownText: url };
}

/**
 * The most posters one download may carry.
 *
 * Not a taste limit: each code is a separate QR build and a separate page
 * of vector rectangles, all on the main thread, so an unbounded count is a
 * frozen phone. Fifty is far past any real tour and still under a second.
 */
export const MAX_PRINTED_CODES = 50;

/** The PDF button's labels through its async cycle (async-UI rule). */
const PDF_LABELS = {
  idle: "Download PDF to print",
  busy: "Building the PDF…",
} as const;

/** How many posters to build, from what the author typed. */
export function printCountFromInput(raw: string): {
  count: number;
  /** The typed value was not a usable count and was replaced. */
  coerced: boolean;
  /** The typed value was usable but above the cap. */
  clamped: boolean;
} {
  // The same "a whole number of 1 or more, else 1" rule the code number
  // uses - one coercion, not two that can disagree.
  const { codeIndex, coerced } = codeIndexFromInput(raw);
  return codeIndex > MAX_PRINTED_CODES
    ? { count: MAX_PRINTED_CODES, coerced, clamped: true }
    : { count: codeIndex, coerced, clamped: false };
}

/** The downloaded file's name. Names the RANGE of code numbers it holds,
 *  because a creator prints several rounds and a downloads folder full of
 *  `codes.pdf` is a folder of files nobody can tell apart. */
export function printPdfFilename(
  startIndex: number,
  count: number,
  sideM: number,
): string {
  const size = printedSideCss(sideM).replace(".", "-");
  return count === 1
    ? `tour-code-${String(startIndex)}-${size}.pdf`
    : `tour-codes-${String(startIndex)}-to-${String(startIndex + count - 1)}-${size}.pdf`;
}

/**
 * The line printed under one code. ASCII only - see `qr-print-pdf.ts`.
 *
 * It names the code's own NUMBER and not "n of m": the PDF starts at
 * whatever the code-number field says, so a second download can continue
 * the numbering rather than minting duplicates of codes 1..n. Two posters
 * carrying the same printed text are one code as far as the level lookup
 * is concerned, and an author who hung them in two places would get one of
 * the two positions at random.
 */
export function printedCodeCaption(index: number, sideM: number): string {
  return `Code ${String(index)} - ${printedSideCss(sideM)} - print at 100%`;
}

export interface PrintPanelDom {
  panel: HTMLDetailsElement;
  urlInput: HTMLInputElement;
  /** The label wrapping `urlInput`; hidden once a tour is open. */
  urlAsk: HTMLElement;
  /** The open tour's link as text, in the field's place. */
  urlShown: HTMLElement;
  /** The printed side length (m) - shared with author mode's mint. */
  sizeInput: HTMLInputElement;
  codeInput: HTMLInputElement;
  generateButton: HTMLButtonElement;
  info: HTMLDivElement;
  area: HTMLDivElement;
  canvas: HTMLCanvasElement;
  printButton: HTMLButtonElement;
  urlOut: HTMLDivElement;
  /** How many numbered posters the PDF carries. */
  countInput: HTMLInputElement;
  /** The paper the PDF declares - it draws at absolute coordinates, so
   *  this is the one thing that has to be told. */
  paperSelect: HTMLSelectElement;
  pdfButton: HTMLButtonElement;
}

export interface PrintPanel {
  /** The open tour's hosting URL is what a creator prints: take it, show it
   *  in the field's place, open the panel and render the code (DEC-F2).
   *  A property, not a method: it is handed to the hooks object unbound. */
  presentTour: (url: string) => void;
  /** No tour is open any more - a tour closed, or an open failed. The panel
   *  goes back to ASKING for the link, which is what keeps printing before
   *  hosting available for more than one page load (M3 milestone review
   *  #3). */
  presentNoTour: () => void;
}

export function wirePrintPanel(deps: {
  dom: PrintPanelDom;
  /** A visitor never sees this panel; without this the `?qr=` boot would
   *  run a payload build and a full QR encode, on a phone, on the first
   *  paint, for output that is `display: none` (M3 milestone review #6). */
  mode: ViewerMode;
  /** Told the printed launch URL after each generated code (the setup's
   *  "open as a visitor" link carries the same payload a scan decodes). */
  onLaunchUrl?: (launchUrl: string) => void;
  /** Offers the built PDF; resolves false when a save picker was
   *  dismissed. Injected so the e2e fake captures it like the zip
   *  downloads. */
  downloadPdf?: (blob: Blob, filename: string) => Promise<boolean>;
}): PrintPanel {
  const { dom, mode } = deps;
  const onLaunchUrl = deps.onLaunchUrl ?? (() => undefined);
  const downloadPdf = deps.downloadPdf ?? (() => Promise.resolve(false));
  const creator = mode === "creator";
  /** One render of the code, with the async-UI cycle around it: in-progress
   *  before the awaits, a durable end state after, and a failure that says
   *  so in the panel instead of leaving a stale code on screen. */
  /** Bumped per render; every continuation checks it before touching the
   *  DOM. Two overlapping runs - two opens in a row, or an open racing a
   *  `change` on the size - otherwise settle in arbitrary order, and the
   *  loser could paint its canvas over the winner's while the panel says
   *  the winner's link. That is exactly the "the code carries one URL and
   *  the panel shows another" failure F7 is about (M3 milestone review
   *  #5). The same guard is why the button's idle state is restored only
   *  by the newest run. */
  let renderGeneration = 0;

  /**
   * Bumped by EVERY path that writes `#print-info`, not just the render.
   * The code render and the PDF build share that one line, and a 50-poster
   * build settling after a size change would otherwise overwrite the
   * current "prints at 20cm" with a stale "at 16cm" - a wrong physical
   * size claim, which is exactly the class of bug F1 was.
   */
  let infoGeneration = 0;

  /** Write the info line if nothing newer has claimed it. */
  function claimInfo(): (text: string) => void {
    const generation = ++infoGeneration;
    return (text: string) => {
      if (generation === infoGeneration) dom.info.textContent = text;
    };
  }

  function regenerate(): void {
    const generation = ++renderGeneration;
    const writeInfo = claimInfo();
    dom.generateButton.disabled = true;
    dom.generateButton.textContent = "Generating…";
    generatePrintCode(dom, writeInfo)
      .then((launchUrl) => {
        if (generation !== renderGeneration) return;
        onLaunchUrl(launchUrl);
      })
      .catch((err: unknown) => {
        if (generation !== renderGeneration) return;
        writeInfo(err instanceof Error ? err.message : String(err));
        dom.area.hidden = true;
        dom.printButton.hidden = true;
      })
      .finally(() => {
        if (generation !== renderGeneration) return;
        dom.generateButton.disabled = false;
        dom.generateButton.textContent = "Generate QR";
      });
  }

  /** Show one of the two spellings of the tour link (F7). */
  function showLink(tourUrl: string | null): void {
    const display = printUrlDisplay(tourUrl);
    dom.urlAsk.hidden = !display.askVisible;
    dom.urlShown.hidden = !display.shownVisible;
    dom.urlShown.textContent = display.shownText;
  }

  dom.generateButton.addEventListener("click", regenerate);

  /** Build and offer the PDF. Async-UI rule: the in-progress state engages
   *  before the first await and the durable outcome lands in the same info
   *  line the on-page print instructions use, so an author reads one
   *  place. */
  dom.pdfButton.addEventListener("click", () => {
    const writeInfo = claimInfo();
    dom.pdfButton.disabled = true;
    dom.pdfButton.textContent = PDF_LABELS.busy;
    buildPrintPdf(dom, downloadPdf)
      .then(writeInfo)
      .catch((err: unknown) => {
        writeInfo(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        dom.pdfButton.disabled = false;
        dom.pdfButton.textContent = PDF_LABELS.idle;
      });
  });

  /** Write the size that is in the box, if there is a code to print. */
  const applyPrintedSide = (): void => {
    const side = printedSideToApply(dom.sizeInput.value, !dom.area.hidden);
    if (side !== null) {
      document.documentElement.style.setProperty("--print-side", side);
    }
  };

  dom.printButton.addEventListener("click", () => {
    // A collapsed <details> renders nothing, and the print CSS shows only
    // #print-area - printing from a collapsed panel would print a blank page
    // (flows plan review #13).
    dom.panel.open = true;
    applyPrintedSide();
    window.print();
  });

  // The browser's own print (menu, Ctrl+P) bypasses the button: open the
  // panel before the print layout is computed, or a generated code prints
  // as a blank page (owner decision 2026-09-08, closing interview). Only
  // when a code exists - otherwise there is nothing to print anyway.
  window.addEventListener("beforeprint", () => {
    if (!dom.area.hidden) dom.panel.open = true;
    // The size has to be current by this moment for the browser's own print
    // too (menu, Ctrl+P), which never reaches the button's handler.
    applyPrintedSide();
  });

  // A changed size or code number makes the code on screen stale: it is
  // still the old number of squares, and the info line still claims the old
  // physical size. Re-render rather than leave a lie on screen. `change`,
  // not `input`: a half-typed "0.2" must not repaint at "0.", and `change`
  // is what fires on blur and on the spinner (M3 review #8 keeps the
  // Generate button as well, for the paths no event covers).
  for (const input of [dom.sizeInput, dom.codeInput]) {
    input.addEventListener("change", () => {
      if (dom.area.hidden) return; // nothing generated yet: nothing to restate
      regenerate();
    });
  }

  return {
    presentNoTour: () => {
      // The code on screen belonged to the tour that just went away.
      showLink(null);
      dom.area.hidden = true;
      dom.printButton.hidden = true;
      dom.urlOut.textContent = "";
      // A render still in flight must not paint over the cleared panel.
      renderGeneration += 1;
    },
    presentTour: (url) => {
      // The OPEN TOUR'S link wins, always. It used to be kept only when the
      // field was empty or still held a previous prefill, so as not to
      // clobber text the creator had typed (PR #434 review). Since F7 the
      // field is REPLACED by the link as text while a tour is open, and a
      // hidden field holding something else would make the code carry one
      // URL while the panel displays another - the exact disagreement the
      // one-link rule exists to prevent. Typed text is only for the case
      // where no tour is open, and an open supersedes it.
      dom.urlInput.value = url;
      // The link is settled now, so step 2 shows it rather than asking for
      // it (F7).
      showLink(url);
      // A visitor's page has no print step at all: opening and rendering it
      // is work nobody can see, on their first paint.
      if (!creator) return;
      dom.panel.open = true;
      // "Show the code immediately" (F7): the creator asked for the code,
      // not for a button that makes one. The Generate button stays for the
      // print-before-hosting path and as the retry after a failure.
      regenerate();
    },
  };
}

async function generatePrintCode(
  dom: PrintPanelDom,
  writeInfo: (text: string) => void,
): Promise<string> {
  const sideCss = printedSideCss(Number(dom.sizeInput.value)); // validates
  const { codeIndex, coerced } = codeIndexFromInput(dom.codeInput.value);
  const plan = await planPrintCode(dom.urlInput.value.trim(), { codeIndex });
  // margin 0: the canvas carries the SYMBOL only — the printed side equals
  // the size the author types when minting; the quiet zone is CSS padding.
  await QRCode.toCanvas(dom.canvas, plan.url, {
    errorCorrectionLevel: "Q",
    margin: 0,
    scale: 8,
  });
  document.documentElement.style.setProperty("--print-side", sideCss);
  dom.area.hidden = false;
  dom.printButton.hidden = false;
  // The page-fit warning rides IN #print-info, not a separate channel: it
  // must be read in the same glance as the "100% scale" instruction whose
  // combination with an oversized symbol clips the code (PR #364 review).
  const sizeM = Number(dom.sizeInput.value);
  const warning = homePrintWarning(sizeM);
  // The warning is about printing THIS PAGE from the browser's dialog,
  // whose margins are not ours. The PDF below draws its own page and fits
  // roughly 7 mm more, so a size in that band is warned about here and
  // printed correctly there - which reads as a contradiction unless the
  // line says which is which.
  const pdfCeiling = maxPrintablePdfSideM(paperFrom(dom));
  const pdfNote =
    warning !== null && sizeM <= pdfCeiling
      ? ` The PDF below prints up to ${printedSideCss(pdfCeiling)} and is not affected.`
      : "";
  writeInfo(
    `QR version ${String(plan.qrVersion)}, code ${String(codeIndex)}, ` +
      `prints at ${sideCss} — use 100% scale (no fit-to-page).` +
      (coerced
        ? " Note: the code number was not a whole number of 1 or more, so this printed as code 1."
        : "") +
      (warning === null ? "" : ` ${warning}`) +
      pdfNote,
  );
  dom.urlOut.textContent = plan.url;
  return plan.url;
}

/**
 * Build the printable PDF and hand it to the browser.
 *
 * Each poster gets its OWN payload (`planPrintCode` with its code index),
 * because the printed text is the code's identity: two posters carrying
 * the same string are one code as far as the level lookup is concerned,
 * and an author who hung them in two places would get one of the two
 * positions at random.
 *
 * @returns the line to show the author.
 */
async function buildPrintPdf(
  dom: PrintPanelDom,
  downloadPdf: (blob: Blob, filename: string) => Promise<boolean>,
): Promise<string> {
  const sideM = Number(dom.sizeInput.value);
  const url = dom.urlInput.value.trim();
  const { count, coerced, clamped } = printCountFromInput(dom.countInput.value);
  // The numbering starts where the code-number field says, so a second
  // download continues the series instead of minting another code 1. Two
  // posters carrying the same printed text are ONE code to the level
  // lookup, and the author would get one of the two positions at random.
  const { codeIndex: startIndex } = codeIndexFromInput(dom.codeInput.value);
  const paper = paperFrom(dom);
  const codes: PrintablePdfCode[] = [];
  for (let index = startIndex; index < startIndex + count; index += 1) {
    // Sequential on purpose: the payload builder measures QR versions, and
    // fifty of those at once buys nothing on a phone's single thread.
    // eslint-disable-next-line no-await-in-loop
    const plan = await planPrintCode(url, { codeIndex: index });
    const matrix = QRCode.create(plan.url, { errorCorrectionLevel: "Q" });
    codes.push({
      size: matrix.modules.size,
      modules: matrix.modules.data,
      caption: printedCodeCaption(index, sideM),
    });
  }
  // Throws with the size that WOULD fit when the paper cannot hold this
  // one; that message is the useful half of the failure.
  const bytes = buildQrPrintPdf(codes, { sideM, paper });
  const blob = new Blob([bytes], { type: "application/pdf" });
  const filename = printPdfFilename(startIndex, count, sideM);
  const saved = await downloadPdf(blob, filename);
  const notes =
    (coerced
      ? " The number of posters was not a whole number of 1 or more, so one was built."
      : "") +
    (clamped
      ? ` At most ${String(MAX_PRINTED_CODES)} posters fit in one file.`
      : "");
  const range =
    count === 1
      ? `code ${String(startIndex)}`
      : `codes ${String(startIndex)} to ${String(startIndex + count - 1)}`;
  return saved
    ? `Saved ${filename} - ${range} at ${printedSideCss(sideM)}. Print it at 100% scale (no fit-to-page).${notes}`
    : `The PDF was not saved.${notes}`;
}

/** The paper the author chose; anything unrecognised is A4. */
function paperFrom(dom: PrintPanelDom): PaperSize {
  return dom.paperSelect.value === "letter" ? "letter" : "a4";
}
