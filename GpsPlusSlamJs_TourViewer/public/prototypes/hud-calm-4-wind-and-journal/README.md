# Calm HUD, round 2, direction 4: Call the wind, keep a journal

> **Partly carried on.** Its wind became the hint of round 3 ([classic disc](../hud-calm-r3-1-classic-disc/README.md), [compass band](../hud-calm-r3-2-compass-band/README.md), [ground ring](../hud-calm-r3-3-ground-ring/README.md)), named "Show the way" rather than "Call the wind".

A throwaway UX prototype, one self-contained page (`index.html`, three.js 0.185.1 by import map). It is not wired to the app and nothing in the app links to it.

## The direction

Nothing hints at what is left until the visitor asks. There is one way to ask: the wind button at the bottom right, which shows only inside a station.

- **One tap, one drift.** A tap sends one short drift of light motes along the ground. It runs from in front of the visitor toward the nearest item they have not seen yet, ends by itself, and never comes again unless asked. While it runs the button reads as pressed and cannot be fired again.
- **A direction, not a spot.** The drift stops 1.2 m short of a near item, and at most 9 m out (motes), so a far item gets a direction and never an exact position.
- **Where it goes:**
  - inside a story, to the story's next item (the story wins);
  - otherwise, to the nearest unseen item of this station;
  - when everything here is seen, toward the nearest other station that still has something unseen (it drifts toward that station's beam);
  - when everything everywhere is seen, a short swirl at the visitor's feet.
- **A target behind the visitor.** The motes start in view and sweep round the visitor's shoulder, so they never fly into the camera and the visitor turns to follow them.
- **No gesture.** A gesture was considered and rejected. In AR, a one-finger drag is how the demo looks around, and a swipe up from the bottom edge collides with Android's system gesture. A single control is the reliable form.

**The journal** opens from a small book button at the top left, next to Exit. It appears once the first station has been entered. It is an off-AR page over a paused view:

- the world stops, the voice pauses and the frame freezes;
- the veil behind it is solid, with no blur;
- the HUD is hidden while it is open.

It has one tab per visited station. Each page shows:

- an orange "There is more here." mark while anything of that station is unseen, and "You have seen everything here." once nothing is;
- the stories entered there, with the face colour of the person each began with, and whether it was heard to the end;
- what was seen, in the order it was seen, each with its kind, how it was seen and its landmark ("You watched it to the end, on the west side").

It never shows a count and never names an unseen item. On leaving a station, the book button lifts once, the same whatever is left: a page was written. It is never a badge.

**Station A, "The Well":** one story, "Water for the town", which begins with Greta. She greets the visitor once on entering the station. This is the one deliberate start by arriving, once per visit, and in that greeting she says once that the wind can be called.

**Station B, "The Old Gate":** three people stand where their stories begin (Anton the mason, Mira the merchant, Jakob the watchman). Tapping one enters that story. This replaces today's built picker of story titles: the choice is made by walking up to a person, not from a list.

The words stand in 3D, in a speech bubble over the person's head. The bubble always faces the camera, keeps a steady size on the screen, and the words appear word by word. The browser's speech voice can read them aloud (on by default, a knob in the info panel).

## What "seen" means, per kind

- **A person:** their first words have played to the end.
- **A short text, a picture:** it has been near the middle of the view, within reading distance (6 m for a sign, 9 m for a picture), for 1.5 s.
- **A long text:** its last page has been shown (a tap turns the page).
- **A film, a sound:** it has played to its end.
- **A model:** it has been tapped and its note has opened.

## The drift: three looks, and the values

Choose one with `?drift=motes` (the default), `?drift=leaves` or `?drift=trail`, or with the knob in the info panel.

- **motes (default)**
  - 64 motes over 3.0 s, at 2.4 m/s, reaching at most 9 m;
  - they start 1.8-3.8 m ahead, across 1.7 m to each side, at 0.2-0.8 m high;
  - each mote is 7 cm, with a warm white core fading into a soft amber edge;
  - per-mote life is path length / speed, clamped to 1.0-2.75 s, with staggered births;
  - each mote eases in and out along its path (smoothstep), so the drift gathers in view for its first half second before it leaves toward the target;
  - each fades in over 0.22 s and out over the last 38 % of its life, and the whole drift fades over its last 0.45 s.
- **leaves:** 26 leaves (about 12 cm, ochre and rust) over 3.2 s, at 2.0 m/s, reaching at most 8 m. They tumble and flutter 22 cm sideways.
- **trail:** 52 motes over 2.4 s, at 3.2 m/s, reaching at most 11 m, starting within 0.35 m of one line. It reads as a single stream.

**Why the motes are the default:**

- **Readable.** Spread across the lower view, they read as "over there" within the first second. The amber edge keeps them visible on bright paving in daylight, where a pure white or additive glow vanishes. A first version had a dark brown rim, and it read as coins on the ground, not as light.
- **Short enough.** 3 s is long enough to turn and follow, and short enough that it is over before it feels like a cue that stays.
- **Not too insistent.** 2.4 m/s is a brisk walk, so the eye can follow without the drift feeling like an arrow.

**The other two have their own weaknesses:**

- **Leaves** look most natural, but they are sparse and darker. On grey stone they are the easiest to miss.
- **The trail** is the most precise. It is also the closest to an arrow drawn on the ground, which is the thing this direction tries not to be.

## What the HUD holds

- **Exit**, always, at the top left.
- **The journal**, next to Exit, once a station has been visited. It is the direction's own addition. The justification: it is the only place that says "more here", and only when opened. So no cue is ever on the screen unasked.
- **The radar**, at the top right, with stations only: orange dots at their true bearings, heading-up, on a square-root scale to 120 m. Inside a station it shows that station's edge as a ring.
- **One transport button** (pause/play with a progress ring), bottom centre. It shows only while something of this station plays or was paused from it, so a film can be paused while turned away from it.
- **The story chip**, bottom left, while a story runs. It shows the face colour of the person the story was entered through, its title and a leave button.
- **The wind**, bottom right, only inside a station. It is the direction's other addition: one fixed control that waits to be asked, in place of any cue that is always on.

The chip, the transport and the wind share one row and are never stacked. The dashed controls at the top right (beats, info, ruler) are demo chrome, not part of the design, and are not measured.

## How each never-list item is avoided

- **A list of the station's items in the HUD:** none. The journal lists only what was already seen, off-AR, over a paused view.
- **Per-item markers on the HUD or the screen edges:** none. The drift is in the world, on the ground, and lasts 3 s.
- **A floating icon over every item by default:** none. The items are plain objects. The sound's particles are the item itself, not a marker.
- **A HUD whose content follows the gaze:** the HUD never reacts to where the visitor looks.
- **A HUD label for a station:** none in AR. The station's name appears only in the journal, which is off-AR.
- **Approach sounds:** none. The voice speaks only Greta's greeting (once), a story's lines (when entered) and a person's reply (when tapped).
- **Aim-to-ask:** asking is a tap on the wind button, never a crosshair dwell.
- **A 2D copy of a text that stands in 3D:** the words exist only in 3D. The journal names a seen item and its landmark, never its text.
- **Radar marks drifting from their true positions:** the radar shows only stations, drawn at true bearings and never pushed apart.
- **A card outliving its place:** a bubble belongs to its person and goes when the line ends or the station is left. A model's note fades beyond 9 m. The drift ends after 3 s, and leaving the station stops it at once.
- **Two stacked panels:** the journal hides the HUD while it is open. The chip, the transport and the wind sit in one row.
- **Anything starting by nearness alone for a visitor standing still:** at B the people only turn towards a visitor who comes near. Only Greta's greeting starts by arriving, once per visit.
- **A hint the app volunteers repeatedly:** none is volunteered. Greta mentions the wind once, in her greeting. The journal button's lift on leaving is the same whatever is left, so it carries no hint.
- **`backdrop-filter`, thin light strokes:** neither is used. The journal's veil is a solid dim, and the radar's ring is 2 px at the CSS size.
- **Any frame over 50 ms:** the scene is small, at most 64 particles are simulated, and the ruler shows the slowest recent frame.
- **A demo that opens already inside a story:** beat 1 starts 44 m outside station A, with both beams in view.

## The station pin

The beam knob compares two looks:

- the round-1 beam with its white gem at 5 m;
- today's built beacon (six-sided, width growing with distance, a ring on the ground).

**The default is the round-1 beam.** It reads as a pin from afar without the ground ring, and the ring would compete with the drift on the ground. A station's beam fades while the visitor is inside it.

## Fixed demonstration (ten beats)

1. **Outside:** both beams in view.
2. **Walk in, Greta greets:** a wave and a line, which mentions the wind once.
3. **Call the wind:** the drift goes to the film on the west side.
4. **Film:** it plays, the visitor turns away and pauses it from the HUD.
5. **Seen some, call again:** the drift sweeps round toward the song by the bench, behind the visitor.
6. **The journal:** the paused view, what was seen, "There is more here."
7. **Leave with things unseen:** the journal button lifts once, and the journal still shows the mark for the well.
8. **The gate:** three people, and a tap on the mason enters his story.
9. **Call the wind in a story:** the drift goes to the story's next item, the model behind the visitor.
10. **All seen at the well:** the drift goes toward the gate's beam, and the journal says everything here was seen.

`?beat=n` opens a beat directly. `window.demo.jump(n, { stopAt, speed })`, `release()`, `idle()`, `measure()`, `setDrift(k)` and `numbers()` drive it for screenshots.

## The strongest case against it

- **Nothing warns the visitor who never asks.** A visitor who never calls the wind and never opens the journal can walk away with things unseen, and nothing says so. That is the price of "never volunteered".
- **The journal is a second place to look.** A visitor who opens it often is studying a page, not the square.
- **The drift can be missed.** On a busy or very bright square, a 3 s drift is easy to miss. It cannot be made louder without becoming the cue that is always there. The answer is to call it again, which costs one tap.
- **The wind's name means nothing at first.** Greta teaches it once. A station without a greeting person would need another way to introduce it.
