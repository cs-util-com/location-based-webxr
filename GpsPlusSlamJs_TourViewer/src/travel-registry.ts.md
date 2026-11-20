# travel-registry.ts

## Purpose

The open travelling boxes of a page (one `travelling-box.ts` controller
per open surface) behind the page's three entry points: one `frame()` per
animation frame, one `ownsTap()` in the visitor's tap routing, and one
`pointerdown` on the AR root that goes to the topmost words under the
finger.

## Public API

- `createTravelRegistry()` returns a `TravelRegistry`:
  - `add(box)` adds a box (once; adding it again is a no-op) and returns
    the function that takes it out;
  - `frame()` runs each box's `frame` once; a call from inside one is a
    no-op;
  - `ownsTap()`: any box owns the current XR select (a press, or the grace
    after it);
  - `pointerDown(e, target)` gives the press to the topmost words under
    the pointer and answers whether one took it;
  - `size()`.

## Invariants and assumptions

- **Topmost:** a flying or docked quad wins over any plate in the world
  (the quad is drawn over everything); among the same kind the smaller
  depth wins (a plate's depth is its corners' mean clip w).
- A box whose `hit` is null is never asked; if the chosen box refuses the
  press (one already down), no other box gets it.
- `frame` iterates over a copy, so a box taken out during a frame does
  not skip its neighbour.

## Examples

```ts
const registry = createTravelRegistry();
const leave = registry.add(createTravellingBox({ surface, ... }));
arRoot.addEventListener("pointerdown", (e) => registry.pointerDown(e, arRoot));
renderer.setAnimationLoop(() => {
  registry.frame();
  renderer.render(scene, camera);
});
```

## Tests

- `travel-registry.test.ts`: the quad first, then the nearest plate; no
  words under the pointer gives no press; each box once a frame and never
  from inside one; `ownsTap` while any box owns it.
