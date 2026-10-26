# tour-arbitraries.ts

**Purpose:** test-only fast-check generators of tour content, shared by
the framework's and the Tour Viewer's property tests, so every property
about blocks, stories and caps runs against the same deliberately hostile
picture of the format. Built and shipped under `./test-utils/*` for that
reason; no production module imports it.

## Public API

- `TOUR_ARBITRARY_ASSETS` - the assets every generated block and manifest
  names: two images (`gate`, `knight`, with sizes), an audio (`voice`), a
  model (`arch`), a video (`clip`).
- `tourTextArbitrary(rule, { over? })` - a text for a `TourTextRule`:
  counting exactly 1 to `rule.max` in the rule's own unit (biased to 1,
  the cap and one under it), or with `over: true` one to three over it.
  Code point texts mix letters, a precomposed letter, a lone combining
  mark, surrogate pairs, CJK, whitespace runs (tab, newline, no-break and
  ideographic spaces, CRLF) and outside padding; UTF-16 texts never start
  with whitespace and count spaces as written.
- `tourIdArbitrary` - ids from a small pool that collides with asset ids
  and with step ids, short random ids, and ids at the 64-character limit.
- `tourLocalPoseArbitrary` - a local pose with a yaw-only unit quaternion
  (exact through JSON and the reader's renormalisation; never `-0`).
- `TOUR_FREE_VIEWS` - the world views a free block of each kind may take.
- `tourBlockArbitrary(id, 'free' | 'story', kinds?)` - a valid version 4
  block record: a free one in a world view, a story one in any view of its
  kind.
- `tourStationContentArbitrary({ maxBlocks?, maxExtraSteps? })` - a valid
  `{ blocks, steps }` record: free and story blocks, one `show` per story
  block, choices (options jumping to a step or continuing) and quizzes of
  every answer type, in a shuffled order.
- `tourManifestV3Arbitrary` - a valid version 3 `tour.json` record of one
  to four stations with steps of every kind and items of every kind, order
  `fixed` or `any`. Item ids are prefixed by their station, so they never
  meet an asset id (version 3 shares one namespace for both).

## Invariants & assumptions

- Every record is plain JSON (no `undefined` values, no `-0`), so a
  reader's output can be compared with `toEqual` to the record itself.
- Every generated text satisfies its rule as `checkTourBlockText` counts
  it; every `over` text does not.
- `fast-check` is a dev dependency and is NOT bundled into the built file
  (`neverBundle` in `config/tsdown.config.ts`): a consumer resolves its
  own, so one `fc.Arbitrary` class is in play.

## Examples

```ts
import fc from 'fast-check';
import { tourStationContentArbitrary } from 'gps-plus-slam-app-framework/test-utils/tour-arbitraries';

fc.assert(
  fc.property(tourStationContentArbitrary({ maxBlocks: 4 }), (record) => {
    expect(parse(record)).toEqual(record);
  })
);
```

## Tests

- `tour-arbitraries.test.ts` - counts as claimed for every rule, the
  boundaries reached, `over` texts over and failing, the hostile spellings
  actually produced, surrogate pairs counted twice in UTF-16, ids at 64
  characters and colliding with asset ids, version 3 manifests accepted by
  the reader with steps of every kind.
- `tour-arbitraries.bundle.test.ts` - builds this entry with the package's
  own build settings and asserts it imports `fast-check` by name and
  carries none of its code.
- `../ar/tour-story.property.test.ts` - reads every generated station
  content, which is the check that the generators stay inside the format.
