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
    a found station's story plays again on the next session's first tick
    with a position and the GPS zero;
  - `poseOf(stationId)` - the station's pose at the scene root (the stage
    stands its figure there).
- Deps: `dom` (`line`, `skip`), `tour()` (stations, order, levels),
  `placementAllowed()`, `zero()`, `visitor()` (`visitor-position.ts`),
  `isIgnoredCode(levelId)`, `codeCheck?(levelId)` (the moved-code check's
  evidence, `{ judged }` or null; R1), `startHud(getTargets)`, `now()`,
  `onFound(station)`, `onEndStory?(stationId)` (R9), `onVisitor?(nue)`, `onApproach?(station, distanceM,
activateM)` (each tick, each offered station with a distance: the
  prefetch), `onDone?(stationId)` (a story's end or a skip: the prefetch may
  release it), `onUpcoming?(station)` (every render while the current
  station is found under a fixed or branch order: the station that comes
  next, which the prefetch reads ahead, K4 review R5), `onGuide?(visitor, target)` (every render: the breadcrumbs'
  target, the station in focus with its arrival band as `stopM`; null when
  there is none, at a session end and with no run).

## Invariants & assumptions

- **A run per open tour**, created once placement is allowed (a visitor's
  session with the scan gate passed or not required), kept across AR
  entries, replaced when the tour's stations change (another tour), gone
  with the tour. Saving it across page lives is K3.
- **The scan gate per session (K4 review R8):** placement is checked on
  every tick and code lock, not only when the run is created: a later AR
  session shows no line, no skip and no HUD, and finds nothing, until its
  own gate passes.
- **A replay waits (R8):** a found station's story cut short by the
  session's end plays again on the first tick that has a position and the
  GPS zero (before them its figure had no pose).
- **Where a station is (D19, §8 D8):** its own geo pose; a code-only
  station stands where its code's level was saved, but on the estimated
  ground below the code - the visitor's height less `EYE_HEIGHT_M` (1.5 m,
  the breadcrumbs' rule; the framework's floor estimator needs a depth
  grid the Tour Viewer does not build) - and turned about the vertical
  only (the code's compat heading, else the bearing of its local +x): K4
  review R6, so a figure does not float at a wall poster's centre and a
  model does not take its tilt. Such a pose needs a visitor position (the
  stage waits for one). With neither, a station has no distance (found by
  its code only; the line asks for the printed code).
  The pose was fixed at authoring (D33's settle, K6a); the viewer reads it.
- **Found by code:** only codes the moved-code check does not ignore (D20,
  §8 D8), checked again here although an ignored lock never reaches
  `onLocked`.
- **A code lock is held until the moved-code check could have spoken (K4
  review R1; B-12 revised).** Every locked frame reports the code, while
  D20 judges it only later over GPS fixes, and its votes pull the fused
  position onto the code's saved spot - so with "found is a latch" a moved
  poster always found its station, by its lock or by the pull. Now:
  - a lock finds its station at once when the latest RAW device fix
    (`VisitorPosition.fixNue`, never moved by a vote) lies inside the
    station's activation radius at the measured accuracy, or when there is
    nothing independent to judge by (no usable fix, no spot) - as for D20
    itself;
  - otherwise the station is held (the line: "... - checking its code…")
    and not found by GPS either, until the check has had its evidence
    (`codeCheck(levelId).judged`, `checkHadItsWindow`), the raw fix
    agrees, or `CODE_HOLD_MAX_MS` (75 s) passed - then the lock counts; a
    veto drops the hold (its votes are taken back, so the station is found
    by walking to it as any other);
  - which of the reviewer's two rules: the hybrid. Rule (b) alone (the
    visitor's FUSED position inside the activation radius) is defeated by
    the code's own votes, which put the fused visitor on the saved spot
    within a frame; a raw fix is the only vote-free position. Rule (a)
    alone (hold every code lock for the check's window) holds every first
    station of a tour up to 60 s. The raw fix lets an agreeing lock count
    at once (a correct poster is held in at most 0.6 % of scans,
    `station-code-hold.sweep.test.ts`), and only a disagreeing one waits
    for (a);
  - what is left: a moved poster within the activation radius of its
    station finds it (the visitor is near the station anyway), and a
    visitor who stands still at a moved poster (under 2 m of spread)
    gives D20 no evidence, so the lock counts at 75 s; with no usable GPS
    nothing can judge the code, as before.
- **The HUD's arrival is the found radius (§8 D9):** each target's
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
- **K4 review R14:**
  - the skip clock starts when a station becomes the focus (`run.focus`,
    called at every render), not at the tour's start: under `any` order
    every focus was a one-tap skip two minutes in;
  - a tap does what the button's label showed, for the station it named
    (`rendered`): a clock that ran out since, or a focus that moved,
    changes nothing;
  - a skip can be undone for `SKIP_UNDO_MS` (6 s, the framework toast's
    linger; argued, not measured): the button reads "Undo: bring back
    <title>", the line "Skipped <title>." (the confirmation); the undo
    brings the station back to the order ("Brought back <title>.") with a
    fresh clock. The prefetch hears of a skip (`onDone`) only once it can
    no longer be undone, or when the tour moves on (a find or another
    station done). The notes go after the same 6 s.
- **Ending a story (K4 review R9):** when no unfound station is offered, the
  same button is about the found offered station whose story plays: "End
  this story?", then "End the story of <title> now"; the second tap asks
  the story panel to end it (`onEndStory`; without one the guide marks the
  station done). A story whose choices all loop back therefore cannot hold
  a tour: with the run's own guarantee, every order completes within two
  taps per station (`station-guide.property.test.ts`). No parser rule that
  every story reaches its end was added: a looping choice is valid in K1's
  format, and the button now covers it.
- **The line:** "Next: <title>, N m", "N stations to find - nearest:
  <title>, N m", "... - waiting for your position…", "... - GPS too weak to
  guide you (±N m); step into the open." (above the accuracy ceiling),
  "... - find its printed code." (no spot), "Station found - its story is
  playing.", "Tour complete - every station visited." or "- N skipped.";
  under branch order "Tour complete - you reached the end of your path."
  (with ", N skipped."), since the other branches were never offered.
  The line and the skip are written only when their text changes (the
  line is a polite live region: a rewrite is announced again).
- **Measured once per tick (K4 review R13):** each tick reads the visitor
  and the zero once, computes every station's pose once (cached until the
  next measurement; the stage and the HUD read the cache) and every
  placeable station's horizontal distance, so an offer that changes
  between ticks (a skip, a story's end) has its distance at once. A code
  lock before any tick measures first.

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

- `station-code-hold.sweep.test.ts` - the hold's maximum against the real
  moved-code check's timing, and how often a correct poster is held (R1).
- `station-guide.property.test.ts` - stories that never end, stations
  nobody reaches, random orders and `next` links (cycles included): the
  tour completes within two taps per station (R9).
- `station-guide.test.ts` - the undo, the focus clock under `any` order and
  the tap acting on its label (R14); the gate wait, the line, the find; the HUD
  targets and their bands; a code-only station; the D20 veto arriving
  after the lock, an agreeing lock at once, a held lock released by the
  check's window and at the latest after 75 s, no usable GPS (R1); a station
  with no spot; no position and weak GPS; the skip on demand and suggested,
  the completion and the HUD's disposal; a story's end; progress across
  AR entries and a new tour; the replay of a story cut short; nothing found
  that is not offered.
- `playwright-tests/stations.spec.js` - the whole flow on the page.
