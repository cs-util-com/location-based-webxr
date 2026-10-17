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
  `{ state, text }`. `state` names the situation: `before-ar`,
  `checking`, `starting`, `stopping`, `unsupported`, `error`, `no-tour`,
  `scan`, `measuring-code`, `code-other-tour`, `code-unusable`,
  `code-moved`, `locking`, `warming-up`, `placing`, `placed`,
  `placed-gps`, `tracking-lost`, `needs-code`, `nothing`. `ar-entry.ts`
  writes it to `#ar-status`'s `data-state` for a visitor (beside
  `data-gate`, the scan gate as one word), the stable channel for styling
  and tests. `text` is the sentence, followed by what could not load;
  `""` before AR (the visitor screen and its button speak there).

## Invariants & assumptions

- The `unsupported` sentence says first that the tour needs an Android
  phone with Chrome (D8 of tour editor plan 2026-10-17-1816: Android-only,
  said plainly, no view without AR), and ends "Copy the link and open it
  in Chrome on an Android phone." - a visitor's button under it is the
  Copy link (polish round M4a, V4). A session the browser refuses
  (`NotSupportedError`) names the same need.
- **Order:** not running (an error maps the framework's message - it keeps
  only `err.message` - to a plain cause: the location permission, the
  camera, an unsupported session, else "Tap Try again"); no tour open;
  PLACED (tracking lost reads the framework's `ar-lost` hint, else placed
  through the code, or by GPS with the reason when one applies); the code
  situations, which only come BEFORE placement (a code of another tour, an
  unusable code, the code being measured, the gate scanning); then what is
  happening (photos loading, tracking warming up, nothing to show, needs
  the code, a moved code, the code found, placing).
- **U1 milestone review fixes (2026-10-06):** a tour with no usable code
  whose photo join declined says "This tour has nothing to show here." (the
  F3 case; the old line derived it inside `arStatusLine`), and after the
  GPS escape it asks for the code ("needs-code") instead of "Placing"
  forever; a passing product code never replaces a placed tour; "Find the
  poster's code to line it up" only after the escape and only until a code
  lock voted (the gate stays "skipped" after a later lock); the unusable
  code mentions the GPS escape only while it is offered; a moved code does
  not hide loading progress; no counter in "Loading the photos…".
- **Never a counter, the mode prefix or a debug number** (property test);
  a running session always says something.
- **Never "scan the code again"** after the code's hold ended; the hold's
  phases read as "placed".
- **The station HUD has its own line** (`#station-line`); this sentence
  does not repeat it.
- **Waiting for tracking and tracking lost are the framework's coaching
  hints** (DEC-H3: shared with the other apps).
- **Unsupported is one sentence**, not the plan's two cases: the page
  cannot tell "not Chrome on Android" from "Android without AR support"
  without a probe it does not have (deviation, plan U1).

- **Codes only, no location (`input.codesOnly`, QR-first M1b-1):** while
  the gate scans the line is "Without location, the tour's printed codes
  place it - any of them will do." (it sits under the scan card's fixed
  title "Scan the code again so the tour can start", so it says what the
  absence of location means rather than a second "scan"; never "Continue
  with GPS only": there is no GPS). A gate waived for any reason but the
  creator's reads `nothing` with the reason (M1b-1 review #2): no
  detector - "This browser can't read the tour's codes, and without
  location nothing can place the tour."; no lockable level - "This tour
  has no printed codes, and without location nothing can place it.";
  levels unavailable - "The tour's code file could not be read, and
  without location nothing can place it." - never a "placed by GPS"
  line, and never a coaching line that waits forever. The pre-AR hint
  (`CODES_ONLY_HINT`, `visitor-screen.ts`) keeps its own wording.

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
