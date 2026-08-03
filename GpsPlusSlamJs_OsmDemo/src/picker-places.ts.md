# `picker-places.ts` — the places the dropdown offers

## Purpose

The demo's location list: fourteen famous places chosen to be worth looking at,
plus the coordinate the demo opens on. **Deliberately not the fixture corpus** —
see below.

## Public API

- `PICKER_PLACES: readonly PickerPlace[]` — the list, in dropdown order.
  `PICKER_PLACES[0]` is Manhattan and is also `DEFAULT_START`.
- `placeById(id: string): PickerPlace | undefined` — `undefined` for an unknown
  id, never a throw. The id arrives from `?site=`, and an unrecognised one means
  "fall back to the default", not "the app is broken".
- `PickerPlace` — `{ id, name, position, note }`.

## Invariants & assumptions

- **This list and `CORPUS_SITES` are two different things, on purpose
  (DEC-R6b-1).** A corpus site earns its entry by being **awkward to render** —
  a beach where the ground stops being ground, stacked U-Bahn tagging — and
  several are deliberately unphotogenic. This list answers the opposite
  question: what does a visitor want to click?
- **The anti-drift guarantee is REACHABILITY, not membership.** DEC-R4-11 built
  one shared table because two lists drift and the cost of drift is that the
  places a human can reach stop being the places the suite covers. That property
  is preserved by `?site=<id>` resolving **every** corpus site, whether or not it
  is in this list — asserted in `start-position.test.ts` over all of
  `CORPUS_SITES`. It is deliberately _not_ stated as "the corpus is a subset of
  this list", because the owner was emphatic that Sylt must not be offered, and
  a containment rule over the dropdown would put it straight back.
- **`note` is rendered, not documentation.** `site-picker.ts` sets
  `option.title` from it, so an entry without one is a tooltip-less row beside
  rows that have one. It answers "what will I see here" — a different question
  from a corpus `reason`'s "why is this hard to render" (Q-R6b-1).
- **Manhattan's coordinate diverges from `manhattan-midtown`'s, and must.**
  DEC-R6b-3 wanted the Central Park edge in the opening frame; the corpus
  position is ~2 km south and cannot move without invalidating its captured
  extract. The divergence is pinned by a test so it reads as intended rather
  than as a typo.
- **Cologne and Tokyo borrow their coordinates from the corpus** via
  `fromCorpus`, because for those two the picker and the corpus agree and a
  second copy would be free to drift.
- **No entry carries a fixture** (DEC-R6b-2). This costs nothing at runtime:
  `site-picker.ts` has never loaded a captured extract for any place, so every
  choice is an ordinary cold Overpass fetch cached to OPFS.
- **Ids are unique and `[a-z0-9-]+`,** because they are a URL parameter.

## Examples

```ts
import { PICKER_PLACES, placeById } from "./picker-places.js";

const opening = PICKER_PLACES[0]?.position; // Manhattan, the demo's default
const porto = placeById("porto-ribeira")?.position;
```

## Tests

- `picker-places.test.ts` — Manhattan first and at the park edge; the three
  removed places absent by both coordinate and name; every entry has a note; ids
  unique and URL-safe; the list length stays in the 12–16 band DEC-R6b-4 asked
  for; Cologne and Tokyo still match the corpus.
- `start-position.test.ts` — the reachability guarantee over all of
  `CORPUS_SITES`, and that `DEFAULT_START` equals `PICKER_PLACES[0]`.
- `site-picker.test.ts` — that the DOM is built from this list, tooltips
  included.
