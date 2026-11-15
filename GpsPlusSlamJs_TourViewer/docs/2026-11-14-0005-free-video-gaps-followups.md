# Free video: the gaps left after the side-by-side check - follow-ups

The free video item (screen, cutout, porthole) was compared side by side
with its prototype, `public/prototypes/station-blocks-4-video/`. What was
built from that check is described in the sidecars:

- the editor panel and the accepted differences:
  [`src/editor/kind-panels/video-panel.ts.md`](../src/editor/kind-panels/video-panel.ts.md),
  section "Compared with the video prototype";
- the inspector preview:
  [`src/editor/kind-panels/video-preview.ts.md`](../src/editor/kind-panels/video-preview.ts.md);
- the visitor part:
  [`src/kinds/video/video-world.ts.md`](../src/kinds/video/video-world.ts.md).

This file lists what was deliberately left for later. Each item is
independent.

## Not built, filed

- **Creator AR mode.** The prototype lets the creator place the video while
  standing at the station, through the camera. The editor places items only
  in its 3D view. This needs its own design (who holds the phone, how a
  placement is confirmed) before any build.
- **A cap on videos playing at once - built.** At most two free videos
  play at once and one is heard (`src/kinds/video/video-cap.ts.md`). The
  first to start keep playing and a later start waits in line on its
  poster (or paused frame), its card's line saying so; the newest start
  with sound takes the sound and the other plays on muted. Every view
  counts, stand-here included. The cap is one per page, not per station:
  the decoders are the phone's. Still open: the value 2 is the design's
  guess, to be measured on a mid-range phone; a visitor's tap on a third
  video waits like a trigger's start rather than taking a place.
- **Lowering other audio under a video's voice.** A video with sound plays
  over a narration or another item's sound at full level. Ducking needs one
  place that knows every audio source of the station; `voice-focus.ts` is
  the likely home.
- **The stacked-alpha note for the visitor.** The editor says "Needs a
  stacked-alpha video" over a cutout without a matte. The visitor sees only
  the feathered ellipse, with no hint. Whether a visitor should ever see such
  a note (or whether a tour with that cutout should refuse to be shared) is
  open.
- **Remembering the CC choice - built.** The CC switch is remembered for
  every video of every tour, under `videoCaptions` in the same stored
  preferences as the sound choice (`videoCaptionsChoice` /
  `withVideoCaptions` in `src/kinds/video/video-rules.ts`), read again
  each time a video's card opens. Without storage it holds for that video
  only. Still open: the design's rule that a start whose sound the browser
  refused switches captions on for that clip whatever the stored choice;
  today a visitor who stored "off" gets a muted clip without words then.
- **A live 3D preview while dragging the width slider.** The slider writes
  the width once, on release, like the 3D view's white dots. The number
  follows the drag, but the video in the 3D view does not resize until the
  drag ends.

## The window and stand-here views (built)

The window and the stand-here views are built: the format, the visitor's
looks (`src/kinds/video/video-look.ts.md`, `src/kinds/video/stand-here.ts.md`)
and the editor (the viewpoint section shared with the picture panel,
`src/editor/kind-panels/viewpoint-part.ts.md`; a switch to stand-here
gives the video a viewpoint in front of it in the same undo step; the 3D
view draws its field-of-view lines and looks from it). A finished video
stays finished on leaving and coming back; a tap replays it. Left for
later:

- **Dragging a video's viewpoint in the 3D view.** A picture's viewpoint
  has a handle to drag; a video's is typed in the inspector or stood in
  front of the video again. The handle is picture-only
  (`src/placement/placeables.ts`).
- **The window's measures follow its width.** The prototype's window
  surround, reveals and sill are fixed sizes around a fixed opening; here
  they scale with the video's width.
- **No caption plate under the window's sill.** Captions are the card's
  strip on the phone, as for the other views.
- **The guide names no building.** The prototype says "Face the guild
  house"; the card's line says "Face the video", since a tour names no
  building.
- **The near-start hint.** A near start shows no "Walk closer" hint before
  it starts; `video-world.test.ts` holds it as an expected failure until
  it is decided whether the hint goes or gets a home outside the card.

## Visitor side compared with the prototype (from the code)

The visitor view is the AR session. It could not be shown on a desktop
browser: desktop Chrome has no WebXR AR, the e2e AR fakes replace the
scene with a recorder object that draws nothing, and the item lab
(`item-lab.html`) loads only the kinds under `public/prototypes/item-kinds/`,
which holds no video. The comparison below is therefore made from the code
and its sidecars, not from screenshots. Differences:

- **Controls.** The prototype's screen has a working in-world play/pause and
  scrub bar. Here the real controls are on the page card
  (`video-card.ts`), and the in-world bar is drawn for show, because taps
  on the 3D look carry no hit point. The card has no scrub bar.
- **Captions.** The prototype draws them in the world (a lower third on the
  screen, a plate above the cutout) and moves them to the phone strip
  beyond about 4 m. Here they are always the card's strip on the phone
  screen.
- **The porthole's tap.** The prototype opens a full-screen player with
  large captions, scrub, sound and close. Here it opens the card with the
  clip large and a Close; there is no scrub, and the captions are the card's
  strip.
- **A refused sound.** The prototype falls back to the muted start and says
  why in a toast. Here the same fallback is said in the card's line.
- **A cutout without a matte.** The prototype treats the matte as required
  for a cutout. Here the cutout is softened to a feathered ellipse.
- **The visitor's time display.** The prototype's HUD shows "0:00 / 0:12"
  with CC. Here the card shows the time, with CC in the same row.

What matches: the three looks' measures (slab, 30 degree cutout turn, brass
porthole with progress ring, halo and "Watch" label), the start triggers
(their angles and times were not compared),
the sound rules (the visitor's choice kept for every video, a muted start
before the first tap, "Tap for sound"), the loop, and a finished video
replaying on tap.
