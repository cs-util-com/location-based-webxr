/**
 * The setup page's stations (polish round M2b, the owner's chosen L5
 * look): the steps of the chosen path (`setup-path.ts`) as stations along
 * a tour route on a map, and as the card's checklist. Pure: the path and
 * the open step in, what the checklist and the map show out. The wiring
 * (`setup-stage.ts`) draws it; `wizard.ts` stays the one owner of which
 * step is open.
 *
 * @see setup-stations.ts.md
 */

import type { WizardStep } from "./wizard.js";

type StationState = "done" | "current" | "todo";

/** The map's six station slots along its route (0 = the poster at the
 *  start, 1 = the end flag), from the prototype. A path of n steps takes
 *  the LAST n slots, so every path ends at the flag. */
export const STATION_ROUTE_FRACTIONS: readonly number[] = [
  0.085, 0.24, 0.4, 0.565, 0.745, 1,
];

/** The slot (index into `STATION_ROUTE_FRACTIONS`) of a path's i-th
 *  station. */
export function stationSlot(pathLength: number, i: number): number {
  return Math.max(0, STATION_ROUTE_FRACTIONS.length - pathLength) + i;
}

/** Steps whose own action moves on: "Start creating", and the two that
 *  open a tour from this phone (a Next past them would reach "Create"
 *  with no tour open, where nothing can be placed). */
const NO_NEXT: ReadonlySet<WizardStep> = new Set([
  "measure",
  "file",
  "starter",
]);

export interface StationView {
  /** 1-based number of the open step on the path. */
  number: number;
  total: number;
  /** One per path step, in path order. */
  states: readonly StationState[];
  /** How much of the route the map draws: up to the open station. */
  routeFraction: number;
  /** Where Back leads, or null where none is offered. */
  back: WizardStep | null;
  /** Where Next leads, or null where none is offered. */
  next: WizardStep | null;
  /** Whether the back/next row shows at all. */
  showNav: boolean;
}

/**
 * The view of `path` with `open` the open step; a step off the path, or
 * none, reads as the first. No Back on the first step; no Next where the
 * step's own action moves on (`NO_NEXT`, verdict P8); no row on the
 * completion step (P11).
 */
export function stationView(
  path: readonly WizardStep[],
  open: WizardStep | null,
): StationView {
  const found = open === null ? -1 : path.indexOf(open);
  const index = Math.max(0, found);
  const last = path.length - 1;
  const step = path[index];
  const showNav = index !== last;
  return {
    number: index + 1,
    total: path.length,
    states: path.map((_, i) =>
      i < index ? "done" : i === index ? "current" : "todo",
    ),
    routeFraction:
      STATION_ROUTE_FRACTIONS[stationSlot(path.length, index)] ?? 0,
    back: showNav && index > 0 ? (path[index - 1] ?? null) : null,
    next:
      showNav && step !== undefined && !NO_NEXT.has(step)
        ? (path[index + 1] ?? null)
        : null,
    showNav,
  };
}
