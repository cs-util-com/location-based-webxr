# Calm HUD, round 2, direction 3: The world shows it

A throwaway UX prototype, one self-contained page (`index.html`, three.js 0.185.1 by import map). It is not wired to the app and nothing in the app links to it.

## The direction

Nothing on the screen tells the visitor what is left in a station. The world does it, in two ways.

- **A shimmer on the thing itself.** A thing the visitor has not seen yet carries a faint, slow, warm shimmer on its own surfaces: by default a band of gold light that passes up the object once every 4.5 s and then rests. It never blinks, never pops (it eases in and out), and it shows only while the thing is in view, within a distance the creator sets, and inside the visitor's current station. A showing is at most two passes of light: it settles after the second pass, or sooner once the visitor has held it near the middle of the view for 1.5 s after one whole pass, or has touched it. The first pass starts the moment it begins to shimmer, so no one meets it mid-rest. A thing settled but not yet seen may show its shimmer once more after 20 s out of view, and never a third time: four passes at most, ever, however long it stays at the edge of the view. When everything is seen, nothing shimmers: the absence of shimmer is the "done" signal.
- **Every ending hands the visitor on.** Each thing has a "next" chosen by the creator, and its ending turns the visitor towards it:
  - a person turns (never their back on the visitor), looks and points at it for 5 s;
  - a sign, a picture, a lectern's last page or a model's note, once seen, shows one italic line naming it ("Next: the baker's corner."). The line is worked out from the chain when it is shown and redrawn whenever something else is seen, so it never names a thing already seen;
  - a film's end card says "Next: a song by the old bench" with an arrow to the side it lies on;
  - a sound's own gold motes drift that way when it ends (and, behind a knob that is off by default, a soft two-note sound pans to that side).
  - The chain skips what is already seen. When it runs out, it falls back to the nearest unseen thing of the station, and when nothing is left at the well, to the light of the next station.

**Station A, "The Well":** one story, "Water for the town", which begins with Greta. She greets the visitor once on walking in (the one deliberate start by arriving) and points to the lectern, the story's next step.

**Station B, "The Old Gate":** three people stand where their stories begin (Anton the mason, Mira the merchant, Jakob the watchman). They shimmer like anything else unseen. Tapping one enters that story: they tell its opening and point to its next step. This replaces today's built picker of story titles.

## What "seen" means, per kind

- **A person:** their first words have played to the end.
- **A short text, a picture:** it has been near the middle of the view, within reading distance (6 m for a sign, 9 m for a picture), for 1.5 s.
- **A long text:** its last page has been shown (a tap turns the page).
- **A film, a sound:** it has played to its end.
- **A model:** it has been tapped and its note has opened.

"Noticed" (the shimmer settles) is separate from "seen". A visitor can notice a film without watching it.

## The shimmer's values, and why

- **Strength and period** (`?glint=`, also in the info panel):
  - `faint`: 30 % towards gold, a pass every 6 s;
  - `soft` (default): 50 %, every 4.5 s;
  - `clear`: 68 %, every 3.5 s.
  - The default has to be visible on a phone in daylight, or the direction is judged on a cue nobody can see. The first values (22, 36 and 55 %) left `soft` invisible in a 390 px screenshot, so all three moved up. The info panel says which to try: `soft` first outdoors, `clear` if it cannot be made out on pale signs in sun, `faint` for a dim place or a dark object. A pass takes 60 % of the period and the rest is still, so even `clear` is never a pulse. Two things never shimmer in step: each one's first pass starts when it comes into view.
- **Distance** (`?reach=8|12|18`, default 12 m), times a factor per kind for how far it can be made out: a person 1.5, a film 1.2, a long text, a picture and a sound 1, a model 0.9, a short sign 0.8. 12 m is about the size of a station's inner ring, so standing in the middle of the well's square shows most of what is near, and nothing across the whole square shimmers at once.
- **Motion** (`?style=sweep|breathe`): `sweep` (the default) passes a band of light up the object; `breathe` warms and cools the whole object. The sweep was chosen because a moving band reads as light on a surface, while a whole-object tint can read as "this is selected".
- **Settling:** at most 2 passes per showing, counting a pass cut short by turning away; sooner when noticed (1.5 s within the middle 45 % of the view, once a whole pass has shown) or touched. It may show again after 20 s out of view, twice at most, so 4 passes ever.
- While a person is talking, nothing else shimmers, so the shimmer never competes with a voice.

## What the HUD holds

- **Exit**, always, at the top left.
- **The radar**, always, at the top right: stations only, heading-up, true positions. A station is orange while it holds anything unseen and grey once all of it is seen. Inside a station its edge is drawn; a station out of range sits on the rim. A tap steps its range (auto, 30, 100, 300 m).
- **One transport button** (pause/play with a progress ring), bottom centre, while something of this station plays or was paused from it.
- **The story chip**, bottom left, while a story runs: the face colour of the person the visitor entered it through, the title, and a leave button. It sits beside the transport, never stacked on it.

