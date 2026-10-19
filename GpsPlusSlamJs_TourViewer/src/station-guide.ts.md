# station-guide.ts

## Purpose

The visitor's stations in AR (tour kit plan K4, §4.2, K-D6, K-D9): runs the
station run from the visitor's position, points the wayfinding HUD at the
offered stations, writes the station line, offers the labelled "skip, I
can't get there" (§8 D5), and hands a found station to its story. Plans:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` (D9, D16),
`GpsPlusSlamJs_Docs/docs/2026-10-18-2349-visitor-station-content-at-radius-plan.md`
(M1: the present station).

## Public API

- `wireStationGuide(deps): StationGuide`
  - `tick()` - re-judge (a store change, a camera frame);
  - `codeLocked()` - a printed code locked: no arrival of its own (D16),
    only a re-judge now, since the lock improved the position;
  - `storyEnded(stationId)` - the story played to its end: the station is
    done;
  - `skipTapped()`;
  - `endSession()` - the HUD goes, the line hides; the progress stays, and
    a found station's story plays again on the next session's first tick
    with a position and the GPS zero;
  - `poseOf(stationId)` - the station's pose at the scene root (the
    distances and the HUD read it);
  - `figurePoseOf(stationId)` - where the stage stands a story's figure:
    the same pose once this AR entry's alignment was ready, null before
    (no heading yet; the stage waits, r881 re-review M-B).
- Deps: `dom` (`line`, `skip`), `tour()` (stations, order),
  `placementAllowed()`, `zero()`, `visitor()` (`visitor-position.ts`),
  `codeLinedUp()` (a code's votes lined the alignment up, `tour-flow.ts`),
  `alignmentReady()` (the alignment may be judged on: tracking ready or a
  code, re-read each tick by the find, latched per AR entry by what needs
  a heading, `tour-flow.ts` `alignmentReady`), `trackingReady()` (the
  tracking report reads ready, `tour-flow.ts` `isPlacementReady`: it
  latches a heading, only while no code is lined up),
  `startHud(getTargets)`, `now()`, `fixMaxAgeMs?` (default
  `FIX_MAX_AGE_MS`, 5 s), `guideStore?` (the page's store with the
  `visitorGuide` slice, `visitor-guide-slice.ts`: the present station is
  dispatched there; absent, none is judged),
  `onFound(station)`, `onEndStory?(stationId)` (R9), `onVisitor?(nue)`, `onApproach?(station, distanceM,
activateM)` (each tick, each offered station with a distance: the
  prefetch), `onDone?(stationId)` (a story's end or a skip: the prefetch may
  release it), `onUpcoming?(station)` (every render while the current
  station is found under a fixed or branch order: the station that comes
  next, which the prefetch reads ahead, K4 review R5), `onGuide?(visitor, target)` (every render: the breadcrumbs'
  target, the station in focus with its arrival band as `stopM`; null when
  there is none, at a session end and with no run; the visitor is null
  until this AR entry's alignment was ready). `onVisitor` too is called
  only from that first readiness on.

## Invariants & assumptions

- **The wait for a heading is published** (D34): after each tick the guide
  sets the store's `headingPending` to `!headingReady && !run.isComplete()`
  (dispatched only on a change), false with no run, at no tour and at the
  session's end; `ar-entry.ts` turns it into the visitor's "walk a few
  steps" sentence.
- **One gate for found and presence** (visitor plan M1, §3): `judged` is
  the one function that says what a tick may judge - the measured best
  position's distances and the judged accuracy, or nothing (no position, no
  GPS zero, `tooWeakToGuide`). The run's `observe` and the present station
  both read only it, so a station is never found where presence would not
  count the visitor, nor present on a fix the arrival refused.
- **The present station** (`station-presence.ts`): every station of the
  tour is a candidate, with its judged bands (`judgedStationBands`) and the
  judged accuracy's margin (`takeoverMarginM`), whatever the order (V-D5).
  The guide dispatches `presenceJudged` only when `presenceAfter` differs
  from the store's answer, and only at the END of its tick (the store's
  subscriber ticks again, and finds nothing to change). No position (a
  tracking drop, a stale fix) holds it; `endSession` dispatches
  `presenceCleared`; a run replaced or dropped (another tour, none)
  dispatches `guideTourChanged` at the end of that tick, when anything was
  set - never the page's first run, so a "show all" set before the first
  tick stays (PR review S5). Nothing draws by it yet (M2).
