# Item kinds

Each folder here is one kind of item to try in the item lab. Pages and files here are linked from nothing in the app.

1. Copy `stamp-1/` to a new folder, say `lantern-1/`. Touch no file outside your folder: no registry, no build.
2. `kind.js` exports `show(block, host)` and `assets(block)`. It imports nothing; `host` is all it gets (`ItemCardHost` in `src/item-card.ts`). Set the words first, then read files through `host.asset`. To stand something in the world, call `host.stage?.stand(what, (world, place) => ...)` and draw with `world`; elements of your own go in `host.surface` when it is there.
3. `sample.json` holds `name`, `words`, `block` and `assets`. If the kind cannot stand in the free host yet, add `"freeKnown": "why"`.
4. Open `/tour/item-lab.html?kind=lantern-1`: the left side is a story, the right side a station. Try every control.
5. Run `pnpm run test:unit src/item-contract.test.ts`: your folder is a row of that table in both hosts.

What you deliver is a look and a behaviour. Adding the kind to the tour format is a later build step.
