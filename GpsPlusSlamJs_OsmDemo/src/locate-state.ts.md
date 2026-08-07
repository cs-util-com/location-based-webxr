# `locate-state.ts`

**Purpose.** The labels and error mapping behind the "my location" button, kept pure so they can be tested without a browser.

## Public API

- `LocateState` — `idle | locating | located | denied | timeout | unavailable`.
- `labelFor(state): string` — the button's text. Every state has a distinct, non-empty label.
- `stateForError(code): LocateState` — maps a `GeolocationPositionError.code` (1/2/3) to a state.

## Invariants & assumptions

- **`locating` must not read like `idle`.** `CLAUDE.md`'s async-feedback rule requires a distinguishable in-progress state for anything above a few hundred ms, and a GPS fix routinely takes seconds.
- **The three failures stay three failures.** `denied` is fixed in browser settings, `timeout` by going somewhere with a view of the sky, and `unavailable` not at all. A shared "location failed" would drop the only actionable part of the message.
- **Unknown codes degrade to `unavailable` rather than throwing.** The codes are a fixed set in the spec, but this is a browser API and the error object is whatever the browser hands over — and a button that throws inside its own error handler leaves the UI stuck on "locating…" forever, which is worse than a wrong message.

## Examples

```ts
labelFor("locating"); // "locating…"
stateForError(1); // "denied"
stateForError(undefined); // "unavailable"
```

## Tests

`locate-state.test.ts` — idle and in-progress differ; every state has a non-empty label; the three failures produce three distinct actionable messages; the three spec codes map correctly and anything else degrades to `unavailable`.
