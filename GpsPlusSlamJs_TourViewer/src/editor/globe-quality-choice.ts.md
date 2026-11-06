# globe-quality-choice.ts

Purpose: the View menu's quality entry: which tier the 3D view on the globe opens with, remembered per browser.

## Public API

- `GLOBE_QUALITY_CHOICE`: the storage key and the choices in cycle order (`auto`, `low`, `medium`, `high`).
- `readGlobeQualityChoice(storage)`: the stored choice; automatic for anything unknown, a throwing storage or none.
- `writeGlobeQualityChoice(storage, choice)`: keeps it; false when the browser refused (a private window), which the caller reports.
- `nextGlobeQualityChoice(choice)`: the entry's cycle.
- `globeQualityChoiceLabel(choice)`: the entry's words.
- `qualityToOpenWith(link, choice)`: the tier's name for the view: the link's, else the choice's, else null. Null is automatic: the Globe package's `resolveGlobeQuality` takes the device's default and the step-down may act.

## Invariants

- The module imports nothing of the globe: `edit-main.ts` reads it on the first load, before the globe chunk.
- A tier is fixed for a view's life (the sea compiles its wave count), so a change takes effect at the next open; the page says so in a toast.
- A link beats the stored choice, so a tester's link does what it says.
- The names are judged by `resolveGlobeQuality`, not here: a mistyped link warns once there.

## Example

```ts
const choice = readGlobeQualityChoice(window.localStorage);
openGlobeEditor(deps, {
  ...globeSwitch,
  quality: qualityToOpenWith(globeSwitch.quality, choice),
});
```

## Tests

`globe-quality-choice.test.ts`, with a property test over the cycle.
