# Travelling surface A - The bubble travels

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in. It carries the "one box that travels" of the sign speaks 6.2
page (`../sign-speaks-r6-2-travelling-box/`) over to a character's speech bubble.

## The idea

A character's speech bubble is one object that lives in two places, never both:

- **Beside his head.** While the bubble can be read (its letters at least the legibility threshold
  tall on screen), is in view and he stands within the open distance, it hangs by its tail beside
  his head, slid onto the screen as in the app, the tail's tip staying at his head.
- **Docked.** Otherwise the same texture flies down to the bottom centre and becomes the box: its
  tail shrinks into the bottom edge during the flight, so the box arrives without one. When the
  bubble can be read again it flies back and the tail grows out again.
- **A story step's choices travel inside the same surface.** When his line ends with a question,
  two buttons open under the words. Buttons are tap targets, so a second gate checks their size on
  screen (40 / 48 / 56 px): beside him they are too small, so the surface flies to the box, where
  the buttons are as tall as the gate. After the choice his reply plays (the choice was a tap) and
  the surface flies back once the buttons are gone.
- **Who speaks:** his name in his colour heads the surface in both places, the surface's edge has
  his colour, and his name tag over his head says "speaking" while the words are docked. His mouth
  moves while his voice plays.
- **Two figures, one dock.** The figure whose voice runs owns the surface (one voice at a time, a
  tap wins). The other figure folds to its name tag ("tap to hear", "paused", "heard"); a tap on it
  hands the surface over. With nothing running, the last figure still holding a voice (paused
  mid-line, or waiting for a choice) keeps it, else the nearest. "Last tapped wins" is the
  alternative knob. No stack, no list.
- **One pick for the whole tour.** The "Words, whole tour" pill is the visitor's one pick where
  spoken words show (by the speaker / in the box), for every item; it wins over the creator's
  choice until "reset my pick".

Controls are round 5's only: tap the words to pause or play, drag them up or down to scrub (read
from the finger's screen motion, never by hit-testing the moving bubble again). A tap on the figure
or his tag also plays or pauses him. Nothing sounds without a tap.

## What to look at

- **7 m** (the opening): his bubble beside his head with greyed words and "tap the words to
  listen". Tap them.
- **14 m** (with the voice playing): past the 9 m open distance the bubble flies down and docks;
  "7 m" brings it back.
- **Walk up**: from 28 m (outside the 20 m station) to 4 m. Under 9 m the bubble opens; with
  "Docks: always" the box waits at the bottom until then and flies up.
- **Edge**: he stands near the edge of the view; the bubble hangs on the side toward the middle.
- **Turn away** and **Turn back**: once his voice was started, the words dock while he is out of
  view and fly back.
- **Pause, scrub**: a simulated finger taps to pause, drags two lines back, taps to play.
- **Choose**: his question ends, the buttons open, the surface flies to the box, a finger picks
  "Show me the oven", the reply plays and flies back.
- **Two speak**: the ferry keeper joins, 12 m away (so the box is in use); the baker speaks, then a
  finger taps her tag and she takes the box.
- **End**: jumps to the last sentence of the line.

## Knobs (settings panel, and URL options)

- `thr` legible from 10 / 12 / 14 / 16 px (default 12); `gate` tap target 40 / 48 / 56 px (48).
- `open` open within 9 / 15 m / none (9).
- `holder` who has the box: `voice` (the voice that runs, default) / `tapped` (last tapped wins).
- `docks` `started` (only once his voice was started, default) / `always`.
- `who` one / two figures; `text` normal / longest line.
- `fly` flight 0 (off) / 0.35 / 0.6 / 1.2 s; `settle` hold before moving 0.3 / 0.6 / 1 s;
  `hyst` hysteresis 5 / 10 / 15 %.
- `fs` box text 14 / 16 / 18 px; `grow` the bubble grows past 2.4 m on / off.
- `shake` hand shake while a finger is down; `sound` tone / silent; `stage` window / upright /
  sideways; `creator` by the speaker / in the box; `at` the opening (d3, d7, d14, walk, edge);
  `autostart` plays at once.

