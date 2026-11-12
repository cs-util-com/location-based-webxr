# story-steps.ts

## Purpose

Where each step of a story leads, as a pure graph over the story's
children: an answer of a choice goes on to the next step, jumps ahead,
goes back, ends the story, or (naming a step the story no longer holds)
nowhere; a block and a quiz go on to the next step, right or wrong. On
that graph it finds the one jump the editor warns about: a loop no answer
can leave. The step cards' jump chips, the choice inspector's jump picker
and the Problems list read it.

## Public API

- `END_TARGET` (`":end"`): the jump picker's value for "End the story".
  No child id holds a colon, so it never names a step.
- `stepJump(steps, index, option | null)` -> `StepJump`: `next` / `jump` /
  `back` (with the target's index `to`; a jump to the step itself is
  `back`), `end` (`implicit` when the last step simply goes on) or
  `missing` (a goto to a gone step). `option` null: the step's own way on
  (a block, a quiz).
- `stepJumpText(jump)`: the chip's words ("next: step 3", "jumps to step
  4", "goes back to step 1", "ends the story", "then the story ends",
  "jumps nowhere").
- `stepExits(steps, index)` -> indexes; `steps.length` stands for the end.
  A missing jump counts as the end, as the visitor's player ends there.
- `trappedSteps(steps)`: the steps reachable from the first one that can
  never reach the end, ascending.
- `loopSteps(steps, trapped)`: of those, the steps on the loop itself.
- `storyTrap(steps)` -> `StoryTrap | null`: `{ steps, fixOn, fixLabel,
message }`. `steps` is the loop; a step stuck with no loop (a choice
  with no answers, which the format never holds) is none, and gives
  null. `fixOn` the id of the loop's last choice,
  whose last answer the editor offers to make end the story, and
  `fixLabel` that answer's words (both null when the loop holds no
  choice). `message`: "Steps 1 and 2 go round in a loop that no answer
  can leave: ..." / "Step 2 leads only back to itself that ...".
- `stepNumbers(indexes)`: "Step 1", "Steps 1 and 3", "Steps 1, 2 and 5".
- `gotoChoices(steps, index, title)` -> `GotoChoice[]` (`{ group, value,
label }`): the next step (`value` ""), every step ahead, every step back
  including the step itself ("Ask this again (step 2)"), then the end
  (`END_TARGET`).
- `gotoValue(steps, index, option)`: the picker's value for an answer; a
  goto to the next step reads as the next step.
- `withGoto(option, value)`: the answer leading where the picker says,
  holding one way at a time (`goto` or `end`, never both - the format's
  reader refuses both).

## Invariants and assumptions

- Pure and total: no input is mutated, out-of-range indexes give empty
  exits, an empty story has no trap.
- Backward jumps are allowed; only a loop no answer can leave is warned
  about. A jump to a gone step is not a trap (the visitor's story ends).
- Cost is O(n^2 * answers) for n steps (fixed point over the steps); a
  story holds a few dozen steps at most.

## Examples

```ts
const trap = storyTrap(story.children);
if (trap !== null) warn(trap.message);
const ways = gotoChoices(story.children, i, (s) => stepTitle(s));
const next = withGoto(option, picked); // "" | step id | END_TARGET
```

## Tests

`story-steps.test.ts`: the jump kinds and their chip words, the picker's
ways and values, the trap's message and fix, and two properties over
random stories - the trapped steps equal a transitive-closure oracle
(every loop step trapped and reaching itself), and the offered fix always
changes the trap it is offered for.
