# long-text-panel.ts

## Purpose

A long text's panel in the item inspector. It wraps its dock (`long-text-dock.ts`): the writer is kept under the head, the title is typed in the head, and the preview and width buttons sit beside it.

## Public API

- `longTextPanel(dock): KindPanel`:
  - `sync` passes the item's long text (or null) to `dock.sync`. When there is a text and a writer, it returns a draw with:
    - `key`: `JSON.stringify(dock.state())`.
    - `kept`: the writer.
    - `ownsFields`: true.
    - `title()`: a typed `data-field="title"` input.
    - `head()`: `lt-preview` and `lt-wide`, with `aria-pressed` while on.
    - `parts()`: empty.
  - `act` passes the press to `dock.act` only when the item is a long text.
  - `flush` calls `dock.flush`.

## Invariants & assumptions

- The dock is synced with null when another item or nothing is selected, so its preview closes with its selection.
- The key carries the dock's state, so pressing preview or width draws the head again.
- The title, buttons and wording were moved unchanged from `shell-inspector.ts`.

## Examples

```ts
const panel = longTextPanel(createLongTextDock({ ... }));
const draw = panel.sync(item); // draw.kept is the writer
```

## Tests

`../kind-panels/kind-panels.test.ts` (kept node, title field, head acts, key change). Through the shell: `../editor-shell/editor-shell.test.ts` ("the long text's preview", "a save while typing").
