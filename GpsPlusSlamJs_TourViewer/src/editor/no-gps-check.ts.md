# editor/no-gps-check.ts

## Purpose

What the desktop editor warns about while a tour is marked "This tour needs
no GPS" (QR-first M1b-2; owner decisions Q-QF-1 and "code-less stations
without location", plan `2026-10-14-0445-qr-first-alignment-field-study-plan.md`
§8). Pure and page-free; the page (`edit-main.ts`) shows the lines under the
setting, non-blocking.

## Public API

- `checkNoGps({ stations, levels }): NoGpsCheck`
  - `codeless` - the names of the stations whose anchor has no printed code
    (`anchor.code` absent), in the story's order, named as the rail names
    them (`editor-model.ts` `stationTitle`: the title, else "Station N").
  - `codesPlace` - whether one of the tour's codes can place it: the
    viewer's own rule, `visitor-screen.ts` `tourCodesUsable` (a level with
    `physicalSizeM` and `geo`, `scan-gate.ts` `isLockableLevel`), never a
    copy (root CLAUDE.md DEC-H3).
- `noGpsWarnings(check): string[]` - the plain-word lines:
  - none, when every station has a code and a code can place the tour;
  - "N station(s) has/have no printed code: "A", "B" and "C". Without
    location, visitors reach it/them only by tapping "I'm here - play the
    story" once they stand there.";
  - when no code can place the tour, ONLY "None of this tour's printed
    codes can place it (...), so visitors will be asked for their location
    anyway." - the viewer then does not honour the flag, visitors get GPS,
    and a line about the code-less stations would describe a tour that
    never runs.
- `NoGpsCheck`.

## Invariants & assumptions

- The editor's levels were read whole at the open (`editor-open.ts`: a
  level file that does not read refuses the open), so the viewer's
  "unreadable" case never arises here and is passed as `false`.
- A station anchored to a code that exists but cannot place the tour (no
  size or no position) is not counted as code-less; when no code at all
  can place the tour the second line covers it, but a tour with SOME
  usable codes and a station on an unusable one is not warned about
  (named, not covered).
- Names are text, never markup: the page sets them with `textContent`.

## Examples

```ts
const lines = noGpsWarnings(
  checkNoGps({ stations: manifest.stations, levels }),
);
// ['2 stations have no printed code: "Old well" and "Station 3". ...']
```

## Tests

`no-gps-check.test.ts`: the code-less stations named in the rail's words; a
level with only a size, only a position, or neither (and no level) cannot
place the tour; property tests that `codesPlace` agrees with
`tourCodesUsable` for any set of levels and that the count is exactly the
stations without a code; the lines for none, one, several, and the no-code
case alone. The page is pinned by `playwright-tests/editor.spec.js` ("the
needs-no-GPS setting ...").
