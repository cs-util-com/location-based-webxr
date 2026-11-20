/**
 * "Start on this phone now, share later" (the setup question's fourth
 * answer, `setup-path.ts`): one tap packs a new, empty tour, saves it as a
 * zip (the save picker where the browser has one) and opens that same zip
 * as the tour - all before AR, because placing needs an open tour.
 *
 * Saved first, opened second: the saved file is what the maker keeps, and
 * Done writes the placed work into a tour zip from the open tour, so a tour
 * is never opened that has no file behind it.
 *
 * @see starter-open.ts.md
 */

import type { OpenOutcome } from "./scan-open.js";

/** The button's states (async UI feedback: in progress, then the end). */
export const STARTER_OPEN_LABELS = {
  idle: "Save a new tour zip and open it",
  saving: "Saving the tour zip...",
  opening: "Opening it...",
  opened: "Saved and opened - start creating below",
  cancelled: "Not saved - tap to try again",
  failed: "Could not save it - tap to try again",
  openFailed: "Saved, but it did not open - open the saved file instead",
} as const;

/** The file name the starter zip is saved and opened under. */
const STARTER_FILENAME = "tour.zip";

export type StarterOpenOutcome = "opened" | "cancelled" | "failed" | "busy";

export interface StarterOpen {
  /** Pack, save, then open; the button's click runs it. */
  run(): Promise<StarterOpenOutcome>;
}

export function wireStarterOpen(deps: {
  button: {
    disabled: boolean;
    textContent: string | null;
    addEventListener(type: "click", fn: () => void): void;
  };
  /** A new, empty tour (`starter-tour.ts` `packNewTour`). */
  pack: () => Promise<Blob>;
  /** Save without sharing (`seams.downloadZip`): true once delivered,
   *  false when the maker cancelled the picker. */
  save: (blob: Blob, filename: string) => Promise<boolean>;
  /** Open a file as the tour (`archive-open.ts` `openFile`). */
  open: (file: File) => Promise<OpenOutcome>;
  /** The page's error channel. */
  onError: (message: string) => void;
}): StarterOpen {
  const { button } = deps;
  let running = false;
  button.textContent = STARTER_OPEN_LABELS.idle;

  function end(label: string, outcome: StarterOpenOutcome) {
    button.textContent = label;
    button.disabled = false;
    running = false;
    return outcome;
  }

  async function run(): Promise<StarterOpenOutcome> {
    if (running) return "busy";
    running = true;
    button.disabled = true;
    button.textContent = STARTER_OPEN_LABELS.saving;
    let blob: Blob;
    try {
      blob = await deps.pack();
      if (!(await deps.save(blob, STARTER_FILENAME))) {
        return end(STARTER_OPEN_LABELS.cancelled, "cancelled");
      }
    } catch (error) {
      deps.onError(
        `The new tour zip could not be saved: ${describe(error)}. Nothing was opened.`,
      );
      return end(STARTER_OPEN_LABELS.failed, "failed");
    }
    button.textContent = STARTER_OPEN_LABELS.opening;
    let outcome: OpenOutcome;
    try {
      outcome = await deps.open(
        new File([blob], STARTER_FILENAME, { type: "application/zip" }),
      );
    } catch {
      outcome = { kind: "failed", cause: "other" };
    }
    switch (outcome.kind) {
      case "opened":
        return end(STARTER_OPEN_LABELS.opened, "opened");
      case "failed":
        deps.onError(
          `The tour zip was saved, but it did not open. Open the saved ${STARTER_FILENAME} with "The tour file is on this phone".`,
        );
        return end(STARTER_OPEN_LABELS.openFailed, "failed");
      default:
        // A newer open took over, or the maker kept another tour's
        // unsaved work: that open speaks for itself.
        return end(STARTER_OPEN_LABELS.idle, "cancelled");
    }
  }

  button.addEventListener("click", () => {
    void run();
  });
  return { run };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
