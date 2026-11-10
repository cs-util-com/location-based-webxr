# new-pin.ts

## Purpose

The editor's new items, as data, pure: the tree's add in place and the
add palette (a short text or a long text). Where a new item goes
in its station (inside the circle, clear of the items already there) and
the item itself, named by its number, standing on the ground where that
has loaded and seated in the station it was added to.

## Public API

- `freePinSpot(station)` -> `{ northM, eastM }` in the station's frame:
  the first place on rings of 4, 6, 8 and 10 m (each capped at the found
  radius), 12 places a ring starting due north and going clockwise, that
  keeps more than 2.2 m from every item standing in the world where it
  stands (`posedBlocks` of `../placement/placeables.ts`: an item in a
  folder through its folders, a free character too) and from every story
  entry of the station, so two characters of one station never share a
  spot; with none free, 4 m north (or the radius, if smaller).
- `NewItemInput` - `{ station, id, nowIso, groundAt }`, what each new
  item is made from.
- `newPin(input)` -> `TourPin`: a pin (a short
  text in its `pin` view) with that id and time, its caption "New pin n"
  (n one more than the station's pins), its `geo` at the free spot (`itemGeoPose`), its height the
  ground's there by `groundAt` (the anchor's height while none has
  loaded), and `station` set to the station's id, so the station rule
  does not seat it in another.
- `newLongText(input)` -> `TourReadingSign`: a long text in its
  `reading` view, titled "New long text n" (n one more than the
  station's long texts), its body `NEW_LONG_TEXT_BODY` ("Write the text
  here."; the file's long text needs a body), placed and seated as a pin
  is.
- `addNewItem({ stations, stationId, kind, id, nowIso, groundAt, place })`
  -> `NewItemOutcome` (`{ kind: "added", item }` or `{ kind: "refused",
reason }`): the add itself - the new pin or long text of the station,
  handed to `place` (the tour's own check, `EditorSession.place`).
  Refused in words when the station is gone (an undo or a delete between
  the press and the add: "That station is no longer in this tour -
  nothing was added.", `place` not called) or when `place` refuses (its
  words). The page toasts the refusal.

- `KIND_ADD`: one row per addable kind made from words alone
  (`TextAddKind`, in the add menu's order; a file's kind starts from its
  file: `new-file-item.ts`): `item(input)`, what it starts as at a station's free spot (typed per kind, so a row with another kind's maker fails to compile), and
  `entry(n)`, its own fields as a story's `n`-th entry of that kind. The
  add path reads it and names no kind.
- `storyEntryShell(station, id)`: what every new story entry starts as,
  made from words or from a file (`new-file-item.ts`): a card moving on
  by a tap, posed at the station's free spot (`freePinSpot`), a real
  place should it leave the story for the world, never the anchor's own
  point.
- `newStoryEntry(station, story, kind, id)` -> `TourStoryBlock`: a card a
  story shows, a short or a long text (`TextAddKind`), in the
  `storyEntryShell`, numbered within its kind in the story.

## Invariants & assumptions

- The spot is always within the found radius (a radius of 0 gives the
  anchor itself).
- `groundAt` answers ellipsoidal heights, as the file writes them; a
  non-finite answer counts as not loaded.

## Examples

```ts
const pin = newPin({
  station,
  id: newObjectId(),
  nowIso: new Date().toISOString(),
  groundAt,
});
session.place(pin); // one undo step
```

## Tests

`new-pin.test.ts`: an empty station, a taken spot, a small circle, a
property that the spot is inside the circle for any items and radius;
the pin's fields, its place in the frame, its height with and without
the ground; the long text's fields and its round trip through the file's
record (it parses back as written); `addNewItem`'s gone station, its
passed-on refusal and its placed item; a story entry's numbering and its
pose at the free spot.

## Characters

- `newCharacter({ ...NewItemInput, character })` -> `FreeCharacter`: the
  tour's declared character standing free at the station's free spot, on
  the ground there, in the `speak` view. `name` and `image` are copied from
  the declaration, and `character` names it.
- `addNewCharacter({ stations, stationId, character, id, nowIso, groundAt, place })`
  -> `NewItemOutcome`: the add menu's Character, placed. It is refused in
  the same cases as `addNewItem` (a station that is gone, or `place`'s
  words).
- `freeStorySpot(station, groundAt)` -> `StorySpot` (`{ northM, eastM,
upM }` in the station's frame): the free spot (`freePinSpot`), its
  `upM` the ground's height there above the spot at the anchor's height
  (0 where none has loaded), so a story entry stands on the ground as a
  free item does. Assumes the station's frame is upright (its rotation a
  heading only), as the free items' height does.
- `newCharacterEntry(character, id, spot)` -> `TourStoryBlock`: the
  declared character as a story's entry, a 3D character like a free one
  (view `speak`), standing at `spot` (a `StorySpot` in the station's
  frame, the caller's `freeStorySpot`; `upM` 0 when absent), facing
  north, tap to move on. It
  shares its id, pose and advance with `newStoryEntry` (`storyEntryShell`,
  both through the private `entryAt`).
- Tested in `new-pin.test.ts` ("newCharacter": the entry's spot and its
  height on the ground; "freePinSpot": clear of a story's entry).
