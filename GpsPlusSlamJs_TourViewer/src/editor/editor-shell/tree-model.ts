/**
 * The 3D view's tree, as data (pure): an explorer row per station - its
 * number, name, item count, lock, card picture and items (story folders,
 * then plain folders with their items, then free items) - the codes,
 * which rows are picked, and a chip per layer the view can show,
 * drawn from the tour, `editorView` and the tree's search alone. The DOM
 * is `shell-tree.ts`'s.
 *
 * @see tree-model.ts.md
 */
import {
  tourFreeBlocks,
  tourFreeEntries,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  isTourFolder,
  isTourStoryBlock,
  tourStories,
  type TourStory,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { KIND_EDIT, type KindLook } from "../../kinds/edit-kinds.js";
import { objectTitle } from "../../object-describe.js";
import type { TreeGroup } from "gps-plus-slam-editor-kit/chrome";
import { worldBlocks } from "../../tour-document.js";

import { stationTitle } from "../../station-run.js";
import { FOLDER_PREFIX, matchesQuery, STORY_PREFIX } from "../editor-model.js";
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

/** A story's step that is no block: a choice or a quiz. */
type StepKind = Exclude<TourStoryChild["kind"], TourBlock["kind"]>;

/** What a row of the tree is, which is its icon: a block by its kind's
 *  look (`KIND_EDIT`), a story's choice or quiz by its kind. */
export type TreeRowKind = KindLook | StepKind;

/** The words the tree's search finds a choice or a quiz by besides its
 *  title; a block's are its kind's row's (`KIND_EDIT` `searchWords`). */
const STEP_SEARCH_WORDS = {
  choice: "choice",
  quiz: "quiz question",
} as const satisfies { readonly [K in StepKind]: string };

/** The words the tree's search finds a story's entry by besides its
 *  title. */
function entryWords(child: TourStoryChild): string {
  return isTourStoryBlock(child)
    ? KIND_EDIT[child.kind].searchWords
    : STEP_SEARCH_WORDS[child.kind];
}

/** What a folder's row is found by besides its title. */
const STORY_SEARCH_WORDS = "story folder";

/** What a plain folder's row is found by besides its title. */
const PLAIN_FOLDER_SEARCH_WORDS = "folder group";

/** An item of a station, as its row lists it. */
export interface TreeChild {
  readonly id: string;
  readonly kind: TreeRowKind;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly title: string;
  readonly selected: boolean;
  /** A story's entry: its 1-based place in the story. */
  readonly place?: number;
}

/** A story folder of a station: its entries, played in order. */
export interface TreeFolder {
  readonly id: string;
  /** The page's selection id for the story (`story:<id>`). */
  readonly selection: string;
  readonly title: string;
  /** Its entries listed. */
  readonly open: boolean;
  /** A search lists it for some of its entries, not for itself: its fold
   *  is the search's (`TreeInput.searchFolded`), not the store's. */
  readonly searchOpened: boolean;
  readonly selected: boolean;
  /** One of its entries is selected. */
  readonly context: boolean;
  /** How many entries it holds, found by a search or not. */
  readonly count: number;
  /** Its entries (those a search found, while one runs). */
  readonly children: readonly TreeChild[];
}

/** A plain folder of a station: a group of its items in the scene, which
 *  move together and have no order among themselves. A folder inside it
 *  (a file may have one; the editor groups one level deep) is listed in
 *  it: its items are this folder's rows. */
export interface TreePlainFolder {
  readonly id: string;
  /** The page's selection id for the folder (`folder:<id>`). */
  readonly selection: string;
  /** Its title, else "Folder". */
  readonly title: string;
  /** Its items listed: every folder is, until folded. */
  readonly open: boolean;
  /** Selected, or one of the rows picked (`EditorViewState.picked`). */
  readonly selected: boolean;
  /** One of its items is selected. */
  readonly context: boolean;
  /** How many items it holds, found by a search or not. */
  readonly count: number;
  /** Its items (those a search found, while one runs). */
  readonly children: readonly TreeChild[];
}

/** A row's kind and name, for a block. */
function blockRow(block: TourBlock): Pick<TreeChild, "kind" | "title"> {
  return { kind: KIND_EDIT[block.kind].look, title: objectTitle(block) };
}

/** A row's kind and name, for a story's entry. */
function entryRow(child: TourStoryChild): Pick<TreeChild, "kind" | "title"> {
  if (isTourStoryBlock(child)) return blockRow(child);
  return child.kind === "choice"
    ? { kind: "choice", title: `Choice: ${child.prompt}` }
    : { kind: "quiz", title: `Quiz: ${child.question}` };
}

/** A story's entries as rows, each with its 1-based place. */
export function storyRows(
  story: Pick<TourStory, "children">,
): (Pick<TreeChild, "id" | "kind" | "title"> & { readonly place: number })[] {
  return story.children.map((child, index) => ({
    id: child.id,
    ...entryRow(child),
    place: index + 1,
  }));
}

/** A row of the inspector's Contents: an item, or a story by its
 *  selection. */
export interface StationContent {
  readonly id: string;
  readonly kind: TreeRowKind | "story";
  readonly title: string;
}

/** A station's stories, then its free items: as the tree lists them. */
export function stationContents(station: TourStation): StationContent[] {
  return [
    ...tourStories(station).map((story): StationContent => ({
      id: `${STORY_PREFIX}${story.id}`,
      kind: "story",
      title: story.title,
    })),
    ...tourFreeBlocks(station).map((block): StationContent => ({
      id: block.id,
      ...blockRow(block),
    })),
  ];
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
  /** Its story folders, listed before its free items. */
  readonly folders: readonly TreeFolder[];
  /** Its plain folders, listed after its stories, before its other free
   *  items (the saved file's order: groups first). */
  readonly groups: readonly TreePlainFolder[];
  /** Its free items in no folder (those a search found, while one runs). */
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
    Partial<
      Pick<
        EditorViewState,
        "unlockedStations" | "openStories" | "picked" | "foldedFolders"
      >
    >;
  /** The layers the view can show, a chip each, in this order. */
  readonly layers: readonly ShellLayer[];
  /** The tree's search (none: every station, every code). */
  readonly query?: string;
  /** The stations (by id) and stories (by selection) a search unfolded
   *  whose arrow folded them again while it runs (the shell's, cleared
   *  with each new search). */
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

/** The folder of `story` as `buildTree` lists it, or null when a search
 *  finds neither it nor an entry of it. `whole`: its station was found, so
 *  all of it is listed, folded as it was. */
function folderOf(
  story: TourStory,
  whole: boolean,
  input: TreeInput,
  query: string,
): TreeFolder | null {
  const { view } = input;
  const selection = `${STORY_PREFIX}${story.id}`;
  const entries = story.children.map((child, i): TreeChild => ({
    id: child.id,
    ...entryRow(child),
    selected: child.id === view.selected,
    place: i + 1,
  }));
  const listed =
    whole || matchesQuery(query, [story.title, STORY_SEARCH_WORDS]);
  const found = listed
    ? entries
    : entries.filter((c, i) => {
        const child = story.children[i];
        return (
          child !== undefined &&
          matchesQuery(query, [c.title, entryWords(child)])
        );
      });
  if (!listed && found.length === 0) return null;
  return {
    id: story.id,
    selection,
    title: story.title,
    open: listed
      ? (view.openStories ?? []).includes(story.id)
      : !(input.searchFolded ?? []).includes(selection),
    searchOpened: !listed,
    selected: view.selected === selection,
    context: entries.some((e) => e.selected),
    count: entries.length,
    children: found,
  };
}

/**
 * The tree for `input`. With a search (`query`, the 2D rail's matching:
 * `matchesQuery`), a station is listed when its name or description holds
 * it - with its items, folded as it was - or when items of it do: then
 * it is listed with just those items, unfolded unless `searchFolded`
 * names it. A story takes the same rule inside its station. Codes are
 * listed when their title or line holds it.
 */
export function buildTree(input: TreeInput): TreeModel {
  const { stations, view } = input;
  const query = (input.query ?? "").trim();
  const open = new Set(view.openStations);
  const searchFolded = new Set(input.searchFolded ?? []);
  const unlocked = new Set(view.unlockedStations ?? []);
  const folded = new Set(view.foldedFolders ?? []);
  const picked = new Set(view.picked ?? []);
  /** Selected, or one of the rows picked. */
  const isPicked = (id: string): boolean =>
    id === view.selected || picked.has(id);
  const cards = stations.flatMap((station, index): TreeCard[] => {
    const selection = `station:${station.id}`;
    const description = station.description?.trim() ?? "";
    const title = stationTitle(station, index + 1);
    const entries = tourFreeEntries(station);
    const items = entries.map(({ block }): TreeChild => ({
      id: block.id,
      ...blockRow(block),
      selected: isPicked(block.id),
    }));
    const stationFound = matchesQuery(query, [title, description]);
    const finds = (c: TreeChild, i: number): boolean => {
      const block = entries[i]?.block;
      return (
        block !== undefined &&
        matchesQuery(query, [c.title, KIND_EDIT[block.kind].searchWords])
      );
    };
    const found = items.filter(
      (c, i) =>
        entries[i]?.folder.length === 0 && (stationFound || finds(c, i)),
    );
    const groups = station.children.flatMap((child): TreePlainFolder[] => {
      if (!isTourFolder(child)) return [];
      const folderSelection = `${FOLDER_PREFIX}${child.id}`;
      const folderTitle = child.title ?? "Folder";
      const listed =
        stationFound ||
        matchesQuery(query, [folderTitle, PLAIN_FOLDER_SEARCH_WORDS]);
      const inIt = items.flatMap((c, i) =>
        entries[i]?.folder[0] === child.id ? [{ c, i }] : [],
      );
      const shown = inIt.flatMap(({ c, i }) =>
        listed || finds(c, i) ? [c] : [],
      );
      if (!listed && shown.length === 0) return [];
      return [
        {
          id: child.id,
          selection: folderSelection,
          title: folderTitle,
          open: !folded.has(child.id),
          selected: isPicked(folderSelection),
          context: inIt.some(({ c }) => c.selected),
          count: inIt.length,
          children: shown,
        },
      ];
    });
    const folders = tourStories(station).flatMap((story) => {
      const folder = folderOf(story, stationFound, input, query);
      return folder === null ? [] : [folder];
    });
    if (
      found.length === 0 &&
      folders.length === 0 &&
      groups.length === 0 &&
      !stationFound
    ) {
      return [];
    }
    const entryCount = tourStories(station).reduce(
      (sum, story) => sum + story.children.length,
      0,
    );
    const inStory = tourStories(station).some(
      (story) =>
        view.selected === `${STORY_PREFIX}${story.id}` ||
        story.children.some((c) => c.id === view.selected),
    );
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
        count: items.length + entryCount,
        unlocked: unlocked.has(station.id),
        selected: view.selected === selection,
        context: inStory || items.some((i) => i.selected),
        folders,
        groups,
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

/** The folds a tree shows: its unfolded stations in the tour's order, its
 *  unfolded stories, and its sections. Meaningful for a tree drawn without
 *  a search, which unfolds the stations whose items it finds. */
export function treeFoldOf(tree: TreeModel): {
  readonly openStations: readonly string[];
  readonly openStories: readonly string[];
  readonly openSections: Readonly<Record<TreeSection, boolean>>;
} {
  return {
    openStations: tree.cards.filter((c) => c.open).map((c) => c.id),
    openStories: tree.cards.flatMap((c) =>
      c.folders.filter((f) => f.open).map((f) => f.id),
    ),
    openSections: { ...tree.sections },
  };
}

/** The stations as the tree's groups for the kit's click rule: each
 *  station's id, with its free items' ids as its children and its stories
 *  as groups inside it. */
export function stationGroups(stations: readonly TourStation[]): TreeGroup[] {
  return stations.map((s) => ({
    id: s.id,
    children: tourFreeEntries(s)
      .filter((e) => e.folder.length === 0)
      .map((e) => e.block.id),
    groups: [
      ...tourStories(s).map((story) => ({
        id: story.id,
        selection: `${STORY_PREFIX}${story.id}`,
        children: story.children.map((child) => child.id),
      })),
      // A plain folder holds its items in the click rule too: a click on
      // one unfolds the folder (the shell tells it from a story).
      ...s.children.flatMap((child) =>
        isTourFolder(child)
          ? [
              {
                id: child.id,
                selection: `${FOLDER_PREFIX}${child.id}`,
                children: tourFreeEntries(s)
                  .filter((e) => e.folder[0] === child.id)
                  .map((e) => e.block.id),
              },
            ]
          : [],
      ),
    ],
  }));
}
