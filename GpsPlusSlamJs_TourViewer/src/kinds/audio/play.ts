/**
 * The visitor's audio row: in a story's card the sound plays with its
 * transcript; standing free, the view says what it is - `zone` an ambient
 * sound heard by distance (`zone.ts`), `spot` a narration circle played on
 * a tap inside it (`spot.ts`).
 *
 * @see play.ts.md
 */

import type { TourAudioBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";

import type { KindPlay } from "../../play-kinds.js";
import { spotPart } from "./spot.js";
import { zonePart } from "./zone.js";

export const AUDIO_PLAY: KindPlay<TourAudioBlock> = {
  card(block, host) {
    host.slots.text.textContent = block.transcript ?? "";
    host.sound(block.audio);
  },
  assets: (block) => [block.audio],
  world(block, env) {
    if (block.view === "zone") return zonePart(block, env);
    if (block.view === "spot") return spotPart(block, env);
    return null;
  },
};
