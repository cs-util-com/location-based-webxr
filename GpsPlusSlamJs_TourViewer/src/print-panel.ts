/**
 * Print the codes (creator step 3). By PDF only since polish round M0b: the
 * browser's own print dialog owns a "fit to page" that rescales the code,
 * and a rescaled code measures the world wrong (A10) - the PDF declares its
 * own page, packs a grid of codes, carries a 10 cm check bar and asks the
 * viewer not to scale (`qr-print-pdf.ts`). The panel shows one preview
 * tile per poster, renders whenever an input changes (no "Generate" button,
 * A13), and continues the open tour's numbering. Author mode reads the size
 * from the same field (one field, two consumers - DEC-F2; in centimetres,
 * `printed-side.ts`).
 */

import QRCode from "qrcode";
import {
  planPrintCode,
  printedSideCss,
} from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import {
  buildQrPrintPdf,
  maxPrintablePdfSideM,
  type PaperSize,
  type PrintablePdfCode,
} from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-pdf";

import { recheckNote, type LinkCheckResult } from "./link-check.js";
import type { ViewerMode } from "./mode.js";
import type { PdfTab } from "./seams.js";
import { codeIndexFromInput, reprintOrphanWarning } from "./qr-author-mode.js";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { readSideM } from "./printed-side.js";
import { printableLink, printedCodes, spellingOfRecord } from "./print-link.js";
import { winAnsiText } from "gps-plus-slam-app-framework/utils/qr-payload/pdf-text";
import {
  defaultPosterFields,
  readPosterFields,
  writePosterFields,
  type PosterFields,
  type PosterTextStore,
} from "./poster-text.js";

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
export function printUrlDisplay(
  tourUrl: string | null,
  options: { verified?: boolean } = {},
): {
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
    : {
        askVisible: false,
        shownVisible: true,
        // A link step 2 could not confirm (polish round M2, A16) says so
        // until the check before the PDF settles it.
        shownText:
          options.verified === false ? `${url} - not verified yet` : url,
      };
}

/**
 * The most posters one download may carry.
 *
 * Not a taste limit: each code is a separate QR build and a separate page
 * of vector rectangles, all on the main thread, so an unbounded count is a
 * frozen phone. Fifty is far past any real tour and still under a second.
 */
export const MAX_PRINTED_CODES = 50;

/**
 * How many code numbers the orphaning check will hash before giving up.
 *
 * Past it the check STAYS SILENT rather than guessing: a half-scanned
 * range can only produce a FALSE warning, and telling a creator to undo a
 * change they never made is worse than saying nothing. An arbitrary cap of
 * 24 did exactly that inside the app's own limits - 50 posters is a legal
 * set, and a measurement on poster 30 read as unreachable (PR #444
 * review).
 *
 * **It does NOT cover every run the app can produce, and the previous
 * wording claiming so was wrong** (PR #445 review). `MAX_PRINTED_CODES`
 * caps the COUNT; the start index is not capped at all - `codeIndexFromInput`
 * takes any whole number and the field carries no `max` - so a creator
 * printing code 60 is past the budget and the warning can never fire for
 * them. That is the safe direction and it is deliberate, but it is a
 * limitation rather than the closed case the comment described.
 * `orphanScanCovers` states the real rule, and is tested.
 *
 * NOT exported, deliberately. It is an alias of `MAX_PRINTED_CODES`, and
 * two exported names for one value are a duplicate export - knip fails the
 * build on it, which is how this was found. Nothing outside needs the
 * number anyway: `orphanScanCovers` is the question callers and tests
 * actually ask, and the budget is pinned from BOTH sides through it.
 */
const MAX_ORPHAN_SCAN_CODES = MAX_PRINTED_CODES;

