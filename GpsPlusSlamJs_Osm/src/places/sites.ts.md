# `sites.ts` — the corpus of test/demo places

## Purpose

One table of the eight places the OSM demo is tested at and can be navigated to,
shared by the offline fixture suite and the demo's location picker so the two
cannot drift apart.

## Public API

- `CorpusTrait` — closed union of the eight kinds of awkwardness a site is chosen
  for: `landmark-parts`, `relief`, `messy-tagging`, `coastline`,
  `dense-highrise`, `non-european-tagging`, `bridge-structure`, `gated-perimeter`.
- `CorpusSite` — `{ id, name, position, trait, reason, captureRes }`.
  - `id` is filename- and URL-safe (`/^[a-z0-9-]+$/`) because it becomes
    `src/testdata/sites/<id>.json` and is a URL-parameter candidate.
  - `captureRes` is the H3 resolution of that site's captured extract, and it is
    **per site** rather than global — see the invariant below.
- `CORPUS_SITES: readonly CorpusSite[]` — the eight, in no significant order.
  Sylt sits on the promenade rather than on the open beach: centred on the sand
  the extract contained one coastline way and no buildings, which is a coastline
  but not a testable one.
- `siteById(id): CorpusSite | undefined` — `undefined` for an unknown id, never
  a throw, because the id may arrive from a URL and "unknown" means "use the
  default position".

## Invariants & assumptions

- **Exactly eight sites, each with a distinct `trait`.** They are a spread, not
  a sample; two sites sharing a trait would leave one kind of awkwardness
  untested while the table still looked complete. Asserted in `sites.test.ts` —
  both the count and the exact trait list, so growing the table is a decision
  rather than an edit.
- **The two Londons were added by DEC-R12-9, and the reason is worth keeping.**
  The eighth testing session was run at London, which the demo's picker offered
  and the corpus did not cover — so every number measured for that session's
  barrier findings came from six other places. The notes did not say WHICH
  London, and the two picker entries are different shapes, so both were captured
  rather than one guessed. That forced two new traits, since reusing
  `messy-tagging` is impossible under the uniqueness rule above:
  - `bridge-structure` (Tower Bridge) — a way CARRIED BY masonry: 55 road-versus-
    building crossings in plan, 38 of them tagged `bridge`, `tunnel` or `layer`.
    The hazard DEC-R12-1 refuses to cut gaps on.
  - `gated-perimeter` (Westminster) — a landmark enclosed by mapped barriers
    carrying gates: 73 solid barriers with 13 gate/entrance nodes sitting exactly
    on them, the most of any site after Cologne. The case DEC-R12-1 does cut on.
- **`cologne-cathedral` must stay.** It is the only site that can reproduce the
  open R3-1/R4-7 finding; removing it silently makes that finding
  irreproducible. Asserted by name.
- **`captureRes` is per site, and every site is currently res 9 (~348 m).** It
  started as "res 10 like the existing four fixtures, res 9 for the cathedral
  because its 144 x 86 m footprint does not fit a ~114 m cell" — and the first
  capture showed res 10 is too small for the corpus's _purpose_: Berlin came back
  with 5 buildings, Manhattan with 10, and Sylt with a single coastline way and
  nothing else. A geometry corpus needs enough geometry to assert over.
  - The field stays per-site rather than becoming a constant, because the reason
    it varies is a property of the PLACE and the next awkward site may need
    res 8.
  - The bytes are affordable only because of the non-areal relation filter (see
    `scripts/capture-fixtures.mjs`): the unfiltered res-9 cathedral capture is
    ~35 MB, of which 97 % is international train-route relations the package
    turns into no geometry at all. Filtered, the whole six-site corpus is 4.5 MB.
- **Coordinates are the plan's call, traits are the owner's.** DEC-R4-2 fixed
  _what kinds of place_; which coastline and which high-rise city is taste and
  may be changed without reopening the decision.
- **No validation at load.** The table is a literal in this file, so a bad entry
  is a compile-time or test-time failure, not a runtime one. Nothing here parses
  untrusted input; `siteById` is the only lookup and it is total.

## Examples

```ts
import { CORPUS_SITES, siteById } from "gps-plus-slam-osm";

// Populate a picker.
for (const site of CORPUS_SITES) {
  addOption(site.id, site.name);
}

// Resolve a stored choice, falling back rather than throwing.
const start = siteById(saved)?.position ?? DEFAULT_START;
```

## Tests

- `sites.test.ts` — count, id uniqueness, id character class, coordinate
  validity (including the `0,0` "unset pair" case), non-empty name and reason,
  one site per trait, `siteById` hit and miss, and the cathedral's presence.
- `src/testdata/sites/site-extracts.test.ts` — asserts every entry here has a
  captured extract, that it parses, and that it is non-trivial. That test is the
  reason a site added here without an extract fails loudly rather than silently
  reducing coverage.