- **Presence never outlives what judged it** (PR review S1, the H1
  lesson): a fix too weak to guide by is still handed to the reducer, which
  applies only the exit (`presentAfterWeakFix`: past the exit by its
  accuracy); and a station last judged on a code's position
  (`presentByCode`) is cleared on a tick whose judgement is null once the
  code is no longer lined up (a moved poster's veto indoors, where the
  ±40 m fix that follows is too weak to judge by and close enough to hold).

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
  GPS zero (before them its figure had no pose) - any position the find
  judges by, the fresh fix included (r881 re-review M-C: requiring a
  camera position meant a session never ready never replayed, while the
  line said "its story is playing"). Its figure waits for the heading as
  on a first play.
- **Where a station is (D19, §8 D8; tour editor plan D9):** its own geo
  pose, as a pin's; since version 3 every station has one (`station.geo`).
  The pose was fixed at authoring (D33's settle, K6a); the viewer reads
  it.
- **Reached by its radius alone (D16):** the distance is measured from the
  phone's current best position - the alignment's (`VisitorPosition.nue`,
  fed by GPS and codes alike) while it is ready (`alignmentReady()`,
  re-read each tick); while it is not, or while there is no alignment at
  all, the latest device fix (`fixNue`) if it is at most `FIX_MAX_AGE_MS`
  (5 s) old by its own timestamp against `now()`. A station is found
  inside its authored found radius: whatever the raw accuracy when a code
  lined the aligned position up (the accuracy is the raw fixes' and says
  nothing about a code's position, M5c review #1), and otherwise only
  while the raw accuracy is within the ceiling (`tooWeakToGuide`, PR #640
  review): the median of the latest fixes for the aligned position, the
  worse of that and the fix's own (`fixAccuracyM`) for a lone fix (r881
  re-review M-A: one ±40 m fix after a ±5 m run hid behind the median).
  When neither the median nor the fix states an accuracy the radius alone
  judges, as for any unknown accuracy: a real device fix always states one
  (the Geolocation spec requires it), so only injected points (a test
  page, a replay) lack it (third review L4).
  The accuracy never widens the radius. With neither position nothing is
  reached. A GPS-only session whose tracking quality drops is not ready
  any more and falls back to the fresh fix; only a session that stays
  ready (a code lined it up) has no position while its camera pose is
  dropped, and the line says "waiting for your position": the raw fix
  would bypass the code's trust and used to latch "found" (M5a review M3;
  r881 re-review L-C corrected the claim that every ready session had no
  position then). 5 s is
  argued, not measured (about four missed 1 Hz fixes, 7 m of walking);
  2-10 s are swept in the tests. A code lock is no arrival: it only
  improves the position, and `codeLocked()` re-judges at once. This
  replaced the code-only station, the held code lock (`CODE_HOLD_MAX_MS`,
  `codeAgrees`) and the visitor's own "I'm here" (review 2 #5).
- **Aligned alone is not trusted, and not used before it is ready
  (r881):** the library aligns a session from its first fix (no rotation,
  at the zero, at any accuracy), so `aligned` holds from the first fix
  on. Until r881 it was trusted outright: the "too weak" line was dead
  and a ±500 m cold-start fix inside a station latched "found". Now only
  a code earns the trust, and only for the aligned position
  (`codeLinedUp()`, kept through a tracking drop: review L1; never for a
  lone raw fix: re-review L-A), and the aligned position counts only while
  `alignmentReady()` (tracking ready, or a code lined it up). While it is
  not, the alignment may have no heading and can be 180° wrong: the
  session counts as unaligned, so the fresh device fix stands in (review
  H1: readiness needs ten fixes, a walk and turns, and never came for a
  visitor standing at a station or walking straight).