/**
 * The highest code NUMBER a print run produces.
 *
 * The PDF numbers its posters `codeIndex .. codeIndex + count - 1`, so the
 * last one is a SUM. Taking the larger of the two inputs instead covered
 * 1..3 for a creator starting at 3 with three posters - whose posters are
 * 3, 4 and 5 - so a measurement on code 5 looked unreachable and the
 * warning fired at someone who had changed nothing (PR #443 review).
 */
export function highestPrintedCode(codeIndex: number, count: number): number {
  return codeIndex + count - 1;
}

/** How many preview tiles the panel draws; the PDF carries every poster. */
const MAX_PREVIEW_TILES = 12;

/**
 * Whether the orphaning scan reaches every poster in a print run.
 *
 * Exported because it is the CLAIM the budget makes, and a claim that
 * lives only in a comment is one no test can hold. When this is false the
 * check says nothing at all.
 */
export function orphanScanCovers(codeIndex: number, count: number): boolean {
  return highestPrintedCode(codeIndex, count) <= MAX_ORPHAN_SCAN_CODES;
}

/** The PDF button's labels through its async cycle (async-UI rule). */
const PDF_LABELS = {
  idle: "Download PDF to print",
  /** While the open tour's codes are matched to a spelling of its link. */
  matching: "Matching your printed codes…",
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

export interface PrintPanelDom {
  panel: HTMLDetailsElement;
  urlInput: HTMLInputElement;
  /** The label wrapping `urlInput`; hidden once a tour is open. */
  urlAsk: HTMLElement;
  /** The open tour's link as text, in the field's place. */
  urlShown: HTMLElement;
  /** The printed side length (cm, `printed-side.ts`) - shared with author
   *  mode's mint. */
  sizeInput: HTMLInputElement;
  codeInput: HTMLInputElement;
  info: HTMLDivElement;
  /** One preview tile per poster (up to `MAX_PREVIEW_TILES`). */
  tiles: HTMLElement;
  /** The first poster's launch link, shown (and linked) in step 2 since
   *  the r820 feedback (R6): what the codes carry. */
  urlOut: HTMLAnchorElement;
  /** How many numbered posters the PDF carries. */
  countInput: HTMLInputElement;
  /** The big - and + beside the count (r820 feedback R7). */
  countDown: HTMLButtonElement;
  countUp: HTMLButtonElement;
  /** The poster text (polish round D-P7): printed with every code. */
  posterTitle: HTMLInputElement;
  posterExplanation: HTMLInputElement;
  posterCallToAction: HTMLInputElement;
  /** The paper the PDF declares - it draws at absolute coordinates, so
   *  this is the one thing that has to be told. */
  paperSelect: HTMLSelectElement;
  pdfButton: HTMLButtonElement;
}

export interface PrintPanel {
  /** The open tour's hosting URL is what a creator prints: take it, show it
   *  in the field's place, open the panel and render the code (DEC-F2).
   *  A property, not a method: it is handed to the hooks object unbound. */
  presentTour: (url: string, options?: { verified?: boolean }) => void;
  /** No tour is open any more - a tour closed, or an open failed. The panel
   *  goes back to ASKING for the link, which is what keeps printing before
   *  hosting available for more than one page load (M3 milestone review
   *  #3). */
  presentNoTour: () => void;
  /** The open tour's codes arrived: the first poster continues their
   *  numbering (`measuredCodeIds`), unless the creator already typed a
   *  number for this tour. */
  presentCodes: () => void;
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
  /** A tab to show the PDF in, opened inside the tap (`seams.openPdfTab`);
   *  absent or null: the PDF is downloaded. */
  openPdfTab?: () => PdfTab | null;
  /** The code ids the OPEN tour already holds measurements for. Used only
   *  to warn that printing this code would orphan them. Defaults to none,
   *  so a panel wired without it simply never warns rather than warning
   *  wrongly. */
  measuredCodeIds?: () => readonly string[];
  /** The printed texts stored on those codes' levels (`qr.printed`,
   *  follow-up F2): the spelling and numbering are read from them before
   *  any is guessed. Defaults to none. */
  measuredCodeTexts?: () => readonly { id: string; text: string }[];
  /** The light link check (`link-check.ts`), run before the PDF while
   *  the link is unverified. Without it the PDF is built unchecked. */
  checkLink?: (url: string) => Promise<LinkCheckResult>;
  /** The open tour's name (its `manifest.json` title), the poster title's
   *  default. Read on each present: the manifest arrives after the open. */
  tourTitle?: () => string | null;
  /** Where the poster text is remembered per tour link; absent, it lasts
   *  the page. */
  posterStore?: PosterTextStore | undefined;
}): PrintPanel {
  const { dom, mode } = deps;
  const onLaunchUrl = deps.onLaunchUrl ?? (() => undefined);
  const downloadPdf = deps.downloadPdf ?? (() => Promise.resolve(false));
  const measuredCodeIds = deps.measuredCodeIds ?? ((): readonly string[] => []);
  const measuredCodeTexts =
    deps.measuredCodeTexts ??
    ((): readonly { id: string; text: string }[] => []);
  const creator = mode === "creator";
  /** The link step 2 handed over unconfirmed, until a check confirms it. */
  let unverifiedUrl: string | null = null;
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
      if (generation !== infoGeneration) return;
      holdInfoHeight();
      dom.info.textContent = text;
    };
  }

  /** The line under the PDF button never gets shorter while a tour is
   *  shown: with the page scrolled to its bottom, a shorter line moved the
   *  page, and the button with it, between a tap's mousedown and mouseup -
   *  the tap after editing a field missed (found by the PDF e2e on r830).
   *  Another tour lets it go (`releaseInfoHeight`). */
  function holdInfoHeight(): void {
    const height = dom.info.offsetHeight;
    const held = Number.parseFloat(dom.info.style.minHeight) || 0;
    if (height > held) dom.info.style.minHeight = `${String(height)}px`;
  }

  function releaseInfoHeight(): void {
    dom.info.style.minHeight = "";
  }

  /** The creator typed a code number for the open tour: keep it. */
  let codeTyped = false;

  /** The spelling of the link the open tour's measured codes were printed
   *  from (r820 feedback R4), once `presentCodes` found it; null: new codes
   *  print the trimmed link (`printableLink`, R5). */
  let recordLink: string | null = null;

  /** The tour link presented (`presentTour`), null when none is: the
   *  spelling search runs only for it, so a tour from a file - which asks
   *  for a link again - never inherits the previous tour's (M0c review). */
  let presentedUrl: string | null = null;

  /** The link whose codes are being matched (`presentCodes`): until it
   *  settles the warning waits and the PDF button says so, or it would
   *  print new codes from 1 and warn about the very thing R4 reported
   *  (M0c review). */
  let matching: string | null = null;

  /** The PDF button at rest: held while codes are being matched. */
  function restPdfButton(): void {
    dom.pdfButton.disabled = matching !== null;
    dom.pdfButton.textContent =
      matching === null ? PDF_LABELS.idle : PDF_LABELS.matching;
  }

  /** The measured codes the warning may speak of: none while matching. */
  const settledCodeIds = (): readonly string[] =>
    matching === null ? measuredCodeIds() : [];

  /** The link the codes carry: the spelling of record, else the field's
   *  link trimmed. */
  function printLink(): string {
    return recordLink ?? printableLink(dom.urlInput.value.trim());
  }

  /** The creator typed poster text for the open tour (or it was stored):
   *  the tour's name arriving later must not overwrite it. */
  let posterTyped = false;

  const posterInputs = [
    dom.posterTitle,
    dom.posterExplanation,
    dom.posterCallToAction,
  ] as const;

  function posterFields(): PosterFields {
    return {
      title: dom.posterTitle.value,
      explanation: dom.posterExplanation.value,
      callToAction: dom.posterCallToAction.value,
    };
  }

  function showPosterFields(fields: PosterFields): void {
    dom.posterTitle.value = fields.title;
    dom.posterExplanation.value = fields.explanation;
    dom.posterCallToAction.value = fields.callToAction;
  }

  /** No link to encode: the posters, their line and the link under them
   *  go, and a render still in flight must not paint them back. */
  function clearTiles(): void {
    renderGeneration += 1;
    dom.tiles.hidden = true;
    dom.tiles.replaceChildren();
    dom.urlOut.textContent = "";
    dom.urlOut.removeAttribute("href");
  }

  /** Redraw the tiles. `note` goes in front of the info line - the outcome
   *  of a PDF just printed, which the redraw must not wipe. */
  function regenerate(note = ""): void {
    if (dom.urlInput.value.trim() === "") {
      // A cleared field: the previous link's posters went with it (PR
      // #595 review - they stayed on screen).
      clearTiles();
      // Written first (the writer holds the line's height), then let go:
      // with no posters below there is no button to keep still.
      claimInfo()("");
      releaseInfoHeight();
      dom.info.removeAttribute("aria-busy");
      return;
    }
    const generation = ++renderGeneration;
    const claimed = claimInfo();
    const writeInfo = (text: string): void => {
      claimed(note === "" ? text : `${note} ${text}`);
      if (generation === renderGeneration)
        dom.info.removeAttribute("aria-busy");
    };
    // Async-UI rule: the line shows the codes are being drawn until they
    // are - marked busy and dimmed, its TEXT kept: the line sits under the
    // PDF button, and replacing a long line with a short one shortened the
    // page, which scrolled it and moved the button under the finger
    // between mousedown and mouseup (found by the PDF e2e on r830). Only an
    // empty line gets the words.
    dom.info.setAttribute("aria-busy", "true");
    if (dom.info.textContent === "") claimed("Drawing the codes…");
    renderTiles(
      dom,
      printLink(),
      writeInfo,
      settledCodeIds,
      () => generation === renderGeneration,
    )
      .then((launchUrl) => {
        if (generation !== renderGeneration || launchUrl === null) return;
        onLaunchUrl(launchUrl);
      })
      .catch((err: unknown) => {
        if (generation !== renderGeneration) return;
        writeInfo(err instanceof Error ? err.message : String(err));
        dom.tiles.hidden = true;
      });
  }

  /** Show one of the two spellings of the tour link (F7). */
  function showLink(tourUrl: string | null): void {
    const display = printUrlDisplay(tourUrl, {
      verified: tourUrl === null || tourUrl !== unverifiedUrl,
    });
    dom.urlAsk.hidden = !display.askVisible;
    dom.urlShown.hidden = !display.shownVisible;
    dom.urlShown.textContent = display.shownText;
  }

  /** Before the PDF, an unverified link is checked again (polish round
   *  M2): bit.ly-style links open for the author and not for visitors, and
   *  an own server's file may have been uploaded since. Resolves to the
   *  note for the info line, or null when there was nothing to check. */
  async function recheckUnverified(): Promise<string | null> {
    const url = unverifiedUrl;
    if (url === null || deps.checkLink === undefined) return null;
    const result = await deps.checkLink(url);
    if (result.ok && unverifiedUrl === url) {
      unverifiedUrl = null;
      showLink(url);
    }
    return recheckNote(result);
  }

  /** Build and offer the PDF. Async-UI rule: the in-progress state engages
   *  before the first await and the durable outcome lands in the same info
   *  line the on-page print instructions use, so an author reads one
   *  place. */
  dom.pdfButton.addEventListener("click", () => {
    const writeInfo = claimInfo();
    // BEFORE any await (polish round M0b): a tab opened later is not part
    // of the tap any more, and a pop-up blocker refuses it.
    const tab = deps.openPdfTab?.() ?? null;
    // Also before the await: a tour opened while the link is re-checked
    // replaces the field, and the PDF is the one the creator tapped for
    // (PR #585 review).
    const request = printRequest(dom, printLink(), posterFields());
    dom.pdfButton.disabled = true;
    dom.pdfButton.textContent = PDF_LABELS.busy;
    recheckUnverified()
      .then((note) =>
        buildPrintPdf(request, downloadPdf, tab).then(({ text, printed }) => {
          const outcome = note === null ? text : `${note} ${text}`;
          // The next PDF continues the numbering (F4, D-R5): two posters
          // with the same number are one code. Not when the creator typed
          // another number meanwhile, nor when nothing was printed. Read as
          // the print read it: "" and "01" are code 1 too (PR #597 review).
          const typedMeanwhile =
            codeIndexFromInput(dom.codeInput.value).codeIndex !==
            request.startIndex;
          if (!printed || typedMeanwhile) {
            writeInfo(outcome);
            return;
          }
          const next = request.startIndex + request.count;
          dom.codeInput.value = String(next);
          codeTyped = true;
          regenerate(
            `${outcome} The next PDF starts at code ${String(next)}; to print these again, set the first code number to ${String(request.startIndex)} under Settings.`,
          );
        }),
      )
      .catch((err: unknown) => {
        tab?.close();
        writeInfo(err instanceof Error ? err.message : String(err));
      })
      .finally(restPdfButton);
  });

  // A link typed into the field (no tour open) is the link: a spelling
  // found for an earlier tour no longer applies (M0c review).
  dom.urlInput.addEventListener("change", () => {
    recordLink = null;
  });

  // Every input re-renders the tiles (no Generate button since M0b, A13).
  // `change`, not `input`: a half-typed "1" must not repaint at 1 cm, and
  // `change` is what fires on blur, Enter and the spinner.
  for (const input of [
    dom.sizeInput,
    dom.codeInput,
    dom.countInput,
    dom.paperSelect,
    dom.urlInput,
  ]) {
    input.addEventListener("change", () => {
      regenerate();
    });
  }
  dom.codeInput.addEventListener("input", () => {
    codeTyped = true;
  });

  // The owner's wording from the start: a code can be printed before any
  // tour opens (flows plan DEC-F2), and its posters carry the text too.
  showPosterFields(defaultPosterFields(null));

  // The poster text: kept per tour as it is typed, the tiles redrawn when
  // a field is left.
  for (const input of posterInputs) {
    input.addEventListener("input", () => {
      posterTyped = true;
      const url = dom.urlInput.value.trim();
      if (url !== "") writePosterFields(deps.posterStore, url, posterFields());
    });
    input.addEventListener("change", () => {
      regenerate();
    });
  }

  // The stepper (r820 feedback R7): whole posters, 1 to MAX_PRINTED_CODES.
  const step = (by: number) => () => {
    const { count } = printCountFromInput(dom.countInput.value);
    const next = Math.min(MAX_PRINTED_CODES, Math.max(1, count + by));
    dom.countInput.value = String(next);
    regenerate();
  };
  dom.countDown.addEventListener("click", step(-1));
  dom.countUp.addEventListener("click", step(1));

  return {
    presentNoTour: () => {
      // The code on screen belonged to the tour that just went away.
      unverifiedUrl = null;
      recordLink = null;
      presentedUrl = null;
      matching = null;
      restPdfButton();
      releaseInfoHeight();
      showLink(null);
      clearTiles();
      // Its poster text went with it: the Finish writes the title as the
      // tour's name, so a left-over title would rename the next tour,
      // which may come from a file with no link to load its own by (M4
      // review #2). The next tour's name fills it (`presentCodes`).
      posterTyped = false;
      showPosterFields(defaultPosterFields(null));
    },
    presentCodes: () => {
      // The tour's name comes with its manifest, after the open.
      const name = deps.tourTitle?.() ?? null;
      if (!posterTyped && name !== null && dom.posterTitle.value === "") {
        dom.posterTitle.value = name.trim();
      }
      // Only for a presented tour link: a tour from a file has none.
      const url = presentedUrl;
      if (!creator || url === null) return;
      const ids = new Set(measuredCodeIds());
      if (ids.size > 0) {
        matching = url;
        restPdfButton();
      }
      printedCodes(measuredCodeTexts())
        .then((printed) =>
          spellingOfRecord(
            url,
            ids,
            async (link, index) =>
              qrCodeId((await planPrintCode(link, { codeIndex: index })).url),
            MAX_PRINTED_CODES,
            printed,
          ),
        )
        .then(({ link, next }) => {
          // Still the same tour.
          if (presentedUrl !== url) return;
          recordLink = link;
          // The numbering continues the tour's, unless one was typed.
          if (!codeTyped) dom.codeInput.value = String(next);
        })
        // No Web Crypto (a plain-http preview) or an unplannable link: the
        // numbering stays where it is, which is what the panel did before.
        .catch(() => undefined)
        .finally(() => {
          if (presentedUrl !== url) return;
          if (matching === url) matching = null;
          restPdfButton();
          regenerate();
        });
    },
    presentTour: (url, options) => {
      unverifiedUrl = options?.verified === false ? url : null;
      recordLink = null;
      presentedUrl = url;
      matching = null;
      restPdfButton();
      releaseInfoHeight();
      // A new tour: its own numbering, until its codes say otherwise.
      codeTyped = false;
      dom.codeInput.value = "1";
      // Its own poster text: what was typed for it before, else defaults.
      const stored = readPosterFields(deps.posterStore, url);
      posterTyped = stored !== null;
      showPosterFields(
        stored ?? defaultPosterFields(deps.tourTitle?.() ?? null),
      );
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
      // not for a button that makes one.
      regenerate();
    },
  };
}

