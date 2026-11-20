import { describeOpenError } from "../open-errors.js";
import type { EditorEntryStep } from "./editor-view.js";

/** How adding a scan ended. */
export type AddScanOutcome =
  | { readonly kind: "added" }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Runs one add of a scan; a throw (a read failing past its own refusals)
 * is a refusal in words, so no caller leaves it unhandled and unsaid.
 * Null - nothing added, nothing to say - passes through. Never rejects.
 */
export async function addScanSafely(
  add: () => Promise<AddScanOutcome | null>,
): Promise<AddScanOutcome | null> {
  try {
    return await add();
  } catch (err) {
    return {
      kind: "refused",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** How opening a tour with a scan ended. */
export type OpenWithScanOutcome =
  /** The tour did not open; the scan was not read. The open said why,
   *  unless it threw: then `error` is what it threw, for the page to say
   *  ({@link notOpenedLine}). */
  | { readonly kind: "not-opened"; readonly error?: unknown }
  /** The tour opened, and its scan (if one came) was added. */
  | { readonly kind: "opened"; readonly scanAdded: boolean }
  /** The tour opened and stays open; its scan could not be added. */
  | { readonly kind: "scan-failed"; readonly line: string };

/** What the page says for an open that threw (its own refusals it said
 *  itself): the error in words; null for any other outcome. */
export function notOpenedLine(outcome: OpenWithScanOutcome): string | null {
  return outcome.kind === "not-opened" && "error" in outcome
    ? describeOpenError(outcome.error)
    : null;
}

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
  /** Adds the scan beside the tour just opened; null when that tour is no
   *  longer the open one (another opened meanwhile), which says nothing:
   *  the scan was never that tour's. */
  readonly addScan: (scan: File) => Promise<AddScanOutcome | null>;
  /** The step shown meanwhile (the store's `entryStep`); null at the end,
   *  on every path. */
  readonly step: (step: EditorEntryStep | null) => void;
}

/**
 * Opens a tour, then adds a scan beside it, as one busy state: the step
 * goes "opening", then "adding-scan", then null, whatever happens. A tour
 * that does not open ends it before the scan is read; a scan that fails
 * keeps the tour open and says so. Never rejects: a throwing add is a
 * failed add, a throwing open a tour that did not open (its error carried
 * out, since an open that throws has said nothing).
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
    } catch (error) {
      return { kind: "not-opened", error };
    }
    if (!opened) return { kind: "not-opened" };
    if (scan === null) return { kind: "opened", scanAdded: false };
    deps.step("adding-scan");
    const added = await addScanSafely(() => deps.addScan(scan));
    if (added === null) return { kind: "opened", scanAdded: false };
    return added.kind === "added"
      ? { kind: "opened", scanAdded: true }
      : { kind: "scan-failed", line: scanFailedLine(scan.name, added.reason) };
  } finally {
    deps.step(null);
  }
}
