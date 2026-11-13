/**
 * The 3D view's inspector, as data (pure): the selected station's, item's
 * or code's fields as the file holds them, with the values its fields
 * edit. The DOM is `shell-inspector.ts`'s.
 *
 * - A station: its name (its own, empty when untitled), "Station n of
 *   N", its description, the pictures its card may show (its photos and
 *   the tour's images) and the one it shows, its found and preload radii
 *   and how many of its items stand outside the circle, and where it
 *   stands: metres east and north of the 3D view's origin (given, else
 *   the tour's centre, `tour-origin.ts`), its height over the ellipsoid
 *   and its heading, and whether that position is locked (every station
 *   is, until unlocked); with the ground known, how far it and its items
 *   stand off it.
 * - A free item (pin, photo, 3D model, long text, sound, character, video):
 *   its name (a pin's text to edit), its kind and station, a model's size,
 *   its texts; where it stands in the world (`placement/placeables.ts`),
 *   its offset in its holder's frame (its folder's, else its station's)
 *   and its heading there, and how far it stands off the ground; none of
 *   that for one with no place in the world (a video); for a long text,
 *   what its writer shows (`InspectorLongText`).
 * - A plain folder (`folder:<id>`): its name, its station and how many
 *   items it holds, its scale (how much larger it draws its items and
 *   their distances), and where its origin stands in its station's frame
 *   with its heading there, and how far that stands off the ground.
 * - A story (`story:<id>`): its title, its place and its numbered entries.
 * - A story's block: its texts, how it moves on and, for a character, what
 *   is set of him; a story's choice or quiz: a summary, read here and not
 *   edited.
 * - A code: its name, its line, its print size and where it stands, in
 *   the same metres.
 *
 * @see inspector-model.ts.md
 */
import {
  isStory,
  isTourStoryBlock,
  tourChildPlace,
  tourStories,
  type TourChoice,
  type TourContainer,
  type TourQuizEntry,
  type TourStory,
  type TourStoryBlock,
} from "gps-plus-slam-app-framework/ar/tour-story";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  TOUR_CHARACTER_VIEWS,
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_WORLD_VIEWS,
  type TourBlockKind,
  type TourModelVector,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { ModelFocus, ModelPick } from "../editor-view.js";
import { facingDegOf } from "../../character-views.js";

import { KIND_EDIT } from "../../kinds/edit-kinds.js";
import { objectTitle } from "../../object-describe.js";
import { readingSheetContent } from "../../reading-sign.js";
import { stationTitle } from "../../station-run.js";
import { folderChains, ownedAssetIds } from "../../tour-document.js";
import {
  placeableOf,
  posedEntries,
  posedEntryOf,
} from "../../placement/placeables.js";
import type { ExtentSpec } from "../../placement/placement-rows.js";
import {
  blockFields,
  storyBlockFields,
  type BlockField,
} from "../block-fields.js";
import { FOLDER_PREFIX, STORY_PREFIX } from "../editor-model.js";
import { folderName } from "../folder-commands.js";
import {
  FREE_LIST,
  childMayGo,
  childStepTo,
  movedChild,
  movedToStation,
  storyList,
} from "../../station-children-moves.js";
import { eastNorthOf, tourCentre } from "../tour-origin.js";
import type { InspectorFile } from "./inspector-file.js";
import { outsideItems } from "./tour-problems.js";
import {
  gotoChoices,
  gotoValue,
  stepJump,
  stepJumpText,
  type GotoChoice,
} from "../story-steps.js";
import {
  isSingleQuiz,
  MAX_ANSWERS,
  MIN_ANSWERS,
  type StoryStep,
} from "../story-step-edits.js";
import {
  stationContents,
  stationImagePath,
  storyRows,
  type StationContent,
  type TreeRowKind,
} from "./tree-model.js";

/** Where something stands: as the 3D view frames it, and as the file
 *  says its height and heading. */
export interface InspectorPosition {
  /** Metres east of the tour's centre (the 3D view's origin). */
  readonly eastM: number;
  /** Metres north of the tour's centre. */
  readonly northM: number;
  /** Over the ellipsoid (m), as the file writes heights. */
  readonly altM: number;
  /** Clockwise from north; null when the file gives none. */
  readonly headingDeg: number | null;
}

/** A picture a station's card may show. */
interface InspectorImage {
  /** What the station's `image` names: a photo item's or an image
   *  asset's id. */
  readonly id: string;
  /** Its content path (`content/<id>.jpg`). */
  readonly path: string;
  /** A photo's name (`objectTitle`); "Tour image" for an asset. */
  readonly label: string;
}

/** The ground's ellipsoidal height at a place (m), as the 3D view has it
 *  loaded; null where none has loaded. */
export type InspectorGround = (place: {
  readonly lat: number;
  readonly lon: number;
}) => number | null;

/** How far off the ground counts as off it (m). */
export const ON_GROUND_M = 0.05;

