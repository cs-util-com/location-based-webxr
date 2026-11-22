# `anchor-release.ts`

## Purpose

The code-lock release of the deferred anchors. One call asks every live
anchor set to re-place its anchors once, at its next pass, so a code's exact
correction lands at once instead of waiting until the content is out of
view. It also marks the session as one in which a code voted.

## Public API

- `requestAnchorRelease(reason: 'code-lock')`: called by the QR tracking
  controller right after a lock's votes were cast. Sets the session bit and
  calls every receiver. `TypeError` for any other reason. A receiver that
  throws is logged; the others still run, and the caller never sees it.
- `registerReleaseReceiver(receiver): () => void`: a live anchor set's
  receiver; returns the unregister function. `TypeError` for a
  non-function.
- `hasCodeVoted(): boolean`: whether a code voted in this session. A set
  created after the lock (content that loads late) starts with its immature
  follow phase already ended.
- `__resetAnchorReleaseForTests()`: test only; forgets receivers and the
  session bit.

## Invariants

- With no set live, a request stores nothing but the session bit, so no
  stale request waits for a later set.
- The session bit is cleared by the session disposer flush, like every other
  per-session state.
- Imports neither three.js nor the store (`deferred-anchors.structure.test.ts`):
  the controller that calls it stays as light as it is.

## Example

```ts
const cast = dispatchVotes(votes);
if (cast !== false) requestAnchorRelease('code-lock');
```

## Tests

`deferred-anchors.test.ts` (release cases: one-shot, ends the immature
phase, closes the window, per session, a set created after a vote, the real
store path through the controller's votes) and the controller's own tests.
