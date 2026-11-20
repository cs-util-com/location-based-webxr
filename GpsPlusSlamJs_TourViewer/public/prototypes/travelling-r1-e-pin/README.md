# Travelling surface E - The pin opens in place

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in. It takes the "one box that travels" of
`../sign-speaks-r6-2-travelling-box/` to the short-text pin (a `shortText` item in the `pin` view),
the one surface of round 1 that is silent and written.

## The idea

A pin is a stem with a small tag on top that shows its caption. The tag and its description are
one card:

- **A tap on the tag opens it in place.** The description unfolds under the caption, on the same
  card, in the world. The pointer under the tag fades as the card opens; the stem stays.
- **When the open card cannot be read where it stands, the same card travels.** Out of view, its
  description letters under the threshold, or (with "Pin turns" off) seen from too far to the
  side: after the hold, the card's own texture flies to the screen, and flies back when it can be
  read again. While it is away a small dot marks the top of the stem, so the pin is never drawn
  twice.
- **A tap anywhere else closes it.** An open card on the screen flies home first, then folds into
  its tag. A tap on the open card itself does nothing: it is there to be read. A sideways drag
  turns the view and is never a tap.
- **One open card at a time.** Opening the other pin closes the first one; the second card only
  takes the screen once the first is home, so two cards never stack.
- **Leaving the station hides both pins and closes the card.** Coming back opens nothing by itself.
  Nothing on this page makes a sound.

Rules shared with the other round 1 pages:

- The voice owns the bottom-centre box. While a narration holds it (the "Voice" beat, a silent
  stand-in), an open card that could go there stays open in the world if it can be read there, and
  otherwise folds back into its tag; it opens again on its own once the box is free.
- The visitor's one pick for the whole tour (the pill at the top, the same stored pick as the
  circle page) wins over the creator's choice: "in the world" never moves the card, "in the box"
  always docks an open card.
- The card never moves while a finger is down, nor for 0.6 s after it lifts.

## The two away places (knob "When away", URL `away`)

