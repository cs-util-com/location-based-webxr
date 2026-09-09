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

export interface PrintPanelDom {
  panel: HTMLDetailsElement;
  urlInput: HTMLInputElement;
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
  dom.generateButton.addEventListener("click", () => {
    // Async-UI rule: in-progress before the awaits, durable end state after.
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

  /** What `presentTour` last wrote into the input, so a second open can
   *  replace it without touching text the creator typed. */
  let lastPresented: string | null = null;

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

  return {
    presentTour: (url) => {
      const current = dom.urlInput.value.trim();
      // Replace what THIS function last prefilled, and only that (PR #434
      // review): the "don't clobber typed text" guard could not tell the
      // creator's typing from a previous prefill, so opening tour B popped
      // the panel open showing tour A's link - and "Generate QR" then
      // printed a code that launches A.
      if (current === "" || current === lastPresented) {
        dom.urlInput.value = url;
        lastPresented = url;
      }
      dom.panel.open = true;
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
