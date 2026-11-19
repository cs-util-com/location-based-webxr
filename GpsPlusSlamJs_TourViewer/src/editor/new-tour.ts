import { packNewTour } from "../starter-tour.js";

/** The name a new tour suggests in the save dialog. */
export const NEW_TOUR_FILE_NAME = "new-tour.zip";

/** What making a new tour's file needs; the defaults are the real ones. */
export interface NewTourFileDeps {
  /** A fresh tour id per call (the default draws 128 random bits). */
  readonly mint?: () => string;
}

/**
 * A new, empty tour as a file the editor opens like any chosen tour. Every
 * call mints a tour id of its own, so its draft key is its own: a second
 * new tour is never offered the first one's edits.
 */
export async function newTourFile(deps: NewTourFileDeps = {}): Promise<File> {
  const blob = await packNewTour(deps.mint);
  return new File([blob], NEW_TOUR_FILE_NAME, { type: "application/zip" });
}

/** The editor's side of starting a new tour; `P` is its save-dialog pick. */
export interface StartNewTourDeps<P> {
  /** Asks where the tour is saved. Called synchronously, IN the click. */
  readonly askSaveFile: (suggestedName: string) => P;
  /** Opens the file as a chosen tour; true when it opened. */
  readonly open: (file: File) => Promise<boolean>;
  /** Keeps the opened tour in the file the dialog gave. */
  readonly keepInChosenFile: (file: File, pick: P) => void;
  /** Settles a pick nothing will be written into. */
  readonly settleUnusedPick: (pick: P) => void;
  /** Says why the new tour could not be made. */
  readonly failed: (reason: string) => void;
  readonly mint?: () => string;
}

/**
 * Starts a new, empty tour as the sample tour starts: the save dialog is
 * asked first, before any await (a browser opens it only close to a click),
 * then the tour is made and opened, then kept in the chosen file. A pick
 * the tour never reaches is settled, never left hanging.
 *
 * Resolves true when the tour opened. Never rejects.
 */
export async function startNewTour<P>(
  deps: StartNewTourDeps<P>,
): Promise<boolean> {
  const pick = deps.askSaveFile(NEW_TOUR_FILE_NAME);
  let file: File;
  try {
    file = await newTourFile({ mint: deps.mint });
  } catch (err) {
    deps.failed(err instanceof Error ? err.message : String(err));
    deps.settleUnusedPick(pick);
    return false;
  }
  let opened = false;
  try {
    opened = await deps.open(file);
  } catch (err) {
    deps.failed(err instanceof Error ? err.message : String(err));
  }
  if (opened) deps.keepInChosenFile(file, pick);
  else deps.settleUnusedPick(pick);
  return opened;
}
