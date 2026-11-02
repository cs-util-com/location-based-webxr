# Narration 3: the sign speaks

A throwaway prototype for the narrated text in AR (brief: narration round,
direction 3 of 3). One self-contained page, `index.html`; three.js 0.185.1
from unpkg; no audio plays, a fake clock drives the words. The bar at the
bottom with the dashed top edge is the prototype's own control panel, not
part of the design.

## The direction in two sentences

The reading sign in the world is the narration's only face: it offers
"Read" and "Listen" as its two halves, and while the voice plays the
current sentence runs on a caption plate hanging under the sign, so the
visitor keeps looking at the street. The screen keeps only a small
floating control (play/pause in a progress ring, "Full text", speed), the
sheet is only for reading at length, and every audio problem is said on
the sign itself.

## What it optimises for

- Eyes on the place: the words sit next to the object they talk about, not
  in a strip over the camera image.
- One place for the voice's state: loading, slow, missing, paused for a
  call, the end - all on the sign, in the same plate the words use.
- A near-empty screen: Exit, the view pill, and one thumb-sized control.

## What it gives up (where it loses, measured in the page)

- **Distance.** Text on a world object shrinks with distance. The page
  measures the caption's letter size on screen every frame and, when it is
  too small, the caption steps off the sign into a bubble tethered under it.
  So beyond a few metres this direction becomes a screen caption anyway,
  just placed next to the sign. Numbers below.
- **Angle.** A sign fixed on a wall ("Sign: Fixed" in the panel) seen at
  more than 60 degrees cannot carry text; the caption steps beside it. The
  default sign turns to the visitor, which avoids this.
- **Up close.** At 3 m the 2.4 m sign is wider than an upright phone's view;
  its edges are cut and the visitor has to step back.
- **Sideways phones.** Letters come out about 18 % smaller than upright (a
  50 degree vertical view over 390 px), so the caption leaves the sign
  sooner; there is no room above or below the sign, so the bubble goes to
  its side. The landscape sheet (a right-hand panel) covers the sign, which
  stands in the middle of the view.
- **Looking away, relocating, after a lock.** With the sign off screen or
  not yet found again, the caption docks at the bottom edge with "the sign
  is to your left": the direction collapses into a caption strip, on
  purpose, rather than going silent.
- **Moving text.** Words fixed to a tracked object move with tracking
  jitter and hand shake; reading them is harder than a fixed strip. The
  prototype has no jitter, so this is unmeasured here.
- **Cost.** The caption plate is a 1024 x 448 canvas texture redrawn per
  word (and every frame during the 0.4 s slide between chunks); the sign
  redraws about 11 times a second while playing, for its sound bars. A real
  build would draw the bars in a shader or drop them.

## Answers to the four questions

1. **Discovering the voice before anything is opened.**
   - Read or listen (default): the sign's lower half is two buttons, "Read -
     about 10 min" and an amber "Listen - 12 min, a voice" with a speaker
     mark. Amber means "this makes sound".
   - From far away (title letters under about 8 px) the halves would be
     unreadable, so the sign becomes one big mark: a speaker disc, "Listen /
     or read - 12 min". Tapping it raises a card at thumb height with the
     same two choices.
   - Walking up: the walk card says "the sign there speaks: listen or read,
     12 min".
   - Captions view: the sign is one wide "Listen - captions on this sign"
     button with a small "Read the text" in its corner, and the caption
     plate already hangs under it showing the first sentence greyed out with
     "Tap to listen" - the visitor sees where the words will appear before
     anything sounds.
   - Inside the station circle the floating control ("Read" and a play
     button) is always at the bottom right, so nobody has to reach up to the
     sign with a thumb.
2. **The strip and the sheet together.** There is no strip: the caption
   lives on the sign. Opening the full text (the Read half, "Full text", or a
   "Read" on the caption plate) opens the sheet, and the floating control
   merges into the sheet's footer: one set of controls on screen, never two.
   The sign keeps speaking behind or beside the sheet. Closing the sheet
   never stops the voice: the floating control comes back and the eyes go
   back to the sign. Pause anywhere pauses everywhere. Leaving the circle
   pauses and closes the sheet; Exit pauses and keeps the place. A tap on a
   sentence in the sheet plays from there.
