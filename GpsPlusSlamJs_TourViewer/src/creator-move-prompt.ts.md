# creator-move-prompt.ts

## Purpose

The moved-code prompt and its undo (UI round 1, U3: "Did the poster move
here?"): the state and the DOM. WHEN it asks is `code-move-prompt.ts`'s;
WHAT a "Yes" does is the settle's (`code-position-settle.ts`, in
`creator-setup.ts`). Split out of `creator-setup.ts` unchanged in the code
book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
M5 asks it per code in view.

## Public API

- `wireCreatorMovePrompt({ ctx, arStore, dom, draft, sessionLive, levelInHandIsStored, judgeRefusal, settled, alignmentInfo, render }): CreatorMovePrompt`
  - `dom` (`CreatorMovePromptDom`): `movePrompt`, `movePromptText`, the
    three answers `movePromptUse` / `movePromptCopy` / `movePromptLater`,
    and `moveUndo`, `moveUndoText`, `moveUndoButton`.
  - `draft` - where the answers are remembered (`creator-draft.ts`).
  - `settled(visit)` - the visit has settled (`creator-setup.ts`'s
    `visitSettles`); `judgeRefusal()` re-judges the latest sighting's
    refusal for the panel line.
- `CreatorMovePrompt`:
  - `render()` - re-run the tracker (logging a new ask once) and draw the
    prompt and the undo; called from the readout render.
  - `settling(visit)` - the visit settles: its "Yes, it moved" is applied
    and can no longer be undone. `clearUndo()` - a Finish wrote the tour.
  - `endVisit()` - the running ask goes; `reset()` - a tour closed: the
    ask and the undo go.

## Invariants & assumptions

- **When it asks** (authoring plan §3.6 "Authoring (D20 ask
  once)", M5b; `code-move-prompt.ts` decides WHEN): on every readout
  render the tracker is fed the latest sighting's offset through the
  current GPS alignment (`sightedCodeOffset`; its own 15 m trigger since
  D26, whether or not the settle refuses the correction, so between 15 m
  and the refusal bound the visit follows the code while the prompt
  asks; the refusal itself is still re-judged whenever a fix landed,
  `judgeRefusal`, for the panel line, never moving the earlier objects), the
  mint gate's alignment half, the store's fix count and the latest
  fix's time, and the remembered answers. It asks only for a stored
  level in hand, in a live session, outside a Finish. A new ask logs
  `tourAuthoring/codeMovePrompted` once per run beyond the trigger.
  - Every answer ("Yes, it moved", "No, it's a second poster", "Not now") is remembered per level and spot
    (`rememberMoveAnswer`), in memory and in the draft's meta
    (`creator-draft.ts`, re-stated by every meta write, read at tour open
    whether or not the draft is restored and merged with answers given
    before it opened); a refused meta write is the backup notice.
  - "Yes, it moved" changes nothing at once: the status line says the
    new spot is saved when the visit ends if the creator walked enough,
    and the settle applies it (`creator-setup.ts`). Logged as
    `tourAuthoring/codeMoveAnswered` `moved` (`replaced` false).
  - **Undo until the visit settles**: a "Yes, it moved" can be taken back
    until its visit settles (a session end or a Finish - also one that
    fails afterwards); Undo re-answers the spot "Not now" (logged as
    such), so the prompt does not ask again at once. Nothing else needs
    restoring: nothing changed before the settle.

## Tests

Composed, through `wireCreatorSetup`: `authoring-settle.test.ts` (the ask,
its three answers, the undo, the remembered answers and their meta write),
and the e2e move prompt specs. The trigger itself: `code-move-prompt.test.ts`.
The sampled mutants of the region "move prompt"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
