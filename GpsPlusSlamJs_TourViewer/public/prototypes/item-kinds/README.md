# Item kinds

Each folder here is one kind of item to try in the item lab. Pages and files here are linked from nothing in the app.

## Adding a kind

1. Copy `stamp-1/` to a new folder, say `lantern-1/`. Touch no file outside your folder: no registry, no build.
2. Write `kind.js` to the contract below.
3. `sample.json` holds `name`, `words`, `records` (`normal`, `longest` and `missing`, each a raw record) and `assets`. The free host stands the kind as a figure drawn from its first `image` asset; if the kind has no image, or cannot stand in the free host yet for another reason, add `"freeKnown": "why"` (a kind with neither is refused).
4. Open `/tour/item-lab.html?kind=lantern-1`: the left side is a story, the right side a station with the kind's world view beside the figure. Try every control: each record, play and edit, the dark backdrop, a tap in the world, ten rounds.
5. Run `pnpm run test:unit src/item-contract.test.ts`: your folder is a row of that table in both hosts.

What you deliver is a look and a behaviour. Adding the kind to the tour format is a later build step.

## The contract

The same halves a kind of the app has (`src/play-kinds.ts`, `src/world-part.ts`):

- `read(record)` - optional. Gives `{ block, problems }`: the record as the kind uses it, and what it had to fix (a name cut, a file missing). Without it the record is the block. The lab reads each record once, at load, and shows its problems.
- `assets(block)` - every asset id `card` or `world` may read.
- `card(block, host)` - fills the story card through `host` only (`ItemCardHost` in `src/item-card.ts`). Set the words first, then read files through `host.asset`. To stand a figure, call `host.stage?.stand(what, (world, place) => ...)`; elements of your own go in `host.surface` when it is there.
- `world(block, env)` - optional. Gives `{ object, tapTarget?, tap?, update?, dispose }`:
  - `object` is in metres, Y up, origin at its foot; `env.loadAsset(id)` gives a file, `env.canvasTexture(canvas)` a texture, and `env.mode` is `"play"` or `"edit"`;
  - `update(frame)` runs every frame with `frame.seconds` and the viewer's position; in `edit` the part stands still;
  - `dispose()` frees every geometry, material and texture it made;
  - it never touches the scene, the camera, the renderer, the frame loop or `document`.
- `fields(view)` - optional. The editor's fields for a view, as data.

The page refuses a kind that misses `card` or `assets`, or whose `read`, `world` or `fields` is not a function, and says which. A kind written to the older `show(block, host)` and `"block"` names is told the new names.

## The prototype rule

- three only, by named imports from `"three"`: no addons, no dynamic `import()`. The lab maps `three` to its own copy, and the contract test fails any other import.
- Metres, Y up; no scene or `document` access; a play and an edit mode.
- A `normal`, a `longest` and a `missing` record in `sample.json`.
- The cost line under the station counts the world view's draw calls and triangles against a provisional budget of 30 draw calls and 50 000 triangles per item. No phone measurement backs that budget yet, so going over it is said, not refused.
- Ten rounds through the real renderer must leave no geometry or texture behind (`renderer.info.memory`).

## The two kinds that follow it

- `stamp-1` (here) - the smallest kind with every half: `read` with cuts and a default name, `card` with an optional picture and sound, a `world` of a post and a painted plate that tips on a tap and sways in play, and `fields`.
- `../audio-narration-spot-1/` - flat exports with the same names (`read`, `assets`, `fields`, `world`, `card`) and a `records` sample. It lives outside this folder as a prototype of its own, so the lab and the contract table do not run it.
