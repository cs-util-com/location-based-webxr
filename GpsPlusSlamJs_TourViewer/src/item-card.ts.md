# item-card.ts

## Purpose

What an item (a block of any of the seven kinds) shows in a card and which
files it reads. The switch that used to live in `scene-view.ts`, behind a
small host interface, so one place says what each kind does and a new kind
fails to compile until it says so (and `item-contract.test.ts` fails until
it has a row).

## Public API

- `showItemCard(block, host)`: the item's words at once, its media as they
  load. Ends in a `never` check: a kind with no case does not compile, so no
  kind can show a blank card.
- `itemAssets(block, characters)`: the files showing `block` may read, in the
  card or in the world. Every file the card reads is on this list. The
  prefetch reads ahead from it, leaving out a video's files.
- `itemStoredAssets(block | object, required?)`: the files a tour keeps for
  `block`, wider than `itemAssets`, because a write keeps what another view
  of the same item would read. `required` leaves out the pictures a long
  text's body names, which may be missing. A captured photo's own asset is
  `objectAssetIds`' concern in `tour-content.ts`.
- `ItemCardHost`: what an item needs of whoever shows it.
  - `slots`: the card's places (`text`, `speaker`, `portrait?`, `image`,
    `video`). The host clears `speaker`, an item fills it.
  - `characters?`, `checkPicture(blob)`.
  - `asset(id, what, use, onFail?)`: reads one file with its loading and
    failure lines.
  - `url(blob)`: an object URL the host frees.
  - `sound(id)`: plays with the item; the host owns the channel.
  - `stage?` (`ItemStage`: `character`, `model`, `tapTarget`): absent where
    nothing can stand.
  - `clip()` (`ItemClip`: `started`, `ended`, `lost(why?)`): a clip's three
    moments have three timings for a `lineEnd` step, so they are three calls.
  - `showing()`: false once the item stopped.
  - `notice(what, text | null)`, `debugLine(text)`.

## Hosts

Two hosts show items: `scene-view.ts` for a story's step and `free-items.ts` for what stands free in a station. Each takes an optional `showItem`, so the item lab (`checks/item-lab.ts`) can run a kind the format does not know yet through a real host; the switch here stays closed. `ItemVideo`'s optional `paused`, `muted` and `play` are what the voice channel reads of a real element (`voice-focus.ts`).

## Invariants and assumptions

- **The item owns** what it shows, what it reads and its words. **The host
  owns** when it starts and stops, the sound, the placement, the status line,
  and what an end means (a next step, or nothing).
- **No module state.** Everything lives in the closures of one call and in
  its host, so nothing here assumes one item at a time.
- **Words first:** every kind sets its text synchronously, before any read. A
  lost file leaves the words and a status line.
- **A landing after the stop does nothing:** the host's `asset` drops it, and
  a use that awaits (`checkPicture`) asks `showing()` again.
- **No stage:** the words still show, a figure or model is not read, and a
  card view's voice still plays. A `portrait` view's portrait needs a stage
  today, because it loads with the figure.

## Examples

```ts
showItemCard(step, itemHost(station)); // scene-view.ts, one host per step
const readAhead = block.kind === "video" ? [] : itemAssets(block, characters);
```

## Tests

`item-contract.test.ts`: a table over the seven kinds, plus the look that
reads a frames sheet, through the real story panel: words at once, reads
stay inside the declared list and inside what a write keeps, a late landing
does nothing, a stop while a picture is measured shows nothing, no sound or
object URL after a stop, a lost file keeps the words, one move on per end. A
row is required for every kind of `TOUR_BLOCK_VIEWS`. Also a host with no stage, and the list itself
for each view. `scene-view.test.ts` covers the per-kind behaviour in depth
and did not change when the switch moved here.
