/**
 * WHY THESE TESTS MATTER. The budget's whole job is to fail a gate, so the two
 * ways it can be wrong are both expensive: a false positive turns a busy laptop
 * into a red commit gate on a suite already known to be contention-bound, and a
 * false negative is the silence that let `test:osm-demo` grow from ~200 s to
 * ~547 s unnoticed over five days.
 *
 * The unguarded cases matter as much as the guarded one — every other stage in
 * every other project has no `budgetSeconds`, so "absent means never fires" is
 * the behaviour almost all callers rely on.
 *
 * The CI cases are the third way it can be wrong, and the one that actually
 * bit: the ceiling is derived from a LOCAL median, and `decideRecording`
 * refuses to record on CI — so the GitHub runner contributes no data point yet
 * was judged against the developer machine's number. It failed two PRs on runs
 * where all 51 tests passed. See
 * `GpsPlusSlamJs_Docs/docs/2026-08-10-0507-e2e-budget-ci-false-positive-findings.md`.
 */

import { describe, expect, it } from 'vitest';

import { budgetBreach } from './budget.mjs';

describe('budgetBreach', () => {
  const guarded = { name: 'test:e2e', budgetSeconds: 100 };
  /** No CI variable set: the developer machine the ceiling was calibrated on. */
  const local = {};

  it('says nothing for a stage with no budget', () => {
    // The common case by a wide margin: only named stages are guarded.
    expect(budgetBreach({ name: 'lint' }, 9_999_000, local)).toBeNull();
  });

  it('says nothing when the stage is inside its budget', () => {
    expect(budgetBreach(guarded, 99_000, local)).toBeNull();
  });

  it('treats exactly the budget as inside it', () => {
    // A boundary worth pinning rather than discovering: `<=` keeps a stage that
    // lands precisely on the number from flapping red and green.
    expect(budgetBreach(guarded, 100_000, local)).toBeNull();
  });

  it('reports a breach, naming the stage, both numbers and the overshoot', () => {
    const message = budgetBreach(guarded, 130_000, local);
    expect(message).toContain('test:e2e');
    expect(message).toContain('130.0 s');
    expect(message).toContain('100 s budget');
    expect(message).toContain('+30 %');
  });

  it('tells the reader that raising the number is the wrong first move', () => {
    // The failure mode this guard invites is someone bumping the ceiling to get
    // green, which would reproduce exactly the drift it exists to catch. The
    // message has to say so, so the test asserts it does.
    const message = budgetBreach(guarded, 200_000, local) ?? '';
    expect(message).toMatch(/remove work rather than to raise the number/);
    expect(message).toMatch(/deliberate act/);
  });

  it('says nothing on CI, however far over the ceiling the stage ran', () => {
    // THE REGRESSION THIS FILE EXISTS TO PREVENT A SECOND TIME. The ceiling is
    // a local median plus 30 %, and CI never records a median of its own, so
    // enforcing it there measured the runner rather than the suite: the same 51
    // e2e tests took 474 s, 576 s, 642 s and 771 s on four consecutive CI runs
    // while the local recording for the same commit range stayed flat at ~588 s.
    expect(budgetBreach(guarded, 771_000, { CI: 'true' })).toBeNull();
    expect(budgetBreach(guarded, 9_999_000, { CI: '1' })).toBeNull();
  });

  it('treats an empty CI variable as not-CI, matching decideRecording', () => {
    // The two CI checks in this tool must agree on what "on CI" means, or the
    // budget could be skipped exactly where a timing row still gets recorded.
    expect(budgetBreach(guarded, 130_000, { CI: '' })).not.toBeNull();
  });

  it('enforces the budget when no env is supplied at all', () => {
    // Defensive default: a caller that forgets the third argument must get the
    // guard, not silently lose it. Losing a guard quietly is how the drift this
    // whole module exists to catch went unnoticed for five days.
    expect(budgetBreach(guarded, 130_000)).not.toBeNull();
  });

  it('ignores a malformed budget or duration rather than failing a gate', () => {
    // Defensive: a typo in `projects.mjs` must not turn every gate red, and a
    // stage whose duration was never measured (a skipped recording) must not
    // read as infinitely slow.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(
        budgetBreach(
          { name: 's', budgetSeconds: /** @type {never} */ (bad) },
          1e9,
          local
        )
      ).toBeNull();
    }
    expect(budgetBreach(guarded, Number.NaN, local)).toBeNull();
    expect(budgetBreach(guarded, -5, local)).toBeNull();
  });
});
