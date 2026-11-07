# `item-lab.ts` - the item lab's page

## Purpose

Runs a kind from `public/prototypes/item-kinds/<name>/` in both contexts, side by side, with nothing of the app around it (`../../item-lab.html.md`). The kind stays a plain module of its folder: this file reads it by URL and hands it to the real hosts through their `showItem` seam.

## Public API

- `startItemLab()` - reads the kind `?kind=` names and runs the page. A name that is no folder name, or a folder that cannot be read, shows a line in `#lab-error` and nothing else.
- `window.__itemLab` (`ItemLab`), installed when the kind was read:
  - `start()`, `next()`, `stop()`, `tap("story" | "free")`, `secondSound()`, `endSound()`
  - `loseAsset(id, lost)`, `holdLoads()`, `releaseLoads()`, `walk(away)`
  - `settle()` - resolves after two drawn frames
  - `state()` - `ItemLabState`: the story's words, status, end count and stage line, the free figure's words (`free.standing` turns true once the figure is decoded and in the scene, so a wait for it is a wait for the figure), voice and failures, the sound, live object URLs, the assets read and declared

## Invariants and assumptions

- Left: real `createSceneView`; the `audio` and `stage` seams are fakes that remember what they would play and stand.
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
