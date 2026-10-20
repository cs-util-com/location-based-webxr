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
  `unfinished` (the open tour is not finished yet, `tour-unfinished.ts`:
  "This tour is not finished yet." with its contact when it names one,
  said before every other running state), `scan`, `measuring-code`, `code-other-tour`, `code-unusable`,
  `code-moved`, `locking`, `warming-up`, `placing`, `placed`,
  `to-station`, `placed-gps`, `tracking-lost`, `finding-direction`, `needs-code`,
  `nothing`. `ar-entry.ts`
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
  through the code, or by GPS with the reason when one applies; while the
  visitor guide waits for a heading the bare placed line becomes
  "finding-direction" and a GPS placement keeps its reason); the code
  situations, which only come BEFORE placement (a code of another tour, an
  unusable code, the code being measured - the page passes no hint for
  the code the moved-code check ignores, whose veto set its votes back to
  0, but still one for any other code (`ar-entry.ts`; r881 re-review L-F,
  L1) - the gate scanning); then what is
  happening (tracking warming up, nothing to show, needs the code, a
  moved code, the code found, placing).
- **U1 milestone review fixes (2026-10-06):** a tour with no usable code
  whose photo join declined says "This tour has nothing to show here." (the
  F3 case; the old line derived it inside `arStatusLine`), and after the
  GPS escape it asks for the code ("needs-code") instead of "Placing"
  forever; a passing product code never replaces a placed tour; "Find the
  poster's code to line it up" only after the escape and only until a code
  lock voted (the gate stays "skipped" after a later lock); the unusable
  code mentions the GPS escape only while it is offered. (The photos'
  loading progress is gone: the photos decode per station as it shows.)
- **The wait for a heading is said** (D34 of the tour editor plan
  2026-10-17-1816; PR review S6, N8): "Walk a few steps so the guide knows
  the direction." is asked while `stationsAwaitHeading` is true (the guide
  has stations to point at and no heading yet), tracking runs (a report
  exists: not `initializing`, whose coaching says hold steady, and not
  `ar-lost`, whose own hint is the cure) and location is on (never codes
  only, where walking cannot earn a heading - after a veto too). It
  REPLACES only the bare placed line ("Tour placed. Look around.", state
  `finding-direction`); a GPS placement keeps its reason with the request
  in place of "Look around." (state `placed-gps`), and before placement it
  follows whatever the line says (a moved code, the photos loading, the
  coaching), the state unchanged. The code situations come first, without
  it, and so do the dead ends - "nothing" (nothing to show here) and
  "needs-code" (nothing by GPS alone) - which no step can change. It goes
  as soon as the flag clears.
- **Away from every station, the line asks for one**:
  content is drawn per station, so with every piece of it waiting at a
  station the visitor is not at (`awayFromStations`) "Look around." points
  at nothing. The placed line becomes "Walk to a station to see its
  content." (state `to-station`); a GPS placement keeps its reason with
  that request in place of "Look around." (state `placed-gps`). The
  request for a few steps still comes first: walking answers both.
- **A code's trust ended, the line asks for the code again**: an
  odometry-frame change ends the trust of the code that passed the gate
  (`viewer-placement.ts` `endCodeTrust`: its votes name places in the old
  frame); the gate stays passed on the code while `codeLinedUp` is false.
  The placed line, the station request and the request for steps each get
  "Find the poster's code to line it up." after them, the state unchanged,
  until the code's next voted lock. Without location only a code judges
  presence, so the present station has ended (`station-guide.ts`) while
  the visitor may still stand at it: away from every station the line is
  then "Tour placed. Find the poster's code to line it up." (state
  `needs-code`), never "Walk to a station", which no walk can answer.
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

`visitor-status.test.ts` (one case per state, an unfinished tour with and
without a contact, the start-failure causes,
what must never reach a visitor, load notes, the walk request: replacing
only the placed line, after a GPS placement's or a moved code's reason, never
while tracking initializes or without location; away from every station:
the station request, a GPS placement's reason kept, the steps first; a
code's trust ended: the code asked for after each placed line, and alone
without location);
`visitor-status.property.test.ts` (any combination of code, gate,
placement, content, errors, readiness, codes only and the heading wait:
non-empty, no debug words, the walk request once at most, only where
allowed and never beside "Look around."; the station request once at most,
only away from every station, never beside "Look around." or the steps);
`ar-entry.test.ts`
(the measuring hint reaches the line; after a veto the ignored code's
hint is withheld, another code's still shows; the walk line from the
store, not before tracking reports; the station request read from the
side table's `showsAny`, never while a station is present);
`viewer-votes.test.ts` (an odometry-frame change: the line asks for the
code, and is the placed line again after the re-scan, codes only too);
`station-guide.test.ts` (codes only: the frame change ends the code's
station where the visitor stands); `viewer-moved-code.test.ts`
(the veto records the ignored code by its scanned text, the key its
evaluations carry).
