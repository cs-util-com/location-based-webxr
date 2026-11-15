# The world says it (HUD aggregation, direction D)

A throwaway prototype. One self-contained page (`index.html`, three.js 0.185.1 from a CDN by import map), not wired to the app.

## The direction

The screen stays almost empty. The HUD is only:

- **Exit**, top left;
- **one subtitle line** at the foot, for the words that must be read (the story, captions, a hint you asked for, what waits out of view);
- **one panel**, and only when you tap something that has text or a picture (a pin's note, the old picture, the quiz's answers). While the panel is open, the subtitle line is hidden, so nothing stacks.

Everything else is said by the place, with one grammar shared by every kind of item:

- **gold sparks rising**: something waits for you here; a small sign over it says what kind of thing it is (no text);
- **a ground glow that fills as you come closer**; full and pulsing means "you are there, tap it";
- **teal swirl**: playing; still teal: paused; **grey**: seen;
- **one orange thread** on the ground from your feet to the one thing that matters next, and an **orange column** over a station;
- **embers**: the items of a station you are not at are small embers on the ground (amber unseen, grey seen). On arrival they open up into sparks one by one; on leaving they fold back.
- Inside a story circle, its sign comes to you: it floats a step ahead at chest height, so it can be tapped while you stand in the middle of it.
- What is out of view is told by **a short chime from its side** (muffled when it is behind you) plus one subtitle line ("Behind you: an old picture is waiting"). Only for the one thing the thread points at, never a list. An optional edge glint (a knob, off by default) shows the same one thing at the screen edge.

What it changes in today's walk: the radar, the walk sheet and the focus pill go. The thread and the station's column replace them; walk news goes to the subtitle line. The station list ("Can't get there?") is not on this page.

## Ranking rules

**The subtitle line (one slot):**

1. What you opened yourself (a panel then takes the line's place).
2. The story, a quiz step included. While the story speaks, free items speak only through their look in the world.
3. The captions of the one thing whose voice you hear: the newest you started. Another one plays on quietly in the world.
4. What the place tells you: out of view, rough position, walk news. These wait their turn silently and drop after 15 s unshown.

**The thread:** the station you walk to; inside a station, the question while the story asks; else the thing you tapped and have not reached; nothing while something plays near you; else the thing the story pointed at. It changes only on an event (a tap, a start, a story step), never because something became nearer, and it fades out and in rather than jumping.

**Starts:** tap is the floor. A near-start film starts by itself only for a visitor who walked into its reach (more than 1.5 m in the last 5 s); a standing visitor taps. A tap from too far says "Walk closer · 4 m ... or tap again to start it here", so a second tap always works. With a rough position, a tap starts it at once and no distance is shown.

**A seventh and an eighth item** join the same grammar. At most three waiting things raise sparks at once (the thread's target, what plays, the nearest in reach, then the order they had when you arrived); the rest keep only their ground glow and sign. The "Items: 8" knob adds a bench story and a second pin.

## The fixed demonstration

Eight beats, stepped with the arrow in the dashed demo bar at the top right (dashed means "demo chrome, not part of the design"); `?beat=N` opens a beat. Beats 2 and 8 run faster than real time and say so.

1. Arrive (embers open into sparks, "Arrived", the story greets).
2. Stand still 20 s (the story points behind you; a chime from behind; nothing starts).
3. Turn a full circle, then tap the pin (its panel opens).
4. Walk to the film (a tap from 9 m: "Walk closer · 4 m"; the glow fills; the film starts on entering its reach; the pin's panel closed when its place was left).
5. Into the story circle while the film plays (tap: the story's voice and captions win, the film plays on quietly; stepping out pauses it, stepping back resumes it).
6. The story asks (gold flame over the well, the question in the subtitle line, everything else dims; the panel with four answers opens on a tap; a wrong then a right answer).
7. Position weak (no distances, the ground glows stop filling, the thread shrinks to an 8 m direction; a tap on the far model lights its notes, a tap on a note reads it).
8. Leave for the next stop (the thread swings to the next station's column, the station folds into embers, "Next: The Old Gate · 36 m").

The measuring hook (top right, under the demo bar): HUD footprint (share of the view covered by HUD boxes), HUD element count, overlapping HUD boxes (outlined red), and **world cues**: the share of the view covered by guidance in the 3D scene, occluded by the square. The info page ("i") has the numbers per beat, the knobs, and the slowest recent frame.

Knobs: sparks at once (2 / 3 / all), read time, leave margin (0.5 / 1 / 2 m), edge glint, 6 or 8 items, position good or weak, sound.

## The strongest case against it

- **A world cue lies when the position is rough.** A glow says "here" at the wrong place, up to 25 m off; a HUD that says "nearby" is vaguer but does not lie. This page shortens the thread and stops the glows filling, but the sparks still stand where the position puts them.
- **It is the walk guided in the world again (W2), now inside a station.** If the world cues are hard to see, this has nothing to fall back on. The near-empty HUD is partly bought by moving guidance into the picture: compare "world cues" with the HUD number. The difference to W2: W2 guided between stations; this governs the items inside one, and the subtitle line and the panel are real HUD, not a fallback.
- **Sunlight and noise.** Gold sparks on a bright, busy street may not be seen, and a chime does not reach someone in traffic or talking with friends.
- **Learning.** Nobody learns a grammar by being told it once; a first-time visitor may not know a sparkling thing can be tapped.
