/**
 * Per-code vote budget — unit tests.
 *
 * Why these tests matter: `onLocked` fires on every successful detection once
 * locked, not once per lock transition, so without this cap one code in view
 * injects a fresh vote batch several times a second for as long as it is
 * looked at. The TourViewer learned that in its M4 review; the RecorderApp
 * wired the same controller with no budget until PR #385. These pin the
 * behaviour both now depend on.
 */

import { describe, expect, it } from 'vitest';
import { createQrVoteBudget, MAX_VOTED_LOCKS_PER_CODE } from './qr-vote-budget';

describe('createQrVoteBudget', () => {
  it('allows exactly the cap, then refuses', () => {
    const budget = createQrVoteBudget();
    for (let i = 0; i < MAX_VOTED_LOCKS_PER_CODE; i += 1) {
      expect(budget.tryConsume('code-a'), `batch ${String(i)}`).toBe(true);
    }
    expect(budget.tryConsume('code-a')).toBe(false);
  });

  it('does not charge for a refused batch', () => {
    // Why: a code at its cap must STAY at its cap rather than counting frames
    // it never voted on — the status line reads this number.
    const budget = createQrVoteBudget(2);
    budget.tryConsume('code-a');
    budget.tryConsume('code-a');
    expect(budget.tryConsume('code-a')).toBe(false);
    expect(budget.tryConsume('code-a')).toBe(false);
    expect(budget.spentFor('code-a')).toBe(2);
  });

  it('budgets each code independently', () => {
    const budget = createQrVoteBudget(1);
    expect(budget.tryConsume('code-a')).toBe(true);
    expect(budget.tryConsume('code-b')).toBe(true);
    expect(budget.tryConsume('code-a')).toBe(false);
  });

  it('reset forgets every code', () => {
    // Why: a store swap restarts the GPS list, so the previous store's spend
    // must not keep a code silent against the new one.
    const budget = createQrVoteBudget(1);
    budget.tryConsume('code-a');
    budget.reset();
    expect(budget.spentFor('code-a')).toBe(0);
    expect(budget.tryConsume('code-a')).toBe(true);
  });
});