- **box** (default): the bottom centre, as round 5's box and the other round 1 pages.
- **edge**: a comparison with the app's edge hint. While the pin is in view but too small, the card
  stands over the pin at a size that reads (as the edge hint's tag stands over its spot); when the
  pin is out of view, the card sits at the screen edge on the pin's side with an arrow beside it.
  A pin behind the viewer points to the side to turn to.

## What to look at

- **4 m, then Tap pin.** The app's own sizes (read from 4 m, description at 0.62 of the caption)
  put the description at 8.3 px on an upright phone at 4 m: the card unfolds under the pin and then
  docks. This is the main finding of this page, see "Measured".
- **2 m, then Tap pin.** At 16.4 px the description reads under the pin and stays there.
- **8 m and 15 m** with a card open: it stays docked; the stem's dot shows where it belongs.
- **65 deg**, with "Pin turns" off: the card's width on screen shrinks to about cos 65 = 0.42 of
  its frontal width, and it docks; with "Pin turns" on (the app's default) the tag faces the viewer
  and the angle never decides.
- **Turn away** with "When away: edge": the card goes to the edge on the pin's side.
- **Other pin** while the first is docked: the first flies home and folds, the second unfolds under
  its pin and only then takes the box.
- **Voice** with a card docked at 8 m: the card folds back into its tag.
- **Tap away** closes; **Leave** walks out of the 20 m station and both pins hide.

## Measured (desktop Chrome, headless, the readout's own numbers)

The readout's description size is the smaller of the letters' height and width on screen, in
device px. Frontal, standing at 4 m, upright phone (390 x 844, about 79 degrees top to bottom) and
sideways phone (844 x 390, 50 degrees):

- Read from 4 m (the app's default):
  - description 0.62 em (the app's): 8.3 px upright, 6.8 px sideways;
  - 0.8 em: 10.8 px upright, 8.9 px sideways;
  - 1 em: 13.5 px upright, 11.1 px sideways.
- Read from 8 m: twice those (16.5, 21.6 and 27.3 px upright).
- Read from 15 m: 3.75 times (30.5, 40.8 and 52.8 px upright).
- The folded tag is 19 cm tall at a 4 m read distance: 25 px at 4 m, 49 px at 2 m.

So the open card reads under the pin out to (upright, read from 4 m, description 0.62 em) 3.3 m
at 10 px, 2.8 m at 12 px, 2.4 m at 14 px and 2.1 m at 16 px; the panel prints this table for the
current settings. The page did what these numbers predict in every beat checked (at 12 px the card stays under the
pin at 2 m and docks at 4 m); the other combinations are computed from the measured px.

Taps (upright, 2 m): a tap on the tag opens it; a tap 33 px below the tag's middle opens it with a
16 px touch radius and misses with none; a drag across the tag turns the view and opens nothing; a
tap on the sky closes; a tap on the docked card keeps it open.

## Values chosen at one point, and what would reverse them

- **Threshold 12 px.** The verdict "the app's pin cannot be read at its own read distance" holds
  for every threshold from 10 to 16 px at 0.62 em (8.3 px is under all of them). It reverses only
  with a bigger description (1 em reads at 4 m up to a 13 px threshold), a longer read distance
  (8 m reads at 4 m for every threshold), or a threshold of 8 px or less.
- **Description 0.62 em.** The app's value. At 1 em the card stays under the pin at 4 m; the card
  is then 1.6 times as tall in the world.
- **Hysteresis 5 %.** A card leaves the world at threshold x 0.95 and comes back at the threshold:
  at the app's sizes that is a band from 2.77 m to 2.92 m (15 %: to 3.26 m). Not measured on a walk,
  computed from the measured px.
- **Hold 0.3 s, flight 0.6 s, touch radius 16 px.** The touch radius is what makes the 25 px tag at
  4 m a 57 px target; at 0 px a tap must land on the tag itself.
- **Side limit 60 deg.** It only decides with "Pin turns" off and a large card; at 65 deg the
  letters' width alone already docks the card at the app's sizes.

## Faked

- The camera, the walk and the turn are scripted; a sideways drag turns the view.
- "Voice" is a silent box standing in for a narration that holds the bottom-centre box.
- The pins, the station and the town square are synthetic; the content is invented.
- Exit does nothing.

## Not verified

- On a phone. Every number above is from desktop Chrome; touch on a real screen, the readability
  of 12 px text in daylight and the flight's comfort are untested.
- The first repaint after a tap measured 8 to 80 ms in headless Chrome with software WebGL on a
  busy machine, later ones 0.1 to 0.4 ms; the cause was not found, and a phone measurement is
  needed before calling the unfold free of long frames.
- The hysteresis band on a slow walk (computed, not walked).

## Cost

The settings panel shows the frame's work time (average and maximum), the longest gap between
frames, the frames over 50 ms since load, the draws and triangles of the two pins (8 draws and 356
triangles folded, 9 and 380 with a card away, including the overlay quad), the card repaints since
load with their average and maximum time, and the size of the docked card's text. A card repaints
only while it unfolds or folds, or while its dot is tapped; standing still it repaints 0 times.
Software WebGL frame times mean nothing for a phone.

## URL options

`thr` (10, 12, 14, 16), `desc` (0.62, 0.8, 1), `read` (4, 8, 15), `away` (dock, edge), `fly` (0,
0.35, 0.6, 1.2), `hold` (0.15, 0.3, 0.6, 1), `hyst` (5, 10, 15), `angle` (35, 45, 60), `turn` (on,
off), `touch` (0, 8, 16, 24), `fs` (14, 16, 18), `text` (normal, longest), `stage` (auto, portrait,
landscape), `creator` (pin, screen), `at` (walk, d2, d4, d8, d15, side), `open` (a, b), `voice`
(on).

## Files

- `index.html` - the page, its demo strip and the settings panel.
- `pin-opens.js` - the scene, the measuring, the places, the taps, the beats and the cost readout.
- `kind.js` - the pin as an item kind: its measures, its record reader and its world view (one card
  texture that folds and unfolds).
- `pin-opens.css` - the styles, from the 6.2 page.
- `sample.json` - two pins, plus a pin with the longest caption and description.
