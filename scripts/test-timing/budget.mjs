/**
 * Wall-clock ceilings for stages that have regrown before.
 *
 * WHY THIS EXISTS. `test:osm-demo` went from ~200 s to ~547 s serial in five
 * days, and nobody noticed until someone went looking: PR #244 fused 66 e2e
 * tests down to 45 to buy that time back, and rounds 7-10 then added a feature
 * test with its own app boot each, spending it again. The fusion was a one-time
 * act with nothing structural preserving it — **the boot budget had no owner.**
 *
 * By the time it was measured, every lever for clawing it back was gone: the
 * shared-page conversion returned ~42 s on the one file whose tests barely
 * mutate state, and the other three measured or screened out under the bar
 * (`2026-08-07-simplify-loop-findings.md`, Areas 3-5b). So prevention is the
 * only thing left, and a budget is prevention.
 *
 * WHY A CEILING RATHER THAN A DELTA. The timing tool already flags a stage that
 * is slower than its own median, and that flag is exactly what five days of
 * +10 % steps walks straight past — each run looks normal against the one
 * before it. A fixed ceiling is the only shape that notices a slow accumulation.
 *
 * HOW TO SET ONE, because a bad threshold is worse than none:
 *
 * - Derive it from the stage's recorded **median**, never from a single run.
 *   `docs/test-timings.md` carries the history.
 * - Leave it LOOSE — roughly +30 %. This suite is contention-bound and its own
 *   config records a 21x inflation of identical work under load, so a tight
 *   ceiling becomes one more load-dependent failure in a suite whose flakiness
 *   is already the problem it is meant to protect.
 * - It is a REGROWTH alarm, not a performance target. It should fire when the
 *   suite has grown a limb, not when the laptop is busy.
 */

/**
 * The ceiling breach for a finished stage, or `null` when it is within budget.
 *
 * Pure and total: an absent or non-finite budget means "not guarded", which is
 * every stage except the ones named in `projects.mjs`.
 *
 * @param {{name: string, budgetSeconds?: number}} stage
 * @param {number} durationMs
 * @returns {string | null}
 */
export function budgetBreach(stage, durationMs) {
  const budget = stage.budgetSeconds;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
    return null;
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;

  const seconds = durationMs / 1000;
  if (seconds <= budget) return null;

  const over = Math.round(((seconds - budget) / budget) * 100);
  return (
    `stage "${stage.name}" took ${seconds.toFixed(1)} s against a ${budget} s budget (+${over} %).\n` +
    'This is a REGROWTH alarm, not a performance target: the ceiling is set ~30 % above the\n' +
    'recorded median precisely so that load does not trip it. If the suite has genuinely grown,\n' +
    'the fix is to remove work rather than to raise the number — see\n' +
    'GpsPlusSlamJs_Docs/docs/2026-08-07-simplify-loop-findings.md for which levers are already spent.\n' +
    'Raising it is a deliberate act and belongs in its own commit, with the new median quoted.'
  );
}
