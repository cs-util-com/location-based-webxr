/**
 * What an item shows in a card and which files it reads, per kind. The host
 * (`scene-view.ts`, the story panel) decides when an item starts and stops,
 * owns the sound, the placement and the status line, and frees what the
 * item made; the item says what it shows, what it reads and its words.
 *
 * Holds no state: everything an item keeps while it shows lives in the
 * closures of one `showItemCard` call and in its host, so two hosts can each
 * show an item at the same time.
 */

import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import {
  isStageCharacterView,
  type StageCharacterView,
} from "./character-views.js";
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

/** The figure a tap on him reaches, while it stands. */
export interface ItemTapTarget {
  readonly view: StageCharacterView;
  readonly voice: string | undefined;
}

/** Where an item stands in the world while it shows. */
interface ItemStage {
  /** Stand a figure (with no `look`: the plain cut-out). */
  character(blob: Blob, look?: StageCharacterLook): Promise<void>;
  model(blob: Blob): Promise<void>;
  /** What a tap on the stage now reaches; null: the figure a tap reached
   *  has gone. */
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

/** The portrait (the `portrait` view): measured like a picture. */
async function showPortrait(
  blob: Blob,
  name: string,
  host: ItemCardHost,
): Promise<void> {
  const portrait = host.slots.portrait;
  if (portrait === undefined) return;
  if ((await host.checkPicture(blob)) !== null) return;
  if (!host.showing()) return;
  portrait.src = host.url(blob);
  portrait.alt = name;
  portrait.hidden = false;
}

/** Show one item: its words at once, its media as they load. A `stage`
 *  figure or model stands at the station (with its voice); every other view
 *  shows in the card. A new kind fails to compile here until it says what it
 *  shows. */
export function showItemCard(block: TourBlock, host: ItemCardHost): void {
  const { slots } = host;
  switch (block.kind) {
    case "shortText":
      slots.text.textContent = block.caption;
      return;
    case "longText":
      // On a reading stand or a reading sign the text stands in the world
      // (from this step on, as a placed model), drawn as pixels: the card
      // names it by its title and carries its words too, so they can be
      // read here and reached by a screen reader.
      if (block.view === "lectern" || block.view === "reading") {
        const words = plainTextOf(parseTourMarkdown(block.body)).text;
        slots.text.textContent =
          words === "" ? block.title : `${block.title}\n\n${words}`;
        return;
      }
      // Its plain text P (S0): paragraphs a blank line apart, shown as
      // breaks (`white-space: pre-line`), no markup characters (B2b).
      slots.text.textContent = plainTextOf(parseTourMarkdown(block.body)).text;
      return;
    case "picture": {
      slots.text.textContent = block.caption ?? "";
      const alt = block.alt ?? block.caption ?? "";
      host.asset(block.image, "picture", async (blob) => {
        if ((await host.checkPicture(blob)) !== null) {
          return "The picture is too large to show here - the words are below.";
        }
        if (!host.showing()) return undefined;
        slots.image.src = host.url(blob);
        slots.image.alt = alt;
        slots.image.hidden = false;
        return undefined;
      });
      return;
    }
    case "character": {
      slots.text.textContent = block.caption ?? "";
      slots.speaker.textContent = block.name;
      slots.speaker.hidden = false;
      // A story view stands as a character look; `stage`
      // as the plain cut-out; `card` only in the card.
      const view = block.view;
      const look = isStageCharacterView(view)
        ? {
            view,
            name: block.name,
            line: block.caption ?? "",
            voiced: view !== "bubble" && block.voice !== undefined,
            pose: block.pose,
          }
        : undefined;
      const { stage } = host;
      // A declared character's frames sheet (his talking and beckoning
      // poses) stands a story view; the portrait stays his image.
      const sheet =
        look === undefined || block.character === undefined
          ? undefined
          : host.characters?.get(block.character)?.frames;
      if (stage !== undefined && look !== undefined && sheet !== undefined) {
        if (view === "portrait") {
          host.asset(block.image, "portrait", (blob) => {
            void showPortrait(blob, block.name, host);
          });
        }
        host.asset(
          sheet,
          "figure",
          (blob) => stage.character(blob, { ...look, sheet: true }),
          () => {
            // An unreadable sheet: he stands in his one pose, so the
            // figure's failure line the host just wrote does not hold
            // (another asset's line stays); the debug readout names the
            // sheet.
            host.notice("figure", null);
            host.debugLine(
              `story: the frames sheet "${sheet}" of "${block.character ?? ""}" could not be read - he stands in his one pose`,
            );
            host.asset(block.image, "figure", (blob) =>
              stage.character(blob, look),
            );
          },
        );
      } else if (
        stage !== undefined &&
        (view === "stage" || look !== undefined)
      ) {
        host.asset(block.image, "figure", async (blob) => {
          if (view === "portrait") void showPortrait(blob, block.name, host);
          await stage.character(blob, look);
        });
      }
      // A story view's voice plays on a tap on him (the prototype's
      // rule), the bubble view's never; the stage and card views play it
      // with the step.
      if (look !== undefined) {
        host.stage?.tapTarget({ view: look.view, voice: block.voice });
      } else {
        // A plain figure takes the stage from him; a card view leaves
        // the stage as it was.
        if (view === "stage") host.stage?.tapTarget(null);
        // Not the voice of a figure the visitor taps: his look (if one
        // stands) is left alone.
        if (block.voice !== undefined) host.sound(block.voice);
      }
      return;
    }
    case "audio":
      slots.text.textContent = block.transcript ?? "";
      host.sound(block.audio);
      return;
    case "video": {
      // The card plays it: the browser's controls, so a tap plays it (a
      // gesture, so its sound may play); the transcript below. The
      // player shows only with its clip, so its play control always has
      // something to play; until then - and for good when the clip
      // cannot be read, which the status line says (`asset`) - the
      // poster stands as a still picture.
      slots.text.textContent = block.transcript ?? "";
      // The player does not start by itself: until the visitor starts
      // the clip a `lineEnd` step waits the transcript's reading time
      // (as for one that cannot be read), or with no transcript for the
      // visitor to start it; once it plays, its end.
      const clip = host.clip();
      let clipShown = false;
      if (block.poster !== undefined) {
        host.asset(block.poster, "poster", (blob) => {
          const url = host.url(blob);
          slots.video.poster = url;
          if (clipShown) return;
          slots.image.src = url;
          slots.image.alt = "";
          slots.image.hidden = false;
        });
      }
      host.asset(
        block.video,
        "video",
        (blob) => {
          clipShown = true;
          slots.video.onplay = () => {
            clip.started();
          };
          slots.video.onended = () => {
            clip.ended();
          };
          // A clip that loads but does not decode never plays: no
          // sound to clash with, so as one that cannot be read.
          slots.video.onerror = () => {
            clip.lost(
              "The video could not be played here - the words are below.",
            );
          };
          slots.video.src = host.url(blob);
          slots.image.hidden = true;
          slots.image.src = "";
          slots.video.hidden = false;
        },
        () => {
          clip.lost();
        },
      );
      return;
    }
    case "model": {
      slots.text.textContent = block.title ?? "";
      const { stage } = host;
      if (block.view !== "stage" || stage === undefined) return;
      // The model takes the stage from him.
      stage.tapTarget(null);
      host.asset(block.asset, "3D model", (blob) => stage.model(blob));
      return;
    }
    default:
      block satisfies never;
  }
}

/**
 * The files showing `block` may read, in the card or in the world: a figure
 * in any view but the card (a story view of a declared character with a
 * frames sheet stands from the sheet, his image then only for the portrait
 * view's portrait), a model on the stage or placed in the world once
 * reached, a voice in every view. A long text's card is words.
 */
export function itemAssets(
  block: TourBlock,
  characters: ReadonlyMap<string, TourCharacter>,
): readonly string[] {
  switch (block.kind) {
    case "picture":
      return [block.image];
    case "audio":
      return [block.audio];
    case "video":
      return block.poster === undefined
        ? [block.video]
        : [block.video, block.poster];
    case "model":
      return block.view === "card" ? [] : [block.asset];
    case "character": {
      const sheet =
        isStageCharacterView(block.view) && block.character !== undefined
          ? characters.get(block.character)?.frames
          : undefined;
      const figure =
        block.view === "card"
          ? []
          : sheet === undefined
            ? [block.image]
            : block.view === "portrait"
              ? [block.image, sheet]
              : [sheet];
      return block.voice === undefined ? figure : [...figure, block.voice];
    }
    case "shortText":
    case "longText":
      return [];
  }
}
