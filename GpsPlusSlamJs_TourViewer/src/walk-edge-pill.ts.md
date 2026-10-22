# walk-edge-pill.ts

## Purpose

The focus's edge pill (the radar-and-list prototype's "on the way" and
"behind you" states): while the station the walk is about lies off screen, a small
pill at the screen's edge on its side names it and its distance - "The
well - 34 m", plus ", behind you" once it is behind the visitor. Only the
focus gets one; the HUD's edge arrows still mark the nearest stations.

A pure model (`walkEdgePill`) and a thin writer (`wireWalkEdgePill`).

## Public API

- `WALK_EDGE_PILL_SHARE = 0.92` - the pill shows once the focus lies past
  this share of half the camera's horizontal field of view (the
  prototype's value; 0.85-1.0 is the phone's to judge).
- `WALK_EDGE_PILL_BAND_DEG` - the band against flicker, the direction
  words' (`walk-direction.ts` `WALK_DIRECTION_HYSTERESIS_DEG`).
- `walkEdgePill(input, previous = null, options = {}) => WalkEdgePill | null`
  - `input`: `title` (null: no focus), `distanceM` (null: the guide shows
    no distance), `angleDeg` (the focus's bearing relative to the
    camera's, positive to the right; null: no heading), `word` (the
    direction word; "behind" adds ", behind you"), `fovDeg`, `listOpen`,
    `storyPlaying`;
  - `previous`: the pill shown last (the band's memory);
  - `options`: `share`, `bandDeg` (for the tests' sweeps);
  - returns `{ side: "left" | "right", text }`, or null when it does not
    show.
- `wireWalkEdgePill(dom) => { render(input | null) }` - writes
  `dom.root.hidden`, `dom.root.dataset.side`, the chevron's `d` and the
  text, each only when it changed; keeps the pill shown last.
- `WalkEdgePillDom`: `root`, `text`, `arrow` (the chevron's path).

## Invariants & assumptions

- Shows only with a focus, a finite distance and angle, a positive finite
  field of view, the list closed and no story playing (the visibility
  rule; anything else is null, also input that is no number).
- Hysteresis at both edges of the rule: once shown it stays until the
  angle comes back inside the edge by the band, and on its side across
  straight behind until it is past by the band - a phone held still
  jitters by a degree or two.
- The distance is written by the framework's `formatDistance` (whole
  metres), as the peek writes it.
- The DOM is `aria-hidden` (`index.html`): the peek's line says the same,
  and a pill coming and going with every turn would be read out each
  time. It is never a tap target (`pointer-events: none`).
- Placement (CSS in `index.html`): top at 42 % of the height, 8 px from
  the edge on its side, at most 44 % of the width; a phone held sideways
  puts the left pill at 50 % + 10 px, right of the sheet's card.
- Wired in `visitor-stations.ts` `renderPill`: the title by
  `stationTitle`, the distance only while the guide's `position` is
  `distance`, the angle and word from `walkDirectionsOf` (the sheet's
  memory), the field of view from `walkRadarFovDeg`.

## Examples

```ts
const pill = wireWalkEdgePill({ root, text, arrow });
pill.render({
  title: "The gate",
  distanceM: 28,
  angleDeg: -90,
  word: "left",
  fovDeg: 60,
  listOpen: false,
  storyPlaying: false,
}); // { side: "left", text: "The gate - 28 m" }
```

## Tests

- `walk-edge-pill.test.ts` - the visibility rule (each condition), the
  side, ", behind you", whole metres, input that is no number; the band
  at the edge and straight behind; the property that a heading jittering
  by less than the band never toggles the pill nor flips its side; the
  writer writing only what changed.
- `playwright-tests/visitor-walk-radar.spec.js` - the pill's text and
  side for a focus to the left, to the right and behind, hidden in view
  and with the list open.
- `playwright-tests/visitor-walk-layout.spec.js` - its place at each
  viewport (42 %, 8 px, the sideways offset, the chevron's gap).
