# globe-visibility.ts

## Purpose

What the editor on the globe draws, by the two rules the owner decided on
2026-10-28: far away an object hides by its own size on screen, and a
station's pin hides once a neighbouring station crowds it on screen. Hidden
objects cost nothing, so from above the clouds almost nothing is drawn. The
editor's own 3D view keeps its rules (`editor3d-visibility.ts`: the morph
and near-K); these are the globe's, used only behind the link switch
(`../editor/globe-switch.ts`, whose `globeHidePx` and `globeCrowdPx` are the
thresholds).

## Public API

- `GLOBE_VISIBILITY` - the hysteresis bands: `showRatio` 1.5 (a hidden
  object shows again at `hidePx` x 1.5), `uncrowdRatio` 1.25 (a crowded
  pin shows again with its nearest pin `crowdPx` x 1.25 away).
- `screenSizePx({ radiusM, distanceM, fovYDeg, viewportHeightPx })` -> the
  diameter in CSS px a sphere of that radius covers on screen at that
  distance (`r x H / (d x tan(fov / 2))`); Infinity with the camera inside
  the sphere. RangeError for a negative or non-finite radius or distance, a
  field of view outside (0, 180) or a height that is not positive and
  finite.
- `sizeShown(wasShown, sizePx, hidePx, showRatio?)` -> whether the object
  draws this frame. RangeError for a bad threshold (`hidePx` < 0 or not
  finite), ratio (< 1) or size (NaN, negative).
- `crowdedPins(pins, crowdPx, wasHidden, selected?, uncrowdRatio?)` -> the
  ids hidden by crowding. `pins` are `ScreenPin` (`id`, `x`, `y` in CSS
  px). RangeError for a bad `crowdPx` (< 0, not finite) or ratio (< 1).
- Type `ScreenPin`.

## Invariants & assumptions

- **Hysteresis on both rules:** inside the band (`[hidePx, hidePx x
showRatio)` for size, `[crowdPx, crowdPx x uncrowdRatio)` for crowding)
  an object keeps last frame's state, so a camera drifting by a pixel at
  the edge never makes it blink. The caller keeps last frame's state.
- **Crowding counts every pin as a neighbour**, hidden or not, so two
  pins crowding each other both hide (the owner's "almost nothing drawn"
  from far away); the creator navigates there with the left rail.
- **The selected pin never hides by crowding.** Its size rule still
  applies (the caller decides whether the selection is exempt; a flight to
  it brings it into size anyway).
- `crowdPx` 0 turns crowding off. A pin with a coordinate that is not
  finite (behind the camera, the caller's projection) is skipped: it is
  no one's neighbour and not hidden here.
- O(n^2) over the pins on screen: fine for a tour's stations (tens to a
  few hundred). A spatial grid is the change if tours grow to thousands.
- The object's radius is its bounding sphere's; a 1 m sign at 50 degrees
  in an 800 px view is about 2.9 px at 300 m, a 200 m object 3 px at about
  57 km (the owner's examples, in the tests).

## Examples

```ts
const size = screenSizePx({
  radiusM: 0.5,
  distanceM,
  fovYDeg: 50,
  viewportHeightPx,
});
item.visible = sizeShown(item.visible, size, link.hidePx);
const hidden = crowdedPins(
  projectedPins,
  link.crowdPx,
  lastHidden,
  selectedStation,
);
```

## Tests

`globe-visibility.test.ts`: the size formula (the view's height for a
sphere spanning the field of view, linear in radius and inverse in
distance, the owner's two examples, Infinity inside, refusals); the size
rule's threshold and band, swept over 0.5-200 px; crowding: a close pair
both hidden, at exactly the threshold shown, the selection kept, the band,
off at 0, a single pin, a pin off screen, swept over 1-500 px, refusals.
`globe-visibility.property.test.ts`: the size never grows with distance;
any walk inside the band keeps the state; both pins of a pair alike; the
selected pin never hidden and only known ids returned.
