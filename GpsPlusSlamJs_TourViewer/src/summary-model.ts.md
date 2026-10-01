# summary-model.ts

## Purpose

What the summary after Finish shows (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§1 item 5, §3.3, milestone M3b): every AR visit's walk, each code with its
position, its facing line, its uncertainty ring and its verdict, and the
placed pins and photos. Pure: it is exactly the data `summary-map-view.ts`
hands to Leaflet and `summary-panel.ts` lists, so it is tested without a
map.

## Public API

- `buildSummaryModel(input: SummaryInput): SummaryModel`
  - `SummaryInput`: `visits` (the visit log), `references` (the codes'
    stored poses, the level in hand first, then the tour's other levels),
    `objects` (the tour's objects as the zip now carries them).
  - `SummaryModel`: `tracks` (per visit: `gps`, `fused`), `codes`
    (`SummaryCode`), `objects` (`SummaryObject`: id, kind, label, lat,
    lng), `fitPoints` (everything drawn, for framing).
  - `SummaryCode`: `levelId`, `label` ("The code", or "Code 1", "Code 2"...),
    `reference` (the stored pose as a `CodeMark`, or null), `combined` (the
    visits' estimate: a `CodeMark` plus `ringM`, `shown`, `offsetM`,
    `offsetDeg`; null when no visit measured it), `verdict`
    (`code-verdict.ts`), `details` (the numbers, one plain line each).
  - `CodeMark`: `lat`, `lng`, `facingDeg` (null for a code lying nearly
    flat), `facingLine` (from the mark along the facing; null without one).
- `facingBearingDeg(geo)`: the bearing the printed face looks toward.
- Constants: `FACING_LINE_MIN_M` (8), `FACING_LINE_MAX_M` (40),
  `DIFFERS_M` (0.5); module-private `FACING_LINE_SHARE` (0.25),
  `FLAT_CODE_DEG` (15), `DIFFERS_DEG` (2).

## Invariants & assumptions

- **The reference rule is not changed (D10b)**: the stored pose is the
  code's position and what visitors get. The visits' combined estimate is
  drawn as a second mark only where it differs from it (more than
  `DIFFERS_M` or `DIFFERS_DEG`), and the details say "the saved position
  stays". Re-estimating at Finish is an open owner question (M3a results,
  question 3).
- **Facing convention, checked against the framework**: the printed face's
  normal is the code's local +Z (`qr-gps-vote.ts`: "+z out of the printed
  face"), so the facing is the bearing of `rotation · (0, 0, 1)` in NUE.
  For a wall poster at `headingDeg` that is `headingDeg + 90` (a property
  test over every heading); a heading-only level goes through
  `rotationFromHeading`; the rotation wins when both exist (the format's
  rule). A code within `FLAT_CODE_DEG` of lying flat gets no line: its
  horizontal direction is mostly pose noise.
- The ring is centred on the combined estimate with the predicted
  horizontal error as its radius (`combineCodeVisits`'s
  `predictedHorizontalM`); a code no visit measured has no ring and a
  "scan again" verdict.
- Each visit's walk is its own track, so the map never joins one visit's
  end to the next one's start.
- Unreadable coordinates (non-finite, out of range) are left out of every
  layer and of `fitPoints`, never drawn.
- Codes are listed references first, then any level only the visits know.

## Parameters and what they rest on

- Facing line length `clamp(0.25 x diagonal, 8 m, 40 m)` over what is
  drawn: at the framed zoom the map is about the diagonal wide, so a
  quarter reads at a glance without crossing half the walk; 8 m is about 20
  px at zoom 18 at 47°N; 40 m keeps a long walk from drawing a street-long
  line. A purely visual choice; a fixed-pixel line (a rotated divIcon)
  would be the alternative if zooming in far makes it leave the view.
- `DIFFERS_M` 0.5 / `DIFFERS_DEG` 2: below these the two marks overlap at
  the framed zoom (0.4-1.2 m per pixel), so drawing both would only add
  clutter. Information only - no decision rests on them.
- `FLAT_CODE_DEG` 15: about a quarter of the face normal is horizontal
  there; a wall poster is far from it either way.

## Examples

```ts
const model = buildSummaryModel({
  visits: visitLog.entries(),
  references: [{ levelId, geo: storedGeo(level.json) }],
  objects: manifest.objects,
});
model.codes[0]?.verdict.text; // "Good"
```

## Tests

`summary-model.test.ts`: the facing convention (cases, heading-only, the
rotation winning, a flat code, a property over every heading); one measured
code drawn once with its line, ring and verdict; an estimate drawn beside a
stored pose it disagrees with, as information; a code no visit measured; a
code only the visits know and the numbering; pin and photo labels; walks
kept apart and unreadable points dropped; framing covering the walk, the
pins, the line and the ring.
