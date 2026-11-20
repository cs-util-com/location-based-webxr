# map-size.ts

## Purpose

The setup map sticker's size knob. The page ships one sticker size (`l`); a `?mapSize=s|m|l|xl` URL parameter picks another, and the parameter's mere presence shows a small "Map size" select in the window's bottom-left corner, so the four sizes can be compared on a device without a build. Without the parameter nothing is mounted and nothing is set: the CSS default holds from the first paint.

## Public API

- `MAP_SIZES`: `["s", "m", "l", "xl"]`, smallest first.
- `DEFAULT_MAP_SIZE`: `"l"`, the size `index.html` falls back to (`--sticker: var(--sticker-l)` on `.setup-stage`).
- `readMapSize(search)`: `{ size, knob }`. `knob` is true when the parameter is present at all (also empty); `size` is its value when it names a size, else the default.
- `withMapSize(search, size)`: `search` with the parameter set, every other parameter kept in place.
- `wireMapSize({ stage, search, mountKnob, replaceSearch })`: with the parameter, sets `stage.dataset.mapSize` and mounts the knob; a choice sets the attribute again and rewrites the URL through `replaceSearch` (main.ts: `history.replaceState`), so a reload keeps it. A value that is not a size is ignored.
- `mountMapSizeKnob(doc, sizes, current)`: the knob's DOM, a `label.map-size-knob` (`data-testid="map-size-knob"`) holding a `select`, appended to `body`.

## Invariants and assumptions

- The sizes are CSS, not here: `--sticker-s`, `--sticker-m`, `--sticker-l`, `--sticker-xl` on `body[data-mode="creator"] .setup-stage`, each `min(clamp(floor, share of vw, cap), share of svh)`, and one `.setup-stage[data-map-size="..."]` rule per size. `map-size.test.ts` reads `index.html` and fails when a size has no rule or the CSS fallback names another size than `DEFAULT_MAP_SIZE`.
- Not app state (root CLAUDE.md, "what stays outside" the store): a developer's presentation knob, read from the URL once, written back into it, read by no other view.
- Wired only for a creator (main.ts, after the setup stage).

## Example

```ts
wireMapSize({
  stage: document.getElementById("setup-stage")!,
  search: location.search, // "?mapSize=xl"
  mountKnob: (sizes, current) => mountMapSizeKnob(document, sizes, current),
  replaceSearch: (s) => history.replaceState(history.state, "", s),
});
// stage.dataset.mapSize === "xl", the knob shows "XL"
```

## Tests

- `src/map-size.test.ts`: parsing, the URL rewrite, the wiring with a structural select, and the CSS contract in `index.html`.
- The chosen size's width per viewport is pinned by `playwright-tests/setup-flow.spec.js` ("the setup card at WxH").
