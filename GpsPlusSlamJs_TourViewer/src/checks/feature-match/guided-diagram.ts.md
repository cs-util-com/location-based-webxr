# guided-diagram.ts

## Purpose

The picture of one shot against the scene's shot before it: panel A, an arrow with the change ("dim", "turn", "step back", "step aside", "stay", "nothing"), panel B. One SVG string built from constants only, so no input text ever reaches the markup the view inserts.

## Public API

- `DIAGRAM_KINDS` / `DiagramKind`: the eleven kinds `light-same`, `light-dim`, `light-dark`, `rot-0`, `rot-35`, `dist-2x`, `dist-3x`, `side-flat`, `side-same-deep`, `side-deep`, `other`. The synthetic quarter and half turns are never shot, so they have no picture.
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
