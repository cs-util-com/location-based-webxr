# `rules/ignored-tags.ts`

## Purpose

The "known irrelevant" tag list, ported from
`OsmHeatMapsManager.LogThatTagWasIgnored`.

## Public API

- `IGNORED_TAG_PREFIXES: readonly string[]`
- `isIgnoredTagKey(key): boolean`
- `interestingUnmappedTags(counts): Record<string, number>`

## Invariants & assumptions

- **Purely diagnostic. Nothing here changes a score.** Every tag absent from the
  rule table already contributes the multiplicative identity. What the list buys
  is that `unmappedTagCounts` — the signal used to decide what the rule table
  should learn next — is a short list of real candidates rather than a firehose
  of `addr:housenumber`, `source`, `name` and `wikidata`. That is the difference
  between a diagnostic someone reads and one they switch off.
- **Matched against the KEY, not the `key_value` rule id.** A deliberate
  deviation: the C# list mixes the two levels — bare keys (`maxspeed`), key
  prefixes (`addr:`), and whole rule ids (`lit_yes`, `fee_no`,
  `smoothness_excellent`, `area_yes`). Matching everything as a key prefix is
  simpler and strictly wider, and since the list only ever _silences_ a
  diagnostic, wider costs nothing while narrower costs a noisy log.
- Case-sensitive, matching OSM's lowercase-key convention. A mixed-case key is by
  definition not one of these prefixes and _should_ appear in the diagnostic —
  an unexpected key is what the diagnostic is for.

## Tests

`ignored-tags.test.ts` — prefix matching, the noise keys the reference names, and
that genuinely interesting keys survive the filter.
