/**
 * Validated export for component 10 (TASK.md §2.3). `selectExportedTour` +
 * `validateTour` in one step, so a draft can never export something the
 * schema itself would reject — reuses component 3's load-time gate rather
 * than re-implementing its invariants.
 *
 * @see plans/2026-08-07-authoring-plan.md
 */

import {
  selectExportedTour,
  type AuthoringStateShape,
} from "../../../store/selectors.js";
import { validateTour } from "../../../store/validate-tour.js";
import type { Tour } from "../../../store/types.js";

export function buildValidatedExport(state: AuthoringStateShape): Tour {
  return validateTour(selectExportedTour(state));
}
