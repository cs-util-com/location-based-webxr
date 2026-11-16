# story-step-edits.ts

## Purpose

The choice and quiz inspectors' edits, pure: each control - the question,
an answer's words, its way on, Add and Remove answer, the right answer,
the points - turns into the whole step it writes. The editor session
writes that step as one undo step (`setStoryStep`), and the document
checks it as the format reads it (`withStoryStep` in
`../tour-story-edit.ts`), so nothing here repeats the format's rules
beyond what a control offers.

## Public API

- `StoryStep`: a choice or a quiz of a story. `SingleQuiz`: a quiz whose
  one right answer is picked from its answers, the one kind of quiz the
  inspector edits; `isSingleQuiz(step)` tells it.
- `MIN_ANSWERS` (2), `MAX_ANSWERS` (4): what Add and Remove offer.
- `STEP_FIELD` (`"step:"`): the prefix of the typed fields -
  `step:prompt` (a choice's prompt, a quiz's question),
  `step:label:<answer id>` and `step:points`.
- `stepFieldEdit(step, field, value)` -> the step, `null` (writes
  nothing: the value it has, a field it has not) or `{ invalid }` (points
  that are no whole number of 0 or more, said in words). Texts are
  trimmed; a blank one is passed on, and the document refuses it.
- `stepWithGoto(choice, answerId, value)`: the answer leading where the
  jump picker's value says (`""`, a step's id, `END_TARGET`); null for an
  unknown answer or the way it already has.
- `stepWithAnswer(step)`: one more answer ("Answer 3", the first free id
  `a1`, `a2`, ...), going on to the next step; null at four or for a quiz
  it does not edit.
- `stepWithoutAnswer(step, answerId)`: null at two or for an unknown
  answer; a quiz losing its right answer makes the first left right.
- `stepWithRight(quiz, answerId)`: null when it already is right, or is
  none of its answers.
- `StepKind` (`"choice" | "quiz"`) and `newStoryStep(kind, id)`: the
  step the story menu's Choice and Quiz add. A choice asks "What does the
  visitor choose?" with two answers ("Answer 1", "Answer 2", ids `a1`,
  `a2`) that go on. A quiz asks "What is the right answer?" for 10
  points with three answers ("Answer 1" to "Answer 3"), the first right.
  The prototype starts a quiz with three blank answers and no right one;
  this editor deviates on purpose: the words are placeholders and the
  first answer is right, because the format reads only a step with words
  in every field and a right answer, so the new step is valid (and
  playable) at once. Every one stays editable.

## Invariants and assumptions

- Pure: the step given is never changed.
- A function answers null for an edit that changes nothing, so a press
  never makes an undo step of nothing.
- An answer's id is unique among its step's answers only (the format's
  rule); a new one is short, so it never passes the id cap.

## Examples

```ts
const step = model.form.step;
const next = stepWithGoto(step, "a2", END_TARGET);
if (next !== null) edits.storyStep(next);
```

## Tests

`story-step-edits.test.ts`: the typed fields (trimmed, unchanged values
write nothing, points refused in words), the jump picker's write, Add up
to four and Remove down to two with fresh ids, and a quiz keeping its
right answer its own.
