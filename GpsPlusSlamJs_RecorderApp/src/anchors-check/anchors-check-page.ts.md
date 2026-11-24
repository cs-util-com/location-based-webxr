# `anchors-check-page.ts`

## Purpose

The DOM side of `ar-anchors-check.html`: builds the view the session module
talks to (status line, start button, event list, counts) and wires the start
and "Copy log" buttons.

## Public API

- `createAnchorsCheckPage({ document, copyText })` returns `{ view,
overlayRoot, connect(controller) }`; `connect` returns `{ copy() }` (the
  copy promise, for tests).
- `COPY_LABELS` (`Copy log`, `Copying...`, `Log copied`),
  `COPY_FAILED_ADVICE`.

## Invariants

- "Copy log" runs through the framework's `copyWithFeedback`: busy and
  disabled at once, `Log copied` after a resolved write, back to `Copy log`
  after a failed or missing one (async-UI rule). On failure the status line
  says so and the log appears in `#ac-log` to copy by hand.
- The start button is disabled while checking, unavailable or starting.
- `beforexrselect` is prevented on the panel, so a button tap during AR is
  not also a placement.
- A missing element id throws at load, naming the id.
- The counts line and every list line come from `anchor-jump-report.ts` (`countsLine`, `onScreenLine`); the page adds no wording of its own.

## Tests

`anchors-check-page.test.ts` (jsdom, the real markup): the overlay root holds
the panel, `beforexrselect` is prevented, start states, the error tone, the
event list, copy success, copy failure and no clipboard.
