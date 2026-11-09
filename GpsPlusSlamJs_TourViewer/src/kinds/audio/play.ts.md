# `kinds/audio/play.ts` - the visitor's audio row

## Purpose

The audio kind's row of `play-kinds.ts` `PLAY_KINDS`.

## Public API

- `AUDIO_PLAY` - `KindPlay<TourAudioBlock>`:
  - `card(block, host)` - a story's audio card: its transcript as words,
    its sound played through the host;
  - `assets(block)` - its audio file;
  - `world(block, env)` - by the view: `zone` -> `zonePart`, `spot` ->
    `spotPart`, a card -> null.

## Invariants & assumptions

- The view alone decides the behaviour; there is no separate mode field.

## Examples

```ts
worldPartOf({ ...block, view: "spot", radiusM: 6 }, env); // a SpotPart
```

## Tests

`play.test.ts` (the world door per view); the card through the item card's
tests.
