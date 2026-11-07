# character-card.ts

## Purpose

The character's row of the visitor's kinds (`play-kinds.ts`): what his item shows in a card and which files it reads. It used to be the longest case of the card's switch in `item-card.ts`.

## Public API

- `CHARACTER_PLAY: KindPlay<TourCharacterBlock>` with `card(block, host)` and `assets(block, characters)`.

## Invariants and assumptions

- **Views:** a story view (`isStageCharacterView`) stands him as a character look, `stage` as the plain cut-out, `card` only in the card. Where the host has no stage, nothing stands and the words still show.
- **Frames sheet:** a story view of a block whose `character` names a declaration with `frames` stands from the sheet (`sheet: true`); the `portrait` view's portrait stays his `image`. An unreadable sheet stands him from his `image` in one pose, takes back the figure's failure line and writes a debug line naming the sheet.
- **He stands through `host.stage.stand("figure", draw)`**, drawing with `world.showCharacter`. With no look the call carries no look argument, as the stage tells the plain cut-out apart by it.
- **Taps:** a story view sets the tap target (`bubble` for the bubble view, else his `voice`); the `stage` view clears it; a card view leaves it. The voice of a non-story view plays with the step (`host.sound`).
- **Files** (`assets`): his figure in every view but the card (the sheet for a story view of a declared character with frames, plus his image for the portrait view), and his voice in every view.

## Examples

```ts
CHARACTER_PLAY.card(block, host);
CHARACTER_PLAY.assets(block, characters); // ["knight", "sheet", "bell"]
```

## Tests

`scene-view.test.ts` (his views, sheet, portrait, voice and taps through the story panel), `item-contract.test.ts` (both character rows through both hosts), `free-items.test.ts` (a free figure), `play-kinds.test.ts` (his row fills a card).
