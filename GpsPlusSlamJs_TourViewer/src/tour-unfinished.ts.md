# tour-unfinished.ts

## Purpose

A tour that is not finished yet, as its visitor and its creator meet it.
The printed code may point at the hosted file before the creator's first
Finish, so a visitor can open a zip without `tour.json`, or a tour without
stations. That is the normal order of making a tour, not an error: the
visitor reads "This tour is not finished yet." (with whom to ask, when the
tour names a contact), and the creator is told, beside the visitor link,
what a visitor of the hosted file reads now. Pure.

## Public API

- `NOT_FINISHED` - `"This tour is not finished yet."`, the sentence on the
  visitor's start page (`visitor-start.ts`) and on the AR status line.
- `tourUnfinished(manifest: TourManifest | null): boolean` - true for no
  `tour.json` (`null`) and for a tour without stations. A tour with a
  station is finished, whatever the station holds.
- `notFinishedSentence(contact: string | undefined): string` - the AR
  status line's sentence (`tour-flow.ts` with `?debug=1`,
  `visitor-status.ts` otherwise): `NOT_FINISHED`, followed by "Questions
  about this tour? Contact its maker: <label>" when the contact is one a
  visitor may follow (`tour-contact.ts` `contactLink`; the same words as
  the start page's `#error-contact`).
- `unfinishedNote(fileManifest: TourManifest | null): string | null` -
  the creator's note under the visitor link (`#visitor-link-note`,
  `main.ts`): what a visitor of the hosted file reads now and what
  finishes the tour; null for a finished tour.

## Invariants & assumptions

- One rule for every place that asks: the start page, the AR status line,
  the scan card (never shown for an unfinished tour, `scan-gate.ts`) and
  the creator's note all go through `tourUnfinished`.
- A visitor's tour is judged by the file's own manifest once it settled
  (`ar-entry.ts`, `main.ts`); a `tour.json` that cannot be read is an
  error the page shows, not an unfinished tour. A creator's tour is the
  one being made, so the AR line never says it to a creator.
- A contact a visitor may not follow (a script, an unknown scheme) is not
  named.

## Examples

```ts
tourUnfinished(null); // true: a zip without tour.json
tourUnfinished(manifest); // false once it has a station
notFinishedSentence("mailto:guide@example.org");
// "This tour is not finished yet. Questions about this tour? Contact its maker: guide@example.org"
```

## Tests

- `tour-unfinished.test.ts` - the rule, the sentence with and without a
  followable contact, the creator's note.
- `visitor-start.test.ts`, `visitor-status.test.ts`, `tour-flow.test.ts`,
  `scan-gate.test.ts` - each place that says it.
- `playwright-tests/visitor-start.spec.js` - the start page of a tour
  without stations (with its contact) and of a zip without `tour.json`;
  `playwright-tests/ar-mode.spec.js` - the AR status line of both, the
  scan card never shown, and the creator's note beside the visitor link.
