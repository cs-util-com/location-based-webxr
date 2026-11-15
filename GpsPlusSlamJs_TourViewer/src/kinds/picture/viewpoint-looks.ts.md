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
- `viewerStand(vp, plateMap)` and `VIEWER_PLATE`: the viewer (binoculars on
  a column) 0.42 m ahead of the spot, its head tilted with the viewpoint's
  pitch, a 0.34 x 0.15 m plate (`picture-viewer-plate`, the painted
  `plateMap`) on its column at 0.95 m tilted back 0.35 rad, and an amber
  halo (`picture-viewer-halo`, a 0.46-0.5 m ring) on the ground at its foot.
  Both plates' materials come from one `plateMaterial(map)`.
  `materials` (the plate's among them) fade it; `halo` is the part's to
  pulse. Group `picture-viewer`. The viewer is its own mark: no spot guide.
- `finderCorners(vp, aspect, crop)`: four L-shaped corner marks of the
  centre crop, each at its own depth (1.2 and 0.75 times the subject's
  depth, 6.5 m, 4.5 m; a lower one kept above the ground), so they meet only
  from the spot. Meshes `picture-finder-ink` and `picture-finder-under`.
- `portalLook(vp, aspect, texture, plateMap)`, `PORTAL_FRAME` and
  `PORTAL_PLATE`: the window, a frame
  1 m wide, 1.5 m ahead of the spot, upright on two posts, at the eye's
  height plus the pitch. Its opening (`picture-portal-opening`) is a quad at
  the back of a 16 cm reveal whose shader casts the ray from the eye
  (`cameraPosition`, each eye's own in a headset) through the fragment to
  the picture's plane at the subject's depth and samples it there, a dark
  box past the edges with a 4 % fade. `plane` is that plane in the
  viewpoint's frame; the part copies it into world space every frame. A
  0.36 x 0.09 m plate (`picture-portal-plate`) hangs 5 cm under the frame,
  or, when the frame stands too low for that, 1 cm above the ground over
  the frame's foot.

## Invariants

- From the eye, the plane, the finder's crop and the portal's plane all
  cover the lens's angle (or the crop's share of it).
- Taken from the chosen prototype: the standing frame (width 1.0 m at
  1.5 m, the sweep's default), the finder's corner depths, the viewer's
  shape, its halo and plate, the window's plate. The way to the spot (the
  decal, the light column, the card on its post) is `spot-guide-look.ts`.
  Their ground shadows too (`VIEWER_SHADOW`, `PORTAL_SHADOW`: 0.9 x 0.9 m
  at 0.3 under the viewer, 1.15 x the frame's width by 0.8 m at 0.22
  under the window, 12 mm over the ground, painted by `painters.shadow()`),
  each in a `floor` group apart from the tappable `group` and casting no
  ray, so the ground stretches no tap bounds. The soft edge on the plane
  is `then-now-feather.ts`, set by `viewpoint-world.ts`.

## Tests

Through `viewpoint-world.test.ts` (names, positions, the shader's plane).
