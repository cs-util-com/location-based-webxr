/**
 * The 3D view's tree, as data (pure): an explorer row per station - its
 * number, name, item count, lock, card picture and items (story folders
 * before free items, once the format has them) - the codes, and a chip
 * per layer the view can show, drawn from the tour, `editorView` and the
 * tree's search alone. The DOM is `shell-tree.ts`'s.
 *
 * @see tree-model.ts.md
 */
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStationStoryBlocks } from "gps-plus-slam-app-framework/ar/tour-story";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  objectLook,
  objectTitle,
  type ObjectLook,
} from "../../object-describe.js";
import type { TreeGroup } from "gps-plus-slam-editor-kit/chrome";
import { worldBlocks } from "../../tour-document.js";

import { stationTitle } from "../../station-run.js";
import { KIND_SEARCH_WORDS, matchesQuery } from "../editor-model.js";
import type {
  EditorViewState,
  ShellLayer,
  TreeSection,
} from "../editor-view.js";

/** A layer chip's words. */
const LAYER_LABELS: Readonly<Record<ShellLayer, string>> = {
  walk: "Walk",
  depth: "Depth points",
  codes: "Codes",
  buildings: "Buildings",
  names: "Station names",
};

/** The words the tree's search finds an item by besides its title: the
 *  2D rail's for a pin and a photo (`editor-model.ts`), each look's own
 *  word, and a long text's and a model's. */
const LOOK_SEARCH_WORDS: Readonly<Record<ObjectLook, string>> = {
  pin: `pin ${KIND_SEARCH_WORDS.pin}`,
  photo: `photo ${KIND_SEARCH_WORDS.photo}`,
  text: "long text reading sign",
  model: "3d model",
};

/** An item of a station, as its row lists it. */
export interface TreeChild {
  readonly id: string;
  readonly kind: ObjectLook;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly title: string;
  readonly selected: boolean;
}

/** A story folder of a station: its entries, played in order. The
 *  format has none yet, so `buildTree` lists none; its row is drawn
 *  before the station's free items when one comes (`shell-tree.ts`). */
export interface TreeFolder {
  readonly id: string;
  readonly title: string;
  readonly open: boolean;
  readonly children: readonly TreeChild[];
}

/** A station's row and what it lists. */
export interface TreeCard {
  readonly id: string;
  /** The page's selection id for the station (`station:<id>`). */
  readonly selection: string;
  /** 1-based, in the tour's order. */
  readonly number: number;
  readonly title: string;
  /** The card picture's content path in the tour, or none. */
  readonly imagePath: string | null;
  /** Its items listed: unfolded, or a search found some of them (and
   *  its arrow has not folded it since: `TreeInput.searchFolded`). */
  readonly open: boolean;
  /** A search lists it for some of its items, not for itself: its fold
   *  is the search's (`TreeInput.searchFolded`), not the store's. */
  readonly searchOpened: boolean;
  /** How many items it holds (its folded row shows it). */
  readonly count: number;
  /** Its position may be moved (every station starts locked). */
  readonly unlocked: boolean;
  readonly selected: boolean;
  /** One of its items is selected. */
  readonly context: boolean;
  /** Its story folders, listed before its free items (none yet). */
  readonly folders: readonly TreeFolder[];
  /** Its free items (those a search found, while one runs). */
  readonly children: readonly TreeChild[];
}

interface TreeCode {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly selected: boolean;
}

interface TreeChip {
  readonly layer: ShellLayer;
  readonly label: string;
  readonly on: boolean;
}

export interface TreeModel {
  readonly sections: Readonly<Record<TreeSection, boolean>>;
  /** The tour's stations, found by a search or not. */
  readonly stationCount: number;
  /** The search, trimmed ("": none runs). */
  readonly query: string;
  readonly cards: readonly TreeCard[];
  readonly codes: readonly TreeCode[];
  readonly chips: readonly TreeChip[];
}

export interface TreeInput {
  /** The tour's stations, in its order. */
  readonly stations: readonly TourStation[];
  readonly assets: readonly TourAsset[];
  /** The tour's codes in the phone's numbering (`editor-model.ts`). */
  readonly codes: readonly {
    readonly id: string;
    readonly title: string;
    readonly meta: string;
  }[];
  readonly view: Pick<
    EditorViewState,
    "selected" | "openStations" | "openSections" | "hiddenLayers"
  > &
    Partial<Pick<EditorViewState, "unlockedStations">>;
  /** The layers the view can show, a chip each, in this order. */
  readonly layers: readonly ShellLayer[];
  /** The tree's search (none: every station, every code). */
  readonly query?: string;
  /** The stations a search unfolded whose arrow folded them again while
   *  it runs (the shell's, cleared with each new search). */
  readonly searchFolded?: readonly string[];
}

