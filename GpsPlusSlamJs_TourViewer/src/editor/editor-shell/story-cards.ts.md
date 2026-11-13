# story-cards.ts

## Purpose

A story's steps as the story inspector's cards, pure: what each step is,
how a block moves on, where each answer of a choice leads (a jump chip
the editor can follow), a quiz's right answer and where the story goes
after it, and the loop warning on the steps of a loop no answer can
leave, with its one fix on the loop's last choice. `shell-inspector.ts`
draws them; `inspector-model.ts` puts them on the story's inspector.

## Public API

- `storyCards(steps)` -> `StoryCard[]`, one per step, in order:
  - `id`, `number` (1-based), `kind` (the tree row's kind: a block's
    look, `choice`, `quiz`);
  - `tag`: "Asks" (a choice), "Quiz", or "Shows <a kind>" for a block
    (`kindWithArticle`);
  - `title`: a choice's prompt, a quiz's question, a block's name as the
    tree shows it (`storyRows`);
  - `line`: "The visitor picks one of <n> answers." /
    "<n> points for the right answer, then the story goes on."; null for
    a block;
  - `chips`: a block's moves-on chip (`advanceChip`); none for a step;
  - `answers`: a choice's answers, each with its `jump`; a quiz's answers
    with `right` and no jump, then "After the answer" with the quiz's way
    on;
  - `issue`: the loop's message (`storyTrap`) on each step of the loop;
  - `fix`: `Let "<label>" end the story` on the loop's last choice
    (its last answer's words, "the last answer" when blank), else null.
- `StoryCardJump { text, type, to }`: the chip's words (`stepJumpText`),
  its kind (`next`, `jump`, `back`, `end`, `missing`) and the id of the
  step it leads to (null for the end or a gone step).
- `advanceChip(advance)`: "After <s> s", "On a tap", "When the line
  ends".

## Invariants and assumptions

- Pure; the steps are never changed. The graph is `story-steps.ts`'s, so
  the chips, the jump picker and the Problems list never disagree.
- A quiz whose answer is not a single pick (a typed answer) shows only
  its "After the answer".
- The fix is offered only where a click can fix it: a loop with no
  choice (which the format cannot build today) carries the warning only.

## Examples

```ts
const cards = storyCards(story.children);
cards[1].answers[0].jump; // { text: "goes back to step 1", type: "back", to: "t1" }
```

## Tests

`story-cards.test.ts`: the tags, titles and lines of a block, a choice
and a quiz, each answer's jump chip, a quiz's right mark and "After the
answer", and the loop warning on every step of the loop with the fix on
its last choice only.
