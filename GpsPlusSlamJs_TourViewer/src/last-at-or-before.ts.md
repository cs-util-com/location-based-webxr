# last-at-or-before.ts

## Purpose

The one "last element with key <= x" binary search of the read-along: the
voice's segment at a time (`read-along.ts` `segmentAt`), the sentence
holding an offset (`long-text-sentences.ts` `sentenceHolding`) and the
caption word holding an offset (`caption-chunks.ts` `wordHolding`), and
the landing film's part at a time (`landing/film-timeline.ts`
`segmentAt`, which clamps -1 to the first part). Each of those keeps its
own name and its own guard; the search is here once in the package.

## Public API

- `lastAtOrBefore(items, keyOf, x): number` - the index of the last
  element whose `keyOf(item) <= x`, or -1 when there is none (an empty
  list, `x` before the first key, or `x` NaN).

## Invariants & assumptions

- `items` is sorted by `keyOf`, ascending. Ties are allowed; the last of
  equal keys is found. An unsorted list gives some index, never a throw.
- `x` Infinity finds the last element; a caller that wants -1 for a
  non-finite `x` says so itself (`segmentAt` and `sentenceHolding` do;
  `wordHolding` takes any number).
- O(log n), no allocation: asked on every camera frame.

## Examples

```ts
lastAtOrBefore([{ at: 0 }, { at: 5 }, { at: 9 }], (s) => s.at, 7); // 1
lastAtOrBefore([{ at: 3 }], (s) => s.at, 2); // -1
```

## Tests

- `last-at-or-before.property.test.ts`: for any sorted list of keys and
  any value, the index equals a linear scan's (the last key `<= x`, or
  -1), ties and NaN included.
- Through `read-along.test.ts`, `long-text-sentences.test.ts` and
  `caption-chunks.test.ts`, which pin the three wrappers.
