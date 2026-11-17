# Calm HUD, round 4, direction 2: Sentence timeline

A throwaway UX prototype for the Tour Viewer's AR HUD. It is a single self-contained page (three.js 0.185.1 from a CDN), is not wired into the app and is linked from nothing in the app. It simulates the AR camera on an invented town, so it plays on a desktop and on a phone without AR.

## Purpose

This page tests one answer to three questions: where a speaking item's words go, how a visitor goes back to a missed sentence, and how the compass shows who is speaking.

- **The card:** a light card (dark text on near-white, rounded, 2 px border) across the top edge, built for sunlight. It shows the words in pages of 2-3 lines. A page cross-fades to the next; the word being spoken is underlined; every page starts with the speaker's name in the speaker's colour.
  - **Nothing in the HUD moves when a voice starts or ends.** The card fades in and out in a place whose height is always reserved, so Exit, the hint button and the compass keep their positions with or without it.
- **The sentence timeline:** under the words sits a row of segments, one per sentence (one per cue for a film). The round play/pause handle rides on the row and is also the drag thumb.
  - While you drag, the sentence you would land on shows greyed in the card, and its segment darkens.
  - When you let go, playback moves to the start of that sentence, a quarter second early.
  - A tap on the handle plays or pauses. A tap on a segment jumps to the start of its sentence and keeps play or pause as it was.
- **The compass:** a disc badge under the card's right corner, overlapping the card by about 40 px. While something speaks, a wedge in the speaker's colour runs from the centre toward them. The creator can choose a band look instead; it is the same marks model drawn as a strip, with the wedge drawn as a fan from the caret.
  - Drawn with three.js meshes, as round 3's compass was, with round 3's mark sizes: items 5.5 px radius with a light halo, stations 6.5 px rings, the next station an 8.5 px blue circle with a white halo, on the band too. On the band, items shrink from 7.5 px near to 3.5 px at the range edge and 3.6 px behind, as on round 3's band.
  - Unlike round 3 it renders into a small WebGL canvas of its own, not the scene's, because the badge sits over the card and the scene canvas lies under every HUD element.
- **The hint button:** sits under the card, left of the compass, and appears only when offered, once per trigger episode.
- **World taps:** a tap on a figure, the film, the bell, the well or a sign starts it, from inside its place.

## What to look at

Let the demonstration run (the strip at the bottom; the settings beside the phone on a desktop, behind "Settings" on a phone). Beats:

1. Arrive at the well court, following the beam.
2. Greta greets you once; the wedge points at her.
3. Another app covers the screen for 4 s mid-line. Then the visitor drags back to the sentence that was playing when it covered the screen. The finger dot shows the drag; watch the greyed preview in the card.
4. A film with subtitles: the visitor turns away (the words stay in the card), pauses from the handle, drags back one cue and plays on.
5. The finished film dragged back: it stays paused at the place you let go until a tap.
6. A recording behind you: the wedge points down the disc.
7. An item the creator keeps off the radar speaks. The card names it; whether the compass marks it is a tester switch.
8. A tap on Greta in the world starts her. The visitor walks out of the well court: she holds and her card goes. Walking back in, she carries on.
9. A search step: the hint button appears (the 60 s trigger is fast-forwarded and says so), and a tap shows a drift of light toward the next place.
10. Three voices at the hall steps, one after the other, each with its own colour and wedge.
11. A narrated long text, then a drag forward three sentences.
12. Your turn: drag on the scene to look, drag up to walk, keys W A S D, tap a source to hear it. "Play a source" in the settings starts any source (it first takes you into its place), so you can try the timeline on a 7 s line and on a 50 s text.

What to judge:

- Can you read the card in bright light, and is 3 lines at 16 px too much for the top of the screen?
- Does dragging the play button feel natural, or do you expect it to be only a button?
- Does the greyed preview tell you where you will land before you let go?
- Is the snap a help (long texts) or a surprise (short lines)? Switch "Snap on release" off to compare.
- Is the badge's overlap on the card's corner clear, or does it look like a layout mistake? Without a card the badge floats alone in its place.

## Tester settings

- **Text size:** 14 / 16 / 18 px.
- **Lines at most:** 2 / 3. Three lines are used only while the card fits the top 1/6 of the screen, checked on every resize and setting change; otherwise 2. At 16 px a screen needs about 790 px of height for 3 lines (390x844 shows 3, 390x740 and every phone in landscape show 2).
- **Tap slop:** 6 / 8 / 12 / 16 px. A movement below this counts as a tap, not a drag, on the timeline and in the world.
- **Snap on release:** on / off. Off seeks to exactly where you let go; the preview then marks the word under the finger.
- **Hint appears after:** 60 s without story progress (default) / standing still 8 s in a search step / walking 10 m away from the next place. After a tap on the hint it is not offered again until the next step.
- **Narrated long text:**
  - **words in the card, plate retired (recommended):** the sign in the world shows only its title.
  - **on the plate while legible:** the sign carries the words with the spoken one underlined, and the card says so. The words move back to the card once the sign is out of reach (over 14 m, or more than about 30 degrees off to the side).
