# `scene-content.ts`

## Purpose

Holds the demo's map-derived content as **one subtree with a swappable
parent**, so AR mode can move the city under the framework's scene root with a
single call.

## Why it exists — AR milestone 0

The demo draws its city into `BuildingView`'s own `THREE.Scene`. AR needs the
same geometry under the framework's scene root, because **that root is the
GPS-world frame** — so no alignment⁻¹ container is required. (The framework's
`ar-scene-hierarchy.ts` states this at the top of the file precisely because two
independent readers previously concluded the opposite.)

**THE AXES STILL DIFFER, AND THE FIRST VERSION OF THIS FILE SAID THEY DID NOT.**
"No alignment container" is not "no transform":

- the demo's scene is **X=East, Y=Up, Z=−North** (`main.ts` round-trips a picked
  point as `frame.toLatLng({ x: point.x, y: -point.z })`, and `protocol.ts`
  calls the ENU→scene reflection "a real trap");
- the GPS-world frame is **NUE — X=North, Y=Up, Z=East** (`gpsMath.ts` returns
  `[north, up, east]`).

So `NUE = (−z, y, x)`, a −90° yaw about Up. Plan §2.2 says this in capitals —
"AXIS MAPPING IS REAL WORK AND MUST NOT BE ASSUMED" — and the milestone-0 commit
documented the opposite in three places, which would have sent M1 to render the
city 90° off _while telling the implementer not to look._ Caught in review.

The reparent itself is free — three.js `add()` moves rather than copies. What is
not free is that mapping, and knowing **which** objects have to move: an edit
that attaches AR-relevant content straight to `BuildingView`'s scene leaves it
behind, and the symptom is content missing in AR while every desktop test stays
green. `building-view-content.test.ts` guards that as source text, because no
runtime test can reach it — the unit suite cannot build a `BuildingView`, and
the desktop e2e passes either way by definition.

**And `BuildingView` cannot be unit-tested** — it constructs a
`THREE.WebGLRenderer` in its constructor, which the unit suite has no way to
provide. A seam left as an option on that class would be a seam no unit test
could reach, so it is extracted here instead. That extraction is the milestone.

## Public API

- `ContentFrame` — `"demo-scene"` | `"gps-world-nue"`, the two axis conventions.
- `new SceneContent(parent)` — creates the root and attaches it to `parent` in
  the demo frame.
- `root: THREE.Group` — the node everything hangs from, named `osm-content`.
  Public because AR reparents it and tests assert on it; there is no behaviour
  to protect behind a getter.
- `attachTo(parent, frame)` — move the whole subtree AND set the frame
  transform. **Idempotent**, and the transform is SET rather than accumulated,
  so a round trip out to AR and back is exactly the identity.
- `detach()` — remove the root from its parent. Called by
  `BuildingView.dispose()`; see the invariant below for why it is not optional.
- `add(object)` / `remove(object)` — per-object, because `BuildingView` swaps
  the cell mesh in and out independently of the layer group.

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
  - **In** — the drawn mesh layers (`drawMeshLayers` output) and the res-13 cell
    mesh with its outlines. Exactly plan §2.8's list.
  - **Out** — lights, the ground plane, the sun rig, the route line, the NPC
    agent, **and the underground diagnostic lines.** AR supplies its own
    lighting, hides the ground plane by design, and §2.8 lists neither the NPC
    nor the underground layer. The underground layer was briefly IN and was
    taken out in review: its material **disables depth testing** so it can be
    seen through the terrain above it, and with no ground plane in AR it would
    paint across the passthrough. **Objects that stay behind stay behind on
    purpose.**
- **`dispose()` must `detach()` first, once AR is in the picture.** The root
  holds no materials or geometry of its own and `BuildingView.dispose()` frees
  everything inside it by field reference — but on desktop the root dies with
  the view's scene, whereas the framework's scene root OUTLIVES the view.
  Disposing without detaching leaves a subtree of freed geometry attached to a
  live scene, and **three.js does not report drawing a disposed geometry**, so
  the symptom is silent absence.
- **The root is a `Group`, therefore a `groupOrder` boundary.** three.js sets
  `groupOrder` from a `Group`'s `renderOrder` and sorts by it BEFORE
  `renderOrder`; a `Scene` is not a `Group`, so this node is new. Today it is a
  no-op — the root's `renderOrder` is 0, as was every affected object's
  `groupOrder`. But `RENDER_ORDER` in `layer-order.ts` is a deliberately
  guarded ladder, and `route` now sits on a different branch from
  `areas`/`cells`. **Setting `content.root.renderOrder` — a natural reach in AR
  — would move three rungs as a block relative to the fourth.**
- **A frame transform on the root splits the raycast set.** `pick()` builds its
  targets from the cell mesh and the layer group (both on the root) _together
  with_ `this.ground` (on the scene), and `main.ts` converts the world-space hit
  with the demo-frame formula. Under `"gps-world-nue"` those are two different
  frames through one conversion. Harmless today — AR hides the ground plane and
  has no picking — but picking in AR needs this resolved first, not discovered.

## Examples

```ts
// Desktop: BuildingView constructs it against its own scene.
private readonly content = new SceneContent(this.scene);

// Entering AR — the framework's scene root IS the GPS-world frame, but its
// AXES are NUE and the demo's are not. The frame argument is the conversion.
buildingView.attachContentTo(frameworkScene, "gps-world-nue");

// Leaving AR — back to the demo's own axes, transform reset to identity.
buildingView.attachContentTo(buildingView.localRoot, "demo-scene");
```

## Tests

`scene-content.test.ts` — the axis mapping (north→+X, east→+Z, up unchanged,
determinant +1 so it is a rotation and not the mirrored frame this demo has
already shipped once, and an identity round trip), the desktop default parent,
detachment, the subtree moving whole
with its children, reversibility, per-object removal leaving siblings alone, and
idempotent re-attachment. Plain `THREE.Object3D`s, no renderer, no DOM.

`building-view-content.test.ts` — a SOURCE-TEXT guard that `BuildingView`
attaches nothing to its scene except a recorded exemption list, each with the
reason it is not AR content. Static because the defect it catches is invisible
at runtime: the unit suite cannot construct a `BuildingView`, and the desktop
e2e renders identically either way.

The desktop side is covered by the existing OSM-demo Playwright suite, which
renders the real scene through a real `WebGLRenderer` — the extraction must not
change what desktop draws, and that is what those specs assert.
