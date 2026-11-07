# free-items.ts

## Purpose

The free items' host: what a station shows that no story brings. It is the second host of `showItemCard` (`scene-view.ts` is the story's) and stands a station's free characters as figures: from arrival, on every return, several in one station, each on a stage of his own. A tap plays his voice in the page's one voice channel; walking away pauses it and the return carries on.

## Public API

- `createFreeItems(deps): FreeItems`
  - `follow(isShown)` - every tick: figures of shown stations stand, the others go.
  - `faceVisitor(nue)` - turns the standing figures.
  - `tapped(tap)` - true when the tap hit a free figure. A voice plays, or stops for good when it is playing; the bubble view's tap shuts or opens the bubble.
  - `stop()` - nothing stands, no voice is kept. The next `follow` starts afresh.
- `deps`: `tour`, `characters`, `assets`, `loadAsset`, `makeStage`, `focus`, `checkPicture`, `pick`, `sayFailure`, and `makePlayer` as a seam for tests.

## Invariants and assumptions

- Never a story: nothing here touches a step, a story's end or the panel, and a station with only free items stays stepless.
- A stage holds one figure, so a figure has its own, made when he first stands.
- Figures are read once per tour object; another tour stops the old ones.
- A file landing after he left is dropped (`run`). A figure that cannot be shown says so once, in `sayFailure`, and tries again at the next return.
- A voice stopped by a tap stays off: only one that was wanted when the visitor left carries on.
- At a return the voice carries on only if the channel is free. Otherwise he stands silent at his place, and a tap continues (no waiting line).
- His look follows his voice: `speaking` with what is left of it, `spoken` once it ran out, `idle` when held, paused or never heard.
- A free video or sound has no look yet: it draws nothing and has no tap target here. `content-placement.ts` holds the seam for those looks, and the editor does not offer them.
- A free figure's words are in his look, so the card's places are written and read by nobody.

## Examples

```ts
const free = createFreeItems({
  tour,
  characters,
  assets,
  loadAsset,
  makeStage,
  focus,
  checkPicture,
  pick,
  sayFailure,
});
free.follow((id) => selectStationContentShown(state, id)); // every tick
if (free.tapped(tap)) return; // his voice or his bubble took the tap
```

## Tests

`free-items.test.ts` covers standing, leaving, failures, late files, the voice and the taps. `blocks-tour.spec.js` stands two free figures through the real page.
