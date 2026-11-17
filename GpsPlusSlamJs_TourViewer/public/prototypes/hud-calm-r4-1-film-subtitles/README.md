# Calm HUD, round 4, direction 1: film subtitles

A throwaway UX prototype for the Tour Viewer's walking HUD. It is a
standalone page, not wired into the app, and linked from nothing in the
app. Open `index.html` directly (a dev server may answer the folder URL
with the app itself).

## Purpose

Round 4 asks how the words of whatever is speaking (a character in a
story, a video, a sound, a text read aloud) reach a person who is walking
with a phone held up, without a second place to read them. This direction
answers it like film subtitles:

- **A dark, solid plate across the full top width.** It carries the words
  as roll-up captions: 3 lines upright, 2 on its side. The word being
  spoken is white; the rest sit at 50 % white. Each line starts with a
  dot in the speaker's colour and the speaker's first name.
- **The exit** sits at the plate's left end and is the only x-in-a-circle
  on the screen. The plate's right end holds one small control at a time:
  **the "show the way" hint** (only when offered), **Next** when a step
  has finished, or **Leave**, a worded pill that ends the story, so a tap
  meant to close never ends a story by mistake.
- **A thin scrub bar along the plate's lower edge**, spanning one clip
  only (one story step, one video, one sound, one read-aloud text). Its
  44 px handle is both the play/pause button and the drag thumb. Its
  centre travels from 66 px off the left edge to 44 px off the right edge
  (plus the safe-area insets), and the bar's ends are exactly that travel,
  so at the end of a clip the thumb stays out of the edge-swipe zone. A drag is
  free in both directions and never starts or stops sound; a finished
  clip dragged back stays paused until a tap.
- **The compass** sits below the plate's right end. Its look is the tour
  creator's choice (a tour setting): the disc by default, or a band. The
  one voice speaking now has a mark in its colour with a breathing ring;
  there is never more than one speaker mark. Nothing floats over the
  speaking character by default (`bubble=dots` or `bubble=words` brings
  the old bubble back for comparison), so the caption's dot and the
  compass mark are the only "who speaks" signs.
- **No card outlives its place.** A story paused by a tap, a drag or
  another source is put away when you walk out of its station, exactly
  like one that was playing; a tap on its character carries it on.

## What to look at

Use the beat list (menu button, bottom right), or `<` and `>`:

1. Walk up to the beam - the plate is only the exit while nothing plays.
2. Greta greets once - roll-up, the bright word, the dot and name.
3. Follow the story to the stone - the plate while a step waits for you.
4. Covered for 4 s, then drag back - the scripted finger rewinds the step;
   the shot is taken mid-drag, then the words catch up.
5. Look around - grey marks are things already seen.
6. Video: turn away, pause, rewind.
7. A finished video dragged back - it stays paused there until a tap.
8. Off the radar, still speaking - an item the creator kept off the
   compass speaks: by default it gets no mark.
9. Station B: a voice from behind - the speaker mark moves to the voice
   behind you.
10. A text read aloud - first "top line only", then "on the sign".
11. Lost in a story - "show the way" appears at the plate's right end,
    by the trigger chosen in the settings.

On a phone, also try: a real drag of the handle with a thumb, a tap that
moves a few pixels (the tap slop), the plate on its side, and the plate
with 18 px text.

## Tester settings (on the page, also as URL parameters)

- **Text size** 14 / 16 / 18 px (`fs`, default 16).
- **Lines** auto (3 upright, 2 on its side; upright drops to 2 when 3
  would make the top block taller than 1/6 of the screen) / 2 / 3
  (`lines`). A fixed choice is the tester's and may pass the budget; the
  measuring hook then says OVER.
- **Tap slop** 6 / 8 / 12 / 16 px a press may move and still be a tap
  (`slop`, default 8).
- **Speaker name** at each sentence or once per turn (`name`).
- **Show the way when**: 60 s without progress / still 8 s in a search /
  10 m away from the place (`hintBy`, with `idle`, `stillHint`, `away`).
- **Read-aloud text**: top line only (default) or on the sign while it is
  legible (`narr=hud|sign`).
- **Hidden item speaks**: no mark (default) or a mark while it speaks
  (`hidden=none|mark`).
- **Compass look**: disc or band, in the author panel as the tour's
  setting.
- **The author panel**: radar at all / on the radar / hints, per tour,
  station, story and item, each "as above" by default.
- **The measuring hook** (`?measure`, or the target button in the
  bottom bar): the top block's height against 1/6 of the screen, how far the compass reaches,
  overlaps among the controls, the number of speaker marks and the worst
  frame of the last 2 s. Off by default.
- Further URL knobs: `linger` (s a finished video keeps its plate, 8),
  `roll` (s per roll-up step, 0.28), `dim` (the words not being said,
  as a share of white, 0.5), `bubble` (off / dots / words, off),
  `speed` (demo speed).

## What is faked

- **Word timings.** There is no audio. Each spoken line's words get times
  from their letter counts; video and sound subtitles share their cue's
  span the same way. The page says so in its demo panel.
- The town, the people, the videos and the sounds are placeholders drawn
  in three.js 0.185.1; nothing is real recorded content.
- Walking, turning and the finger are scripted in the beats; outside the
  beats, WASD or the arrow keys walk.
- The pose is perfect: no GPS noise, no tracking loss.

## What is unverified

- **Frame times on a phone.** Headless runs use a software renderer and
  read 100-1000 ms frames, which say nothing. The per-frame work was kept
  light by construction (layout is read only on a resize or a setting
  change; captions re-render only on a line change; the sign redraws only
  on a word change; the video screen redraws 8 times a second), but no
  phone has measured it.
- **Legibility in sunlight** of the 50 % words on the dark plate.
- **Thumb reach** of the handle on a large phone held in one hand.
- **The top block** measured 14.5 % of a 390x844 screen with a clip
  showing (budget 16.7 %). At 18 px text with 3 lines it is closer to the
  budget. On a shorter screen "auto" drops to 2 lines (the desktop
  frame, 740 px tall, measured 18.1 % with 3 lines before that rule).
- **On its side** the top block is 100 px of a 390 px screen (25.6 %).
  The 1/6 budget is set for upright use, so this is within the rules,
  but a quarter of a landscape view is a lot; whether 2 lines or 1 is
  right on its side is open.

## Choices that rest on one value

- **3 lines upright.** At 18 px text a 4th line would break the 1/6
  budget; 2 lines would lose the line before the spoken one, which is
  what lets a glance catch up.
- **50 % for the other words.** The spoken word is white, so at 60 %
  (the first version) it stood out mostly by its position; at 50 % it
  stands out in the screenshots while the line before it still reads.
  Around 35-40 % the earlier line stops being readable at a glance in
  daylight; at 60 % and above the spoken word needs its weight or colour
  changed to stand out. Try `?dim=0.6` and `?dim=0.4`; both ends are
  guesses until a phone test.
- **Tap slop 8 px.** At 6 px a walking thumb turns many taps into tiny
  drags (which seek but do not pause); at 16 px a short deliberate nudge
  of the handle reads as a tap.
- **Linger 8 s** for a finished video. Shorter and a person turning back
  to it finds no plate to drag; longer and the plate shows a clip nobody
  is watching any more.
- **Band span 90 degrees** either side of ahead. At 60 a voice beside you
  sits at the band's end, hollow; at 180 the band compresses ahead too
  much to point at anything.
- **Arrive 4 m** at a story step's place. At 2 m GPS-scale noise would
  keep a person "not there yet" while standing at the place.
