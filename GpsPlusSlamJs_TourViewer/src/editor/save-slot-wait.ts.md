# editor/save-slot-wait.ts

## Purpose

Waiting for the desktop editor's one save slot to be free, for a claimant
that must take it with no await between its last check and its claim: the
write of a link's or the sample's tour into the file chosen at its open
(`edit-main.ts` `keepInChosenFile`). Pure over the injected slot.

## Public API

- `SaveSlotView` - the slot as a waiter sees it: `busy()` (a save or
  another claimant holds it), `end()` (the promise the holding claim ends
  with, a new one per claim) and `settled()` (wait until no save runs; it
  never spins on a claim left set - `edit-main.ts` `savesSettled`).
- `waitForSaveSlot(slot, still): Promise<T | null>` - asks `still` what
  the slot is to be claimed for; while the slot is busy, waits for
  `settled()` and asks again. Resolves to `still`'s last answer:
  - null - nothing to claim it for any more (the pick was dismissed,
    another tour opened, a Save chose a file meanwhile); no wait is made
    when the first answer is null.
  - a value, with the slot free and no await since that was checked, so
    the caller's synchronous claim right after cannot collide with a save
    that started while `still` awaited.
  - a value with the slot still held, when the holding claim is stuck
    (still set after its `end()` settled, the same `end()` as before the
    wait): a bug, never a wait, so the caller's claim replaces it rather
    than the tab spinning.

## Invariants & assumptions

- `still` is asked once more after every wait: a save that ran may have
  changed what there is to claim for.
- The busy check after the last `still` has no await after it inside this
  function; the caller must claim before its own next await.
- Nothing is validated beyond the shapes: the slot and `still` are the
  page's own.

## Example

```ts
const handle = await waitForSaveSlot(
  { busy: saving, end: () => saveEnd, settled: savesSettled },
  () => stillToChoose(mine, pick),
);
if (handle === null) return;
const ended = claimSave("open"); // no await in between
```

## Tests

`save-slot-wait.test.ts`: a free slot answered at once; a running save
waited for and the claim asked again; a save that claimed the slot during
the last ask waited for too; a stuck claim stops the wait after one
settle (without that stop the test spins until the worker runs out of
memory); null without a wait; null when the reason went while a save
ran; and a property over runs of up to 20 saves: the answer comes only
with the slot free, after one ask per wait plus one.
