import { describe, expect, it } from 'vitest';
import {
  advanceOutOfViewRuns,
  endOutOfViewRun,
  freshOutOfViewRun,
  type OutOfViewRunState,
} from './out-of-view-queue';

type Entry = OutOfViewRunState & { readonly name: string };
const entry = (name: string): Entry => ({ name, ...freshOutOfViewRun() });

/**
 * Drive the bookkeeping like the set does: each pass names the entries out
 * of view and the ones whose run ends after it (committed or back in view).
 * Returns each ended run as `name outFrames/queued`.
 */
function drive(
  all: readonly Entry[],
  passes: ReadonlyArray<{ out: string[]; end: string[] }>
): string[] {
  const byName = new Map(all.map((e) => [e.name, e]));
  const ended: string[] = [];
  passes.forEach(({ out, end }, pass) => {
    advanceOutOfViewRuns(
      pass,
      out.map((n) => byName.get(n)!),
      all
    );
    for (const n of end) {
      const e = byName.get(n)!;
      ended.push(`${n} ${String(e.outFrames)}/${String(e.queued)}`);
      endOutOfViewRun(e);
    }
  });
  return ended;
}

describe('out-of-view queue', () => {
  // Why this test matters: the round robin makes a key wait for the keys
  // out with it AND for each key that went out after it, so keys going out
  // one after another while it waits must grow its queue; a bound of the
  // most keys out at once would call this working schedule FAIL. Same
  // sequence as the set's churn test in `deferred-anchors.test.ts`.
  it('counts each key that went out after it: the churn case stays within its queue', () => {
    const all = ['a', 'b', 'c', 'k'].map(entry);
    const ended = drive(all, [
      { out: ['a', 'k'], end: ['a'] },
      { out: ['b', 'k'], end: ['b'] },
      { out: ['c', 'k'], end: ['c'] },
      { out: ['k'], end: ['k'] },
    ]);
    expect(ended).toEqual(['a 1/2', 'b 1/2', 'c 1/2', 'k 4/4']);
    for (const e of ended) {
      const [frames, queued] = e.split(' ')[1]!.split('/').map(Number);
      expect(frames).toBeLessThanOrEqual(queued!);
    }
  });

  // Why this test matters: counting every ENTRY let a ring of two keys
  // that keep going out and coming back grow a waiting key's queue by one
  // each time, so a key starved for eight passes still read as within its
  // queue (old count 2 + 5 = 7 or more) and the field verdict said PASS.
  // Each key counts once per run, so the starved key is over its queue.
  it('counts a churning key once, so a starved key behind a churning ring is over its queue', () => {
    const all = ['k', 'x', 'y'].map(entry);
    const ended = drive(all, [
      { out: ['k', 'x'], end: ['x'] },
      { out: ['k', 'y'], end: ['y'] },
      { out: ['k', 'x'], end: ['x'] },
      { out: ['k', 'y'], end: ['y'] },
      { out: ['k', 'x'], end: ['x'] },
      { out: ['k', 'y'], end: ['y'] },
      { out: ['k', 'x'], end: ['x'] },
      { out: ['k'], end: ['k'] },
    ]);
    expect(ended.at(-1)).toBe('k 8/3');
    const k = ended.at(-1)!.split(' ')[1]!.split('/').map(Number);
    expect(k[0]).toBeGreaterThan(k[1]!);
  });

  // Why this test matters: a run that ended starts over; a key out in an
  // EARLIER run of the waiting key is new to its next run and counts again.
  it('starts every run over: a key out only in an earlier run counts in the next', () => {
    const all = ['k', 'x'].map(entry);
    const ended = drive(all, [
      { out: ['k', 'x'], end: ['k', 'x'] },
      { out: [], end: [] },
      { out: ['k'], end: [] },
      { out: ['k', 'x'], end: ['x'] },
      { out: ['k'], end: ['k'] },
    ]);
    expect(ended).toEqual(['k 1/2', 'x 1/2', 'x 1/2', 'k 3/2']);
  });
});
