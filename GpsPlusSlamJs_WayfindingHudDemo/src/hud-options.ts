/**
 * The HUD options both hosts derive from the demo config — ONE derivation.
 *
 * `ar-mode.ts` (live WebXR) and `desktop-sim.ts` (the walk simulator) create
 * the same framework HUD from the same sliders and the same toggle; only the
 * camera, the target source and the tick mode differ. Until 2026-09-04 each
 * carried its own copy of this block, and the accent-token wiring pushed the
 * copies over the duplicate-code gate — the right fix being one function
 * rather than two blocks kept in step by hand.
 */

import type { WayfindingHudOptions } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

import { readCssToken } from "./design-token";
import type { HudDemoConfig } from "./hud-config";
import { ARROW_SPRITE_URL, CIRCLE_SPRITE_URL } from "./indicator-assets";

/** The config-derived subset of {@link WayfindingHudOptions}. */
export type HudLookOptions = Pick<
  WayfindingHudOptions,
  | "distanceMin"
  | "distanceMax"
  | "indicatorScale"
  | "indicatorColor"
  | "arrowSprite"
  | "circleSprite"
>;

/**
 * Deadband, scale, tint and sprites for the current config.
 *
 * - The live design-system accent tints the procedural indicators; when the
 *   vendored sheet is absent the option is OMITTED so the framework default
 *   applies (an empty string would read as black — see design-token.ts.md).
 * - Image toggle: URL-loaded textures are owned (and disposed) by the HUD, so
 *   re-creation on toggle/slider changes leaks nothing.
 */
export function hudLookOptions(config: HudDemoConfig): HudLookOptions {
  const accent = readCssToken("--accent");
  return {
    distanceMin: config.distanceMin,
    distanceMax: config.distanceMax,
    indicatorScale: config.indicatorScale,
    ...(accent === undefined ? {} : { indicatorColor: accent }),
    ...(config.imageIndicators
      ? { arrowSprite: ARROW_SPRITE_URL, circleSprite: CIRCLE_SPRITE_URL }
      : {}),
  };
}
