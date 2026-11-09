/**
 * The add menu's file kinds as data (pure): what a picture, a sound, a
 * video or a 3D model brought in from a file starts as - standing free at
 * its station's free spot (`new-pin.ts`), or as an entry at the end of a
 * story - named after its file, with each kind's starting size and reach.
 *
 * @see new-file-item.ts.md
 */
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-assets";
import { TOUR_BLOCK_TEXT_RULES } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type {
  TourModel,
  TourObject,
  TourPicture,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourStoryBlock } from "gps-plus-slam-app-framework/ar/tour-story";

import { NARRATION_DEFAULT_RADIUS_M } from "../kinds/audio/sound-reach.js";
import { KIND_EDIT, type FileAddKind } from "../kinds/edit-kinds.js";
import { freeGeo, type NewItemInput } from "./new-pin.js";

/** A new picture's width in the world (m): a photo taken on site starts
 *  as wide (`content-placement.ts`), so both kinds of picture meet the
 *  creator at one size. */
export const NEW_PICTURE_WIDTH_M = 1;

/** A new 3D model's largest side (m): the size the model views' check
 *  page shows its stand-in at (`checks/model-views-check.ts`), about a
 *  person's height - visible from across a station, never filling it. */
export const NEW_MODEL_SIZE_M = 2;

/** A new sound's narration circle (m): the radius a sound takes when it
 *  leaves a story for the world (`kinds/audio/sound-reach.ts`). */
export const NEW_SOUND_RADIUS_M = NARRATION_DEFAULT_RADIUS_M;

/** What a file item is made of: the file's asset, its name (the item's
 *  title) and, for a video, its minted poster. */
export interface FileItemSource {
  readonly kind: FileAddKind;
  readonly asset: TourAsset;
  readonly fileName: string;
  readonly poster?: TourAsset;
}

/**
 * The title an item made from the file `fileName` takes: its name without
 * the extension, runs of spaces, dashes and underscores made one space,
 * cut to what the kind's title holds (in characters); a name that leaves
 * nothing takes the kind's word ("Sound").
 */
export function fileItemTitle(fileName: string, kind: FileAddKind): string {
  const dot = fileName.lastIndexOf(".");
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .replace(/[\s_-]+/g, " ")
    .trim();
  const max = TOUR_BLOCK_TEXT_RULES[kind].title.max;
  const cut = [...stem].slice(0, max).join("").trim();
  return cut === "" ? KIND_EDIT[kind].add.label : cut;
}

/**
 * The item `source` makes standing free in `input.station`, at its free
 * spot on the ground (`freeGeo`): a picture as a plane `NEW_PICTURE_WIDTH_M`
 * wide, a sound as a narration circle of `NEW_SOUND_RADIUS_M`, a model
 * placed at `NEW_MODEL_SIZE_M`. Null for a video: no free host draws one,
 * so it is added to a story only.
 */
export function newFileItem(
  input: NewItemInput,
  source: FileItemSource,
): TourObject | null {
  const shared = {
    id: input.id,
    title: fileItemTitle(source.fileName, source.kind),
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
  switch (source.kind) {
    case "picture": {
      const picture: TourPicture = {
        ...shared,
        kind: "picture",
        view: "plane",
        image: source.asset.id,
        widthM: NEW_PICTURE_WIDTH_M,
        imageAsset: source.asset,
      };
      return picture;
    }
    case "model": {
      const model: TourModel = {
        ...shared,
        kind: "model",
        view: "placed",
        asset: source.asset.id,
        sizeM: NEW_MODEL_SIZE_M,
      };
      return model;
    }
    case "audio":
      // The object type still says a free sound stands as a card; the
      // format and every host take it in a narration circle
      // (`TOUR_FREE_BLOCK_VIEWS`), as a sound moved out of a story does.
      return {
        ...shared,
        kind: "audio",
        view: "spot",
        audio: source.asset.id,
        radiusM: NEW_SOUND_RADIUS_M,
      } as unknown as TourObject;
    case "video":
      return null;
  }
}

/**
 * The entry `source` makes at the end of a story, id `id`: a card a
 * visitor taps on from, in its station's middle (as `newStoryEntry`), a
 * picture `NEW_PICTURE_WIDTH_M` wide, a model at `NEW_MODEL_SIZE_M`, a
 * video with its poster when one was minted.
 */
export function newFileStoryEntry(
  source: FileItemSource,
  id: string,
): TourStoryBlock {
  const shared = {
    id,
    view: "card",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    advance: { mode: "tap" },
    title: fileItemTitle(source.fileName, source.kind),
  } as const;
  switch (source.kind) {
    case "picture":
      return {
        ...shared,
        kind: "picture",
        image: source.asset.id,
        widthM: NEW_PICTURE_WIDTH_M,
      };
    case "model":
      return {
        ...shared,
        kind: "model",
        asset: source.asset.id,
        sizeM: NEW_MODEL_SIZE_M,
      };
    case "audio":
      return { ...shared, kind: "audio", audio: source.asset.id };
    case "video":
      return {
        ...shared,
        kind: "video",
        video: source.asset.id,
        ...(source.poster === undefined ? {} : { poster: source.poster.id }),
      };
  }
}
