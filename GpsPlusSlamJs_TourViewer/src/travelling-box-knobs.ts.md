# travelling-box-knobs.ts

## Purpose

Reads the travelling box's tuning (`TravellingBoxKnobs`,
`travelling-box-rules.ts`) from the page's address for a field sweep. A
visitor's address never changes how the words behave: parameters are read
only behind `?debug=1`, and only when they name a value the sweep compares.

## Public API

- **`TRAVELLING_BOX_KNOB_VALUES`** (module-private) lists the allowed values per numeric
  knob:
  - `thr`: 10 / 12 / 14 / 16 / 20;
  - `keep`: 0.85 / 0.9 / 0.95;
  - `holdDock` and `holdPlate`: 0.3 / 0.6 / 1;
  - `lock`: 0 / 0.3 / 0.6 / 1;
  - `angle`: 35 / 45 / 60;
  - `fly`: 0.35 / 0.45 / 0.6.
- **`travellingBoxKnobs(search, debug)`** gives the knobs.
  - Without `debug` it returns the defaults.
  - With `debug`, each `tb.<name>` that names an allowed value replaces
    its default.
  - `tb.metric` takes `min` or `h`.
  - `tb.grow` takes `on` or `off`.

## Invariants and assumptions

- The parameters are static config, read once when the page starts. Being
  configuration rather than app state, they stay out of the store.
- A value outside its list, including an empty one, keeps the default. A
  typo never reaches a value nobody judged.
- The caller passes `debug` (`debugUiEnabledFromSearch`, framework
  `utils/debug-flag`), so this module stays pure.

## Examples

```ts
const knobs = travellingBoxKnobs(
  location.search,
  debugUiEnabledFromSearch(location.search),
);
// ?debug=1&tb.thr=14&tb.grow=off -> { ...defaults, thr: 14, grow: false }
```

## Tests

`travelling-box-knobs.test.ts` covers four cases:

- the defaults;
- that nothing is read without debug;
- every knob's allowed values;
- the fallback to the default for anything else.
