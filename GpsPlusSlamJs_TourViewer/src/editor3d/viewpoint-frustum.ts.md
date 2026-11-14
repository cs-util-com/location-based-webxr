# viewpoint-frustum.ts

## Purpose

The field-of-view lines the editor draws from a picture's viewpoint while the
picture is selected: a ray from the eye to each corner of the frame at the
picture's depth, and the frame's four edges. They show what the picture's
camera saw and where the picture hangs from it.

## Public API

- `viewpointFrustum(vp, aspect)`: sixteen points in pairs (`LineSegments`
  order), in the station's frame as the format keeps the viewpoint (north,
  up, east): the eye to each corner, then each edge of the frame. The frame
  stands `vp.distanceM` ahead along the viewpoint's facing (its local -Z), is
  `2 d tan(hfov / 2)` wide and `aspect` (height over width) times that high:
  the size the picture hangs at in the viewpoint views.
  - Null for a lens outside (0, 180), a depth or aspect that is not positive,
    a position or turn that is not finite, or a turn of no length (a turn is
    normalised otherwise).
- `FRUSTUM_DEFAULT_ASPECT` (0.75): the aspect before the picture's image has
  loaded.
- `FRUSTUM_POINTS` (16): how many points the lines have.

## Invariants

- The frame's centre is the point "Look from the viewpoint" aims at
  (`viewpointForward(vp) * distanceM + position`).
- Pure: new vectors each call, no state.

## Who draws them

`editor3d-stations.ts` turns the points into its layer's frame (`inLayer`)
each frame the selection is a picture in a viewpoint view, with the image's
aspect from the drawn part (`drawnAspect`, `picture-decode.ts`).

## Tests

`viewpoint-frustum.test.ts`: an unturned viewpoint's exact corners, the
centre and size for any turn, lens, depth and aspect (property), and refused
inputs.
