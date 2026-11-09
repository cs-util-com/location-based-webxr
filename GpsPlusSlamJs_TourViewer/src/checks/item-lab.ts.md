# `item-lab.ts` - the item lab's page

## Purpose

Runs a kind from `public/prototypes/item-kinds/<name>/` in both contexts, side by side, with nothing of the app around it (`../../item-lab.html.md`). The kind stays a plain module of its folder: this file reads it by URL and hands it to the real hosts through their `showItem` seam.

## Public API

- `startItemLab()` - reads the kind `?kind=` names and runs the page. A name that is no folder name, a folder that cannot be read, or a kind whose `assets(block)` throws, shows a line in `#lab-error` and nothing else.
- `window.__itemLab` (`ItemLab`), installed when the kind was read:
  - `start()`, `next()`, `stop()`, `tap("story" | "free" | "world")`, `secondSound()`, `endSound()`
  - `record("normal" | "longest" | "missing")` - shows that record of the sample and starts again
  - `mode("play" | "edit")` - rebuilds the world view in that mode
  - `backdrop("bright" | "dark")` - repaints the sky and the ground
  - `rounds(n)` - builds, draws and frees the world view n times and gives the geometries and textures the renderer holds that it did not before (`LeftBehind`)
  - `loseAsset(id, lost)`, `holdLoads()`, `releaseLoads()`, `walk(away)`
  - `settle()` - resolves after two drawn frames
  - `state()` - `ItemLabState`: the story's words, status, end count and stage line, the free figure's words (`free.standing` turns true once the figure is decoded and in the scene, so a wait for it is a wait for the figure), voice and failures, the sound, live object URLs, the assets read and declared, the record shown and its problems, and `world`: whether the kind has a world view, its mode, the backdrop, whether it stands and moved since the last frame, the taps it took, its cost (`world-cost.ts`), why `world` failed, and where its tap target is on the canvas

## Invariants and assumptions

- Left: real `createSceneView`; the `audio` and `stage` seams are fakes that remember what they would play and stand. Its Continue (`#lab-continue`) and play-next (`#lab-play-next`) buttons, which the scene view shows and hides, are wired to `continueTapped` and `playNextNow` as the app wires its own.
- The kind's `read` and `assets(block)` run once per record, as the page loads (`state().declared` is the shown record's list), so a kind whose code throws fails there with its words instead of on every frame.
- The kind's `three` is the page's own: an import map, installed once before the first kind is imported, points `three` at `lab-three.ts`. Several import maps need Chromium 133 or later.
- The world view is built by `world(block, worldEnv(mode, assets, loadAsset))`, the environment a station gives a part, so it reads files through the same lost and held loads as the hosts. It stands at `WORLD_AT`, beside the figure, is rebuilt on start, on a record and on a mode, and is freed on stop. A `world` that throws leaves the rest of the page running and says why in `#lab-cost`.
- Every frame calls the part's `update` with the seconds and the viewer in its parent's frame, and compares its pose with the last frame's (`poseKey`); that is what `world.moving` reports.
- A pointer tap is cast first against the world view's `tapTarget`, then against the free figure.
- `#lab-cost` reads the cost against a provisional budget of 30 draw calls and 50 000 triangles; no phone measurement stands behind it, so it says "over the budget" and refuses nothing. `#lab-problems` lists what `read` fixed in the shown record.
- `#lab-state` is for a person reading it and is redrawn at most every 250 ms; `state()` is read fresh on every call, so a test sees no delay.
- Right: real `createFreeItems` and real `createSceneStage` on a three.js scene; a pointer tap goes through the real `pickObject`, a hook tap takes the first target. Its player is the real narration player over `createSilentAudio`.
- Both sides share one voice channel, one set of loads and one count of object URLs, so a sound on one side holds the other, as in the app.
- A lost file or a held load is decided in `loadAsset`, so a kind sees what a real failure gives it.
- A file that lands after stop does nothing: that is the hosts' own guard, which the page only lets happen.
- The page changes nothing in the visitor path: the app passes no `showItem`.

## What is missing

- The free host has no sheet: a tap plays or stops a voice, or shuts a bubble. A kind's words reach the visitor only in its look, so a lost figure takes them along and the page shows the failure line.
- Only a figure stands in the free host. A kind with no figure marks `freeKnown` in its `sample.json`.
- A free video or sound draws nothing, and pins, picture planes, reading stands and placed models are drawn by `renderTourStation`, not by the free host.

## Example

```text
/tour/item-lab.html?kind=stamp-1
```

```js
await window.__itemLab.settle();
window.__itemLab.tap("free");
window.__itemLab.state().sound.free; // true
```

## Tests

`playwright-tests/item-lab.spec.js` drives the page; `item-lab-kind.test.ts` and `../item-contract.test.ts` cover what it is built from.
