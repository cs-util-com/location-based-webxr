# Calm HUD, round 4, direction 2: Sentence timeline

A throwaway UX prototype for the Tour Viewer's AR HUD. It is a single self-contained page (three.js 0.185.1 from a CDN), is not wired into the app and is linked from nothing in the app. It simulates the AR camera on an invented town, so it plays on a desktop and on a phone without AR.

## Purpose

This page tests one answer to three questions: where a speaking item's words go, how a visitor goes back to a missed sentence, and how the compass shows who is speaking.

- **The card:** a light card (dark text on near-white, rounded, 2 px border) across the top edge, built for sunlight. It shows the words in pages of 2-3 lines. A page cross-fades to the next; the word being spoken is underlined; every page starts with the speaker's name in the speaker's colour.
- **The sentence timeline:** under the words sits a row of segments, one per sentence (one per cue for a film). The round play/pause handle rides on the row and is also the drag thumb.
  - While you drag, the sentence you would land on shows greyed in the card, and its segment darkens.
  - When you let go, playback moves to the start of that sentence, a quarter second early.
  - A tap on the handle plays or pauses. A tap on a segment jumps to the start of its sentence and keeps play or pause as it was.
- **The compass:** a disc badge under the card's right corner, overlapping it. While something speaks, a wedge in the speaker's colour runs from the centre toward them. The creator can choose a band look instead; it is the same marks model drawn as a strip, with the wedge drawn as a fan from the caret.
- **The hint button:** sits under the card, left of the compass, and appears only when offered.

## What to look at

Let the demonstration run (the strip at the bottom; the settings beside the phone on a desktop, behind "Settings" on a phone). Beats:

1. Arrive at the well court, following the beam.
2. Greta greets you once; the wedge points at her.
3. Another app covers the screen for 4 s mid-line. Then the visitor drags back to the sentence that was playing when it covered the screen. The finger dot shows the drag; watch the greyed preview in the card.
4. A film with subtitles: the visitor turns away (the words stay in the card), pauses from the handle, drags back one cue and plays on.
5. The finished film dragged back: it stays paused at the place you let go until a tap.
6. A recording behind you: the wedge points down the disc.
7. An item the creator keeps off the compass speaks. The card names it; whether the compass marks it is a tester switch.
8. A search step: the hint button appears (the 60 s trigger is fast-forwarded and says so), and a tap shows a drift of light toward the next place.
9. Three voices at the hall steps, one after the other, each with its own colour and wedge.
10. A narrated long text, then a drag forward three sentences.
11. Your turn: drag on the scene to look, drag up to walk, keys W A S D. "Play a source" in the settings starts any source, so you can try the timeline on a 7 s line and on a 50 s text.

What to judge:

- Can you read the card in bright light, and is 3 lines at 16 px too much for the top of the screen?
- Does dragging the play button feel natural, or do you expect it to be only a button?
- Does the greyed preview tell you where you will land before you let go?
- Is the snap a help (long texts) or a surprise (short lines)? Switch "Snap on release" off to compare.
- Is the badge's overlap on the card's corner clear, or does it look like a layout mistake?

## Tester settings

- **Text size:** 14 / 16 / 18 px.
- **Lines:** 2 / 3. A phone in landscape always uses 2.
- **Tap slop:** 6 / 8 / 12 / 16 px. A movement below this counts as a tap, not a drag.
- **Snap on release:** on / off. Off seeks to exactly where you let go; the preview then marks the word under the finger.
- **Hint appears after:** 60 s without story progress (default) / standing still 8 s in a search step / walking 10 m away from the next place.
- **Narrated long text:**
  - **words in the card, plate retired (recommended):** the sign in the world shows only its title.
  - **on the plate while legible:** the sign carries the words with the spoken one underlined, and the card says so. The words move back to the card once the sign is out of reach (over 14 m, or more than about 30 degrees off to the side).
