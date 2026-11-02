# word-diff.ts

## Purpose

Words compared the way a narration is lined up with its text: a word of the text and its key, and a longest common subsequence of two key sequences. The import of a timing file (`timing-import.ts`) and the re-anchoring of a stale track (`re-anchor.ts`) both rest on it.

## Public API

- `wordKey(word)` - the word as compared: NFKD, combining marks and apostrophes taken out, lower case, the sharp s as "ss" ("Café" and "cafe", "don't" and "DON’T", "Straße" and "Strasse" are one word).
- `wordTokens(text, from?, to?)` - the words of a stretch (`wordsOf` of `caption-chunks.ts`, the captions' word: letters and digits with inner apostrophes) as `{ from, to, key }`.
- `matchWords(a, b)` - index pairs `[i, j]` with `a[i] === b[j]`, increasing in both.

## Invariants

- Every pair joins equal keys, and both indices increase along the list.
- The shared start and end are paired first. A gap of up to `TABLE_CELLS` (4 million) cells gets the exact table, so the pairs are a longest common subsequence whenever the table holds the gap.
- A larger gap is cut at the words that occur once in each side (patience matching: the longest increasing run of them), each piece matched again (to a depth of 48); a piece with no such word gets a greedy walk that looks 64 words ahead. Above the table's size the result is therefore not always the longest, and two long texts that differ in a few words are matched in about linear time (6 000 words each: well under 0.5 s).
- Never throws; empty sides give no pairs.

## Examples

```ts
matchWords(["the", "six", "years"], ["the", "seven", "years"]); // [[0, 0], [2, 2]]
wordTokens("Hello, world"); // [{ from: 0, to: 5, key: "hello" }, { from: 7, to: 12, key: "world" }]
```

## Tests

- `word-diff.test.ts` - the keys, the tokens, an edit inside a shared run, an exact LCS against a reference on small inputs (property), equal and increasing pairs on any input (property), and two 6 000-word texts within the time bound.
