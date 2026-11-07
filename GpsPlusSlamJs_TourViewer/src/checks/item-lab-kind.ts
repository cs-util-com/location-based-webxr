/**
 * The item lab's kinds (`item-lab.ts`, `item-contract.test.ts`): what a kind's
 * folder under `public/prototypes/item-kinds/` must hold, and the valid blocks
 * that carry it through the two real hosts. No format knows such a kind, so
 * each host gets a block it can play and the lab's `showItem` seam swaps the
 * kind in for that one block.
 *
 * @see item-lab-kind.ts.md
 */

import type {
  TourAsset,
  TourBlock,
  TourManifest,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { isRecord } from "gps-plus-slam-app-framework/utils/json-guards";

import { showItemCard, type ItemCardHost } from "../item-card.js";
import type { NarrationAudio } from "../narration-player.js";

/** The kind a bare link opens. */
const DEFAULT_KIND = "stamp-1";
/** A folder's name: nothing in it can leave the kinds' folder. */
const KIND_NAME = /^[a-z0-9][a-z0-9-]*$/;
/** The block the kind stands in for, in both hosts. */
const CARRIER_ID = "lab-item";
/** The carriers stand on the station's spot, facing as it does. */
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
/** The silent element's length (s). */
const SILENT_S = 2;

interface KindFile {
  readonly id: string;
  readonly kind: string;
  /** The file's name in the kind's folder. */
  readonly file: string;
  readonly width?: number;
  readonly height?: number;
}

interface KindSample {
  readonly name: string;
  /** What must be readable whatever else fails. */
  readonly words: string;
  /** The kind's own block, handed to its `show`. */
  readonly block: Record<string, unknown>;
  readonly assets: readonly KindFile[];
  /** Why the kind cannot stand in the free host yet: its contract row is
   *  then marked known. */
  readonly freeKnown?: string;
}

/** A kind's folder, read. */
export interface ItemKind {
  readonly name: string;
  show(block: unknown, host: ItemCardHost): void;
  /** Every file `show` may read. */
  assets(block: unknown): readonly string[];
  readonly sample: KindSample;
}

/** The kind `search` names, its default when it names none, or null for a
 *  name that is no folder name. */
export function kindNameOf(search: string): string | null {
  const name = new URLSearchParams(search).get("kind") ?? DEFAULT_KIND;
  return KIND_NAME.test(name) ? name : null;
}

function isKindFile(value: unknown): value is KindFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.file === "string"
  );
}

/** A folder's module and sample as a kind. Throws a line naming what is
 *  missing: a half-made kind must say so. */
export function readItemKind(
  name: string,
  module: unknown,
  sample: unknown,
): ItemKind {
  const fail = (what: string): TypeError =>
    new TypeError(`The kind "${name}" ${what}`);
  if (!isRecord(module) || typeof module.show !== "function") {
    throw fail("has no show(block, host) in kind.js");
  }
  if (typeof module.assets !== "function") {
    throw fail("has no assets(block) in kind.js");
  }
  if (!isRecord(sample)) throw fail("has no sample.json object");
  if (typeof sample.name !== "string" || sample.name === "") {
    throw fail('has no "name" in sample.json');
  }
  if (typeof sample.words !== "string" || sample.words === "") {
    throw fail('has no "words" in sample.json');
  }
  if (!isRecord(sample.block)) throw fail('has no "block" in sample.json');
  if (!Array.isArray(sample.assets) || !sample.assets.every(isKindFile)) {
    throw fail('needs "assets" of { id, kind, file } in sample.json');
  }
  return {
    name,
    show: module.show as ItemKind["show"],
    assets: module.assets as ItemKind["assets"],
    sample: sample as unknown as KindSample,
  };
}

/** The kind's files as a tour's assets; a path is a file name of its folder. */
export function kindAssets(kind: ItemKind): ReadonlyMap<string, TourAsset> {
  return new Map(
    kind.sample.assets.map(({ file, id, ...rest }) => [
      id,
      { ...rest, id, path: file } as TourAsset,
    ]),
  );
}

/** The block a story plays where the kind stands: a line of its words. */
export function storyCarrier(kind: ItemKind): Record<string, unknown> {
  return {
    id: CARRIER_ID,
    kind: "shortText",
    view: "card",
    caption: kind.sample.words,
    pose: POSE,
  };
}

/** The block the free host stands where the kind stands: only a character
 *  reaches it. */
export function freeCarrier(kind: ItemKind): TourBlock {
  const figure = kind.sample.assets.find((file) => file.kind === "image");
  return {
    id: CARRIER_ID,
    kind: "character",
    view: "speak",
    name: kind.sample.name,
    image: figure?.id ?? "",
    caption: kind.sample.words,
    pose: POSE,
  } as unknown as TourBlock;
}

/** A station around `steps`: one story, or free blocks. */
function stationOf(children: readonly unknown[]): TourStation {
  return {
    id: "lab",
    title: "The item lab",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
    activateRadiusM: 30,
    foundRadiusM: 5,
    hint: "arrow",
    children,
  } as unknown as TourStation;
}

/** The kind between two steps' worth of story: it, then one card. */
export function storyStation(kind: ItemKind): TourStation {
  return stationOf([
    {
      id: "lab-story",
      kind: "story",
      title: `The story around ${kind.name}`,
      children: [
        { ...storyCarrier(kind), advance: { mode: "tap" } },
        {
          id: "lab-next",
          kind: "shortText",
          view: "card",
          caption: "The story's next step.",
          pose: POSE,
          advance: { mode: "tap" },
        },
      ],
    },
  ]);
}

/** A tour of one station where the kind stands free. */
export function freeTour(kind: ItemKind): Pick<TourManifest, "stations"> {
  return { stations: [stationOf([freeCarrier(kind)])] };
}

/** The hosts' `showItem`: the kind for its carrier, the real card otherwise. */
export function showWith(
  kind: ItemKind,
): (block: TourBlock, host: ItemCardHost) => void {
  return (block, host) => {
    if (block.id === CARRIER_ID) kind.show(kind.sample.block, host);
    else showItemCard(block, host);
  };
}

/** An element's clock with no sound: the real voice player runs over it and
 *  no autoplay rule can refuse it. */
export interface SilentAudio extends NarrationAudio {
  /** It ran out. */
  finish(): void;
}

export function createSilentAudio(): SilentAudio {
  const listeners = new Map<string, (() => void)[]>();
  const fire = (type: string): void => {
    for (const listener of listeners.get(type) ?? []) listener();
  };
  let paused = true;
  return {
    src: "",
    currentTime: 0,
    duration: SILENT_S,
    preload: "",
    get paused() {
      return paused;
    },
    play() {
      paused = false;
      fire("play");
      return Promise.resolve();
    },
    pause() {
      paused = true;
      fire("pause");
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeAttribute: () => undefined,
    load: () => undefined,
    finish() {
      paused = true;
      this.currentTime = this.duration;
      fire("ended");
    },
  };
}
