# Editor approach 3 - Work while it flies

Throwaway UX prototype for the 3D tour editor's approach on opening a tour
(direction C). Standalone, linked from nothing in the app; the globe is a 2D
canvas, the map is generated and the loading is a timer.

## The direction

The editor is usable from the first second: the station tree and the
inspector are live during the flight (the tour itself is already loaded,
only the map is still coming), and a click on a station sends the flight to
that station instead of only stopping it. The flight is a small strip at the
top of the view (Space - Region - City - Street) with a moving marker and a
tick for each part of the map (landscape, streets, buildings, details);
missing parts are drawn as soft sketches that fill in from the tour's place
outwards, so nothing ever looks blank.

## What it optimises for

- No dead time: naming stations, writing texts and picking a station all work
  while the camera is still in space.
- One place that answers "how far along, how long, what is still missing":
  the strip (status line with a time estimate, ticks filling up, a pulsing
  tick for what the flight is waiting for).
- Control over the flight itself: drag the marker back to replay, forward to
  skip; click a stop (Street skips ahead, Space replays); "Replay" afterwards.
- Never stuck: when a part is late the flight slows to a crawl and circles
  (still moving, the waiting tick pulses, the status says what it waits for);
  after 12 s it goes on without it and lands among sketches.

## What it gives up

- Calm. A strip, ticks, sketches and chips are more to look at than a quiet
  fly-in; the first second is busier.
- Typing in the inspector and Tab through the chrome do NOT interrupt the
  flight (they are editing, not camera input); a key anywhere else, a drag, a
  scroll or a tap in the view does. That narrows the owner's "any input
  interrupts" to "any input aimed at the view" and needs his OK.
- A station click mid-flight redirects rather than stops, a second deliberate
  exception to "any input interrupts".
- The sketches are generic (graph paper, pale blocks, dashed contours), not
  the real shapes; they say "coming", not "what is coming".

## The waiting states (debug strip at the bottom)

- fast / normal: ticks fill and turn green as the marker passes them; the
  strip folds into a small pill ("All here", Replay) once everything is in.
- slow: the marker wobbles at a tick, that tick pulses, the status reads
  "Waiting for the streets (slow connection) - still moving in", the camera
  circles slowly; sketches shimmer where the map is missing.
- city never finishes: the buildings tick stops at 72 % (grey), the pale
  blocks stay beyond the built area; after a while a chip says it is taking
  unusually long and nothing needs to wait for it.
- one part fails: the buildings tick turns amber "!", the missing blocks get
  amber dashed outlines, a chip and the strip offer Retry.
- restore draft: no flight; only the small pill reports what is still loading.

Hidden URL flags for screenshots: `#net=slow&t=9` (profile, fast-forward the
clock), `&sel=3` (click station 3), `&draft=1`, `&user=1`.