interface StationInspector {
  readonly kind: "station";
  readonly title: string;
  /** Its own title as the file holds it; empty for an untitled one (the
   *  title then is its stand-in, "Station n"). */
  readonly name: string;
  readonly sub: string;
  /** Its place in the tour (1-based) and the tour's station count: the
   *  inspector's Earlier and Later. */
  readonly place: { readonly number: number; readonly count: number };
  readonly description: string | null;
  readonly imagePath: string | null;
  /** The pictures the card may show: the station's photos, then the
   *  tour's image assets. */
  readonly images: readonly InspectorImage[];
  /** The one the card shows now (`imagePath`'s), or null. */
  readonly imageId: string | null;
  readonly foundRadiusM: number;
  readonly activateRadiusM: number;
  /** Its items standing outside the found radius (a radius lowered under
   *  them leaves them there). */
  readonly outside: number;
  /** Its items standing more than `ON_GROUND_M` off the ground; null
   *  while the ground under any of them has not loaded. */
  readonly offGround: number | null;
  /** Its point's height over the ground (m); null before the ground there
   *  has loaded. */
  readonly groundOffM: number | null;
  /** Null for a station the file does not place. */
  readonly position: InspectorPosition | null;
  /** Its position, height and heading may not be edited (the page's view
   *  state, `isStationLocked`): its gizmo is its radius dots alone. */
  readonly locked: boolean;
  /** Its stories and its free items, by kind and name: the inspector's
   *  Contents. */
  readonly contents: readonly StationContent[];
}

/** Where a station's item or story may move within its station: one
 *  place earlier or later in its list (`step`; null for a free item, as
 *  the free items have no order), and the lists it may go into (`targets`:
 *  out of its story, into another story of its station), each with its
 *  button's words, and the other stations it may go onto (`stations`, by
 *  their titles: the inspector's Move to station). */
interface InspectorMoves {
  readonly step: { readonly earlier: boolean; readonly later: boolean } | null;
  readonly targets: readonly {
    readonly list: string;
    readonly label: string;
  }[];
  readonly stations: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

/** A story, selected by `story:<id>`. */
interface StoryInspector {
  readonly kind: "story";
  readonly storyId: string;
  readonly stationId: string;
  /** Where it may move in its station (the inspector's Earlier, Later
   *  and Move to). */
  readonly moves?: InspectorMoves;

  readonly title: string;
  /** Its station, numbered as the tree numbers it. */
  readonly sub: string;
  readonly entries: readonly {
    readonly id: string;
    readonly kind: TreeRowKind;
    readonly title: string;
    readonly place: number;
  }[];
}

/** A block of a story, as its inspector shows it. */
interface StoryEntryInspector {
  readonly kind: "storyEntry";
  readonly id: string;
  readonly stationId: string;
  /** Where it may move in its station (the inspector's Earlier, Later
   *  and Move to). */
  readonly moves?: InspectorMoves;

  /** Its row's kind in the tree. */
  readonly rowKind: TreeRowKind;
  readonly title: string;
  /** Where it stands: its station, its story, its kind and its place. */
  readonly sub: string;
  readonly block: InspectorStoryBlock;
  /** How it moves on; `afterS` only when by itself. */
  readonly advance: {
    readonly mode: string;
    readonly afterS: number | null;
  };
}

/** One answer of a step, as its inspector edits it. */
interface InspectorAnswer {
  readonly id: string;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly label: string;
  /** The jump picker's value (`gotoValue`); "" for a quiz's. */
  readonly way: string;
  /** Where it leads, as its chip says it (`stepJumpText`). */
  readonly jump: string;
  /** It goes back to this step or an earlier one. */
  readonly back: boolean;
  /** A quiz's right answer. */
  readonly right: boolean;
}

/** A choice or a single quiz as its inspector edits it. */
interface InspectorStepForm {
  /** The step as the tour holds it: each control writes it whole
   *  (`story-step-edits.ts`). */
  readonly step: StoryStep;
  /** Its question. */
  readonly prompt: string;
  readonly answers: readonly InspectorAnswer[];
  /** The jump picker's ways (a choice's; none for a quiz). */
  readonly ways: readonly GotoChoice[];
  /** Another answer may be added, one removed (2 to 4). */
  readonly canAdd: boolean;
  readonly canRemove: boolean;
  /** A quiz's points; null for a choice. */
  readonly points: number | null;
  /** Where a quiz's story goes on, said; null for a choice. */
  readonly then: string | null;
}

/** A choice or a quiz of a story: a choice and a single quiz edited
 *  (`form`), another quiz read only. */
interface StoryStepInspector {
  readonly kind: "storyStep";
  readonly stepKind: "choice" | "quiz";
  readonly id: string;
  readonly stationId: string;
  /** Where it may move in its station (the inspector's Earlier, Later
   *  and Move to). */
  readonly moves?: InspectorMoves;

