/**
 * The phone's Finish as the document's save status says it: running, its
 * progress line, its failure line, and a Done waiting for the code being
 * measured. Pure selectors over the shared `tourDocument` slice; the
 * Finish writes these fields through `creator-document.ts`.
 *
 * @see finish-status.ts.md
 */

import { FINISH_LABELS } from "./qr-author-mode.js";
import type { TourDocumentState } from "./tour-document.js";

/** A Finish runs: it holds the page's save slot. The phone page has no
 *  other holder (no autosave, no copy), and the slot outlives a tour
 *  closed under it until that Finish lets it go. */
export function finishRunning(state: TourDocumentState): boolean {
  return state.save.by !== null;
}

/** The last Finish failed, and its failure still stands. */
export function finishFailed(state: TourDocumentState): boolean {
  return state.save.error !== null;
}

/** The running Finish's line: the opened file being read, then its
 *  entries rebuilt; "" before its first report and while none runs. */
export function finishProgressLine(state: TourDocumentState): string {
  const progress = state.save.progress;
  if (progress === null) return "";
  return progress.kind === "reading"
    ? FINISH_LABELS.reading(progress.bytes)
    : FINISH_LABELS.rebuilding(progress.done, progress.total);
}

/** The last Finish's failure as the panel says it; null while none
 *  stands. It stands until the next Finish starts or the tour closes. */
export function finishErrorLine(state: TourDocumentState): string | null {
  const { error } = state.save;
  return error === null ? null : FINISH_LABELS.failed(error);
}

/** The rebuild's progress, let through only when its whole percent
 *  changes: every dispatch wakes every store subscriber (Redux calls them
 *  all, whatever changed), so a Finish reports at most 101 rebuilding
 *  steps, 0 % to 100 %, whatever its entry count. The last report
 *  (`done === total`) is always 100 %. A total of 0 or less reads as
 *  done. One gate per Finish. */
export function createProgressGate(): (done: number, total: number) => boolean {
  let shown: number | null = null;
  return (done, total) => {
    const percent =
      total > 0
        ? Math.floor((Math.min(Math.max(done, 0), total) * 100) / total)
        : 100;
    if (percent === shown) return false;
    shown = percent;
    return true;
  };
}

/** The creator tapped Done while a code was being measured: the Finish
 *  starts once the measurement lands. */
export function finishWaitsForMeasurement(state: TourDocumentState): boolean {
  return state.save.finishWaits;
}
