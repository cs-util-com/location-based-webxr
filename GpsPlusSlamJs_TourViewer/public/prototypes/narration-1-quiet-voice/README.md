# Narration prototype 1: the quiet voice

**Direction.** The voice is a gentle extra and never the headline: the text is
what the visitor meets, and the voice waits behind one small speaker mark until
it is asked for. There is one surface at a time (the caption strip is the folded
reading sheet), it owns the voice, and every audio problem is one calm line
where the controls were.

Open `index.html` directly (no build). The strip at the bottom with the dashed
magenta border is the prototype's own debug control, not part of the design.

## What it optimises for

- A street: nothing makes sound, nothing flashes, nothing asks for attention.
  Sound only ever follows a tap on a play button. Tapping the sign, a sentence,
  the progress bar or "Full text" never starts it.
- Readers first: the text is never covered by voice controls. The footer is
  one row of about 52 px, and before the first play it is only
  `[play] Listen · 4 min`.
- One thumb: on an upright phone, play, back 10 s, speed, the fold toggle and
  the strip's close button all sit in the bottom third. The controls row is the
  SAME element in the strip and in the sheet, so play stays under the thumb
  when the strip unfolds.
- Honest failure: a missing or slow file never touches the text and never
  shows an error. The sign quietly loses its speaker mark once the file is
  known to be missing.

## What it gives up

- **A visitor who wanted to listen first may not notice the voice.** The only
  trace of it in the world is a 15 px speaker mark next to "4 min" on the sign.
  "4 min" can be read as reading time. Reading view never says "Listen" before
  the sheet is open. This is the direction's real cost and I did not soften it.
- **Reading view cannot listen while looking around.** The sheet owns the
  voice, so closing it pauses the voice. A visitor who wants the voice with the
  square in view must switch to Captions (the view switch at the top left).
  That switch is the only bridge, and it is easy to miss.
- In Captions view the visitor gets two taps before sound (the sign, then
  play), because opening the strip never starts the voice.
- The playback speed lives only in the sheet. A Captions listener has to
  unfold the strip to change it.

## The four questions

### 1. Discovering the voice in the world

- **Reading view:** the sign shows the place, the title, "Tap to open" and, on
  the right, a small amber speaker mark with the voice length (`[spk] 4 min`).
  Without a voice (or once the file is known to be missing) the same corner
  reads `3 min read`. There is no "Listen or read" line and no animation.
- **Captions view:** the same plain sign stands in the world. Captions are
  chosen with the view switch, which is what says "Captions". A tap on the sign
  opens the strip paused: the first sentence is shown dimmed, with a play
  button.
- Inside the sheet the header meta line repeats it once:
  `659 words · about 3 min to read · [spk] 4 min voice`.

### 2. The strip and the sheet together

- **The strip folds into the sheet.** "Full text" (bottom right of the strip)
  grows the strip into the sheet. The controls row stays at the bottom, and
  the voice and the reading mark carry on without a gap. In the sheet the same
  spot holds "Captions v", which folds it back. The header's chevron does the
  same.
- **Playback on close:**
  - Reading view: closing the sheet (X) pauses the voice. The sign is
    unchanged, and reopening the sheet scrolls back to the held sentence.
  - Captions view: folding the sheet back into the strip keeps the voice going.
    Closing the strip (its X) pauses it.
  - Leaving the station circle pauses and closes the surface. The walk card
    adds "your place in the text is kept".
  - Switching from Captions to Reading while the strip is open unfolds it into
    the sheet. Playback continues.
- A tap on a sentence moves the voice there and keeps playing if it was
  playing. While paused, it only moves the held mark, and sound never starts.
- "Back to the voice" appears when the visitor scrolls away while the voice
  plays.

### 3. Audio states (debug strip: audio, do)

Every state is either one calm line in the controls row or nothing at all.
Where the play button can still help, it stays. Where it cannot, the whole row
becomes the line.

- **Loading on play:** the play button turns into a small ring at once. After
  0.5 s the row reads "Getting the voice ready". Tapping the ring cancels, and
  **a cancelled wait never starts sound later**.
- **Buffering mid-play** (in the slow scenario, once after about 14 s): the
  ring, "Waiting for the voice", and the reading mark holds still.
- **Never arrives:** after 12 s of waiting the row becomes "The voice is slow
  to arrive here. Try again". Because the attempt was abandoned, sound cannot
  start minutes after the tap.
- **Missing file:** whether the file exists is checked (a few bytes) when the
  surface opens, so the visitor never taps a dead button. The row becomes
  "No voice here right now. The whole text is here to read. Try again".
  - The reading mark disappears: it is plain reading.
  - The sign's speaker mark turns into "3 min read".
  - In the strip, "Full text" turns amber as the way on.
  - No error, no code, no red.
- **The voice reaches the end:** play becomes a replay icon, the row reads
  "The voice has finished.", and the last sentence stays softly marked. A
  replay starts from the top.
- **Phone locked / page hidden:** the voice **keeps going** (a pocketed phone
  is the normal way to listen to a guide). The lock screen shows the title,
  "Old market square · Station 1", a progress bar, back 10 s and play/pause, and
  nothing else (no skip). On return the sheet scrolls to the voice. The page
  carries the real `navigator.mediaSession` wiring the app would use: metadata,
  play, pause, seekbackward and position state.
- **Phone call:** the voice pauses when the phone rings, and it **never
  resumes by itself**. After the call the row reads "Paused for your call"
  next to the play button. Play goes on from 2 s before the interruption.

### 4. A playback-rate control

Needed, but kept quiet: a small `1x` chip in the sheet footer, shown only
after the voice has been started. It cycles 1x, 1.25x, 1.5x and 0.75x. The
choice is kept on the phone (browser storage, wrapped in try/catch) and applies
in the strip too. There is no chip in the strip itself, because the strip has
no room for it without crowding the thumb row.

## Simulation notes

- A fake clock with a plausible word timing drives the reading mark (659
  words, about 4 min). There is no audio. The debug strip's `speaker:` readout
  stands in for sound.
- The debug controls are:
  - view: reading, captions;
  - audio scenario: normal, slow loading (6 s to start plus one mid-play
    stall), slow and gives up, missing file;
  - do: voice ends (jumps to 7 s before the end), phone locked (a simulated
    lock screen), call (a simulated call);
  - place: at station, walking;
  - frame: fill, upright 390x844, sideways 844x390 (orientation hints);
  - reset.
- The AR chrome (the Exit X, the view-switch pill and the walk card) is a
  static mock-up. Exit does nothing.
- The page has no `<input type="range">`.
- `window.__narrationProto` exposes `state()`, `open()` and `debug(cmd)` for
  screenshot scripts.
- Reference for the visual language:
  `../station-blocks-1-narrated-text/index.html`.
