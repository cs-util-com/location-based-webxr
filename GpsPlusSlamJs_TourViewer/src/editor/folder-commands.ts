/**
 * The editor's plain-folder commands, as the tree gives them: the picked
 * items grouped in a new folder, a folder taken apart, an item moved into
 * a folder or out of its folders, a folder renamed. Each is ONE undo step
 * of the tour document (its folder actions, `tour-document.ts`), and none
 * moves an item in the world. Each says what it did, or why it was not
 * possible, in a passing line (the page's toast): the tree redraws at
 * once, but a grouping or a move into a folder can happen in a folded
 * station, so the line is the outcome's one sure sign.
 *
 * @see folder-commands.ts.md
 */
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  isTourBlockChild,
  isTourFolder,
  TOUR_FOLDER_TITLE_RULE,
  type TourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { newObjectId } from "../content-placement.js";
import { objectTitle } from "../object-describe.js";
import {
  documentObjects,
  folderDropRefusal,
  groupRefusal,
  manifestToWrite,
  objectsFolderRefusal,
  tourDocumentActions,
  ungroupRefusal,
  type TourDocumentState,
} from "../tour-document.js";
import {
  folderRefusalLine,
  folderTitle,
  type FolderRefusal,
} from "../tour-folder-edit.js";
import { FOLDER_PREFIX } from "./editor-model.js";

/** A plain folder of the open tour: its station, itself, and the ids of
 *  the items it holds at any depth, in document order. */
export interface PlainFolderPlace {
  readonly stationId: string;
  readonly folder: TourFolder;
  readonly itemIds: readonly string[];
}

/** The ids of the blocks `children` holds, its folders' at any depth. */
function blockIdsIn(children: readonly TourStationChild[]): string[] {
  return children.flatMap((child) => {
    if (isTourBlockChild(child)) return [child.id];
    return isTourFolder(child) ? blockIdsIn(child.children) : [];
  });
}

