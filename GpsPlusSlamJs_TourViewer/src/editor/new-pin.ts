/**
 * The 3D editor's Add pin and Add long text, as data (pure): where a new
 * item goes in its station - inside the circle, clear of the items already
 * there - and the item itself, named by its number, standing on the ground
 * where that has loaded and seated in the station it was added to.
 *
 * @see new-pin.ts.md
 */
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type {
  TourObject,
  TourPin,
  TourReadingSign,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  tourFreeBlocks,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  tourStationStoryBlocks,
  type TourStory,
  type TourStoryBlock,
} from "gps-plus-slam-app-framework/ar/tour-story";

import type { TextAddKind } from "../kinds/edit-kinds.js";
import { posedBlocks } from "../placement/placeables.js";

/** How far a new pin keeps from every item of its station (m). */
const CLEAR_M = 2.2;

/** The rings (m from the anchor) and the places on each a new pin tries,
 *  nearest first; each ring stays inside the station's circle. */
const RINGS_M = [4, 6, 8, 10] as const;
const PER_RING = 12;

/**
 * Where a new pin goes in `station`'s frame (metres north and east of its
 * anchor): the first place on rings of 4 to 10 m (each within the found
 * radius), starting due north and going round, that keeps `CLEAR_M` from
 * every item standing in the world (where it stands in the station's
 * frame, its folders composed) and every story entry of the station, so
 * two characters of one station never share a spot; with none free, 4 m north (or the
 * radius, if smaller).
 */
export function freePinSpot(station: TourStation): {
  northM: number;
  eastM: number;
} {
  const radius = Math.max(0, station.foundRadiusM);
  const taken = [
    ...posedBlocks(station).flatMap((p) =>
      p.inStation === null
        ? []
        : [{ north: p.inStation.position[0], east: p.inStation.position[2] }],
    ),
    ...tourStationStoryBlocks(station).map((i) => ({
      north: i.pose.position[0],
      east: i.pose.position[2],
    })),
  ];
  for (const ring of RINGS_M) {
    const r = Math.min(ring, radius);
    for (let k = 0; k < PER_RING; k += 1) {
      const a = (k / PER_RING) * 2 * Math.PI;
      const spot = { northM: Math.cos(a) * r, eastM: Math.sin(a) * r };
      const clear = taken.every(
        (t) => Math.hypot(t.north - spot.northM, t.east - spot.eastM) > CLEAR_M,
      );
      if (clear) return spot;
    }
  }
  return { northM: Math.min(RINGS_M[0], radius), eastM: 0 };
}

/** What a new item is made from: its station, its id, when it is made
 *  and the ground's height at a place (null: not loaded there). */
export interface NewItemInput {
  readonly station: TourStation;
  readonly id: string;
  readonly nowIso: string;
  readonly groundAt: (place: {
    readonly lat: number;
    readonly lon: number;
  }) => number | null;
}

/** The ground's height at a place, or null (not loaded, or not finite). */
type GroundAt = NewItemInput["groundAt"];

/** The station's free spot as a geo pose, and how far the ground there
 *  lies above that spot at the anchor's height (0 where none has
 *  loaded). */
function freeSpotOnGround(
  station: TourStation,
  groundAt: GroundAt,
): { readonly geo: TourPin["geo"]; readonly upM: number } {
  const spot = freePinSpot(station);
  const geo = itemGeoPose(
    { position: [spot.northM, 0, spot.eastM], rotation: [0, 0, 0, 1] },
    station.geo,
  );
  const ground = groundAt({ lat: geo.lat, lon: geo.lon });
  return {
    geo,
    upM: ground !== null && Number.isFinite(ground) ? ground - geo.alt : 0,
  };
}

/** A new item's geo pose: the station's free spot, on the ground there
 *  (the anchor's height where none has loaded). A file's item
 *  (`new-file-item.ts`) stands there too. */
export function freeGeo(input: NewItemInput): TourPin["geo"] {
  const { geo, upM } = freeSpotOnGround(input.station, input.groundAt);
  return { ...geo, alt: geo.alt + upM };
}

