/**
 * Where a file dropped in the editor goes, read from what it was dropped
 * on, and which kind of item it makes: a station's row in the tree (its
 * free spot), a story's row (the story's end), an item's file field (the
 * item's file from now on), or anywhere else (the asset shelf only). The
 * page wires the drop (`edit-main.ts`); this reads the drawn elements'
 * data and the file's name, and changes nothing.
 *
 * @see file-drop.ts.md
 */
import { tourMediaTypeOf } from "gps-plus-slam-app-framework/ar/tour-media";

import type { TourBlockKind } from "gps-plus-slam-app-framework/ar/tour-blocks";

import {
  KIND_EDIT,
  type FileAddKind,
  type KindEditRow,
} from "../kinds/edit-kinds.js";
import type { FileAddTarget } from "./add-file-item.js";
import { STATION_PREFIX, STORY_PREFIX } from "./editor-model.js";

/** Where a dropped file is used: as an add's target, or as an item's
 *  file (`item`, the block's id); null: on the shelf only. */
export type FileDropTarget =
  FileAddTarget | { readonly kind: "item"; readonly id: string };

/** The attribute an item's file field carries: the block's id. */
export const FILE_FIELD_ATTR = "data-filefield";

/** The addable kinds made from a file, in the menu's order, with the
 *  asset kind each is made from. */
const FILE_KINDS = (Object.keys(KIND_EDIT) as TourBlockKind[]).flatMap(
  (kind) => {
    const row: KindEditRow = KIND_EDIT[kind];
    const file = row.add?.addable === true ? row.add.file : undefined;
    return file === undefined ? [] : [{ kind: kind as FileAddKind, file }];
  },
);

/** The kind of item a file of this name makes, by its extension (the
 *  tour's media allowlist); null for any file a tour does not take. */
export function fileAddKindOf(fileName: string): FileAddKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const media = tourMediaTypeOf(fileName.slice(dot + 1).toLowerCase());
  if (media === null) return null;
  return FILE_KINDS.find((row) => row.file === media.kind)?.kind ?? null;
}

/**
 * The target under `element`: an item's file field first (it sits in the
 * inspector, never in the tree), then a station's or a story's row in
 * `tree`. An item's row, a code's row or anything else is null: the file
 * goes onto the shelf only.
 */
export function fileDropTarget(
  element: Element | null,
  tree: Element,
): FileDropTarget | null {
  if (element === null) return null;
  const field = element.closest(`[${FILE_FIELD_ATTR}]`);
  const fieldId = field?.getAttribute(FILE_FIELD_ATTR);
  if (fieldId !== null && fieldId !== undefined && fieldId !== "") {
    return { kind: "item", id: fieldId };
  }
  if (!tree.contains(element)) return null;
  const select =
    element.closest<HTMLElement>("[data-select]")?.dataset["select"];
  if (select?.startsWith(STATION_PREFIX) === true) {
    const stationId = select.slice(STATION_PREFIX.length);
    return stationId === "" ? null : { kind: "station", stationId };
  }
  if (select?.startsWith(STORY_PREFIX) === true) {
    const storyId = select.slice(STORY_PREFIX.length);
    return storyId === "" ? null : { kind: "story", storyId };
  }
  return null;
}

/** Whether a drag carries files (not a row of the tree, not text). */
export function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
