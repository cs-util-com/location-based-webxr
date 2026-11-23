# held-edit-flow.ts

## Purpose

The page's run of an edit that reads first and may wait for the draft
question: Paste and Duplicate (`edit-main.ts`'s `pasteSelection`,
`duplicateItemSelection` and `duplicateFolderSelection`). It shows the work
running, says how it ended, and never says an edit was made before the
tour holds it.

## Public API

- `runHeldEdit(flow): Promise<void>` - while `flow.running()` (another
  Paste or Duplicate still runs) it runs nothing and says
  `EDIT_STILL_RUNNING` as a toast: the key that asked for it gets the
  answer the Edit menu's title gives. Otherwise it runs `flow.run()` with
  `flow.busy(true)` and a held working toast (`flow.toast(working, true)`,
  marked `aria-busy="true"`); both go however the run ends, a throw
  included (the throw then rejects `runHeldEdit`). Then:
  - a tour switched meanwhile (`flow.current()` false): nothing said;
  - a refusal (`{ kind: "refused", reason }`): `flow.refresh()`, then
    the reason as a toast;
  - a made edit: `flow.refresh()`, then `flow.made(result)`;
  - a held edit (`EditorHeld`, `editor-session.ts`): `flow.refresh()`,
    the flag and the toast go, and nothing is said until `landed`
    settles: once it gives a result (and the tour is still current),
    `flow.refresh()` and `flow.made(result)`; null (dropped, or refused
    by the tour by then) says nothing, since the draft gate already says
    the change was not applied. `runHeldEdit` resolves after that.
- `HeldEditFlow<T>` - what the page passes: `working`, `run`, `current`,
  `running`, `busy`, `toast`, `refresh`, `made`.
- `isHeld(value)` - whether an edit's outcome is `EditorHeld` (waiting
  for the draft question); the page's Paste of a cut and of stories,
  which read no pictures and so need no `runHeldEdit`, use it to say
  their edit only once it lands.
- `EDIT_STILL_RUNNING` - "A paste or a duplicate is still running", the
  words of that toast and of the Edit menu's Paste and Duplicate titles
  meanwhile (`editor-shell.ts` imports it).
- The toast `flow.toast` returns is used only through `setAttribute` and
  `remove` (the module's own `WorkingToast` type).

## Invariants & assumptions

- The busy flag is off while a held edit waits for the draft question:
  the edit is no longer running, and the creator answers the question
  first anyway.
- Pure of the DOM and the store: the page passes its own toast and its
  store's `duplicating` flag (`edit-main.ts`'s `heldEditOnPage`).

## Examples

```ts
await runHeldEdit({
  ...heldEditOnPage(mine, "Pasting..."),
  run: () => mine.paste(plan),
  made: (pasted) => toast(`Pasted ${String(pasted.objects.length)} copies`),
});
```

## Tests

`held-edit-flow.test.ts`: the busy toast and flag around a made edit, a
refusal said (an unreadable picture), a throw still clearing both, a
switched tour said nothing, a held edit silent until it lands and then
made, silent for a drop or a switched tour, and an edit asked for while
another runs saying so and running nothing.