/**
 * The measurement-orphaning warning for what the panel is about to print,
 * or `null`.
 *
 * Separate from the render, and OFF its critical path, for two reasons a
 * review found the hard way (PR #442):
 *
 * - It is only ever needed when the tour holds a measurement, which is the
 *   uncommon case. Hashing on every render bought nothing the rest of the
 *   time.
 * - `qrCodeId` THROWS where `crypto.subtle` is absent - a plain-http
 *   origin that is not localhost, which is exactly how the creator page is
 *   opened for a LAN preview. Letting that reject out of the render hid
 *   the code it had just drawn and made steps 1 to 3 unusable, none of
 *   which need crypto at all. A panel that cannot compute an identity
 *   simply does not warn.
 *
 * The ids are computed for every code number up to the one being printed,
 * because the question is whether the LINK still produces any measurement
 * the tour holds - not whether this particular poster does.
 */
async function orphanWarningFor(
  dom: PrintPanelDom,
  url: string,
  measured: readonly string[],
): Promise<string | null> {
  if (measured.length === 0) return null;
  const { codeIndex } = codeIndexFromInput(dom.codeInput.value);
  const { count } = printCountFromInput(dom.countInput.value);
  // A run the budget cannot cover is answered with silence, before any
  // hashing rather than after 50 rounds of it. Same outcome as the old
  // in-loop bail, minus the work.
  if (!orphanScanCovers(codeIndex, count)) return null;
  const highest = highestPrintedCode(codeIndex, count);
  try {
    // One at a time, stopping at the FIRST match. A tour with one code
    // costs one hash, which is the common case; the whole walk happens
    // only when nothing matches - that is, only when the warning is about
    // to fire anyway.
    const linkCodeIds: string[] = [];
    for (let index = 1; index <= highest; index += 1) {
      // Sequential on purpose, and the early exit is the point: the
      // common tour has one code, so this awaits once.
      const plan = await planPrintCode(url, { codeIndex: index });
      const id = await qrCodeId(plan.url);
      if (measured.includes(id)) return null;
      linkCodeIds.push(id);
    }
    return reprintOrphanWarning(linkCodeIds, measured);
  } catch {
    // No Web Crypto, or a payload that will not plan. Either way this
    // panel has nothing trustworthy to say about identity, and saying
    // nothing is the only honest option - the render must not fail for it.
    return null;
  }
}

