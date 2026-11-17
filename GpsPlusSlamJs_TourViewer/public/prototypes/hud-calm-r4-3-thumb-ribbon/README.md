# Calm HUD 4.3 - Thumb ribbon (throwaway prototype)

## Purpose

One of three directions for the calm AR HUD's subtitles, scrub bar and compass. This one asks: **can the words stand on the camera image without a plate, and can the thumb go back in them as easily as a music app's lyrics?**

- No plate for the words: a short dark shade runs down from the top edge, and the words are white, 16 px by default, with a dark shadow.
- The words sit at the very top edge, as "lyrics": the line being said in the middle at full white, the line before dimmed above, the next dimmed below. Spoken words turn white as they are said.
- Under the words, one bar spans the clip of the item speaking now. The round play/pause button rides on it: a tap is play/pause, a drag is going back (or forward).
- The words themselves can be pulled down to go back; they move the same playhead as the button.
- Under that, the compass in the look the tour's creator chose (band by default, disc as the alternative). A coloured notch above the band marks who speaks; when they are behind you, the band's end carries their colour.
- The hint is an icon at the band's right end (left of the disc in the disc look).

Self-contained page; three.js from a CDN by import map; not wired to the app, linked from nothing in it.

## What to look at

Open it on the phone, then play the ten beats with the arrow buttons at the bottom (or pick one in the menu).

1. Walk up to the beam: the compass alone, nothing at the top.
2. Greta greets you; a friend covers the view for 4 s mid-sentence; a finger drags the button back to the sentence you missed.
3. The words are pulled down by a finger to go back one line and a half.
4. The search: the hint icon appears at the band's end, the drift shows the way; Greta then answers from behind you, and the band's end carries her colour.
5. A video: you turn away, pause, drag back, play.
6. A finished video dragged back stays paused there until you tap.
7. A sound the creator kept off the compass speaks: no mark, the words still name it; then the "mark anyway" switch.
8. A narrated long text: words at the top; then the alternative where the sign carries them while legible, docking to the top when you turn away.
9. Station B: three characters; which one speaks is the notch's colour.
10. The creator's choice: the disc look, with the speaker's circle ringed in her colour.

Things to judge: whether the words are readable on a bright sky without a plate; whether three lines (two in landscape) are calm enough; whether the button reads as both play/pause and a handle; whether pulling the words is found without being told.

## Tester settings

In the menu (or by URL: `?fs=16&lines=auto&slop=8&back=scrim&trigger=progress&narr=hud&hidden=hide&look=band`):

- Text size 14 / 16 / 18 px.
- Lines auto / 2 / 3 (auto: 3 upright, 2 in landscape).
- Tap slop 6 / 8 / 12 / 16 px: how far a finger may move on the button and still be a tap.
- Behind the words: shade (the design) or plate (for comparison in sun only).
- When the hint is offered: 60 s without story progress (default), 8 s standing still while searching, or 10 m walked away from the place being searched.
- Narrated long text: words at the top (recommended) or on the sign while legible.
- A hidden item speaks: no mark (recommended) or mark anyway.
- Author settings: compass on or off per tour and station; items on the compass and hints per tour, station, story and item, the nearest level winning; the compass look (band or disc) on the tour only.
- Measuring hook (ruler button, off by default; `?measure`): the share of the screen height from the top edge to the foot of the bar while something speaks, the same with the compass, overlaps between HUD parts, and the worst frame of the last 2 s.

Other URL options: `?speed=2` runs the beats faster; `?shots` stops at each beat's marks for screenshots (`window.HC.resume()` continues).

## Single-value choices, and the value that would change them

- **Top block height.** Measured with the hook: at 16 px and 3 lines the words and the bar take 14.0 % of an upright 390x844 screen (18 px and 3 lines about 15 %, 16 px and 2 lines about 11.4 %), under the limit of a sixth (16.7 %). A phone that reserves a status-bar inset at the top (about 24-30 px) would push 16 px and 3 lines to about 17-18 %; there, 2 lines is the setting to use. In landscape (844x390) 2 lines and the bar take 23.6 % of the much shorter height; the limit was set for upright use, and a 1-line landscape mode (about 18 %) would be the value to try if that feels heavy.
- **The compass row does not move** when speech starts or stops: it sits below where the bar would be, so the space under the words is empty while nothing speaks. Moving the compass up to the top edge while nothing speaks would save that space but make it jump twice per sentence; a field test showing the empty band is noticed would change this.
- **The shade's strength** (62 % black at the top, fading out under the bar): chosen for a bright sky. If a dull day shows the shade as a dark bar, about 45 % would be the next value to try.
- **Finished hold, 6 s:** a finished video or sound keeps its words and bar for 6 s so it can still be dragged back. Shorter than about 3 s and the drag is hard to reach; longer than about 10 s and the top stays busy after the thing is over.
- **One line height of drag is one line of text** on the words. A faster ratio (two lines per line height) would make long rewinds shorter but makes the words jump away from the finger.
- **The handle is 40 px with a 44 px row**, the smallest round target that still sits inside a 44 px touch row; a bigger handle would need a taller row and so a taller top block.

## Faked

- Every word's time is invented from its letters (about 150 words a minute, pauses after punctuation); cue start and end times of the video and sound subtitles are fixed by hand. A real tour needs timings from the voice or the subtitle file.
- The camera, the town, GPS, walking and every sound are simulated; nothing plays audio, nothing runs in AR.
- The "friend" in beat 2 is a picture standing in for looking away.

## Unverified

- Readability of the shaded words in real sun on a real phone (the "plate" switch is there for exactly this comparison).
- Whether visitors find the drag on the words without being told; the first-run card says it once.
- Frame time on a real phone. The screenshots ran in a software-rendered headless browser (median 17-50 ms a frame, spikes during page load and screenshots), which says nothing about a phone; the HUD itself writes to the page only when a word, line or handle position changes, and reads layout only after a resize or a setting change.
- Exact text widths: lines are broken by a canvas measurement of the system font, which may differ slightly from the browser's own layout on some phones.