- **What needs a heading latches per AR entry** (r881 re-review L-B, M-B):
  the HUD's targets, the breadcrumbs' start, the figure's turn
  (`onVisitor`) and its pose (`figurePoseOf`) wait for the first
  `alignmentReady()` of the AR entry and keep it through a degraded dip,
  as the walk's photos latch their trigger; `endSession()` resets it. The
  find does not latch: in a dip it judges by the fresh fix, while the
  arrows keep pointing from the aligned camera. A visitor who never
  becomes ready finds stations and hears their stories, but sees no
  arrows and no figure (an owner question; the default chosen in r881).
  - **Only tracking's heading latches** (third review L2): a tick on
    which the tracking report reads ready (`trackingReady()`) with no code
    lined up latches it; a heading that only a code gave lasts while the
    code is lined up, so a veto that lifts the code while tracking is not
    `ok` takes the arrows and the figure's pose away with it. Tracking
    that reads `ok` while a code is lined up does not latch (the safe
    side), because that report is not independent of the code: the
    lock's votes enter the GPS history it reads (one lock is enough
    fixes, they dominate its accuracy median) and its residuals and
    convergence come from the matrix they pinned, so the `ok` can be the
    code's own work. Once the veto took every vote back (the keep-alive
    stops with it, whichever code it held), a report still `ok` on the
    GPS-only history latches on that tick. The cost is larger than one
    tick: "lined up" holds from the first voted lock until a veto or the
    end of the session, so tracking that is genuinely `ok` through a long
    lined-up visit never latches, and a later veto takes the heading
    whenever the re-fed GPS-only report is not `ok` at that moment - it
    comes back with the next `ok`. A heading tracking latched BEFORE any
    code locked is kept through the lock and any later veto.
  - **In a dip the arrow and the line can disagree** (third review L3,
    deliberate, an open question): the HUD and the breadcrumbs measure
    from the aligned camera while the find judges by the raw fix, so the
    arrow can say "arrived" while the line still says the station is not
    found. The readiness dip is the one window where the two origins
    differ: the HUD's origin (`headingNue`, the camera, kept through the
    dip by the latch) and the find's position (`best`, the fresh device
    fix) are the same point while the alignment is ready, and before the
    first readiness there is no HUD origin at all; so only in a dip, while
    the latch holds a heading, can the arrow read "arrived" while nothing
    is found.
- **A moved poster pulls the position only until it is judged:** the
  moved-code check then ignores its code and takes its votes back
  (`isIgnored` of the viewer pipeline, `qr-viewer-mode.ts`, D20), the one guard left
  since the lock-hold went. What is left: a moved poster's votes count
  until the check has judged it (its evidence window), so a visitor who
  scans a moved poster near another station inside that window may find
  that station early; the old hold covered this case.
- **The HUD's arrival is the found radius (§8 D9):** each target's
  `distanceMin` / `distanceMax` are the station's found band at the
  accuracy of the position judged by, and the target sits at the visitor's own height, so
  the HUD's 3D distance is the horizontal distance the run judges. Only
  offered stations not yet found are targets.
