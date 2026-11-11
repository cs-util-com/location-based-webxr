# build-choice-switch.ts

## Purpose

The shared header checkbox whose choice rebuilds the city: the invented roofs
(`invented-roofs-switch.ts` names and words it) and the zebras and pedestrian
areas (`main.ts`). Shows the switch in progress, ends it on the mesh built
with the choice, and reverts a switch whose own build failed. One copy, so the
async-feedback behaviour cannot drift between the switches.

## Public API

- `attachBuildChoiceSwitch({ name, box, status, initial, choose, applying })`
  - `name` - used in the `TypeError` thrown when `initial` is not a boolean.
  - `applying(on)` - the status text while `on` is applied.
- `BuildChoiceSwitch`
  - `show(on)` - the store changed; the box follows.
  - `meshDrawn(on | undefined)` - a full mesh was drawn with that choice
    (absent means on); ends a pending switch that asked for it.
  - `failed(failedOn?)` - any failure ends a pending switch; only a failed city
    build WITH the pending choice reverts the box and calls `choose(drawn)`.
  - `pending()` - the choice being applied, or `undefined`.

## Invariants & assumptions

- While a switch is pending the box is disabled and the status reads
  `applying(choice)`; the state ends on the echoed mesh (the durable end
  state), never on the dispatch, and a mesh from a pass in flight with the
  old choice does not end it.
- Every choice behind it defaults on, so an absent field on a mesh means on.

## Examples

```ts
const markings = attachBuildChoiceSwitch({
  name: "zebras and pedestrian areas",
  box: el<HTMLInputElement>("markings"),
  status: el("markings-status"),
  initial: selectMarkings(store.getState()),
  choose: (on) => store.dispatch(markingsChanged(on)),
  applying: (on) => (on ? "Applying ..." : "Removing ..."),
});
markings.meshDrawn(mesh.markings);
```

## Tests

- `build-choice-switch.test.ts` (jsdom) - its own wording until the echo, the
  revert of its own failed build, the named `TypeError`.
- `invented-roofs-switch.test.ts` - the full behaviour through the roofs
  wrapper.
- `playwright-tests/scene-3d.spec.js` - the `roofs=off` and `markings=off`
  boot overrides end to end.