/**
 * A station's card picture: the photo of that station or the image asset
 * of the tour its `image` names, else its first photo; null without any.
 * A model asset or an id naming neither is no picture.
 */
export function stationImagePath(
  station: TourStation,
  assets: readonly TourAsset[],
): string | null {
  const imagePath = (id: string): string | null =>
    assets.find((a) => a.id === id && a.kind === "image")?.path ?? null;
  const photos = worldBlocks(station).flatMap((i) =>
    i.kind === "picture" ? [i] : [],
  );
  const named = station.image;
  if (named !== undefined) {
    const photo = photos.find((p) => p.id === named);
    if (photo !== undefined) return imagePath(photo.image);
    const asset = imagePath(named);
    if (asset !== null) return asset;
  }
  const first = photos[0];
  return first === undefined ? null : imagePath(first.image);
}

/**
 * The tree for `input`. With a search (`query`, the 2D rail's matching:
 * `matchesQuery`), a station is listed when its name or description holds
 * it - with its items, folded as it was - or when items of it do: then
 * it is listed with just those items, unfolded unless `searchFolded`
 * names it. Codes are listed when
 * their title or line holds it.
 */
export function buildTree(input: TreeInput): TreeModel {
  const { stations, view } = input;
  const query = (input.query ?? "").trim();
  const open = new Set(view.openStations);
  const searchFolded = new Set(input.searchFolded ?? []);
  const unlocked = new Set(view.unlockedStations ?? []);
  const cards = stations.flatMap((station, index): TreeCard[] => {
    const selection = `station:${station.id}`;
    const description = station.description?.trim() ?? "";
    const title = stationTitle(station, index + 1);
    const items = worldBlocks(station).map((item): TreeChild => ({
      id: item.id,
      kind: objectLook(item.kind),
      title: objectTitle(item),
      selected: item.id === view.selected,
    }));
    const stationFound = matchesQuery(query, [title, description]);
    const found = stationFound
      ? items
      : items.filter((c) =>
          matchesQuery(query, [c.title, LOOK_SEARCH_WORDS[c.kind]]),
        );
    if (found.length === 0 && !stationFound) return [];
    return [
      {
        id: station.id,
        selection,
        number: index + 1,
        title,
        imagePath: stationImagePath(station, input.assets),
        open: stationFound
          ? open.has(station.id)
          : !searchFolded.has(station.id),
        searchOpened: !stationFound,
        count: items.length,
        unlocked: unlocked.has(station.id),
        selected: view.selected === selection,
        context: items.some((i) => i.selected),
        folders: [],
        children: found,
      },
    ];
  });
  const hidden = new Set(view.hiddenLayers);
  return {
    sections: { ...view.openSections },
    stationCount: stations.length,
    query,
    cards,
    codes: input.codes
      .filter((code) => matchesQuery(query, [code.title, code.meta]))
      .map((code) => ({
        id: code.id,
        title: code.title,
        meta: code.meta,
        selected: code.id === view.selected,
      })),
    chips: input.layers.map((layer) => ({
      layer,
      label: LAYER_LABELS[layer],
      on: !hidden.has(layer),
    })),
  };
}

/** The folds a tree shows: its unfolded stations in the tour's order, and
 *  its sections. Meaningful for a tree drawn without a search, which
 *  unfolds the stations whose items it finds. */
export function treeFoldOf(tree: TreeModel): {
  readonly openStations: readonly string[];
  readonly openSections: Readonly<Record<TreeSection, boolean>>;
} {
  return {
    openStations: tree.cards.filter((c) => c.open).map((c) => c.id),
    openSections: { ...tree.sections },
  };
}

/** The stations as the tree's groups for the kit's click rule: each
 *  station's id, with its items' ids as its children. */
export function stationGroups(stations: readonly TourStation[]): TreeGroup[] {
  return stations.map((s) => ({
    id: s.id,
    children: [...tourFreeBlocks(s), ...tourStationStoryBlocks(s)].map(
      (block) => block.id,
    ),
  }));
}
