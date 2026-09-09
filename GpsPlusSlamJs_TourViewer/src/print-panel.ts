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
}

export interface PrintPanel {
  /** The open tour's hosting URL is what a creator prints: prefill without
   *  clobbering typed text, and open the panel - the print step is the
   *  creator's next move (DEC-F2). Both modes; the `?qr=` boot lands here.
   *  A property, not a method: it is handed to the hooks object unbound. */
  presentTour: (url: string) => void;
}

export function wirePrintPanel(
  dom: PrintPanelDom,
  /** Told the printed launch URL after each generated code (the setup's
   *  "open as a visitor" link carries the same payload a scan decodes). */
  onLaunchUrl: (launchUrl: string) => void = () => undefined,
): PrintPanel {
  /** One render of the code, with the async-UI cycle around it: in-progress
   *  before the awaits, a durable end state after, and a failure that says
   *  so in the panel instead of leaving a stale code on screen. */
  function regenerate(): void {
    dom.generateButton.disabled = true;
    dom.generateButton.textContent = "Generating…";
    generatePrintCode(dom)
      .then((launchUrl) => {
        onLaunchUrl(launchUrl);
      })
      .catch((err: unknown) => {
        dom.info.textContent = err instanceof Error ? err.message : String(err);
        dom.area.hidden = true;
        dom.printButton.hidden = true;
      })
      .finally(() => {
        dom.generateButton.disabled = false;
        dom.generateButton.textContent = "Generate QR";
      });
  }

  dom.generateButton.addEventListener("click", regenerate);

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
      const display = printUrlDisplay(url);
      dom.urlAsk.hidden = !display.askVisible;
      dom.urlShown.hidden = !display.shownVisible;
      dom.urlShown.textContent = display.shownText;
      dom.panel.open = true;
      // "Show the code immediately" (F7): the creator asked for the code,
      // not for a button that makes one. The Generate button stays for the
      // print-before-hosting path and as the retry after a failure.
      regenerate();
    },
  };
}

async function generatePrintCode(dom: PrintPanelDom): Promise<string> {
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
  const warning = homePrintWarning(Number(dom.sizeInput.value));
  dom.info.textContent =
    `QR version ${String(plan.qrVersion)}, code ${String(codeIndex)}, ` +
    `prints at ${sideCss} — use 100% scale (no fit-to-page).` +
    (coerced
      ? " Note: the code number was not a whole number of 1 or more, so this printed as code 1."
      : "") +
    (warning === null ? "" : ` ${warning}`);
  dom.urlOut.textContent = plan.url;
  return plan.url;
}
