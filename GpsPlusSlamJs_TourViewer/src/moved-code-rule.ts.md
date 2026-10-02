# moved-code-rule.ts

## Purpose

The viewer's whole moved-code rule (Tour Viewer authoring plan
2026-09-28-0953 §3.6, decision D20, milestone M5c; owner approval of
2026-10-02): the POSITION half from `code-displacement.ts` (the rigid fit
against the 20 m floor alone) and the TURN half added here, because the
rigid fit absorbs a turn exactly and so never reads a poster re-hung facing
another way as moved (§7l D3). Pure; the per-fix wiring is
`moved-code-check.ts`.

## Public API

- `CODE_TURN_RULE: CodeTurnRule` - `{ settledYawDeg: 45,
settledAlignmentSamples: 120, compassDeg: 60, outdoorMaxAccuracyM: 6.5,
fallbackYawDeg: 90, fallbackMinSpreadM: 10 }` (frozen).
- `MOVED_CODE_HORIZON_S` (300) - how long after its pin a code is checked.
- `MOVED_CODE_RULE_VERSION` - carried by the `tourViewing/codeIgnored` log;
  bump it with any value here or in `CODE_MOVE_RULE`.
- `isSettledSave(level, rule?)` - the level's
  `mintQuality.alignmentSampleCount` reaches `settledAlignmentSamples`; a
  level without the count is not settled.
- `isOutdoorByAccuracy(medianAccuracyM, rule?)` - the device fixes' median
  reported accuracy is positive and at most `outdoorMaxAccuracyM`; null or
  non-finite: false.
- `compassTurnDeg(compassArNorthDeg, pin)` - `bearingDeltaDeg(compass,
alignmentNorthBearingDeg(pin.alignment))`, in (-180, 180]; null for a
  non-finite bearing or a vertical pin north.
- `turnChannelOf({ settled, compassTurnDeg, outdoor })` -
  `"settled-yaw" | "compass" | "fallback-yaw"`.
- `judgeCodeMove({ estimate, settled, compassTurnDeg, outdoor }, rules?)` -
  `{ verdict, decidedBy, boundM, turnChannel }`: `moved` by position first,
  else by the turn channel; otherwise the position verdict. `decidedBy` is
  `"position"` or the channel for `moved`, null otherwise.

## The turn channels

Exactly one runs per code:

- `settled-yaw` (the save was settled): the rigid fit's |yaw| beyond 45
  degrees, with the position rule's evidence (60 s, 2 m).
- `compass` (not settled, a compass reading, outdoors): |compass turn|
  beyond 60 degrees, decided at the reading, no evidence gate. The
  compass turn IS "the code's facing direction at the scan (device compass
  combined with the camera-observed code orientation) against its saved
  facing direction": the pin maps the camera-observed code exactly onto its
  saved pose, so the pin's bearing of the odometry's north differs from the
  compass's by the turn (plus the compass error).
- `fallback-yaw` (otherwise): the rigid yaw beyond 90 degrees once the walk
  has spread 10 m (and spans 60 s).

## Where each input comes from, and why

- **"Settled"** - the owner asked for the save's alignment age or mint
  quality. The level carries no age (`mintedAtIso` is a wall time, the
  session start is not stored); it carries `alignmentSampleCount`, the GPS
  fixes the alignment had solved at the mint (the Tour Viewer's author mode
  counts this session's fixes; the visit settle re-mints with the visit's
  final count). That count is the closest honest proxy. The real corpus
  records about 2 fixes a second (median interval 0.52 s; 57-174 fixes in a
  walk's first 60 s, median 108), so 120 fixes is about the 60 s the
  measurement called settled at the median rate; a 1 Hz phone needs 2
  minutes (conservative: it then uses the compass or the fallback).
- **The compass** - the framework's absolute orientation
  (`rawAbsoluteOrientation` on each device fix payload,
  `arNorthBearingDeg` of its quaternion and the fix's AR rotation), portrait
  only, magnetic (no declination: as measured). **The Tour Viewer does not
  start the absolute-orientation watch today**, so its fixes carry no
  reading and the compass channel is dormant: every unsettled save uses the
  fallback. Starting the watch would also feed the core's compass features
  (the cold-start override is on by default), an owner decision of its own.
- **Outdoors** - the viewer has no indoor/outdoor signal. The device fixes'
  median reported accuracy is the proxy: in the corpus no indoor walk read
  under 6.8 m (10 walks), and 6.5 m loses 13 of 197 outdoor walks.

## Measured (M5c sweep, `code-displacement.recordings.test.ts`, "M5c shipped rule")

Per-fix FIRST crossings, which is what the viewer acts on, on 379 outdoor
virtual codes (151 walks) with the saved heading drawn from ANOTHER walk:

- settled-yaw at 45: 1 of 379 unmoved codes within 120 s (0.3 %, upper
  bound 1.2 %), every 90 degree turn caught; swept 30 / 45 / 60 and the
  settled count 60 / 120 / 180 (0-0.3 % at 45 for all three).
- fallback-yaw (save under 120 fixes, no compass): T 45: 4.2 %, T 60: 3.7 %,
  T 90: 1.1 % (upper bound 2.4 %) of unmoved codes; 90 degree turns caught
  97 % / 96 % / 57 %. The spread barely matters (2 / 5 / 10 / 20 m: 1.3 /
  1.1 / 1.1 / 1.1 % at T 90): the threshold is the lever. 90 was chosen
  for the false alarms; what reverses it: turned posters common enough that
  missing 4 in 10 quarter turns costs more than 2.6 more false alarms per
  100 visits.
- compass at 60 (results doc): 3.3 % false alarms against any mint, 2.0 %
  against a settled one, 95-97 % of 90 degree turns.
- horizon: on the cross-day pairs all 23 position alarms of 6,166 came
  within 120 s; 20 m moves caught 58.0 / 58.8 / 58.9 % within 120 / 300 s /
  the whole visit. 300 s keeps the check inside the measured range (visits
  under about 5 minutes).

## Invariants

- No channel reads `moved` from an estimate inside every threshold
  (property test); a position move never depends on the turn inputs.
- Against a perfect compass the compass channel reads exactly the turn, in
  any frame (property test).

## Tests

`moved-code-rule.test.ts` (inputs, channel choice, each channel's
threshold and gate, the recorded values), `moved-code-rule.property.test.ts`.
The values' evidence: the opt-in `code-displacement.recordings.test.ts`
(`D20_REAL=sweep`).
