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
import { composedTourFolderScale } from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  isTourFolder,
  TOUR_FOLDER_MAX_SCALE,
  TOUR_FOLDER_MIN_SCALE,
  type TourFolder,
  type TourStationChild,
  tourChildPlace,
} from "gps-plus-slam-app-framework/ar/tour-story";

import {
  documentFrames,
  documentObjects,
  folderChainOf,
  folderChains,
  manifestToWrite,
  type TourDocumentState,
} from "../tour-document.js";
import {
  FOLDER_PREFIX,
  selectedStationOf,
  STORY_PREFIX,
} from "./editor-model.js";
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
/** Said for a note its folders resize, pasted into another station. */
export const NOTE_IN_RESIZED_FOLDER =
  "A note in a resized folder keeps its size only in its own station - copy its folder instead";
/** Said for a folder the folders around it resize past the limits. */
export const FOLDER_SCALE_TOO_FAR =
  "The folders around this folder resize it too far for another station - copy the outer folder instead";

/** How far a composed scale may sit from 1 or a limit and still count as
 *  on it: the product of the scales rounds (the document's own rule). */
const SCALE_EPSILON = 1e-9;

/** A copyable selection id's part: a note, or a plain folder; `scale` is
 *  the product of the scales of the folders it is drawn in (a folder's
 *  own included). */
type Source =
  | {
      readonly kind: "note";
      readonly id: string;
      readonly stationId: string;
      readonly scale: number;
    }
  | {
      readonly kind: "folder";
      readonly id: string;
      readonly stationId: string;
      readonly scale: number;
      /** Its items at any depth and the folders inside it. */
      readonly holds: ReadonlySet<string>;
    };

/** What `sourceOf` reads, built once per Copy or Paste. */
interface Lookup {
  readonly doc: TourDocumentState;
  readonly manifest: TourManifest | null;
  readonly objects: ReadonlyMap<string, TourObject>;
  /** Each station's plain folders as chains (`folderChains`), by id. */
  readonly chains: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly TourFolder[]>
  >;
}

function lookupOf(doc: TourDocumentState): Lookup {
  return {
    doc,
    manifest: manifestToWrite(doc),
    objects: new Map(documentObjects(doc).map((o) => [o.object.id, o.object])),
    chains: new Map(documentFrames(doc).map((f) => [f.id, folderChains(f)])),
  };
}

/** The note or plain folder the selection id `id` names, or null: a
 *  station, a story, a story's entry, a code, an id the tour does not
 *  hold. */
function sourceOf(lookup: Lookup, id: string): Source | null {
  if (id.startsWith(FOLDER_PREFIX)) {
    const folderId = id.slice(FOLDER_PREFIX.length);
    const place = plainFolderOf(lookup.doc, folderId);
    if (place === null) return null;
    const chain = lookup.chains.get(place.stationId)?.get(folderId) ?? [];
    return {
      kind: "folder",
      id: folderId,
      stationId: place.stationId,
      scale: composedTourFolderScale(chain),
      holds: new Set([
        ...place.itemIds,
        ...innerFolderIds(place.folder.children),
      ]),
    };
  }
  const object = lookup.objects.get(id);
  const station = object?.station;
  if (object === undefined || station === undefined) return null;
  if (lookup.manifest === null) return null;
  // A story's entry belongs to its story, which Copy does not copy yet.
  if (tourChildPlace(lookup.manifest, id)?.story !== undefined) return null;
  return {
    kind: "note",
    id,
    stationId: station,
    scale: composedTourFolderScale(
      folderChainOf(object, lookup.chains.get(station) ?? new Map()),
    ),
  };
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
  const lookup = lookupOf(doc);
  if (rows.some((id) => sourceOf(lookup, id) === null)) {
    return { kind: "refused", reason: ONLY_NOTES_AND_FOLDERS };
  }
  return { kind: "copy", ids: rows };
}

/** The station a Paste with `selected` goes into: a station, or the one
 *  holding the selected note or folder; null for nothing selected, for a
 *  story or a story's entry (what is pasted would not go into it), for a
 *  code and for an id the tour does not hold. */
function pasteTargetOf(lookup: Lookup, selected: string | null): string | null {
  if (selected === null || selected.startsWith(STORY_PREFIX)) return null;
  const { manifest } = lookup;
  if (
    manifest !== null &&
    tourChildPlace(manifest, selected)?.story !== undefined
  ) {
    return null;
  }
  return selectedStationOf(selected, manifest);
}

/** Why `source` cannot be pasted into another station: a note its
 *  folders resize (out of them it would change size), a folder the
 *  folders around it resize past the format's limits; null when it can. */
function crossStationRefusal(source: Source): string | null {
  if (source.kind === "note") {
    return Math.abs(source.scale - 1) > SCALE_EPSILON
      ? NOTE_IN_RESIZED_FOLDER
      : null;
  }
  const outside =
    source.scale < TOUR_FOLDER_MIN_SCALE - SCALE_EPSILON ||
    source.scale > TOUR_FOLDER_MAX_SCALE + SCALE_EPSILON;
  return outside ? FOLDER_SCALE_TOO_FAR : null;
}

/**
 * What a Paste of `view`'s clipboard would do in `doc` with `view`'s
 * selection: its notes and plain folders, each once - one inside a
 * copied folder goes with that folder - into the station the selection
 * names (`pasteTargetOf`: a station, or the one holding the selected note
 * or folder). Refused for an empty clipboard, for a selection that names
 * no station to paste into, for anything copied the tour no longer holds
 * (the clipboard holds ids, so it is re-checked here, at every paste),
 * and, into another station, for what would not keep its size there
 * (`crossStationRefusal`).
 */
export function pasteOf(
  doc: TourDocumentState,
  view: EditorViewState,
): PasteOutcome {
  const clipboard = view.clipboard;
  if (clipboard === null) return { kind: "refused", reason: NOTHING_COPIED };
  const lookup = lookupOf(doc);
  const toStationId = pasteTargetOf(lookup, view.selected);
  if (toStationId === null) {
    return { kind: "refused", reason: SELECT_A_TARGET };
  }
  const sources = clipboard.ids.map((id) => sourceOf(lookup, id));
  const known = sources.filter((s): s is Source => s !== null);
  if (known.length !== sources.length) {
    return { kind: "refused", reason: COPIED_GONE };
  }
  const inCopiedFolder = (id: string) =>
    known.some((s) => s.kind === "folder" && s.holds.has(id));
  const kept = known.filter((s) => !inCopiedFolder(s.id));
  for (const source of kept) {
    if (source.stationId === toStationId) continue;
    const reason = crossStationRefusal(source);
    if (reason !== null) return { kind: "refused", reason };
  }
  return {
    kind: "paste",
    toStationId,
    objects: kept.filter((s) => s.kind === "note").map((s) => s.id),
    folders: kept
      .filter((s) => s.kind === "folder")
      .map((s) => ({ stationId: s.stationId, folderId: s.id })),
  };
}
