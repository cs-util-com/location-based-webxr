# guided-view.css

**Purpose:** the look of the guided view of `feature-match-check.html`: the prototype's `public/prototypes/feature-match-2-guided/style.css`, ported rule for rule, plus the measure sheet's styles for the measuring block that moves into it.

## Invariants

- **Scoped to the guided view.** Every selector starts with `:where(html[data-ui="guided"])`, which adds no specificity: the cockpit view (`?ui=cockpit`) never sees a rule, and the always-on flat target styles (`.flat button` and friends in the page's `flat-style`) still win inside `#flat` over the guided `button`, `.secondary` and `.row`.
- **Differences from the prototype, all mechanical:** ids carry the `g-` prefix of the markup; the review, slot and ghost images are canvases (`.review canvas`, `.slot canvas`, and `.finder > canvas` so the review canvases are not laid over the finder); the keyframes are named `g-pop` and `g-flash`; `#guided` takes no box (`display: contents`), so each screen fills the viewport as the prototype's did as a child of `body`; the four-step layout (`body > h1`, `.intro`, `.layout`) is hidden.
- **Lower-case state attributes.** The view writes `data-shot`, `data-part` and `data-slot` as `a` / `b` (the prototype used `A` / `B`), so the selectors match lower case; the layout test checks the step chip is coloured.
- **The shared `design.css` is undone where it leaks.** The page loads it for the four-step view; its rules sit in layers and lose to every rule here, but they still set what the prototype leaves at the browser default on class names both use (`.hint`, `.legend`, `.sheet`, `.progress`, `h1`, `h2`). A block near the top resets those properties; the view's own rules after it set them again where they mean to.
- **The measure sheet** (`.measure`) styles the moved Options, Speed test and Results in the dark scheme: details, fieldsets, labels, number inputs and selects, the unclassed buttons, the results table, the result pictures, the report and log boxes and the light warning.
- **One deliberate fix over the prototype:** in landscape below 560 px of height the diagram is hidden, the card body never shrinks under its content and the card scrolls as the last resort, so the foot lines never lie over the sequence (the prototype's card overflows at 915x412). The card is about the viewport height less 180 px and the diagram up to 150 px tall, which puts the line at 560; the same screens also get tighter card and sequence spacing, because the step text wraps by the platform font (on the CI Linux fonts the foot lines ended 9 px below the card at 915x412 without it; on Windows 21 px inside). Swept at widths 740, 915 and 1280 and heights 412-700: no card scrolls; at 915x412 the foot lines end 46 px inside the card on Windows.
- Dark on purpose, as in the prototype: in the light tests the screen itself lights the room.

## Tests

Pinned by the guided layout test in `playwright-tests/feature-match-check.spec.js` (positions and gaps at 412x915, 915x412 and 880x790) and checked side by side against the prototype at the same three viewports.
