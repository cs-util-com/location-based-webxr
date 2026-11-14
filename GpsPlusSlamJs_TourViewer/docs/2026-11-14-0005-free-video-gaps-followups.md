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
- **A cap on videos playing at once.** Nothing limits how many free videos
  of one station play together. Each is a decoder and a texture upload per
  frame, which a phone notices. A cap needs a rule for which one wins (the
  nearest, or the last started), and measurements on a phone to set it.
- **Lowering other audio under a video's voice.** A video with sound plays
  over a narration or another item's sound at full level. Ducking needs one
  place that knows every audio source of the station; `voice-focus.ts` is
  the likely home.
- **The stacked-alpha note for the visitor.** The editor says "Needs a
  stacked-alpha video" over a cutout without a matte. The visitor sees only
  the feathered ellipse, with no hint. Whether a visitor should ever see such
  a note (or whether a tour with that cutout should refuse to be shared) is
  open.
- **Remembering the CC choice.** Captions are on at first and the switch
  holds for one video only. The prototype remembers the visitor's sound
  choice for every video. The same rule for captions is plausible but was
  not asked for.
- **A live 3D preview while dragging the width slider.** The slider writes
  the width once, on release, like the 3D view's white dots. The number
  follows the drag, but the video in the 3D view does not resize until the
  drag ends.

## Waiting for the viewpoint work

The window view, the stand-here view and the viewpoint fields (position,
heading, field of view, "Look from viewpoint") come with the viewpoint
work. They are not gaps in this item.

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
