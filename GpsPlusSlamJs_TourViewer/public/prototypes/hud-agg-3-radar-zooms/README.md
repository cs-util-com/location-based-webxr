# H-C - The radar zooms into the station

A throwaway HUD prototype for the visitor's AR view. It is one self-contained page (`index.html`, three.js 0.185.1 from a CDN by import map). It is not wired to the app.

## The direction

No new layer: the radar the walk already has becomes the one instrument for everything around the visitor.

- **Outside a station** the radar shows the stations around you, as on the walk today. The next station is orange.
- **On arrival it zooms in** (about 1.2 s): the station's dot grows into a dashed boundary near the rim. The station's things appear as small marks at their true bearing and distance, heading-up, on a square-root scale of 35 m.
  - Each mark is a kind symbol in a disc: pin, model, picture, film, narration, story.
  - Its state is drawn on the mark:
    - a white pulse: waiting for you;
    - teal with turning arcs: playing;
    - a teal rim with a pause badge: paused, carries on when you return;
    - grey with a check: seen or finished;
    - orange "?": the story has a question;
    - an orange ring: your focus.
  - The view cone shows what is in view now.
  - A near-start film draws its reach as a dashed ring around its mark, so "walk into this ring" is read from the map.
- **Off-screen and behind** are found by a glance at the radar. Inside a station there are no edge markers at all, apart from the one arrow to the one focus.
- **A tap on a mark sets the focus.** You get one beacon in the world, one arrow at the screen edge while the focus is out of view, and one line under the radar that names that one thing and its one action ("Market day, 1952 · walk closer · 4 m"). A tap on the focused mark clears it.
- **Standing in a narration's circle**, its light is at your feet, out of view. The line under the radar then becomes a button ("The fire of 1890 · tap here to play"). Tap stays the floor; nothing starts by nearness except the film that was authored to start near.
- **Leaving the station zooms back out.** The station becomes a teal check and the line under the radar says "Next: The tower · 97 m".
- **Items of the station you are in, against a station you are not at:**
  - Outside, a station is one numbered dot and its things are not on the radar at all.
  - Inside, its things are marks.
  - In the world, the things of the station you are in get their glow, labels and notes; from outside they are only objects.
  - The next station appears inside a station only as an orange notch on the rim, and only once the station is done.

## Ranking rule

- **The radar never ranks.** Every thing of the station is a mark at once, so nothing competes for a place on screen and nothing pops when another thing changes rank.
- **The line under the radar** names one thing at most, in this order:
  - a weak position ("Position weak · tap what you see");
  - the focus (the thing you tapped, or the circle you stand in);
  - "Station done · next: The tower, on the rim", for 6 s;
  - a first-time hint ("Tap a mark to find it").
- **The bottom slot** holds one thing, in this order:
  - a story step: the story wins the screen;
  - a text you tapped open (pin, picture, model);
  - the newest thing playing, as a small chip with pause.
  - While a story step is on screen, the radar's item marks fade to faint grey and stop pulsing. Free things keep only their look and glow in the world.
- **The quiz enters as a story step** in the bottom card: "Marta asks · 10 points", the question, four answer buttons.
  - The narration pauses; it carries on when the card closes.
  - Every other mark fades; the guide's mark turns into an orange "?" with the focus ring.
  - The beacon moves to the guide, and the one arrow points there.

## A 7th and an 8th thing

The demo panel's "Add a 7th and 8th thing" adds an ambient fountain and a second pin. They are two more marks, and nothing else changes.

- Marks that would touch push apart (the "you" dot is an obstacle too), so their bearing stays roughly true.
- A thing farther than the zoom sits on the rim with an outward notch.
- Ambient sound never claims the bottom slot.
- Past about 12 marks, 148 px is too dense; the zoom would then have to step in. This page does not build that.

## How it differs from the earlier audio "horizon"

The horizon was a second instrument, a compass strip across the top, for sounds only. This is the same radar the visitor already reads on the walk, for every kind of thing. It never adds a second instrument: it changes scale.

## What it changes in today's walk layer

- The radar stays, and inside a station it zooms in instead of showing stations.
- The walk sheet is not shown inside a station. Its peek returns as the line under the radar ("Next: The tower") once the station is done or left.
- The focus pill and the HUD's station arrows are gone inside a station; one arrow points to the one focus.
- The precision chip becomes the size and colour of your dot on the radar (blue, or a wide amber blur when weak), plus the line when the position is weak.

## Thresholds the page sweeps (demo panel)

- Zoom range: 25 / **35** / 50 m.
- Radar size: 132 / **148** / 176 px; landscape uses 80 % of it.
- Close after leaving a place: 1 / **1.5** / 2 s, with 1 m of hysteresis.
- Waiting marks: **pulse** / steady.

## The strongest case against it

- **It asks the visitor to read a map** at 148 px, in daylight, to learn that something is behind them. Someone who never looks up to the corner misses everything off screen, because the screen edges are silent by design.
- **The radar alone costs about 5.8 % of a 390 x 844 screen** (Exit included). It already uses the whole "about 5 %" mid-walk budget before anything else shows; at 132 px it is about 4.7 %.
- **Marks are small to tap one-handed.** The tap area (26 px) is larger than the drawing, but two marks close together are still fiddly.
- **A weak position makes the map's promise hollow.** The marks freeze where they were (only the heading still turns them), and the visitor must trust a picture that no longer moves with them.

## How to try it

- Drag to turn, swipe up to walk (or W/A/S/D).
- Tap a mark on the radar, or a thing in the world.
- `‹` `›` step through the 8 beats; `▶` plays them all.
- The strip at the top shows the measuring hook: HUD footprint, element count, overlaps (red outlines on the page).
- The demo panel (☰, or beside the phone on a desktop) has the beats, the sweeps, a per-beat table and this text.

URL options: `?speed=2` runs time faster; `?shots` pauses each beat at its screenshot moment (`HC.resume()` continues).
