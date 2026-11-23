# guided-view.css

**Purpose:** the look of the guided view of `feature-match-check.html`: the chosen prototype's `public/prototypes/feature-match-3-scenes-guided/style.css`, ported rule for rule, plus the measure sheet's styles for the measuring block that moves into it and a short block of the build's own rules at the end.

## Invariants

- **Scoped to the guided view.** Every selector starts with `:where(html[data-ui="guided"])`, which adds no specificity: the cockpit view (`?ui=cockpit`) never sees a rule, and the always-on flat target styles still win inside `#flat`.
- **Mechanical differences from the prototype:** ids carry the `g-` prefix of the markup; thumbs and the ghost are canvases (`.th canvas`); `#guided` takes no box (`display: contents`), so each screen fills the viewport as the prototype's did as a child of `body`; the page's `body > .layout`, which holds the shared Options, Speed test and Results until the view moves them into its measure sheet, is hidden.
- **The shared `design.css` is undone where it leaks.** The page loads it for the shared Options, Speed test and Results; its rules sit in layers and lose to every rule here, but they still set what the prototype leaves at the browser default on class names both use (`.hint`, `.legend`, `.sheet`, `.progress`, `.badge`, `h1`, `h2`): its uppercase pill badge would turn the strip's "0 of 4" into "0 OF 4" on a raised chip. The build-only block resets those properties.
- **The diagram above the steps.** The build's diagram shows both photos of a pair (three times wider than tall); beside the steps it would shrink to a strip, so it stands above them, up to 240 px wide. Upright this makes the card about 130 px taller than the prototype's and the viewfinder that much shorter.
- **The card fits a phone on its side.** Below 520 px of height the diagram is hidden (as in the prototype), and the new-scene banner keeps only its title (its text restates the first step) and the side note goes, so the first shot's steps fit at 915x412 (the prototype's card overflows there). Below 400 px (800x360, a common phone on its side) the new-scene banner goes as well (the header names the scene), and the strip, thumbs, card padding and action bar (52 px instead of 60) tighten. Measured with the first shot: the card ends 30 px above the action bar at 915x412 and 40 px at 800x360, room for other fonts to wrap a line more. A longer card (a retake or a light warning banner) scrolls inside the card as the last resort.
- **The measure sheet** (`.measure`) styles the moved Options, Speed test and Results in the dark scheme.
- Dark on purpose, as in the prototype: in the light tests the screen itself lights the room.

## Tests

Pinned by the guided layout tests in `playwright-tests/feature-match-check.spec.js` (edges, gaps, the big button's height and the card fitting at 412x915, 915x412, 800x360 and 880x790) and checked side by side against the prototype at the same viewports.
