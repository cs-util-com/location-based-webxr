/**
 * The "invented roofs" checkbox: switches the roofs the city plans for
 * buildings OpenStreetMap gives no roof shape on or off, shows the switch in
 * progress, and reverts a switch whose build failed.
 *
 * The behaviour (the echo, the revert) is the shared build-choice switch
 * (`build-choice-switch.ts`); this names it and words its status.
 *
 * It follows the colour-scheme dropdown (`colour-scheme-switch.ts`) on
 * purpose, so both header controls behave alike:
 *
 * - "Done" is the ECHO, not the dispatch: the switch is a full rebuild in the
 *   worker, and a pass already in flight with the old choice also ends in a
 *   full mesh, so the in-progress state clears only on a drawn mesh built with
 *   the chosen value (`TransferableMesh.inventedRoofs`, absent meaning on).
 * - Every failure ends the switch; only a failed city build WITH the chosen
 *   value (`failedBuild.inventedRoofs`) reverts it to what is drawn. The error
 *   itself goes to the page's existing error channel.
 *
 * AR draws the same buildings as the map, so unlike the colour schemes the
 * box stays usable in AR.
 *
 * @see invented-roofs-switch.ts.md
 */

import {
  attachBuildChoiceSwitch,
  type BuildChoiceSwitch,
  type BuildChoiceSwitchOptions,
} from "./build-choice-switch.js";

export type InventedRoofsSwitchOptions = Omit<
  BuildChoiceSwitchOptions,
  "name" | "applying"
>;

export type InventedRoofsSwitch = BuildChoiceSwitch;

/** Wires the checkbox; the caller keeps it in the page. */
export function attachInventedRoofsSwitch(
  options: InventedRoofsSwitchOptions,
): InventedRoofsSwitch {
  return attachBuildChoiceSwitch({
    ...options,
    name: "invented roofs",
    applying: (on) => `Applying ${on ? "invented" : "flat"} roofs...`,
  });
}
