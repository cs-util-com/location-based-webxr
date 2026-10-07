# summary-model.ts

## Purpose

What the summary after Finish shows (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§1 item 5, §3.3, milestone M3b): every AR visit's walk, each code with its
position, its facing line, its uncertainty rings and its two verdicts (what
visitors get, what the visits now suggest), and the placed pins and
photos. Pure: it is exactly the data `summary-map-view.ts`
hands to Leaflet and `summary-panel.ts` lists, so it is tested without a
map.

## Public API

- `codeLabel(index, count)` - a code's name in labels: "The code" alone,
  else "Code N" by `creator-codes.ts`'s `numbering`; the panel's refused
  line uses it too (M5b).
- `buildSummaryModel(input: SummaryInput): SummaryModel`
  - `SummaryInput`: `visits` (the visit log), `references` (the codes'
    stored poses, the level in hand first, then the tour's other levels),
    `objects` (the tour's objects as the zip now carries them). The visits'
    estimate combines only the visits from a code's latest move on
    (`codeVisitPoses`, the move boundary of authoring plan §3.6, M5b).
  - `SummaryModel`: `tracks` (per visit: `gps`, `fused`), `codes`
    (`SummaryCode`), `objects` (`SummaryObject`: id, kind, label, lat,
    lng), `fitPoints` (everything drawn, for framing).
  - `SummaryCode`: `levelId`, `label` ("The code", or "Code 1", "Code 2"...),
    `reference` (the stored pose as a `CodeMark` plus `ringM`, its own
    predicted error or null when unknown; null without a stored pose),
    `combined` (the visits' estimate: a `CodeMark` plus `ringM`, `shown`,
    `offsetM`, `offsetDeg`; null when no visit measured it), `verdict`
    (PRIMARY, what visitors get: the stored pose's grade, `unknown` or
    `not-saved` without one), `estimateVerdict` (SECONDARY, what the
    visits now suggest; null when no visit measured it), `details` (the
    numbers behind both, one plain line each).
  - `CodeMark`: `lat`, `lng`, `facingDeg` (null for a code lying nearly
    flat), `facingLine` (from the mark along the facing; null without one).
- `facingBearingDeg(geo)`: the bearing the printed face looks toward.
- Constants: `FACING_LINE_MIN_M` (8), `FACING_LINE_MAX_M` (40),
  `DIFFERS_FLOOR_M` (0.5); module-private `FACING_LINE_SHARE` (0.25),
  `FLAT_CODE_DEG` (15), `DIFFERS_FLOOR_DEG` (2), `SAME_POSE_DEG` (1e-7),
  `SAME_POSE_ALT_M` (0.01).

## Invariants & assumptions

- **The reference rule is not changed (D10b)**: the stored pose is the
  code's position and what visitors get, and the details say "the saved
  position stays". Re-estimating at Finish is an open owner question (M3a
  results, question 3).
- **What visitors get is graded on its own** (M3a/M3b review #2): grading
  only the combined estimate put "Good" next to a stored pose from a poor
  visit. The stored pose is graded by the LATEST visit whose settle saved
  exactly this pose (`savedGeo` in the visit log, matched within
  `SAME_POSE_DEG` / `SAME_POSE_ALT_M`, i.e. the same numbers JSON wrote
  twice), as ONE saved pose (`codeVerdict(..., { averaging: false })`:
  "scan it again" cannot improve a pose visitors keep). No such visit (a
  hosted pose, or one replaced elsewhere): "Not known on this device";
  no stored pose: "No saved position yet". The primary verdict labels the
  map; the details lead with "What visitors get", then "What your visits
  now suggest".
- **Facing convention, checked against the framework**: the printed face's
  normal is the code's local +Z (`qr-gps-vote.ts`: "+z out of the printed
  face"), so the facing is the bearing of `rotation · (0, 0, 1)` in NUE.
  For a wall poster at `headingDeg` that is `headingDeg + 90` (a property
  test over every heading); a heading-only level goes through
  `rotationFromHeading`; the rotation wins when both exist (the format's
  rule). A code within `FLAT_CODE_DEG` of lying flat gets no line: its
  horizontal direction is mostly pose noise.
- Two rings: the stored pose's own predicted error (`reference.ringM`,
  null when unknown) and the estimate's (`combined.ringM`,
  `combineCodeVisits`'s `predictedHorizontalM`); the view decides which
  it draws. A code no visit measured has no estimate and no estimate
  verdict.
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
- **The second mark** (M3a/M3b review #7): the estimate is drawn beside
  the stored pose only when it lies further than ITS OWN predicted
  horizontal error (`max(DIFFERS_FLOOR_M, ringM)`) or turns further than
  its predicted heading error (`max(DIFFERS_FLOOR_DEG,
predictedHeadingDeg)`). The fixed 0.5 m / 2 degrees before fired on GPS
  noise alone: two 4 m visits predict 2.8 m, so a 1.5 m difference says
  nothing about the stored pose.
  - Why 1 x: the prediction is the estimate's own error scale; a smaller
    difference is what two measurements of an unmoved code show anyway.
    The stored pose's error is NOT added, so the test fires more often
    than a test on the difference of two estimates would - it errs toward
    showing the mark.
  - What would reverse it: the heading prediction is conservative (the
    M3a spike measured the real error at 0.1-0.4 of the model at the
    median), so 1 x hides heading differences up to 2-10 x the typical
    real error; if field recordings confirm that, use about 0.5 x for the
    heading. Under correlated biases the horizontal prediction is
    optimistic and more marks show - the safe side.
  - The floors: below 0.5 m the two marks overlap at the framed zoom
    (0.4-1.2 m per pixel); a 2 degree turn moves the end of an 8-40 m
    facing line by 0.3-1.4 m, about a pixel.
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
code drawn once with its line, rings and both verdicts; what visitors get
graded by the visit that saved it, apart from a Good estimate; not known
when no kept visit saved it (or saved another pose); a code no visit
measured; a code only the visits know ("no saved position") and the
numbering; the second mark only past the estimate's predicted error, and
the floor; the visits' estimate combining only the visits from the code's
latest move on (the move boundary, M5b); pin and photo labels; walks
kept apart and unreadable points dropped; framing covering the walk, the
pins, the line and the ring.
