# item-card.ts

## Purpose

What an item (a block of any kind) shows in a card and which files it reads, behind a small host interface. What each kind does is its row in `play-kinds.ts`; this module dispatches to the row and names no kind, so a new kind is a compile error at its row (and `item-contract.test.ts` fails until it has a contract row).

## Public API

- `showItemCard(block, host)`: the item's words at once, its media as they load, by its kind's row. A block of a kind with no row writes the status line entry `item` ("This item cannot be shown here.") and a debug line naming the kind, and reads nothing.
- `itemAssets(block, characters)`: the files showing `block` may read, in the card or in the world, by its row; none for a kind with no row. Every file the card reads is on this list. The prefetch reads ahead from it, leaving out a video's files.
- `ItemCardHost`: what an item needs of whoever shows it.
  - `slots`: the card's places (`text`, `speaker`, `portrait?`, `image`, `video`). The host clears `speaker`, an item fills it. Existing kinds keep these.
  - `surface?`: an empty element of the card that an item fills on its own with elements it makes; the host empties it when the item stops. Absent where no card shows (the free host). In the app it is `#scene-surface` in the story panel, which is the card on a wide screen and the walk's sheet on a phone; empty, it takes no place (`:empty { display: none }`).
  - `characters?`, `checkPicture(blob)`.
  - `asset(id, what, use, onFail?)`: reads one file with its loading and failure lines.
  - `url(blob)`: an object URL the host frees.
  - `sound(id)`: plays with the item; the host owns the channel.
  - `stage?` (`stand(what, draw)`, `tapTarget(target)`): absent where nothing can stand. `stand` names no kind: the item draws through `draw(world, place)`, and the host adds what it owns (the status line's "waiting for your position" for `what`, the station).
  - `clip()` (`ItemClip`: `started`, `ended`, `lost(why?)`): a clip's three moments have three timings for a `lineEnd` step, so they are three calls.
  - `showing()`: false once the item stopped.
  - `notice(what, text | null)`, `debugLine(text)`.
- `ItemWorld`: the AR stage's doors an item draws with (`showCharacter`, his look at his own place). A model in a story is drawn by its world row (`kinds/model/world.ts`) once reached, never through the stage.
- `ItemPlace`: `stationId` and `onWaiting?`.
- `ItemTapTarget`: `{ bubble, voice }`, what a tap on the standing item does: shut or open its bubble, or play and stop `voice`.

## Hosts

Two hosts show items: `scene-view.ts` for a story's step and `free-items.ts` for what stands free in a station. Each takes an optional `showItem`, so the item lab (`checks/item-lab.ts`) can run a kind the format does not know yet through a real host; the list in `play-kinds.ts` stays closed. `ItemVideo`'s optional `paused`, `muted` and `play` are what the voice channel reads of a real element (`voice-focus.ts`).

## Invariants and assumptions

- **The item owns** what it shows, what it reads and its words. **The host owns** when it starts and stops, the sound, the placement, the status line, and what an end means (a next step, or nothing).
- **No module state.** Everything lives in the closures of one call and in its host, so nothing here assumes one item at a time.
- **Words first:** every kind sets its text synchronously, before any read. A lost file leaves the words and a status line.
- **A landing after the stop does nothing:** the host's `asset` drops it, and a use that awaits (`checkPicture`) asks `showing()` again.
- **No stage:** the words still show, a figure is not read, and a card view's voice still plays. A `portrait` view's portrait needs a stage today, because it loads with the figure. Off the card (`free-items.ts`) there is no place for it: the figure, name tag and bubble stand instead.
- **Not yet rows:** the world drawing itself (`ItemWorld`'s doors are the AR stage's, `scene-stage.ts`), and a story's clip and voice state in `scene-view.ts`. Those belong to the world step after this one.

## Examples

```ts
showItemCard(step, itemHost(station)); // scene-view.ts, one host per step
const readAhead = block.kind === "video" ? [] : itemAssets(block, characters);
```

## Tests

`play-kinds.test.ts`: every row fills a card through `showItemCard`, and a block of a kind with no row is refused with words. `item-contract.test.ts`: a table over the kinds, plus the look that reads a frames sheet, through the real story panel and the real free host: words at once, reads stay inside the declared list and inside what a write keeps, a late landing does nothing, a stop while a picture is measured shows nothing, no sound or object URL after a stop, a lost file keeps the words, one move on per end. A row is required for every kind of `TOUR_BLOCK_VIEWS`. Also a host with no stage, and the list itself for each view. `scene-view.test.ts` covers the per-kind behaviour in depth and did not change when the switch moved to rows.
