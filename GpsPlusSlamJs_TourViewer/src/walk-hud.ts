/**
 * The walk's HUD markers, split in two (the radar-and-list prototype's
 * "the station to find next in orange, larger; the others white"): the
 * framework's wayfinding HUD colours every marker of one instance alike, so
 * the walk runs two - one for the station the walk is about, one for the
 * other nearest stations - over the guide's one list of targets. No
 * framework change: `indicatorColor` and `indicatorScale` are per HUD.
 *
 * The cost of two instances, measured in `walk-hud.pop.test.ts`: a station
 * that becomes the focus (or stops being it) moves to the other HUD and is
 * placed there as a fresh target - shown in the same frame, never twice
 * and never missing, but its on-screen circle starts without the old one's
 * smoothing and its arrival band starts anew. While the phone turns it
 * jumps by that smoothing lag in the frame it turns orange (35 px at 30
 * degrees a second), so no framework per-target colour was added; the
 * sidecar has the table.
 *
 * @see walk-hud.ts.md
 */

import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { WALK_RADAR_COLOURS } from "./walk-radar.js";

/** Which of the two HUDs: the focus's, or the other stations'. */
export type WalkHudLook = "focus" | "others";

/**
 * Each look's framework HUD options: the focus in the walk's orange at
 * 1.25 times the indicator size (the prototype's focus scale), the others
 * in the walk's white at the HUD's own size (the prototype draws them at
 * 0.85; each still carries its distance label and edge arrow, so they
 * keep their size - the builder's choice, the phone decides).
 */
export const WALK_HUD_LOOKS: Record<
  WalkHudLook,
  { readonly indicatorColor: string; readonly indicatorScale: number }
> = {
  focus: { indicatorColor: WALK_RADAR_COLOURS.accent, indicatorScale: 1.25 },
  others: { indicatorColor: WALK_RADAR_COLOURS.left, indicatorScale: 1 },
};

/** The two lists the HUDs poll: the focus's target alone, and the rest in
 *  their own order. */
export interface WalkHudSplit {
  readonly focus: readonly WayfindingTarget[];
  readonly others: readonly WayfindingTarget[];
}

/**
 * Split the guide's targets by the focus: the target whose id is
 * `focusId` goes to the focus's HUD (at most one: ids are the HUD's keys
 * and are unique), every other one to the others' HUD in its own order.
 * The guide keeps an unfound focus among its targets however far it is
 * (`station-guide.ts` `hudTargets`); a focus not among them (found, or
 * none) marks none.
 */
export function splitWalkHudTargets(
  targets: readonly WayfindingTarget[],
  focusId: string | null,
): WalkHudSplit {
  if (focusId === null) return { focus: [], others: [...targets] };
  const focus: WayfindingTarget[] = [];
  const others: WayfindingTarget[] = [];
  for (const target of targets) {
    if (focus.length === 0 && target.id === focusId) focus.push(target);
    else others.push(target);
  }
  return { focus, others };
}

/** A started HUD: the seam's handle. */
interface Hud {
  dispose(): void;
}

/**
 * Start both HUDs for one AR session over the guide's targets and its
 * focus; null while either cannot start yet (no camera), the other one
 * disposed again so the next try starts both together. Each HUD polls its
 * own half of the guide's targets every frame; the guide's targets are
 * built once for the two reads (a HUD that reads a split it has read
 * already starts the next one), so once a frame.
 */
export function startWalkHuds(deps: {
  readonly create: (options: {
    readonly getTargets: () => WayfindingTarget[];
    readonly look: WalkHudLook;
  }) => Hud | null;
  readonly targets: () => WayfindingTarget[];
  readonly focusId: () => string | null;
}): Hud | null {
  let current: WalkHudSplit | null = null;
  const read = new Set<WalkHudLook>();
  const split = (look: WalkHudLook): WalkHudSplit => {
    if (current === null || read.has(look)) {
      current = splitWalkHudTargets(deps.targets(), deps.focusId());
      read.clear();
    }
    read.add(look);
    return current;
  };
  const focusHud = deps.create({
    getTargets: () => [...split("focus").focus],
    look: "focus",
  });
  if (focusHud === null) return null;
  const othersHud = deps.create({
    getTargets: () => [...split("others").others],
    look: "others",
  });
  if (othersHud === null) {
    focusHud.dispose();
    return null;
  }
  return {
    dispose() {
      focusHud.dispose();
      othersHud.dispose();
    },
  };
}
