# Calm HUD, round 2, direction 1: Ask the guide

A throwaway UX prototype, one self-contained page (`index.html`, three.js 0.185.1 by import map). It is not wired to the app and nothing in the app links to it.

## The direction

The station's guide, a person standing in the square, is the only source of hints, and only when the visitor asks. There are two ways to ask: tap the person, or tap the one speech-bubble button at the bottom right, which shows only inside a station. The guide then:

- names two or three unseen items, nearest first, by their landmark ("a song by the old bench, a film on the west side");
- turns towards the nearest one and points at it while the head looks back at the visitor;
- comes over if she is far away or out of view, says her answer about 4.5 m straight in front of the visitor, and walks back to her place afterwards (a knob turns this off).

While she answers, and for 2.5 s after her last word, a small radar shows every item of the station at its true position: white means not seen yet, grey means seen, and the items she named carry a soft halo. Then it fades out. Nothing else ever tells the visitor what is left, with one exception: on walking out of a station with items unseen, the guide calls after the visitor once, in a short line in the air ahead of them. That never happens again for that station.

The words stand in 3D, in a speech bubble over the person's head that always faces the camera and keeps a steady size on the screen. They appear word by word, and the browser's speech voice can read them aloud (on by default, a knob in the info panel). If the visitor walks more than 14 m away mid-sentence, the bubble folds to "..." and the voice stops. Coming back within 10 m resumes the line with "As I was saying".

**Station A, "The Well":** one story, "Water for the town", which begins with Greta. She greets the visitor once on entering the station. This is the one deliberate start by arriving, once per visit, and she says once that she can be asked.

**Station B, "The Old Gate":** three people stand where their stories begin (Anton the mason, Mira the merchant, Jakob the watchman). Tapping one enters that story. **This replaces today's built picker of story titles:** the choice is made by walking up to a person, not from a list. While a story runs, its first person is the guide who answers questions. Outside a story, the nearest person answers.

## What "seen" means, per kind

- **A person:** their first words have played to the end.
- **A short text, a picture:** it has been near the middle of the view, within reading distance (6 m for a sign, 9 m for a picture), for 1.5 s.
- **A long text:** its last page has been shown (a tap turns the page).
- **A film, a sound:** it has played to its end.
- **A model:** it has been tapped and its note has opened.

## What the HUD holds

- **Exit**, always, at the top left.
- **The ask button**, only inside a station, at the bottom right. This is the direction's own addition, and the justification is that it replaces the always-on radar. One fixed control that waits to be asked is calmer than a cue that is always on.
- **The radar**, only while a guide answers, at the top right.
- **One transport button** (pause/play with a progress ring), bottom centre. It shows only while something of this station plays, or was paused from it, so the visitor can pause a film they have turned away from.
- **The story chip**, bottom left, while a story runs. It shows the face colour of the person the visitor entered the story through, the story's title and a leave button. It sits side by side with the transport, never stacked on it.

The dashed controls at the top right (beats, info, ruler) are demo chrome, not part of the design, and are not measured.

## How each never-list item is avoided

- **A list of the station's items in the HUD:** none. The guide names at most three items by their landmark, in speech, in 3D.
- **Per-item markers on the HUD or the screen edges:** none. The radar is a map at true positions and shows only while the guide answers.
- **A floating icon over every item by default:** none. The items are plain objects. The sound's particles are the item itself, not a marker.
- **A HUD whose content follows the gaze:** the HUD never reacts to where the visitor looks.
- **A HUD label for a station:** none. The station's name appears only in the guide's spoken farewell.
- **Approach sounds:** none. The voice speaks only a greeting (once), an answer (when asked) or the farewell (once).
- **Aim-to-ask:** asking is a tap on the person or on the button, never a crosshair dwell.
- **A 2D copy of a text that stands in 3D:** the words exist only in the bubble. The HUD carries no subtitles.
- **Radar marks drifting from their true positions:** marks are drawn at true positions and never pushed apart. Grey is drawn first, so a white mark is never hidden under a grey one. The range is fitted once per answer, so it never zooms while the visitor reads it.
- **A card outliving its place:** a bubble belongs to its person and goes when the line ends or the station is left. A model's note fades beyond 9 m. The farewell fades after about 7 s.
- **Two stacked panels:** the chip and the transport sit in one row. The radar is alone at the top right.
- **Anything starting by nearness alone for a visitor standing still:** at B the people only turn their heads towards a visitor who comes near. Only Greta's greeting starts by arriving, once per visit.
- **A hint the app volunteers repeatedly:** the farewell happens once per station. Greta mentions once, in her greeting, that she can be asked. Nothing else is volunteered.
- **`backdrop-filter`, thin light strokes:** neither is used. The plates are solid, the radar's ring is 2 px at the CSS size, and the controls have no light hairlines.
- **Any frame over 50 ms:** the scene is small, and the ruler shows the slowest recent frame.
- **A demo that opens already inside a story:** beat 1 starts 44 m outside station A, with both beams in view.

## The station pin

The beam knob compares two looks:

- the round-1 beam with its white gem at 5 m (the default, the one that was liked);
- today's built beacon (six-sided, 4 m to 26 m, width grows with distance, a ring on the ground).

The default stays the round-1 beam. It reads as a pin from afar without the ground ring, and the ring would duplicate the station's edge that the radar already shows when asked. A station's beam fades while the visitor is inside it.

## Fixed demonstration (ten beats)

1. **Outside:** both beams in view.
2. **Walk in, Greta greets:** a wave and a line.
3. **Ask Greta:** she answers in place, and the radar shows.
4. **Film:** it plays, the visitor turns away and pauses it from the HUD.
5. **Seen some, ask again:** at the bench, Greta walks over, and the radar shows grey and white.
6. **Walk off mid-answer:** the bubble folds, then the line resumes.
7. **Leave with things unseen:** the farewell line, once.
8. **The gate:** three people, and a tap on the mason enters his story.
9. **Ask in a story:** the mason answers.
10. **All seen at the well:** Greta points to the gate's beam.

`?beat=n` opens a beat directly. `window.demo.jump(n, { stopAt, speed })`, `release()`, `idle()`, `measure()` and `numbers()` drive it for screenshots.

## The strongest case against it

- A visitor who never asks learns what they missed only from the farewell, and if they ignore that, the miss is permanent.
- A guide walking over crosses real ground the app cannot see: on a crowded square she may walk through people or a bench.
- A voice on a phone speaker in a quiet courtyard disturbs others. Without headphones, the bubble carries the words alone.
- A guide out of view needs the walk-over. With it off, she answers from her place, and the visitor must look for her.
- A station whose stories do not begin with a person has no one to ask, and the button would have to fall back to the station's own voice.
