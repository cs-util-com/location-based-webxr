# Model import 3 - Protect what matters

Throwaway UX prototype for the Tour Viewer's model import (the asset shelf's
"make this model lighter" step). Linked from nothing in the app; nothing is
saved. `index.html` is a small shell with three samples (a rock, a marble
bust, a utility box) and "Open your own .glb"; `?sample=rock|bust|box` picks
one. The module itself is what the shelf would import.

## The direction

The author says what must stay sharp, and the reduction spends its triangles
there. They paint over the parts visitors look at closely (a face, the eyes,
lettering) with "Mark sharp"; the shape slider then takes triangles from
everywhere else first. Everything else is the same quiet workshop: one file
size readout at the top, numbered cards (1. What must stay sharp, 2. Shape
detail, 3. Pictures, 4. From afar, optional) and one amber accent for the
marks, the chosen option and "Use this version".

- **Compare without losing the view.** A three-way switch under the model,
  "Original | Mine | Mine, no marks", each with its size. The third option
  appears once something is marked, so the author sees the same file size
  with and without their marks. The `O` key toggles the original. The camera
  never moves for any of this: not on a slider change, not on a switch, not
  when the far preview opens.
- **Marks are visible and undoable.** Amber paint on the model (Show marks),
  Undo last mark, Clear marks, Unmark to erase. "Marked parts" and
  "Everything else" bars under the slider say how much of each is kept.
- **From afar.** Three presets (Sharp from afar, Balanced, Detail up close
  only) set how soon lighter copies take over. A visitor figure walks away
  along a strip, and a small inset renders what that visitor's phone shows at
  life size, so the choice is judged by eye rather than by a number.

### How it differs from directions 1 and 2

- Direction 1 (guided steps) walks the author through pictures, shape and
  distance in turn; the reduction is uniform. Direction 2 (one bench) puts
  every control on one dense surface. This one adds a single new idea, the
  author's marks, and keeps the rest calm and close to direction 1's visual
  language (solid fills, restrained colour, one accent).

## Never-list, and how this page keeps it

- **The view never jumps.** No action moves the camera; the far preview is a
  separate inset, not a camera move.
- **The original is never more than one tap away**, with its size.
- **Work never freezes the page.** Welding, ordering and picture encoding run
  in Workers; a progress bar names what is happening; the slider stays live
  on the unprotected ordering until the protected one is ready.
- **The author's marks are never lost silently.** They are document state
  (strokes of dabs in the reducer) with undo; changing strength, slider or
  pictures keeps them; only loading another model starts afresh.
