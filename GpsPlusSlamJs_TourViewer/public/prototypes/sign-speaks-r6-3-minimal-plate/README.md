# Sign speaks 6.3 - minimal plate

Throwaway UX prototype, one of the round 6 variants of "the sign speaks". Linked from the prototypes gallery only, never from the app.

**The idea:** the sign is the speaker; the words stay near it.

- The sign shows only **who speaks** (name in the speaker's colour, the AI voice mark) and **the state**: Listen, Speaking (a sound pulse around the speaker's disc, drawn in a shader), Paused, Heard it all, No voice.
- A **plate** hangs under the sign and carries only the line being spoken and the next one, in larger type. Read words are white, the rest grey.
- When the plate cannot be read - too far, too steep, turned away, partly out of view - the same words are in the **round 5 box** at the bottom of the screen. Never in both places: the plate fades out (0.18 s) before the box comes in.
- Only the round 5 controls: a tap pauses or plays, a vertical drag scrubs. The drag works on the plate too, with the same gesture as on the box (see "Scrubbing on the plate").
- A tap on the sign opens the whole text, as the app does today.

## Pages

- `index.html` - the visitor in a simulated lane (a phone's view; a framed phone with the settings beside it on a desktop).
- `creator.html` - the creator's side: a mock of the station's narration section in the desktop editor with the new choice **Words while the voice plays: On screen / On the sign**, a preview of the plate from where visitors usually stand, a warning when that is too far to read, and a top view of the station with the distances the plate can be read from.

## What to try (visitor)

The buttons along the top are the fixed beats:

- **Walk up** - start outside the station (no voice, no words), walk in, then tap the words to listen.
- **3 m / 7 m / 16 m** - stand there, facing the sign. At 16 m the letters are about 7 px, so the words are in the box.
- **65°** - 7 m away, 65 degrees to the side: too steep, the box takes over (with "Sign turns to you" on, the sign turns and the plate stays).
- **Turn away** - look away from the sign and back: the box, then the plate again.
- **No voice** - the voice file is missing: the sign says No voice and offers the text; no plate words, no box.
- **End** - jump to the last sentence: the sign says Heard it all.
- Tap the plate or the box to pause and play; drag either up or down to move through the text.
- **View** (top right) - pick **Captions**: the words stay in the box, whatever the creator chose. The visitor's pick wins.

The readout under the beats says where the words are and why (distance, angle, letter size), how far the plate moved under a finger during a drag, and what a frame costs.

## Settings (knobs)

All are in the visitor page's settings (the menu button) and in the URL.

- **Legible from** `thr` - 10 / **12** / 14 / 16 px: the smallest letter size the plate may show on screen. Below it the words go to the box.
- **Box text** `fs` - 14 / **16** / 18 px.
- **Far sign grows** `grow` - **on** / off: the sign and plate grow with distance from 4.5 m, at most 1.6 times.
- **Sign turns to you** `turn` - **on** / off (fixed like a wall sign).
- **Phone** `orient` - **window** / upright / sideways.
- **Creator chose** `words` - **on the sign** / on screen.
- **Hand shake** `shake` - still / **hand** / strong.
- **Sound** `sound` - **tone** / silent.

The creator page has `thr`, `grow`, `orient` (upright or sideways preview), `d` (3, 5, 7, 9, 12, 16 m) and `voice`.

## Parameters and what they decide

The legibility rule rests on these values; each is a knob or named here:

- Letter size: the plate's type is 80 canvas px on a 1024 px face 1.8 m wide, so one em is 0.141 m.
- Phone camera: 42 degrees across an upright phone 390 px wide, 50 degrees top to bottom of a sideways one 390 px high.
- Hysteresis: the plate keeps the words until letters drop to 95 % of the threshold; a switch holds for 0.25 s.
- Angle limit: 60 degrees between the plate's face and the line to the phone (63 degrees to come back).
- Station radius: 20 m; the voice plays only inside, and leaving pauses it.

How far the plate stays legible, facing it (upright / sideways):

- Growth on: 10 px 11.4 / 9.4 m; **12 px 9.5 / 7.8 m**; 14 px 8.2 / 4.2 m; 16 px 4.5 / 3.7 m.
- Growth off: 10 px 7.1 / 5.9 m; 12 px 6.0 / 4.9 m; 14 px 5.1 / 4.2 m; 16 px 4.5 / 3.7 m.

**The verdict depends on the threshold near the growth plateau.** Between 4.5 m and 7.2 m the growing sign keeps its letters at a constant 15.9 px upright and 13.1 px sideways. A threshold just under those values gives the plate the whole 4.5-9 m band; one just over them takes it away almost entirely (14 px sideways, 16 px upright). So the 12 px default leaves a margin, and a field test should check whether 12 px is really readable in daylight on the target phones before trusting the distances above.

## Scrubbing on the plate

- A drag that starts on the plate reads the finger's own screen motion: one plate line of finger travel (as it measured on screen when the finger went down, at least 16 px) is one line of text.
- The plate is not hit-tested again while the finger moves, so a plate that sways with the hand or the walk does not change what the drag means. The readout shows how far the plate drifted under the finger during the drag.
- While a finger holds the words, they stay where they are (no switch to the box mid-drag).

## The creator's choice

- **On screen** (the default for a new narrated text): every visitor reads the box; the plate stays empty.
- **On the sign**: the plate carries the words while a visitor can read it, the box otherwise.
- The field shows only for a text with a voice.
- The help text says that a visitor who picks Captions keeps the box.
- The warning compares the plate's letter size at the usual standing distance with the threshold, upright and sideways, and says how far the plate stays legible.

## Faked here

- No recording: a soft generated tone murmurs each word on times invented from the letters. Nothing sounds before a tap.
- The lane, the pump house and the story are invented; the camera is simulated, nothing runs in AR. A sideways drag on the view turns it.
- The editor is a mock: only the narration section and the new choice exist; nothing is saved.

## Not verified

- Whether 12 px plate letters are readable on a real phone in daylight, with camera shake, on a real sign. The threshold is a knob for that reason.
- Frame cost on a phone. In headless software rendering the visitor page averaged 23.5 ms a frame at 1280x800 with a worst frame of 50 ms; at 390x844 the software renderer's frames were slower (about 55-85 ms) while the page's own work stayed under 2 ms a frame, so those numbers say more about software rendering than about the page. The readout shows the real numbers on a device.
- The plate canvas is redrawn only when a word lights up or the lines move (a few times a second while speaking); the sign's canvas only when its state changes; the pulse costs no canvas draw.

## Files

- `kind.js` - the item kind (read, assets, fields, world), written to the item prototype rule: three by named imports, metres with Y up, Canvas 2D textures for all words, no access to the scene, camera or document.
- `story.js` - the invented text, its invented word times, and the generated tone.
- `box.js` - the round 5 box as a module.
- `scene.js` - the simulated lane and the phone camera.
- `visitor.js`, `creator.js` - the two pages.
- `sample.json` - records for `read()`: the usual one, the longest, and one with its voice missing.
