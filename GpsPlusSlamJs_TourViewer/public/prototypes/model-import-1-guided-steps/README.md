# Model import, direction 1: two guided steps

**Liked:** this is the direction the model import builds on. Fixed since
the first version: pictures and shared textures are reused instead of
being encoded once per use, switching models no longer crashes the page,
and "Use the standard" now moves on to the review.

A throwaway UX prototype of what a tour creator meets after dropping a `.glb`
on the editor's asset shelf. It is linked from nothing in the app.

Open `index.html`. The bar on top picks a sample (rock, marble bust, utility
box) or opens your own `.glb`; `?sample=bust` opens one directly.

## The direction

The model gets lighter in at most three short steps, one lever at a time:

1. **The bigger lever first.** The page reads where the file's bytes are and
   says so plainly, e.g. "Pictures are 75 % of this file: start here." The
   pictures step offers the sizes Original, 2048, 1024, 512, 256 and 128 px
   (each button shows its measured size; sizes not smaller than the model's
   largest picture are left out), with the shelf's 1024 marked as suggested,
   plus a WebP switch that shows what it saves.
2. **The other lever.** The shape step has the continuous 1-100 triangle
   control. It updates while dragging, says how much the surface moved, and
   offers to store the points more compactly (8-bit positions), with what
   that saves and how far the points move.
3. **Far away (optional).** How soon detail drops with distance (below).

A review then shows the result and each choice with a Change link; "Use this
version" hands the settings to the caller.

The large readout at the top left always shows the file as it would be
saved, in bytes and as a percentage of the original, with a bar that splits
pictures and shape. Original / Yours sits at the bottom of the view and is
one tap (or the O key) away; it switches what is drawn and never moves the
camera. "Show the triangles" draws both versions in flat light with their
wireframe, so a shape change is visible even on a busy texture.

## Order logic

- The recommended first step is the lever with the larger share of the
  original's bytes (pictures against geometry: `recommendFirst` in
  `size-model.js`). All three samples start with pictures (rock 66 %, bust
  75 %, box 90 %); a model with plain colours and many triangles starts with
  the shape.
- The order is a suggestion, never a gate. Every step chip can be tapped at
  any time, the arrow between the first two chips swaps them, and the advice
  line carries "Start with the shape instead" (or "Swap back").
- Each step has two ways out: "Next" (keep my choice) and "Keep them as they
  are" (reset this step's choices and mark it kept). The distance step's
  second button is "Use the standard". Each of these resets only its own
  step's choices. "Next" goes to the next step still to do, else to the
  review; the distance step always goes on to the review, because it is
  optional and wrapping back to the pictures from there looked like a
  restart.
- The flow state (order, current step, per-step status, choices, the two
  view toggles) lives in a pure reducer, `import-flow.js`, so it can become
  a store slice unchanged. The scene, the helper threads and picture blobs
  stay outside it.

## The distance step

Entering the step remembers the close camera. "Walk away from it" moves the
camera straight back along its view direction (logarithmic, up to 2.5 times
the distance at which the coarsest level takes over), so the author sees the
model at the size a visitor would. The inset "Up close" view keeps drawing
the model from the remembered close camera with the level the visitor at
that distance gets, so the author sees what was dropped and that it does not
show from there. Leaving the step restores the close camera.

"Detail drops" (1-100, continuous, later and sharper to sooner and lighter)
sets the error a phone screen may show, from about 0.13 px to about 8 px
with 1 px at the middle. Each level's largest deviation is measured in a
helper thread, and the switching distance follows from the error, the budget
and a 2000 px phone screen. A strip under the sliders shows every level as a
numbered segment from where it takes over, and a marker for the current
distance; each segment's tooltip gives its triangles, its deviation and its
start distance, and the sentence below names the level a visitor there sees.
This step costs nothing in file size, and the page says so.

### How many levels (`LEVEL_RULE` in `size-model.js`)

