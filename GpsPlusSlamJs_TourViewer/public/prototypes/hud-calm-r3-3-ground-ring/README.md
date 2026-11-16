# Calm HUD round 3, variant 3: the ground ring

A throwaway, standalone prototype. Nothing in the app links to it, and it does not use the app's code. It is one HTML file: three.js 0.185.1 by import map, metres, Y up, words in the world drawn as Canvas 2D textures.

It keeps the direction of round 2, page 2 (the radar wakes when you stop) and changes three things: the radar moves off the screen onto the ground, its scale becomes linear, and the transport becomes one line at the foot that carries the words being spoken.

## The idea

- **The radar lies on the ground.** It is a thin ring, 0.45 m in radius, a little ahead of the visitor's feet (1.6 m by default). You see it by looking down, as you would look at a map painted on the street. It is a three.js object in the scene, not attached to the camera, and it follows your step and your turn with a short lag, so a quick turn of the phone does not swing it.
- **One metre on the ring is always the same many metres around you.** The scale is linear: a thing at half the range sits at half the radius. A thing beyond the range waits on the rim in its true direction, drawn hollow so it reads as "further". There is no square root and no other bend in the distances.
- **Circles only.** The marks are small discs, no icons, no numbers, no text. Your own place is a light blue dot in the middle, and a faint wedge shows where you face. A thin inner circle marks half the range.
- **It sleeps while you walk and wakes when you stand still**, exactly as page 2: faint (16 %) while walking, full after 3 s without walking. Crossing a station edge wakes it for 3.5 s; a tap on the sleeping ring wakes it for 6 s; a tap on the awake ring steps the range.
- **Outside a station it shows stations only:** the next one orange, the ones not yet visited white and hollow, visited ones grey, and a grey one with a white centre still has something unseen. **Inside a station it shows the station's things at their true places:** white still to see, grey seen, grey drawn first so a seen thing never hides an unseen one. The station's edge shows as a dotted circle where it falls inside the ring.
- **During a story the next step's place shows in the colour of the person telling it**, drawn last, so the visitor can find it on the ring without a word on the screen.
- **Built per frame.** The ring is five meshes and two instanced meshes per layer; every frame writes the marks' matrices and colours in place. There is no canvas, no texture redraw and no throttle.

## The HUD: Exit and one line

- **Exit**, top left.
- **One line at the foot**, shown only while something speaks, plays or waits for you:
  - **A person speaks:** their first name in bold, then the words of the current sentence, each word lighting up as it is spoken (timed words), then a small pause button whose ring fills with the step's progress.
  - **A video or a sound plays:** its title, then its current subtitle from its cue list, then play/pause with the progress ring.
  - **A story waits for you at its next place:** a dot in the teller's colour, the story's title and "step n of m", then the hint when it is offered, then leave (x).
- **Only the current sentence or cue, never a history.** One or two lines (a setting). The words fade 0.8 s after a cue ends; with nothing playing, the whole line fades away.
- **The words do not need the source in view, or sound.** The subtitle of a video keeps running when you turn away from the screen, and a person's words show whether or not the phone is muted.
- **Play/pause sits where its context is:** at the end of the line that names what it controls. It is 40 px, smaller than the 58 px of page 2, and its aria-label names the thing ("Pause Drawing water, 1938").
- **Signs and long texts stay in 3D only.** The line never repeats a text that stands in the world. The speech bubbles of page 2 are gone, because they would now say the same thing twice; a soft ring in the speaker's colour lies at their feet while they speak, so the line's dot points at a person in the world.

## The hint: "Show the way"

Inside a story, when you walk away from the story's next place, a button "Show the way" appears at the end of the line. A tap sends a short drift of warm light along the ground toward that place: the drift of round 2, page 4, ported as it was (64 motes, 3 s, a bend round your shoulder when the place is behind you, never at the camera, ending 1.2 m short of a near place and at most 9 m out).

- **Why this name:** it says what you get, in words everyone reads the same way. An icon alone would have to be learned, and this button appears rarely, so the words cost little. It is not called after the wind because the wind is only how it looks; another look could replace it without renaming the button.
- **When it is offered:** once the distance to the next place has grown more than 10 m above its smallest value since the last step. Wandering around the square does not trigger it; walking away does. It stays offered until you reach the place, and is offered again only at the next step: never volunteered over and over.
- **Only where hints are allowed** (see the author settings). A story with hints off shows the line without the button.

## Author settings: four levels, the nearest wins

Two switches exist on every level: **"shown on the radar"** and **"hints allowed"**. The levels are the tour, the station, the story and the item. Every level but the tour says "as above" until the author sets it. For one item the nearest set level wins:

