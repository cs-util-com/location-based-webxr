# viewpoint-world.ts

## Purpose

The world part of a picture in a viewpoint view (`thenNow`, `sharpen`,
`viewer`, `finder`, `window`), in play and in the editor. Reached through
`pictureWorld` (`world.ts`), the picture kind's one world door.

## Public API

- `viewpointWorld(block, env, { decode? })`: the part, or null for another
  view or a block without a viewpoint (the renderer draws that as a plane).
  `ready` rejects when the image cannot be read or decoded.
- `EDITOR_PICTURE_ALPHA` (0.55): how much of a fading picture the editor
  shows, to place it by.

## Behaviour per view

- `sharpen`: the picture's plane fades in by `SHARPEN_FADE` (a plain fade;
  no blur).
- `thenNow`: the plane's opacity is `THEN_NOW_FADE` times the blend of
  `then-now-fade.ts`; lined up, the visitor gets the slider on the page's
  screen (`then-now-slider.ts`), and it closes when they leave.
- `viewer`: the viewer stand fades out as the picture fades in
  (`VIEWER_FADE`); the editor shows the stand and a half picture.
- `finder`: corner marks; the crop's fill fades in by `FINDER_FADE` and the
  ink turns amber on the spot.
- `window`: the standing frame (`portalLook`), always shown; its shader's
  plane is copied into world space every frame.
- Every view: the spot marker, fading as the picture takes over.
- A tap in play opens the picture's sheet (`picture-sheet.ts`) with the
  picture, closing the slider; the editor takes no tap.

## Invariants

- The viewpoint is in the station's frame: the look sits in an anchor whose
  matrix is the inverse of the part's own (pose and size) every frame, so
  moving or resizing the item never moves where the picture lines up. The
  anchor is hidden until the first frame sets it.
- Facing is the camera's world direction turned into the part's parent
  frame; without a camera the reach is broken and every fade reads 0.
- `dispose` closes the slider and the sheet, frees the look and the
  texture (the portal's shader holds it outside any material map); a
  texture read after `dispose` is freed at once.

## Tests

`viewpoint-world.test.ts` (jsdom): looks per view, the anchor property over
random poses and sizes, sharpen by place and facing, the editor's half
picture, the viewer giving way, the slider's arrival, fade-in, take-over and
departure, the window's shader plane, the sheet, disposal.
