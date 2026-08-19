# `ar-entry.ts`

## Purpose

What a press of the AR button should do, and when a just-arrived fix should
offer to enter AR. Pure decisions — no DOM, no session, no map.

## Public API

- `arPressAction(inputs): ArPressAction` — `{ kind: "exit" | "enter" | "locate" }`.
- `shouldOfferAr(inputs & { awaitingFix }): boolean`.
- `ArPressInputs` — `{ sessionRunning, hasOrigin, lastFix, viewPosition }`.

No error modes. A non-finite coordinate answers "locate", never throws.

## Invariants & assumptions

- **`exit` beats everything.** A running session must always offer a way out —
  the same rule `arButtonState` puts above its own branches, because a
  full-screen view with no exit reads as being trapped.
- **`shouldOfferAr` is DEFINED IN TERMS OF `arPressAction`**, not written
  alongside it. The prompt's promise is "pressing AR now works", so it must be
  unreachable in any state where the press would do something else. A test
  asserts the two agree across every state rather than trusting the definition
  to stay that way.
- **"At my position" is the EXISTING 100 m gate** (`AR_REFRESH_DISTANCE_M` in
  `ar-walking.ts`), not a new threshold. Past that distance the data in the
  scene is not the data for where you are — which is the same question the
  refetch gate already answers, so the demo has one notion of "far enough to
  matter" rather than two that can disagree.
  - **Not `placeChangeDeclared`**, which the first plan named. It is a one-shot
    flag read and cleared inside the same synchronous dispatch that sets it, so
    it is `false` at every moment a user could press the button — and a map
    click never sets it at all, which is the case the feedback names first.
- **`hasOrigin` is a boolean, not the origin.** The only question asked is
  whether a fix ever arrived; `ar-origin.ts`'s `canEnterAr` already owns that
  predicate, and the framework's own type spells its longitude `lon` while
  everything measured here uses `lng`.
- **The finite-coordinate guard is belt-and-braces, not load-bearing**, and the
  code says so because mutation testing proved it: deleting both checks leaves
  every test green. `greatCircleDistance` returns NaN rather than throwing and
  `NaN <= x` is false, so asking "is it WITHIN the gate" already fails closed.
  The guard stays for the reason `ar-walking.ts` gives about the same pair of
  functions — it makes the closed direction deliberate rather than an accident
  of operator choice.
- **`awaitingFix` is NOT owned here.** It is a lifetime, not a rule: set by the
  press, read by the fix that follows, dropped by anything that supersedes the
  intent. `main.ts` owns it.

## Why the press decides, instead of the button disabling itself

The thirteenth session reported that the AR button "does nothing" before Location
has been pressed. It was modelled correctly — `arButtonState` returned `disabled`
with the hint "Waiting for a GPS fix" — but the hint reached only
`title`/`aria-label`, and **a phone shows neither**. What a user met was a faint
square that ignored them. Making the press _do_ the step it was waiting for
removes the state rather than explaining it.

**Why not enter AR and locate at once**, which was planned first and abandoned
after the cold review:

- `setZeroPos` is a no-op once set — first fix wins, and the anchor is immutable
  for the session (DEC-R11-6, enforced in the reducer).
- The scene anchor is explicitly `frozen` while a session runs.
- The horizontal placement is computed once at session start; only height is
  re-applied live.
- `startArMode` refuses outright without an origin, and `main.ts` gates the whole
  entry sequence on a non-null `zero` — so a session started without one gets no
  GPS registration and no entry pass, i.e. the ~98 m datum error the entry pass
  exists to remove.

So "both at once" would have started a session anchored where the user is not,
permanently, for its whole life. Deciding here — before anything starts — leaves
every one of those invariants untouched.

**The cost, stated plainly:** it is still two taps. The difference is that the
second one is _offered_ rather than remembered.

## Examples

```ts
const action = arPressAction({
  sessionRunning: arSession !== undefined,
  hasOrigin: canEnterAr(selectZeroReference(store.getState())),
  lastFix: lastFixPosition,
  viewPosition: selectOsmView(store.getState()).position,
});
if (action.kind === "locate") locateControl.start();
```

## Tests

`ar-entry.test.ts` — thirteen cases, no DOM. Both branches of the press
(no fix, view moved away, at the user, within the gate, session running) and
every reason the offer must stay silent.

The case worth keeping if anything is ever trimmed is **"agrees with
`arPressAction` exactly"**: the two predicates are separate functions and the
prompt is only honest while they say the same thing.

The wiring is covered by two e2e in `boot-and-shell.spec.js` — _"locates when
pressed without a fix, then OFFERS to enter AR"_ and _"does NOT offer AR when the
user only pressed the GPS button"_. The first caught a real ordering bug on its
first run: `clearArOffer()` drops the intent as well as hiding the prompt, and
the press handler armed the flag _before_ calling it, so the offer never came.
Nothing in the unit tests could have seen that — the flag is `main.ts`'s.
