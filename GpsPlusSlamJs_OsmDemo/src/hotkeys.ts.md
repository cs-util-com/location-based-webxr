# `hotkeys.ts`

**Purpose:** one keyboard-shortcut registry for the whole demo, so three
independent stages cannot silently claim the same key.

## Public API

- `new HotkeyRegistry(root: Document)` — attaches one `keydown` listener.
- `add(hotkey: { key, description, handler }): void` — **throws** if the key is
  already registered.
- `bindings(): readonly Hotkey[]` — registration order, for the help overlay.
- `dispose(): void` — removes the listener and clears the table.

## Invariants & assumptions

- **A duplicate key is a startup error, not a runtime surprise.** Two features
  claiming `t` is silent otherwise: both handlers run, or one shadows the other
  by registration order, and the symptom ("the preset key sometimes moves the
  sun") cannot be attributed from the outside.
- **Keys are case-sensitive.** `t` and `T` are separate bindings, because
  "step forward" / "step back" is the obvious pair.
- **Nothing fires while the user is typing** — `<input>`, `<textarea>`,
  `<select>` (native type-to-jump is typing) or any `contenteditable`.
- **Modified presses belong to the browser.** Ctrl/Meta/Alt combinations are
  ignored so `Ctrl+T` still opens a tab.
- **A throwing handler is logged, not propagated.** An exception escaping a DOM
  listener is unattributable at the call site.

## Why it exists at all

Before round 6 the demo had no hotkey infrastructure — the only `keydown`
listener in `src/` was on the header-collapse button. §1 (time of day), §3 (look
presets) and §6 (event clock) all need shortcuts, so the registry is built once
in §1 and reused.

## Examples

```ts
const hotkeys = new HotkeyRegistry(document);
hotkeys.add({
  key: "t",
  description: "step the sun forward",
  handler: () => view.setTimeOfDay(view.timeOfDayValue() + 0.05),
});
```

## Tests

- `hotkeys.test.ts` (jsdom) — dispatch, duplicate rejection, case sensitivity,
  the three typing contexts, modified presses, disposal, `bindings()` order, and
  a throwing handler not affecting the next press.
