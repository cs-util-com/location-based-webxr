/**
 * The manual vertical offset applied to OSM content in AR (DEC-E1).
 *
 * **What it is for.** The field report is a repeatable ~10 m height offset
 * between the drawn city and the world. Two defects already diagnosed account
 * for it, one of them a library defect where the vertical solve needs a single
 * pair, runs no outlier rejection and weights at `1/accuracy⁵`. Until those are
 * fixed, a manual nudge lets a session be usable.
 *
 * **What it is NOT.** It corrects the symptom, not the altitude estimate, so it
 * diverges from the height the data claims. And it is a **constant cancelling a
 * moving quantity** — `worldBaselineY` is re-solved on every GPS fix with no
 * outlier rejection, so one new fix can move it by metres between two glances.
 * Expect to re-adjust, and read it beside the altitude readout rather than
 * alone; without the raw altitude on screen, drift and a mis-set nudge are
 * indistinguishable.
 *
 * **Since the auto offset landed, the nudge is TRIM on top of it** — the
 * applied value is `composeElevationM(autoM, manualTrimM)` in `ar-mode.ts`,
 * and with auto off/cold the trim behaves exactly as described above. The
 * value this module steps is only ever the manual term.
 *
 * Pure on purpose: the arithmetic is the part worth testing, and it should be
 * testable without a scene, a session or a DOM.
 *
 * @see elevation-nudge.ts.md
 */

/**
 * Metres per press.
 *
 * **1 m, not 0.25 m.** The error this exists to null is the reported ~10 m, and
 * a quarter-metre step is 40 presses each way — a control nobody uses. A finer
 * step would be right for a 1–2 m GPS altitude error, which is not the symptom.
 */
export const NUDGE_STEP_M = 1;

/**
 * How far the nudge may reach, either way.
 *
 * A bound rather than free travel, because the failure mode of a stuck button —
 * or of a user hunting for a city that is missing for some other reason — is
 * pushing the whole scene somewhere it can never be seen again.
 *
 * **100 m since 2026-08-20, was 50 — and the REASONING moved, not just the
 * number.** The old comment justified 50 as "five times the reported symptom",
 * which was the right bound while the nudge's only job was nulling a ~10 m
 * vertical error. Q5's entry fly-down starts the session at the 3D view's camera
 * height and eases toward it, so the user can now legitimately be a long way
 * BELOW the city and want to walk it up by hand if the entry move is
 * interrupted (DEC-Y14 inverted that frame; the limit is symmetric, so the
 * constraint itself is unchanged) — a case the old
 * bound made unreachable.
 *
 * **What still holds, and is why this is not simply raised further:** the
 * failure mode is unchanged, and 100 m is still recoverable at the 1 m step
 * within a few seconds of holding. The descent has its own, tighter cap
 * (`DESCENT_MAX_START_M`) for the same reason — an automatic move needs a
 * stricter bound than a deliberate one.
 */
export const NUDGE_LIMIT_M = 100;

/**
 * One press.
 *
 * @param currentM - the offset now.
 * @param direction - `+1` raises the content, `-1` lowers it.
 *
 * **Integer steps from an integer start stay exact**, so the value cannot drift
 * into `2.9999999996` and render as `3.0` while comparing unequal. That matters
 * because the reset case is asserted against the un-nudged vector exactly.
 */
export function nudged(
  currentM: number,
  direction: 1 | -1,
  stepM: number = NUDGE_STEP_M,
): number {
  const next = currentM + direction * stepM;
  return Math.min(NUDGE_LIMIT_M, Math.max(-NUDGE_LIMIT_M, next));
}

/**
 * The label beside the buttons.
 *
 * **Always signed, and always shown — including at zero.** A non-zero offset
 * that is not visible is indistinguishable from bad data next session, and a
 * zero that is not visible leaves the user unsure the control exists. The
 * explicit `+` on positives is what makes "the city was raised" readable at a
 * glance outdoors.
 */
export function describeNudge(valueM: number): string {
  if (!Number.isFinite(valueM)) return "0 m";
  if (valueM === 0) return "0 m";
  const sign = valueM > 0 ? "+" : "−";
  return `${sign}${Math.abs(valueM).toString()} m`;
}
