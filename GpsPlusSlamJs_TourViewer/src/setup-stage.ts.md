# setup-stage.ts

## Purpose

The setup page's station row and map (polish round M2b, the owner's
chosen L5 look): the badge and "Step n of 6", a dot per step, Back and Next
under the card, the six stations on the map and the route drawn up to the
open one. What to show comes from `setup-stations.ts`; every move goes
through `wizard.openStep`. Plan: polish-round plan, "M2b - the L5 look".

## Public API

- `wireSetupStage<T>({ dom, openStep, createElement, map?, reducedMotion? }): SetupStage`
  - `dom.steps` - the six step `<details>` (their `toggle` re-renders);
    `dom.summaries` - their `<summary>`s, whose click is cancelled so a tap
    on the open step's heading cannot collapse it;
  - `dom.badge`, `dom.of`, `dom.dots`, `dom.nav`, `dom.back`, `dom.next`;
  - `dom.begins` / `dom.stage` - each of the landing's "Make your tour"
    buttons scrolls the stage to the top (smoothly, or at once when
    `reducedMotion()` says so) and moves focus to the open step's
    `<summary>` (`preventScroll`: the scroll is the button's). The stage
    has no heading of its own; the open step's is what the reader acts on;
  - `openStep` - `wizard.openStep`; `createElement` - for the dots
    (injected so the tests run in node);
  - `map` (optional) - `{ route, reveal, stations, start?, endFlag? }`:
    the route path, the mask path that reveals it, the group the stations
    are drawn into, the poster at the route's start (`data-hung`) and the
    flag at its end (positioned at the route's end, `data-on` at the last
    step). Drawn only where the browser can measure the route
    (`getTotalLength`, `getPointAtLength`).
  - **The map shows the OPEN STEP's position, not progress** (PR #585
    review): `stationView` marks every step after the open one `todo`, so
    going back to step 1 shortens the drawn route and takes the poster down
    although the creator did hang it. `setup-stations.test.ts` pins that as
    intended - the map is a "you are here", and nothing on the page tracks
    what was done.
- `SetupStage.render()` - redraw from the steps' open state.
- Dots carry `data-testid="station-<step>"`, map stations
  `data-testid="map-station-<step>"`; both open their step.

## Invariants & assumptions

- The wizard stays the one owner of the open step, so its AR rule holds:
  during a session step 5 stays open, and a dot or Back/Next changes
  nothing.
- Wired after the visitor screen in `main.ts`: that one reveals the
  creator-only parts, and the row's own hidden states must be the last
  word.
- Creator page only (`main.ts` does not wire it for a visitor).

## Examples

```ts
wireSetupStage<HTMLButtonElement>({
  dom,
  openStep: (step) => wizard.openStep(step),
  createElement: (tag) => document.createElement(tag),
  map: { route, reveal, stations },
});
```

## Tests

- `setup-stage.test.ts` - a dot per step and the open step's number, a dot
  and Back/Next opening steps through the wizard, the row's rules on steps
  1, 5 and 6, the heading that cannot collapse its step, a re-render when
  the wizard opens a step by itself, and every "Make your tour" button's
  scroll (instant under reduced motion) and focus on the open step.
- `playwright-tests/setup-flow.spec.js` - the page in a browser (the map's
  stations, the one-step card, the widths).
