# world.ts

## Purpose

The short text's world door (`PLAY_KINDS.shortText.world`): what stands in the world for each view.

## Public API

- `shortTextWorld(block, env): WorldPart | null` - `sign` to `signPart`, `edgeHint` to `edgeHintPart`, null for the rest (a `pin` is the renderer's label; a `card` stands nothing).

## Invariants

- A view this door does not know stands nothing rather than throwing.

## Tests

`world.test.ts`: each view through the door.
