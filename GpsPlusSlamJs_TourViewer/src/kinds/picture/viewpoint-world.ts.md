# viewpoint-world.ts

## Purpose

The world part of a picture in a viewpoint view (`thenNow`, `sharpen`,
`viewer`, `finder`, `window`), in play and in the editor. Reached through
`pictureWorld` (`world.ts`), the picture kind's one world door.

## Public API

- `viewpointWorld(block, env, { decode?, painters? })`: the part, or null for another
  view or a block without a viewpoint (the renderer draws that as a plain
  plane at the block's pose, sized by its width). This is a deliberate
  fallback, not the prototype's behaviour: a tour file may carry a
  viewpoint view without a viewpoint, and it should still show the
  picture. The editor never leaves one so: switching to a viewpoint view
  stands a viewpoint in front of the picture (`editor/editor-session.ts`).
  `ready` rejects when the image cannot be read or decoded.
- `EDITOR_PICTURE_ALPHA` (0.55): how much of a fading picture the editor
  shows, to place it by.
- `VIEWER_HALO`: the viewer halo's glow, `(1 - k) * (0.35 + 0.25 sin(2.2 t))`,
  at half that farther than 4.5 m from the spot (the prototype's numbers).
- `painters` (default `canvasPicturePainters()`, made once the image is
  read) paint the guide's decal and card and the viewer's and window's
  plates.

## Behaviour per view

- `sharpen`: the picture's plane fades in by `SHARPEN_FADE` (a plain fade;
  no blur).
- `thenNow`: the plane's opacity is `THEN_NOW_FADE` times the blend of
  `then-now-fade.ts`; lined up, the visitor gets the slider on the page's
  screen (`then-now-slider.ts`), and it closes when they leave. Its
  plane carries the shared soft-edge alpha map (`then-now-feather.ts`)
  at 0.035; the viewer's plane takes the same width and sharpen's 0.02.
  The maps are shared by every part, so `dispose` detaches them from
  the look's materials before freeing it.
- The viewer and the window lay a soft shadow on the ground
  (`viewpoint-looks.ts`), outside the tap target; the viewer's fades out
  with the stand.
- `viewer`: the viewer stand and its plate fade out as the picture fades
  in (`VIEWER_FADE`); its halo pulses, softer far away, and goes with it.
  The plate's words are generic ("Step up to it", "and see it as it was"),
  since a picture has no short name for them; it names the year, as every
  guide's card does. The editor shows the stand and a half picture.
- `finder`: corner marks; the crop's fill fades in by `FINDER_FADE` and the
  ink turns amber on the spot.
- `window`: the standing frame (`portalLook`), always shown, its plate
  naming the caption's first phrase and "Look through the frame"; its
  shader's plane is copied into world space every frame.
- Every view but the viewer: the spot guide (`spot-guide-look.ts`), shaded
  by `spotGuideShade` with the view's take-over: then and now its distance
  ramp (0 in the editor), the finder its on-spot ramp, sharpen its picture's
  opacity, the window 1. The guide's card (on its post) and decal sit in
  the tap target, so a tap on them opens the sheet; the column is not in
  it, and the card takes no tap once it has given way. Its card shows the
  picture upright: a texture decoded pre-flipped (`flipY` false) is
  stored upside down, and the card is told so.
- In the editor the guide is part of the item's drawing, so the folder
  outline and the group span (`editor3d/folder-outline.ts`,
  `editor3d/editor3d-editing.ts`, which box the item's objects) grow to
  hold it. That is intended: the prototype shows the guide in its editor
  too, and the creator places the picture by where the spot is.
- The plates and the guide's card are painted with `painters` (default:
  the canvas painters).
- What pulses (the column's ripple, the halo) reads a clock held at 0 when
  `env.reduceMotion` says so.
- The screen hints of the prototype ("Walk to the marker", "Turn this
  way") and its arrival caption are screen elements, not built here: a
  page would read the guide's card shade (the distance from the spot) and
  the reach's off-axis angle for them.
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
- Once the image is read, the part's object keeps its aspect (height over
  width, `markDrawnAspect` in `picture-decode.ts`): the editor's
  field-of-view lines take it (`editor3d-stations.ts`).

## Tests

`viewpoint-world.test.ts` (jsdom): looks per view, the anchor property over
random poses and sizes, sharpen by place and facing, the editor's half
picture, the viewer giving way with its plate and halo, the guide standing
at the viewpoint under random item and folder poses and sizes, the guide
on the way in and on the spot, the card told of an upside-down picture,
the tap target without the column and the hidden card taking no ray, the
window's plate above the ground for a low viewpoint, the viewer's and the
window's plates (none on the other views, which paint only the guide's
card), each view's soft-edge width, one part's disposal leaving the
shared feather map alive, the viewer's and the window's ground shadows
outside the tap target, sharpen's card
without the picture, the
column held still on reduced motion, the slider's arrival, fade-in, take-over and
departure, the window's shader plane, the sheet, disposal.
