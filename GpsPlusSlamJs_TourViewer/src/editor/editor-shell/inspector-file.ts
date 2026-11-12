/**
 * The selected item's file in the inspector: which block a "File" row is
 * for and the name it shows (pure), and the row itself - its name and a
 * "Replace..." that asks the page for another file. The row carries the
 * block's id in `data-filefield`, so a file dropped on it is the item's
 * file from now on (`../file-drop.ts`).
 *
 * @see inspector-file.ts.md
 */
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStationBlocks,
  type TourStoryBlock,
} from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";

import { blockFileId } from "../../block-file.js";
import { FILE_FIELD_ATTR } from "../file-drop.js";

/** An item's file as its row shows it. */
export interface InspectorFile {
  /** The block's id (the row's `data-filefield`). */
  readonly blockId: string;
  /** The file's name: as it was brought in, else its entry's last part. */
  readonly name: string;
}

/** The `data-act` of the row's "Replace...". */
export const REPLACE_FILE_ACT = "file";

/**
 * The file of the block `selected` - a free block or one a station's
 * story shows - named by `nameOf` (the name it was brought in under) or
 * by its entry; null for nothing selected, a station, a story, a block
 * made of words, or one whose file the tour does not list.
 */
export function inspectorFileOf(
  selected: string | null,
  stations: readonly TourStation[],
  assets: readonly TourAsset[],
  nameOf: (assetId: string) => string | undefined = () => undefined,
): InspectorFile | null {
  const block = fileBlockOf(selected, stations);
  const id = block === null ? null : blockFileId(block);
  if (block === null || id === null) return null;
  const asset = assets.find((a) => a.id === id);
  if (asset === undefined) return null;
  const name = nameOf(id) ?? asset.path.slice(asset.path.lastIndexOf("/") + 1);
  return { blockId: block.id, name };
}

/** The block `id` names, free, in a folder or in a station's story; null for none
 *  (a station, a story, a code, nothing). */
export function fileBlockOf(
  id: string | null,
  stations: readonly TourStation[],
): TourBlock | TourStoryBlock | null {
  if (id === null) return null;
  for (const station of stations) {
    const block = tourStationBlocks(station).find((b) => b.id === id);
    if (block !== undefined) return block;
  }
  return null;
}

/** The row: "File", the name, and "Replace..." (`REPLACE_FILE_ACT`). */
export function fileFieldPart(file: InspectorFile): HTMLElement {
  const row = document.createElement("div");
  row.className = "filefield";
  row.setAttribute(FILE_FIELD_ATTR, file.blockId);
  const label = document.createElement("span");
  label.className = "flbl";
  label.textContent = "File";
  const name = document.createElement("span");
  name.className = "fname";
  name.textContent = file.name;
  name.title = `${file.name} - drop another file here to replace it`;
  const replace = document.createElement("button");
  replace.type = "button";
  replace.className = "act";
  replace.dataset["act"] = REPLACE_FILE_ACT;
  replace.append(shellIcon("folder"));
  const words = document.createElement("span");
  words.className = "lbl";
  words.textContent = "Replace...";
  replace.append(words);
  replace.setAttribute("aria-label", `Replace the file ${file.name}`);
  row.append(label, name, replace);
  return row;
}
