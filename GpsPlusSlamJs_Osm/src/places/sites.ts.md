# `sites.ts` — the corpus of test/demo places

## Purpose

One table of the six places the OSM demo is tested at and can be navigated to,
shared by the offline fixture suite and the demo's location picker so the two
cannot drift apart.

## Public API

- `CorpusTrait` — closed union of the six kinds of awkwardness a site is chosen
  for: `landmark-parts`, `relief`, `messy-tagging`, `coastline`,
  `dense-highrise`, `non-european-tagging`.
- `CorpusSite` — `{ id, name, position, trait, reason, captureRes }`.
  - `id` is filename- and URL-safe (`/^[a-z0-9-]+$/`) because it becomes
    `src/testdata/sites/<id>.json` and is a URL-parameter candidate.
  - `captureRes` is the H3 resolution of that site's captured extract, and it is
    **per site** rather than global — see the invariant below.
- `CORPUS_SITES: readonly CorpusSite[]` — the six, in no significant order.
- `siteById(id): CorpusSite | undefined` — `undefined` for an unknown id, never
  a throw, because the id may arrive from a URL and "unknown" means "use the
  default position".

## Invariants & assumptions

- **Exactly six sites, each with a distinct `trait`.** The six are a spread, not
  a sample; two sites sharing a trait would leave one kind of awkwardness
  untested while the table still looked complete. Asserted in `sites.test.ts`.
- **`cologne-cathedral` must stay.** It is the only site that can reproduce the
  open R3-1/R4-7 finding; removing it silently makes that finding
  irreproducible. Asserted by name.
- **`captureRes` is per site because one site does not fit the default.** A
  res-10 cell is ~114 m across the flats; Cologne Cathedral's footprint is
  144 x 86 m. Capturing it at res 10 would clip the very building whose clipping
  is under investigation, so it is captured at res 9 (~348 m across). Everything
  else stays at res 10, matching the existing four fixtures, because a res-9
  extract in a dense centre is roughly 7x the bytes.
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
