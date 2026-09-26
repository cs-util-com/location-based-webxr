# qr-debug-readout.ts

## Purpose

What the TourViewer says about a code's fused QR pose (QR near-frontal pose
plan §66-§67). Since b4b a code votes only while its fused pose is stable,
so a field session where "the tour did not place" needs to say why:

- the `?debug=1` readout - per code, how often its fused pose was stable
  and why not - the owner's attribution in a field session;
- the visitor's hint while a code is read but has not voted yet, instead
  of "Scanning for the printed code…".

## Public API

- `type FusedTallies = Map<string, FusedPoseTally>` - per decoded text, the
  framework's `createFusedPoseTally` (the QR demo's `?qrperf` counts by the
  same rule, DEC-H3).
- `tallyEvaluation(tallies, text, result)` - count one new evaluation.
- `codeLabel(text)` - the text's last 12 characters (for codes 2 and up
  they carry the `n` token; code 1 has none), `…`-prefixed when cut; the full launch URL does not fit a line.
- (module-private) `fusedCountsLine(label, counts)` - one code's counts on one line:
  `<label>: locks N, stable S | views a (empty e), fit b, fallback c, motion d, order f | re-reads r, natives ignored k`.
- `debugReadoutLines({ status, unknownCode, unusableCode, tallies })` - the
  block: `qr: <controller status>` (the running controller's own status,
  so the creator's reads right too; milestone review of b4c #2) (with `no level: <id>` / `no size: <id>`),
  then one line per code, or `no code evaluated yet`.
- `HINT_STALE_MS = 2000` - how long the hint outlives its evaluation.
- `interface LastEvaluation { text; result; atMs }`.
- `visitorFusedHint({ last, status, nowMs })` - the hint, or null:
  - null unless the controller status is `tracking` or `scanning` and the
    evaluation is at most `HINT_STALE_MS` old (it describes the code in
    view, never one seen a while ago; plan §67 #5). `scanning` is in: one
    missed detection turns `tracking` into `scanning` until three hits in
    a row, and gating on `tracking` alone flickered the line back to
    "Scanning for the printed code…" (milestone review of b4c #1);
  - a stable result: "Code measured - waiting for the first GPS fix." - a
    stable pose that did not vote waits for the session's GPS zero
    (`canAcceptVotes`), not for the code (plan §67 #1);
  - else "Measuring the code: " + "keep it in view while you move
    slowly." for `views` (and an empty result; the intro's wording - a wall
    poster cannot be walked around, milestone review of b4c #3), or the
    creator's `waitingFor(reason)` copy for the other reasons.

## Invariants & assumptions

- **Read, never evaluate.** The render runs per camera frame; the hint
  reads `ctx.viewerLastEvaluation`, set in the source's `onEvaluated`, so it
  never evaluates past the vote budget's short-circuit (plan §61 #6).
- **The counts freeze at the vote budget** (10 voted locks per code -
  several seconds of stable locks at the 1-2 locks/s the phone showed),
  not at placement: the viewer stops evaluating
  a code once its budget is spent (§60). Capture-spot placement does not
  wait for votes. A code that was decoded but never LOCKED (or has no
  level, or no size) is never evaluated and leaves no line; the head line's
  status and codes are then the attribution.
- **Lifetime:** one `FusedTallies` per pipeline start (per AR session), held
  in the pipeline's closure and on `ctx.fusedTallies`; KEPT at session end
  and replaced at the next start (plan §67 #10). A tour switch inside a
  session (`archive-open.ts`) empties it IN PLACE and clears
  `ctx.viewerLastEvaluation` - the pipeline outlives the switch (PR #508
  review).
- **One code in view.** With two codes in view the hint describes whichever
  was evaluated last and can alternate; `viewerLockedText` exists only from
  the first vote, when the hint is gone (PR #508 review). A late evaluation of an
  ended session counts into its own old map only.
- **`HINT_STALE_MS` = 2 s:** the viewer evaluates on each lock; the phone
  field tests (r731-r736) showed 3.6-3.8 hits/s of ~7.5 detects/s and
  fewer locks, with runs of misses between. 2 s bridges a normal run of
  misses; 0.5-1 s would flicker at that cadence, and much longer would
  keep describing a code that left the view. To be checked against the
  miss-run lengths of the first TourViewer field session.

## Examples

```ts
const tallies: FusedTallies = new Map();
createFusedQrPoseSource({
  entriesOf,
  onEvaluated: (result, _ms, text) => tallyEvaluation(tallies, text, result),
});
arDebug.textContent = debugReadoutLines({
  status,
  unknownCode,
  unusableCode,
  tallies,
}).join("\n");
```

## Tests

- `qr-debug-readout.test.ts` - the block string-exact, the unknown/unusable
  head, the label, the hint per reason, the stable-without-vote state, and
  its silence while not tracking, once stale and before any evaluation.
- `fused-pose-wiring.test.ts` - both pipelines feed the counts; the
  viewer keeps the last evaluation; counts outlive the session end and a
  late evaluation reaches neither the new counts nor the hint.
- `tour-flow.test.ts` - the hint in the composed status line.
- `ar-entry.test.ts` - the real `renderArStatus` writes the block only with
  the flag and shows the hint from the last evaluation.
- `qr-viewer-mode.test.ts` - the hint's precedence in `viewerStatusLine`.
- `archive-open.test.ts` - a tour switch clears the hint's evaluation and
  empties the counts in place.
