# `kinds/character/world.ts` - a free character in the editor's world

## Purpose

Draws a station's free character in the editor's 3D view as the visitor
sees a character: the die-cut figure of `character-look.ts`, which
faces the camera fully from every heading (a flat cut-out has no side
worth showing), the turn eased when the camera jumps. The pop-up view
does not turn at all (as for the visitor), so it can still stand
edge-on from its side. In the editor he shows his name tag; the full
bubble opens only while he is the editor's selection (`frame.selected`
is his block id) or while his line plays (the look's `bubbleRule`
"selection"), so a close camera over a station is not covered in
bubbles. It is the character row's world part (`character-card.ts`
`CHARACTER_PLAY.world`), reached through the one world door
(`world-part.ts`), so the editor's stations layer draws it like any
other part. The visitor's page is unchanged: in play the row gives no
part, and the free host (`free-items.ts`) stands free characters.

## Public API

- `EDITOR_CHARACTER_VIEW` - `"speak"` (the format's floor for a character, the
  view a new character gets): the look a view the looks do not know stands in.
- `editorCharacterView(view)` -> the look drawn: a look's view
  (`isStageCharacterView`) as itself; a view the looks do not know as
  `EDITOR_CHARACTER_VIEW`; null for `card` (the visitor
  sees nothing of him in the world).
- `PICKED_CHARACTER_PARTS` - the look's mesh names a press selects him by:
  his figure (front, back) and the pop-up's figure and backdrop. Every
  other mesh of the look (bubble, name tag, shadow, ring, scroll) has a
  no-op `raycast`, so his words, drawn over everything, never cover
  another item.
- `CharacterWorldDeps` - `decode(blob)` (default `createImageBitmap`)
  and `painters` (default the canvas painters): fakes in unit tests.
- `characterWorld(block, env, deps?)` -> `WorldPart | null`: null in
  `play` and for the card view. In `edit`, a group the renderer places
  at the block's pose; his image (`block.image`) is read through
  `env.loadAsset`, decoded and painted, and the look lands in the group.
  `update(frame)` turns and animates the look toward `frame.camera`
  (none: nothing), and tells the look whether `frame.selected` is
  his block id. `ready` rejects when the image cannot be read or
  decoded, so the renderer takes the part out.

- `CharacterCheck` and `CHARACTER_CHECK_KEY` - the part's object holds,
  under this `userData` key, a function returning what he shows now
  (bubble and name tag openness, squareness to the last frame's camera),
  null before his look is drawn; the editor's page checks read it.

## Invariants & assumptions

- His facing is the block pose's turn: the look's `restYaw` is 0 inside
  the placed group, and the look reads the camera in its own frame. The
  turning views ignore it (he faces the camera); the pop-up keeps it.
- One pose, from `block.image`: the world door has no tour characters
  map, so a declared character's frames sheet is not read here (the
  editor draws him still).
- `bubbleRule: "selection"` is passed only here: the visitor's look
  keeps the 9 m distance rule.
- No card holds his line (`noCard`), as the free host stands him; he is
  silent (`voiced` false).
- The decoded picture is closed once painted; a dispose before the image
  arrives leaves nothing made.

## Examples

```ts
const part = characterWorld(block, worldEnv("edit", assets, read));
part?.update?.({ seconds: 1, viewer: [0, 1.6, 5], camera });
```

## Tests

`world.test.ts`: null in play and in the card view, picked by his
figure alone (speak and pop-up), a view the looks do not know drawn in
the default look and a story view in its own (no card), his
figure showing his front square on every 5 degrees all the way round
over three poses and two distances, the turn eased when the camera jumps
round him, the full bubble open only while he is the selection (at four
distances, with no selection, another selection and his),
a load that fails rejecting `ready`, and dispose before and after the
image arrives.
