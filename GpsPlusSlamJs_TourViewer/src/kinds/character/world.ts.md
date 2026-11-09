# `kinds/character/world.ts` - a free character in the editor's world

## Purpose

Draws a station's free character in the editor's 3D view as the visitor
sees a character: the die-cut figure of `character-look.ts`, turning
toward the camera by at most 60 degrees from his facing. A face (his
back from behind) shows at least half square on from anywhere within
120 degrees of his facing and from straight behind; about 150 degrees
round he stands edge-on, the limit of a 60 degree turn, which the
visitor's look has too. It is the character row's world part (`character-card.ts`
`CHARACTER_PLAY.world`), reached through the one world door
(`world-part.ts`), so the editor's stations layer draws it like any
other part. The visitor's page is unchanged: in play the row gives no
part, and the free host (`free-items.ts`) stands free characters.

## Public API

- `EDITOR_CHARACTER_VIEW` - `"speak"`: the story look a character whose
  view has none of its own stands in.
- `editorCharacterView(view)` -> the look drawn: a story view
  (`isStageCharacterView`) as itself; `stage`, or a view the looks do
  not know, as `EDITOR_CHARACTER_VIEW`; null for `card` (the visitor
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
  (none: nothing). `ready` rejects when the image cannot be read or
  decoded, so the renderer takes the part out.

## Invariants & assumptions

- His facing is the block pose's turn: the look's `restYaw` is 0 inside
  the placed group, and the look reads the camera in its own frame, so
  the 60 degree limit is measured from the pose.
- One pose, from `block.image`: the world door has no tour characters
  map, so a declared character's frames sheet is not read here (the
  editor draws him still).
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
figure alone (speak and pop-up), `stage` drawn in
the default story look and a story view in its own (no card), his
figure at least half square on from four headings round him (in front,
both sides, behind) over two poses and two distances, and the edge-on
limit 150 degrees round pinned (at least half square on within 120
degrees),
a load that fails rejecting `ready`, and dispose before and after the
image arrives.
