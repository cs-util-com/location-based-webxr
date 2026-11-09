/**
 * The add of a picture, a sound, a video or a 3D model from a file - the
 * tree's add menu, the Ctrl+K palette and a file dropped on a station or
 * story row - as one flow the page wires to its session: the file picked
 * (a cancelled picker adds nothing), brought in (`addFile`: onto the shelf,
 * to be made smaller while the item already uses it), then the item made
 * (`new-file-item.ts`) and placed at the station's free spot or at the end
 * of the story, one step. While the file is read the page shows that it
 * works (`busy`), and it says the outcome either way.
 *
 * @see add-file-item.ts.md
 */
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-assets";
import type {
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourStoryBlock } from "gps-plus-slam-app-framework/ar/tour-story";

import {
  KIND_EDIT,
  storyOnlyReason,
  type FileAddKind,
} from "../kinds/edit-kinds.js";
import {
  newFileItem,
  newFileStoryEntry,
  type FileItemSource,
} from "./new-file-item.js";
import type { NewItemInput } from "./new-pin.js";

/** Where a file item goes: a station's free spot, or a story's end. */
export type FileAddTarget =
  | { readonly kind: "station"; readonly stationId: string }
  | { readonly kind: "story"; readonly storyId: string };

/** What the page lends the flow. */
export interface FileAddDeps {
  /** The file picker for `kind`; null: cancelled. */
  readonly pick: (kind: FileAddKind) => Promise<File | null>;
  /** Called once a file is chosen, before it is read; the returned
   *  function ends the in-progress state, on every outcome. */
  readonly busy: (fileName: string) => () => void;
  /** The session's `addFile` for the kinds given. */
  readonly addFile: (
    file: Blob,
    fileName: string,
    kinds: readonly TourAsset["kind"][],
  ) => Promise<
    | {
        readonly kind: "added";
        readonly asset: TourAsset;
        readonly poster?: TourAsset;
        readonly backedUp: boolean;
      }
    | { readonly kind: "refused"; readonly reason: string }
  >;
  /** Make the item from `source` and place it at `target`: one step. */
  readonly place: (
    target: FileAddTarget,
    source: FileItemSource,
  ) =>
    | { readonly kind: "added"; readonly id: string }
    | { readonly kind: "refused"; readonly reason: string };
}

/** What an add came to. `backedUp` false: the draft could not keep the
 *  file (the page says so). */
export type FileAddOutcome =
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "added";
      readonly id: string;
      readonly fileName: string;
      readonly backedUp: boolean;
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Said when reading the file failed in a way nobody foresaw. */
export const FILE_ADD_FAILED = "That file could not be added.";

/**
 * Add a `kind` item from a file at `target`: `file` when one is given (a
 * drop), else the one picked. A cancelled picker adds nothing and is
 * `cancelled`; a file the tour cannot carry, a gone station or story, or
 * an error while reading are `refused` with the words to show, nothing
 * placed. Never rejects.
 */
export async function addFileItem(
  kind: FileAddKind,
  target: FileAddTarget,
  deps: FileAddDeps,
  file?: File,
): Promise<FileAddOutcome> {
  let chosen: File | null;
  try {
    chosen = file ?? (await deps.pick(kind));
  } catch {
    return { kind: "refused", reason: FILE_ADD_FAILED };
  }
  if (chosen === null) return { kind: "cancelled" };
  const done = deps.busy(chosen.name);
  try {
    const read = await deps.addFile(chosen, chosen.name, [
      KIND_EDIT[kind].add.file,
    ]);
    if (read.kind === "refused") return read;
    const placed = deps.place(target, {
      kind,
      asset: read.asset,
      fileName: chosen.name,
      ...(read.poster === undefined ? {} : { poster: read.poster }),
    });
    if (placed.kind === "refused") return placed;
    return {
      kind: "added",
      id: placed.id,
      fileName: chosen.name,
      backedUp: read.backedUp,
    };
  } catch {
    return { kind: "refused", reason: FILE_ADD_FAILED };
  } finally {
    done();
  }
}

/** A refusal in words. */
interface Refused {
  readonly kind: "refused";
  readonly reason: string;
}

/** Said when the station an add was for went meanwhile. */
export const FILE_STATION_GONE =
  "That station is no longer in this tour - nothing was added.";

/**
 * Place the item `source` makes at `target`: at a station's free spot
 * (`newFileItem`, through `place`, the tour's own check), or at the end of
 * a story (`newFileStoryEntry`, through `addEntryToStory`). Refused, placing
 * nothing, for a station not among `stations`, for a kind that cannot
 * stand free (its row's words), and whatever the session refuses.
 */
export function placeFileItem(input: {
  readonly target: FileAddTarget;
  readonly source: FileItemSource;
  readonly stations: readonly TourStation[];
  readonly id: string;
  readonly nowIso: string;
  readonly groundAt: NewItemInput["groundAt"];
  readonly place: (object: TourObject) => { readonly kind: "placed" } | Refused;
  readonly addEntryToStory: (
    storyId: string,
    child: TourStoryBlock,
  ) => { readonly kind: "added"; readonly id: string } | Refused;
}): { readonly kind: "added"; readonly id: string } | Refused {
  const { target, source } = input;
  if (target.kind === "story") {
    return input.addEntryToStory(
      target.storyId,
      newFileStoryEntry(source, input.id),
    );
  }
  const station = input.stations.find((s) => s.id === target.stationId);
  if (station === undefined) {
    return { kind: "refused", reason: FILE_STATION_GONE };
  }
  const item = newFileItem(
    { station, id: input.id, nowIso: input.nowIso, groundAt: input.groundAt },
    source,
  );
  if (item === null) {
    return {
      kind: "refused",
      reason: `${storyOnlyReason(source.kind) ?? "It cannot stand in a station"}.`,
    };
  }
  const placed = input.place(item);
  return placed.kind === "placed" ? { kind: "added", id: item.id } : placed;
}
