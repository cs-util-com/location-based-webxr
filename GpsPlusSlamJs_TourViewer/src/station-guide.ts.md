# station-guide.ts

## Purpose

The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs the
station run from the visitor's position, points the wayfinding HUD at the
offered stations, writes the station line, offers the labelled "skip, I
can't get there" (§8 D5), and hands a found station to its story. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `wireStationGuide(deps): StationGuide`
  - `tick()` - re-judge (a store change, a camera frame);
  - `codeLocked(levelId)` - a lock of a printed code;
  - `storyEnded(stationId)` - the story played to its end: the station is
    done;
  - `skipTapped()`;
  - `endSession()` - the HUD goes, the line hides; the progress stays, and
    a found station's story plays again on the next session's first tick;
  - `poseOf(stationId)` - the station's pose at the scene root (the stage
    stands its figure there).
- Deps: `dom` (`line`, `skip`), `tour()` (stations, order, levels),
  `placementAllowed()`, `zero()`, `visitor()` (`visitor-position.ts`),
  `isIgnoredCode(levelId)`, `startHud(getTargets)`, `now()`,
  `onFound(station)`, `onVisitor?(nue)`.

## Invariants & assumptions

- **A run per open tour**, created once placement is allowed (a visitor's
  session with the scan gate passed or not required), kept across AR
  entries, replaced when the tour's stations change (another tour), gone
  with the tour. Saving it across page lives is K3.
- **Where a station is (D19, §8 D8):** its own geo pose; a code-only
  station stands where its code's level was saved; with neither, it has no
  distance (found by its code only; the line asks for the printed code).
  The pose was fixed at authoring (D33's settle, K6a); the viewer reads it.
- **Found by code:** only codes the moved-code check does not ignore (D20,
  §8 D8), checked again here although an ignored lock never reaches
  `onLocked`.
- **The HUD's arrival is the found radius (DEC-F4):** each target's
  `distanceMin` / `distanceMax` are the station's found band at the
  measured accuracy, and the target sits at the visitor's own height, so
  the HUD's 3D distance is the horizontal distance the run judges. Only
  offered stations not yet found are targets. The HUD is started once per
  AR session (retried while there is no camera) and disposed at the
  session's end and when the tour completes.
- **The skip** is about the nearest offered, unfound station: on demand in
  two taps ("Can't get there?", then "Skip <title> - I can't get there"),
  or in one once the suggestion clock ran out (`station-run.ts`). The line
  then says "Skipped <title>." with the next station.
- **The line:** "Next: <title>, N m", "N stations to find - nearest:
  <title>, N m", "... - waiting for your position…", "... - GPS too weak to
  guide you (±N m); step into the open." (above the accuracy ceiling),
  "... - find its printed code." (no spot), "Station found - its story is
  playing.", "Tour complete - every station visited." or "- N skipped.".
  Distances are measured again from the last known position whenever the
  offer changes, so the next station's distance shows at once.

## Examples

```ts
const guide = wireStationGuide({
  dom,
  tour,
  placementAllowed,
  zero,
  visitor,
  isIgnoredCode,
  startHud,
  now: Date.now,
  onFound: (station) => view.offer(station),
});
store.subscribe(() => guide.tick());
```

## Tests

- `station-guide.test.ts` - the gate wait, the line, the find; the HUD
  targets and their bands; a code-only station; the D20 veto; a station
  with no spot; no position and weak GPS; the skip on demand and suggested,
  the completion and the HUD's disposal; a story's end; progress across
  AR entries and a new tour; the replay of a story cut short; nothing found
  that is not offered.
- `playwright-tests/stations.spec.js` - the whole flow on the page.
