# walk-status-routing.ts

## Purpose

Where the visitor's sentence goes in AR (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M2, §1.4). W4 has no status line over the camera; each state of
`visitor-status.ts` (still the one source of what is said) is routed to
the coach (the centred card), the scan card, a toast said once, the
peek's code line, or nowhere (the sheet already says it). Pure;
`ar-entry.ts` renders the route.

## Public API

- `walkStatusRouting(status: VisitorStatusParts, scanShown: boolean, walkShown = false): StatusRoute`
  - `coach: { text, look: "spinner" | "sway" | "plain" } | null`;
  - `scanCard: "scan" | "found" | null`;
  - `toasts: string[]` - news, each to be said once per AR entry;
  - `codeTail: boolean` - the peek asks for the code
    ("Find the poster's code to line it up.").
- `interface StatusRoute` (its coach look a module-local `CoachLook`).

## Invariants & assumptions

- The route table is a `Record<VisitorStatusState, ...>`: a state added
  to the sentence fails to compile until it is routed here.
- Routes:
  - page (before-ar, checking, unsupported, error): nothing in AR;
  - spinner (starting, stopping, placing) and sway (warming-up,
    tracking-lost): the coach with that look;
  - plain (no-tour, unfinished, nothing, finding-direction) and code
    (scan, measuring-code, code-other-tour, code-unusable, when no card
    shows): the coach in plain words, "find the code" moved to the peek;
  - found (locking): the scan card in its found look;
  - news (code-moved, placed-gps): a toast (a GPS placement's first
    sentence, its reason clause kept), plus the coach's request for steps
    when the sentence carries it;
  - walk (placed, to-station, needs-code): nothing; the sheet speaks.
- While the scan card shows (`scanShown`), it carries the whole sentence,
  as before W4.
- Once the walk's sheet shows (`walkShown`), a placement wait (placing,
  locking) routes nowhere: a tour whose stations hold only stories places
  no content, so `contentStatus` never reads "placed" and the sentence
  stays in its wait while the guide already walks the visitor. Without
  this the found card (or the placing coach) would stand over the walk
  for good. The scan card still wins over it (`scanShown` first).
- The sentence's notes (what could not load) are toasts on every route.
- `#ar-status` keeps the whole sentence (`data-state`, the tests) and
  `#ar-status-live` keeps announcing it, whatever the route.

## Examples

```ts
const parts = visitorStatusParts(input);
const route = walkStatusRouting(parts, scanCardShown(...));
route.coach; // { text: "Starting AR…", look: "spinner" }
```

## Tests

- `walk-status-routing.test.ts` - every state of `VISITOR_STATUS_STATES`
  routed (an enumeration), the coach looks, the scan card's two looks,
  the GPS news and its reason clause, the code line, notes as toasts,
  a placement wait giving way to the shown walk.
- `ar-entry.test.ts` ("the walk's surfaces in AR") - the route rendered.
