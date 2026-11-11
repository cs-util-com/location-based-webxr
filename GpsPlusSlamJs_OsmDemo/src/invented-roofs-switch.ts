/**
 * The "invented roofs" checkbox: switches the roofs the city plans for
 * buildings OpenStreetMap gives no roof shape on or off, shows the switch in
 * progress, and reverts a switch whose build failed.
 *
 * The behaviour (the rebuild, the echo on `TransferableMesh.inventedRoofs`,
 * the revert on `failedBuild.inventedRoofs`) is the shared build-choice
 * switch, described in `build-choice-switch.ts`; this names it and words its
 * status.
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
