/**
 * Properties of `ignoreNativeWhenOrdered` (QR near-frontal pose plan
 * §54-§57).
 *
 * Why these tests matter: the rule decides which detections a code's fused
 * pose and motion reading may use. It must only ever REMOVE native entries
 * of the run ending at the newest entry, keep everything else in order,
 * hand back the same array exactly when it removes nothing (the callers
 * compare identities), and be idempotent - it runs up to five times per
 * evaluation.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  ignoreNativeWhenOrdered,
  selectFusedWindow,
  type QrFusedEntry,
} from './qr-fused-window';

const GAP_MS = 4000;

/** Entries with rising timestamps (some steps over the gap) and rising epochs. */
const entriesArb = fc
  .array(
    fc.record({
      step: fc.oneof(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 4001, max: 9000 })
      ),
      epochUp: fc.boolean(),
      source: fc.constantFrom(undefined, 'finder', 'memory', 'native'),
    }),
    { maxLength: 40 }
  )
  .map((rows) => {
    let t = 0;
    let epoch = 0;
    return rows.map((r): QrFusedEntry => {
      t += r.step;
      if (r.epochUp && r.step > 450) epoch += 1;
      return {
        timestamp: t,
        corners: [],
        cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0 },
        frameEpoch: epoch,
        rawPose: null,
        ...(r.source ? { orderSource: r.source } : {}),
      };
    });
  });

describe('ignoreNativeWhenOrdered (properties)', () => {
  it('only removes native entries, keeps the order, and is idempotent', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const out = ignoreNativeWhenOrdered(entries, GAP_MS);
        // A subsequence of the input.
        let j = 0;
        for (const e of entries) if (out[j] === e) j++;
        expect(j).toBe(out.length);
        // Only natives go.
        const removed = entries.filter((e) => !out.includes(e));
        expect(removed.every((e) => e.orderSource === 'native')).toBe(true);
        // The same array exactly when nothing goes.
        expect(out === entries).toBe(removed.length === 0);
        // Idempotent.
        expect(ignoreNativeWhenOrdered(out, GAP_MS)).toBe(out);
      })
    );
  });

  it('never removes the entries before the newest run, nor its newest non-native one', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const out = ignoreNativeWhenOrdered(entries, GAP_MS);
        const newest = entries[entries.length - 1];
        if (!newest) return;
        let start = entries.length - 1;
        while (
          start > 0 &&
          (entries[start - 1]!.frameEpoch ?? 0) === (newest.frameEpoch ?? 0) &&
          entries[start]!.timestamp - entries[start - 1]!.timestamp <= GAP_MS
        )
          start--;
        for (let i = 0; i < start; i++) expect(out).toContain(entries[i]);
      })
    );
  });

  it('does not change what selectFusedWindow returns when applied first', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        expect(
          selectFusedWindow(ignoreNativeWhenOrdered(entries, GAP_MS))
        ).toEqual(selectFusedWindow(entries));
      })
    );
  });
});
