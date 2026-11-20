# Sign speaks 6.1 - plate first, box as fallback

A throwaway UX prototype. It is linked from nothing in the app and stays as part of the prototype gallery.

## What it shows

A reading sign (a long text on a sign in the world) that can also be listened to.

- The sign has two halves: **Read** opens the whole text, **Listen** starts the voice. The Listen half says what the voice is doing: Listen (with the length and "an AI voice"), Speaking, Paused, Again, "step closer" outside the station, and "No voice" when the voice file is missing.
- While the voice plays, the spoken words run on a **caption plate** hanging under the sign, in the look of the round-5 narration box:
  - at most three lines, the spoken line in the middle row;
  - unread words grey, read words white;
  - the speaker's name inline in its colour, then an "AI voice" badge (a tap on it shows the voice credit);
  - a thin scrollbar on the right.
- **The plate comes first.** The words are on the plate while it is in view and legible: its letters at least the legibility threshold in screen pixels (12 px by default, 5 % hysteresis), seen at less than 60 degrees, and wholly on the screen.
- **The box is the fallback.** When the sign leaves the view, falls under the threshold or is seen too obliquely, the same words go on in the round-5 box at the bottom edge. A new place has to hold for 0.25 s before the words move, and they never move under a finger.
- **Never in both places.** Exactly one of the plate and the box carries the words.
- **The visitor's pick wins.** The pill at the top ("Words on the sign" / "Words in the box") is the visitor's own choice for this text; "Tour's choice" in the settings is what the tour's creator chose. Once the visitor picks, the tour's choice no longer applies (changing "Tour's choice" in the settings clears the pick, so both can be tried).
- **The round-5 controls only**, on both places: a tap pauses or plays; a vertical drag scrubs, one line height of finger per line of text, up ahead, down back, with a rubber band at either end. No ring, no speed chip, no floating control.
- **A drag on the plate reads the finger, not the plate.** The plate's line height on screen is taken once at the press; after that only the finger's screen motion counts, so a shaking hand cannot scrub. "Plate drag: Re-hit" swaps in the rejected way (hitting the moving plate again every frame) for comparison; try it with "Hand shake: One hand".
- **The station.** The voice plays within 20 m of the sign. Walking out pauses it; coming back carries on.
- **Cost readout** at the top: distance, angle, growth, the letter size against the threshold, where the words are and why, the narration state, the frame work time and its worst, the count of frames over 50 ms, draw calls, triangles and plate redraws per second. The plate is repainted only when a word lights or the scroll moves.

## The beats (the strip at the top)

- **Walk up** - from 32 m to 7 m in 5 s: the words appear on the plate once it gets legible (start Listen first, or press Walk up while it plays to see the box hand over to the plate).
- **3 m, 7 m, 16 m, 65°** - the stands. At 16 m the plate is too small and the box carries the words; at 65 degrees to the side a fixed sign is too oblique, a turning sign is not.
- **Turn away / Turn back** - the view turns 118 degrees off the sign: the words move to the box, and back to the plate on the return.
- **Pause** - the same tap a finger makes, on whichever place carries the words.
- **Back 2 lines** - the same scrub a finger makes, two lines back over 0.6 s.
- **End** - jumps near the end of the text: the narration ends, and the Listen half says Again (a tap restarts).
- **No voice file** - switches to a record whose voice is missing: Listen says "No voice", and a tap on it shows a notice where the words would be (plate or box), pointing to Read.

## The knobs (Settings)

- **Legible from** 10 / 12 / 14 / 16 px (default 12).
- **Text size** 14 / 16 / 18 px for the box (default 16).
- **Sign grows** on / off: the sign grows with distance, distance / 4.5 m, between 1 and 1.6.
- **Phone** upright / sideways: the camera model is a phone camera, 42 degrees across upright, 50 degrees high sideways.
- **Tour's choice** sign / box; **Sign** turns / fixed; **Hand shake** off / calm / one hand; **Plate drag** finger / re-hit; **Tone** on / off; **Text** normal / longest / no voice.
- By URL: `?th=12&fs=16&grow=on&frame=portrait&creator=sign&turn=turns&shake=calm&drag=finger&tone=on&rec=normal&stand=d7&autostart&at=9` (`autostart` starts the voice without a tap and without sound, `at` is the start time in seconds, `stand` one of `d3`, `d7`, `d16`, `side`).

## Single values and faked parts

- **No voice, no recording.** The narration is timed text on invented times (word length plus pauses after punctuation); the "voice" is a soft generated tone per word, made after the first tap.
- **No AR.** The camera view is a simulated lane; on a desktop a drag off the plate turns the view, which a phone does by turning in the hand. The hand shake is two sine waves.
- **Single values:** the 20 m station, the 0.25 s dwell, the 60-degree angle limit, the 5 % hysteresis, the 8 px tap slop, the plate's three rows and its width (the sign's, 2.4 m). The legibility threshold is the knob that matters; the others are named here so they can be questioned.
- **The whole text** opens in a plain sheet; its design is not part of this round.

## Files

- `kind.js` - the world half, written to the item prototype rule: `read(record)`, `assets(block)`, `world(block, env)` (the sign and the caption plate, Canvas 2D textures, no scene or `document` access) and `fields(view)` (with the creator's "Spoken words" choice). It has no `card` export: the card of a reading sign is not part of this question.
- `sample.json` - the records: normal, longest and a missing voice file. Invented text, no real place.
- `plate-first.js` - the page: the lane, the camera, the narration state, the plate-or-box decision, the round-5 box, the gestures, the beats, the knobs and the readout.
- `plate-first.css` - the round-5 box look, the strip, the readout and the settings.
