# city-look-model.js

## Purpose

The city look lab's pure logic: link parameters, fixed cameras, seeds, stand-in
heat scores. No three.js, no DOM.

## Public API

- `EYE_HEIGHT_M`, `SCENES`, `VIEWS`: the constants; the first of a list is its default.
- `cameraPose(view, street, scene)`: `{ position, target }` as `[x, y, z]` in render axes
  (east, up, minus north). A scene may have its own view (Midtown's landing stands back
  and higher, as the shared one stands next to a tower; Heidelberg's street view stands in
  the Hauptstrasse, as its nearest street faces a wall 4 m away). RangeError for an
  unknown view, or `street` without its pose where the scene has none of its own.
- `streetCamera(features, frame)`: the street view's pose from real roads, on the middle of
  the street segment nearest the centre. `frame` needs `toEnu({lat, lng})`.
- `smoothedFrameMs(current, previous, now)`: the smoothed frame gap from frame timestamps;
  null until a real gap exists, unchanged on a gap that is not positive.
- `clampSplit(x)`: the divider's share, kept in [0.05, 0.95].
- `parseCityLookParams(search, { defaultSplit })`: `{ scene, view, split, heat, roofs, cam }`;
  `roofs` is true only for `roofs=library` (today's side drawn with the library's
  invented roofs), and `cityLookSearch` writes it only when true.
- `parseCameraOverride(raw)`: the link's `cam=ex,ey,ez,tx,ty,tz` (metres, render axes) as
  `{ position, target }`, or null for anything that is not six finite numbers within 5 km,
  or whose eye sits on its target. Never throws.
- `freeOrbitLimits(pose)`: `{ minDistance, maxDistance, maxPolarAngle }` for a linked pose.
  The range always holds the pose itself, so the first OrbitControls update does not move
  the camera. An eye below 10 m may come within 0.1 m and look up (0.62 pi); one above
  stays above the ground (0.49 pi) unless the pose itself looks up.
- `cityLookSearch(state)`: the search string `parseCityLookParams` reads back. A `cam` is
  written rounded to 10 cm with plain commas, so the link stays readable.
- `seededRandom(key)`: stable number in [0, 1). A variant keys it on `featureKey`.
- `standInFraction(cell, { x, y })`: a made-up heat fraction in [0, 1].

## Invariants and assumptions

- Scenes: `lucerne` (Meggen), `heidelberg`, `midtown` (Manhattan), `parkslope` (Brooklyn), `reuss` (Lucerne's old town on the Reuss);
  the fixtures and why each was chosen are in `fixtures/PROVENANCE.md`.
- A mistyped link falls back to the defaults, never to an error page; a bad `cam` is
  dropped and the view's own pose is used.
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

`city-look-model.test.mjs`, which also checks the committed fixtures: the fixed views
clear of tall buildings, and every scene's street view looking down at least 30 m of open
street.
