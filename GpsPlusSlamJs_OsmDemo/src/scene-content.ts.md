# `scene-content.ts`

## Purpose

Holds the demo's map-derived content as **one subtree with a swappable
parent**, so AR mode can move the city under the framework's scene root with a
single call.

## Why it exists — AR milestone 0

The demo draws its city into `BuildingView`'s own `THREE.Scene`. AR needs the
same geometry under the framework's scene root, because **that root is the
GPS-world frame**: map-derived content belongs there in raw NUE with nothing to
pre-multiply and no per-frame work. (The framework's `ar-scene-hierarchy.ts`
states this at the top of the file precisely because two independent readers
previously concluded the opposite.)

The move itself is free — three.js `add()` reparents rather than copying. What
is not free is knowing **which** objects have to move. A future edit that
attaches AR-relevant content straight to `BuildingView`'s scene leaves it
behind, and the symptom is content missing in AR while every desktop test stays
green. Naming the subtree is what makes that answerable.

**And `BuildingView` cannot be unit-tested** — it constructs a
`THREE.WebGLRenderer` in its constructor, which the unit suite has no way to
provide. A seam left as an option on that class would be a seam no unit test
could reach, so it is extracted here instead. That extraction is the milestone.

## Public API

- `new SceneContent(parent)` — creates the root and attaches it to `parent`.
- `root: THREE.Group` — the node everything hangs from, named `osm-content`.
  Public because AR reparents it and tests assert on it; there is no behaviour
  to protect behind a getter.
- `attachTo(parent)` — move the whole subtree. **Idempotent.**
- `add(object)` / `remove(object)` — per-object, because `BuildingView` swaps
  the cell mesh and the underground lines independently of the layer group.

No error modes: every operation is a three.js parent/child mutation that cannot
fail on a valid `Object3D`.

## Invariants & assumptions

- **The subtree moves WHOLE, children included.** This is the property AR
  depends on and the one a wrong implementation (re-creating the group rather
  than reparenting) would silently break while still passing a "root moved"
  check.
- **`attachTo` is idempotent.** three.js removes from the old parent before
  adding, so re-attaching to the current parent reorders within that parent and
  changes nothing else. AR entry is gated on a first GPS fix and may run more
  than once.
- **Reversible.** M5 hides the desktop renderer rather than disposing it, so
  leaving AR hands the content back; a one-way seam would force a rebuild of a
  2.8 km mesh.
- **What is IN and what is OUT is a decision, not an accident:**
  - **In** — the drawn mesh layers (`drawMeshLayers` output), the res-13 cell
    mesh and its outlines, the underground diagnostic lines.
  - **Out** — lights, the ground plane, the sun rig, the route line, the NPC
    agent. AR supplies its own lighting from the framework's scene, hides the
    ground plane by design (AR plan §2.8), and does not list the NPC as AR
    content. **Objects that stay behind stay behind on purpose.**
- Holds no materials or geometry of its own, so it has nothing to dispose;
  `BuildingView.dispose()` still owns the lifetime of everything inside it.

## Examples

```ts
// Desktop: BuildingView constructs it against its own scene.
private readonly content = new SceneContent(this.scene);

// Entering AR — the framework's scene root IS the GPS-world frame.
buildingView.attachContentTo(frameworkScene);

// Leaving AR.
buildingView.attachContentTo(buildingView.localRoot);
```

## Tests

`scene-content.test.ts` — the desktop default parent, the subtree moving whole
with its children, reversibility, per-object removal leaving siblings alone, and
idempotent re-attachment. Plain `THREE.Object3D`s, no renderer, no DOM.

The desktop side is covered by the existing OSM-demo Playwright suite, which
renders the real scene through a real `WebGLRenderer` — the extraction must not
change what desktop draws, and that is what those specs assert.