- **item**, then
- **its story** (for an item that is a story's step or the person who starts it), then
- **its station**, then
- **the tour.**

A third switch, **"radar at all"**, exists only on the tour and on a station. Inside a station its switch wins when set; outside every station the tour's switch decides.

Some consequences, stated so the editor can show them later:

- A station's "shown on the radar" applies to the things inside it, not to the station's own mark outside. A station whose things are all hidden still shows as a station between stations.
- Hints resolve on the story's next place, so a story can allow hints while one of its places forbids them.
- Hiding a thing from the radar does not change what "seen" means for it, and a grey-with-white-centre station counts only things that are shown.

The settings panel has an "Author settings" section where every switch on every level can be cycled (as above / yes / no) and the result for each item is shown with the level it came from. Four presets set the examples: station B's things off the radar, the lion at station A off the radar, the bread story with no hints, and no radar at all in station B. The same presets work as a URL option: `?preset=bHidden,lionHidden,breadNoHints,noRadarB`.

## The parameters, and what to try

Every default is a setting: in the panel, as a URL option, or both.

- **Stand still** (`wake`): 3 s. Try 2 s and 5 s. Long enough that waiting at a crossing does not wake it, short enough that someone who stops to wonder gets the map before they ask.
- **Fade**: 0.8 s. Try 0.4 s and 1.5 s. Slow enough not to pop into the corner of the eye.
- **Walking from**: 0.5 m/s of smoothed pose speed. Try 0.3 and 0.8. Must be checked against recorded walks; real pose jitter is not simulated.
- **Range in a station** (`range`): the station's radius times 1.5. Try 1.2 (fills the ring, the edge falls outside) and 2 (the station's edge visible as a circle).
- **Ring ahead** (`ahead`): 1.6 m. Try 1.2 m (under the phone when looking almost straight down) and 2.0 m (seen with less of a nod, but smaller and flatter).
- **Ring radius** (`ring`): 0.45 m. Try 0.35 m and 0.6 m. 0.55 m filled a portrait screen when looking down; smaller makes close marks merge sooner.
- **Line size** (`strip`): medium (14 px). Try small and large; large for reading while walking in sun.
- **Line height** (`lines`): 2 lines. Try 1 line: calmer, but a long sentence then shows only its start.
- **Hint after walking away** (`hint`): 10 m. Try 5 m (offered at the first wrong turn, on a small square) and 20 m (only once clearly lost).
- **Words linger**: 0.8 s after a cue ends, so a short cue can still be read.
- **Word timing**: a word every 0.36 s, with 0.28 s after punctuation. Real timings would come from the recording or the speech engine.

## The frame cost, measured

Measured with the same scripted 20 s walk on both pages (W held throughout, A from 5 to 8 s, D from 12 to 15 s), in headless Chromium on a software renderer, portrait 390 x 844, with each frame's callback timed by wrapping `requestAnimationFrame`. Page 2 ran with its radar always on (`?between=always`), and its radar redraws were counted by watching the radar canvas being cleared. Two to three runs each, on a loaded machine:

- **Page 2:** callback median 1.3-1.4 ms, worst 22-78 ms. Frames that redrew the radar: median 1.5-1.7 ms; frames that did not: 1.1-1.2 ms. The radar redrew on about half of all frames.
- **This page:** callback median 1.5-2.5 ms, worst 71-219 ms (the worst frames vary from run to run and are not tied to the ring). The ring's own update: median under 0.1 ms, worst 0.3-1.3 ms in four runs, with one 23 ms outlier.
- **Frame intervals** were 33-50 ms median on both pages: the software renderer, not either radar, sets the pace here.

What this says about the stutter on page 2: the redraw cost about 0.4 ms a frame, so its cost did not cause it. The measurement does show the cadence: the radar redraws on its own 15 Hz clock, apart from the frames, so on a 60 Hz phone the map moves in steps of four frames while the world turns smoothly behind it. That is the likely cause, but this headless run at 20-30 frames a second cannot show it; a phone recording at 60 Hz would. The ring has no clock of its own: it moves with every frame.

Headless frame times say nothing about a phone's GPU. The readout's worst frame is red here for that reason.

## What "seen" means here

- **Short text, picture:** in view and near (8 m, 10 m) for 1.5 s, 2 s.
- **Model:** in view within 10 m for 3 s.
- **Long text:** its last page was shown. Tap the lectern to turn pages.
- **Video, sound:** played to the end. Stopped part way, it stays white.
- **A story's later step** (the rim stone, the oven, the bell): its words were spoken there.
- **A character who starts a story:** that story played to its end.

