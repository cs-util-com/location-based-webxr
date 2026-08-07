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
 */

import { describe, expect, it } from 'vitest';

import { budgetBreach } from './budget.mjs';

describe('budgetBreach', () => {
  const guarded = { name: 'test:e2e', budgetSeconds: 100 };

  it('says nothing for a stage with no budget', () => {
    // The common case by a wide margin: only named stages are guarded.
    expect(budgetBreach({ name: 'lint' }, 9_999_000)).toBeNull();
  });

  it('says nothing when the stage is inside its budget', () => {
    expect(budgetBreach(guarded, 99_000)).toBeNull();
  });

  it('treats exactly the budget as inside it', () => {
    // A boundary worth pinning rather than discovering: `<=` keeps a stage that
    // lands precisely on the number from flapping red and green.
    expect(budgetBreach(guarded, 100_000)).toBeNull();
  });

  it('reports a breach, naming the stage, both numbers and the overshoot', () => {
    const message = budgetBreach(guarded, 130_000);
    expect(message).toContain('test:e2e');
    expect(message).toContain('130.0 s');
    expect(message).toContain('100 s budget');
    expect(message).toContain('+30 %');
  });

  it('tells the reader that raising the number is the wrong first move', () => {
    // The failure mode this guard invites is someone bumping the ceiling to get
    // green, which would reproduce exactly the drift it exists to catch. The
    // message has to say so, so the test asserts it does.
    const message = budgetBreach(guarded, 200_000) ?? '';
    expect(message).toMatch(/remove work rather than to raise the number/);
    expect(message).toMatch(/deliberate act/);
  });

  it('ignores a malformed budget or duration rather than failing a gate', () => {
    // Defensive: a typo in `projects.mjs` must not turn every gate red, and a
    // stage whose duration was never measured (a skipped recording) must not
    // read as infinitely slow.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(
        budgetBreach({ name: 's', budgetSeconds: /** @type {never} */ (bad) }, 1e9)
      ).toBeNull();
    }
    expect(budgetBreach(guarded, Number.NaN)).toBeNull();
    expect(budgetBreach(guarded, -5)).toBeNull();
  });
});