The direction adds nothing to the HUD. The dashed controls at the top right (beats, info, ruler) are demo chrome, not part of the design, and are not measured.

## How each never-list item is avoided

- **A list of the station's items in the HUD:** none. The HUD names no item at all.
- **Per-item markers on the HUD or the screen edges:** none. The shimmer is drawn on the object's own surfaces, in the 3D scene; nothing is drawn on the screen for an item, and nothing points to a thing out of view.
- **A floating icon over every item by default:** none. No icon, halo or ring is added; the shimmer changes the colour of the object's existing surfaces. The sound's particles are the item itself.
- **A HUD whose content follows the gaze:** the HUD never changes with where the visitor looks. The shimmer does react to the view (it shows on things in view and settles when looked at), which is the nearest this direction comes to that line; the difference is that it lives on the object, not on the screen.
- **A HUD label for a station:** none. Station names appear only on things in the world.
- **Approach sounds:** none. The optional ending sound plays only when a film or song the visitor started ends, never on approach, and is off by default.
- **Aim-to-ask:** nothing is asked by aiming. Noticing only stops a shimmer; it starts nothing.
- **A 2D copy of a text that stands in 3D:** none. Words live on plates, screens and speech bubbles in the scene.
- **Radar marks drifting from their true positions:** the radar shows only stations, at true positions; one out of range sits on the rim in its true direction. The automatic range has hysteresis, so it does not breathe while walking.
- **A card outliving its place:** a bubble belongs to its person and goes when the line ends or the station is left; a model's note fades beyond 9 m; an end card is the film's own screen.
- **Two stacked panels:** the chip and the transport sit in one row; the radar is alone at the top right.
- **Anything starting by nearness alone for a visitor standing still:** only Greta's greeting starts by arriving, once per visit. A shimmer starts nothing; it is a look, not an action.
- **A hint the app volunteers repeatedly:** each thing shows its shimmer at most twice, ever, and each showing is at most two passes of light, so a thing left at the edge of the view for a minute does not keep sweeping. Leaving a station says nothing; the station's light stays orange behind the visitor, which is the world's state, not a message.
- **`backdrop-filter`, thin light strokes:** neither is used. Plates are solid; the radar ring is 2 px at its CSS size.
- **Any frame over 50 ms:** the shimmer is a small patch to each item's own material (one shared program, no extra draw call); the ruler shows the slowest recent frame.
- **A demo that opens already inside a story:** beat 1 starts 44 m outside the well, with both beams in view.

## The station pin

The beam knob (`?beam=round|built`) compares the round-1 beam with its white gem (the default, the one that was liked) with today's built beacon (six-sided, width grows with distance, a ring on the ground). Inside a station its beam fades. Outside, it is orange while the station holds anything unseen, and pale and fainter once all of it is seen, so the beam carries the "more here" signal from afar instead of the HUD.

## Fixed demonstration (ten beats)

1. **Outside:** both beams in view; walk to the edge.
2. **Walk in, Greta greets:** she waves, speaks, then points to the lectern.
3. **Look round, things glint:** the lectern shimmers; turning to the film, it shimmers, and holding it in view settles it.
4. **Film:** tap it, turn away, pause from the HUD.
5. **Film ends, hands on:** its end card names the song by the bench; turning there, the bench shimmers.
6. **Seen some, what is left:** a slow turn; only the two unseen things (the song, the model) shimmer.
7. **Leave with things unseen:** walk out, look back: the beam is orange again; nothing is said.
8. **The gate:** the people shimmer; turning to the mason and tapping him enters his story, and he points to the model.
9. **A story step hands on:** the model's note names the next thing; the mason's last words point at it too.
10. **All seen at the well:** nothing shimmers; Greta points to the gate's light; outside, the well's beam is pale and its radar dot grey.

`?beat=n` opens a beat directly. `window.demo.jump(n, { stopAt, speed })`, `release()`, `idle()`, `measure()` and `numbers()` (which includes what is shimmering and what has settled) drive it for screenshots.

## The strongest case against it

- The shimmer reacts to where the visitor looks. It lives on the object, but it is the closest of the round's directions to the rejected "HUD that follows the gaze".
- In real sun on a real camera image, a warm sheen may be too faint on pale stone and too loud on dark wood. Only a phone outdoors can say whether the default holds.
- The chain is creator work. A thing without a good "next", or one met out of order, hands on to nothing better than the nearest unseen thing.
- It is not fully independent of the other directions of this round. A sound's ending sends its gold motes toward the next thing, which is close to the wind of direction 4. Tapping a person whose story is done makes them name and point to what is left, which is a small "ask the guide".
- A visitor who never turns round never sees what shimmers behind them. Inside a station the only reminder is the radar's orange dot; outside it, the orange beam.
- The shimmer cannot tell the visitor how much is left, only that something in view is unseen. A visitor who wants a count has none.