"In view" means within the camera's horizontal field of view.

## The never-list, item by item

- **A list of the station's items in the HUD:** there is none. The ring shows discs without names, and the line names only what speaks or plays now.
- **Per-item markers on the HUD or the screen edges:** none. Marks exist only on the ring, which lies in the world.
- **A floating icon over every item by default:** none. Only the audio items have particles, which belong to them; the speaker's ring shows only while they speak.
- **A HUD whose content follows the gaze:** the line depends on what speaks, plays or waits, never on what you look at. A video's subtitle stays while you look away. The ring is in the world, so looking down at it is looking at a place, not a HUD reacting to the gaze.
- **A HUD label for a station:** none.
- **Approach sounds:** none.
- **Aim-to-ask:** none. Things react to a tap or to standing near and looking.
- **A 2D copy of a 3D text:** none for signs and long texts. Spoken words and subtitles are in the line by request: they have no text in the world (the speech bubbles were removed so nothing is shown twice).
- **Radar marks drifting from their true positions:** marks are drawn at their true bearing and linear distance, never pushed apart. The only displacement is the clamp of things beyond the range to the rim, drawn hollow.
- **A card outliving its place:** the line hides when you leave a playing thing's reach or the story's station; the story waits and carries on when you tap its person again.
- **Two stacked panels:** one line at most. The measuring hook checks for overlaps in every beat, the ring included when it is in view.
- **Anything starting by nearness alone for a visitor standing still:** only Greta's greeting at station A, the deliberate exception, once per visit. A story's next step begins when you walk to its place: that is walking, not standing.
- **A hint volunteered repeatedly:** "Show the way" is offered at most once per story step, and only after walking away. The drift plays only when tapped. The first-run card shows once.
- **`backdrop-filter`, thin light strokes:** none on the screen. Plates are solid with 2 px borders. The ring's thin lines lie in the world, not on the HUD.
- **Any frame over 50 ms:** see the measurement above; on a software renderer it cannot be shown either way.
- **A demo that opens already inside a story:** the page opens outside station A, on the lane, with the beam ahead.

## The case against

- **You have to look down.** A visitor who holds the phone level never sees the ring. Page 2's corner radar needed only a glance; this one needs a nod. In return the screen stays free, and the map sits where maps on the ground sit.
- **On the ground, small and flat.** Seen at an angle, a 0.45 m ring 1.6 m ahead is an ellipse; close marks merge sooner than on a screen disc, and bright cobbles or sun can wash it out. Real camera images are untested.
- **A ring on the floor is drawn over everything.** It is drawn without depth so it is never hidden by the ground, which also means a real kerb or person in front of it does not hide it.
- **The words in the line are the first text on the HUD.** They are short and current only, but they are text, and a visitor may read the line instead of looking up.

## The demonstration

The same invented square as page 2: "The well court" (A, radius 18 m) and "The hall steps" (B, radius 20 m). New here are the rim stone as the second step of Greta's story, an old oven for the baker's story and a new bell for the ringer's, each with its own place.

- **Beat 1:** Walk up to the beam, the ring faint at your feet. Stop and look down: the stations, the next one orange.
- **Beat 2:** Greta greets once, her words lighting up in the line. Walk to the well: the rim stone is the story's second step.
- **Beat 3:** Stand still inside A, look down: the ring wakes with the station's things.
- **Beat 4:** Look around: a picture, the lectern's three pages and the lion. Stand still: they are grey.
- **Beat 5:** Play the video, turn away: its subtitles stay in the line. Pause it from the line.
- **Beat 6:** A sign and a sound 2.3 m apart, with the sound's cues in the line. Tap the ring to 10 m and they stand apart.
- **Beat 7:** Leave with things unseen: A grey with a white centre, B orange.
- **Beat 8:** Station B: three people. Tap the baker to enter his story.
- **Beat 9:** Walk the wrong way: "Show the way" is offered; a tap sends the drift toward the oven.
- **Beat 10:** Author settings at work: station B's things hidden from the ring, and the bread story with no hint.

To try it, use the beat stepper (the arrows at the top) or walk freely: drag sideways to turn, drag up to walk; on desktop W A S D, R and F or the mouse wheel to look up and down, or the arrow button to look down. The measuring hook is behind the ruler button: HUD coverage, element count, overlaps, the ring's state, marks on the rim and marks hidden by the author, the frame times and the ring's own update time. `?shots` pauses at every key moment (`HC.resume()` continues), and `?speed=3` runs the beats faster.
