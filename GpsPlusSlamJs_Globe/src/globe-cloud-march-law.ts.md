# globe-cloud-march-law.ts

Purpose: the near clouds' laws, pure: the march's settings at a quality, a tier's distance scale, the cloud target's size and the share a frame draws, how far the haze lets clouds be seen, the coverage law and the life clock.

## Public API

- `CLOUD_MARCH_LAYER`: the layer's base and top (km). Its top is the deck the editor's interface stays under.
- `CLOUD_COVER_LAW`: map grey to deck level and relief.
- `CLOUD_FAR_MARCH`: how the step grows with distance.
- `CLOUD_LIFE_PERIOD_S`, `CLOUD_LIFE_SPEED`: one life of a cloud and how much faster than the wind it runs.
- `cloudDistanceKm(altitudeKm)`: the distance to the layer; 0 inside it.
- `cloudMarchAt(q)`, `cloudLawAt(law, km)`, `cloudFilterReference(law)`: the march's limits from a quality; the law interpolated at a distance; the setting the field's filter is fixed at.
- `cloudTargetSize(...)`: the allocation: the largest the tier can ask for, so a frame never reallocates.
- `cloudViewSettings(...)`: one frame's settings from the tier, the distance, the pixel scale and the canvas.
- `cloudHazeReachKm(...)`: where the haze has eaten every cloud, so the march can end.
- `cloudLifeClock(...)`: the life clock from the view's drift time.

## Invariants

- Every limit becomes a uniform: the scale changes per frame without a new shader or target.
- The field's filter follows the law's reference, not the pixels: a step-down costs sharpness, never the clouds' shape.
- The life clock reads the drift clock, so a held time holds the clouds too. It does not read `sceneMs`.

## Example

```ts
const settings = cloudViewSettings(tier, distanceKm, pixelScale, canvas);
```

## Tests

`globe-cloud-march-law.test.ts`, with property tests over distances and tiers.
