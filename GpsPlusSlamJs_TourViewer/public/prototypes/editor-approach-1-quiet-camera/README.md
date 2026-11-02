# Approach A - The quiet camera

Throwaway UX prototype for the 3D tour editor's approach on opening a tour
(from the globe down to street level over the tour). Linked from nothing in
the app; nothing is saved; all loading is faked.

## The direction

The flight itself is the progress indicator: there is no bar and no
percentage, the camera's pace tells the story - it eases down while data
arrives, and when it has to wait it slows and gently circles the place
instead of stopping. One small line of plain text at the bottom of the view
says what is happening and roughly how long it will take, with a quiet
reminder that dragging, scrolling or any key takes over; arrival is marked by
the stations dropping in and settling, then the walk between them drawing
itself.

## What it optimises for

- Calm: the scene stays the centre of attention, like a documentary shot.
  No modal, no panel over the chrome, no alarm colours.
- Never looking stuck: whenever the camera is held by missing data it keeps
  moving (a slow circle plus a slight breathing tilt), and the text line
  names what it is waiting for.
- Honest landings: the camera lands once the landscape is in and enough of
  the town to work in; unfinished parts are shown as faint footprints where
  buildings will appear, and the line says they are still coming.
- Instant takeover: any pointer, wheel or key input (anywhere outside the
  prototype controls) stops the flight where it is, and the first drag
  already moves the camera. "Back to the tour" in the text line (and View >
  Frame the tour, key F) brings the camera back; View > Fly in again replays.

## What it gives up

- A precise sense of progress: the only numbers are a rounded time phrase
  ("about 10 seconds", "about half a minute"); a creator who wants to know
  "how far along" gets words, not a measure.
- Discoverability of the takeover rests on one small line of text; a
  creator who never reads it may wait out a long flight.
- On a very slow connection the camera circles for a long time; the
  motion reassures, but it is still waiting, and the creator has to choose
  to take over.

## How the waiting cases look

- Fast / normal: one smooth descent, the line changes from "Flying to
  Freiburg" to "Coming down over Old Town Walk", then "Here is Old Town Walk
  - 6 stations", then "Everything is loaded" fades away.
- Slow network: the camera slows and circles at each stage it has to wait
  for (high above the region, a few km up, low over the town); the line says
  "Waiting for the landscape - the connection is slow" with a time phrase.
  The ground visibly sharpens as the landscape arrives. It then lands with
  the town partly built and fills in the rest around the creator.
- City never finishes: lands normally; the missing outskirts stay as faint
  footprints; after a few seconds without progress the dot turns warm amber
  and the line says "Some buildings are slow to arrive - they will appear on
  their own. Everything else is ready".
- One source fails (the hill shapes): the camera circles high up with "The
  hill shapes are slow to answer - trying again", then gives up on them,
  says the ground will be flat and flies on; after landing an amber line
  offers "Try again".
- Restored draft: no flight, straight to the tour ("Your draft is back where
  you left it").

## Files and flags

- `index.html` - the page: static editor chrome (top bar, station rail,
  inspector, View menu), the view and the caption line, and a striped
  prototype-controls strip at the bottom that is not part of the design.
- `approach.js` - the fake globe (a ray-cast raster on a 2D canvas), the
  town, the stations, the fake loading and the flight. No libraries.
- URL flags: `#sc=fast|normal|slow|never|fail` picks the case, `&x=3` runs
  the clock three times faster, `&draft=1` opens as a restored draft.
