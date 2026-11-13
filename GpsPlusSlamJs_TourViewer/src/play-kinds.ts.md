# play-kinds.ts

## Purpose

The visitor's kinds: one row per kind of the format (`TOUR_KINDS` in the framework's `ar/tour-kinds.ts`), saying what an item of that kind shows in a card and which files it reads. `item-card.ts` dispatches to these rows and names no kind itself.

## Public API

- `KindPlay<B>`: what a row holds.
  - `card(block, host)`: the item's words at once, its media as they load, through the `ItemCardHost` only.
  - `assets(block, characters)`: every file `card` may read, in the card or in the world.
  - `world?(block, env)`: the kind's part in the world (`world-part.ts` `WorldPart`), built with a `WorldEnv` (`mode` "play" or "edit", `loadAsset`, `canvasTexture`, `loadModel`, `enableClipping`, `sound`, `screen?`); null or absent: nothing stands. The audio row's is `kinds/audio/play.ts` (a `zone` or a `spot`), the model row's `kinds/model/world.ts` `modelWorld` (its world view through the adapter, in play and edit); the reading stand and the reading sign are still the renderer's own drawings until their kinds are next worked on.
- `PLAY_KINDS`: the list, keyed by `TourBlockKind`, in the format's order. Checked with `satisfies { [K in TourBlockKind]: KindPlay<TourBlockOfKind[K]> }`, so each row's block is its own kind's.
- `playKindOf(kind)`: the row of `kind`, or `undefined` for any value that is no kind this viewer knows (checked with `isTourBlockKind`, an own-property test, so `"toString"` or `"__proto__"` find nothing).
- `worldPartOf(block, env)`: the world door, its row's `world` part or `null` (no row, or no part). `viewer-placement.ts` hands it to the renderer as `worldPart`.

## Invariants and assumptions

- **A new kind is a compile error here, and only here, in the card's code.** Measured with a scratch kind `stamp` added to `TourBlockOfKind` (in the framework's built declaration, removed afterwards). The card code then fails in two places, both in this file:
  - `play-kinds.ts(168,12) TS1360`: the `satisfies` names the missing property `stamp`.
  - `play-kinds.ts(175,34) TS7053`: the lookup in `playKindOf` cannot index the list with the wider kind.
  - The same probe also fails outside the card, in sites this list does not own: `editor/block-fields.ts(65,7)`, `(85,17)`, `object-describe.ts(51,14)`, `tour-document.ts(2239,17)`.
- **A row may be inline or in its kind's module.** The character's (about 70 lines) lives in `character-card.ts`; the rest are small and inline. A kind that is next worked on may move to a module of its own; the list keeps one line for it.
- **No default arm.** A kind without a row does not compile; at runtime a block of a kind with no row (a newer tour's, a lab's) is refused by `showItemCard` with a status line, not shown blank.
- **Rows go through the host only.** A row never touches the DOM outside `host.slots` and `host.surface`, nor the stage outside `host.stage.stand`. What a row draws in the world goes through `ItemWorld` (the AR stage's doors). A model stands through its world row only.
- **Words first:** every row sets its text synchronously, before any read.

## Examples

```ts
const row = playKindOf(block.kind);
row?.card(block, host);
const files = row?.assets(block, characters) ?? [];
```

## Tests

- `play-kinds.test.ts`: the list has exactly the format's kinds in order; every row fills a card through `showItemCard` and reads only what its `assets` lists; a block of no known kind (`stamp`, `toString`, `__proto__`) is refused with words and reads nothing.
- `item-contract.test.ts`: the contract over every kind through the two real hosts.
- `scene-view.test.ts`: the per-kind behaviour in depth, unchanged by the move to rows.

## Short text in the world

`shortText.world` is `kinds/short-text/world.ts`: a sign or an edge hint stands in the world; a pin stays the renderer's label.
