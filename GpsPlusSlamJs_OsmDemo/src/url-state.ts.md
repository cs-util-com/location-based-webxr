# `url-state.ts`

**Purpose.** Writes where the user is back into the URL, so a reload returns there, a pasted link says where a finding was made, and Playwright can navigate to the same scene. The read half is `start-position.ts`; this is the write half, added by DEC-R12-5 after the eighth testing session jumped to London, reloaded, and came back to New York.

## Public API

- `placeQuery(search: string, place: PlaceInUrl): string`
  - Pure. Takes the CURRENT query string and returns what it should become — with a leading `?`, or `""` when nothing is left.
  - Writes `?site=<id>` when `place.siteId` is set, `?lat=&lng=` otherwise, and deletes whichever of the two forms it did not write.
  - Every other parameter is carried through untouched.
- `PlaceInUrl` — `{ position: LatLng; siteId?: string | undefined }`. The id is present only when the user chose a NAMED place; a map click or a GPS fix has none.
- `writePlace(url: PlaceUrl, place: PlaceInUrl): void` — writes through `url`, and does nothing when the query is already right.
- `PlaceUrl` — `{ search: string; replace(search: string): void }`. The seam that keeps `window` out of the pure part.
- `browserPlaceUrl(win: PlaceUrlWindow): PlaceUrl` — `PlaceUrl` over `window.location` / `window.history`, using **`replaceState`**.

## Invariants & assumptions

- **Only three keys are owned: `lat`, `lng`, `site`.** Anything else in the query survives every write. A debug flag must live through a walk, and a future parameter must not require an edit here.
- **`replaceState`, never `pushState`.** A walk across the map is dozens of position changes; pushing would fill the back stack so the back button undoes the walk one click at a time instead of leaving the demo. The URL tracks the current view rather than narrating how it was reached.
- **Coordinates are written at five decimals**, matching the `toFixed(5)` in `refresh-cycle.ts`'s status message (~1.1 m). A pasted link and the line on screen therefore name the same point. This is also what makes the no-op guard in `writePlace` effective: GPS jitter below a metre produces an identical string, so the history API is not called at sample rate.
- **The two forms are mutually exclusive in the output.** `parseStartPosition` lets `?lat=&lng=` win over `?site=`, so leaving both would parse correctly — but it would be ambiguous to the human reading the link, who is who this feature is for.
- **Presentation state and the camera pose stay out** (DEC-R12-5). Every new control would otherwise have to decide whether it belongs in a URL; an old link would silently pin choices whose meaning has since moved; and a pose recorded against one scene anchor is meaningless after a re-anchor. Accepted cost: a shared link lands on the right place with the default presentation.
- **Nothing is written at boot.** A bare `/` stays a bare `/` until the user actually moves. The default start is not a place the user chose, and rewriting the landing URL to assert it would be the app putting words in their mouth.
- **`replace("")` spells the empty query as the bare path.** Passing `""` to `replaceState` is a no-op that leaves the old query in place — a trap worth knowing rather than rediscovering.
- **`siteId` is typed `?: string | undefined` deliberately.** The repo runs `exactOptionalPropertyTypes`, and the caller holds a `string | undefined` that is cleared after every move; forcing key omission would push a conditional spread into the one call site that must stay obvious.

## Examples

```ts
import { browserPlaceUrl, writePlace } from "./url-state.js";

const placeUrl = browserPlaceUrl(window);

// A picker choice — a named place.
writePlace(placeUrl, { position: place.position, siteId: place.id });
// → ?site=london-tower-bridge

// A map click or a GPS fix — a position.
writePlace(placeUrl, { position });
// → ?lat=51.50550&lng=-0.07540
```

`main.ts` calls `writePlace` in exactly ONE place — the `view.position` subscriber — because that is where the picker, the map click and the locate button converge. Writing at each call site would be three writers racing to describe one position, and the site jump would be immediately overwritten by the coordinates of the same jump.

## Tests

- `url-state.test.ts` — the two output forms, dropping the stale key of the other form, leaving unrelated parameters alone, the written precision, the no-op guard, and `replaceState` (including the empty-query fallback) against a faked `window`.
- The **round trip through `parseStartPosition`** is asserted both by example (a site id) and as a property over arbitrary coordinates: whatever this writes, the reader must return the same place to within the written precision. The two modules are separate and their formats could drift, so the join is stated rather than trusted.
- `playwright-tests/boot-and-shell.spec.js` — "writes the place into the URL, so a reload comes back to it": the real round trip through an actual browser reload, plus a map click replacing `?site=` with coordinates.

No test data required.
