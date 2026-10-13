/**
 * The setup page's stations (polish round M2b, the owner's chosen L5
 * look): the six wizard steps as stations along a tour route on a map.
 * Pure: the open step in, what the station row and the map show out. The
 * wiring (`setup-stage.ts`) draws it; `wizard.ts` stays the one owner of
 * which step is open.
 *
 * @see setup-stations.ts.md
 */

import { WIZARD_STEPS, type WizardStep } from "./wizard.js";

type StationState = "done" | "current" | "todo";

/** How far along the map's route each station sits (0 = the poster at the
 *  start, 1 = the end flag), one per step in `WIZARD_STEPS` order. */
export const STATION_ROUTE_FRACTIONS: readonly number[] = [
  0.085, 0.24, 0.4, 0.565, 0.745, 1,
];

export interface StationView {
  /** 1-based number of the open step. */
  number: number;
  total: number;
  /** One per step, in `WIZARD_STEPS` order. */
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
 * The view for the open step; null (nothing open) reads as the first.
 * No Back on the first step; no Next on the create step, whose action is
 * "Start creating" (verdict P8); no row on the completion step (P11).
 */
export function stationView(open: WizardStep | null): StationView {
  const index = open === null ? 0 : WIZARD_STEPS.indexOf(open);
  const last = WIZARD_STEPS.length - 1;
  const step = WIZARD_STEPS[index] ?? "host";
  const showNav = index !== last;
  return {
    number: index + 1,
    total: WIZARD_STEPS.length,
    states: WIZARD_STEPS.map((_, i) =>
      i < index ? "done" : i === index ? "current" : "todo",
    ),
    routeFraction: STATION_ROUTE_FRACTIONS[index] ?? 0,
    back: showNav && index > 0 ? (WIZARD_STEPS[index - 1] ?? null) : null,
    next:
      showNav && step !== "measure" ? (WIZARD_STEPS[index + 1] ?? null) : null,
    showNav,
  };
}
