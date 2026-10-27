/**
 * The 3D view's tree, as data (pure): a story card per station - its
 * number, name, description, card picture and items - the codes, and a
 * chip per layer the view can show, drawn from the tour and `editorView`
 * alone. The DOM is `shell-tree.ts`'s.
 *
 * @see tree-model.ts.md
 */
import type {
  TourAsset,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { objectLook, type ObjectLook } from "../../object-describe.js";
import { worldBlocks } from "../../tour-document.js";
import { blockTitle } from "../block-fields.js";

import { stationTitle } from "../../station-run.js";
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

/** An item of a station, as its card lists it. */
interface TreeChild {
  readonly id: string;
  readonly kind: ObjectLook;
  /** Text, never markup: it comes from a file anyone can write. */
  readonly title: string;
  readonly selected: boolean;
}

/** A station's story card. */
export interface TreeCard {
  readonly id: string;
  /** The page's selection id for the station (`station:<id>`). */
  readonly selection: string;
  /** 1-based, in the tour's order. */
  readonly number: number;
  readonly title: string;
  /** Trimmed; null when there is none. */
  readonly description: string | null;
  /** The card picture's content path in the tour, or none. */
  readonly imagePath: string | null;
  /** Its items listed (unfolded). */
  readonly open: boolean;
  readonly selected: boolean;
  /** One of its items is selected. */
  readonly context: boolean;
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
  readonly stationCount: number;
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
  >;
  /** The layers the view can show, a chip each, in this order. */
  readonly layers: readonly ShellLayer[];
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

/** The tree for `input`. */
export function buildTree(input: TreeInput): TreeModel {
  const { stations, view } = input;
  const open = new Set(view.openStations);
  const cards = stations.map((station, index): TreeCard => {
    const selection = `station:${station.id}`;
    const description = station.description?.trim() ?? "";
    return {
      id: station.id,
      selection,
      number: index + 1,
      title: stationTitle(station, index + 1),
      description: description === "" ? null : description,
      imagePath: stationImagePath(station, input.assets),
      open: open.has(station.id),
      selected: view.selected === selection,
      context: worldBlocks(station).some((i) => i.id === view.selected),
      children: worldBlocks(station).map((item) => ({
        id: item.id,
        kind: objectLook(item.kind),
        title: blockTitle(item),
        selected: item.id === view.selected,
      })),
    };
  });
  const hidden = new Set(view.hiddenLayers);
  return {
    sections: { ...view.openSections },
    stationCount: stations.length,
    cards,
    codes: input.codes.map((code) => ({
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
 *  its sections. */
export function treeFoldOf(tree: TreeModel): {
  readonly openStations: readonly string[];
  readonly openSections: Readonly<Record<TreeSection, boolean>>;
} {
  return {
    openStations: tree.cards.filter((c) => c.open).map((c) => c.id),
    openSections: { ...tree.sections },
  };
}
