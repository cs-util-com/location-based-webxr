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

## The step cards' grips and footer against the chosen prototype

The story inspector's step grips and footer were built from the step
cards prototype
([`public/prototypes/story-editor-1-step-cards-r2/index.html`](../public/prototypes/story-editor-1-step-cards-r2/index.html))
and checked side by side at 390x844, 844x390 and 1280x800. What differs,
each intended or filed:

- **Intended: the dragged card does not follow the finger.** The
  prototype moves the card with a transform; the build marks it
  (`dragging`) and shows the slot as a line, which is the station
  tree's drag (`createTreeDrag`, the editor kit's `tree-drag.ts`), so the
  two lists drag the same way.
- **Filed: no loop warning at the drop line.** The prototype turns the
  drop line into a warning ("Dropping here makes a loop no answer can
  leave", its `trappedSteps` check in the pointermove handler) when the
  new order would trap a visitor more than the old one. The build shows
  the line only; the Problems list names the loop after the drop.
  - Fix: let `createTreeDrag` report the slot as it moves (a `slot`
    callback beside `reorder`), and have the shell compare
    `storyTrap` (`../src/editor/story-steps.ts`) for the order with and
    without the move, setting a class and the words on the line.
  - Test: an e2e drag that would make a loop shows the warning before
    the drop and none for a harmless slot.
- **Intended: the grip is an `aria-hidden` span**, not a button. The
  keyboard path is each card's Earlier and Later, which move the step one
  place as one undo step.
- **Filed: nothing shows when a finger's hold arms.** The prototype
  starts its drag at once; the build waits 150 ms for a rested finger
  (`STEP_GRIP_ARM`), and the card is marked only at the first move after
  that, so a finger resting on a grip sees no sign that it may now drag.
  - Fix: mark the card when the hold has passed although no move came
    yet (a timer from the press, cancelled by any decided state), and
    check on a phone whether the mark should be a lift or the grip's
    colour.
- **Intended: the label "Add step..." and the eye icon for Preview** (the
  icon set has no play icon); on a narrow desktop panel the Add label
  shortens with an ellipsis and Preview stays whole.
- **Intended: the phone footer sits at the sheet's foot (59 px)** rather
  than as the prototype's 67 px bar along the whole page; landscape keeps
  a footer with 30 px buttons where the prototype moves the actions into
  its header; Delete and Move stay above the footer; the footer's sides
  are 10 px in, as the cards are.
- **Open: a phone check of the grip's flick.** A flick that starts on a
  grip scrolls the cards (`touch-action: pan-y` on the grip, and the
  drag's non-passive `touchmove` holds them still once a rested finger
  drags). Chromium's touch emulation passes both in
  `playwright-tests/editor3d-story-cards.spec.js`; a real phone has not
  been tried.
