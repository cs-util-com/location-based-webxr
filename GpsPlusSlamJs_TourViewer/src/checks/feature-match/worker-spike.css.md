# worker-spike.css

**Purpose:** the few rules of the worker spike page (`?spike=worker`, `worker-spike.ts`) on top of the guided view's screens, bar, card, viewfinder and buttons (`guided-view.css`).

## Invariants

- **Scoped like the guided view.** Every selector starts with `:where(html[data-ui="guided"])`, which adds no specificity; the photo test's other views never see a rule.
- **Before and while running** the page uses the guided run screen as it is: card and buttons beside or above the viewfinder.
- **At the end** (`data-phase` done or failed) the screen is one column at most 720 px wide: the card, then the buttons right under it. The card's row is `minmax(0, auto)`, so a long card scrolls inside itself on a short screen (phone landscape) and the buttons stay on screen.
- **The answers** are rows with a coloured left edge: `--ok` for a yes, `--danger` for a no, the plain line colour when not known.
- **The log** is a `details` closed by default, its summary 44 px high for a thumb; its text wraps and scrolls within half the screen height.

## Tests

Checked by screenshots at 390x844, 844x390 and 1280x800 in the start, running and result states (no horizontal scroll at any of them); the spike tests in `playwright-tests/feature-match-check.spec.js` check the states themselves.