- **Hidden item speaks:**
  - **not marked (recommended):** the creator's choice to keep an item off the compass wins, and the subtitle still names it.
  - **marked:** the wedge shows anyway.
- **Measuring hook:** off by default. When on, it reports, once a second, the top block's height as a share of the screen, for the card alone and with the compass, per viewport. It forces a layout read, which is why it is off.
- **Demo speed:** 1x / 2x / 4x (also `?speed=`; `?beat=N` starts at beat N).

Creator settings, where the nearest level that sets a value wins:

- **Tour:** compass look (disc / band, the creator's choice on the tour only, no visitor override), subtitles on/off, speaker colours on/off.
- **Each station:** subtitles (as above / on / off).
- **Each item:** on the compass, subtitles. The panel shows the resolved value and the level it came from.

## Rules the page follows

- The timeline spans only the clip of the item speaking now, never earlier story steps.
- A drag never starts or stops sound. After you let go, the item keeps its state, except that a finished item dragged back becomes paused there.
- Rewinding never takes back a seen item or a story step.
- One subtitle source at a time, the same one the compass marks. At most one speaker wedge, shown only while something plays.
- Spoken words exist once: no bubble in the world (except on the plate when that switch is chosen, and then the card does not repeat them).
- No `backdrop-filter`, no thin light strokes. The card text changes only when the page or the spoken word changes, never per frame.

## What is faked

- **Word timings:** a word lasts 0.11 s + 0.055 s per letter, plus 0.22 s after a comma and 0.38 s after a full stop. Film cues have real cue times, and the words are spread over each cue by the same weights. No audio plays.
- **The AR camera, the town, the characters, the film and the messaging app** are stand-ins.
- **The 60 s hint trigger** is fast-forwarded in beat 8 (a toast says so).

## Unverified, and the values a verdict rests on

- **Sunlight legibility** is the point of the light card and has not been tried outdoors. It needs a phone in the sun.
- **Top block height.** Measured in a headless browser, the card alone is 15.5 % of a 390x844 portrait screen at 16 px and 3 lines, under the ~1/6 limit. With the compass badge hanging below it, the block is 23.3 %.
  - Whether the badge counts toward the limit decides whether this direction passes.
  - At 18 px with 3 lines the card alone reaches the limit.
  - In landscape (844x390) the card is 28 % even at 2 lines, so the compass moves beside the card there instead of under it.
- **Snap lead (0.25 s).** A lead near 0 would clip the first word; a lead over about 0.6 s would replay the end of the previous sentence and feel like an off-by-one.
- **Snap usefulness.**
  - On a 7 s line with 2 segments the snap hardly matters.
  - On the 50 s sign text, with 8 segments on about 210 px of track, a finger lands within one sentence, and the snap is what makes the result predictable.
  - A narrower track (the band look frees about 90 px; a disc badge takes it) or a much longer text would change this.
- **Tap slop (8 px default).** With 6 px a shaky thumb on the handle may start a drag instead of a pause. With 16 px a short deliberate drag of a sentence on a short line may count as a tap.
- **Compass range (40 m) and wedge width (about 36 degrees).** A narrower wedge would point more precisely but would vanish at the disc's 100 px size.
- **The disc overlapping the card's corner** takes about 94 px off the right end of the timeline in portrait. The band look does not overlap and leaves the timeline its full width.
- **Frame cost.** Per frame the page redraws the 100 px compass canvas, moves the handle and one segment fill by transform, and toggles one class when the spoken word changes. The film texture redraws 4 times a second, the sign plate only when its word changes. The compass redraws only when something it shows moved.
  - **Measured** in a headless browser with software rendering, on a busy shared machine: the page's own JS work averaged 0.3-5 ms a frame. Isolated frames took 60-280 ms, but those stalls landed in arithmetic-only functions too (25 ms in the hint-trigger check), so they were the machine preempting the browser, not the page's work.
  - **Still to verify on a phone** that no frame passes 50 ms. The panel's "Measuring" section shows the average and maximum per frame live.
