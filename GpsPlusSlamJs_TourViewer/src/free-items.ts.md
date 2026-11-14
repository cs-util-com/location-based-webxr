# free-items.ts

## Purpose

The free items' host: what a station shows that no story brings. It is the second host of `showItemCard` (`scene-view.ts` is the story's) and stands a station's free characters as figures: from arrival, on every return, several in one station, each on a stage of his own. A tap plays his voice in the page's one voice channel; walking away pauses it and the return carries on.

## Public API

- `createFreeItems(deps): FreeItems`
  - `follow(isShown)` - every tick: the figures of stations no longer shown go first, then one figure of a shown station stands, then the voices left carry on.
  - `faceVisitor(nue)` - turns the standing figures.
  - `tapped(tap)` - true when the tap hit a free figure. A voice plays, or stops for good when it is playing; a voiceless bubble view's tap shuts or opens the bubble (a voiced one plays like any look, its bubble showing while he speaks).
  - `stop()` - nothing stands, no voice is kept. The next `follow` starts afresh.
- `deps`: `tour`, `characters`, `assets`, `loadAsset`, `makeStage`, `focus`, `checkPicture`, `pick`, `sayFailure`, `makePlayer` as a seam for tests, and `showItem?(block, host)` (the item lab swaps a kind in; `showItemCard` otherwise; the app passes none).

## Invariants and assumptions

- Never a story: nothing here touches a step, a story's end or the panel, and a station with only free items stays stepless.
- A stage holds one figure, so a figure has its own, made when he first stands.
- Figures are read once per tour object; another tour stops the old ones.
- A file landing after he left is dropped (`run`). A figure that cannot be shown says so once, in `sayFailure`, and tries again at the next return.
- A voice stopped by a tap stays off: only one that was wanted when the visitor left carries on.
- Every voice heard or held at leaving pauses and is numbered in order, the held first. At the return the highest number, the one heard last, carries on if the channel is free. The next takes the one place behind what runs and carries on when that ends or is tapped. Any further one stays silent at his place, and a tap continues (no waiting line).
- The leaves run before the stands: at overlapping stations a voice coming back finds the old one gone.
- One figure stands per tick, and no voice waits for his: building a look is a few milliseconds, and several in one task are a hitch.
- A free `portrait` keeps his figure, name tag and ring and gains the bubble (`noCard`), since no card shows his line here. The story's portrait does not change.
- His look follows his voice: `speaking` with what is left of it, `spoken` once it ran out, `idle` when held, paused or never heard.
- A free video is not built here: it stands as a screen, a cutout or a porthole through its world part (`kinds/video/video-world.ts`), by the station renderer's world door (`content-placement.ts`).
- A free figure's words are in his look, so the card's places are written and read by nobody, and no `surface` is offered.
- Its stage gives an item only a figure's door (`ItemWorld.showCharacter`, his look marked `noCard` and given his folders' `scale` from `tourFreeEntries`, so a character in a scaled folder stands as large as the editor draws him); no model door exists here, so a row that needs one stands nothing. Nothing waits for the visitor's position with a line, so `stand` passes no `onWaiting`.

## Not a world part yet: who owns a free figure's object

A kind's object in the world is a `WorldPart` (`world-part.ts`): the renderer (`content-placement.ts`) places it at its block's pose and frees it with the station, and the part never touches the scene. A free figure is not one yet. His object belongs to a `SceneStage` (`scene-stage.ts`), the same stage type the story's figure stands on: the stage adds it to the scene root at a pose of its own (`poseOf`), fades it in and out (`follow`) and turns it (`faceVisitor`).

- **Option A, the stage keeps it (today).** Nothing moves; free figures keep their own tap route (`tapped`) ahead of the world parts, and their own set (`figures`).
  - Against: a second way for a placed block to stand, which is what the one world door exists to end.
- **Option B, the renderer owns it (recommended).** A free character is a block with a pose at a station, which is exactly what the renderer places. His look becomes the character row's world part: `object` the look's root, `tapTarget` the figure, `update(frame)` the turn toward `frame.viewer` and the voice's ring, `leave` and `back` the walk away and the return. This host keeps only what is his: the voice in the one channel and the order voices carry on in. The story's figure stays on `SceneStage`, because it stands where a step puts it, not as a placed block.
  - Against: the presence fade and the "one figure stands per tick" rule move with the look, and both are pinned by this host's tests today.
  - To check first: where a free figure stands now (the station's pose from `poseOf`, or his block's pose). If they differ, moving him to the renderer moves him in the world, which needs a look on a phone.

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