3. **Audio states** (all shown on the sign; the panel's "Voice file" and
   "Event" buttons trigger them):
   - Loading: the Listen half spins "Loading...", the plate says "One
     moment, the voice is on its way", the ring spins. After 2.5 s it becomes
     "Still loading - read meanwhile" in a calm blue, with "Read meanwhile",
     and the Read half gets an amber outline. When the voice arrives it
     starts, because the visitor asked for it; but if they went to read
     meanwhile, it waits ("The voice is ready") instead of starting by itself.
   - Missing or failing file: no error code, no red. The Listen half turns
     grey, "No voice - read the text instead"; the Read half gets the amber
     outline; the plate says "The voice cannot be played here at the moment.
     The whole text is ready to read." with "Read the text" and "Try the
     voice again". The floating control keeps only "Read"; the sheet shows
     "No voice right now. The whole text is here to read." where the player
     was. Recommended for the real app: check the file when the visitor
     enters the circle, so the sign says this before the tap (not built here).
   - The end: the plate says "That was the whole story of the square. Next:
     Station 2, about 60 m east" with "Play again" and "Read the text"; the
     Listen half reads "Again - you heard it all"; the ring is full and shows
     a replay mark. Nothing plays again without a tap. After 10 s the plate
     folds away (or returns to the greyed preview in captions view).
   - Phone locked or page hidden: the voice keeps playing - the visitor
     started it, it works like a podcast in a pocket with earphones. The lock
     screen shows it (mock-up in the page). The AR session usually ends when
     the page is hidden, and restarting the camera needs a tap, so on return
     the page shows "The voice kept playing while your phone was locked",
     the live caption, and "Back to the camera view". After that tap,
     "Finding the sign again" with the caption at the bottom edge, then the
     words go back onto the sign. Honest gap: a locked web page cannot follow
     the visitor's position, so the voice will not pause if they wander out
     of the circle while locked.
   - A phone call: the voice pauses at once. The sign: "Resume - paused for
     your call"; the plate: "Go on from: 'To your left, in the north-west
     corner...'" with "Resume". Resuming rewinds to the start of the
     interrupted sentence. It never resumes by itself after the call.
   - Lock-screen media controls: title, "Old market square - Station 1 - tour
     name", the speaker mark as artwork, play/pause, 10 s back and forward
     (Media Session API with position state; only mocked here).
4. **Playback rate: yes, but secondary.** A "1x" chip next to the floating
   control (only once the voice has started) and in the sheet footer,
   cycling 1x, 1.25x, 1.5x, 0.75x, remembered on the phone; never on the
   sign. For it: in this direction the words move on a sign read at a
   distance at the voice's pace, so a slow or non-native reader needs 0.75x,
   and a 12-minute text invites 1.25x. Against: one more button in a cluster
   meant to be tiny, and a sped-up narration of local history may sound
   wrong. Nothing here decides it; if field use shows few changes, move it
   into the sheet only.

## Never happens (checked in the page)

- Sound never starts without a tap (Listen half, caption plate, floating
  control, a sentence in the sheet); after a slow load it waits if the
  visitor went reading; after a call it waits for "Resume".
- Every action has a control reachable by one thumb on an upright phone:
  the floating control at the bottom right, the far-sign card at the bottom.
- A missing file leaves the whole text readable, with no technical wording.
- No text names internal concepts.

## Parameters the verdicts rest on, and what reverses them

- On-sign caption letter size: 58 px of a 1024 px canvas on a 2.4 m plate,
  0.136 m in the world.
- Legibility threshold: 12 CSS px letter size (panel: "Legible from"
  10/12/14/16), with 5 % hysteresis; angle limit 60 degrees.
- Sign growth with distance: scale = distance / 4.5 m, between 1 and 1.6
  (panel: "Far sign grows" on/off).
- Camera: upright phone 42 degrees horizontal view (focal about 508 px at
  390 px wide); sideways 50 degrees vertical (about 418 px at 390 px tall),
  as in the reference prototype.

Farthest distance at which the caption stays on the sign, from those
numbers (the page's readout shows the same values live):

- Upright, growth on: 11.0 m at 10 px, 9.2 m at 12 px, 7.9 m at 14 px,
  4.3 m at 16 px.
- Sideways, growth on: 9.1 m, 7.6 m, 4.1 m, 3.6 m.
- Upright, growth off: 6.9 m, 5.8 m, 4.9 m, 4.3 m.
- Sideways, growth off: 5.7 m, 4.7 m, 4.1 m, 3.6 m.

The sideways numbers assume a full 390 px tall view. In an 844 x 390 browser
window the prototype panel takes some of that height (the readout then shows
about 10 px at 7 m); use "Orientation: Sideways" or hide the panel.

So "the usual 7 m stand reads on the sign" holds only on an upright phone
with growth at up to 14 px, or sideways with growth at up to 12 px (12.6 px
measured: barely). It fails at 16 px in every case and without growth at
every threshold. If bright sunlight needs 16 px letters, this direction
mostly shows its bubble, and a strip may be the simpler honest answer.

## Prototype controls (the dashed panel)

- View: Read or listen / Captions (also via the pill at the top left).
- Voice file: Normal / Slow loading (7 s) / Missing; then tap Listen.
- Event: Ends now (12 s before the end) / Phone locked / Call. These start
  the voice if needed, standing in for the visitor's earlier tap.
- You stand: close 3 m, usual 7 m, far 16 m, at the side 65 degrees, looking
  away, walking up (outside the circle). Drag on the view to look around.
- Sign: turns to you / fixed (as on a wall). Far sign grows: on / off.
- Legible from: the threshold above. Orientation: the window, or the stage
  at exactly 390 x 844 or 844 x 390, scaled to fit.
- The readout line: layout, distance, angle, growth, letter size on screen,
  where the caption is and why, and a sound indicator.

The page has no `<input type="range">`.
