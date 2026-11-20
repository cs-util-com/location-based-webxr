# The sign speaks 6.2 - One box that travels

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in.

## The idea

The narration box of round 5 is one object, and this page lets it live in two places, never both:

- **On the sign.** While the reading sign can be read (its letters at least the legibility
  threshold tall on screen), is in view and is not seen from too far to the side, the box is a
  world plate hanging under the sign. The words are painted into the world, so they stay with the
  sign when the phone moves.
- **Docked.** Otherwise the same texture visibly flies down and docks at the bottom edge of the
  screen, centred, in the round 5 box's size. When the sign can be read again it flies back up.
- The box docks; it never follows the gaze. Turning the phone moves the plate with the world, and
  the dock is a fixed screen place.
- The visitor's own pick in the "Words" pill (on the sign / in the box) wins over the creator's
  choice; "reset my pick" in the settings gives the creator's choice back.

Controls are round 5's only: tap the words to pause or play, drag them up or down to scrub. No
ring, no speed chip, no floating control. Scrubbing works the same on the plate: once a drag starts
there, it is read from the finger's screen motion (one line height, as the line looked at the press,
per line of text and of voice), never by hit-testing the moving plate again.

## What to look at

- **7 m** (the opening): the plate under the sign with greyed first lines and "tap the words to
  listen". Tap them.
- **Walk up**: from 28 m, outside the 20 m station circle, the box is hidden; inside it the words
  wait docked until the sign letters reach the threshold, then fly up under the sign.
- **16 m** and **3 m**: at 16 m the plate is too small to read, so the box docks; at 3 m it is
  back on the sign.
- **65 deg**: seen that far to the side the plate is not read, so the box docks.
- **Turn away** and **Turn back**: the box docks while the sign is out of view and flies back
  after it returns.
- **Pause, scrub**: a simulated finger taps to pause, drags two lines back, then taps to resume.
- **No voice**: the voice file is missing; the words show a "no voice here - tap to read" line and
  a tap opens the whole text.
- **End**: jumps to the last sentence; at the end "the end - tap to hear it again".
- Tap the sign itself to open the whole text (the box hides while it is open; the text follows the
  voice there). Tap "AI voice" on the box to see who speaks.

## Knobs (settings panel, and URL options)

- `thr` legible from 10 / 12 / 14 / 16 px (default 12).
- `fs` box text 14 / 16 / 18 px.
- `fly` flight 0 (off: snaps) / 0.35 / 0.6 / 1.2 s.
- `grow` far sign grows on / off; `turn` sign turns to the viewer on / off.
- `shake` a small hand shake while a finger is on the words (to show the scrub reads the finger, not
  the plate).
- `sound` tone / silent; `text` normal / longest.
- `stage` window / upright / sideways.
- `creator` sign / screen.
- `at` the opening beat (walk, d3, d7, d16, side); `autostart` plays at once.

## Values chosen at one point, and what would reverse them

- **Legibility threshold 12 px** of letter height. 10 px keeps the plate at 16 m with growth on; 16
  px docks it already at about 7 m. The knob shows the whole range.
- **Hysteresis 5 %** and **a 0.3 s settle** before a change of place: without them the box
  flickers between the two places at the threshold distance and during a turn. A slower walk or a
  shakier hand may need more; the readout names the reason for every place.
- **Angle limit 60 deg** off the plate's face. With the sign turning to the viewer (default) the
  limit only matters with "Sign turns: fixed".
- **The 17 em line measure** is shared by the plate and the dock so the line breaks never change in
  flight. Round 5's box grows to 80 % of the width instead; here it is min(17 em, 80 % of the width,
  720 px), so with 18 px text on a 390 px phone the box text shrinks a little (the cost readout names
  the box text size).
- **Flight 0.6 s** with ease in-out. 0.35 s may read as a jump; 1.2 s as slow. The knob covers it.
- **Station circle 20 m**: outside it the voice pauses and the box hides; coming back resumes.

## Faked

- The voice is a soft generated tone, one note per word, on times invented from the letters. No
  recording.
- The camera, the square and the walk are simulated; nothing runs in AR. The sideways drag on the
  view stands in for turning the phone.
- The text is invented; the square is generic.

## Not verified

- On a phone in AR: whether the flight reads as one object travelling, and whether the plate is
  readable in sunlight at the threshold.
- Whether a visitor finds the scrub on the plate without being told.

## Cost

The settings panel shows the cost once a second: frame work (average and max), the longest gap
between frames, the count of frames over 50 ms, the item's own draws and triangles (sign, plate and
the overlay quad while docked or flying), and the time to repaint the words texture, which only
repaints when the words, the scroll or the hint change.

## Files

- `kind.js` - the item kind (read, assets, fields, world); the sign and its plate, with the shared
  words texture.
- `sample.json` - three records: normal, longest, and one whose voice file is missing.
- `travelling-box.js` - the page: the scene, the place decision, the flight, gestures and beats.
- `travelling-box.css`, `index.html`.
