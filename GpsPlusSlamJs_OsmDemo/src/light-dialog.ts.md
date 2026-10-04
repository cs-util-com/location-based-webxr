# light-dialog.ts

## Purpose

OsmDemo's light dialog (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-2140-osm-demo-light-settings-dialog-plan.md`,
DEC-LIGHT-1..6): the owner tunes the noon lighting live, reads the lit-surface
brightness and the heat-grid margin, and copies the result to paste back. A
DOM panel whose dependencies are passed in, so it is tested in jsdom without
WebGL.

## Public API

- `createLightDialog(deps): LightDialog`. It builds the panel hidden inside
  `deps.parent`.
  - `deps.opener?`: the button that opens it. It gets `aria-controls` and
    `aria-expanded`, and focus back on close.
  - `deps.initial`: the starting `LightSettings` (from the URL).
  - `deps.onChange(settings)`: called on every slider `input` and on Reset.
    `main.ts` applies the settings to the view and writes the URL.
  - `deps.measure(withMargin)`: a `LightReadout` for the view as it stands:
    `litLuma`, `margin | null` (only measured when `withMargin`) and `view`
    (the ground mode's label). It may throw, for example while the heat
    grid is still building.
  - `deps.copyText(settings)` and `deps.writeClipboard(text)`: the Copy
    button. `deps.showError(message)` is the page's error channel for a
    failed copy.
  - `deps.nextFrame?`: runs a callback once the in-progress state has
    painted. The default waits for an animation frame and then a task,
    because an animation-frame callback runs before that frame's paint.
- `LightDialog`:
  - `open`, `toggle()` and `close()`. Opening refreshes the brightness and
    focuses the first slider.
  - `refresh()`: re-reads the brightness when open. The page calls it on
    every sun move.
  - `settings` and `dispose()`.
- `HEAT_GRID_MARGIN_BOUND = 5`: the DEC-R4-5 bound that the check compares
  against.

## Invariants & assumptions

- **The element ids are the contract with the page and the e2e:**
  - `#light-dialog`;
  - `#light-<field>`, one range input per `LightSettings` field, with its
    range from `LIGHT_SETTING_RANGES`;
  - `#light-readout`;
  - `#light-check`, `#light-copy`, `#light-reset` and `#light-close`.
- **The gain ramp always rises.** A start dragged past the end moves the
  end, and the other way round, so the view never receives a ramp that
  `surfaceGainAt` refuses.
- **The brightness is read on `change` (release), not on `input`,** and
  without the margin's second render. Each reading is a full-frame readback
  (plan §7 item 4).
- **The async-action rule from the root CLAUDE.md:**
  - The check shows "Measuring…" with the button disabled, measures after a
    paint, then shows the result, or "Could not measure: …" when the
    measurement throws. The button always comes back.
  - Copy shows "Copying…" and then "Copied" or "Copy failed". A failure
    also goes to `showError`. The write runs inside a promise chain, so a
    clipboard that throws before returning a promise (insecure origin) is a
    failure too, and the button is re-enabled either way.
  - A settings change after "Copied" sets the label back to "Copy": the
    claim was about the settings copied.
- **The margin applies to this view only.** The text names the ground
  mode. It is not the DEC-R4-5 sweep, which covers every sun point.
- **Escape closes it from anywhere while it is open.** The listener is on
  the document and only while open. Focus returns to the opener only when it
  was inside the panel.
- **What the dialog does not do:**
  - On the fallback sky there is no scene environment, so "Sky light on
    buildings" has no effect there (`applyBuildingSkyLight` keeps three's
    own path).
  - On a phone the open panel covers the floating header, including its own
    opener. Close and Escape still close it; tuning is meant for desktop.

## Example

```ts
const dialog = createLightDialog({
  parent: el("scene"),
  opener: el("light-open"),
  initial: parseLightSettings(location.search),
  onChange: (s) => view.setLightSettings(s),
  measure: (withMargin) => ({
    ...view.measureLight({ withMargin }),
    view: "CPU ground + slope",
  }),
  copyText: (s) => describeLightSettings(s),
  writeClipboard: (t) => navigator.clipboard.writeText(t),
  showError: (m) => toast.show(m),
});
dialog.toggle();
```

## Tests

- `light-dialog.test.ts` (jsdom) covers:
  - opening with the brightness; Escape from inside and from anywhere;
    focus in on open and back to the opener; `aria-expanded`;
  - a slider reaching `onChange` and showing its value;
  - the ramp kept rising in both directions;
  - the brightness alone on release, the margin only on the check;
  - `refresh()` while open and while closed;
  - Reset;
  - the check's in-progress state, its result on both sides of the bound,
    the ground mode, no grid, and a measurement that throws;
  - the default `nextFrame` measuring only after the frame's task;
  - Copy on success, on a rejected write and on a write that throws at
    once, with the reason sent to `showError`, and a stale "Copied" dropped.
- `playwright-tests/scene-3d.spec.js`, "the light dialog", covers:
  - the button, the `l` key and Escape;
  - each lever brightening June noon, the URL surviving a reload, and the
    view booting in the tuned look (the same brightness within 2);
  - the readouts' parity with the sweep's independent inline measures on the
    same view. Measured 2026-09-24: lit 65.0 vs 65.0 and 64.9 vs 64.9, margin
    5.31 vs 5.31 and 5.49 vs 5.49 (two runs).
