# moved-code-rule.ts

## Purpose

The viewer's whole moved-code rule (Tour Viewer authoring plan
2026-09-28-0953 §3.6, decision D20, milestone M5c; owner decisions of
2026-10-02): the POSITION half from `code-displacement.ts` (the rigid fit
against the 20 m floor alone) and the TURN half added here, because the
rigid fit absorbs a turn exactly and so never reads a poster re-hung facing
another way as moved (§7l D3). Pure; the per-fix wiring is
`moved-code-check.ts`.

## Public API

- `CODE_TURN_RULE: CodeTurnRule` - `{ settledYawDeg: 45,
settledAlignmentSamples: 120 }` (frozen).
- `MOVED_CODE_HORIZON_S` (300) - how long after its pin a code is checked.
- `MOVED_CODE_FIT_WINDOW_S` (300) - the fit window before the pin: only
  device fixes stamped at most this long before it fold (M5c review H2).
- `MOVED_CODE_RULE_VERSION` - carried by the `tourViewing/codeIgnored` log;
  bump it with any value here or in `CODE_MOVE_RULE`.
- `isSettledSave(level, rule?)` - the level's
  `mintQuality.alignmentSampleCount` reaches `settledAlignmentSamples`; a
  level without the count is not settled.
- `judgeCodeMove({ estimate, settled }, rules?)` -
  `{ verdict, decidedBy, boundM, turnChecked }`: `moved` by position first,
  else, for a settled save, by the rigid fit's yaw; otherwise the position
  verdict. `decidedBy` is `"position"` or `"turn"` for `moved`, null
  otherwise; `turnChecked` is `settled`.

## The turn check (owner decision 2026-10-02)

"The global rotation of the QR code should only ever come from the global
pose in the GPS world space of the QR code, which is very accurate if the
user walked for a while." So the turn check is ONE comparison: the code's
heading in GPS world space (the rigid fit's yaw: the code's pin carried
through the visitor's own GPS path) against its saved heading, beyond 45
degrees. It runs only when:

- the saved code was minted on a SETTLED alignment (`isSettledSave`); an
  early save carries its alignment's heading error into every reading, and
- the visitor has walked enough: the position rule's evidence gate (60 s
  span, 2 m spread), below which the fit has no turn.

Otherwise there is no turn check; an early save is judged by position only.
No compass reading is used anywhere. The earlier design (a compass channel
at 60 degrees outdoors for an unsettled save, and a 90 degree rigid-yaw
fallback) is retired with its code and tests: the compass is magnetic,
Android-only, wrong indoors, and the Tour Viewer never started the watch
that feeds it; the fallback read 1.1 % of unmoved codes and missed 4 in 10
quarter turns.

## Where "settled" comes from, and why

The owner asked for the save's alignment age or mint quality. The level
carries no age (`mintedAtIso` is a wall time, the session start is not
stored); it carries `alignmentSampleCount`, the GPS fixes the alignment had
solved at the mint (the Tour Viewer's author mode counts this session's
fixes; the visit settle re-mints with the visit's final count). That count
is the closest honest proxy. The real corpus records about 2 fixes a second
(median interval 0.52 s; 57-174 fixes in a walk's first 60 s, median 108),
so 120 fixes is about the 60 s the measurement called settled at the median
rate; a 1 Hz phone needs 2 minutes (conservative: its codes are then judged
by position only).

**Checked: no tool counts its own votes** (M5c review L6, 2026-10-02). The
Recorder reads the count from the store's whole GPS history
(`GpsPlusSlamJs_RecorderApp` `wire-ar-scene.ts` `readAlignment`), which
holds the session's own synthetic votes once a code has voted; but
`wire-qr-recording.ts` wraps that reader and subtracts every vote it cast
(`syntheticVotes`, clamped at 0) before the count reaches the mint. The
clamp can only UNDERstate the count (a store swap empties the list while the
counter stays), which reads a save as unsettled: the safe side. The Tour
Viewer's author mode never votes (`qr-author-mode.ts`) and counts only this
session's fixes. So the proxy needs no Tour Viewer correction today; if the
Recorder ever stopped subtracting, a level re-minted after its code voted
would read settled up to 16 fixes per voted lock early.

## Measured (M5c sweep, `code-displacement.recordings.test.ts`, "M5c shipped rule", re-run 2026-10-02 without the compass)

Per-fix FIRST crossings, which is what the viewer acts on. Two
denominators each: "all" counts every case (a visit that ends early simply
stops being checked); "covered" only the cases whose walk lasts the window.

- **Turn check** on outdoor virtual codes, the saved heading drawn from
  ANOTHER walk's settled alignment (710 codes with a draw on 197 walks; 379
  of them last 120 s, 100 last 300 s), fixes after the scan only:
  - unmoved, at 45 degrees and 120 settled fixes: within 120 s 1 of 710 all
    (0.1 %, upper bound 0.7 %), 1 of 379 covered (0.3 %, upper bound
    1.2 %); within 300 s 1 of 710 all, 0 of 100 covered (upper bound 3 %).
  - 90 degree turns caught: 758 of 758 covered within 120 s, 200 of 200
    within 300 s; 1,022 of 1,420 all (72 %): the rest are walks that end
    before the 60 s of evidence. Half turns: every covered one.
  - swept: T 30 reads 3 of 379 covered (0.8 %), T 60 reads 0; the settled
    count 60 / 120 / 180 changes nothing at 45 (0 / 1 / 1 of 379).
  - an unsettled save: 0 false alarms and 0 turns caught, by construction.
- **Position** on 6,166 cross-day pairs (42 points; 2,380 last 120 s, 173
  last 300 s): unmoved within 120 s 23 of 6,166 all (0.4 %, upper bound
  0.5 %), 3 of 2,380 covered (0.1 %, upper bound 0.3 %); within 300 s 23 of
  6,166 all, 0 of 173 covered (upper bound 1.7 %). 20 m moves caught within
  120 s 58.0 % all, 66.4 % covered; within 300 s 58.8 % all, 68.5 %
  covered; 30 m moves 94.7 % all, 99.9 % / 100 % covered.
- The pairs carry no heading truth (a reference mark's rotation is the
  phone's pose when marked), so the turn check is measured on the virtual
  codes only; the whole rule's false alarms are at most the sum of the two
  halves (0.4 % + 0.3 % within 120 s on covered cases).

Fit window (M5c review H2), swept on the same pairs with the shipped rule:
120 / 300 / 600 s / unbounded give 24 / 23 / 23 / 23 of 6,166 unmoved pairs
within 120 s (3 of 2,380 covered at every window) and catch 58.7 / 58.0 /
58.0 / 58.0 % of 20 m moves (66.9 / 66.4 / 66.4 / 66.4 % covered). The
window barely matters on this corpus because its visits are short (only 173
pairs last 300 s): it bounds a long session, which the corpus cannot test
(D27: the owner records 10 minute walks in the field test).

Horizon: all 23 position alarms of 6,166 came within 120 s; 300 s keeps the
check inside the measured range (visits under about 5 minutes).

## Invariants

- Nothing reads `moved` from an estimate inside every threshold (property
  test); a position move never depends on `settled`.
- An unsettled save is never read as turned, at any yaw, span or spread
  (property test).
- No compass input exists; a stray one handed in changes nothing (test).

## Tests

`moved-code-rule.test.ts` (the settled proxy, position first, the turn
check's threshold and gate, no turn check for an unsettled save, no compass,
the recorded values), `moved-code-rule.property.test.ts`. The values'
evidence: the opt-in `code-displacement.recordings.test.ts`
(`D20_REAL=sweep`).
