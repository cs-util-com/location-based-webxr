# index.html

## Purpose

Two pages in one file (guided-setup plan DEC-N1, 2026-09-08): the plain
page is the CREATOR'S guided setup, a `?qr=` launch is the VISITOR'S
screen. Everything marked `.creator-only` is hidden for a visitor
(`visitor-screen.ts`); `#visitor-screen` is hidden for a creator.

- The setup (`wizard.ts`): collapsible steps, one open at a time, each
  with an `<h2>` inside its summary (valid markup; how a screen reader
  exposes it through the disclosure is a field-test item) and an inline
  SVG icon; the reached step and the last opened link are remembered per
  device (M6). **FOUR steps since the flow rework** (second testing
  session, F10 - it was six):
  1. **Host** (`#step-host`): three numbered sub-steps - get a zip (the
     optional starter-zip button), upload it, then paste and **test** the
     link (`#open-form`, whose button reads "Test link", F6).
  2. **Print** (`#print-panel`): the printed code, on the page and as a
     PDF of N numbered posters (`#print-count`, `#print-paper`,
     `#print-pdf`) - the print dialog's "fit to page" silently rescales,
     and a rescaled code measures the world wrong. The link is SHOWN
     (`#print-url-shown`), not asked for, whenever a tour is open, and the
     code renders without a button press; `#print-url-ask` returns only
     when nothing is open, which is what keeps printing before hosting
     possible (F7 + flows plan DEC-F2).
  3. **Hang** (`#step-hang`): the "It hangs - continue" button.
  4. **Measure and place** (`#step-measure`): a `<details>` like its
     siblings since F4, wrapping `#ar-root`. It also carries what used to
     be steps 5 and 6 - `#finish-block` (the rebuilt zip's status and
     download) and `#replace-help` inside it - because those describe the
     END of this step rather than steps of their own (F10). And
     `#tour-missing`, the form that asks for the tour link on a device
     that does not have it (F12).
- The visitor screen (`#visitor-screen`): the consent copy above the AR
  section; the Start button is `#enter-ar`.
- Below the steps, creator-only: the Storage section (`#storage-panel`,
  summary "Other settings" - something you normally do not open, F9).
- Shared: `#error`, `#ar-root` (the DOM-overlay root: hint, status line,
  button, the setup panel `#setup-panel` with `setup-status` and, inside
  `#setup-controls`, `setup-mint`, the placement controls `setup-pin` /
  `pin-label` / `pin-save` / `pin-cancel` / `setup-photo`, and
  `setup-finish`; the visitor's `scan-escape`), `#stats`, `#gallery`.

Behaviour lives in the wiring modules composed by `src/main.ts` (see
`main.ts.md`); the page carries only structure and its inline CSS
(alpha-hex borders - the stylelint csstree validator predates
`color-mix()`).

## Public API

The `data-testid` contract the e2e suite drives: `wizard`, `step-host`,
`starter-zip`, `link-input`, `open-button`, `storage-panel`,
`clear-cache`, `print-panel` (owns `print-url-ask`, `print-url`,
`print-url-shown`, `author-size`, `author-c`, `print-generate`,
`print-info`, `print-canvas`, `print-button`, `print-url-out`,
`print-count`, `print-paper`, `print-pdf`, `visitor-link`), `step-hang`, `hang-done`, `step-measure` (owns
`tour-missing`, `tour-missing-link`, `tour-missing-open`, `finish-block`,
`finish-status`, `finish-download`, `replace-help`), `visitor-screen`,
`stats`, `error`, `gallery`, `ar-hint`, `ar-status`, `enter-ar`,
`setup-panel`, `setup-status`, `setup-controls`, `setup-mint`,
`setup-pin`, `pin-label`, `pin-save`, `pin-cancel`, `setup-photo`,
`setup-finish`, `scan-escape`.
Renaming one is an e2e-breaking change. `#ar-hint`, `#ar-status`,
`#enter-ar` and `#setup-panel` must stay children of `#ar-root` (WebXR
DOM overlay composites only that subtree; enforced by
`tests/repo-config/hud-overlay-nesting.test.js`). The `#ar-hint` copy is
the creator's; `visitor-screen.ts` re-words it for a visitor.

## Invariants & assumptions

- **Step 4 must never be collapsed while an AR session runs.** Its content
  is `#ar-root`, the DOM-overlay root, and a collapsed `<details>` renders
  nothing - so a collapse mid-session blanks the overlay, on a phone,
  where no test can see it. Two halves hold it: this file hides the
  summary under `body[data-ar-active="true"]` (which also removes it from
  the tab order and the accessibility tree, so neither a tap nor Enter can
  reach it), and `wizard.ts` refuses to assign `open = false` on it. The
  CSS alone is NOT enough - `open` is assigned from script in several
  places, and a `Ctrl+P` used to reach one of them.
- **`#step-measure` is `overflow: visible`**, deliberately and against the
  shared `.step` atom, which clips. Whether the overlay root's top-layer
  promotion escapes an ancestor's clip is not something any test here can
  answer.
- `#error` carries `role="alert"` — failures must be announced, not just
  colored.
- `#stats` starts `hidden` and is revealed by the first stats render; the
  `[hidden]{display:none}` rule keeps the attribute authoritative over the
  grid/flex display values.
- `#finish-block` is authored `hidden` and is NOT `.creator-only`: the
  class would un-hide it on a creator's load, and it must appear only once
  a finish has produced a zip. `#tour-missing` is the opposite - it IS
  `.creator-only` (a visitor never pastes a link) and is authored hidden
  like every creator-only section, so a visitor cannot see it flash.
- `#author-size`'s `value` attribute must equal `AUTHOR_DEFAULT_SIZE_M`,
  which `creator-setup.ts` writes into the field on every load. A
  differing attribute is dead text that reads like a decision
  (`src/printed-size-default.test.ts`).
- The gallery is a `<ul>` of `<li><img><figcaption>` items appended in
  archive order as bytes arrive.

## Tests

Driven by `playwright-tests/*.spec.js`; the no-console-errors smoke boots
exactly this page. `src/printed-size-default.test.ts` reads this file for
the size default.