- **One accuracy rule for every band** (PR #642 review): the prefetch's
  activation, the HUD's band and the breadcrumbs' stop read the same rule
  as the line and the run (`station-bands.ts` `judgedAccuracy` /
  `judgedStationBands`, on the measurement's `codeLinedUp`). A visitor a
  code lined up takes the HUD's own band, so a ±40 m raw fix beside a
  code-placed position widens nothing; every other position - a raw fix,
  or an alignment no code lined up - keeps the raw accuracy's band. The HUD is started once per
  AR session (retried while there is no camera) and disposed at the
  session's end and when the tour completes.
- **The skip** is about the nearest offered, unfound station: on demand in
  two taps ("Can't get there?", then "Skip <title> - I can't get there"),
  or in one once the suggestion clock ran out (`station-run.ts`). The line
  then says "Skipped <title>." with the next station.
- **K4 review R14:**
  - the skip clock starts when a station becomes the focus (`run.focus`,
    called at every render), not at the tour's start: under `any` order
    every focus was a one-tap skip two minutes in; and only once the
    focus has a distance, which sizes it (r881 review M2: started without
    one, the bare 2 min allowance suggested the skip to a visitor still
    waiting for a position);
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
  guide you (±N m); step into the open." (when no code lined the
  position up and the raw fixes' accuracy is above the ceiling,
  `tooWeakToGuide` - checked before "waiting", so it shows while the
  alignment is not ready too; the run then judges no arrival either,
  PR #640 review, M5c review #1),
  "Station found - its story is
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
  lock re-judges through `tick()`, so it measures first.

- **With no device fix ever (QR-first M1b-1, codes only):** the visitor's
  position (`visitor-position.ts`) is the camera through the code-placed
  alignment - null before a scan, odometry from the code after it - with
  `accuracyM` and `fixNue` null. So nothing is reached before a scan,
  and after it every station by the distance from the code-placed
  position (D16), as with GPS; the line says "waiting for your
  position..." before a scan and the distance after it - never "GPS too
  weak", which needs an accuracy. Under `?relocate=here` the stations stay
  held back (the relocation waits for a first device fix that never comes).

## Examples

```ts
const guide = wireStationGuide({
  dom,
  tour,
  placementAllowed,
  zero,
  visitor,
  codeLinedUp,
  alignmentReady,
  startHud,
  now: Date.now,
  onFound: (station) => view.offer(station),
});
store.subscribe(() => guide.tick());
```

## Tests

- `station-guide.property.test.ts` - stories that never end, stations
  nobody reaches, random orders and `next` links (cycles included): the
  tour completes within two taps per station (R9); and a raw fix finds a
  station only without an alignment, only while fresh, only inside the
  radius (M3).
- `station-guide.test.ts` - the undo, the focus clock under `any` order and
  the tap acting on its label (R14); the gate wait, the line, the find; the HUD
  targets and their bands; arrival by the radius alone (D16): codes only (reached after a
  scan, by distance), poor GPS (found by distance, never widened), none
  before any position, the device fix before an alignment and the
  alignment after it, a tracking drop in an aligned session finding
  nothing on the raw fix, a stale fix ignored, the age limit swept over
  2-10 s (M3); no position and weak GPS lines; the skip on demand and suggested,
  the completion and the HUD's disposal; a story's end; progress across
  AR entries and a new tour; the replay of a story cut short; nothing found
  that is not offered; a code-lined-up visitor's prefetch, HUD band and
  breadcrumb stop not widened by a raw fix of ±5-100 m or none, an aligned
  visitor with no code and a raw fix alone keeping the raw accuracy's band
  (swept, PR #642 review; changed r881); a code-lined-up visitor found
  however weak the fix, one without a code not (r881); the cold start on
  the real store (r881): one fix aligns the session with no rotation, a
  ±500 m first fix inside a 10 m station finds nothing and says the GPS
  is too weak (ready or not), an alignment not yet ready judges by the
  fresh fix (found, but no HUD target and no breadcrumbs), and a
  code-lined-up courtyard visitor at ±40 m is found; on the real store a
  visitor with no code standing at a 5 m station or walking straight to
  it never reaches tracking `ok` and is found on the fix (at once; on
  arrival), with a walk round a square as the positive control that does
  reach it (review H1, re-review L-G); a tracking drop in a code-placed
  session waits instead of "too weak" (L1); the skip clock waits for a
  distance (M2). Re-review: a lone weak fix after good ones is too weak
  while a ready alignment keeps the median (M-A); a code's trust never
  reaches a lone fix (L-A); before readiness the find follows the fix,
  not the camera (L-G); a story cut short replays in a session never
  ready (M-C); a dip keeps the arrows, the breadcrumbs and the figure's
  turn while the find falls back to the fix, and a new AR entry waits
  again (L-B); the figure's pose waits for readiness (M-B); the two-tap
  skip works with no distance ever (L-G); a heading only a code gave goes
  with the code while tracking is not ready (third review L2); tracking
  ready only while a code was lined up does not latch, so the veto that
  drops the report takes the heading, while a report still ok after the
  veto latches it on the next tick and a new AR entry waits again; a
  heading tracking latched before any code locked stays through the lock
  and a veto in a dip. The
  cold-start harness feeds the raw signals (tracking, a code) and the
  page's readiness rule over them, so the latch tested is the guide's.
  `station-guide.property.test.ts` also pins that a lone-fix find means
  the worse known accuracy is within the ceiling (L4).
- `station-guide.test.ts` ("the present station", visitor plan M1) -
  enter at the found radius, leave past the exit, a dispatch only per
  change; a too-weak fix neither finds nor makes present, no position and a
  stale fix hold; a code's station ends with its code's veto (and holds
  through a tracking drop while the code stays); a too-weak fix ends
  presence past the exit by its accuracy and never enters (an underpass); a
  "show all" set before the first tick stays; a code's 1.5 m band; a later
  station of a fixed tour present but not found (V-D5); cleared at the
  session's end, reset with "show all" by another tour.
- `visitor-stations.test.ts` - `stationAlignmentSignals` against the real
  tracking-quality slice (L3).
- `playwright-tests/stations.spec.js` - the whole flow on the page.
