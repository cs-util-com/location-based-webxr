# guided-diagram.ts

## Purpose

The guided view's picture of one photo pair: panel A, an arrow with the change ("dim", "turn", "step back", "step aside", "stay", "nothing"), panel B. One SVG string built from constants only, so no input text ever reaches the markup the view inserts.

## Public API

- `DIAGRAM_KINDS` / `DiagramKind`: the fifteen kinds (light, rotation, distance, side step flat and deep, and `other`).
- `diagramSvg(kind)`: an `<svg>` with `viewBox="0 0 300 100"`, `role="img"` and an `aria-label` that says the change in words.

## Invariants

- Colours of the panel badges and the phone marks come from the page's CSS variables `--a`, `--b` and `--accent`; the rest is fixed dark-theme greys (the guided view is dark).
- Every kind draws a different picture.

## Example

```ts
figure.innerHTML = diagramSvg("light-dim");
```

## Tests

`guided-diagram.test.ts` (jsdom): every kind parses as SVG with the viewBox, the role, a label and both panel letters; every kind is different; the arrows name the change.