/** A story entry's place in its station's frame (m north, east, up). */
interface StorySpot {
  readonly northM: number;
  readonly eastM: number;
  readonly upM?: number;
}

/** Where a new story entry of `station` stands, in its frame: the free
 *  spot (`freePinSpot`), on the ground there by `groundAt` as a free
 *  item stands (the anchor's height where none has loaded). */
export function freeStorySpot(
  station: TourStation,
  groundAt: GroundAt,
): StorySpot {
  const spot = freePinSpot(station);
  return { ...spot, upM: freeSpotOnGround(station, groundAt).upM };
}

/** One more than how many items of `kind` the station holds. */
function nextNumber(station: TourStation, kind: string): string {
  return String(
    tourFreeBlocks(station).filter((i) => i.kind === kind).length + 1,
  );
}

/**
 * A new pin of `station` (its id `id`, made at `nowIso`) at its free spot,
 * on the ground there by `groundAt` (the anchor's height where none has
 * loaded), named "New pin n" with n one more than the station's pins.
 */
export function newPin(input: NewItemInput): TourPin {
  return {
    id: input.id,
    kind: "shortText",
    view: "pin",
    caption: `New pin ${nextNumber(input.station, "shortText")}`,
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
}

/** A character standing free in a station. */
export type FreeCharacter = Extract<TourObject, { kind: "character" }>;

/**
 * The tour's declared character `character` standing free in `station`
 * (the add menu's Character, once the maker made him): at its free spot,
 * on the ground there, in the view a character starts in (`speak`), his
 * name and picture the declaration's.
 */
export function newCharacter(
  input: NewItemInput & { readonly character: TourCharacter },
): FreeCharacter {
  return {
    id: input.id,
    kind: "character",
    view: "speak",
    name: input.character.name,
    image: input.character.image,
    character: input.character.id,
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
}

/** What every new story entry shares: its id, a tap to move on, and its
 *  pose at `spot` in the station's frame (north, up, east; facing
 *  north). */
function entryAt(id: string, spot: StorySpot) {
  return {
    id,
    pose: {
      position: [spot.northM, spot.upM ?? 0, spot.eastM],
      rotation: [0, 0, 0, 1],
    },
    advance: { mode: "tap" },
  } as const;
}

/**
 * The declared character `character` as a new entry at the end of a
 * story: a 3D character as one standing free is (the view a character
 * starts in, `speak`), standing at `spot` in the station's frame (the
 * caller's free spot on the ground, `freeStorySpot`), moving on by a tap
 * as every new story entry does.
 */
export function newCharacterEntry(
  character: TourCharacter,
  id: string,
  spot: StorySpot,
): TourStoryBlock {
  return {
    ...entryAt(id, spot),
    kind: "character",
    view: "speak",
    name: character.name,
    image: character.image,
    character: character.id,
  };
}

/** Why an add found no station: it went (an undo, a delete) between
 *  the press and the add. */
const STATION_GONE =
  "That station is no longer in this tour - nothing was added.";

/** What an add came to: the item placed, or why not. */
export type NewItemOutcome =
  | {
      readonly kind: "added";
      readonly item: TourPin | TourReadingSign | FreeCharacter;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The 3D editor's add in place: a new pin or long text (`newPin`,
 * `newLongText`) in the station `stationId` of `stations`, handed to
 * `place` (the tour's own check). Refused in words when the station is
 * gone (nothing placed) or when `place` refuses (its words).
 */
export function addNewItem(
  input: Omit<NewItemInput, "station"> & {
    readonly stations: readonly TourStation[];
    readonly stationId: string;
    readonly kind: TextAddKind;
    readonly place: (
      item: TourPin | TourReadingSign,
    ) =>
      | { readonly kind: "placed" }
      | { readonly kind: "refused"; readonly reason: string };
  },
): NewItemOutcome {
  const station = input.stations.find((s) => s.id === input.stationId);
  if (station === undefined) return { kind: "refused", reason: STATION_GONE };
  const made: NewItemInput = {
    station,
    id: input.id,
    nowIso: input.nowIso,
    groundAt: input.groundAt,
  };
  const item = KIND_ADD[input.kind].item(made);
  const placed = input.place(item);
  return placed.kind === "placed" ? { kind: "added", item } : placed;
}

/**
 * The add menu's Character in place: the declared character `character`
 * standing free in the station `stationId` (`newCharacter`), handed to
 * `place`; refused in words as `addNewItem`.
 */
export function addNewCharacter(
  input: Omit<NewItemInput, "station"> & {
    readonly stations: readonly TourStation[];
    readonly stationId: string;
    readonly character: TourCharacter;
    readonly place: (
      item: FreeCharacter,
    ) =>
      | { readonly kind: "placed" }
      | { readonly kind: "refused"; readonly reason: string };
  },
): NewItemOutcome {
  const station = input.stations.find((s) => s.id === input.stationId);
  if (station === undefined) return { kind: "refused", reason: STATION_GONE };
  const item = newCharacter({
    station,
    id: input.id,
    nowIso: input.nowIso,
    groundAt: input.groundAt,
    character: input.character,
  });
  const placed = input.place(item);
  return placed.kind === "placed" ? { kind: "added", item } : placed;
}

/** The body a new long text starts with: the format requires one. */
const NEW_LONG_TEXT_BODY = "Write the text here.";

/**
 * What every new story entry starts as, made from words or from a file
 * (`new-file-item.ts`): a card a visitor taps on from, id `id`, posed at
 * its station's free spot (`freePinSpot`) - a real place should it leave
 * the story for the world, never the anchor's own point under the station
 * marker.
 */
export function storyEntryShell(station: TourStation, id: string) {
  return { ...entryAt(id, freePinSpot(station)), view: "card" } as const;
}

/**
 * A new entry at the end of `story` of `station` (`storyEntryShell`),
 * "New pin n" or "New long text n" with n one more than the story's cards
 * of that kind. Moved in the room later, as any story block.
 */
export function newStoryEntry(
  station: TourStation,
  story: TourStory,
  kind: TextAddKind,
  id: string,
): TourStoryBlock {
  const n = story.children.filter((c) => c.kind === kind).length + 1;
  return { ...storyEntryShell(station, id), ...KIND_ADD[kind].entry(n) };
}

/**
 * A new long text of `station`, as `newPin` makes a pin: a reading sign
 * (the short sign that opens the whole text on a tap) at the free spot,
 * titled "New long text n", its body `NEW_LONG_TEXT_BODY`.
 */
export function newLongText(input: NewItemInput): TourReadingSign {
  return {
    id: input.id,
    kind: "longText",
    view: "reading",
    title: `New long text ${nextNumber(input.station, "longText")}`,
    body: NEW_LONG_TEXT_BODY,
    createdAtIso: input.nowIso,
    geo: freeGeo(input),
    station: input.station.id,
  };
}

/** One addable kind's start: what it is at a station's free spot, and as
 *  a story entry numbered `n`. */
interface KindAddRow<K extends TextAddKind> {
  readonly item: (
    input: NewItemInput,
  ) => Extract<TourPin | TourReadingSign, { kind: K }>;
  readonly entry: (
    n: number,
  ) => Omit<
    Extract<TourStoryBlock, { kind: K }>,
    "id" | "view" | "pose" | "advance"
  >;
}

/** What each addable kind starts as, one row per kind: the editor half of
 *  the add line of its row in `kinds/edit-kinds.ts` (which may not hold
 *  these: it would then import this module, and through `tour-document`
 *  and `tour-content` itself again). Keyed by the addable kinds made from
 *  words alone, in the add menu's order: a kind its row makes addable
 *  without a file needs one (a file's kind is `new-file-item.ts`'s). */
export const KIND_ADD: { readonly [K in TextAddKind]: KindAddRow<K> } = {
  shortText: {
    item: newPin,
    entry: (n) => ({ kind: "shortText", caption: `New pin ${String(n)}` }),
  },
  longText: {
    item: newLongText,
    entry: (n) => ({
      kind: "longText",
      title: `New long text ${String(n)}`,
      body: NEW_LONG_TEXT_BODY,
    }),
  },
};
