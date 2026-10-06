# visitor-status.ts

## Purpose

The visitor's AR status as ONE plain sentence (UI round 1, U1:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`;
usability review F1, F5, F15). It replaces, for a visitor without
`?debug=1`, the technical line (`arStatusLine` in `tour-flow.ts`: "Visitor
mode - AR running · 412 camera frames · Relocalizing - 2 of 3 vote
batches. Pose error 1.3 px."), which stays for the creator and for a
visitor's `?debug=1`.

## Public API

- `visitorStatus(input: ArStatusInput): VisitorStatus` -
  `{ state, text }`. `state` (`VisitorStatusState`) names the situation:
  `before-ar`, `checking`, `starting`, `stopping`, `unsupported`, `error`,
  `scan`, `measuring-code`, `code-other-tour`, `code-unusable`,
  `code-moved`, `locking`, `warming-up`, `placing`, `placed`, `placed-gps`,
  `nothing`. `ar-entry.ts` writes it to `#ar-status`'s `data-state`, the
  stable channel for styling and tests. `text` is the sentence, followed by
  what could not load; `""` before AR (the visitor screen and its button
  speak there).

## Invariants & assumptions

- **Priority, highest first:** not running (the AR controller's status;
  an error maps the browser's `NotAllowedError` / `NotSupportedError` to a
  plain cause, anything else to "Tap Try again"); the code situations (a
  moved code, a code of another tour, an unusable code, the code being
  measured - the fused pose's hint before its first vote -, the gate
  scanning); then the placement (nothing to place, placing or loading
  photos, placed, placed by GPS, waiting for tracking, the code found and
  the tour not placed yet).
- **Never a counter, the mode prefix or a debug number** (property test);
  a running session always says something.
- **Never "scan the code again"** after the code's hold ended: a visitor
  who walked on is not sent back (review F7).
- **Waiting for tracking is the framework's coaching hint** (DEC-H3: the
  onboarding copy is shared with the other apps); changing its words means
  changing the framework.
- What could not load (skipped content, a photo error, a content error)
  follows the sentence as its own short sentences.

## Examples

```ts
const plain = visitorStatus(input);
el.dataset.state = plain.state; // e.g. "placed"
el.textContent =
  mode === "visitor" && !debug ? plain.text : arStatusLine(input);
```

## Tests

`visitor-status.test.ts` (one case per state, the start-failure causes,
what must never reach a visitor, load notes);
`visitor-status.property.test.ts` (any combination of code, gate,
placement, content and errors: non-empty, no debug words); `ar-entry.test.ts`
(the measuring hint reaches the line).
