# Calm HUD 4.3 - Thumb ribbon (throwaway prototype)

## Purpose

One of three directions for the calm AR HUD's subtitles, scrub bar and compass. This one asks: **can the words stand on the camera image without a plate, and can the thumb go back in them as easily as a music app's lyrics?**

- No plate for the words: a short dark shade runs down from the top edge, and the words are white, 16 px by default, with a dark shadow.
- The words sit at the very top edge, as "lyrics": the line being said in the middle at full white, the line before dimmed above, the next dimmed below. Spoken words turn white as they are said.
- Under the words, one bar spans the clip of the item speaking now. The round play/pause button rides on it: a tap is play/pause, a drag is going back (or forward). The button stays play/pause throughout: at the end of anything it plays it again from the start. Moving on to a story's next step is a separate "Next" (or "Done") button at the bar's right end, shown once the step has been heard to its end.
- The bar carries its own dark backing (an 8 px dark track with a white fill and white sentence ticks outlined in dark), so it reads on a bright sky without depending on the shade.
- Every sentence starts with its speaker's name in their colour; a line that continues a sentence starts with the speaker's coloured dot.
- Exit sits alone at the top-left edge; the words are centred in the width that leaves it free.
- While a story step is talking, taps on other things are ignored; once the step is held (paused) or finished, a tap on another item holds the story and plays that item, and a tap on the story's character takes the story up again.
- The words themselves can be pulled down to go back; they move the same playhead as the button.
- Under that, the compass in the look the tour's creator chose (band by default, disc as the alternative). A coloured notch above the band marks who speaks; when they are behind you, the band's end carries their colour.
- The hint is an icon at the band's right end (left of the disc in the disc look).
- In landscape the band shares the bar's row (bar on the left 58 %, band on the right), so nothing crosses the characters in the middle of the view.

Self-contained page; three.js from a CDN by import map; not wired to the app, linked from nothing in it.

## What to look at

Open it on the phone, then play the ten beats with the arrow buttons at the bottom (or pick one in the menu).

1. Walk up to the beam: the compass alone, nothing at the top.
2. Greta greets you; a friend covers the view for 4 s mid-sentence; a finger drags the button back to the sentence you missed.
3. The words are pulled down by a finger to go back one line and a half.
4. The search: the hint icon appears at the band's end, the drift shows the way; you stop about 2 m south of the stone, Greta answers from behind you, and the band's end carries her colour. At the step's end the button turns into "play again" and "Done" appears beside it.
5. A video: you turn away, pause, drag back, play.
6. A finished video dragged back stays paused there until you tap.
7. A sound the creator kept off the compass speaks: no mark, the words still name it; then the "mark anyway" switch.
8. A narrated long text: words at the top; then the alternative where the sign carries them while legible, docking to the top when you turn away.
9. Station B: three characters; which one speaks is the notch's colour.
10. The creator's choice: the disc look, with the speaker's circle ringed in her colour.

Things to judge: whether the words are readable on a bright sky without a plate; whether three lines (two where they do not fit) are calm enough; whether the button reads as both play/pause and a handle; whether "Next" beside the bar is found; whether pulling the words is found without being told.

## Tester settings

In the menu (or by URL: `?fs=16&lines=auto&slop=8&back=scrim&trigger=progress&narr=hud&hidden=hide&look=band`):

- Text size 14 / 16 / 18 px.
- Lines auto / 2 / 3. Auto uses 3 lines only while the words and the bar end within the top sixth of the screen height (measured from the screen's top edge, status bar included), read again on every resize or setting change; otherwise 2, and always 2 in landscape.
- Tap slop 6 / 8 / 12 / 16 px: how far a finger may move on the button and still be a tap.
- Behind the words: shade (the design) or plate (for comparison in sun only).
- When the hint is offered: 60 s without story progress (default), 8 s standing still while searching, or 10 m walked away from the place being searched.
- Narrated long text: words at the top (recommended) or on the sign while legible.
- A hidden item speaks: no mark (recommended) or mark anyway.
- Author settings: compass on or off per tour and station; items on the compass and hints per tour, station, story and item, the nearest level winning; the compass look (band or disc) on the tour only.
- Measuring hook (ruler button, off by default; `?measure`): the share of the screen height from the top edge to the foot of the bar while something speaks, the same with the compass, overlaps between HUD parts, and the worst frame of the last 2 s.

Other URL options: `?speed=2` runs the beats faster; `?shots` stops at each beat's marks for screenshots (`window.HC.resume()` continues).

## Single-value choices, and the value that would change them

- **Top block height.** Measured with the hook at 16 px: 3 lines and the bar take 14.0 % of an upright 390x844 screen and 15.9 % of a 390x740 one, both under the limit of a sixth (16.7 %). In the desktop page's 390x740 phone frame, whose screen starts 12 px lower, 3 lines would end at 17.6 %, so auto drops to 2 lines there (14.6 %). A phone with a larger status-bar inset is handled the same way. In landscape (844x390) 2 lines and the bar take 23.6 % of the much shorter height; the limit was set for upright use, and a 1-line landscape mode (about 18 %) would be the value to try if that feels heavy.
- **The compass row does not move** when speech starts or stops: it sits below where the bar would be, so the space under the words is empty while nothing speaks. Moving the compass up to the top edge while nothing speaks would save that space but make it jump twice per sentence; a field test showing the empty band is noticed would change this.
- **The shade's strength** (62 % black at the top, fading out under the bar): chosen for a bright sky. If a dull day shows the shade as a dark bar, about 45 % would be the next value to try.
- **Finished hold, 6 s:** a finished video or sound keeps its words and bar for 6 s so it can still be dragged back. Shorter than about 3 s and the drag is hard to reach; longer than about 10 s and the top stays busy after the thing is over.
- **One line height of drag is one line of text** on the words. A faster ratio (two lines per line height) would make long rewinds shorter but makes the words jump away from the finger.
- **The track is 8 px with a dark backing**, the sentence ticks 4 x 14 px white with a dark outline, and the dimmed lines 62 % (before) and 74 % (next) opacity. A thinner track or lighter dimming would be calmer on a dull day but disappears against bright sky.
- **A pull on the words must start at least 30 px below the screen's top edge.** A pull starting higher is left alone, because Android may take a swipe down from the top edge as its own (status bar or notification shade); 30 px is an estimate of that zone, not a measurement.
- **The handle is 40 px with a 44 px row**, the smallest round target that still sits inside a 44 px touch row; a bigger handle would need a taller row and so a taller top block.

## Faked

- Every word's time is invented from its letters (about 150 words a minute, pauses after punctuation); cue start and end times of the video and sound subtitles are fixed by hand. A real tour needs timings from the voice or the subtitle file.
- The camera, the town, GPS, walking and every sound are simulated; nothing plays audio, nothing runs in AR.
- The "friend" in beat 2 is a picture standing in for looking away.

## Unverified

- Readability of the shaded words in real sun on a real phone (the "plate" switch is there for exactly this comparison).
- Whether visitors find the drag on the words without being told; the first-run card says it once.
- Frame time on a real phone. The screenshots ran in a software-rendered headless browser (median 17-50 ms a frame, spikes during page load and screenshots), which says nothing about a phone; the HUD itself writes to the page only when a word, line or handle position changes, and reads layout only after a resize or a setting change.
- Whether Android really takes a pull that starts in the top 24-30 px of a full-screen AR page as its swipe down (the reason for the 30 px start rule above).
- Exact text widths: lines are broken by a canvas measurement of the system font, which may differ slightly from the browser's own layout on some phones.
