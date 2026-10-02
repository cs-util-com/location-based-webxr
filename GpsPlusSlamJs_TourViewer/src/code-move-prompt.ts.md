# code-move-prompt.ts

## Purpose

When the creator setup asks "This code seems to have moved about N m. Use
the new spot?" while authoring, and which answers it remembers so it does
not ask again (authoring plan
`2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md`
§3.6 "Authoring (D20 ask once)", milestone M5b; cold review §7j #8, #9,
#10, #12, #14, #15). Pure: `creator-setup.ts` feeds it on every readout
render and owns the DOM, the replace, the undo and the draft writes.

## Public API

- `trackMovePrompt(onset, input, rule = MOVE_PROMPT_RULE)` -
  `{ onset, prompt }`: one step of the tracker. `input` is
  `MovePromptInput`: `levelId` (the level in hand), `refusal` (the latest
  sighting's `CorrectionRefusal`, `visit-settle.ts`), `offset`
  (`{ northM, eastM }`, `sightedCodeOffset`), `gateOpen` (the mint gate's
  alignment half: a matrix and `MIN_ALIGNMENT_SAMPLES` of this session's
  fixes), `fixCount` and `lastFixMs` (the store's GPS fix count and the
  latest fix's own time), `savedKey` (`savedPoseKey` of the level in
  hand's json, null without one), `answers`. `prompt` is a `MovePrompt`
  (`levelId`, `horizontalM`, `northM`, `eastM`, `yawDeg`,
  `maxHorizontalM`, `fixes`, `seconds`, `savedKey`) or null.
- `isHorizontalRefusal(refusal)` - the refusal broke the horizontal bound
  (a yaw-only refusal is not).
- `MOVE_PROMPT_RULE` - `{ minFixes: 20, minSeconds: 20, sameSpotM: 20,
floorM: MOVED_CODE_FLOOR_M }` (20 m, from `code-displacement.ts`; swept,
  see below). `MovePromptRule` is its type, so a test can pass
  another.
- `RememberedMoveAnswer` - `{ levelId, northM, eastM, answer, savedKey }`
  with `answer` `"second-copy" | "not-now"` and `savedKey` the saved
  pose the offset was taken from.
- `savedPoseKey(json)` - a short key (FNV-1a, 32 bits, 8 hex digits) of a
  saved level's pose json. Not a security hash: a collision costs one
  prompt not asked.
- `rememberMoveAnswer(answers, entry, sameSpotM?)` - adds an answer,
  replacing one for the same level, saved pose and spot, keeping the newest
  `MOVE_ANSWERS_MAX` (32).
- `isSecondCopySpot(answers, { levelId, savedKey, offset }, sameSpotM?)` -
  whether a sighting lies at a spot answered "It's a second copy" for that
  level and saved pose (the same match that keeps the prompt quiet). The
  creator setup keeps such a sighting out of the visit log: it is another
  print, not a visit of the stored code (M5b review #11). "Not now" never
  counts; a non-finite offset never matches.
- `parseMoveAnswers(value)` - the answers in a meta value (external data):
  well-formed entries only, at most `MOVE_ANSWERS_MAX`. An entry without a
  `savedKey` (a draft written before M5b review #2) is dropped, not
  trusted: the pose its offset was taken from is unknown.
- `movePromptText(horizontalM)` and `MOVE_PROMPT_LABELS` - the words.
- No input throws: an unreadable input yields no prompt.

## The rule

The prompt asks only when ALL of these hold:

- the refusal is horizontal (`horizontalM > maxHorizontalM`) - never for a
  turn alone, which is a turned print or a bad heading (§7j #8);
- the offset is beyond `floorM` too (M5b review #1). The refusal's bound
  is `correctionBoundM` of the REPORTED accuracies, with no floor of its
  own beyond 5 m: 13.5 m at 2 m on both sides, 17.7 m at 3 m. Reported
  accuracy is not bias, so an unmoved code under an 8-15 m between-visit
  bias difference is refused at those reports. The refusal itself stays
  (the correction is still not applied); only the question waits for the
  floor;
- the mint gate is open (§7j #9);
- the refusal has lasted, without a break and for the same level, at least
  `minFixes` new fixes AND `minSeconds` of the fixes' own time. Fixes alone
  would pass a burst of fixes within a second; time alone would pass a GPS
  stall in which nothing new was learned. Fixes without a readable time
  leave the fix count to decide alone. Any break, another level, or a fix
  count that went down (a new session's store) starts the count again;
- no remembered answer for that level AND that saved pose lies within
  `sameSpotM` of the offset (M5b review #2). An offset is FROM the saved
  position of the time: after a replace the same offset names another
  place, so answers given against the old pose stop counting; an Undo
  restores the old pose, its key, and so its answers. A distance rather than bands: a band edge would ask again for a
  spot that GPS noise moved across it.

What the tracker does NOT decide: "Use the new spot" counts as answered
only once the replace happened (the setup checks `measureCode`'s
outcome; §7j #10), and the undo counts the spot as "Not now".

## The sweep (what the values rest on)

`code-move-prompt.sweep.test.ts`, all synthetic (no field recording yet):
device fixes at 1 Hz, per-axis Gauss-Markov error with tau 30 / 100 /
300 s and sigma 3 / 5 / 10 m, a bias that differs between the visit that
saved the code and this one by 0 / 8 / 15 m, the solver's translation
error as the mean of all fixes or a recency-weighted mean (60 s) - two
proxies, because the real solver sits between them - the saved pose's own
error from an independent visit after 60 s, the shipped bound at 5 m
reported accuracy (26.2 m) except in the floor arm, the gate at 3 fixes, 600 s sessions, 200 seeded
sessions per cell.

- **Persistence, swept 1 / 5 / 10 / 20 / 30 / 60 s (fixes = seconds).**
  - With sigma <= 5 m, a shared bias and a 5 m report no persistence ever
    prompted for an unmoved code - the 26.2 m bound of a 5 m report does
    that, and a phone reporting 2-3 m has a 13.5-17.7 m bound (the floor
    arm below).
  - Where an unmoved code IS refused (sigma 10 m, or 15 m of bias
    difference), persistence helps little: 20 s cuts those prompts by
    8-40 % against 1 s (for example 48 -> 37 of 200 at tau 30 s, 80 -> 72
    at tau 100 s, recency-weighted). The error is autocorrelated, so a
    refusal of an unmoved code lasts minutes, not seconds.
  - Cost: every second of persistence delays a moved code's prompt by a
    second (50 m moves: median 3 s at 1 s, 22 s at 20 s; 197-200 of 200
    prompted in every cell). 30 m moves: 140-200 of 200 at 20 s, fewer
    with the bias against the move.
  - 20 s is kept for what the model leaves out: the first fixes'
    short-baseline alignment, whose early refusals come and go. The
    verdict "persistence is not what prevents false prompts; the bound
    is" holds across the whole range.
- **The same spot, swept 5 / 10 / 15 / 20 / 25 / 30 m.** Two later visits
  of the same unmoved code (they share its saved pose, so only their own
  errors differ), and a second move of 20 or 30 m. In this arm the cell's
  bias B is EACH later visit's own, in a direction drawn per visit, so the
  two visits' biases differ from each other by 0 to 2B, about 1.27B
  (4B/pi) on average, not by B: the "8 m" cells below are two visits
  whose biases differ by 0-16 m, about 10 m on average.
  - 20 m asks again for an unmoved spot in at most 3 of 200 re-visits at
    sigma <= 5 m with a shared bias, up to 30 of 200 at B = 8 m, and
    misses about half of second 20 m moves (up to 11 of 200 second 30 m
    moves with a shared bias, 33 at B = 8 m).
  - 15 m: up to 14 of 200 (shared bias) and 72 of 200 (B = 8 m) asked
    again.
  - 25 m: misses 158-193 of 200 second 20 m moves.
  - A re-ask costs one tap; a missed second move leaves the Replace
    button. 20 m is the smallest value with re-asks under 5 % at
    sigma <= 5 m and a shared bias (the assertion the sweep pins).
- **The floor, swept 0 (none) / 15 / 20 / 25 m at a reported 2 / 3 / 5 m**
  (the worst cell across tau and solver proxy, of 200; persistence 20 s).
  The floor is the shared `MOVED_CODE_FLOOR_M` (coordinator decision
  2026-10-01, provisional 20 m): the regression gate's corpus has a worst
  cross-session disagreement of one reference point of about 14 m and a
  robust p90 of about 6 m, both synthetic, until the recalibration on the
  owner's recordings.
  - No floor, 2 m report: unmoved codes prompted in 49 / 111 of 200 at
    8 m of bias difference (sigma 3 / 5 m), 185 / 185 at 15 m, 188-195 at
    sigma 10 m. This is the finding: "up to about half" understates it at
    15 m.
  - 20 m (2 or 3 m report): 2 / 30 at 8 m, 51 / 105 at 15 m, 123-168 at
    sigma 10 m. 30 m moves prompted 163-200, 50 m moves 200 (sigma <= 5 m).
  - 25 m: 0 / 8 at 8 m, 6 / 42 at 15 m, 87-123 at sigma 10 m; 30 m moves
    prompted only 142-191.
  - 15 m: helps only a 2 m report (25 / 83 at 8 m); it is under a 3 m
    report's 17.7 m bound and changes nothing there.
  - A 5 m report is unchanged by any floor up to 25 m (its bound is
    26.2 m): 0 / 4 at 8 m, 2 / 29 at 15 m.
  - Verdict across the range: 20 m removes most unmoved prompts while the
    bias difference stays within the corpus's (8 m: 1-15 %), but NOT at
    15 m of difference (25.5-52.5 %), which only 25 m would mostly remove,
    at the price of about one 30 m move in ten more going unasked. 20 m
    is kept because 15 m is beyond the corpus's worst and a prompt only
    asks; sigma 10 m prompts at every floor swept.
- **What would reverse them:** field recordings in which an unmoved
  code's refusal comes and goes over more than 20 s (raise the
  persistence), or in which an unmoved code's offset differs by more than
  20 m between visits (raise `sameSpotM`, and the floor), or in which
  reported 2-3 m phones disagree between visits by 15 m or more (raise
  the floor towards 25 m).

## Invariants & assumptions

- The tracker is fed on every render; the same inputs give the same
  result (no clock of its own: time is the fixes' time).
- Answers are bounded (32), validated on the way in, and a list that does
  not read is no answers - the cost of failing that way is one prompt
  asked again, never a lost draft.
- Notes never move with the code (owner decision D19); nothing here
  touches them.

## Examples

```ts
let onset: MovePromptOnset | null = null;
const { onset: next, prompt } = trackMovePrompt(onset, {
  levelId: level.id,
  refusal: liveRefusal,
  offset: sightedCodeOffset(input),
  gateOpen: info.hasMatrix && info.sampleCount >= MIN_ALIGNMENT_SAMPLES,
  fixCount: positions.length,
  lastFixMs: positions.at(-1)?.timestamp ?? null,
  answers,
});
onset = next;
if (prompt !== null) show(movePromptText(prompt.horizontalM));
```

## Tests

- `code-move-prompt.test.ts` - persistence in fixes AND seconds, a yaw-only
  refusal, a refusal under the floor and a closed gate never asking, a break / another level / a
  restarted history starting again, timeless fixes, missing inputs; an
  answer covering its spot but not a markedly different one or another
  code; the answers' memory (same spot replaced, the cap, the defensive
  read); `isSecondCopySpot` (only a second-copy answer, for the same
  level, saved pose and spot); the text; the shipped rule.
- `code-move-prompt.property.test.ts` - for any sequence of inputs, a
  prompt only for a lasting horizontal refusal beyond the floor with the
  gate open at an unanswered spot, its `fixes` counted from the current run, and never
  before the rule's seconds; for any answers, a "Not now" never changes
  `isSecondCopySpot` and a second copy at the sighting's own spot always
  makes it one.
- `code-move-prompt.sweep.test.ts` - the sweep above (it prints its
  tables, pins monotonicity in persistence and in the floor, the chosen
  values' properties, and that its run-length shortcut agrees with the
  tracker at a 5 m and a 2 m bound).
- `authoring-settle.test.ts` "the moved-code prompt" and
  `playwright-tests/move-prompt.spec.js` - the composed setup and page.
