# `ar-elevation-control.ts`

## Purpose

The plus/minus elevation control inside the AR overlay (DEC-E1) — the DOM
surface for the manual vertical offset whose arithmetic lives in
`elevation-nudge.ts`.

## Public API

- `createArElevationControl(options) → ArElevationControl`
  - `options.root: HTMLElement` — **the SAME element passed to `initAR`**, i.e.
    `#ar-root`. See the trap below.
  - `options.onChange: (offsetM: number) => void` — called with the new offset in
    metres whenever it actually changes.
- `ArElevationControl`
  - `attach(): void` — put the control on screen. Idempotent.
  - `offsetM(): number` — the current offset, metres.
  - `dispose(): void` — take it down and release the DOM. Idempotent.

**Error modes:** none throw. Presses at a bound are no-ops (see below).

## Invariants & assumptions

- **It stays OUT of `#ar-root` until `attach()`, and removes itself on
  `dispose()`.** That element is `position: fixed; inset: 0` and is hidden only
  while `:empty`, so anything left attached keeps a full-viewport layer over the
  page whenever AR is not running. **That regression has shipped here once
  already** — `ar-hud.ts` avoids it the same way, and both are pinned by tests.
- **`onChange` never fires for a press that moved nothing.** It re-attaches the
  whole city's transform, so firing it at a bound would rebuild that for free,
  every press, for as long as the user leans on the button.
- **Both buttons carry an accessible name** (`aria-label` and `title`).
  `#ar-root` is no longer inert (r510 review), so its contents are reachable, and
  a bare `+` glyph tells a screen-reader user nothing.
- **The value readout is an `aria-live="polite"` region**, unlike the HUD's.
  This one changes only when pressed, so a polite announcement reports the result
  of the user's own action rather than narrating a number twice a second.
- **AR only.** The desktop preview attaches content with `demo-scene`, which sets
  identity and discards the offset; making it follow would lift the buildings
  away from the ground plane, route line and NPC agent, which all live on the
  preview's own scene and would stay put.
- Styling is by class (`.ar-elevation`, `.ar-elevation-button`,
  `.ar-elevation-value`) rather than inline, so CSS owns the look.

## Examples

```ts
const control = createArElevationControl({
  root: arRootElement,
  onChange: (offsetM) => reattachContentWithVerticalOffset(offsetM),
});
control.attach(); // now visible in the AR overlay
control.offsetM(); // 0
// ... user presses "+" twice ...
control.offsetM(); // 2 (with NUDGE_STEP_M = 1)
control.dispose(); // removed from #ar-root
```

## Tests

`ar-elevation-control.test.ts` (jsdom) — covers that it stays out of the overlay
root until attached, that attach/dispose are both idempotent and dispose really
removes it, stepping up and down with `onChange` reporting each change, the
signed label including zero, that no `onChange` fires at the bound, and that both
buttons have an accessible name.

## Related

- `elevation-nudge.ts` — the arithmetic and the label, testable without a DOM.
- `ar-mode.ts` — constructs, attaches and disposes this alongside the session.
- `ar-hud.ts` — the read-only readout that shares the `#ar-root` trap and the
  reasoning about it.
- `GpsPlusSlamJs_Docs/docs/2026-08-16-1123-ar-elevation-and-compass-controls-plan.md`
  — the plan and DEC-E1.
