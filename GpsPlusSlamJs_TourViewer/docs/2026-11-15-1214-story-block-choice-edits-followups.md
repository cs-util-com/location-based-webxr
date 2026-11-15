# Story blocks: chip edits and their undo wording - follow-ups

Two gaps in how `editor-session.ts` writes a block's chip choices
(`ChoiceSpec`, `src/kinds/edit-kinds.ts.md`), found in a code reading
and not yet reproduced in a test. Each item is independent. Related: the session's sidecar
[`src/editor/editor-session.ts.md`](../src/editor/editor-session.ts.md),
the chip mechanism in [`src/kinds/edit-kinds.ts.md`](../src/kinds/edit-kinds.ts.md)
and the inspector's story cards in
[`src/editor/editor-shell/shell-inspector.ts.md`](../src/editor/editor-shell/shell-inspector.ts.md).

## Filed, not fixed

- **A chip edit's undo wording falls back to the raw field name.**
  `editBlockField` names the step "the <label> of <name>" from
  `blockFields(...)`'s label, and falls back to the field's own name when
  no field of that name has a label. A choice field (a floor arrow's
  `floorPlacement`, for one) is not among `blockFields`, so its undo
  reads "the floorplacement of <name>".
  - Fix: take the label from the choice's spec as well, and test the
    undo title of a chip press for each kind with a choice.
- **A story's short text can never write a chip.** `editStoryText` looks
  the field up in `storyBlockFields(block)` only and answers `unchanged`
  for any other name, so a choice field of a short text inside a story
  is dropped without a write.
  - Fix: let `editStoryText` accept the block's choice fields, through
    the same `blockFieldEdit` rule a free item's chip uses, so the
    pressed-chip-writes-nothing rule holds for both.
  - Test: a chip press on a story's short text writes one undo step, and
    the same press again writes nothing.