The helper measures candidates at halving triangle counts, from the author's
level down to the fewest triangles the simplifier can reach (at least 8).
`chooseLevels` keeps a candidate only when its count drops and its measured
deviation grows by at least 1.4 times the last kept level's: a level whose
error barely grows would take over almost where the previous one does, so it
earns nothing on screen. If that leaves fewer than 6 levels, the growth
factor relaxes to 1.2 and then to any growth; at most 10 levels are kept.
With the standard budget the rock and the bust get 6 levels each; the
utility box gets 3, because its simplifier stops collapsing at about 660
triangles, so the next halving brings no fewer triangles and the model
allows no more.

What would change the outcome: a higher minimum, a lower growth factor or a
maximum below 6 changes the rock's and the bust's counts (how far each is
from flipping was not swept); no value of the minimum or the growth factor
changes the box, only a lower simplifier floor would. The shelf saves two coarser levels
today, so this count is a proposal the shelf would need to adopt.

## Compact points: on when nobody could see it

"Store the points more compactly" (8-bit positions) starts on only when its
measured error is under what anyone could see: at most 1 pixel on a phone
screen (2000 px across the 40 degree view the page uses) from 1 m, the closest a visitor is
assumed to stand (`COMPACT_RULE` in `size-model.js`). The error is measured
on the model's own points when it is opened (`compactPositions`), shown next
to the checkbox, and the checkbox stays. When the rule says off, the page
says so and why.

All three samples start with it off: the rock moves up to 0.48 mm (1.3 px
from 1 m), the bust 1.7 mm (4.6 px) and the box 3.5 mm (9.6 px). The rock
would flip to on with a closest distance above about 1.3 m or a threshold
above 1.3 px; the bust needs 4.6 m or 4.6 px; the box 9.6 m or 9.6 px.

## Fixed after the first look

- **Picture sizes affecting each other, 512 and 256 looking the same, a
  second ear on the neck at 1024.** A changed picture was written into the
  existing three.js texture with a new `Source`. three.js picks the GPU
  texture by a cache key that ignores the source, so the new, smaller
  picture was uploaded into the old picture's GPU texture, whose storage is
  fixed at the old size: the upload failed and only a corner was filled.
  Each change now makes a fresh texture (a clone of the original, keeping
  its colour space, flip, wrapping and UV channel), puts it on every slot
  that used the old one, and disposes the old one. Measured on the bust's
  face and neck against the original (mean absolute RGB difference): 128 px
  4.3, 256 px 3.2, 512 px 2.2, 1024 px 1.3; before the fix every size read
  about 8.1.
- **"Cannot read properties of undefined (reading 'usedTimes')" on a model
  switch after a picture change.** The same reuse: disposing the reused
  texture looked its GPU entry up under the new source, where there was
  none. Fresh textures remove it. A shape change followed by a switch also
  showed "Something went wrong: stopped": the helper threads are stopped on
  every load, and their cancelled jobs are no longer reported as errors.
- **"The shape is not ready yet" after moving a slider while the next
  model opens.** The outgoing model stays on screen until the new one is
  parsed, and its delayed request for the coarser levels went to the new
  model's helper thread, which does not hold its shape. The outgoing model
  is now marked as leaving when a load starts, its pending request is
  cancelled, and it asks the helper threads for nothing more.

## The marble bust's eyes

The bust's eyes collapse at any reduction, so its shape step must be easy to
leave untouched. The flow handles that without special-casing the model:

- pictures come first (75 % of the file), so most of the saving is made
  before the shape is touched at all;
- the shape step always says that small details such as eyes, fingers or
  lettering change first, and how much the whole step can save at most (for
  the bust, about a fifth of the file), so keeping all triangles is an
  informed, cheap choice;
- "Keep the shape as it is" and "Back to all triangles" are one tap, and the
  author may skip the step entirely from the stepper;
- Original / Yours and "Show the triangles" work while zoomed into the face,
  because the camera never moves on a switch.

## The never-list, and how each is avoided

- **A control that jumps in coarse steps or whose change is not visible
  while dragging:** the triangle control is a 1-100 range on its `input`
  event. The progressive simplifier is built once in a helper thread; each
  input only picks a level (`stepsFor` and `levelIndices`) and rewrites the
  index buffer. The slider's low end is the fewest triangles the simplifier
  can reach, so it has no dead range. Falloff and walk-away are continuous
  too.
