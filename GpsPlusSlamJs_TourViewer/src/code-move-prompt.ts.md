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
  latest fix's own time), `answers`. `prompt` is a `MovePrompt`
  (`levelId`, `horizontalM`, `northM`, `eastM`, `yawDeg`,
  `maxHorizontalM`, `fixes`, `seconds`) or null.
- `isHorizontalRefusal(refusal)` - the refusal broke the horizontal bound
  (a yaw-only refusal is not).
- `MOVE_PROMPT_RULE` - `{ minFixes: 20, minSeconds: 20, sameSpotM: 20 }`
  (swept; see below). `MovePromptRule` is its type, so a test can pass
  another.
- `RememberedMoveAnswer` - `{ levelId, northM, eastM, answer }` with
  `answer` `"second-copy" | "not-now"`.
- `rememberMoveAnswer(answers, entry, sameSpotM?)` - adds an answer,
  replacing one for the same level and spot, keeping the newest
  `MOVE_ANSWERS_MAX` (32).
- `parseMoveAnswers(value)` - the answers in a meta value (external data):
  well-formed entries only, at most `MOVE_ANSWERS_MAX`.
- `movePromptText(horizontalM)` and `MOVE_PROMPT_LABELS` - the words.
- No input throws: an unreadable input yields no prompt.

## The rule

The prompt asks only when ALL of these hold:

- the refusal is horizontal (`horizontalM > maxHorizontalM`) - never for a
  turn alone, which is a turned print or a bad heading (§7j #8);
- the mint gate is open (§7j #9);
- the refusal has lasted, without a break and for the same level, at least
  `minFixes` new fixes AND `minSeconds` of the fixes' own time. Fixes alone
  would pass a burst of fixes within a second; time alone would pass a GPS
  stall in which nothing new was learned. Fixes without a readable time
  leave the fix count to decide alone. Any break, another level, or a fix
  count that went down (a new session's store) starts the count again;
- no remembered answer for that level lies within `sameSpotM` of the
  offset. A distance rather than bands: a band edge would ask again for a
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
accuracy (26.2 m), the gate at 3 fixes, 600 s sessions, 200 seeded
sessions per cell.

- **Persistence, swept 1 / 5 / 10 / 20 / 30 / 60 s (fixes = seconds).**
  - With sigma <= 5 m and a shared bias no persistence ever prompted for an
    unmoved code: the 26 m bound does the work.
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
  errors differ), and a second move of 20 or 30 m:
  - 20 m asks again for an unmoved spot in at most 3 of 200 re-visits at
    sigma <= 5 m with a shared bias, up to 30 of 200 with 8 m of bias
    difference, and misses about half of second 20 m moves (up to 11 of
    200 second 30 m moves with a shared bias, 33 with 8 m of difference).
  - 15 m: up to 14 of 200 (shared bias) and 72 of 200 (8 m) asked again.
  - 25 m: misses 158-193 of 200 second 20 m moves.
  - A re-ask costs one tap; a missed second move leaves the Replace
    button. 20 m is the smallest value with re-asks under 5 % at
    sigma <= 5 m and a shared bias (the assertion the sweep pins).
- **What would reverse them:** field recordings in which an unmoved
  code's refusal comes and goes over more than 20 s (raise the
  persistence), or in which an unmoved code's offset differs by more than
  20 m between visits (raise `sameSpotM`).

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
  refusal and a closed gate never asking, a break / another level / a
  restarted history starting again, timeless fixes, missing inputs; an
  answer covering its spot but not a markedly different one or another
  code; the answers' memory (same spot replaced, the cap, the defensive
  read); the text; the shipped rule.
- `code-move-prompt.property.test.ts` - for any sequence of inputs, a
  prompt only for a lasting horizontal refusal with the gate open at an
  unanswered spot, its `fixes` counted from the current run, and never
  before the rule's seconds.
- `code-move-prompt.sweep.test.ts` - the sweep above (it prints its
  tables, pins monotonicity in persistence, the chosen values' properties,
  and that its run-length shortcut agrees with the tracker).
- `authoring-settle.test.ts` "the moved-code prompt" and
  `playwright-tests/move-prompt.spec.js` - the composed setup and page.
