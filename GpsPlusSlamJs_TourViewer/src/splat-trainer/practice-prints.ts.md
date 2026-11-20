# practice-prints.ts

## Purpose

Draws the pictures the practice trainer shows while it "trains": a small
painted scene per stretch (sky, hills, ground, a house, trees, picked by a
seed), seen through soft blobs that sharpen as the run goes on. It lets the
page's developing prints be seen and tested before a real trainer exists.

## Public API

- `clampSharpness(x) -> number` - 0..1, with anything non-finite as 0.
- `drawPracticePrint(canvas, seed, sharpness, ghost, paper)` - paints one
  picture onto `canvas`; `ghost` doubles the scene for a stretch that
  trains badly. Does nothing when the canvas has no 2D context.

## Invariants

- Seeded through the framework's one generator, `mulberry32`
  (`gps-plus-slam-app-framework/utils/mulberry32`).

- Deterministic for a seed: the same stretch looks the same on every run.
- Each seed's scene is drawn once and cached; a missing 2D context gives
  no scene and no error (headless tests).

## Tests

No unit test: the drawing is a look. `fake-trainer.test.ts` checks that
the trainer asks for a picture at each preview time (with a stub in place
of this module); the drawing itself runs in the page's e2e and is checked
side by side with the prototype.
