# `colour-scheme-switch.ts`

## Purpose

The colour-scheme dropdown (colour schemes plan 2026-11-10-0841 section 4.4,
D6): fills `#colour-scheme` from the table, shows a switch in progress, ends it
on the echoing mesh, reverts it when its own build failed, and disables it in
AR (D9).

## Public API

`attachColourSchemeSwitch({select, status, initial, choose}) -> ColourSchemeSwitch`

- `show(name)` - the store's choice changed; the select follows.
- `meshDrawn(scheme)` - a full mesh built in `scheme` (absent = default) is
  drawn; ends the switch when it is the scheme being applied.
- `failed(message)` - the refresh failed; reverts only when the message is the
  build failure of the scheme being applied (`failedColourSchemeOf`).
- `setArActive(active)` - disables the select with `AR_REASON` as its title;
  entering AR drops a pending switch (AR's pass builds the default; the exit
  pass builds the choice).
- `pending()` - the scheme being applied, or `undefined`.

`RangeError` for an `initial` outside the table.

## Invariants & assumptions

- While a switch is pending the select is disabled and `status` reads
  "Applying <label>..."; both clear only on a mesh BUILT in that scheme, never
  on a mesh from a pass that was already in flight (the durable end state).
- An Overpass error, an abort or another scheme's failure leave the choice
  alone; the next pass carries it again.
- A revert dispatches the drawn scheme through `choose`, so the store, the
  link and the select agree with the screen again. The error itself goes
  through the page's toast (the existing error channel).
- A value outside the table (a tampered option) or re-picking the chosen
  scheme dispatches nothing.

## Examples

```ts
const control = attachColourSchemeSwitch({ select, status, initial, choose });
control.meshDrawn(mesh.colourScheme); // in onMesh, full meshes
control.failed(loading.message); // on the error phase
```

## Tests

`colour-scheme-switch.test.ts` (jsdom): the options and labels, the tampered
value, the in-progress state and the echo rule, the revert rule, AR. The three
switch tests need a second scheme and run once the table has one (S5).