/**
 * Draw one preview tile per poster (up to `MAX_PREVIEW_TILES`) and say
 * what the PDF will hold. Resolves the first poster's launch URL, or null
 * when a newer render took over (`current` false) before this one drew.
 */
async function renderTiles(
  dom: PrintPanelDom,
  url: string,
  writeInfo: (text: string) => void,
  measuredCodeIds: () => readonly string[],
  current: () => boolean,
): Promise<string | null> {
  const sideM = readSideM(dom.sizeInput);
  const sideCss = printedSideCss(sideM); // validates
  const { codeIndex, coerced } = codeIndexFromInput(dom.codeInput.value);
  const { count } = printCountFromInput(dom.countInput.value);
  const tiles: HTMLElement[] = [];
  let first: string | null = null;
  for (let i = 0; i < Math.min(count, MAX_PREVIEW_TILES); i += 1) {
    const index = codeIndex + i;
    // Sequential on purpose: each plan measures QR versions, and a dozen
    // at once buys nothing on a phone's single thread.
    // eslint-disable-next-line no-await-in-loop
    const plan = await planPrintCode(url, { codeIndex: index });
    const canvas = document.createElement("canvas");
    // eslint-disable-next-line no-await-in-loop
    await QRCode.toCanvas(canvas, plan.url, {
      errorCorrectionLevel: "Q",
      margin: 2,
      scale: 3,
    });
    // The QR library writes an inline pixel size onto the canvas, and an
    // inline size beats the page's CSS: the canvas then sets the width of
    // its column, and on a phone step 3 grew past the card and was clipped
    // (the owner's r819 screenshot). The stylesheet sizes it to its tile.
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
    // The first tile keeps the old canvas's test id: the e2e decodes it.
    canvas.dataset["testid"] = i === 0 ? "print-canvas" : "print-tile-canvas";
    const tile = document.createElement("figure");
    tile.className = "print-tile";
    tile.dataset["testid"] = "print-tile";
    const label = document.createElement("figcaption");
    label.textContent = `Code ${String(index)}`;
    // A small poster: the text the PDF prints around the code (D-P7).
    tile.append(
      ...posterLines(dom, "above"),
      canvas,
      ...posterLines(dom, "below"),
      label,
    );
    tiles.push(tile);
    first ??= plan.url;
  }
  if (!current() || first === null) return null;
  dom.tiles.replaceChildren(...tiles);
  dom.tiles.hidden = false;
  const paper = paperFrom(dom);
  const ceiling = maxPrintablePdfSideM(paper);
  const tooLarge =
    sideM > ceiling
      ? ` Too large for ${paper === "a4" ? "A4" : "Letter"}: up to ${printedSideCss(ceiling)} fits.`
      : "";
  const more =
    count > MAX_PREVIEW_TILES
      ? ` (the first ${String(MAX_PREVIEW_TILES)} shown)`
      : "";
  const range =
    count === 1
      ? `Code ${String(codeIndex)}`
      : `Codes ${String(codeIndex)} to ${String(codeIndex + count - 1)}${more}`;
  // The orphaning warning rides the same line: it is about the artifact
  // the creator is one tap from producing, and a second channel is a
  // second thing to not read.
  const orphan = await orphanWarningFor(dom, url, measuredCodeIds());
  writeInfo(
    `${range}, ${sideCss} each.` +
      (coerced
        ? " Note: the code number was not a whole number of 1 or more, so the codes start at 1."
        : "") +
      tooLarge +
      (orphan === null ? "" : ` ${orphan}`),
  );
  dom.urlOut.textContent = first;
  dom.urlOut.href = first;
  return first;
}

