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
  words' (`walk-direction.ts` `WALK_DIRECTION_HYSTERESIS_DEG`): the
  side's band across straight behind.
- `walkEdgePillHideBandDeg(fovDeg, bandDeg?) => number` - the band by
  which the angle must come back inside the edge before the pill goes:
  `min(bandDeg, 0.1 * fovDeg / 2)`, so the pill goes once the station is
  a little inside the screen, not a third of the way in (see the sweep
  below).
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
  angle comes back inside the edge by the hide band, and on its side
  across straight behind until it is past by the band - a phone held
  still jitters by a degree or two.
- The hide band scales with the view. A fixed 5 degrees in a portrait
  phone's narrow view (about 32 degrees across) kept the pill until the
  station was a third of the way into the screen. With the fallback
  views (64 degrees vertical in portrait, 44 in landscape), the pill
  shows past and goes inside these angles:
  - 390x844: horizontal view 32.2, shows past 14.8, goes inside 13.2
    (was 9.8 with a fixed 5 degrees);
  - 360x740: 33.8, 15.6, 13.9 (was 10.6);
  - 844x390: 82.3, 37.9, 33.8 (was 32.9);
  - 915x412: 83.8, 38.5, 34.4 (was 33.5);
  - 1440x900: 65.8, 30.2, 27.0 (was 25.2).
    The pill goes at 82 % of half the view in every one; the band is the
    full 5 degrees only from a 100 degree view up. What would reverse it: a
    phone showing the pill flicker at the edge while held still (a tenth
    of half the view is 1.6 degrees in portrait), towards a wider band.
- The distance is written by the framework's `formatDistance` (whole
  metres), as the peek writes it.
- On a portrait phone the pill's 44 vw cap cuts ", behind you" to
  "The well - 40 m, be...", as the prototype's does (compared side by
  side at 390x844); the peek's line says "Behind you." in full.
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
  side, ", behind you", whole metres, input that is no number; the hide
  band at the edge (scaled to the view, a narrow view's pill going soon
  after the station is back) and the band straight behind; the property,
  over views of 20 to 110 degrees, that a heading jittering by less than
  the band never toggles the pill nor flips its side; the
  writer writing only what changed.
- `playwright-tests/visitor-walk-radar.spec.js` - the pill's text and
  side for a focus to the left, to the right and behind, hidden in view
  and with the list open.
- `playwright-tests/visitor-walk-layout.spec.js` - its place at each
  viewport (42 %, 8 px, the sideways offset, the chevron's gap).