- **Hidden item speaks:**
  - **not marked (recommended):** the creator's choice to keep an item off the radar wins, and the subtitle still names it.
  - **marked:** the wedge shows anyway.
- **Measuring hook:** off by default. When on, it reports, once a second, the card's height as a share of the screen (its place is reserved, so it counts while hidden too), with the compass, and the line count. It forces a layout read, which is why it is off.
- **Demo speed:** 1x / 2x / 4x.
- **URL keys:** `?beat=N` starts at beat N, `?speed=`, and every setting by its key and value, for example `?narr=plate&hidden=mark&lines=2&fs=18&measure=true`. Unknown values are ignored.

Creator settings, as on round 3:

- **Compass look:** disc / band, on the tour only, with no visitor override.
- **"Radar at all"** on the tour and each station: switches the whole compass off. The compass then keeps its place, hidden.
- **"On radar"** and **"hints"** on the tour, each station, each story and each item.
- Every switch below the tour starts at "as above" and cycles as above, yes, no; the button shows the resolved value. The nearest level that says something wins: item over story over station over tour.
- In this page the only hint is the way to the next place, so "hints" is read at the tour, the story and the station of the next place; the item level is there for parity with round 3 and changes nothing here.

## Rules the page follows

- The timeline spans only the clip of the item speaking now, never earlier story steps.
- A drag never starts or stops sound. After you let go, the item keeps its state, except that a finished item dragged back becomes paused there.
- A finished item's card stays 7 s, so a visitor can still drag it back, then goes.
- Reach: walking more than 4 m out of a source's place holds it and its card goes. Walking back into the place carries it on. No card outlives its place. A new start drops whatever was held.
- A scripted drag that a person interrupts ends only itself; the person's own drag goes on.
- Rewinding never takes back a seen item or a story step.
- One subtitle source at a time, the same one the compass marks. At most one speaker wedge, shown only while something plays.
- Spoken words exist once: no bubble in the world (except on the plate when that switch is chosen, and then the card does not repeat them).
- No `backdrop-filter`, no thin light strokes. The card text changes only when the page or the spoken word changes; the handle and fill are written only when their value changes.

## What is faked

- **Word timings:** a word lasts 0.11 s + 0.055 s per letter, plus 0.22 s after a comma and 0.38 s after a full stop. Film cues have real cue times, and the words are spread over each cue by the same weights. No audio plays.
- **The AR camera, the town, the characters, the film and the messaging app** are stand-ins.
- **The 60 s hint trigger** is fast-forwarded in beat 9 (a toast says so).

## Unverified, and the values a verdict rests on

- **Sunlight legibility** is the point of the light card and has not been tried outdoors. It needs a phone in the sun.
- **Top block height**, measured in a headless browser at 16 px:
  - 390x844, 3 lines: card 15.5 %, with the compass badge hanging below it 22.6 %.
  - 390x740, 2 lines (3 would not fit): card 14.8 %, with the compass 22.9 %.
  - 844x390, 2 lines: 28 %, so the compass moves beside the card there. The 1/6 budget cannot hold in landscape even at 2 lines.
  - Whether the badge counts toward the limit decides whether this direction passes.
- **The 3-line rule** uses the card's computed height (58 px of borders, padding and timeline, plus the lines) against 1/6 of the screen. A looser budget, or an 18 px text, moves the threshold.
- **Linger (7 s)** after a finished item. Shorter (the earlier 2.5 s) left too little time to reach the handle; much longer leaves a finished card on screen while the visitor has moved on.
- **Reach margin (4 m past the edge of a place).** It keeps GPS jitter at the edge from holding and resuming a voice; a smaller margin would flicker, a larger one lets a card outlive its place by longer.
- **Snap lead (0.25 s).** A lead near 0 would clip the first word; a lead over about 0.6 s would replay the end of the previous sentence and feel like an off-by-one.
- **Snap usefulness.**
  - On a 7 s line with 2 segments the snap hardly matters.
  - On the 50 s sign text, with 8 segments on about 210 px of track, a finger lands within one sentence, and the snap is what makes the result predictable.
  - A narrower track (the band look frees about 90 px; a disc badge takes it) or a much longer text would change this.
- **Tap slop (8 px default).** With 6 px a shaky thumb on the handle may start a drag instead of a pause. With 16 px a short deliberate drag of a sentence on a short line may count as a tap.
- **Compass range (40 m) and wedge width (about 36 degrees).** A narrower wedge would point more precisely but would vanish at the disc's 100 px size.
- **The disc overlapping the card's corner** takes about 94 px off the right end of the timeline in portrait. The band look does not overlap and leaves the timeline its full width.
- **Frame cost.** Per frame the page moves the handle and one segment fill by transform (written only on change) and toggles one class when the spoken word changes. The compass re-renders its small canvas only when something it shows moved. The film texture redraws 4 times a second, the sign plate only when its word changes.
  - **Measured** in a headless browser with software rendering, on a busy shared machine: the page's own JS work averaged 1.5-7 ms a frame. Isolated frames took 80-170 ms, but earlier profiling found such stalls in arithmetic-only functions too, so they were the machine preempting the browser, not the page's work.
  - **Still to verify on a phone** that no frame passes 50 ms. The panel's "Measuring" section shows the average and maximum per frame live.
