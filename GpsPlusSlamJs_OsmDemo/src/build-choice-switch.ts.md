# build-choice-switch.ts

## Purpose

The shared header checkbox whose choice rebuilds the city: the invented roofs
(`invented-roofs-switch.ts` names and words it) and the zebras and pedestrian
areas (`main.ts`). Rebuilds the city whenever the store's choice changes,
shows the switch in progress, ends it on the mesh built with the choice, and
reverts a switch whose own build failed. One copy, so the async-feedback
behaviour cannot drift between the switches, and no switch can be wired
without its rebuild (the zebras switch once was, and waited forever).

## Public API

- `attachBuildChoiceSwitch({ name, box, status, store, choose, rebuild, applying })`
  - `store.selected()` - the choice (read at boot, from the link);
    `store.subscribe(listener)` - called back on every store change.
  - `choose(on)` - records a toggle (the store dispatch).
  - `rebuild()` - called once per change of `store.selected()`, whoever made
    it (this box, a revert, anything else); the box follows the change.
  - `name` - used in the `TypeError` thrown when the store's choice is not a
    boolean.
  - `applying(on)` - the status text while `on` is applied.
- `BuildChoiceSwitch`
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
  store: {
    selected: () => selectMarkings(store.getState()),
    subscribe: (listener) => store.subscribe(listener),
  },
  choose: (on) => store.dispatch(markingsChanged(on)),
  rebuild: () => void refresh(),
  applying: (on) => (on ? "Applying ..." : "Removing ..."),
});
markings.meshDrawn(mesh.markings);
```

## Tests

- `build-choice-switch.test.ts` (jsdom) - its own wording until the echo, the
  revert of its own failed build, the named `TypeError`, one rebuild per change
  of the store's choice (a toggle, a revert, an outside change).
- `invented-roofs-switch.test.ts` - the full behaviour through the roofs
  wrapper.
- `playwright-tests/scene-3d.spec.js` - the `roofs=off` and `markings=off`
  boot overrides end to end.
