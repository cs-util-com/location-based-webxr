# Splat trainer, variant B: the walk as a path

A throwaway prototype of the page that turns a recording zip into a 3D
splat of the place. Linked from nothing in the app and wired to no app
logic: everything on it is simulated.

## What it shows

The page is centred on a large drawing of the recorded walk, cut into
stretches of about 30 m. Each stretch colours in as it trains:

- grey: waiting;
- white (dark theme) or near-black (light theme), dashed and pulsing:
  training, with an orange dot moving along it as it progresses;
- green with a tick: good;
- amber with "!": weak;
- red with a cross: not good enough;
- dotted grey: left out by the user.

Colour never carries the meaning alone: every stretch has a numbered badge
with a symbol, and the panel names the verdict in words.

- **Slim header:** the title, a linear strip of the same stretches (each
  segment clickable), the overall status ("Training: stretch 5 of 12, about
  30 min left"), the one main action, and the census of the recording in a
  row of chips (frames, metres walked, frame spacing, depth, frames
  skipped, places passed twice, time on this computer). "Nothing leaves
  this computer" sits at the end of that row.
- **Side panel:** during training it follows the live stretch (preview,
  progress, time left in the stretch, next preview, up next, "you can leave
  this running"). Pointing at a stretch shows it there; clicking keeps it
  open ("Back to the live stretch" returns). A pinned or hovered stretch
  also draws one dot per photo on the walk, with red rings for photos
  skipped as blurry, so "frames far apart" and "many blurry frames" can be
  seen where they happen.
- **Verdicts:** a weak or not-good-enough stretch carries its verdict as a
  tag on the preview itself and a coloured frame, a plain sentence, the
  reasons and the actions ("Train again with more time", "Save anyway,
  marked", "Discard"). dB numbers sit only under the folded "Numbers".
- **Done:** counts of good, weak and not good enough, a "Needs a look" list
  that jumps to each problem stretch, and "Save package", whose dialog says
  what goes in and that the file shows where it was recorded.

## How to reach each state

The striped bar at the top is the prototype's own control bar, not part of
the design.

- **State** jumps to: start, census, training, a "not good enough"
  stretch, cancelled, resumed, done, and each refusal (phone, no WebGPU,
  integrated graphics warning, old or broken file, no depth data).
- **Speed** runs the scripted simulation at 1x, 10x, 60x (default) or
  240x. A whole walk is about 48 simulated minutes.
- **Pause / Play** freezes the simulation.
- **Theme:** auto, light or dark.
- URL parameters for screenshots: `?state=done&theme=light&pause=1&speed=240`.
- A phone-width window (700 px or less) shows the "Use a desktop computer"
  page by itself, like the real page would on a phone; picking any state
  from the bar shows the desktop page again.

From the start state the page is clickable all the way: "Choose a
recording", "Start training", "Cancel" (with a confirmation), "Resume",
then on a finished stretch "Train again with more time", "Save anyway,
marked", "Discard" / "Put it back", and "Save package".

## What is faked

- The walk is a made-up curve on a plain grid: no map, no real place, no
  recording. The "passed twice" mark is found by the curve crossing itself.
- The census numbers, stretch lengths, timings and every verdict are
  scripted (twelve stretches; 4, 9 and 11 come out weak, 7 not good
  enough; training again improves them by a scripted step).
- The previews are drawn in code from a seeded scene of gradients and
  shapes, shown through blur and noise that shrink every 15 simulated
  seconds; a not-good-enough preview is drawn doubled and smeared.
- Reading the zip, the graphics card check, the time estimate, saving and
  "Copy the link" do nothing real; "Save package" only shows a message.

## What to look at

- Can you tell at a glance, at the end, where along the walk the problems
  are, and what to do about each?
- During training: is it obvious that it is working, which stretch it is
  on, how long is left, and that cancelling keeps the finished stretches?
- Does the census in one row of chips say enough before "Start training",
  or does it need the panel's "Ready to train" text to make sense?
- Weakness of this direction: the drawing needs room. At 1024 px wide the
  walk is smaller and the badges near the crossing crowd each other, and a
  walk that doubles back many times would be harder to read than this one.
