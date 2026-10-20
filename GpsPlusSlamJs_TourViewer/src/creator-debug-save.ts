/**
 * The phone's "Save the debug data" (debug-captures plan 2026-10-20-1159,
 * M2 step 3, decision E2): a Finish leaves the walk out of the tour file by
 * default, so the Done step offers it as a file of its own - the debug
 * bundle (`debug-bundle.ts`), above the host's replace steps, behind a
 * button (plan Q-F: a second automatic download may be blocked outside a
 * tap). The bundle is built from the bytes the FIRST Finish of the open
 * tour read, kept here until the tour closes - never by reading the tour
 * again: a tour opened from a link reads its cache or its URL, which after
 * a replace on Drive is another file (plan M2 step 3).
 *
 * @see creator-debug-save.ts.md
 */

import { buildDebugBundle, type DebugBundleTour } from "./debug-bundle.js";
import type { TourViewerSeams } from "./seams.js";
import type { TourSession } from "./tour-session.js";
import type { TourViewerSession } from "./tour-viewer-session.js";

/** The block in the Done step, and its line, button and status. */
export interface CreatorDebugSaveDom {
  debugSave: HTMLElement;
  debugSaveText: HTMLElement;
  debugSaveButton: HTMLButtonElement;
  debugSaveStatus: HTMLElement;
}

export const DEBUG_SAVE_LABELS = {
  line: "This tour file leaves out your debug data: the walk you recorded - the GPS track, the depth your phone measured and the camera captures it took by itself. Save it before you replace the file at your link, to keep it in a file of your own; visitors never need it.",
  idle: "Save the debug data",
  saving: "Saving the debug data…",
  again: "Save the debug data again",
  saved: (filename: string) =>
    `The debug data is saved as ${filename} - keep that file to yourself.`,
  notSaved:
    "The debug data was not saved. Save it before you replace the file at your link.",
  failed: (reason: string) => `The debug data was not saved: ${reason}`,
} as const;

/** What a Finish of the open tour hands over. */
interface FinishedForDebugSave {
  /** The open tour: its budget inflates the bytes it gave. */
  readonly session: Pick<TourSession, "budget">;
  /** The bytes the Finish read. Kept from the FIRST Finish of `session`
   *  only: a later one reads the previous Finish's file, which may lack
   *  the walk. */
  readonly source: Blob;
  /** The Finish left the walk out of the file it wrote. */
  readonly leftOut: boolean;
  /** The tour the bundle names: the newest title and file name. */
  readonly tour: DebugBundleTour;
}

export interface CreatorDebugSave {
  /** A Finish wrote the tour's file: the block shows when it left the walk
   *  out, and hides when it kept it. */
  finished(finished: FinishedForDebugSave): void;
  /** The tour closed: the block, its line and the kept bytes go. */
  reset(): void;
}

export function wireCreatorDebugSave(deps: {
  ctx: Pick<TourViewerSession, "openGeneration">;
  seams: Pick<TourViewerSeams, "downloadZip">;
  dom: CreatorDebugSaveDom;
}): CreatorDebugSave {
  const { ctx, dom, seams } = deps;
  let held: {
    readonly session: Pick<TourSession, "budget">;
    readonly source: Blob;
    tour: DebugBundleTour;
  } | null = null;
  let saving = false;
  /** Bumped by `reset`: a save that settles after it lands nothing. */
  let epoch = 0;

  function idle(label: string): void {
    dom.debugSaveButton.disabled = false;
    dom.debugSaveButton.textContent = label;
  }

  function reset(): void {
    epoch += 1;
    held = null;
    saving = false;
    dom.debugSave.hidden = true;
    dom.debugSaveStatus.textContent = "";
    idle(DEBUG_SAVE_LABELS.idle);
  }
  reset();

  dom.debugSaveButton.addEventListener("click", () => {
    const kept = held;
    if (saving || kept === null) return;
    saving = true;
    const mine = epoch;
    const openGeneration = ctx.openGeneration;
    const current = (): boolean =>
      mine === epoch && openGeneration === ctx.openGeneration;
    // The async-UI rule: busy while the bundle is built and handed over,
    // then where it went or why not, with the button back.
    dom.debugSaveButton.disabled = true;
    dom.debugSaveButton.textContent = DEBUG_SAVE_LABELS.saving;
    dom.debugSaveStatus.textContent = "";
    void (async () => {
      let line: string;
      let label: string = DEBUG_SAVE_LABELS.idle;
      try {
        const built = await buildDebugBundle(kept.source, kept.tour, {
          // The tour's own bytes are untrusted: inflated under its budget.
          budget: kept.session.budget,
        });
        if (!current()) return;
        if (built.kind === "refused") {
          line = DEBUG_SAVE_LABELS.failed(built.reason);
        } else if (await seams.downloadZip(built.blob, built.filename)) {
          line = DEBUG_SAVE_LABELS.saved(built.filename);
          label = DEBUG_SAVE_LABELS.again;
        } else {
          line = DEBUG_SAVE_LABELS.notSaved;
        }
      } catch (err) {
        line = DEBUG_SAVE_LABELS.failed(
          err instanceof Error ? err.message : String(err),
        );
      }
      if (!current()) return;
      saving = false;
      dom.debugSaveStatus.textContent = line;
      idle(label);
    })();
  });

  return {
    finished(finished) {
      if (held?.session !== finished.session) {
        held = {
          session: finished.session,
          source: finished.source,
          tour: finished.tour,
        };
      } else {
        held.tour = finished.tour;
      }
      dom.debugSave.hidden = !finished.leftOut;
      dom.debugSaveText.textContent = DEBUG_SAVE_LABELS.line;
    },
    reset,
  };
}