- **A size is never shown as more exact than it is.** Picture bytes are
  measured (real re-encodes with the shelf's rules), shape bytes are counted;
  a step still encoding says "measuring".
- **The result is never bigger than the original**: a re-encode that is not
  smaller keeps the original bytes, and a version above 90 % of the original
  keeps the original.

## Is marking feasible? Yes - so no fallback was needed

The brief asked for a fallback if marking proved infeasible. It did not: on
the bust, marking both eyes with two dabs (brush 0.04 of the diagonal, an
area of 1 156 of 17 456 triangles) keeps far more of them at every share.
Measured as triangles of the marked area kept by the protected ordering
against the same share with no marks (headless Chromium, software GL):

| share | Gentle (3) | Strong (10, default) | Hold (40) | no marks |
| ----- | ---------- | -------------------- | --------- | -------- |
| 75 %  | 792        | 1 014                | 1 148     | 469      |
| 50 %  | 518        | 730                  | 1 020     | 192      |
| 25 %  | 289        | 485                  | 752       | 78       |
| 10 %  | 118        | 234                  | 442       | 23       |
| 5 %   | 56         | 119                  | 227       | 16       |

- Without marks the eyes lose triangles **faster** than the model as a whole
  (78 of 1 156, 7 %, at a 25 % share): their small dense triangles are exactly
  what a geometric simplifier removes first. That is the case for marking.
- The rest pays: at 25 %, Strong keeps 3 869 of 16 300 elsewhere (23.7 %)
  against 4 276 (26.2 %) without marks; Hold 3 602 (22.1 %).
- A larger brush (0.08, 1 811 triangles marked) at 25 % keeps 825 against 193.
- Before/after pictures at 25 % with and without marks, textured and with
  the triangles shown, are in the shot folder of the build notes; at 25 % the
  unmarked eyelids smear, the marked ones keep their edge.

## Time per live update

A slider step swaps one index list over one welded vertex buffer per part
(no new geometry). Swept 200 steps (100 % to 1 % and back), headless on a
heavily loaded machine:

- rock: median 2.6 ms; box: median 1.3 ms; bust: median 6.4 ms unprotected,
  3.3 ms protected.
- Worst frames 130-233 ms on every sample. They sit inside building the
  level's index list (up to 172 ms of a frame), so they are allocation or
  garbage collection, or CPU contention on the loaded machine; a few are
  "show" switches. Measure again on a quiet phone before reading them as a
  property of the method.
- Ordering (once per model, in a Worker): rock 2.3 s, box 0.25 s, bust
  0.7-2.3 s unprotected; the protected ordering of the bust 1.2-2.3 s after
  each change of marks (debounced 250 ms, latest wins).

## Module API

`protect.js` exports `mountModelProtect(host, { onAccept, onBack, workerBase })`
(it loads `protect.css` itself) and returns a controller:

- `load(source, name)` - a URL, Blob or ArrayBuffer of a `.glb`; each model
  gets fresh Workers, so nothing of a previous model can answer into it.
- `dispatch(action)`, `getState()`, `subscribe(fn)` - the pure reducer in
  `protect-state.js` (`share`, `pictureStep`, `toggle`, `show`, `tool`,
  `brush`, `strength`, `preset`, `visitor`, `strokeStart`, `dab`, `undo`,
  `clear`, `reset`), ready to become an editor store slice.
- `settings()` - what `onAccept` receives, the shelf's ModelSettings:
  `textureMaxSidePx`, `distanceBudgetPx`, `textureType: "image/webp"` when
  WebP is on, `detailShare` below 100, `positionBits: 8` and
  `maxPositionError` with compact points, plus
  `protect: { strength, parts: [{ mesh, part, vertexWeights, dabs }] }` where
  `vertexWeights` is a Float32Array over the original vertices (0 to 1).
- `metrics()`, `setView(position, target)`, `markAt(point, erase)`,
  `pointAt(x, y)`, `destroy()` - for tests and measurement.

How the protection works: no change to `../model-lod-1/lod-simplify.js`. A
protected part passes one extra generalised-quadric attribute (strength times
weight, times position and UV) to `buildProgressive`, so inside a mark every
change costs about (1 + k squared) times as much, and a collapse across the
mark's edge pays for the jump. A flat marked area with no picture detail can
still lose triangles, because removing them changes nothing visible.

## Parameters, and what I would try next

- **Strength** (`STRENGTHS` in `protect-mask.js`): Gentle 3, Strong 10,
  Hold 40. Try 20 between Strong and Hold. The table above is the sweep; the
  conclusion (marks keep the area far better) holds across all three; what
  would change it is a model whose marked area is flat, where k barely matters.
- **Brush** `DEFAULT_BRUSH` 0.04 of the diagonal (0.01 to 0.15), inner
  `FULL_INSIDE` 0.6 fully marked with a soft edge, `FACING_MIN` -0.2 so paint
  does not go through to the back. Try 0.06 as a default for faces; a brush
  much larger than the feature turns protection into a uniform reduction.
- **Region counting**: a triangle counts as marked when its corners' mean
  weight is at least 0.5; 0.25 would count the soft edge too and lower the
  kept shares a little.
- **Distance presets** (`DISTANCE_PRESETS` in `protect-sizes.js`): an error
  budget of 0.5, 1 or 3 phone pixels, levels at the author's share and 1/4 and
  1/16 of it, error measured with 2 000 surface samples, the phone taken as
  2 400 px over 60 degrees. Try a 1.5 px Balanced; a phone with a narrower
  view or more pixels moves every switch distance outward.
- **Pictures**: steps Original, 2048, 1024 (default), 512, 256, 128; JPEG
  0.85 for colour, 0.92 for data maps, PNG kept for alpha.

## Files

- `index.html` - the shell (samples, open your own, the accept dialog).
- `protect.js`, `protect.css` - the module.
- `protect-state.js` - the reducer; `protect-mask.js` - brush and weights;
  `protect-sizes.js` - sizes, picture steps, distance presets.
- `simplify-worker.js` - weld, order, measure; `picture-worker.js` - picture
  re-encoding.
- `model-marble-bust.glb`, `model-utility-box.glb` - copies of the shelf's
  test fixtures; the rock is `../model-lod-1/rock.glb`.
