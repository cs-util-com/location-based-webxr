/**
 * Why these tests matter: the import of a timing file and the re-anchoring
 * of a stale track both rest on matching two word sequences. A match that
 * crosses (a later word of one paired with an earlier word of the other)
 * would put the voice's times out of order; a match that misses a long
 * shared run would throw a creator's timing away. The property tests hold
 * the matcher to a longest common subsequence on small inputs (where the
 * exact one is cheap to compute) and to monotone, equal pairs always.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { matchWords, wordKey, wordTokens } from "./word-diff.js";

/** The exact LCS length, for small inputs. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const t = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      t[i]![j] =
        a[i] === b[j]
          ? t[i + 1]![j + 1]! + 1
          : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
    }
  }
  return t[0]![0]!;
}

describe("wordKey", () => {
  it("folds case, accents and apostrophes, so a word matches however it is typed", () => {
    expect(wordKey("Café")).toBe("cafe");
    expect(wordKey("DON’T")).toBe("dont");
    expect(wordKey("don't")).toBe("dont");
    expect(wordKey("Straße")).toBe("straße");
  });
});

describe("wordTokens", () => {
  it("lists the words of a stretch with their offsets and keys", () => {
    expect(wordTokens("Hello, big world!", 0, 17)).toEqual([
      { from: 0, to: 5, key: "hello" },
      { from: 7, to: 10, key: "big" },
      { from: 11, to: 16, key: "world" },
    ]);
  });
});

describe("matchWords", () => {
  it("pairs a shared run around an edit", () => {
    const a = ["the", "old", "bridge", "was", "built", "in", "six", "years"];
    const b = ["the", "old", "bridge", "was", "built", "in", "seven", "years"];
    expect(matchWords(a, b)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [7, 7],
    ]);
  });

  it("is empty for an empty side", () => {
    expect(matchWords([], ["a"])).toEqual([]);
    expect(matchWords(["a"], [])).toEqual([]);
  });

  it("finds a longest common subsequence of inputs the table holds", () => {
    const word = fc.constantFrom("a", "b", "c", "d");
    fc.assert(
      fc.property(
        fc.array(word, { maxLength: 30 }),
        fc.array(word, { maxLength: 30 }),
        (a, b) => {
          const pairs = matchWords(a, b);
          expect(pairs.length).toBe(lcsLength(a, b));
        },
      ),
    );
  });

  it("pairs only equal words, increasing on both sides, for any input", () => {
    const word = fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h");
    fc.assert(
      fc.property(
        fc.array(word, { maxLength: 400 }),
        fc.array(word, { maxLength: 400 }),
        (a, b) => {
          let last: [number, number] = [-1, -1];
          for (const [i, j] of matchWords(a, b)) {
            expect(a[i]).toBe(b[j]);
            expect(i).toBeGreaterThan(last[0]);
            expect(j).toBeGreaterThan(last[1]);
            last = [i, j];
          }
        },
      ),
    );
  });

  it("matches two long texts that differ in a few words without a full table", () => {
    // 6 000 words each: a full table would be 36 million cells.
    const a = Array.from(
      { length: 6000 },
      (_, i) => `w${String(i % 997)}x${String(i)}`,
    );
    const b = [...a];
    b[10] = "changed";
    b[5000] = "other";
    b.splice(3000, 0, "inserted");
    const started = performance.now();
    const pairs = matchWords(a, b);
    expect(pairs.length).toBe(5998);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
