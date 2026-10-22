# walk-status-routing.ts

## Purpose

Where the visitor's sentence goes in AR. The prototype has no status line over the camera; each state of
`visitor-status.ts` (still the one source of what is said) is routed to
the coach (the centred card), the scan card, a toast said once, the
peek's code line, or nowhere (the sheet already says it). Pure;
`ar-entry.ts` renders the route.

## Public API

- `walkStatusRouting(status: VisitorStatusParts, scanShown: boolean): StatusRoute`
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
  as before the prototype.
- No placement wait stands over the running walk: once the walk runs the
  sentence itself is a placed one (`ArStatusInput.walkRuns`, read by
  `visitor-status.ts`), so it routes as placed, placed-gps or
  finding-direction, with their toast and request for steps. (An earlier
  routing-only fix hid the wait here instead, which also silenced the
  request for steps and the GPS placement's reason, and left the hidden
  sentence and the live region in the wait.)
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