/** The tile's lines of poster text above or below its code; an empty
 *  field gives no line, as on the PDF. */
function posterLines(
  dom: PrintPanelDom,
  where: "above" | "below",
): HTMLElement[] {
  const parts =
    where === "above"
      ? ([
          ["print-tile-title", dom.posterTitle.value],
          ["print-tile-explanation", dom.posterExplanation.value],
        ] as const)
      : ([["print-tile-cta", dom.posterCallToAction.value]] as const);
  return parts
    .filter(([, text]) => text.trim() !== "")
    .map(([className, text]) => {
      const line = document.createElement("div");
      line.className = className;
      // What the PDF prints, not what was typed: a letter the PDF's font
      // has no glyph for must not show in the preview (M0c review).
      line.textContent = winAnsiText(text).trim();
      return line;
    });
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
  request: PrintRequest,
  downloadPdf: (blob: Blob, filename: string) => Promise<boolean>,
  tab: PdfTab | null,
): Promise<{ text: string; printed: boolean }> {
  const { sideM, url, count, coerced, clamped, startIndex, paper, poster } =
    request;
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
      // No line under the code (owner, on r821): the 10 cm bar says to
      // print at 100 %, and the file name names the range.
      caption: "",
    });
  }
  // Throws with the size that WOULD fit when the paper cannot hold this
  // one; that message is the useful half of the failure.
  const bytes = buildQrPrintPdf(codes, {
    sideM,
    paper,
    poster,
    captionMm: 0,
  });
  const blob = new Blob([bytes], { type: "application/pdf" });
  const filename = printPdfFilename(startIndex, count, sideM);
  const range =
    count === 1
      ? `code ${String(startIndex)}`
      : `codes ${String(startIndex)} to ${String(startIndex + count - 1)}`;
  if (tab !== null) {
    // Shown where the browser shows PDFs; its own Save keeps the file.
    tab.show(blob);
    return {
      text: `Opened ${filename} in a new tab - ${range} at ${printedSideCss(sideM)}. Print it at 100 % (actual size) and check the 10 cm bar with a ruler.${notesFor(coerced, clamped)}`,
      printed: true,
    };
  }
  const saved = await downloadPdf(blob, filename);
  const notes = notesFor(coerced, clamped);
  return {
    text: saved
      ? `Saved ${filename} - ${range} at ${printedSideCss(sideM)}. Print it at 100% scale (no fit-to-page).${notes}`
      : `The PDF was not saved.${notes}`,
    printed: saved,
  };
}