/** The folder `id` in `children` at any depth, or none. */
function folderIn(
  children: readonly TourStationChild[],
  id: string,
): TourFolder | undefined {
  for (const child of children) {
    if (!isTourFolder(child)) continue;
    if (child.id === id) return child;
    const inner = folderIn(child.children, id);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/** The plain folder `folderId` of the open tour, or null (no tour open,
 *  or none of its stations holds it). */
export function plainFolderOf(
  state: TourDocumentState,
  folderId: string,
): PlainFolderPlace | null {
  for (const station of manifestToWrite(state)?.stations ?? []) {
    const folder = folderIn(station.children, folderId);
    if (folder !== undefined) {
      return {
        stationId: station.id,
        folder,
        itemIds: blockIdsIn(folder.children),
      };
    }
  }
  return null;
}

/** Said for Group with nothing picked: no folder rule refused it. */
export const NOTHING_TO_GROUP = "Pick items to group them";

/** Said for Delete on a plain folder: no delete of its own yet. */
export const FOLDER_DELETE_NOT_YET =
  "A folder cannot be deleted yet - ungroup it (Ctrl+Shift+G), then delete its items";

/** Said for Ctrl+D on a plain folder: no copy of its own yet. */
export const FOLDER_DUPLICATE_NOT_YET =
  "A folder cannot be duplicated yet - duplicate its items instead";

/** Said for a folder name over the format's cap, naming the cap. */
export const FOLDER_NAME_TOO_LONG = `That name is too long for a folder - ${String(TOUR_FOLDER_TITLE_RULE.max)} characters at most`;

/** A folder's name as the tree shows it: its title, else "Folder". */
export function folderName(folder: Pick<TourFolder, "title">): string {
  return folder.title ?? "Folder";
}

/** The name a new folder of the station takes: "Folder 1", or the next
 *  number no folder of the station is called by. */
export function nextFolderTitle(
  state: TourDocumentState,
  stationId: string,
): string {
  const station = manifestToWrite(state)?.stations.find(
    (s) => s.id === stationId,
  );
  const taken = new Set<string>();
  const visit = (children: readonly TourStationChild[]) => {
    for (const child of children) {
      if (!isTourFolder(child)) continue;
      if (child.title !== undefined) taken.add(child.title);
      visit(child.children);
    }
  };
  visit(station?.children ?? []);
  let n = 1;
  while (taken.has(`Folder ${String(n)}`)) n += 1;
  return `Folder ${String(n)}`;
}

/**
 * Why the tree's picked rows (`picked`: item ids and `folder:<id>`
 * selections) cannot be grouped, or null when they can: a folder among
 * them is one level too deep (`oneLevel`), and the items follow
 * `groupRefusal` (one station's items, none in a folder already).
 */
export function pickedGroupRefusal(
  state: TourDocumentState,
  picked: readonly string[],
): FolderRefusal | null {
  if (picked.some((id) => id.startsWith(FOLDER_PREFIX))) return "oneLevel";
  return groupRefusal(state, picked);
}

/** What the commands need of the page. */
export interface FolderCommandDeps {
  readonly getState: () => TourDocumentState;
  readonly dispatch: (action: UnknownAction) => unknown;
  /** Before each edit (the page ends a pending Undo offer). */
  readonly before: () => void;
  /** After an edit the tour took (the page refreshes and autosaves). */
  readonly changed: () => void;
  /** A passing line. */
  readonly say: (text: string) => void;
  /** A new folder's id (default: `newObjectId`). */
  readonly mint?: () => string;
}

export interface FolderCommands {
  /** The picked items in a new folder at their centroid, named
   *  `nextFolderTitle`: its id, or null when refused (said why). */
  group(picked: readonly string[]): string | null;
  /** The folder taken apart, its items and its own folders left where
   *  they stand: the ids of the items it held, or null when refused. */
  ungroup(folderId: string): readonly string[] | null;
  /** An item into the folder `folderId` (null: out of its folders, to its
   *  station's top), where it stands: whether it moved. */
  moveInto(itemId: string, folderId: string | null): boolean;
  /** The folder's name: whether it changed. A blank or unchanged name
   *  changes nothing, quietly (the tree puts the old one back). */
  rename(folderId: string, title: string): boolean;
  /** A folder at its station's top put at `index` among the station's
   *  top-level folders (the tree's drag of a folder row): whether it
   *  moved. Its own place is no step, quietly. */
  reorder(folderId: string, index: number): boolean;
  /** The folder's pivot put at the centre of its items, nothing moving
   *  (the inspector's Pivot to centre): whether it changed. Said either
   *  way; a pivot there already is no step. */
  pivotToCentre(folderId: string): boolean;
}

function counted(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${String(n)} ${many}`;
}

export function createFolderCommands(deps: FolderCommandDeps): FolderCommands {
  const mint = deps.mint ?? (() => newObjectId());

  /** `action` dispatched as one edit: whether the tour took it. */
  const edit = (action: UnknownAction): boolean => {
    deps.before();
    const before = deps.getState();
    deps.dispatch(action);
    const took = deps.getState() !== before;
    if (took) deps.changed();
    return took;
  };

  const itemTitle = (id: string): string => {
    const found = documentObjects(deps.getState()).find(
      (o) => o.object.id === id,
    );
    return found === undefined ? "The item" : objectTitle(found.object);
  };

  const refused = (reason: FolderRefusal): null => {
    deps.say(folderRefusalLine(reason));
    return null;
  };

  return {
    group(picked) {
      if (picked.length === 0) {
        deps.say(NOTHING_TO_GROUP);
        return null;
      }
      const state = deps.getState();
      const why = pickedGroupRefusal(state, picked);
      if (why !== null) return refused(why);
      const stationId = documentObjects(state).find(
        (o) => o.object.id === picked[0],
      )?.object.station;
      if (stationId === undefined) return refused("notHere");
      const title = nextFolderTitle(state, stationId);
      const folderId = mint();
      const took = edit(
        tourDocumentActions.folderGrouped({
          folderId,
          title,
          ids: [...picked],
          what: `the new folder "${title}"`,
        }),
      );
      // Not reached in practice: the reducer's other refusals are a taken
      // id and a refused title, and both are made fresh here.
      if (!took) return refused("notHere");
      deps.say(
        `Grouped ${counted(picked.length, "item", "items")} into a folder - type its name`,
      );
      return folderId;
    },
    ungroup(folderId) {
      const place = plainFolderOf(deps.getState(), folderId);
      if (place === null) return refused("gone");
      const why = ungroupRefusal(deps.getState(), place.stationId, folderId);
      if (why !== null) return refused(why);
      const took = edit(
        tourDocumentActions.folderUngrouped({
          stationId: place.stationId,
          folderId,
          what: `the ungroup of "${folderName(place.folder)}"`,
        }),
      );
      // Past both refusals, the reducer refuses only a folder it lacks.
      if (!took) return refused("gone");
      const n = place.itemIds.length;
      deps.say(
        n === 1
          ? "Ungrouped - 1 item stays where it is"
          : `Ungrouped - ${String(n)} items stay where they are`,
      );
      return place.itemIds;
    },
    moveInto(itemId, folderId) {
      const state = deps.getState();
      const title = itemTitle(itemId);
      if (folderId === null) {
        const took = edit(
          tourDocumentActions.objectsFoldered({
            ids: [itemId],
            folderId: null,
            what: `the move of "${title}" out of its folder`,
          }),
        );
        if (took) {
          deps.say(`"${title}" left the folder - kept its place in the scene`);
        }
        return took;
      }
      const why =
        folderDropRefusal(
          state,
          { kind: "item", id: itemId },
          { kind: "folder", id: folderId },
        ) ?? objectsFolderRefusal(state, [itemId], folderId);
      if (why !== null) {
        refused(why);
        return false;
      }
      const place = plainFolderOf(state, folderId);
      const name = place === null ? "Folder" : folderName(place.folder);
      const took = edit(
        tourDocumentActions.objectsFoldered({
          ids: [itemId],
          folderId,
          what: `the move of "${title}" into "${name}"`,
        }),
      );
      // Past both refusals, a move the tour does not take changes no
      // folder: the item is in that folder already, which is no failure.
      if (!took) return false;
      deps.say(`"${title}" now in "${name}" - kept its place in the scene`);
      return true;
    },
    rename(folderId, title) {
      if (title.trim() === "") return false;
      const place = plainFolderOf(deps.getState(), folderId);
      if (place === null) return false;
      const written = folderTitle(title);
      if (written === null) {
        deps.say(FOLDER_NAME_TOO_LONG);
        return false;
      }
      // The same name again (a name field left as it was) is no edit.
      if (written === place.folder.title) return false;
      return edit(
        tourDocumentActions.folderRenamed({
          stationId: place.stationId,
          folderId,
          title: written,
          what: `the name of "${folderName(place.folder)}"`,
        }),
      );
    },
    pivotToCentre(folderId) {
      const place = plainFolderOf(deps.getState(), folderId);
      if (place === null) {
        refused("gone");
        return false;
      }
      const name = folderName(place.folder);
      if (place.itemIds.length === 0) {
        deps.say(`"${name}" holds no items to centre its pivot on`);
        return false;
      }
      const took = edit(
        tourDocumentActions.folderPivotCentred({
          stationId: place.stationId,
          folderId,
          what: `the pivot of "${name}"`,
        }),
      );
      deps.say(
        took
          ? `The pivot of "${name}" stands at its items' centre - nothing moved`
          : `The pivot of "${name}" already stands at its items' centre`,
      );
      return took;
    },
    reorder(folderId, index) {
      const place = plainFolderOf(deps.getState(), folderId);
      if (place === null) {
        refused("gone");
        return false;
      }
      // The reducer refuses its own place, a nested folder and an index
      // out of range: the tree offers none of them, so each is quiet.
      return edit(
        tourDocumentActions.folderReordered({
          stationId: place.stationId,
          folderId,
          index,
          what: `the place of "${folderName(place.folder)}"`,
        }),
      );
    },
  };
}

