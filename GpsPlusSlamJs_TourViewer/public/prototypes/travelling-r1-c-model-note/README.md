# Travelling surface C - The note comes to you

Throwaway UX prototype. Not wired to the app and linked from nothing in it; the gallery at
`../index.html` is the only way in. It takes the "one box that travels" of
`../sign-speaks-r6-2-travelling-box/` to the notes of a placed model (a `model` item in the
`hotspots` view).

## The idea

A placed model carries notes: short texts pinned to points on it, each shown by a small marker.
Tap a marker and the note's card opens beside its point, joined to it by a thin line. The card is
one object that lives in one of two places, never both:

- **In the world.** Beside the point, on the side the creator chose, at the point's height, turned
  to the visitor, while it can be read there: the point in view and facing the visitor, not hidden
  behind the model, the letters at least the threshold tall on screen, and the card and its point
  fitting on the screen together.
- **In the box.** Otherwise the same card flies to the box at the bottom centre of the screen and
  flies back when it can be read again. In the box a dashed line still points to its point when
  the point is on screen.

Controls follow where the card is. Buttons that small on a card in the world cannot be hit, so by
default (`btns=pull`) the card in the world has no buttons: a tap on it brings it close (to the
box), and in the box it has Previous, Next and "Back to its place". With `btns=gate` the buttons
stay on the card in the world when they are at least the touch gate on screen.

- One note open at a time. Markers stay visible; a tap on another marker switches the note, and
  the card flies from point to point.
- A note is never switched by where the visitor looks, there is no list of notes in the HUD, and
  no card stays behind once the model is out of reach: leaving the station closes the note.
- The bottom-centre box belongs to a voice while one plays. A card that would go there folds into
  its marker until the voice ends; a pull is refused with the tag "the voice has the box".
- The "Words, whole tour" pill is the visitor's one pick for every stop (in the world / in the
  box), stored under `tour-words-pick`; once made it wins over the creator's choice.
- Hold 0.3 s before a move, 5 % hysteresis on every limit, no move while a finger is on the card
  (and 0.6 s after it lifts), nothing on screen outside the station, nothing sounds.

## What to look at

- **Walk up**: from outside the station to 4 m; then a simulated finger taps the lion spout's
  marker and its card unfolds from it.
- **4 m, 7 m, 11 m**: the same note at three distances. At 4 m it is in the world; at 7 m and 11 m
  the letters are too small and it is in the box.
- **Round**: opens the basin's note and walks half way round: the card leaves for the box as the
  basin turns away, and the tag says why.
- **Pull**: taps the card in the world; it comes to the box with its buttons.
- **Next**: switches to the next note; the card flies from point to point.
- **Far**: opens the note on the back of the fountain from the front: the box, tag "on the far
  side".
- **Turn**: turns away from the fountain and back: box "out of view", then back to the world.
- **Voice**: another stop's voice takes the box; the card folds into its marker until it ends.
- **Back**: "Back to its place" closes the note into its marker. **Leave**: walks out of the
  station; the note closes and the markers hide.
- Drag sideways on the view to look around.

## Knobs (settings panel, also URL options)

- `thr` legible from 10 / 12 / 14 / 16 px (12)
- `letter` letter height in the world 6 / 8 / 10 / 12 cm (10)
- `measure` card width 14 / 17 em (14)
- `btns` buttons in the world: `pull` (a tap brings it close) / `gate` (on the card) (`pull`)
- `gate` touch gate 40 / 48 / 56 px (48)
- `face` faces away past 45 / 60 / 75 / 90 deg (75)
- `hold` hold before moving 0.15 / 0.3 / 0.6 / 1 s (0.3)
- `hyst` hysteresis 5 / 10 / 15 % (5)
- `fly` flight 0 / 0.35 / 0.6 / 1.2 s (0.6)
- `stage` phone `auto` (the window) / `portrait` / `landscape`
- `creator` the creator's choice `world` / `screen`; "reset my pick" clears the visitor's pick
- `at` start beat: `d4` (default), `walk`, `d7`, `d11`, `round`, `far`

