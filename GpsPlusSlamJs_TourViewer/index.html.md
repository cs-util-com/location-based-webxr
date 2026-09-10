# index.html

## Purpose

Two pages in one file (guided-setup plan DEC-N1, 2026-09-08): the plain
page is the CREATOR'S guided setup, a `?qr=` launch is the VISITOR'S
screen. Everything marked `.creator-only` is hidden for a visitor
(`visitor-screen.ts`); `#visitor-screen` is hidden for a creator.

- The setup (`#wizard`, `wizard.ts`): collapsible steps, one open at a
  time, each with an `<h2>` inside its summary (valid markup; how a
  screen reader exposes it through the disclosure is a field-test item)
  and an inline SVG icon; the reached step and the last opened link are
  remembered per device (M6). 1 Host (`#step-host`: the starter zip button, the paste-a-link
  form), 2 Print (`#print-panel`, the print section
  of the flows plan M3, plus the "open as a visitor" link), 3 Hang
  (`#step-hang`, the "It hangs - continue" button), 4 Measure and place
  (`#step-measure`, a plain section wrapping `#ar-root`), 5 Download the
  rebuilt zip (`#step-finish`, live in M3), 6 Replace the hosted zip
  (`#step-replace`, provider copy).
- The visitor screen (`#visitor-screen`): the consent copy above the AR
  section; the Start button is `#enter-ar`.
- Below the steps, creator-only: the Storage section (`#storage-panel`, a
  transport-demo control; inside a collapsed step it would be hidden).
- Shared: `#error`, `#ar-root` (the DOM-overlay root: hint, status line,
  button, the setup panel `#setup-panel` with `setup-status`, `setup-mint`
  the placement controls `setup-pin` / `pin-label` / `pin-save` /
  `pin-cancel` / `setup-photo`, and `setup-finish`; the visitor's
  `scan-escape`),
  `#stats`, `#gallery`. Step 5 holds `finish-status`
  and `finish-download`.

Behaviour lives in the wiring modules composed by `src/main.ts` (see
`main.ts.md`); the page carries only structure and its inline CSS
(alpha-hex borders - the stylelint csstree validator predates `color-mix()`).

## Public API

The `data-testid` contract the e2e suite drives: `wizard`, `step-host`,
`starter-zip`, `link-input`, `open-button`, `storage-panel`,
`clear-cache`, `print-panel` (owns `print-url`, `author-size`, `author-c`,
`print-generate`, `print-info`, `print-canvas`, `print-button`,
`print-url-out`, `visitor-link`), `step-hang`, `hang-done`,
`step-measure`, `step-finish`, `step-replace`, `visitor-screen`, `stats`,
`error`, `gallery`, `ar-hint`, `ar-status`, `enter-ar`, `setup-panel`,
`setup-status`, `setup-mint`, `setup-pin`, `pin-label`, `pin-save`,
`pin-cancel`, `setup-photo`, `setup-finish`, `scan-escape`,
`finish-status`,
`finish-download`.
Renaming one is an e2e-breaking change. `#ar-hint`, `#ar-status`,
`#enter-ar` and `#setup-panel` must stay children of `#ar-root` (WebXR
DOM overlay composites only that subtree; enforced by
`tests/repo-config/hud-overlay-nesting.test.js`). The `#ar-hint` copy is
the creator's; `visitor-screen.ts` re-words it for a visitor.

## Invariants & assumptions

- `#error` carries `role="alert"` — failures must be announced, not just
  colored.
- `#stats` starts `hidden` and is revealed by the first stats render; the
  `[hidden]{display:none}` rule keeps the attribute authoritative over the
  grid/flex display values.
- The gallery is a `<ul>` of `<li><img><figcaption>` items appended in
  archive order as bytes arrive.

## Tests

Driven by `playwright-tests/*.spec.js`; the no-console-errors smoke boots
exactly this page.
