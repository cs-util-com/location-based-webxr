# visitor-screen.ts

## Purpose

The visitor's one screen (guided-setup plan DEC-N2, §2.1): shows the
consent copy for a `?qr=` launch, hides the creator's setup, re-words the
AR hint, and owns the LOCATION GATE the AR entry consults before a tap may
start a session.

## Public API

- `wireVisitorScreen({ mode, seams, dom, renderArEntry }): { locationGate }`
  - `dom`: `screen` (hidden for a creator), `more` ("What happens?"
    and the way to make a tour, under the button - hidden for a creator;
    polish round M4a), `measureStep` (step 4, opened
    for a visitor - it is a `<details>` since the flow rework and its
    summary is creator-only, so nothing else could ever open it, and its
    content is the visitor's Start button), `creatorOnly` (hidden for a
    visitor), `arHint` (re-worded for a visitor), `errorBox`.
  - `renderArEntry` is called whenever the gate's state changes so the AR
    button re-labels ("Allow location" / "Start the tour").
- `LocationGate`: `pending()` (a tap should request the location rather
  than start AR), `busy()` (a request is in flight; the button says so),
  `request()` (the location-only tap; resolves the outcome) and
  `codesOnly()` (the next start runs without location - QR-first M1b-1)
  and `recheck()` (read the permission again before a codes-only start,
  M1b-1 review #3: `"granted"` turns codes-only off, so the start uses
  GPS, and the line above the button becomes the granted line
  (`locationRequestNotice("granted").hint`, PR #627 bot review: the
  codes-only line stayed and showed again after AR exit); `"prompt"` - Chrome's reading after a DISMISSED prompt - offers
  the location once more, pending again with the "browser will ask"
  hint; once per page, so a second dismissal starts on codes and never
  loops; `"denied"`/`"unknown"`/a throwing query change nothing).
