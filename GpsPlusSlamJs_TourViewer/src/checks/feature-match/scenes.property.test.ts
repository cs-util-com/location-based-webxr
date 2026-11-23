import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lightCheck } from "./bench-export";
import {
  derivedPairs,
  lightOf,
  nextOpen,
  pairsUsing,
  readyPairs,
  resultKey,
  shotList,
  type ShotPhotos,
} from "./scenes";

const size = fc.record({
  spots: fc.integer({ min: -1, max: 5 }),
  extra: fc.integer({ min: -1, max: 10 }),
});

/** A random subset of a run's shots with photos. */
const run = size.chain(({ spots, extra }) => {
  const ids = shotList(spots, extra).map((s) => s.id);
  return fc
    .record({
      taken: fc.subarray(ids),
      means: fc.array(fc.integer({ min: 0, max: 255 }), {
        minLength: ids.length,
        maxLength: ids.length,
      }),
    })
    .map(({ taken, means }) => {
      const photos: Record<string, { id: string; greyMean: number }> = {};
      taken.forEach((id) => {
        photos[id] = { id: `p-${id}`, greyMean: means[ids.indexOf(id)]! };
      });
      return { spots, extra, photos: photos as ShotPhotos };
    });
});

describe("scenes properties", () => {
  // Why: a pair that names a shot outside the list could never be ready
  // and would leave a hole in the zip.
  it("derives pairs that name shots of the list only", () => {
    fc.assert(
      fc.property(size, ({ spots, extra }) => {
        const ids = new Set(shotList(spots, extra).map((s) => s.id));
        for (const p of derivedPairs(spots, extra)) {
          expect(ids.has(p.a) && ids.has(p.b) && p.a !== p.b).toBe(true);
        }
      }),
    );
  });

  // Why: readiness is the only gate on measuring and zipping a pair.
  it("is ready exactly when both shots have a photo", () => {
    fc.assert(
      fc.property(run, ({ spots, extra, photos }) => {
        const pairs = derivedPairs(spots, extra);
        const ready = new Set(readyPairs(pairs, photos).map((p) => p.id));
        for (const p of pairs) {
          expect(ready.has(p.id)).toBe(!!photos[p.a] && !!photos[p.b]);
        }
      }),
    );
  });

  // Why: a retake must make every result of its pairs stale, and only
  // those: the result key carries both photo ids.
  it("changes the result keys of exactly pairsUsing on a retake", () => {
    fc.assert(
      fc.property(run, fc.nat(), ({ spots, extra, photos }, pick) => {
        const pairs = derivedPairs(spots, extra);
        const ids = Object.keys(photos);
        fc.pre(ids.length > 0);
        const shot = ids[pick % ids.length]!;
        const after: ShotPhotos = {
          ...photos,
          [shot]: { id: "retaken", greyMean: photos[shot]!.greyMean },
        };
        const keys = (ph: ShotPhotos) =>
          new Map(
            readyPairs(pairs, ph).map((p) => [
              p.id,
              resultKey(p, ph[p.a]!.id, ph[p.b]!.id),
            ]),
          );
        const before = keys(photos);
        const now = keys(after);
        const using = new Set(pairsUsing(pairs, shot).map((p) => p.id));
        for (const [id, key] of before) {
          expect(now.get(id) !== key).toBe(using.has(id));
        }
      }),
    );
  });

  // Why: the per-shot light check must be the old pair check on the same
  // means, plus only the new ordering rule for L4.
  it("equals the old light checks on the same means", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (l1, l2, l3, l4) => {
          const ph: ShotPhotos = {
            "light-s2/L1": { id: "1", greyMean: l1 },
            "light-s2/L2": { id: "2", greyMean: l2 },
            "light-s2/L3": { id: "3", greyMean: l3 },
            "light-s2/L4": { id: "4", greyMean: l4 },
          };
          expect(lightOf("light-s2/L2", ph)).toBe(lightCheck("1a", l1, l2));
          expect(lightOf("light-s2/L3", ph)).toBe(lightCheck("1b", l1, l3));
          const old = lightCheck("1c", l1, l4);
          expect(lightOf("light-s2/L4", ph)).toBe(
            old === "ok" && l4 > l3 ? "not-darker-than-dimmed" : old,
          );
        },
      ),
    );
  });

  // Why: the run must never point past its list or at a taken shot.
  it("finds an open shot inside the list, or none when all are taken", () => {
    fc.assert(
      fc.property(run, fc.integer({ min: -2, max: 40 }), (r, from) => {
        const list = shotList(r.spots, r.extra);
        const n = nextOpen(list, r.photos, from);
        if (n === null) {
          expect(
            list.filter((s) => !r.photos[s.id]).length,
          ).toBeLessThanOrEqual(
            from >= 0 && from < list.length && !r.photos[list[from]!.id]
              ? 1
              : 0,
          );
        } else {
          expect(n >= 0 && n < list.length).toBe(true);
          expect(r.photos[list[n]!.id]).toBeUndefined();
        }
      }),
    );
  });
});
