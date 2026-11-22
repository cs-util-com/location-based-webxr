/**
 * The editor's Copy and Paste, as data (pure): what Copy may put on the
 * editor's clipboard (`EditorViewState.clipboard`), and what a Paste of it
 * would do with the selection as it is - into which station, which notes
 * and which plain folders - or why it cannot. The Edit menu, the keys and
 * the page (`edit-main.ts`) read these; the document's `clipboardPasted`
 * writes the paste.
 *
 * @see clipboard.ts.md
 */
import {
  isTourFolder,
  type TourStationChild,
  tourChildPlace,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  documentObjects,
  manifestToWrite,
  type TourDocumentState,
} from "../tour-document.js";
import { FOLDER_PREFIX, selectedStationOf } from "./editor-model.js";
import type { EditorViewState } from "./editor-view.js";
import { plainFolderOf } from "./folder-commands.js";

/** What a Copy would copy: the selection ids, or why it cannot. */
export type CopyOutcome =
  | { readonly kind: "copy"; readonly ids: readonly string[] }
  | { readonly kind: "refused"; readonly reason: string };

/** A plain folder a Paste copies, by its station and its id. */
interface PastedFolder {
  readonly stationId: string;
  readonly folderId: string;
}

/** What a Paste would do: copy these notes and plain folders into the
 *  station `toStationId`, or why it cannot. */
export type PasteOutcome =
  | {
      readonly kind: "paste";
      readonly toStationId: string;
      readonly objects: readonly string[];
      readonly folders: readonly PastedFolder[];
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Said when there is nothing to copy. */
export const NOTHING_SELECTED = "Select a note or a folder to copy it";
/** Said when the selection holds what Copy does not copy. */
export const ONLY_NOTES_AND_FOLDERS = "Only notes and folders can be copied";
/** Said when the clipboard is empty. */
export const NOTHING_COPIED =
  "Nothing to paste - copy a note or a folder first";
/** Said when the selection names no station to paste into. */
export const SELECT_A_TARGET =
  "Select a station, or something in one, to paste into it";
/** Said when something copied is gone from the tour since. */
export const COPIED_GONE =
  "Something copied is no longer in the tour - copy it again";

/** A copyable selection id's part: a note, or a plain folder. */
type Source =
  | { readonly kind: "note"; readonly id: string; readonly stationId: string }
  | {
      readonly kind: "folder";
      readonly id: string;
      readonly stationId: string;
      /** Its items at any depth and the folders inside it. */
      readonly holds: ReadonlySet<string>;
    };

/** The note or plain folder the selection id `id` names in `doc`, or
 *  null: a station, a story, a story's entry, a code, an id the tour
 *  does not hold. */
function sourceOf(doc: TourDocumentState, id: string): Source | null {
  if (id.startsWith(FOLDER_PREFIX)) {
    const folderId = id.slice(FOLDER_PREFIX.length);
    const place = plainFolderOf(doc, folderId);
    if (place === null) return null;
    return {
      kind: "folder",
      id: folderId,
      stationId: place.stationId,
      holds: new Set([
        ...place.itemIds,
        ...innerFolderIds(place.folder.children),
      ]),
    };
  }
  const object = documentObjects(doc).find((o) => o.object.id === id)?.object;
  const manifest = manifestToWrite(doc);
  if (object?.station === undefined || manifest === null) return null;
  // A story's entry belongs to its story, which Copy does not copy yet.
  if (tourChildPlace(manifest, id)?.story !== undefined) return null;
  return { kind: "note", id, stationId: object.station };
}

function innerFolderIds(children: readonly TourStationChild[]): string[] {
  return children
    .filter(isTourFolder)
    .flatMap((f) => [f.id, ...innerFolderIds(f.children)]);
}

/** The rows a Copy takes: the tree's picked rows, else the selection. */
function selectionRows(view: EditorViewState): readonly string[] {
  if (view.picked.length > 0) return view.picked;
  return view.selected === null ? [] : [view.selected];
}

/** What Copy would copy with `view`'s selection in `doc`: every picked
 *  row (or the one selected) when each is a note or a plain folder;
 *  refused for nothing selected and for any other row among them. */
export function copyOf(
  doc: TourDocumentState,
  view: EditorViewState,
): CopyOutcome {
  const rows = selectionRows(view);
  if (rows.length === 0) return { kind: "refused", reason: NOTHING_SELECTED };
  if (rows.some((id) => sourceOf(doc, id) === null)) {
    return { kind: "refused", reason: ONLY_NOTES_AND_FOLDERS };
  }
  return { kind: "copy", ids: rows };
}

/**
 * What a Paste of `view`'s clipboard would do in `doc` with `view`'s
 * selection: its notes and plain folders, each once - one inside a
 * copied folder goes with that folder - into the station the selection
 * names (`selectedStationOf`: a station, or the one holding the selected
 * row). Refused for an empty clipboard, for a selection that names no
 * station, and for anything copied the tour no longer holds (the
 * clipboard holds ids, so it is re-checked here, at every paste).
 */
export function pasteOf(
  doc: TourDocumentState,
  view: EditorViewState,
): PasteOutcome {
  const clipboard = view.clipboard;
  if (clipboard === null) return { kind: "refused", reason: NOTHING_COPIED };
  const toStationId = selectedStationOf(view.selected, manifestToWrite(doc));
  if (toStationId === null) {
    return { kind: "refused", reason: SELECT_A_TARGET };
  }
  const sources = clipboard.ids.map((id) => sourceOf(doc, id));
  const known = sources.filter((s): s is Source => s !== null);
  if (known.length !== sources.length) {
    return { kind: "refused", reason: COPIED_GONE };
  }
  const inCopiedFolder = (id: string) =>
    known.some((s) => s.kind === "folder" && s.holds.has(id));
  const kept = known.filter((s) => !inCopiedFolder(s.id));
  return {
    kind: "paste",
    toStationId,
    objects: kept.filter((s) => s.kind === "note").map((s) => s.id),
    folders: kept
      .filter((s) => s.kind === "folder")
      .map((s) => ({ stationId: s.stationId, folderId: s.id })),
  };
}
