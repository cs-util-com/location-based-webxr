# `map-zoom-to-camera.ts`

## Purpose

Convert a Leaflet zoom level into the 3D camera distance that shows the same
amount of ground (H2 — "the map's +/- should adjust the 3D view's zoom").

## Public API

- `cameraDistanceForZoom(input: ZoomToCameraInput): number` — metres, always
  finite and always inside `[MIN_CAMERA_DISTANCE_M, MAX_CAMERA_DISTANCE_M]`.
- `MIN_CAMERA_DISTANCE_M = 30` / `MAX_CAMERA_DISTANCE_M = 2400`.

`ZoomToCameraInput`: `zoom`, `latDeg`, `paneWidthPx`, `aspect` (width/height),
`vfovDeg` (three.js vertical FOV — the demo's camera is 55°).

## The formula, and the choice inside it

```
metresPerPixel = 156543.03392 · cos(lat) / 2^zoom     (Web Mercator, 256 px tiles)
groundWidthM   = metresPerPixel · paneWidthPx
halfHfov       = atan(aspect · tan(vfov / 2))
distance       = groundWidthM / (2 · tan(halfHfov))
```

**"The two views agree" is a choice, not an identity, and the file says so.**
The 3D camera sits ~29° above horizontal, so its ground footprint is a
**trapezoid** — there is no distance at which a tilted perspective view and a
top-down map show the same area. This matches the frustum width **at the target
plane**, which makes the near edge show slightly less and the far edge slightly
more. That reads as "the same place, tilted", which is what the request asked
for.

## Invariants & assumptions

- **The clamp is required, not defensive.** Leaflet is given no `minZoom` here,
  so the map can reach z10 — about **36 km** of camera distance, far past any
  far plane the dial can produce. Unclamped, the user gets an empty grey screen
  with no error raised anywhere.
- **`MAX` is HALF the far plane the page boots with**, because the camera is
  tilted: at distance `d` the far edge of the view is considerably further than
  `d`, so a limit at the far plane itself would still clip the horizon.
  - **Raised 1200 → 2400 by DEC-K2 (2026-08-22).** This bullet used to read
    "`MAX` is 1200, not 2400" — which argued against the value now shipping.
    The old figure was half of the 1x baseline; the page boots at
    `DEFAULT_RENDER_MULTIPLIER`, drawing to 4800 m, and a map that still pulled
    back only 1200 m would reach a quarter of the drawn distance. The field ask
    that raised the default was specifically about zooming further out.
  - ⚠️ **It tracks the DEFAULT multiplier, not the live one.** Turning the dial
    down to 1x leaves this clamp past that far plane, so a fully zoomed-out map
    can clip. Deliberate: a clamp that moved under the user's hand while they
    drag a different control would be worse, and zooming back in is immediate.
- **`MIN` is 30 m** — below that the 0.5 m near plane and the buildings
  interpenetrate, and a fully-zoomed-in map would put the camera inside a wall.
- **Every non-finite or degenerate input collapses to `MAX`**, never propagates.
  Zoom comes from a third-party library, `paneWidthPx` from layout (a
  `display: none` container reports 0), and `aspect` from a renderer that may
  not have been sized. A `NaN` reaching the camera position produces an
  undefined view **with no error anywhere** — it would look like "the 3D view
  went black", indistinguishable from several other causes.
- Pure: no map, no renderer, no DOM. Same rule as `elevation-nudge.ts` and
  `compass-influence.ts`.

## Example

```ts
view.lookAtFrom(
  view.cameraView().target,
  cameraDistanceForZoom({
    zoom: map.getZoom(),
    latDeg: map.getCenter().lat,
    paneWidthPx: mapContainer.clientWidth,
    aspect: canvas.clientWidth / canvas.clientHeight,
    vfovDeg: 55,
  }),
);
```

## Tests

`map-zoom-to-camera.test.ts`:

- **the ratio**, not two absolutes — one zoom step halves the distance, which is
  what "the views agree" means and what survives a later FOV change;
- a **sanity anchor** at z17, which the ratio test cannot provide (both halves
  could be wrong together);
- both clamps, including that `MAX` actually sits inside the far plane;
- pane width and aspect each move the result in the right direction — the aspect
  one catches the easiest available sign error;
- a property test that no input produces a non-finite or out-of-range distance,
  including `NaN`, `Infinity` and a zero pane width;
- a monotonicity property: zooming in never moves the camera further away.
