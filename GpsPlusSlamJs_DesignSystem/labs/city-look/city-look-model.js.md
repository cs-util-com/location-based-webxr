# city-look-model.js

## Purpose

The city look lab's pure logic: link parameters, fixed cameras, seeds, stand-in
heat scores. No three.js, no DOM.

## Public API

- `EYE_HEIGHT_M`, `SCENES`, `VIEWS`: the constants; the first of a list is its default.
- `cameraPose(view, street, scene)`: `{ position, target }` as `[x, y, z]` in render axes
  (east, up, minus north). A scene may have its own fixed view (Midtown's landing stands
  back and higher, as the shared one stands next to a tower). RangeError for an unknown
  view, or `street` without its pose.
- `streetCamera(features, frame)`: the street view's pose from real roads, on the middle of
  the street segment nearest the centre. `frame` needs `toEnu({lat, lng})`.
- `smoothedFrameMs(current, previous, now)`: the smoothed frame gap from frame timestamps;
  null until a real gap exists, unchanged on a gap that is not positive.
- `clampSplit(x)`: the divider's share, kept in [0.05, 0.95].
- `parseCityLookParams(search, { defaultSplit })`: `{ scene, view, split, heat }`.
- `cityLookSearch(state)`: the search string `parseCityLookParams` reads back.
- `seededRandom(key)`: stable number in [0, 1). A variant keys it on `featureKey`.
- `standInFraction(cell, { x, y })`: a made-up heat fraction in [0, 1].

## Invariants and assumptions

- Scenes: `lucerne` (Meggen), `heidelberg`, `midtown` (Manhattan), `parkslope` (Brooklyn);
  the fixtures and why each was chosen are in `fixtures/PROVENANCE.md`.
- A mistyped link falls back to the defaults, never to an error page.
- Street classes: residential, living street, unclassified, tertiary, pedestrian;
  tunnels and bridges are left out, because the lab's ground is flat.
- The street camera is a road's centre line, so it cannot stand inside a mapped building
  unless the data draws a road through one. It does not know about buildings.

## Example

```js
const { scene, view } = parseCityLookParams(location.search, {
  defaultSplit: 0.5,
});
const pose = cameraPose(view, streetCamera(features, frame));
const lean = seededRandom(featureKey(feature));
```

## Tests

`city-look-model.test.mjs`, which also checks the committed fixtures.
