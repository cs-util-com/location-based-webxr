# viewpoint-looks.ts

## Purpose

The meshes of the pictures seen from a viewpoint, built in the viewpoint's
frame (the station's: north, up, east; the ground at height 0). Geometry and
materials only; `viewpoint-world.ts` decides what shows how much.

## Public API

- `viewpointTurn(vp)`, `viewpointYaw(vp)`: the viewpoint's rotation, and the
  turn about up that points a group's -Z its way on the ground.
- `viewpointPlane(vp, aspect, texture, depthM = vp.distanceM, crop = 1)`:
  the whole picture (or its centre crop) on one plane `depthM` along the
  axis, `2 * depth * tan(hfov / 2) * crop` wide, so from the eye it covers
  what the camera saw. No depth test (an overlay that lines up), render
  order 50, opacity 0 until the part sets it. Mesh `picture-viewpoint-plane`.
- `spotMarker(vp)`: an amber ring with an arrow the way to face, on the
  ground under the eye; one material. Group `picture-spot`.
- `viewerStand(vp)`: the viewer (binoculars on a column) 0.42 m ahead of the
  spot, its head tilted with the viewpoint's pitch; `materials` fade it.
  Group `picture-viewer`.
- `finderCorners(vp, aspect, crop)`: four L-shaped corner marks of the
  centre crop, each at its own depth (1.2 and 0.75 times the subject's
  depth, 6.5 m, 4.5 m; a lower one kept above the ground), so they meet only
  from the spot. Meshes `picture-finder-ink` and `picture-finder-under`.
- `portalLook(vp, aspect, texture)` and `PORTAL_FRAME`: the window, a frame
  1 m wide, 1.5 m ahead of the spot, upright on two posts, at the eye's
  height plus the pitch. Its opening (`picture-portal-opening`) is a quad at
  the back of a 16 cm reveal whose shader casts the ray from the eye
  (`cameraPosition`, each eye's own in a headset) through the fragment to
  the picture's plane at the subject's depth and samples it there, a dark
  box past the edges with a 4 % fade. `plane` is that plane in the
  viewpoint's frame; the part copies it into world space every frame.

## Invariants

- From the eye, the plane, the finder's crop and the portal's plane all
  cover the lens's angle (or the crop's share of it).
- Taken from the chosen prototype: the standing frame (width 1.0 m at
  1.5 m, the sweep's default), the finder's corner depths, the viewer's
  shape. Left out: the prototype's soft edge feather on the plane, the
  card on a post beside the spot, the light column, the ground shadows and
  the plates on the viewer and under the window.

## Tests

Through `viewpoint-world.test.ts` (names, positions, the shader's plane).
