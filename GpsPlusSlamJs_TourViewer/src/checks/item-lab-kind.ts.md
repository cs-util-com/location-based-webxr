# `item-lab-kind.ts` - a kind's folder, and what carries it through the hosts

## Purpose

What the item lab (`item-lab.ts`) and the contract table (`../item-contract.test.ts`) share: reading a folder of `public/prototypes/item-kinds/`, and the valid blocks that carry a kind no format knows through the two real hosts.

## Public API

- `kindNameOf(search)` - the kind a page's address names: `stamp-1` for none, null for anything that is not a folder name.
- `readItemKind(name, module, sample)` - a folder's `kind.js` and `sample.json` as an `ItemKind`. Throws a `TypeError` naming what is missing.
- `kindAssets(kind)` - its files as tour assets by id; a `path` is a file name in the folder.
- `storyCarrier(kind)`, `freeCarrier(kind)` - the block each host plays where the kind stands: a `shortText` card, and a `character` in the `speak` view, the only free block the free host stands.
- `storyStation(kind)` - a station with a two-step story: the kind, then a plain card.
- `freeTour(kind)` - a tour of one station where the kind stands free.
- `showWith(kind)` - the hosts' `showItem`: the kind for its carrier, `showItemCard` for everything else.
- `createSilentAudio()` - a `NarrationAudio` with a clock and no sound; `finish()` runs it out.

## Invariants and assumptions

- A kind's name matches `^[a-z0-9][a-z0-9-]*$`, so what a link says cannot leave the kinds' folder, and it is what the page builds a module URL from.
- The carriers are real, valid blocks, so a host's own logic (the step's advance, the free block filter) runs as it does for any item. Only the one block with the carrier's id reaches the kind.
- A kind that cannot stand in the free host says why in `freeKnown`; its contract row is then marked known, never skipped.
- The free host stands a kind as a figure drawn from its first `image` asset, so `readItemKind` refuses a kind with no image and no `freeKnown` note, with a line saying it needs one or the other. A `freeKnown` that is not a non-empty string (JSON null, "", a number) is refused too, with or without an image.

## Example

```ts
const kind = readItemKind("stamp-1", await import(url), sample);
const view = createSceneView({ ...deps, showItem: showWith(kind) });
view.offer(storyStation(kind));
```

## Tests

`item-lab-kind.test.ts`, and `../item-contract.test.ts` over every folder.
