# setup-stage.ts

## Purpose

The setup page's question, checklist and map (polish round M2b, the L5
look; the question and its paths, `setup-path.ts`). Step 1 is ONE question
whose four answers only route; step 2 is the chosen path as a short
checklist with the current item active, Back and Next under the card, and
the path's stations on the map with the route drawn up to the open one.
What to show comes from `setup-stations.ts`; every move goes through
`wizard.openStep`. Plan: polish-round plan, "M2b - the L5 look".

## Public API

- `wireSetupStage<T>({ dom, openStep, answer, onAnswer, createElement, map?, reducedMotion? }): SetupStage`
  - `answer()` - the chosen answer (the page's `setupPath` slice), null
    while the question shows;
  - `onAnswer(answer | null)` - an answer tapped, or "Change the answer"
    (null). The CALLER stores it, opens the path's first step
    (`firstStepOf`, which knows the stored host) and calls `render`; the
    stage itself opens nothing on an answer;
  - `dom.steps` - every wizard step's `<details>` (their `toggle`
    re-renders); `dom.summaries` - their `<summary>`s, whose click is
    cancelled so a tap on the open step's heading cannot collapse it;
  - `dom.question` (hidden on a path), `dom.answers` (buttons carrying
    `data-answer`), `dom.change` (hidden while asking), `dom.card`
    (`data-path` = the answer, `none` while asking: the page's CSS shows
    what belongs to one path, and hides every step under the question);
  - `dom.badge` / `dom.of` - "1" / "Step 1 of 2" while asking, "2" /
    "Step 2 of 2" on a path; `dom.dots` - the checklist; `dom.nav`,
    `dom.back`, `dom.next`;
  - `dom.begins` / `dom.stage` - each of the landing's "Make your tour"
    buttons scrolls the stage to the top (smoothly, or at once when
    `reducedMotion()` says so) and moves focus to the question's first
    answer while asking, else the open step's `<summary>` (`preventScroll`:
    the scroll is the button's);
  - `openStep` - `wizard.openStep`; `createElement` - for the checklist's
    items (injected so the tests run in node);
  - `map` (optional) - `{ route, reveal, stations, start?, endFlag? }`:
    the path's stations are drawn into `stations` on the route slots the
    path takes (`stationSlot`), the route revealed up to the open one, the
    poster at the start hung once the path's "hang" is done (`data-hung`),
    the end flag up at the completion step (`data-on`). While asking, the
    route is not drawn. Drawn only where the browser can measure the route
    (`getTotalLength`, `getPointAtLength`).
  - **The map shows the OPEN STEP's position, not progress** (PR #585
    review): going back shortens the drawn route. The map is a "you are
    here"; nothing on the page tracks what was done.
- `SetupStage.render()` - redraw from the answer and the steps' open
  state; the checklist and the map stations are rebuilt when the answer
  changed.
- Checklist items are buttons (`.setup-item`) with
  `data-testid="station-<step>"`, `data-state` and `aria-current="step"` on
  the current one; map stations carry `data-testid="map-station-<step>"`;
  both open their step.

## Invariants & assumptions

- The wizard stays the one owner of the open step, so its AR rule holds:
  during a session the create step stays open, and an item or Back/Next
  changes nothing.
- An answer only routes: the stage never opens a step, saves or opens a
  tour on an answer.
- Wired after the visitor screen in `main.ts`: that one reveals the
  creator-only parts, and the stage's own hidden states must be the last
  word. `main.ts` also re-renders it when an answer is inferred from an
  open tour (a store subscription).
- Creator page only (`main.ts` does not wire it for a visitor).

## Examples

```ts
const stage = wireSetupStage<HTMLButtonElement>({
  dom,
  openStep: (step) => wizard.openStep(step),
  answer: () => selectSetupAnswer(store.getState()),
  onAnswer: (answer) => {
    choose(answer);
    if (answer !== null) wizard.openStep(firstStepOf(answer, hostChosen));
    stage.render();
  },
  createElement: (tag) => document.createElement(tag),
  map: { route, reveal, stations },
});
```

## Tests

- `setup-stage.test.ts` - the question as step 1, an answer that only
  routes and "Change the answer", an item per path step with the open one
  current, items and Back/Next opening steps through the wizard, the row's
  rules, the heading that cannot collapse its step, a re-render when the
  wizard opens a step by itself, and every "Make your tour" button's
  scroll (instant under reduced motion) and focus (the first answer while
  asking).
- `playwright-tests/setup-path.spec.js` - the question and each path in a
  browser, the map inset (portrait) and halves (landscape);
  `playwright-tests/setup-flow.spec.js` - one step at a time by station.
