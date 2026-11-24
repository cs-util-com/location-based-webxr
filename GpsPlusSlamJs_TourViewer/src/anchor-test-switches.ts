/**
 * The deferred anchors' field-test switches, read from the page address
 * only on a visitor's page (a `?qr=` launch) with `?debug=1`, in every build (the deployed preview
 * included, so the phone test needs no PC):
 * - `devWorldJumpM=<m>` / `devWorldJumpDeg=<deg>`: a synthetic world jump
 *   every 10 s, to watch content hold through it;
 * - `anchors=0`: the deferral off for the session; `anchors=ab`: on and off
 *   in turns of 15 s, so one session measures the frame time both ways.
 *
 * Without `?debug=1` the switches are off whatever the address says, in the
 * development server too: the Tour Viewer passes its own values, so the
 * framework's development-only page readers never apply here. A creator's
 * page never gets them either: the jump is folded into the world group, and
 * a creator's captures read world positions, so pins and code poses would
 * be saved shifted.
 *
 * @see anchor-test-switches.ts.md
 */

import {
  parseAnchorDeferral,
  parseDevWorldJump,
  type AnchorDeferral,
  type DevWorldJump,
} from "gps-plus-slam-app-framework/ar/ar-parent-target";
import { debugUiEnabledFromSearch } from "gps-plus-slam-app-framework/utils/debug-flag";

import { viewerModeFromSearch } from "./mode.js";

/** What `enableArWorldGroupAlignment` takes in place of the page readers. */
export interface AnchorTestSwitches {
  readonly devJump: DevWorldJump | null;
  readonly deferAnchors: AnchorDeferral;
}

/** No jump, the deferral on: a visitor's page. */
export const ANCHOR_SWITCHES_OFF: AnchorTestSwitches = {
  devJump: null,
  deferAnchors: true,
};

/**
 * The switches a page address asks for: the parsed values on a visitor's
 * page with `debug=1` (or `debug=true`), else {@link ANCHOR_SWITCHES_OFF}. A value that is not
 * a string reads as no address.
 */
export function anchorTestSwitchesFromSearch(
  search: unknown,
): AnchorTestSwitches {
  if (
    typeof search !== "string" ||
    viewerModeFromSearch(search) !== "visitor" ||
    !debugUiEnabledFromSearch(search)
  ) {
    return ANCHOR_SWITCHES_OFF;
  }
  return {
    devJump: parseDevWorldJump(search),
    deferAnchors: parseAnchorDeferral(search),
  };
}
