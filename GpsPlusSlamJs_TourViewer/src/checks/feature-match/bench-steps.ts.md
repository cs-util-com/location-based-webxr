# bench-steps.ts

## Purpose

The benchmark page's guided flow: which of its four steps (1 photo A, 2 photo B, 3 run, 4 save) is done, current or still to do.

## Public API

- `StepState`: `"done" | "current" | "todo"`.
- `FlowState { a, b, run, saved }`: whether photo A and B exist, the run on that pair (`none`, `running`, `done`, `failed`), and whether its files were offered.
- `stepStates(flow)`: the four states.

## Invariants

- A step is done only when its own work exists and every earlier step is done (a saved flag without a finished run does not mark step 4).
- The first step that is not done is the only current one; later steps are todo. When all four are done there is no current step.
- A running or failed run leaves step 3 current, so "Run again" stays the obvious next action after a failure.

## Example

```ts
stepStates({ a: true, b: true, run: "done", saved: false }); // ["done", "done", "done", "current"]
```

## Tests

`bench-steps.test.ts`, including a property over every flow state.
