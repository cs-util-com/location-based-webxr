# editor/no-gps-check.ts

## Purpose

What the desktop editor warns about while a tour is marked "This tour needs
no GPS" (QR-first M1b-2, plan `2026-10-14-0445-qr-first-alignment-field-study-plan.md`
§8; tour editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
D9, review 2 #3). Pure and page-free; the page (`edit-main.ts`) shows the
lines under the setting, non-blocking (`status-lines.ts` replaces them only
when their text changes).

## Public API

- `NO_GPS_CODE_REACH_M` (40) - how far a station may be from the nearest
  placing code: `visit-settle.ts` `CODE_EVENT_REACH_M`, the reach a code
  event has for the notes walked from it - the same drift argument, one
  number (DEC-H3).
- `checkNoGps({ stations, levels }): NoGpsCheck`
  - `farFromCodes` - the names of the stations farther than
    `NO_GPS_CODE_REACH_M` (horizontal, `move-with-code.ts` `horizontalM`)
    from every code that can place the tour (`scan-gate.ts`
    `isLockableLevel`: a printed size and a position), and of a station
    with no spot of its own (never reached, D9), in the story's order,
    named as the rail names them (`station-run.ts` `stationTitle`: the
    title, else "Station N").
  - `codesPlace` - whether one of the tour's codes can place it: the
    viewer's own rule, `visitor-screen.ts` `tourCodesUsable`, never a copy
    (root CLAUDE.md DEC-H3).
- `noGpsWarnings(check): string[]` - the plain-word lines:
  - none, when a code can place the tour and every station is near one;
  - "N station(s) is/are farther than 40 m from every printed code: "A",
    "B" and "C". Without location, the position drifts with every metre
    walked from the last code, so visitors may not reach it/them. A code
    near it/them, or asking for location, fixes this.";
  - when no code can place the tour, ONLY "None of this tour's printed
    codes can place it (...), so visitors will be asked for their location
    anyway." - the viewer then does not honour the flag, visitors get GPS,
    and a line about the stations would describe a tour that never runs.
- `NoGpsCheck`.

## Invariants & assumptions

- **Why distance, not a station's code** (tour editor plan D9, D16): a
  station is reached by its radius alone on the phone's best position, and
  carries no code of its own. Without location that position is the
  camera's odometry from the last code, whose drift grows with every metre
  walked; so the one thing worth warning about is a station far from every
  code. This line replaced the per-station lines about code-less stations
  (which quoted the gone "I'm here") and stations on unlockable codes.
- The editor's levels were read whole at the open (`editor-open.ts`: a
  level file that does not read refuses the open), so the viewer's
  "unreadable" case never arises here and is passed as `false`.
- A code without a size or a position places nothing, so it is no anchor
  for the distance either.
- The 40 m is an argued number shared with the settle, not measured for
  this warning; the drift per metre walked was not swept here.
- Names are text, never markup: the page sets them with `textContent`.

## Examples

```ts
const lines = noGpsWarnings(
  checkNoGps({ stations: manifest.stations, levels }),
);
// ['1 station is farther than 40 m from every printed code: "Old well". ...']
```

## Tests

`no-gps-check.test.ts`: the reach is the settle's 40 m; far stations named
in the rail's words (39 m near, 41 m far); only placing codes count; a
station without a spot is named; a level with only a size, only a position,
or neither (and no level) cannot place the tour; a tripwire property test
that `codesPlace` stays wired to `tourCodesUsable` (it compares the
function with the one it calls, so it catches a rewiring, never a wrong
rule); a property that a station is far exactly beyond the reach at any
bearing; the lines for none, one, several (never with "I'm here"), and the
no-code case alone. The page is pinned by `playwright-tests/editor.spec.js`
("the needs-no-GPS setting ...").
