# Travelling surface D - Words over the circle

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in. It takes the "one box that travels" of
`../sign-speaks-r6-2-travelling-box/` to the narration circle (an audio item in the `spot` view).

## The idea

A narration circle has no sign: the visitor stands inside its anchor. The words of its voice are
one object that lives in one of two places, never both:

- **Over the circle.** A words plate stands where the creator put it, and stays there while it can
  be read: in view, its letters at least the threshold tall and wide on screen, not seen too flat,
  and not wider than the screen.
- **Docked.** Otherwise the same texture flies down and docks at the bottom edge, centred, in the
  round 5 box's size, and flies back up when the plate can be read again.

Inside the circle the angle decides more than the distance: turning round, looking down at the
phone, standing too close. Outside the circle the words hide and the voice stops; walking back in
carries a voice on that the visitor had started (the app's rule for the circle), and a voice the
visitor paused stays paused. Nothing sounds without a tap.

Controls are round 5's only: tap the words to pause or play, drag them up or down to scrub, on the
plate and in the box alike. No scrub bar, no play button. A tap on the circle's plume, inside the
circle, also plays or pauses (the circle's own tap rule); outside it does nothing.

The "Tour words" pill is the visitor's one choice for the whole tour (in the world / in the box),
not a choice per item, and it wins over every creator's choice. The bottom-centre dock belongs to
the item whose voice runs (one voice at a time, a tap wins); on this page the circle is the only
voice, so it always has it.

## The three places (knob "Words stand", URL `pos`)

- **`stand` - upright at the far rim** on two posts, letters 17 cm, turning to the visitor. Read
  from the centre; docks when the visitor turns round, looks down, or stands at the near rim
  (too small) or the far rim (behind).
- **`lie` - flat on the ground just inside the near rim** (the side the route arrives from),
  letters 7 cm, turning so its text reads upright. Read only while looking down from the near
  rim; from anywhere else it is seen too flat and docks.
- **`float` - at eye height over the centre**, letters 14 cm, turning to the visitor. Read from
  the rim and walking in; closer than about 3 m it is wider than the screen, and in the centre the
  visitor stands in it, so it docks. The plume's motes step back while the words float in it.

## What to look at

- **Walk in**: from outside the circle (nothing but the rim, the plume and the name plate "Walk
  into the circle to listen") into the centre. Inside, the words appear over the circle or docked.
- **Edge**, **Centre**, **Side**, **Far**: the same body poses for every place, so the three
  compare. "Far" stands near the far rim looking back across the circle.
- **Turn round**: a slow full turn on the spot; the words leave with the world and fly to the
  dock, then fly back as the plate comes round.
- **Look down**: the phone tilted to the ground. It docks the standing and floating words and is
  the only pose in which the lying words are read.
- **Scrub**: a simulated finger taps to pause, drags two lines back, taps to resume.
- **Leave**: walk out: the words hide, the voice stops. **End** jumps to the last sentence.
- Drag on the view to look around (sideways turns, up and down tilts).

## Measured (desktop Chrome, phone portrait 390 x 844, the readout's own numbers)

Letters are the smaller of the projected letter height and width (so a plate seen flat is judged
by its squashed side); the angle is the full angle between the plate's face and the line to the
camera.

- Circle 6 m, threshold 12 px, angle limit 45 deg (the defaults):
  - stand: centre 14.6 px, 1 deg - over the circle; side 11.9 px - docked (kept on the plate when
    arriving from it, by the hysteresis); near rim 7.5 px - docked; looking down - out of view.
  - lie: near rim looking down 15.3 px, 35 deg - over the circle; centre 71 deg, side 76 deg, far
    81 deg - docked; near rim level - out of view (below).
  - float: near rim 12.7 px, far rim looking back 15.1 px - over the circle; centre - docked (in
    it); side - out of view.
- **Angle limit 30 / 45 / 60 deg**: decides only one case, the lying plate looking down at 35 deg
  (docked at 30, over the circle at 45 and 60). With the outside evidence's 32 deg the lying plate
  never shows the words in any beat. The standing and floating plates turn to the visitor and stay
  at 1 to 2 deg, so no limit decides them; with "Words turn: fixed" the standing plate from the side
  is 35 deg off, and its letters (9.9 px) fail first anyway.
- **Threshold 10 / 12 / 14 / 16 px**: stand from the side reads only at 10; float at the near rim
  reads at 10 and 12, docks at 14; lie looking down reads up to 14, docks at 16; stand in the centre
  reads up to 14.
- **Radius 4 / 6 / 10 m**: the plates are sized in metres, so the radius flips the verdicts:
  standing in the centre it is too wide at 4 m (21.8 px but wider than the screen), read at 6 m,
  too small at 10 m (8.7 px); floating from the near rim it reads at 4 and 6 m, too small at 10 m.
  The lying plate does not change (it sits a fixed 1.4 m inside the rim). A build would size the
  standing and floating plates by the radius.
- Landscape 844 x 390: the standing plate in the centre drops to 12.0 px (a sideways phone sees
  wider), exactly at the threshold; the lying plate looking down 12.6 px.

## Values chosen at one point, and what would reverse them

- **Angle limit 45 deg** (default): between the outside evidence's 32 deg and the 60 deg of 6.2.
  At 30 the lying place loses its only reading pose; at 60 nothing changes here.
- **Threshold 12 px**, **hysteresis 5 %**, **0.3 s hold**, **flight 0.6 s**: as 6.2; all knobs.
  A walking visitor may need 10 to 15 % hysteresis (untested).
- **Plate sizes** (17 / 7 / 14 cm letters) for a 6 m circle; see the radius sweep above.
- **"Too close"**: a plate wider than 96 % of the screen docks. Without it the floating plate in
  the centre would be judged as huge letters.
- **Inside**: from the rim, held to 1.5 m past it, as the app's circle (`sound-reach.ts`).

## Faked

- The voice is a soft generated tone, one note per word, on times invented from the letters. No
  recording. The text and the square are invented.
- The camera, the square and the walk are simulated; nothing runs in AR. The drag on the view
  stands in for turning and tilting the phone.

## Not verified

- On a phone in AR: whether the lying plate is found at all (it is under the visitor's eyes only
  when they look down), and whether the flight reads as one object travelling.
- Whether a visitor standing in the centre minds that the words are always docked with the lying
  and floating places.
- Frame times: measured in headless Chrome with a software renderer, so they say nothing about a
  phone.

## Cost

The settings panel shows the cost once a second: frame work (average and max), the longest gap
between frames, the count of frames over 50 ms, the item's own draws, triangles and motes (ground
disc, plume, name plate, words plate or the overlay quad, and the standing plate's two posts), and
the time to repaint the words texture, which only repaints when the words, the scroll or the hint
change. Measured: 4 to 6 draws, 6 to 70 triangles, 140 motes.

## Files

- `kind.js` - the item kind (read, assets, fields, world): the circle, the plume, the name plate
  and the words plate in its three places, with the shared words texture.
- `sample.json` - two records: normal and longest.
- `circle.js` - the page: the scene, the place decision, the flight, gestures and beats.
- `circle.css`, `index.html`.
