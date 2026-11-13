# sign.ts

## Purpose

A short text's `sign` view in the world: a board on one or two posts at the item's pose, readable from its `readAtM`, turning toward the visitor only when its `orientation` says so, with a glyph that points toward `pointsTo` when set.

## Public API

- (internal) `SHORT_TEXT_DEFAULT_READ_AT_M` - 4 m, the reading distance of a block without one.
- (internal) `SIGN` - the measures: board bottom 0.95 m plus 0.04 m per reading metre, wood colour, two posts above 0.9 m board width, turn and glyph easing rates.
- `signMeasures(readAtM, boardW)` - the board's bottom, its letter height and the posts' x positions.
- `signPart(block, env): WorldPart` - the built sign: a turning group (board, edge, front and back plates, posts and feet, the glyph at `renderOrder 6`), `tapTarget` the board.

## Invariants and defensive measures

- `orientation` absent or `world`: the sign keeps the creator's heading (the placement contract's turning row). `upright` and `face` turn it about the vertical axis only, eased, never tilted; the first frame snaps.
- `pointsTo` is read in the part's parent frame; a point at the sign's own place leaves the glyph as it is.
- Without a canvas (Node) the plates are blank but the board keeps its laid-out size, so the editor's boxes and the contract tests are real.
- `dispose()` frees every geometry, material and texture it made.

## Example

```ts
const part = signPart(
  { id, kind: "shortText", view: "sign", caption: "Gate", readAtM: 10 },
  env,
);
scene.add(part.object);
part.update?.({ seconds, viewer });
```

## Tests

`sign.test.ts`: standing on the ground and rising with the reading distance, the post count (property over widths), each orientation, eased turning, the glyph turning toward `pointsTo`. `placement.contract.test.ts` holds the sign as a turning view.