- **The camera resetting on a switch:** Original / Yours, "Show the
  triangles", picture sizes, WebP and compact points change materials,
  textures or buffers only. The camera moves only in the distance step, on
  the author's own slider, and is put back when the step is left.
- **A frozen page during an optimizer run:** all slow work runs in two
  module workers: simplification with a progress card ("Studying the
  shape", "Ordering the triangles"), measuring the pictures one at a time
  with a count in the pictures step. The original shows and can be turned
  at once; the pictures step works while the shape is prepared.
- **A debug UI with numbers nobody can act on:** each number is tied to a
  decision: the file size (the goal), each size button's bytes (what that
  choice costs), the WebP and compact-points savings, how far the surface
  moved in mm and as a share of the model, and the distance at which each
  level takes over. The small line in the corner is the measuring hook the
  plan asks for, not part of the design.
- **A hidden original:** Original / Yours is a large pill always on the
  view, plus the O key.
- **Forcing an order the model does not suit:** see the order logic and the
  bust above; nothing is locked.
- **`backdrop-filter`, or thin light strokes:** none; solid fills, 2 px
  borders and a light warm theme.

## Files and the module API

- `index.html`: the thin shell (sample bar, file picker, mounts the module,
  exposes the controller as `window.__modelImport`).
- `model-import.js`: the core. `mountModelImport(host, options)` builds the
  view and the panel inside `host` (an element with a size) and loads
  `model-import.css` itself.
  - `options.onAccept(result)`: called on "Use this version". `result.model`
    maps onto the shelf's model settings: `textureMaxSidePx`, `textureType`
    (WebP only), `detailShare` (only below 100 %), `positionBits` and
    `maxPositionError` (only with compact points). `result.lodPixelBudget`
    is new: the error in screen pixels the distance levels may show. It also
    carries `estimatedBytes`, `originalBytes` and the steps' order and
    status.
  - `options.onBack()`: called when the review's Back is used.
  - The controller: `load(blob, label)`, `destroy()`, `getState()` (the
    flow), `getResult()`, `goTo(step)`, `set(name, value)`, `stats()`
    (the measuring hook: live update times, element count, build time, and
    `picturesShown`, the picture setting the view currently draws),
    `view(position, target)` (puts the camera, for repeatable screenshots)
    and `bounds()` (the model's box).
- `import-flow.js`: the pure flow reducer (`initialFlow`, `flowReducer`).
- `size-model.js`: pure byte arithmetic (where a `.glb`'s bytes are, the
  shelf's picture format rule and geometry layout, the switching distance).
- `import-worker.js`: the helper thread (build the progressive simplifier,
  build the distance levels with their errors, encode one picture).
- The simplifier itself is the model detail levels prototype's
  `lod-simplify.js`, imported from `../model-lod-1/`, not a copy.
- `model-marble-bust.glb` and `model-utility-box.glb`: byte-identical
  copies of the optimizer's test samples (git stores them once); the rock
  comes from `../model-lod-1/rock.glb`.

The shelf would call `mountModelImport` with the dropped file's Blob and use
`onAccept`'s settings for its optimizer run.

## What is estimated, honestly

This page is static and cannot import the shelf's TypeScript optimizer, so
the file size is an in-page estimate that follows the shelf's rules: every
picture is really decoded, resized and encoded in the helper (same
qualities, same keep-if-not-smaller rule, PNG kept for alpha and PNG data
maps), so the picture bytes are measured; the geometry bytes are computed
from the shelf's quantized layout (16-bit or 8-bit positions, 8-bit normals,
16-bit texture coordinates, 16-bit indices below 65 535 points) over the
author's level and its coarser levels; the description is the original's
plus a few hundred bytes. That is why the readout is below 100 % before
anything is changed: the shelf always stores the shape compactly. Wired into
the shelf, the readout would use the optimizer's real output instead.

The preview's simplifier is the prototype's, not the shelf's `model-lod.ts`,
so a level here and a level the shelf writes can differ slightly.

Known gap: built into the editor, the page installs the framework's slider
guard (`guardSlidersIn(document)` from `utils/slider-scroll-guard`). This
static page cannot import it, so on a phone a vertical swipe that starts on
a slider moves the slider instead of scrolling the panel.
