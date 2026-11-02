# re-anchor.ts

## Purpose

A stale read-along track lined up again with its edited text, by the segments' own words (`segments[].text`, which an import writes). Every segment whose words are still in the text keeps its times and moves to where its words stand now; a word edited a little keeps its voice when it stays alike enough to the word the voice says. The text is never changed.

## Public API

- `reAnchorSegments(timing, text, options?)` - pure, never throws: `{ segments, kept, adjusted, changed, lost, anchors? }` for a track against the edited text's `P`.
  - Words are matched exactly first (`matchWords` of `word-diff.ts`); between two exact matches, words with `wordSimilarity >= minSimilarity` are paired too (a longest increasing run of alike pairs, for gaps up to 40 000 word pairs).
  - A segment keeps its times when at least `minShare` of its words found a place; it then spans from the first of them to the last, with `text` from the new `P`. Otherwise it is `lost` (`{ startMs, endMs, text }`), as is a segment without `text`.
  - `kept` counts segments whose words all matched exactly at the same text; `adjusted` the others that stayed, listed in `changed` (`ChangedVoice`: the new place and the words the voice says, `was`), which the editor's notice names ("you changed X to Y").
  - A marked track's anchors move with the first old word at or after them, or go.
- `lineUpAgain(timing, body, lang?, options?)` - `reAnchorSegments` against `P` of `body`, plus the new track named by `textHashOf(P)` (null when no segment is left), `unvoiced` sentences and the sentence count.
- `wordSimilarity(a, b)` - 1 less the optimal-string-alignment distance (a swap of two neighbouring letters is one slip) over the longer key's length; a key with a figure in it is alike only to itself ("1890" and "1891" are two years).
- `REANCHOR_MIN_SIMILARITY` (0.8), `ReAnchorOptions`, `ReAnchored`, `LinedUpAgain`; the segment share (0.5) and the `LostVoice` / `ChangedVoice` shapes are module-private.

## Invariants

- An edit inside one word changes one key, and the shared start and end of the two word lists are paired first, so every other segment is kept exactly, shifted by the edit's length change. The property test holds this for word and sentence tracks.
- Output segments are ordered by `startMs`, have `from < to` and `text === P.slice(from, to)`, so the result re-anchors again after the next edit.

## The threshold (swept)

`re-anchor.test.ts` "the threshold over real edits" lines a word track of one sentence up again after each of 18 typo fixes or spelling variants and 18 replaced words, for thresholds 0.30 to 0.95 in steps of 0.05, and records `[typos that keep their voice, replacements that wrongly keep it]`:

- 0.30-0.50: 18 typos, 9-10 replacements.
- 0.55-0.65: 17 typos, 7-8 replacements.
- 0.70-0.75: 15 typos, 4 replacements ("tall"/"wall", "lake"/"late", "main"/"rain", "bride").
- 0.80: 14 typos, 1 replacement ("bridge"/"bride"). Chosen.
- 0.85: 9 typos, 0 replacements; 0.90: 3; 0.95: none.

No value separates the two sets: a short word's typo ("teh", "adn", "si") is as far from its fix as a replaced short word is from its replacement. A word that loses its voice costs only that word's highlight (its neighbours keep theirs), and a sentence track keeps a sentence with one word edited at any share up to 7/8, so the threshold matters for word tracks only.

The same sweep over 18 German typo fixes and spelling variants (umlauts and the sharp s written out or not, compounds, short words; word keys fold "ü" to "u" but keep "ß") and 18 German replacements (one sentence, "Wir standen an der ... nahe dem Tor."):

- 0.30-0.50: 18 typos, 10-14 replacements.
- 0.55-0.65: 16-17 typos, 8-10 replacements.
- 0.70-0.75: 12-14 typos, 7-8 replacements.
- 0.80: 12 typos, 2 replacements.
- 0.85: 9 typos, 1 replacement; 0.90: 6, 0; 0.95: none.

Weighing a wrongly lit word at w missed typo fixes (cost = typos lost + w x replacements relit), 0.80 is the cheapest value for w from 1 to 3 on the German pairs, the English pairs and both together. A lower value (0.50) wins only when a wrong highlight counts for half a missed one or less; 0.85-0.90 win only from w = 5 (German alone: 0.90; both: 0.85). 0.80 stays, and the weight is the owner's question if either end is wanted.

## Tests

- `re-anchor.test.ts` - similarity, an unchanged text, an inserted sentence, a typo fixed and a word replaced, a sentence kept and one rewritten, a segment without words, the one-word-edit property for both kinds of track, the threshold sweep (English and German pairs), the segment share over its range, and `lineUpAgain`'s track accepted by the visitor's reader.
