# character-views-check.ts

## Purpose

The check page `character-views-check.html`: one tour character (the station-blocks-7 prototype's knight, `public/checks/character-knight.webp`, rendered once from the prototype's own `drawKnight`, frame 0) standing as `character-look.ts` draws him, in a plain daylight scene with the prototype's numbers. Linked from nothing. It exists so the build can be put next to the prototype (`public/prototypes/station-blocks-7-character/`) at the same viewports, and so the layout e2e can measure where his parts land on the page.

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
- `playwright-tests/character-views.spec.js`: the layout at 390x844, 844x390 and 1440x900.