- Optional dep `needsNoGps(): boolean` (owner decision Q-QF-1, the
  per-tour half; `main.ts`: the open tour's `tour.json` `needsNoGps`):
  read live; while true the gate is never pending, `codesOnly()` is true,
  `recheck()` does nothing, and the line above the button is the plain
  visitor line ("Once AR starts, point your phone at the tour's code (on
  the poster).") - the visitor is never asked for the location.
  `VisitorScreen.tourChanged()` re-renders that line and the button when
  the tour's file settles or the tour closes (`main.ts`, from
  `presentTourInfo`). A tap before the tour's file settled still asks, as
  for any tour. The flag holds only once `codesUsable()` is `true`: a
  flagged tour with no code that can place it asks as any other (the
  file is external data; without the location such a visitor could
  place nothing), and so does one whose levels are unread or failed to
  read (r857 milestone review #4: asking is the safe direction to be
  wrong in). `tourChanged()` also runs when the levels settle
  (`main.ts`, `presentTourLevels`; r857 review #5), so the line follows.
- Optional dep `codesUsable(): boolean | null` (M1b-1 review #2): whether
  the open tour has a code that can place it (`main.ts`: any lockable
  level, `tourCodesUsable`; null while the levels are unknown, false once
  their read failed - those levels never come). `false` means codes alone
  cannot help: a denial keeps the gate pending with the settings copy
  ("Location is needed to place this tour. Allow location for this site
  in your browser settings, then tap again."), and a blocked site's
  codes-only start turns back into a location tap (`pending()` true,
  `codesOnly()` false) once the levels are known. Null and true allow
  the codes-only start; absent reads as null.
- **A denial starts the tour on codes alone (QR-first plan 2026-10-14-0445
  §7 #10, §8 Q-QF-1; M1b-1).** Every request outcome clears the gate; a
  `"denied"` one turns `codesOnly()` on (`codesOnlyAfterRequest`), and a
  site whose permission already reads `"denied"` gets it at once, with no
  location tap. The entry then starts AR with `location: "none"` (no
  permission, no GPS watch), a scanned code places the tour (M1), and the
  line above the button says what that needs: `CODES_ONLY_HINT`, "Scan one
  of the tour's printed codes to start - without location, the codes place
  the tour." A granted permission without a fix ("unavailable": indoors, a
  timeout) keeps GPS on: the session's own watch tolerates a slow fix (M2
  review #1).
- `locationRequestNotice(outcome): { error, hint }` - no outcome is an
  `error` since M1b-1 (a denial is a mode, not a dead end); the `hint`
  replaces the text above the button and says what the next tap does and
  what to do once AR starts: "Location allowed - now tap Start the tour,
  then point your phone at the tour's code (on the poster)." or "No GPS fix yet - that is
  fine outdoors ... Tap Start the tour." (UI round 1, U1, review F11: the
  second tap used to be silent, and the benign no-fix note read as a red
  alert). The visitor hint names "the tour's code (on the poster)", not
  "the printed code you scanned" (a link-opener scanned none, review F15).
- `type LocationRequestOutcome = "granted" | "denied" | "unavailable"`.
- `tourCodesUsable(levels, unreadable): boolean | null` - pure: the
  page's `codesUsable` answer. `unreadable` (the levels' read failed,
  `ctx.levelsUnreadable`) is false; unread levels are null; otherwise
  whether a level is lockable (`isLockableLevel`).
- `locationTapNeeded(permission): boolean` - pure: true while the browser
  may still ask (`"prompt"`, and `"unknown"` - no permissions API); a grant
  and, since M1b-1, a denial need no location tap.
- `type LocationPermission = "granted" | "prompt" | "denied" | "unknown"`.

## Invariants & assumptions

- **Why the gate exists:** a WebXR session needs a user activation, and the
  framework's `enable()` awaits the geolocation prompt before `initAR`; a
  visitor answering the prompt spends the activation. Requesting the
  location on its own tap first makes `enable()`'s request resolve without
  a prompt.
- Pessimistic until `seams.queryGeolocationPermission()` answers: a tap
  that arrives first requests the location (harmless), never starts AR.
- No request outcome keeps the gate pending since M1b-1; a denial turns
  the codes-only mode on instead - except on a tour whose codes cannot
  place it (`codesUsable() === false`), where the denial copy stays. One request runs at a time (`busy`).
- In creator mode the gate is never pending and nothing is hidden.
- The visitor's hint is ONE line under V4's round button (polish round
  M4a): "Once AR starts, point your phone at the tour's code (on the
  poster)." - the full instructions are behind "What happens?". Once the
  permission query answers `"prompt"` (the browser WILL ask) it becomes
  "Your browser will ask for your location - tap Allow. Then Start the
  tour."; a `"denied"` site, and a request DENIED at the tap, get the
  codes-only line instead (the browser will not ask again - M4 review #3).
- Every line an answer writes (a request's outcome, a re-offer, the
  denial on a tour no code can place) becomes the permission's line, so a
  later `tourChanged()` - every manifest settle - keeps it (r857 review
  #2: it used to bring "your browser will ask" back after the answer).
  One exception: the codes line (`CODES_ONLY_HINT`, from a blocked site or
  a denial) gives way to the plain visitor line once `codesUsable()` reads
  `false` (the levels landed with no usable code, or their read failed),
  because the button is a location tap again then (PR #621/#623 reviews).
- A tap BEFORE the levels land on a blocked site starts codes-only even on
  a tour with no usable code (unknown counts as yes); the in-AR line then
  says nothing can place it (`visitor-status.ts`). Chosen over waiting for
  the levels (PR #621 review): a denied visitor gets no GPS either way, and
  a wait would hold the start of every tour whose codes do work.
- `tourChanged()` clears no error: every tour open empties the error box
  first (`archive-open.ts` `openTour`), and `codesUsable() === false`
  never turns back within one tour, so a denial error cannot go stale.

## Examples

```ts
const visitor = wireVisitorScreen({
  mode,
  seams,
  dom,
  renderArEntry: () => hooks.renderArEntry(),
});
// in ar-entry: if (locationGate.pending()) { await locationGate.request(); return; }
```

- **The intro asks the visitor to keep the code in view while moving
  slowly** (plan §67 #4). Not because the gate needs angles - it needs 5
  views that fit within 1.5 px, and a wall code held still can settle -
  but because views from different angles resolve the code's tilt (plan
  §16 #1). An angular-diversity gate from b7 would make it a requirement.

## Tests

`visitor-screen.test.ts` - the pure rule (property over the four states),
creator mode leaves everything visible with the gate cleared, visitor mode
hides the setup and clears the gate on a granted query, and the
prompt → refused → granted sequence with the error text; the line an
answer wrote surviving `tourChanged()` (r857 review #2); the `needsNoGps`
flag holding only with `codesUsable() === true` and `tourCodesUsable`'s
four cases (r857 review #4); the rendered codes line giving way once the
codes are known unusable, on a blocked site and after a denial (PR
#621/#623 reviews); the recheck (granted turns codes-only off and writes
the granted line, PR #627; a dismissed prompt offered once more).
