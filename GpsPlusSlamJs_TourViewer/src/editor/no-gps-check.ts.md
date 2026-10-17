# editor/no-gps-check.ts

## Purpose

What the desktop editor warns about while a tour is marked "This tour needs
no GPS" (QR-first M1b-2; owner decisions Q-QF-1 and "code-less stations
without location", plan `2026-10-14-0445-qr-first-alignment-field-study-plan.md`
§8). Pure and page-free; the page (`edit-main.ts`) shows the lines under the
setting, non-blocking (`status-lines.ts` replaces them only when their text
changes).

## Public API

- `checkNoGps({ stations, levels }): NoGpsCheck`
  - `codeless` - the names of the stations whose anchor has no printed code
    (`anchor.code` absent), in the story's order, named as the rail names
    them (`station-run.ts` `stationTitle`: the title, else "Station N").
  - `unlockable` (M1b-2 milestone review #2) - the names of the stations on
    a code the viewer can never lock: the tour does not carry that code, or
    its level has no `physicalSizeM`. Same naming and order.
  - `codesPlace` - whether one of the tour's codes can place it: the
    viewer's own rule, `visitor-screen.ts` `tourCodesUsable` (a level with
    `physicalSizeM` and `geo`, `scan-gate.ts` `isLockableLevel`), never a
    copy (root CLAUDE.md DEC-H3).
- `noGpsWarnings(check): string[]` - the plain-word lines:
  - none, when every station has a usable code and a code can place the
    tour;
  - "N station(s) has/have no printed code: "A", "B" and "C". Without
    location, visitors reach it/them only by tapping "I'm here - play the
    story" once they stand there.";
  - "N station(s) is/are on a printed code the viewer cannot use (it has no
    printed size, or is not in this tour): "A". Without location, visitors
    can only skip it/them." - never the "I'm here" words, which the viewer
    does not offer for a station with a code;
  - when no code can place the tour, ONLY "None of this tour's printed
    codes can place it (...), so visitors will be asked for their location
    anyway." - the viewer then does not honour the flag, visitors get GPS,
    and a line about the other stations would describe a tour that never
    runs.
- `NoGpsCheck`.

## Invariants & assumptions

- The editor's levels were read whole at the open (`editor-open.ts`: a
  level file that does not read refuses the open), so the viewer's
  "unreadable" case never arises here and is passed as `false`.
- **Why a station on a size-less or missing code is unreachable without
  location** (read from the viewer's code, 2026-10-15): the tracker blocks
  the solve when a level has no size (`qr-tracking-controller.ts`, the
  size gate; the Tour Viewer passes no `resolveSizeM`); a station with a
  code is found only when that code locks (`station-run.ts` `codeLocked`);
  and "I'm here" is refused for a station with a code (`station-guide.ts`
  `hereOffered`). Only the skip remains.
- **A code with a size and no position still locks** and finds its
  station, so `unlockable` is "absent from the levels, or no size" - not
  `isLockableLevel`, which is about whether the codes can PLACE the tour.
- A present size is a usable one: the level parser refuses a size that is
  not a positive number (`qr-level.ts`).
- Names are text, never markup: the page sets them with `textContent`.

## Examples

```ts
const lines = noGpsWarnings(
  checkNoGps({ stations: manifest.stations, levels }),
);
// ['2 stations have no printed code: "Old well" and "Station 3". ...']
```

## Tests

`no-gps-check.test.ts`: the code-less stations named in the rail's words;
fixed cases of a station on a usable code, on a code with a position and no
size, on a code with a size and no position, on a code the tour does not
carry, and a tour without codes (M1b-2 milestone review #7); a level with
only a size, only a position, or neither (and no level) cannot place the
tour; a tripwire property test that `codesPlace` stays wired to
`tourCodesUsable` (it compares the function with the one it calls, so it
catches a rewiring, never a wrong rule - the fixed cases do that); the count
of stations without a code; the lines for none, one, several, the
unlockable ones apart (never with "I'm here"), and the no-code case alone.
The page is pinned by `playwright-tests/editor.spec.js` ("the needs-no-GPS
setting ...").
