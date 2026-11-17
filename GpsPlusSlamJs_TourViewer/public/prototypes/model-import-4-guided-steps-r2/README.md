# Model import, direction 1, round 2: two guided steps

The second round of [direction 1](../model-import-1-guided-steps/README.md)
("make a 3D model lighter" as two guided steps plus an optional far-away
step). Everything that README says still holds unless this one says
otherwise; the first round stays as it was, so the two can be opened side by
side. The bust and box samples are loaded from the first round's folder
instead of being copied.

## What changed, and why

- **Picture sizes: every power of two below the original, down to 128 px.**
  - Round 1 offered a fixed list. Now the list is built from the model's own
    pictures (`textureSteps` in `size-model.js`): the bust and the box
    (2048 px pictures) offer 1024, 512, 256 and 128; the rock (1024 px)
    offers 512, 256 and 128.
  - The Original button names its size ("1024 px"), so the step from it to
    the first smaller size is visible as a halving, not a jump.
  - A size is made only when the author chooses it. Sizes not made yet show
    an estimate ("about 136 KB") scaled from the nearest size already
    measured; measured halvings kept 0.29 to 0.49 of the bytes, so the
    estimate uses side^1.5, not the area. The size being made says
    "making..." and the step shows "Making the 512 px pictures: n of N
    done...".
  - Measured here (JPEG / WebP): rock original 446 / 384 KB, 512 px
    174 / 148, 256 px 52 / 47, 128 px 16 / 15; bust original 1.23 / 1.14 MB,
    1024 px 606 / 468 KB, 512 px 186 / 151. Each size took 15 to 450 ms.
- **WebP on from the start**, and the "for newer browsers" wording is gone:
  Chrome on Android and every current desktop browser read it. If a browser
  cannot encode WebP, the switch turns itself off and says so.
- **The shape step gets a frame rate and a load test.**
  - A live "N frames a second (slowest X ms)" line, counted over half-second
    windows of the page's own frame loop.
  - "Load test" draws the model many times as one instanced mesh (100,
    1 000 or 3 000 copies; 1 000 is preselected), so the effect of fewer
    triangles on drawing speed becomes visible on the device itself. It is
    one checkbox, off by default, and switches itself off when the author
    leaves the shape step or the graphics context is lost.
  - The copies follow the Original / Yours switch, so the two can be
    compared under load.
- **The order advice is a quiet sentence, not a green box.** It now says
  what it means: "Pictures are 66 % of this file, the larger part, so the
  steps start there", with the swap as a small link. Round 1's "Start here"
  read like an instruction about something else on the page.
- **Fewer buttons.** Removed: "Keep them as they are" (pictures), "Keep the
  shape as it is", "Back to all triangles", and the line "The shape is now
  at N % of your file". Each step has only "Next"; going back to the
  original means moving the control back to its end (Original, 100 %).
- **The "Detail drops" slider runs the same way as the strip below it**:
  "Sooner, lighter" on the left, "Later, sharper" on the right. The stored
  value keeps its meaning (higher is sooner); only the slider is mirrored.
- **Unchanged on purpose:** the far-away step and the last step.

## Load test, measured on a laptop GPU

Intel Iris Xe, a canvas of about 1060 x 848, median frames a second. "q" is
the share of triangles kept.

- Rock (9 932 triangles), q 100 %: no copies 56; 100 copies 47; 1 000
  copies 21 (9.9 M triangles); 3 000 copies 7.5 (29.8 M).
- Rock, q 25 %: 52 / 56 / 50 / 21; q 5 %: about 55 throughout.
- Bust, q 100 %: 54 / 56 / 10.5 (17.5 M) / 3.7 (52.4 M); q 25 %:
  56 / 57 / 33 / 13; q 5 %: about 57 throughout.
- Box, q 100 %: 55 / 54 / 40 / 15; q 25 % and q 5 %: 56 to 58 throughout.

At 1 000 copies the difference between all triangles and a quarter of them
is two to three times the frame rate on this machine; a phone should show it
at fewer copies. A headless browser in its old mode reports 60 frames a
second whatever it draws, so measure in a real browser.

## Files

As in round 1 (`index.html`, `model-import.js`, `model-import.css`,
`import-flow.js`, `import-worker.js`, `size-model.js`). The module API adds
`loadTest(on, count)` to the controller, and `stats()` reports `fps` and
`loadTest`.
