/**
 * The open dialog's drop area: every file given to it is one row with a
 * chip saying what it is (a tour, a scan, or not usable and why), and the
 * rows decide the ONE action the dialog offers. Nothing is opened until
 * that action is pressed. Pure: the rows are store state (`editor-view.ts`
 * `entryFiles`), the files themselves stay in the page's side table.
 *
 * @see entry-drop.ts.md
 */

/** What a row's file is, from its zip directory (`classify-editor-file`). */
export type EntryChip =
  /** A tour; its title and station count when its `tour.json` read cheaply. */
  | {
      readonly kind: "tour";
      readonly title: string | null;
      readonly stations: number | null;
    }
  /** A scan: a Recorder recording or a phone's debug data. */
  | { readonly kind: "scan"; readonly captures: number | null }
  /** Neither, and why in words. */
  | { readonly kind: "neither"; readonly reason: string };

/** One file in the drop area. */
export interface EntryRow {
  readonly id: string;
  readonly name: string;
  readonly chip: EntryChip;
}

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";
const isCount = (v: unknown): boolean =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0);

/** Whether `value` is a row the drop area can show: an id and a name,
 *  and a chip of a known kind with fields of their types. */
export function isEntryRow(value: unknown): value is EntryRow {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, chip } = value as Record<string, unknown>;
  if (!isText(id) || typeof name !== "string") return false;
  if (typeof chip !== "object" || chip === null) return false;
  const c = chip as Record<string, unknown>;
  if (c["kind"] === "tour") {
    return (
      (c["title"] === null || typeof c["title"] === "string") &&
      isCount(c["stations"])
    );
  }
  if (c["kind"] === "scan") return isCount(c["captures"]);
  return c["kind"] === "neither" && typeof c["reason"] === "string";
}

/** Which tour and which scan the person picked where several came. */
export interface EntryPicks {
  readonly tour: string | null;
  readonly scan: string | null;
}

/** The most files the drop area holds: a tour and a scan is the use, and
 *  every file costs a directory read. */
export const MAX_ENTRY_FILES = 8;

/** Said under the rows whenever a scan is among them. */
export const SCAN_NOTE =
  "A scan is shown while you edit. It is not part of the tour visitors get, and it is not saved into the tour file.";

/** The question a lone scan asks. */
export const SCAN_ONLY_QUESTION =
  "This is a scan, not a tour. Start a new tour on it?";

/** What the dialog offers for the rows it holds. */
export type EntryAction =
  /** No rows: the drop area waits. */
  | { readonly kind: "empty" }
  /** Rows, but none a tour or a scan. */
  | { readonly kind: "unusable"; readonly line: string }
  /** Several tours or several scans, none picked yet: the action waits. */
  | {
      readonly kind: "pick";
      readonly what: "tour" | "scan";
      readonly label: string;
    }
  /** Open `tour` (with `scan` added once it is open). */
  | {
      readonly kind: "open";
      readonly tour: string;
      readonly scan: string | null;
      readonly label: string;
    }
  /** A scan and no tour: start a new tour on it. `addToOpen`: a tour is
   *  open, so the scan may be added to it instead. */
  | {
      readonly kind: "new-tour-on-scan";
      readonly scan: string;
      readonly question: string;
      readonly label: string;
      readonly addToOpen: boolean;
    };

/** Said when the rows hold nothing to open. */
export const NOTHING_USABLE =
  "None of these files is a tour or a scan. Remove them, or drop another file.";

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** A row's chip in words: "Tour - 'Castle walk', 6 stations", "Scan - 312
 *  camera captures", "Not usable - <reason>". */
export function chipLine(chip: EntryChip): string {
  if (chip.kind === "tour") {
    const parts: string[] = [];
    if (chip.title !== null) parts.push(`'${chip.title}'`);
    if (chip.stations !== null) {
      parts.push(plural(chip.stations, "station", "stations"));
    }
    return parts.length === 0 ? "Tour" : `Tour - ${parts.join(", ")}`;
  }
  if (chip.kind === "scan") {
    if (chip.captures === null) return "Scan";
    return chip.captures === 0
      ? "Scan - no camera captures"
      : `Scan - ${plural(chip.captures, "camera capture", "camera captures")}`;
  }
  return `Not usable - ${chip.reason}`;
}

/** The one tour (or scan) of `rows`: the only one, else the picked one
 *  when it is among them, else null (several, none picked). */
function chosen(
  rows: readonly EntryRow[],
  picked: string | null,
): string | null {
  const [only] = rows;
  if (rows.length === 1 && only !== undefined) return only.id;
  return rows.some((r) => r.id === picked) ? picked : null;
}

/**
 * The one action for `rows`, with the person's picks and whether a tour is
 * open. A scan never opens as a tour; a tour opens only once picked when
 * several came; nothing acts without a press (this only says what the
 * press will do). Pure.
 */
export function planEntryAction(
  rows: readonly EntryRow[],
  picks: EntryPicks,
  tourOpen: boolean,
): EntryAction {
  if (rows.length === 0) return { kind: "empty" };
  const tours = rows.filter((r) => r.chip.kind === "tour");
  const scans = rows.filter((r) => r.chip.kind === "scan");
  if (tours.length === 0 && scans.length === 0) {
    return { kind: "unusable", line: NOTHING_USABLE };
  }
  const tour = chosen(tours, picks.tour);
  if (tours.length > 1 && tour === null) {
    return { kind: "pick", what: "tour", label: "Pick one tour above" };
  }
  const scan = chosen(scans, picks.scan);
  if (scans.length > 1 && scan === null) {
    return { kind: "pick", what: "scan", label: "Pick one scan above" };
  }
  if (tour !== null) {
    return {
      kind: "open",
      tour,
      scan,
      label: scan === null ? "Open the tour" : "Open the tour with this scan",
    };
  }
  // No tour among the rows, so a scan was chosen (the checks above).
  return {
    kind: "new-tour-on-scan",
    scan: scan ?? "",
    question: SCAN_ONLY_QUESTION,
    label: "Start a new tour on this scan",
    addToOpen: tourOpen,
  };
}