## Measured (headless Chrome, the page's own range sweep)

The sweep puts the camera on each note's horizontal normal from 0.5 to 15 m and reports the range
where the card is in the world, as "near..far/keep": "keep" is the far end once the card is already
in the world (the hysteresis). Columns are the basin, the lion spout, the upper bowl and the
pinecone; "-" means never. `__note.sweep([0, 1, 2, 3])` in the console repeats it.

- **Phone portrait (390 x 844), 14 em, buttons pulled, threshold 12 px:**
  - letters 6 cm: 1.5..2.2, 1.7..2.4, 1.6..2.2, never
  - letters 8 cm: 2.0..3.1, 2.1..3.2, 2.0..3.1, never (kept up to 2.2)
  - letters 10 cm: 2.4..3.9, 2.6..4.1, 2.5..3.9, 2.0..3.2 (kept up to 4.2 / 4.3 / 4.2 / 3.5)
  - letters 12 cm: 2.9..4.8, 3.0..4.9, 2.9..4.8, 2.3..4.3
- **Threshold at 10 cm letters, portrait, 14 em:** 10 px reaches 4.8 m, 12 px 3.9 m, 14 px 3.3 m,
  16 px 2.8 m (the lion spout about 0.1 m further each time). At 16 px the pinecone is never in the
  world.
- **Card width:** 17 em moves the near end out by about 0.5 m in portrait (2.9 m against 2.4 m at
  10 cm) and leaves the far end alone. The near end is the screen width: closer than it the card
  and its point no longer fit on the screen together.
- **Buttons on the card (`btns=gate`), portrait:** at 17 em never with a 48 or 56 px gate. At 14 em
  with a 40 px gate and 10 cm letters 2.4..2.6 m; with 48 px only the lion spout, and only
  kept up to 2.4 m once there; with 56 px never. So on an upright phone the buttons almost never fit on a
  card in the world, which is why pulling it close is the default.
- **Phone landscape (844 x 390)** is not width bound: near ends 0.5 to 1.3 m. At 14 em, 10 cm,
  12 px: 0.8..3.1, 1.0..3.3, 0.8..3.1, 2.0..2.1 m. Buttons on the card with a 48 px gate: 1.0..1.5 m
  to 1.0..1.8 m, with 40 px up to 2.2 m.
- **The pinecone** (high on the fountain, seen from below) has the narrowest range everywhere.
- **What would reverse the default:** a 12 cm letter height and a 40 px gate give the buttons on
  the card from 2.9 to 3.3 m in portrait; anything less and the card in the world is read-only.
  A 10 px threshold almost doubles the range in the world; 16 px halves it.

## Cost

The settings panel's "Cost" line: frame work avg and max, the longest gap between frames, frames
over 50 ms since load, this item's draw calls and triangles, card repaints (count and time), and
the box's text and button size. In headless Chrome with software rendering: frame work avg 1.4 ms,
max 3.0 ms, 13 draws, 828 triangles for the item (17 for the frame), card repaints 0.7 ms each,
11 over a walk, Next and Round; box text 20 px, buttons 48 px. Frame gaps measured with software
rendering mean nothing; measure on a phone.

## Faked

- The model is a generic fountain built from simple shapes; the notes are made up
  (`sample.json`).
- Camera, square and walk are simulated; nothing runs in AR. The camera turns to the open note by
  itself, as a visitor would.
- The other stop's voice is a silent box.
- "Back to its place" closes the note here; in the app the same words reset a model the visitor
  moved.

## Not verified

- Anything on a real phone: letter sizes against real eyes, touch on a card in the world, the
  frame time.
- The phone's camera field of view is an assumption (42 deg across in portrait, 50 deg in
  landscape), and every range above scales with it.

## Files

- `index.html`, `model-note.css`, `model-note.js`: the page, the simulated camera and the place
  decision.
- `kind.js`: the item's world half (the model, the markers, the card painting), built to the item
  module rule: `read(record)`, `assets()`, `fields()`, `world(block, env)`.
- `sample.json`: the synthetic record.
