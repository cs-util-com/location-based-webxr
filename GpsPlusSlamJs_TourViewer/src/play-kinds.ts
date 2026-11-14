/**
 * The visitor's kinds: one row per kind of the format, saying what its item
 * shows in a card and which files it reads. A kind the format gains is a
 * compile error here until it has a row, and nowhere else in the card's
 * code. A row may live in its kind's own module (`character-card.ts`); a
 * small one stays inline.
 *
 * @see play-kinds.ts.md
 */

import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import {
  isTourBlockKind,
  type TourBlockKind,
  type TourBlockOfKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import { CHARACTER_PLAY } from "./character-card.js";
import { AUDIO_PLAY } from "./kinds/audio/play.js";
import type { ItemCardHost } from "./item-card.js";
import { modelWorld } from "./kinds/model/world.js";
import { pictureWorld } from "./kinds/picture/world.js";
import { shortTextWorld } from "./kinds/short-text/world.js";
import { videoWorld } from "./kinds/video/video-world.js";
import type { WorldEnv, WorldPart } from "./world-part.js";

/** What one kind does for a visitor. */
export interface KindPlay<B extends TourBlock> {
  /** Show the item: its words at once (before any read), its media as
   *  they load, through the host only. */
  card(block: B, host: ItemCardHost): void;
  /** Every file `card` may read, in the card or in the world. */
  assets(
    block: B,
    characters: ReadonlyMap<string, TourCharacter>,
  ): readonly string[];
  /** Its part in the world (`world-part.ts`), built for `env.mode`; null
   *  in a view that stands nothing. Absent: the kind stands nothing through
   *  the world door (the stands and signs are the renderer's own drawings,
   *  a free character's in play the free host's). */
  world?(block: B, env: WorldEnv): WorldPart | null;
}

/** No file: a text's card is words. */
const NO_FILES = (): readonly string[] => [];

/** THE visitor's list, keyed by the format's kinds. */
export const PLAY_KINDS = {
  shortText: {
    card(block, { slots }) {
      slots.text.textContent = block.caption;
    },
    assets: NO_FILES,
    // A sign or a hint at the edge; the pin is the renderer's label.
    world: shortTextWorld,
  },
  longText: {
    card(block, { slots }) {
      const words = plainTextOf(parseTourMarkdown(block.body)).text;
      // On a reading stand or a reading sign the text stands in the world
      // (from this step on, as a placed model), drawn as pixels: the card
      // names it by its title and carries its words too, so they can be
      // read here and reached by a screen reader.
      if (block.view === "lectern" || block.view === "reading") {
        slots.text.textContent =
          words === "" ? block.title : `${block.title}\n\n${words}`;
        return;
      }
      // Its plain text P (S0): paragraphs a blank line apart, shown as
      // breaks (`white-space: pre-line`), no markup characters (B2b).
      slots.text.textContent = words;
    },
    assets: NO_FILES,
  },
  picture: {
    card(block, host) {
      const { slots } = host;
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
    },
    assets: (block) => [block.image],
    // A framed print or a cut-out stands in the station.
    world: (block, env) => pictureWorld(block, env),
  },
  video: {
    card(block, host) {
      const { slots } = host;
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
    },
    assets: (block) =>
      block.poster === undefined ? [block.video] : [block.video, block.poster],
    // Stands free in the station as a screen, a cutout or a porthole.
    world: (block, env) => videoWorld(block, env),
  },
  audio: AUDIO_PLAY,
  model: {
    // Its title in the card; it stands in the world through its row.
    card(block, host) {
      host.slots.text.textContent = block.title ?? "";
    },
    // Placed in the world once reached.
    assets: (block) => (block.view === "card" ? [] : [block.asset]),
    // Placed in the station in its world view, through the adapter.
    world: modelWorld,
  },
  character: CHARACTER_PLAY,
} as const satisfies {
  readonly [K in TourBlockKind]: KindPlay<TourBlockOfKind[K]>;
};

/** The row of `kind`, or undefined for a value of no kind this viewer
 *  knows (a newer tour's, a lab's). */
export function playKindOf(kind: unknown): KindPlay<TourBlock> | undefined {
  return isTourBlockKind(kind) ? PLAY_KINDS[kind] : undefined;
}

/** The world door the renderer asks (`content-placement.ts`): `block`'s
 *  part by its kind's row, or null when the row has none or no row knows
 *  the kind. */
export function worldPartOf(block: TourBlock, env: WorldEnv): WorldPart | null {
  return playKindOf(block.kind)?.world?.(block, env) ?? null;
}
