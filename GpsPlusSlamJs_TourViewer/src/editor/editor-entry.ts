import type { EditorFileKind } from "./classify-editor-file.js";
import type { EditorEntryStep } from "./editor-view.js";

/** What the editor does with the files it was given, already sorted. */
export type EditorEntryPlan =
  /** Open `tour`, then add `scan` beside it when one came along. A file
   *  sorted as neither is opened too, when it is the only candidate: the
   *  open refuses it in its own words. */
  | {
      readonly kind: "open";
      readonly tour: File;
      readonly scan: File | null;
      readonly ignored: readonly IgnoredFile[];
    }
  /** Add `scan` beside the tour already open. */
  | {
      readonly kind: "add-scan";
      readonly scan: File;
      readonly ignored: readonly IgnoredFile[];
    }
  /** Nothing to do, and why in words. */
  | { readonly kind: "refuse"; readonly reason: string };

/** A file left out of the plan, and why. */
export interface IgnoredFile {
  readonly file: File;
  readonly reason: string;
}

/** Said when a scan comes without a tour to add it to. */
export function scanNeedsTourLine(fileName: string): string {
  return `${fileName} is a scan, not a tour. Open a tour or start a new one first, then add the scan to it.`;
}

/** Said when more than one tour came at once. */
export const ONE_TOUR_AT_A_TIME =
  "These are several tours. Choose one tour at a time.";

/** Said when more than one scan came at once. */
export const ONE_SCAN_AT_A_TIME =
  "These are several scans. Add one scan at a time.";

/** Said when the file list was empty. */
export const NO_FILE = "No file was given.";

/**
 * The plan for files given to the editor (chosen, or dropped on its open
 * box): at most one tour and one scan, and a scan only with a tour - the
 * one given, or the one already open (`tourOpen`). The order is forced:
 * there is no add without a tour. Pure.
 */
export function planEditorEntry(
  kinds: readonly EditorFileKind[],
  tourOpen: boolean,
): EditorEntryPlan {
  const tours = kinds.filter((k) => k.kind === "tour");
  const scans = kinds.filter((k) => k.kind === "scan");
  const neither = kinds.flatMap((k) =>
    k.kind === "neither" ? [{ file: k.file, reason: k.reason }] : [],
  );
  if (tours.length > 1) return { kind: "refuse", reason: ONE_TOUR_AT_A_TIME };
  if (scans.length > 1) return { kind: "refuse", reason: ONE_SCAN_AT_A_TIME };
  const [tour] = tours;
  const scan = scans[0]?.file ?? null;
  if (tour !== undefined) {
    return { kind: "open", tour: tour.file, scan, ignored: neither };
  }
  if (scan !== null) {
    return tourOpen
      ? { kind: "add-scan", scan, ignored: neither }
      : { kind: "refuse", reason: scanNeedsTourLine(scan.name) };
  }
  const [first, ...rest] = neither;
  if (first === undefined) return { kind: "refuse", reason: NO_FILE };
  return { kind: "open", tour: first.file, scan: null, ignored: rest };
}

/** How adding a scan ended. */
export type AddScanOutcome =
  | { readonly kind: "added" }
  | { readonly kind: "refused"; readonly reason: string };

/** How opening a tour with a scan ended. */
export type OpenWithScanOutcome =
  /** The tour did not open (the open said why); the scan was not read. */
  | { readonly kind: "not-opened" }
  /** The tour opened, and its scan (if one came) was added. */
  | { readonly kind: "opened"; readonly scanAdded: boolean }
  /** The tour opened and stays open; its scan could not be added. */
  | { readonly kind: "scan-failed"; readonly line: string };

/** Said when the tour opened but its scan was not added. */
export function scanFailedLine(fileName: string, reason: string): string {
  return `The tour is open, but the scan ${fileName} could not be added: ${reason}`;
}

/** The line shown while a tour given with a scan opens, per step. */
export function entryStepLine(
  step: EditorEntryStep,
  tourName: string,
  scanName: string,
): string {
  return step === "opening"
    ? `Opening ${tourName}, then adding the scan ${scanName}…`
    : `Adding the scan ${scanName}…`;
}

/** What {@link openWithScan} drives. */
export interface OpenWithScanDeps {
  /** Opens the tour; true when it became the open tour. */
  readonly open: (tour: File) => Promise<boolean>;
  /** Adds the scan beside the tour just opened. */
  readonly addScan: (scan: File) => Promise<AddScanOutcome>;
  /** The step shown meanwhile (the store's `entryStep`); null at the end,
   *  on every path. */
  readonly step: (step: EditorEntryStep | null) => void;
}

/**
 * Opens a tour, then adds a scan beside it, as one busy state: the step
 * goes "opening", then "adding-scan", then null, whatever happens. A tour
 * that does not open ends it before the scan is read; a scan that fails
 * keeps the tour open and says so. Never rejects: a throwing add is a
 * failed add, a throwing open a tour that did not open.
 */
export async function openWithScan(
  tour: File,
  scan: File | null,
  deps: OpenWithScanDeps,
): Promise<OpenWithScanOutcome> {
  deps.step(scan === null ? null : "opening");
  try {
    let opened: boolean;
    try {
      opened = await deps.open(tour);
    } catch {
      opened = false;
    }
    if (!opened) return { kind: "not-opened" };
    if (scan === null) return { kind: "opened", scanAdded: false };
    deps.step("adding-scan");
    let added: AddScanOutcome;
    try {
      added = await deps.addScan(scan);
    } catch (err) {
      added = {
        kind: "refused",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    return added.kind === "added"
      ? { kind: "opened", scanAdded: true }
      : { kind: "scan-failed", line: scanFailedLine(scan.name, added.reason) };
  } finally {
    deps.step(null);
  }
}
