# `src/main.ts`

## Purpose

App shell — wires `DemoPipeline` to the Leaflet and three.js views.

## Public API

None. Entry point only, loaded by `index.html`.

## Invariants & assumptions

- **Deliberately thin.** Everything that can be wrong in an interesting way is
  in `demo-pipeline.ts` and `heat-colours.ts`, both pure and tested. When the
  demo misbehaves, the question should be answerable without reading this file.
- **The rule-table TIER is displayed.** A demo silently running on the
  checked-in snapshot looks identical to one running on the live sheet, and they
  are different claims about what is being judged.
- **OPFS where available, memory otherwise.** A cached res-7 tile is tens of MB
  and refetching on every reload would abuse donated infrastructure — but the
  demo must still start in a browser without OPFS rather than refusing to.
- **Errors are shown, never swallowed.** A silent failure here looks exactly
  like "there is no data at this location", which is the one message that would
  send someone debugging the wrong layer.
- **Clicking the map moves the user**, which is how a walk is simulated without
  a phone; crossing a res-11 boundary is what exercises the chunk cache.

## Examples

```bash
pnpm run dev   # http://localhost:5186
```

## Tests

None directly — it is DOM wiring, and the repo's precedent (MinimalExample) is
that such a shell is covered by typecheck plus tests of the modules under it.