## Where the bubble docks (measured, the dock table in the panel)

Head-on, at the middle of the view, from the projection the page uses. The bubble grows with
distance past 2.4 m as in the app, so its letters keep one size on screen there: 13.2 px on an
upright phone (about 42 degrees across), 10.9 px sideways (50 degrees top to bottom).

- **Upright phone:**
  - 10 and 12 px: the letters stay readable to the station edge, so the open distance alone
    decides: docks from 9 m / 15 m / never.
  - 14 px: docks from 2.3 m; 16 px: from 2.0 m, whatever the open distance.
  - The choice buttons are 36 px beside him past 2.4 m: they reach 40 px only within about 2.2 m,
    48 px within 1.9 m, 56 px within 1.6 m. A story step's choices therefore dock at any normal
    standing distance.
- **Sideways phone:** 10.9 px letters, so at 12 px the bubble docks from about 2.2 m: sideways, the
  words are in the box almost always.
- **Bubble growth off:** at 12 px the bubble docks from 2.6 m upright.
- What would reverse it: a threshold of 14 px or more makes the bubble a near-only thing (under
  2.3 m); a bubble drawn about 10 % bigger in the world (or a narrower field of view) would keep a
  12 px rule from docking sideways.

## Values chosen at one point

- **Hold 0.3 s, hysteresis 5 %,** a 0.6 s lock after a finger lifts (the surface never moves under
  or just after a tap), and the flight 0.6 s: as 6.2, all knobs except the lock.
- **The surface is "in view"** while at least 92 % of it is on the screen (85 % to stay).
- **The tail's tip** hangs 0.1 of his height to the side of his head (the app: 0.16); the bubble's
  side is the one toward the screen's middle unless that would cover a face.

## Weaknesses seen in the screenshots

- **In flight the surface can pass over his face** for a moment, when he stands in the middle of the
  view (the straight path from the dock to the bubble crosses him). At rest the bubble never covers
  a face: the readout's face check and the "frames with a face covered" count say so.
- **Sideways with the choices open**, the docked box takes more than half of the screen's height (56 %
  with 48 px buttons, 65 % with 56 px) and covers a figure standing in the middle of the view. A corner dock would avoid it, but the dock is
  bottom centre by decision.
- **With both figures in view**, the baker's bubble can hide part of the ferry keeper's name tag.
  Laying labels out around each other is not part of this prototype.

## Faked

- The voices are soft generated tones, one note per word, on times invented from the letters.
- The figures are drawn stand-ins (no photo of anyone); the square, the camera and the walk are
  simulated; nothing runs in AR. The sideways drag stands in for turning the phone.
- The story is invented. There is no story panel: in a story step this surface is where his line and
  the choices show.

## Not verified

- On a phone in AR: whether the flight reads as one object travelling, and whether a 13 px bubble
  letter is readable outdoors.
- Frame times: the screenshots ran on a software renderer (SwiftShader); its frame times say
  nothing about a phone.
- Whether a visitor finds the name tags as the way to hand the surface to the other figure.

## Cost

The settings panel shows the cost once a second: frame work (average and max), the longest gap
between frames, the count of frames over 50 ms, the item's own draws and triangles (figures, tags,
the bubble, and the overlay quad while docked or flying), the texture repaints per second and the
surface paint time. The surface repaints only when its words, scroll, hint, choices, tail or side
change; while nothing moves it repaints 0 times a second.

## Files

- `kind.js` - the item kind (read, assets, fields, world): the figures, their name tags and the
  one speech surface with its canvas.
- `sample.json` - the baker (a story step with two choices, and a longest line) and the ferry
  keeper (a free figure).
- `bubble-travels.js` - the page: the scene, who holds the surface and where it goes, the flight, gestures and
  beats.
- `bubble-travels.css`, `index.html`.
