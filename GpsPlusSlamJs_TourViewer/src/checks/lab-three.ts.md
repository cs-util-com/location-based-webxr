# `lab-three.ts` - three.js for a kind's folder

## Purpose

A kind under `public/prototypes/item-kinds/` imports three by name (`import { Mesh } from "three"`), the way it will once it moves into the app. A file under `public/` is not built, so nothing resolves that name for it. This module re-exports the app's own three and names its own URL; the item lab (`item-lab.ts`) adds an import map that points `three` at that URL before it imports the kind.

## Public API

- Everything `three` exports.
- `LAB_THREE_URL` - this module's URL.

## Invariants and assumptions

- The lab loads it by a dynamic `import()`, so a build puts it in a chunk of its own and the URL is that chunk's, whose exports are exactly three's plus `LAB_THREE_URL`.
- One instance: in the dev server and in a build the re-export reaches the same three the lab renders with, so a kind's meshes are the renderer's own classes.
- An import map added after the page started applies to a specifier no module has resolved yet (Chromium 133 and later). The lab's own code never resolves a bare `three` at run time, so the kind's first import is the first resolution.

## Example

```ts
const { LAB_THREE_URL } = await import("./lab-three.js");
// <script type="importmap">{ "imports": { "three": LAB_THREE_URL } }</script>
```

## Tests

`playwright-tests/item-lab.spec.js` opens the sample kind, which imports three, and stands its world part.
