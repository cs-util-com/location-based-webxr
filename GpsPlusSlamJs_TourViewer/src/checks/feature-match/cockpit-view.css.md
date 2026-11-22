# cockpit-view.css

**Purpose:** the look of the cockpit view of `feature-match-check.html` (`?ui=cockpit`): the prototype's `public/prototypes/feature-match-1-cockpit/cockpit.css`, ported rule for rule, plus the drawer's styles for the measuring block that moves into its Results tab.

## Invariants

- **Scoped to the cockpit view.** Every selector starts with `:where(html[data-ui="cockpit"])`, which adds no specificity: the guided view never sees a rule, and the always-on flat target styles (`flat-style`) still win inside `#flat`.
- **Differences from the prototype, mechanical:** every class and id carries the `c-` prefix of the markup; the tile and ghost images are canvases; the toast that says why a tap ended without a photo, or what became of a pair's zip (`.c-shot-note`), is the build's own.
- **Portrait and landscape.** Below an aspect ratio of 4/5 the dock sits under the viewfinder; from 4/5 on it is a column beside it, `clamp(280px, 36vw, 340px)` wide, as in the prototype.
- **One deliberate fix over the prototype:** a short screen on its side (from 4/5 and at most 560 px high) takes the bottom dock's one-row controls in a wider column (`clamp(340px, 46vw, 400px)`), with a three-line instruction and no change line. The prototype's side dock needs about 550 px for its eight rows and cuts off its readouts, status and footer at 915x412 and 800x360.
- **Night.** `.c-app.night` dims the dock between photo A and B of the dimmed pairs.
- Dark on purpose, as in the prototype: in the light tests the screen itself lights the room.

## Tests

Pinned by the cockpit layout test in `playwright-tests/feature-match-check.spec.js` (positions and gaps at 412x915, 915x412, 800x360 and 880x790, with room for the taller Linux fonts of CI) and checked side by side against the prototype at the same four viewports.