  readonly title: string;
  readonly sub: string;
  /** The summary's label. */
  readonly heading: string;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly lines: readonly string[];
  /** What is edited; absent for a quiz of a typed answer. */
  readonly form?: InspectorStepForm;
}

/** A block of a story, as its entry's inspector shows it. */
interface InspectorStoryBlock {
  readonly id: string;
  /** Its kind in the block model's words ("Long text"). */
  readonly kind: string;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly title: string;
  /** For a character: what his entry's inspector sets of him. */
  readonly character?: InspectorCharacter;
  /** Its texts to type (`storyBlockFields`), named `block:<id>:<field>`
   *  in the inspector. */
  readonly fields: readonly BlockField[];
}

/** A story character's settings as his entry's inspector shows them. */
export interface InspectorCharacter {
  /** His block's view. */
  readonly view: string;
  /** How the first step showing him moves on (`tap` when none does). */
  readonly advance: string;
  /** The heading he faces at rest, degrees clockwise from the station's
   *  own north (true north only while the station is not turned). */
  readonly facingDeg: number;
}

/** A character's story views in the inspector's words, in the format's
 *  order (the words of the station-blocks-7 prototype). */
export const CHARACTER_VIEW_CHOICES: readonly {
  readonly view: (typeof TOUR_CHARACTER_VIEWS)[number];
  readonly label: string;
}[] = TOUR_CHARACTER_VIEWS.map((view) => ({
  view,
  label: {
    bubble: "Bubble",
    speak: "Tap to speak",
    "two-stations": "Two stations",
    portrait: "Portrait",
    popup: "Pop-up",
  }[view],
}));

/** What the inspector shows of the story block `block`. */
function storyEntry(block: TourStoryBlock): InspectorStoryBlock {
  const entry = {
    id: block.id,
    kind: KIND_EDIT[block.kind].label,
    title: objectTitle(block),
    fields: storyBlockFields(block),
  };
  if (block.kind !== "character") return entry;
  return {
    ...entry,
    character: {
      view: block.view,
      advance: block.advance.mode,
      facingDeg: facingDegOf(block.pose.rotation),
    },
  };
}

/** A model's views in the 3D inspector's words, in the format's order. */
export const MODEL_VIEW_CHOICES: readonly {
  readonly view: (typeof TOUR_MODEL_WORLD_VIEWS)[number];
  readonly label: string;
}[] = TOUR_MODEL_WORLD_VIEWS.map((view) => ({
  view,
  label: view.charAt(0).toUpperCase() + view.slice(1),
}));

/** The size of an item its white dots change, as its placement row
 *  gives it (`placement/placement-rows.ts`). */
export interface InspectorExtent {
  /** The block's field it is (`sizeM`, `widthM`). */
  readonly field: string;
  /** Its name in the inspector ("Size", "Width"). */
  readonly label: string;
  /** What it is, in the creator's words ("Its largest side"). */
  readonly meaning: string;
  /** The tour's value (m). */
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

/** `item`'s size its row's `spec` names, with the tour's value; null for
 *  no size extent (a station's reach, a folder's factor are not an
 *  item's) or a block without the value. */
function extentOf(
  item: object,
  spec: ExtentSpec | null,
): InspectorExtent | null {
  if (spec?.kind !== "size") return null;
  const value: unknown = (item as Record<string, unknown>)[spec.field];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return {
    field: spec.field,
    label: spec.label,
    meaning: spec.meaning,
    value,
    min: spec.min,
    max: spec.max,
  };
}

/** A short text as its panel shows it: its view, and its role and turn
 *  (null: the reader's default). */
interface InspectorShortText {
  readonly view: string;
  readonly role: string | null;
  readonly orientation: string | null;
}

/** A model's own parts as its inspector edits them. */
export interface InspectorModelParts {
  readonly view: string;
  readonly notes: readonly {
    readonly title: string;
    readonly text: string;
    readonly position: TourModelVector;
  }[];
  /** Whether another note fits (the format's most). */
  readonly notesFull: boolean;
  readonly sections: readonly {
    readonly name: string;
    readonly position: TourModelVector;
    readonly normal: TourModelVector;
  }[];
  readonly sectionsFull: boolean;
  readonly animation: {
    readonly name: string;
    readonly autoplay: boolean;
  } | null;
  /** Its note or section in focus, and the click the 3D view waits for. */
  readonly focus: ModelFocus | null;
  readonly pick: ModelPick | null;
}

/** A long text as its writer shows it (`long-text-writer.ts`). */
export interface InspectorLongText {
  readonly blockId: string;
  /** Its stored view (`TOUR_BLOCK_VIEWS.longText`). */
  readonly view: string;
  readonly title: string;
  /** Its text, the tour's Markdown. */
  readonly body: string;
  readonly hasNarration: boolean;
  /** Changes whenever its narration may have: the record and a stamp of
   *  the tour's read-along texts (the Narration section re-reads on it). */
  readonly narrationKey: string;
  /** The line over its title in the visitor's sheet ("Gate · Station 1"). */
  readonly over: string;
  /** The tour's pictures a text may show, by asset id, with their file
   *  name. */
  readonly pictures: readonly {
    readonly id: string;
    readonly path: string;
    readonly label: string;
  }[];
}

/** The tour's pictures as a long text's writer offers them. */
function textPictures(
  assets: readonly TourAsset[],
): InspectorLongText["pictures"] {
  return assets
    .filter((a) => a.kind === "image")
    .map((a) => ({
      id: a.id,
      path: a.path,
      label: a.path.slice(a.path.lastIndexOf("/") + 1),
    }));
}

interface ItemInspector {
  readonly kind: "item";
  readonly itemKind: TourBlockKind;
  readonly title: string;
  readonly sub: string;
  /** Its station's id. */
  readonly stationId: string;
  /** Where it may move in its station (the inspector's Earlier, Later
   *  and Move to). */
  readonly moves?: InspectorMoves;

