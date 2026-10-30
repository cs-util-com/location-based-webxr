# Editor approach, prototype B - the arrival board

Throwaway UX prototype for the 3D tour editor's approach on opening a tour.
Not wired into the app, linked from nothing in it.

## The direction

While the camera flies in from space, the editor's left rail (where the
station tree normally sits) shows an honest progress panel: the flight's
phase (Space, Region, Town, Street), a landing estimate, a "Take over now"
button, and a plain-words list of what is being prepared (the ground,
streets and paths, buildings, your stations), each with its own state. On
arrival, or at the first input, the panel turns into the station tree and
keeps a compact "still loading" strip at its top until everything is in.

## What it optimises for

- Honesty and legibility: the creator can always read what is happening,
  what is still coming and roughly how long, in words, never a bare spinner.
- Actionable trouble: slow network, a part that never finishes and a part
  that fails each get a short notice saying what it means for the creator
  and what they can do (take over, try again, carry on without).
- A clean view: the 3D view itself carries no overlay; the camera never
  waits motionless (it circles while the ground arrives and keeps creeping
  lower as it loads).
- Continuity with the editor: the information lives where the stations
  will be, and the stations simply take its place.

## What it gives up

- Glanceability from the view: a creator watching the flight, not the rail,
  sees no text; the only in-view cues are the town filling in and the
  floating station pins settling. The rail must be noticed.
- Space: on a phone in landscape the rail is narrow; the board drops its
  captions, the phase names and the "Jump straight to my tour" link (F and
  the View menu still do it), notices use a one-line text, and the
  inspector folds away.
- Drama: it is an informative, calm board, not a cinematic arrival.

## How the waiting states look

- Normal: rings fill per item; the phase bar walks Space to Street; "You have
  arrived - everything is ready" for about two seconds, then the tree.
- Slow network: items read "45% - slow" with "about 40 s more"; the flight
  circles over the town ("Circling over the town until the ground is
  ready") and an info notice offers "Take over now" or "Keep watching".
- City never finishes: buildings stop near 83%; after a few seconds the item
  reads "Taking long" and the strip offers "Try again"; retrying repeats the
  stall and the text says so.
- One source fails: an amber notice ("Streets and paths didn't load", or the
  ground, or the buildings) explains the consequence and offers "Try again"
  or "Carry on without". A failed ground lands on a flat map.
- After any input: the panel becomes the tree at once, with "You are in
  control now. Loading carries on in the background." and, when the camera
  is far away, "You are far from your tour - Take me there".

## Interaction notes

- Any pointer press, wheel or key outside the board and the debug strip
  interrupts at once and is applied (the first drag already pans). The
  board's own buttons and scrolling the rail do not count as taking over;
  that reading of "any input" is a question for the owner.
- Drag pans, right- or shift-drag turns and tilts, wheel or pinch zooms,
  arrows/WASD pan, Q/E turn, +/- zoom, F frames the tour.
- View menu: "Replay the arrival flight", "Go to my tour", "Show what is
  still loading".
- Debug strip (bottom, purple, not part of the design): network speed,
  which source fails, "Open the tour again", "Restore a draft (no flight)".
  URL flags: `#net=fast|normal|slow|never|fail` and `&fail=ground|streets|buildings`.

## Credits

Original code, 2D canvas only, no libraries. The map look imitates the
general style of a standard street map, drawn procedurally. All places,
stations and data are invented.