/** Everything a PDF is built from, read at the tap. */
interface PrintRequest {
  sideM: number;
  url: string;
  count: number;
  coerced: boolean;
  clamped: boolean;
  startIndex: number;
  paper: PaperSize;
  poster: PosterFields;
}

function printRequest(
  dom: PrintPanelDom,
  url: string,
  poster: PosterFields,
): PrintRequest {
  const { count, coerced, clamped } = printCountFromInput(dom.countInput.value);
  return {
    sideM: readSideM(dom.sizeInput),
    url,
    count,
    coerced,
    clamped,
    // The numbering starts where the code-number field says, so a second
    // download continues the series instead of minting another code 1. Two
    // posters carrying the same printed text are ONE code to the level
    // lookup, and the author would get one of the two positions at random.
    startIndex: codeIndexFromInput(dom.codeInput.value).codeIndex,
    paper: paperFrom(dom),
    poster,
  };
}

/** What a print run's input needed fixing, said after its outcome. */
function notesFor(coerced: boolean, clamped: boolean): string {
  return (
    (coerced
      ? " The number of posters was not a whole number of 1 or more, so one was built."
      : "") +
    (clamped
      ? ` At most ${String(MAX_PRINTED_CODES)} posters fit in one file.`
      : "")
  );
}

/** The paper the author chose; anything unrecognised is A4. */
function paperFrom(dom: PrintPanelDom): PaperSize {
  return dom.paperSelect.value === "letter" ? "letter" : "a4";
}
