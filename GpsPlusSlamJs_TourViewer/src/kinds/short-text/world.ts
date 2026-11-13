/**
 * A short text's part in the world: the door (`world-part.ts`) to its
 * world views beyond the pin, which the renderer draws as a label itself.
 * A sign (`sign.ts`) and a hint at the screen's edge (`edge-hint.ts`); any
 * other view stands nothing through the door.
 *
 * @see world.ts.md
 */

import type { TourBlockOfKind } from "gps-plus-slam-app-framework/ar/tour-kinds";

import type { WorldEnv, WorldPart } from "../../world-part.js";
import { edgeHintPart } from "./edge-hint.js";
import { signPart } from "./sign.js";

/** `block`'s part in its view, or null for a view with none here (the
 *  pin's label, the card). */
export function shortTextWorld(
  block: TourBlockOfKind["shortText"],
  env: WorldEnv,
): WorldPart | null {
  switch (block.view) {
    case "sign":
      return signPart(block, env);
    case "edgeHint":
      return edgeHintPart(block, env);
    default:
      return null;
  }
}
