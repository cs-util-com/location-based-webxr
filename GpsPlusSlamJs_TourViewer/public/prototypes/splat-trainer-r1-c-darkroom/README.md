# Splat trainer, round 1, variant C - darkroom

A throwaway prototype of the page that turns a recording into a splat on a
desktop computer. It is linked from nothing in the app and wired to nothing:
every step is a scripted simulation.

## The direction

The previews are the heroes. The walk is cut into eight stretches, and each
stretch is one large print on a contact sheet. While a stretch trains, its
print develops like a photo in a darkroom: it starts as blank paper, the
picture comes up as soft blobs, and it sharpens with every new look (one
every 15 seconds of training). When a stretch is done, its verdict is
written on the print like a grease-pencil mark: a solid ring and "Good", a
dashed ring and "Weak", or a red ring, hatching and "Not good enough", with
the reasons on the print and the actions under it. The user judges by eye
first; the numbers are one click away, in "Numbers" inside the closer look.

- A quiet bottom bar carries a strip of the walk (one segment per stretch,
  coloured by its verdict), one sentence of status, the time left, and the
  actions (Stop, Continue, Save).
- Before the start, the census is a card of plain sentences above the blank
  contact sheet.
- Clicking a print opens a closer look: the same preview, large, with its
  verdict, reasons, actions, previous and next.

## States and how to reach them

Open the "Prototype" button at the top right. "Jump to" reaches every state;
the same names work as `?state=` in the address. Or click through from the
start: Choose recording, Make the splat, and let the simulation run.

- `start` - the empty contact sheet, which is also the drop area.
- `census` - the census sentences and the start button.
- `census-gpu` - the census with the built-in graphics warning and the
  Windows setting that changes it ("Check again" pretends the setting was
  changed; "Use the built-in graphics anyway" keeps the 5-hour estimate).
- `training` - stretch 3 of 8 developing.
- `poor` - stretch 5 came out not good enough while stretch 6 trains.
- `cancelled` - stopped during stretch 4; three stretches kept.
- `resumed` - continued after the stop.
- `done` - every stretch finished, stretch 5 still to decide.
- `saved` - done and saved.
- `no-webgpu`, `phone`, `old`, `no-depth` - the refusals. A window narrower
  than 700 px opens on the phone refusal.

Other knobs: Speed (1x real time, 10x, 60x default, 240x; `?speed=`), Theme
(system, light, dark; `?theme=`), Pause the clock (`?pause=1`), and Saving
fails, to see the failed save and its retry.

## What is faked

- No file is read: "Choose recording" and a drop both play a 1.5 s reading
  animation and show the same census.
- The census numbers, the stretches, their timings, their verdicts and the
  dB numbers are invented. The verdicts are scripted: stretches 3 and 8 come
  out weak, stretch 5 not good enough. Training again makes a not good enough
  stretch weak and a weak one good.
- The previews are drawn in code: a made-up street with buildings and trees
  per stretch, blurred, desaturated and covered with soft blobs that shrink
  as the stretch sharpens. No real photo, place or map.
- The time left is the sum of the scripted durations, not a measurement.
- Saving and "Copy this page's link" only animate. The graphics check is
  the `census-gpu` state, not a real check.

## What to look at

- Can you tell at a glance which stretches are fine and which are not,
  before reading anything?
- Does the training print feel alive (the percentage, the "new look in"
  count, the pulsing dot), so the page never looks frozen?
- Does the not good enough print look clearly not fine, and are its three
  actions easy to find (the bar also offers "Show stretch 5")?
- Is the stop clear about what is kept and what starts over?
- The phone refusal at phone width.

## Known weaknesses

- With all eight prints and a not good enough caption, 1280 x 800 is
  just enough; 1024 x 768 scrolls under the sticky bar.
- A walk with many more stretches (say 20) would make the sheet long;
  this direction would then need smaller prints or a scrolling strip.
- The mini walk drawing on each print is a decoration-sized hint of where
  the stretch lies, not a map.
