# Splat trainer, direction A: guided steps

A throwaway prototype of the page that turns a recording into a splat on a
desktop computer. Linked from nothing in the app and not wired to it.

## What it shows

A calm vertical sequence of five steps, like a careful installer. Only the
current step is open; finished steps fold to a one-line summary, and later
steps wait, dimmed.

1. **Choose the recording** - a drop area and a button, plus "what happens
   next" in three lines. Says that nothing is uploaded.
2. **Check it** - the census as facts (photos, metres walked, photo spacing,
   depth data, photos skipped, places passed twice), the training time on
   this computer, the graphics in use, and the walk cut into stretches.
3. **Train** - one large card for the stretch in training: a preview that
   sharpens every 15 s, a progress bar, time left for the stretch and for
   the whole walk, a "working" line that counts up so the page never looks
   frozen, and "Stop training" (asks first, says what is kept). Below it, a
   compact list of all stretches with their verdict chips.
4. **Review the stretches** - a tally, a strip of the walk coloured by
   verdict (good, weak hatched, not good enough cross-hatched, so colour is
   never the only signal), the selected stretch with its sentence, reasons
   and actions, and all stretches as small cards. Continuing is blocked
   until every "not good enough" stretch has a decision.
5. **Save** - what goes into the file, a plain warning that the file shows
   where it was recorded, saving with progress, then where to open it and
   how to delete the training data kept on this computer.

Refusals: a phone (a full-page "Use a desktop computer" card), no WebGPU,
an old recording, a recording without depth data (all in step 1), and
built-in graphics (a warning in step 2 with the Windows setting).

## What is faked

Everything. No file is read, no GPU is used, nothing is saved. The run is a
script: 11 stretches of a 318 m walk with fixed training times and fixed
verdicts (stretches 4 and 9 weak, stretch 7 not good enough). The preview
images are drawn in code from a seed (boxes, round trees, a path) and made
blurry with low resolution, blur and soft blobs; no photo or place is used.
The numbers (scores, sizes, photo counts) are made up.

## How to use it

The "Prototype controls" box (bottom right, not part of the page):

- **Jump to** any state: start, reading, census, built-in graphics warning,
  training, a stretch that is not good enough, stop (asking first), stopped,
  carried on, review, training a stretch again, save, saving, saved, and
  each refusal.
- **Speed**: 1x (real time) to 240x. 60x runs a whole walk in about 40 s.
- **Theme**: follow the system, light or dark.
- **Pause** the simulation.

URL parameters for screenshots: `?state=training&theme=light&speed=60&pause=1&controls=closed`.
A window narrower than 600 px opens on the phone refusal.

## What to look at

- Does the step sequence feel calm and clear, or too slow for a returning
  user?
- During training: is it obvious that it is working, which stretch it is
  on, how long is left, and that stopping keeps finished stretches?
- In review: is it clear where the weak stretches lie along the walk, and
  what can be done about the one that is not good enough?
- Is the privacy warning before saving plain enough?
