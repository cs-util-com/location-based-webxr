# scene-player.ts

## Purpose

A station's scene, step by step (tour kit plan K4, §4.2): the steps in
order, a scene choice that jumps to its target step, and the end. Pure: it
says which step shows; `scene-view.ts` renders it and owns the tap and the
auto step's timer. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createScenePlayer(steps): ScenePlayer`
  - `current()` - the step showing, null once ended;
  - `next()` - continue (a tap or the timer); a choice is not continued,
    it waits for an answer;
  - `choose(optionId)` - answer the current choice: jump to its target
    step; an unknown option, or no choice showing, changes nothing;
  - `ended()`.
- `isPlayableInK4(step)` - false for a quiz step.

## Invariants & assumptions

- The steps come from `tour-stations.ts`, which already resolved every
  choice target to a step of the same station.
- **Quiz steps are skipped** until K5 renders them, as a lenient reader
  skips what it cannot show (K1 review R4); a choice whose target is a quiz
  lands on the next playable step after it. A scene of nothing playable is
  ended from the start, so its station is done when found.
- **Video** plays as its transcript (`scene-view.ts`; video itself is later,
  plan §5 K4); the player treats it as a normal step.
- Loops through choices are the visitor's doing (each jump needs a tap);
  a choice-free scene ends after exactly its playable steps (property test).

## Examples

```ts
const player = createScenePlayer(station.steps);
player.current(); // the first playable step
player.choose("left"); // on a choice: its target
player.next(); // null once the scene ended
```

## Tests

- `scene-player.test.ts` - order, the end, choices (wait, jump, unknown
  option, not current), skipped quizzes and a quiz target; property: any
  tap sequence over a choice-free scene shows exactly its playable steps in
  order.
