# character-views-check.ts

## Purpose

The check page `character-views-check.html`: one tour character (the station-blocks-7 prototype's knight; his figure is the knight's frames sheet `public/checks/character-knight-sheet.webp` (2048 x 1024, WebP at quality 0.85): the prototype's own procedural `drawKnight` (`public/prototypes/station-blocks-7-character/index.html`, the code from `const FW = 512` to `function silhouette`) drawn into four 512 x 1024 cells as its frames 0, 2, 1, 3 - idle, talk-a (half open), talk-b (open), beckon - because the prototype numbers its mouth frames the other way round (its 1 is open, its 2 half). One change to that code: the prototype's half-open frame also raises his sword arm, so its arm branch (`} else if (half) {`) is skipped and talk-a keeps the idle arm - a frames sheet's talking cells differ from idle in the head alone. Re-rendered 2026-10-29 for that: below the head band (rows 340 to 1023 of each cell) cells 0 to 2 now share one alpha mask at every alpha threshold tried (0, 16, 128, 250), where the earlier sheet's cell 1 differed from idle by about 4 100 pixels. Rendered once in a headless Chromium (Playwright) with `canvas.toDataURL("image/webp", 0.85)`; to re-render, run that code in a page the same way. It replaced `character-knight.webp` (frame 0 alone)), loaded with `sheet: true` so his mouth moves while he speaks and he beckons with his arm, standing as `character-look.ts` draws him, in a plain daylight scene with the prototype's numbers. Linked from nothing. It exists so the build can be put next to the prototype (`public/prototypes/station-blocks-7-character/`) at the same viewports, and so the layout e2e can measure where his parts land on the page.

## Public API

- `startCharacterViewsCheck(host)`: builds the scene in `host` and installs `window.__characterViewsCheck`.
  - Without `?hook=1`: a demo with a bar to switch the view.
  - With `?hook=1`: no bar; the caller drives everything.
- The hook (`CharacterViewsCheck`):
  - `show({view, name?, line?, heightM?})`: stands him in a world view, made afresh. A view outside `TOUR_CHARACTER_VIEWS` (the framework's) throws a `TypeError`.
  - `standAt(x, z)`, `lookAt(x, y, z)`: the visitor's eye (1.6 m) and gaze; non-finite numbers throw.
  - `setVoice(voice)`, `setBeckon(beckon | true | null)` (`true` is the page's second station, the prototype's "East road").
  - `settle()`: one frame with every ease snapped.
  - `state()`: the look's `state()` plus `parts` (each part's projected box in page px, or null when not drawn) and `head` (0.86 of his height on the page).
  - `stop()`: ends the frame loop.
- `CHECK_CHARACTER`, `CHECK_EYE_M`, `checkFovDeg(w, h)`: the prototype's numbers.

## Invariants

- The scene matches the prototype: background and fog `0xe4e9ee` (70-240 m), eye 1.6 m, the short side of the screen sees 40 degrees, station 1's figure at (-3.2, -4.5), 1.85 m tall, seen from the prototype's `viewpointFor(0)`.
- The prototype's surroundings (walls, the paving, the second station's props) are not copied: the check is about the character's parts.
- A part's box is null when it or an ancestor is hidden, or when a corner is behind the camera.

## Tests

- `character-views-check.test.ts`: the field-of-view rule and the viewpoint.
- `playwright-tests/character-views.spec.js`: the layout at 390x844, 844x390 and 1440x900, including the beckon frame and its mirror (the figure's box the same in every pose), the mouth and the read-along while he speaks, and the bubble view's still mouth.