/** The tree's rows Group and Ungroup act on: the picked rows, else the
 *  selection alone; of them only the tour's free items and plain folders
 *  (`folder:<id>`) - a station, a story, a story's entry or a code is no
 *  row to group. */
export function groupRows(
  state: TourDocumentState,
  view: {
    readonly selected: string | null;
    readonly picked: readonly string[];
  },
): string[] {
  const rows =
    view.picked.length > 0
      ? view.picked
      : view.selected === null
        ? []
        : [view.selected];
  const free = new Set(documentObjects(state).map((o) => o.object.id));
  return rows.filter((id) =>
    id.startsWith(FOLDER_PREFIX)
      ? plainFolderOf(state, id.slice(FOLDER_PREFIX.length)) !== null
      : free.has(id),
  );
}

/** The line under a single picked item. */
export const ONE_ITEM_LINE =
  "One item can be a folder too; tick more to group them.";

/** The selection bar under the tree, as drawn. */
export interface SelectionBar {
  /** Shown in the Select mode, for two rows or more, or for a folder. */
  readonly show: boolean;
  readonly count: number;
  /** Whether Group and Ungroup can be pressed. */
  readonly group: boolean;
  readonly ungroup: boolean;
  /** Done (the Select mode's end) shows. */
  readonly done: boolean;
  /** Why Group cannot be pressed, or what one row can do; or none. */
  readonly why: string | null;
}

/** The selection bar for `rows` (`groupRows`), the Select mode and the
 *  rows' group refusal (`pickedGroupRefusal`). */
export function selectionBarOf(input: {
  readonly rows: readonly string[];
  readonly selectMode: boolean;
  readonly refusal: FolderRefusal | null;
}): SelectionBar {
  const count = input.rows.length;
  const folder = input.rows.some((id) => id.startsWith(FOLDER_PREFIX));
  const why =
    input.refusal !== null && count > 0 && !(count === 1 && folder)
      ? folderRefusalLine(input.refusal)
      : count === 1 && !folder
        ? ONE_ITEM_LINE
        : null;
  return {
    show: input.selectMode || count >= 2 || folder,
    count,
    group: input.refusal === null && count >= 1,
    ungroup: folder,
    done: input.selectMode,
    why,
  };
}
