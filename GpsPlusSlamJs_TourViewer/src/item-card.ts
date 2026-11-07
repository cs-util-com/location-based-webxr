/**
 * What an item shows in a card and which files it reads. The host
 * (`scene-view.ts`, the story panel; `free-items.ts`, what stands free)
 * decides when an item starts and stops, owns the sound, the placement and
 * the status line, and frees what the item made; the item says what it
 * shows, what it reads and its words. What each kind does is its row in
 * `play-kinds.ts`: this module names no kind.
 *
 * Holds no state: everything an item keeps while it shows lives in the
 * closures of one `showItemCard` call and in its host, so two hosts can each
 * show an item at the same time.
 */

import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { playKindOf } from "./play-kinds.js";
import type { StageCharacterLook } from "./scene-stage.js";

/** What a card uses of its `<video>` element (`onended`: a `lineEnd` step
 *  waits for the clip's end). */
export type ItemVideo = Pick<
  HTMLVideoElement,
  "src" | "poster" | "hidden" | "pause" | "removeAttribute" | "load"
> & {
  onended: ((ev: Event) => void) | null;
  /** The visitor started the clip (the player does not autoplay). */
  onplay: ((ev: Event) => void) | null;
  /** The clip loaded but cannot be played (it does not decode here). */
  onerror: OnErrorEventHandler;
} & Partial<Pick<HTMLVideoElement, "paused" | "muted" | "play">>;

/** The places of a card an item fills. */
interface ItemCardSlots {
  /** Text, caption or transcript: the item's words, empty when an
   *  optional caption or transcript is absent. */
  readonly text: Pick<HTMLElement, "textContent">;
  /** A character's name; the host hides it for other items. */
  readonly speaker: Pick<HTMLElement, "textContent" | "hidden">;
  /** The character's round portrait beside his name (the `portrait` view);
   *  absent: none. */
  readonly portrait?: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  readonly image: Pick<HTMLImageElement, "src" | "alt" | "hidden">;
  /** A `<video controls playsinline>` above the transcript. */
  readonly video: ItemVideo;
}

/** What a tap on the standing item reaches, while it stands. */
export interface ItemTapTarget {
  /** A tap shuts or opens the standing look's bubble; no voice plays. */
  readonly bubble: boolean;
  /** The voice a tap plays, or stops while it plays; none: the tap is
   *  taken and plays nothing. */
  readonly voice: string | undefined;
}

/** The world's stage an item draws on (`scene-stage.ts`). A door a host does
 *  not have is absent, and an item that needs it stands nothing there. */
export interface ItemWorld {
  showCharacter(
    stationId: string,
    image: Blob,
    onWaiting?: () => void,
    look?: StageCharacterLook,
  ): Promise<void>;
  showModel?(
    stationId: string,
    model: Blob,
    onWaiting?: () => void,
  ): Promise<void>;
}

/** Where an item draws: its station, and the call that says it waits for
 *  the visitor's position (absent: nobody is told). */
interface ItemPlace {
  readonly stationId: string;
  readonly onWaiting?: () => void;
}

/** Where an item stands in the world while it shows. */
interface ItemStage {
  /** Stand what `draw` draws at the station; `what` names it on the status
   *  line while it waits for the visitor's position. Settles once it
   *  stands (or the host moved on). */
  stand(
    what: string,
    draw: (world: ItemWorld, place: ItemPlace) => Promise<void>,
  ): Promise<void>;
  /** What a tap on the stage now reaches; null: what a tap reached has
   *  gone. */
  tapTarget(target: ItemTapTarget | null): void;
}

/** A clip's three moments. Each has its own effect on a `lineEnd` step, and
 *  each is dropped by the host once the item has stopped. */
export interface ItemClip {
  /** The visitor started it: its end is now what the step waits for. */
  started(): void;
  /** It played to its end. */
  ended(): void;
  /** It cannot play: the step waits the words' reading time. `why`, a line
   *  for the status line; none when `asset` already wrote one. */
  lost(why?: string): void;
}

/** What an item needs of whoever shows it. */
export interface ItemCardHost {
  readonly slots: ItemCardSlots;
  /** An empty element of the card that an item fills on its own, with
   *  elements it makes; the host empties it when the item stops. Absent
   *  where no card shows. */
  readonly surface?: HTMLElement;
  /** The tour's declared characters by id. None when absent. */
  readonly characters?: ReadonlyMap<string, TourCharacter>;
  /** Why a picture may not be shown, or null: measured before the browser
   *  decodes it. */
  checkPicture(blob: Blob): Promise<string | null>;
  /** Read one file with its loading and failure lines. `use` may return a
   *  line that stays on the status line. */
  asset(
    id: string,
    what: string,
    use: (blob: Blob) => Promise<string | void> | void,
    onFail?: () => void,
  ): void;
  /** An object URL, freed by the host when the item stops. */
  url(blob: Blob): string;
  /** Play a sound with the item; the host owns the channel. */
  sound(id: string): void;
  /** Absent where there is no stage: nothing stands, the words still show. */
  readonly stage?: ItemStage;
  /** A clip starts showing. */
  clip(): ItemClip;
  /** False once the item has stopped: a load landing later is dropped. */
  showing(): boolean;
  /** Set or clear the status line's entry for `what`. */
  notice(what: string, text: string | null): void;
  /** A line for the `?debug=1` readout. */
  debugLine(text: string): void;
}

/** The status line's entry an item of no known kind writes. */
const UNKNOWN_KIND = "This item cannot be shown here.";

/** Show one item: its words at once, its media as they load, by its kind's
 *  row. A block of a kind this viewer has no row for shows nothing and says
 *  so on the status line, naming the kind in the debug readout. */
export function showItemCard(block: TourBlock, host: ItemCardHost): void {
  const kind: unknown = block.kind;
  const row = playKindOf(kind);
  if (row === undefined) {
    host.notice("item", UNKNOWN_KIND);
    host.debugLine(`story: no card for an item of the kind "${String(kind)}"`);
    return;
  }
  row.card(block, host);
}

/**
 * The files showing `block` may read, in the card or in the world, by its
 * kind's row: none for a kind this viewer has no row for.
 */
export function itemAssets(
  block: TourBlock,
  characters: ReadonlyMap<string, TourCharacter>,
): readonly string[] {
  return playKindOf(block.kind)?.assets(block, characters) ?? [];
}