  /** A pin's text, the field to edit; null for a photo or a model (their
   *  caption is not edited here). */
  readonly text: string | null;
  /** The size its white dots change, to type (a model's largest side, a
   *  picture's width); null for an item with none. */
  readonly extent: InspectorExtent | null;
  /** Its other text fields to type, per kind (`block-fields.ts`, B2c): a
   *  short text's description, a picture's title, caption and alt text, a
   *  model's title. */
  readonly fields: readonly BlockField[];
  /** A model's view, notes, sections and clip; null for a pin or a
   *  photo. */
  readonly model: InspectorModelParts | null;
  /** A short text's view and the choices its panel shows; absent for any
   *  other item. */
  readonly shortText?: InspectorShortText;
  /** A long text's writer's data; null for any other item. */
  readonly longText: InspectorLongText | null;
  /** In its station's frame (m), its folders composed in: where it stands
   *  from the anchor; null for an item with no place in the world (a
   *  video). */
  readonly offset: {
    readonly northM: number;
    readonly upM: number;
    readonly eastM: number;
  } | null;
  /** Relative to its station; null for a rotation that is no number or an
   *  item with no place in the world. */
  readonly headingDeg: number | null;
  /** Its gizmo turns it (its placement row's `turns`): a pin or a sound
   *  faces the visitor instead; false for one with no place. */
  readonly turns: boolean;
  /** The plain folder holding it (the innermost), to select from here
   *  (the 3D view's path to a folder); null at its station's top. */
  readonly folder: { readonly id: string; readonly title: string } | null;
  /** Its height over the ground (m); null before the ground there has
   *  loaded. */
  readonly groundOffM: number | null;
}

/** The plain folder `id` of `station` with its name, or null (none, or
 *  one the station lacks). */
function holdingFolderOf(
  station: TourStation,
  id: string | undefined,
): { readonly id: string; readonly title: string } | null {
  const folder =
    id === undefined ? undefined : folderChains(station).get(id)?.at(-1);
  return folder === undefined
    ? null
    : { id: folder.id, title: folderName(folder) };
}

/** A plain folder's scale as its inspector types it: its placement
 *  row's factor (`CONTAINER_PLACEMENT`). */
interface InspectorScale {
  readonly label: string;
  readonly meaning: string;
  /** The tour's value (1: none written). */
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

interface FolderInspector {
  readonly kind: "folder";
  readonly folderId: string;
  /** Its station's id. */
  readonly stationId: string;
  readonly title: string;
  readonly sub: string;
  readonly scale: InspectorScale;
  /** Its origin in its station's frame (m), its holders composed in. */
  readonly offset: {
    readonly northM: number;
    readonly upM: number;
    readonly eastM: number;
  };
  /** Relative to its station; null for a rotation that is no number. */
  readonly headingDeg: number | null;
  /** Its origin's height over the ground (m); null before the ground
   *  there has loaded. */
  readonly groundOffM: number | null;
  /** The items it holds at any depth, by kind and name, in the tour's
   *  order: each movable alone from here (a press selects it). */
  readonly items: readonly StationContent[];
  /** A phone shows no details sheet for it: a tap keeps the list, where
   *  its band marks the items that move with it, and its 3D handles move,
   *  turn and scale it. Its typed fields are a wider window's. */
  readonly phoneDetails: false;
}

interface CodeInspector {
  readonly kind: "code";
  readonly title: string;
  readonly sub: string;
  readonly printSizeM: number | null;
  /** Null for a code with no stored position, or one not placed. */
  readonly position: InspectorPosition | null;
}

export type InspectorModel = (
  | StationInspector
  | ItemInspector
  | FolderInspector
  | CodeInspector
  | StoryInspector
  | StoryEntryInspector
  | StoryStepInspector
) & {
  /** The selected item's file (`inspector-file.ts`), the shell's to add;
   *  none for one made of words. */
  readonly file?: InspectorFile;
};

/** Whether a phone shows `model` as its details sheet over the list;
 *  false for a selection whose model says it has none there. */
export function detailsOnPhone(model: InspectorModel): boolean {
  return !("phoneDetails" in model) || model.phoneDetails;
}

/** The bottom bar's hint for the selection: the handles its gizmo has in
 *  the 3D view, or how to select when nothing is. A code is read-only
 *  there (no handles). */
export function inspectorHint(model: InspectorModel | null): string {
  if (model === null) {
    return "Click a station, an item or a code; drag to orbit, right-drag to pan, wheel to zoom; right-click the ground for a new station";
  }
  if (model.kind === "station") {
    return model.locked
      ? `${model.title} - a white dot for the radius; its position is locked (unlock it under Position to move or turn it)`
      : `${model.title} - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn`;
  }
  if (model.kind === "item") {
    if (model.offset === null) {
      return `${model.title} - it has no place in the 3D view; Esc deselects`;
    }
    const turn = model.turns ? ", the round arrow to turn" : "";
    const resize = model.extent !== null ? ", a white dot to resize" : "";
    return `${model.title} - drag the middle to move along the ground${turn}${resize}`;
  }
  if (model.kind === "folder") {
    return `${model.title} - drag the middle to move its items together, a white dot to scale them, the round arrow to turn`;
  }
  if (model.kind === "story") {
    return `${model.title} - its entries play in order; its + in the list adds one, Esc deselects`;
  }
  if (model.kind !== "code") {
    return `${model.title} - it has no place in the 3D view; Esc deselects`;
  }
  return `${model.title} - read-only here; F frames it, Esc deselects`;
}

/** The line over the 3D view for the selection: what a folder's gizmo
 *  does with its items, by count; null for any other selection. */
export function sceneHint(model: InspectorModel | null): string | null {
  if (model?.kind !== "folder") return null;
  const n = model.items.length;
  return n === 1
    ? `${model.title} - 1 item moves, turns and scales with it. Click it to move it alone.`
    : `${model.title} - ${String(n)} items move, turn and scale together. Click one to move it alone.`;
}

/** A code as the inspector reads it. */
export interface InspectorCode {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly geo: {
    readonly lat: number;
    readonly lon: number;
    readonly alt: number;
    readonly headingDeg?: number;
    readonly rotation?: readonly [number, number, number, number];
  } | null;
  readonly printSizeM: number | null;
}

/**
 * The bearing (degrees clockwise from north, 0-360) a rotation in a
 * north-up-east frame turns the frame's north axis to; null when the
 * rotation is not finite or turns north straight up or down.
 */
export function headingOfRotation(
  rotation: readonly [number, number, number, number] | readonly number[],
): number | null {
  const [x = 0, y = 0, z = 0, w = 1] = rotation;
  if (![x, y, z, w].every(Number.isFinite)) return null;
  // The north axis (1, 0, 0) turned: its north and east parts.
  const north = 1 - 2 * (y * y + z * z);
  const east = 2 * (x * z - w * y);
  if (Math.hypot(north, east) < 1e-9) return null;
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function positionOf(
  geo: NonNullable<InspectorCode["geo"]>,
  origin: { readonly lat: number; readonly lng: number } | null,
): InspectorPosition | null {
  const at = origin === null ? null : eastNorthOf(geo, origin);
  if (at === null || !Number.isFinite(geo.alt)) return null;
  const heading =
    geo.headingDeg ??
    (geo.rotation === undefined ? null : headingOfRotation(geo.rotation));
  return { ...at, altM: geo.alt, headingDeg: heading };
}

/** The pictures `station`'s card may show (its photos, then the tour's
 *  image assets that are no captured photo's own, `owned`), and the one
 *  it shows (`stationImagePath`'s rule). */
function cardImages(
  station: TourStation,
  assets: readonly TourAsset[],
  owned: ReadonlySet<string>,
): { images: InspectorImage[]; imageId: string | null } {
  // Offered by the ASSET a picture shows (`i.image`), which is what a
  // station's `image` names, and each asset once (B2a review 3).
  const listed = new Set<string>();
  const once = (image: InspectorImage): InspectorImage[] => {
    if (listed.has(image.id)) return [];
    listed.add(image.id);
    return [image];
  };
  const images: InspectorImage[] = [
    ...tourFreeBlocks(station).flatMap((i) => {
      if (i.kind !== "picture") return [];
      const path = assets.find(
        (a) => a.id === i.image && a.kind === "image",
      )?.path;
      return path === undefined
        ? []
        : once({ id: i.image, path, label: objectTitle(i) });
    }),
    ...assets.flatMap((a) =>
      a.kind === "image" && !owned.has(a.id)
        ? once({ id: a.id, path: a.path, label: "Tour image" })
        : [],
    ),
  ];
  const shown = stationImagePath(station, assets);
  const named = images.find((i) => i.id === station.image && i.path === shown);
  return {
    images,
    imageId: named?.id ?? images.find((i) => i.path === shown)?.id ?? null,
  };
}

/** A height off the ground as the inspector shows it: in tenths of a
 *  metre, 0 within `ON_GROUND_M`. The ground changes by centimetres while
 *  finer tiles arrive; a model that carried the raw height would change
 *  with each of them, and the inspector would be drawn again for nothing
 *  it shows. */
function shownOff(m: number): number {
  return Math.abs(m) <= ON_GROUND_M ? 0 : Math.round(m * 10) / 10;
}

/** `geo`'s height over the ground (m, as shown: `shownOff`), or null
 *  where none has loaded. */
function offGroundOf(
  geo: { readonly lat: number; readonly lon: number; readonly alt: number },
  groundAt: InspectorGround | undefined,
): number | null {
  const ground = groundAt?.({ lat: geo.lat, lon: geo.lon }) ?? null;
  return ground === null || !Number.isFinite(ground)
    ? null
    : shownOff(geo.alt - ground);
}

/** A quiz's points and answers, the right one said. */
function quizLines(quiz: TourQuizEntry): string[] {
  const points =
    quiz.points === 1 ? "1 point" : `${String(quiz.points)} points`;
  const { answer } = quiz;
  switch (answer.type) {
    case "single":
      return [
        points,
        ...answer.options.map((o) =>
          o.id === answer.correct ? `${o.label} - right` : o.label,
        ),
      ];
    case "multiple":
      return [
        points,
        ...answer.options.map((o) =>
          answer.correct.includes(o.id) ? `${o.label} - right` : o.label,
        ),
      ];
    case "number": {
      const unit = answer.unit === undefined ? "" : ` ${answer.unit}`;
      const within =
        answer.tolerance > 0 ? `, within ${String(answer.tolerance)}` : "";
      return [points, `${String(answer.value)}${unit}${within}`];
    }
    default:
      return [points, "A typed answer"];
  }
}

/** One part of the inspector's crumb: a level above the selection, or
 *  the selection itself (the last part). */
export interface InspectorCrumb {
  readonly label: string;
  /** The selection id that goes to it; null for the whole tour (the
   *  list, nothing selected). */
  readonly select: string | null;
}

const TOUR_CRUMB: InspectorCrumb = { label: "Tour", select: null };

/** Where `selected` stands, from the tour down to itself: its station,
 *  the stories and plain folders holding it, then it. A step of a story
 *  is "Step n". Nothing selected, or a selection the tour lacks: the
 *  tour alone. The last-but-one part is the selection's way up. */
export function inspectorCrumb(input: {
  readonly selected: string | null;
  readonly stations: readonly TourStation[];
  readonly codes: readonly InspectorCode[];
}): InspectorCrumb[] {
  const { selected, stations } = input;
  if (selected === null) return [TOUR_CRUMB];
  const stationPart = (station: TourStation): InspectorCrumb => {
    const number = stations.indexOf(station) + 1;
    return {
      label: `${String(number)} ${stationTitle(station, number)}`,
      select: `station:${station.id}`,
    };
  };
  if (selected.startsWith("station:")) {
    const station = stations.find(
      (s) => s.id === selected.slice("station:".length),
    );
    return station === undefined
      ? [TOUR_CRUMB]
      : [TOUR_CRUMB, stationPart(station)];
  }
  const code = input.codes.find((c) => c.id === selected);
  if (code !== undefined) {
    return [TOUR_CRUMB, { label: code.title, select: selected }];
  }
  const id = selected.startsWith(STORY_PREFIX)
    ? selected.slice(STORY_PREFIX.length)
    : selected.startsWith(FOLDER_PREFIX)
      ? selected.slice(FOLDER_PREFIX.length)
      : selected;
  const place = tourChildPlace({ stations }, id);
  if (place === null) return [TOUR_CRUMB];
  const holders = place.path.map((holder): InspectorCrumb =>
    isStory(holder)
      ? { label: holder.title, select: `${STORY_PREFIX}${holder.id}` }
      : { label: folderName(holder), select: `${FOLDER_PREFIX}${holder.id}` },
  );
  const label =
    place.story === undefined ? namedChild(place) : stepLabel(place.index);
  if (label === null) return [TOUR_CRUMB];
  return [
    TOUR_CRUMB,
    stationPart(place.station),
    ...holders,
    { label, select: selected },
  ];
}

/** A story's step as the crumb names it. */
function stepLabel(index: number): string {
  return `Step ${String(index + 1)}`;
}

/** The name of the child outside any story at `place`: a story's title,
 *  a plain folder's name or a free item's title; null for none there. */
function namedChild(place: {
  readonly station: TourStation;
  readonly path: readonly TourContainer[];
  readonly index: number;
}): string | null {
  const holder = place.path.at(-1);
  const child =
    holder === undefined
      ? place.station.children[place.index]
      : isStory(holder)
        ? undefined
        : holder.children[place.index];
  if (child === undefined) return null;
  if (isStory(child)) return child.title;
  return child.kind === "folder" ? folderName(child) : objectTitle(child);
}

/** A choice's answers and where each leads. */
function choiceLines(choice: TourChoice, story: TourStory): string[] {
  const rows = storyRows(story);
  return choice.options.map((option) => {
    if (option.end === true) return `${option.label} - ends the story`;
    if (option.goto === undefined) return `${option.label} - plays on`;
    const to = rows.find((r) => r.id === option.goto);
    return `${option.label} - goes to ${to?.title ?? "another entry"}`;
  });
}

/** The step at `index` of `story` as its inspector edits it; undefined
 *  for a quiz of a typed answer. */
function stepForm(
  story: TourStory,
  index: number,
  step: StoryStep,
): InspectorStepForm | undefined {
  const steps = story.children;
  const rows = storyRows(story);
  const title = (s: { readonly id: string }) =>
    rows.find((r) => r.id === s.id)?.title ?? "";
  if (step.kind === "choice") {
    const count = step.options.length;
    return {
      step,
      prompt: step.prompt,
      answers: step.options.map((option) => {
        const jump = stepJump(steps, index, option);
        return {
          id: option.id,
          label: option.label,
          way: gotoValue(steps, index, option),
          jump: stepJumpText(jump),
          back: jump.type === "back",
          right: false,
        };
      }),
      ways: gotoChoices(steps, index, title),
      canAdd: count < MAX_ANSWERS,
      canRemove: count > MIN_ANSWERS,
      points: null,
      then: null,
    };
  }
  if (!isSingleQuiz(step)) return undefined;
  const next = steps[index + 1];
  const count = step.answer.options.length;
  return {
    step,
    prompt: step.question,
    answers: step.answer.options.map((o) => ({
      id: o.id,
      label: o.label,
      way: "",
      jump: "",
      back: false,
      right: o.id === step.answer.correct,
    })),
    ways: [],
    canAdd: count < MAX_ANSWERS,
    canRemove: count > MIN_ANSWERS,
    points: step.points,
    then: `Right or wrong, the visitor sees the result, and the story ${
      next === undefined
        ? "ends"
        : `goes on at step ${String(index + 2)}: ${title(next)}`
    }`,
  };
}

/** Where the station's item or story `id` may move in its station
 *  (`station-children-moves.ts`): the steps and lists the move rule
 *  takes, so no button offers a move it would refuse. A free item whose
 *  file the tour on disk does not hold yet (`keepsFree`) goes into no
 *  story: the document refuses that move (`freeItemUnsaved`); onto another
 *  station it may go (it stays a free item there). */
function movesOf(
  id: string,
  stations: readonly TourStation[],
  keepsFree = false,
): InspectorMoves {
  const place = tourChildPlace({ stations }, id);
  if (place === null) return { step: null, targets: [], stations: [] };
  const { station, story } = place;
  const own =
    story === undefined && place.path.length === 0
      ? station.children[place.index]
      : undefined;
  // The free items have no order: a free item has no step.
  const ordered = story !== undefined || (own !== undefined && isStory(own));
  return {
    step: ordered
      ? {
          earlier: childStepTo(station, id, "earlier") !== null,
          later: childStepTo(station, id, "later") !== null,
        }
      : null,
    targets: keepsFree ? [] : moveTargets(station, id, story?.id),
    stations: stations.flatMap((other, index) =>
      other.id !== station.id &&
      !("refused" in movedToStation(station, other, id))
        ? [{ id: other.id, label: stationTitle(other, index + 1) }]
        : [],
    ),
  };
}

/** The lists of `station` its item `id` (in the story `from`, if any)
 *  may go into: out of its story, when it can stand in the world, and
 *  into each other story that takes it. */
function moveTargets(
  station: TourStation,
  id: string,
  from: string | undefined,
): { list: string; label: string }[] {
  const targets: { list: string; label: string }[] = [];
  const out =
    from !== undefined &&
    childMayGo(station, id, FREE_LIST) &&
    !("refused" in movedChild(station, id, { place: "free" }));
  if (out) targets.push({ list: FREE_LIST, label: "Move out of the story" });
  for (const other of tourStories(station)) {
    const list = storyList(other.id);
    if (other.id !== from && childMayGo(station, id, list)) {
      targets.push({ list, label: `Move into "${other.title}"` });
    }
  }
  return targets;
}

/** The inspector of the story's child `selected`, or null for an id that
 *  is no story's child. */
function storyChildInspector(
  selected: string,
  stations: readonly TourStation[],
): InspectorModel | null {
  const place = tourChildPlace({ stations }, selected);
  if (place === null || place.story === undefined) return null;
  const { station, story, index } = place;
  const entry = `entry ${String(index + 1)}`;
  const child = story.children[index];
  if (child === undefined) return null;
  if (isTourStoryBlock(child)) {
    return {
      kind: "storyEntry",
      id: child.id,
      stationId: station.id,
      moves: movesOf(child.id, stations),
      rowKind: storyRows({ children: [child] })[0]?.kind ?? "text",
      title: objectTitle(child),
      sub: `${KIND_EDIT[child.kind].label}, ${entry}`,
      block: storyEntry(child),
      advance: {
        mode: child.advance.mode,
        afterS: child.advance.mode === "auto" ? child.advance.afterS : null,
      },
    };
  }
  const common = {
    kind: "storyStep",
    id: child.id,
    stationId: station.id,
    moves: movesOf(child.id, stations),
    heading: "Answers",
  } as const;
  const form = stepForm(story, index, child);
  return {
    ...common,
    ...(form === undefined ? {} : { form }),
    ...(child.kind === "choice"
      ? {
          stepKind: "choice",
          title: child.prompt,
          sub: `Choice, ${entry}`,
          lines: choiceLines(child, story),
        }
      : {
          stepKind: "quiz",
          title: child.question,
          sub: `Quiz, ${entry}`,
          lines: quizLines(child),
        }),
  };
}

/** The inspector of the story `storyId`, or null for a gone one. */
function storyInspector(
  storyId: string,
  stations: readonly TourStation[],
): InspectorModel | null {
  for (const station of stations) {
    const story = tourStories(station).find((s) => s.id === storyId);
    if (story === undefined) continue;
    return {
      kind: "story",
      storyId,
      stationId: station.id,
      moves: movesOf(storyId, stations),
      title: story.title,
      sub: "Story",
      entries: storyRows(story),
    };
  }
  return null;
}

/** The plain folder `selected` (`folder:<id>`) names, as its inspector;
 *  null for one the tour lacks. */
function folderInspector(
  selected: string,
  stations: readonly TourStation[],
  groundAt: InspectorGround | undefined,
): FolderInspector | null {
  const place = placeableOf({ stations }, selected);
  const index = stations.findIndex((s) => s.id === place?.stationId);
  const station = stations[index];
  const id = selected.slice(FOLDER_PREFIX.length);
  const folder =
    station === undefined ? undefined : folderChains(station).get(id)?.at(-1);
  if (
    place === null ||
    place.inStation === null ||
    place.extent === null ||
    station === undefined ||
    folder === undefined
  ) {
    return null;
  }
  const n = place.members.length;
  const { extent, inStation } = place;
  return {
    kind: "folder",
    folderId: id,
    stationId: station.id,
    title: folderName(folder),
    sub: `Folder in ${stationTitle(station, index + 1)}, ${n === 1 ? "1 item" : `${String(n)} items`}`,
    scale: {
      label: extent.label,
      meaning: extent.meaning,
      value: extent.value,
      min: extent.min,
      max: extent.max,
    },
    offset: {
      northM: inStation.position[0],
      upM: inStation.position[1],
      eastM: inStation.position[2],
    },
    headingDeg: headingOfRotation(inStation.rotation),
    groundOffM: offGroundOf(place.geo, groundAt),
    items: stationContents(station).filter((c) => place.members.includes(c.id)),
    phoneDetails: false,
  };
}

/** The inspector for `selected` (the page's selection id), or null when
 *  nothing is selected or the tour does not have it. */
export function buildInspector(input: {
  readonly selected: string | null;
  readonly stations: readonly TourStation[];
  readonly assets: readonly TourAsset[];
  readonly codes: readonly InspectorCode[];
  /** The stations whose position is unlocked, by id; every other station
   *  is locked (none given: all are). */
  readonly unlockedStations?: readonly string[];
  /** The 3D view's origin, fixed when it opened; none given: the tour's
   *  centre now (the same, until a station moves). */
  readonly origin?: { readonly lat: number; readonly lng: number } | null;
  /** The ground as the 3D view has it loaded; none given: unknown. */
  readonly groundAt?: InspectorGround;
  /** The page's model focus and pick (`editor-view.ts`); none given:
   *  none. */
  readonly modelFocus?: ModelFocus | null;
  readonly modelPick?: ModelPick | null;
  /** Changes whenever the tour's read-along texts do; none given: "". */
  readonly timingsStamp?: string;
  /** The selected free item's file is not in the tour on disk yet, so it
   *  is offered no story (`freeItemUnsaved`); none given: it is. */
  readonly selectedFileUnsaved?: boolean;
}): InspectorModel | null {
  const { selected, stations, groundAt } = input;
  if (selected === null) return null;
  // The 3D view's origin: the same centre its frame is built on.
  const origin =
    input.origin ??
    tourCentre(
      stations,
      input.codes.flatMap((c) => (c.geo === null ? [] : [c.geo])),
    );
  if (selected.startsWith("station:")) {
    const id = selected.slice("station:".length);
    const index = stations.findIndex((s) => s.id === id);
    const station = stations[index];
    if (station === undefined) return null;
    const description = station.description?.trim() ?? "";
    const offs = posedEntries(station).map((item) =>
      offGroundOf(item.place.geo, groundAt),
    );
    return {
      kind: "station",
      title: stationTitle(station, index + 1),
      name: station.title?.trim() ?? "",
      sub: `Station ${String(index + 1)} of ${String(stations.length)}`,
      place: { number: index + 1, count: stations.length },
      description: description === "" ? null : description,
      imagePath: stationImagePath(station, input.assets),
      ...cardImages(station, input.assets, ownedAssetIds({ stations })),
      foundRadiusM: station.foundRadiusM,
      activateRadiusM: station.activateRadiusM,
      outside: outsideItems(station).length,
      offGround: offs.includes(null)
        ? null
        : offs.filter((m) => m !== null && Math.abs(m) > ON_GROUND_M).length,
      groundOffM: offGroundOf(station.geo, groundAt),
      position: positionOf(station.geo, origin),
      locked: !(input.unlockedStations ?? []).includes(id),
      contents: stationContents(station),
    };
  }
  if (selected.startsWith(STORY_PREFIX)) {
    return storyInspector(selected.slice(STORY_PREFIX.length), stations);
  }
  if (selected.startsWith(FOLDER_PREFIX)) {
    return folderInspector(selected, stations, groundAt);
  }
  const inStory = storyChildInspector(selected, stations);
  if (inStory !== null) return inStory;
  for (const [index, station] of stations.entries()) {
    const item = tourFreeBlocks(station).find((i) => i.id === selected);
    if (item === undefined) continue;
    // Where it stands in the world, through its folders; none for a view
    // with no place there (a video's card).
    const place = posedEntryOf(station, item.id)?.place ?? null;
    const inStation = place?.inStation ?? null;
    return {
      kind: "item",
      itemKind: item.kind,
      title: objectTitle(item),
      sub: `${KIND_EDIT[item.kind].label} in ${stationTitle(station, index + 1)}`,
      stationId: station.id,
      moves: movesOf(item.id, stations, input.selectedFileUnsaved === true),
      text: item.kind === "shortText" ? item.caption : null,
      extent: extentOf(item, place?.extent ?? null),
      fields: blockFields(item),
      ...(item.kind === "shortText"
        ? {
            shortText: {
              view: item.view,
              role: item.role ?? null,
              orientation: item.orientation ?? null,
            },
          }
        : {}),
      model:
        item.kind === "model"
          ? {
              view: item.view,
              notes: (item.annotations ?? []).map((n) => ({
                title: n.title,
                text: n.text ?? "",
                position: n.position,
              })),
              notesFull:
                (item.annotations?.length ?? 0) >= TOUR_MODEL_MAX_NOTES,
              sections: (item.sections ?? []).map((c) => ({
                name: c.name,
                position: c.position,
                normal: c.normal,
              })),
              sectionsFull:
                (item.sections?.length ?? 0) >= TOUR_MODEL_MAX_SECTIONS,
              animation:
                item.animation === undefined
                  ? null
                  : {
                      name: item.animation.name,
                      autoplay: item.animation.autoplay,
                    },
              focus: input.modelFocus ?? null,
              pick: input.modelPick ?? null,
            }
          : null,
      longText:
        item.kind === "longText"
          ? {
              blockId: item.id,
              view: item.view,
              title: item.title,
              body: item.body,
              hasNarration: item.narration !== undefined,
              narrationKey: `${JSON.stringify(item.narration ?? null)}|${input.timingsStamp ?? ""}`,
              over: readingSheetContent(stations, item).over,
              pictures: textPictures(input.assets),
            }
          : null,
      offset:
        inStation === null
          ? null
          : {
              northM: inStation.position[0],
              upM: inStation.position[1],
              eastM: inStation.position[2],
            },
      headingDeg:
        inStation === null ? null : headingOfRotation(inStation.rotation),
      turns: place?.turns ?? false,
      folder: holdingFolderOf(station, place?.folderPath.at(-1)),
      groundOffM: place === null ? null : offGroundOf(place.geo, groundAt),
    };
  }
  const code = input.codes.find((c) => c.id === selected);
  if (code === undefined) return null;
  return {
    kind: "code",
    title: code.title,
    sub: code.meta,
    printSizeM: code.printSizeM,
    position: code.geo === null ? null : positionOf(code.geo, origin),
  };
}
