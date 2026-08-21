# `ar-entry-ground.ts`

## Purpose

The ground plane the AR entry descent falls towards, and which fades away as the
city rises. Added for the r543 field report: _"dass ich den Ground sehe, wenn die
Open Street Map Welt weit unter mir spawnt und der dann rausgefadet wird, während
die auf mich zufliegt"_.

Before this, **AR drew no ground at all** — the terrain plane belongs to the
desktop 3D view, because in AR the real world is the floor. That is right for a
settled session and wrong for the entry, where the city starts up to 100 m below
the user and a descent with no floor reads as objects drifting rather than as
ground rising.

## Public API

- `ENTRY_GROUND_EXTENT_M = 400` — half-width of the plane, metres. Inside the AR
  camera's 1000 m far plane so it cannot clip mid-fade.
- `ENTRY_GROUND_COLOUR = 0x6b7280` — the 3D view's ground colour, duplicated as a
  literal rather than imported: `building-view.ts` pulls in the whole desktop
  scene and this module is loaded inside an XR session.
- `entryGroundOpacity(input: DescentInput): number` — `[0,1]`. Derived as
  `1 - cameraFadeAlpha(input)` rather than re-implemented, because the camera
  fading in and the ground fading out are one visual event and a second curve
  could only drift from the first.
- `createArEntryGround(): ArEntryGround` — `{ mesh, setHeightM, setOpacity,
dispose }`.

## Invariants & assumptions

- **The plane must not survive the entry.** An opaque plane left in an AR scene
  is a lid over the passthrough — worse than having no ground at all. Every
  design choice follows from this:
  - `entryGroundOpacity` returns **exactly** `0` on landing, not "close to".
  - Every degenerate input (`startM` of 0, `NaN`, either infinity; a `NaN`
    clock) resolves to **no ground**, never to a visible one.
  - `setOpacity(NaN)` hides the mesh. Three.js renders a `NaN` opacity as fully
    opaque, so failing the other way would produce exactly the lid.
  - `ar-mode.ts` disposes it **twice over**: on landing, and again in
    `release()`. A session ended mid-descent never reaches the landing branch,
    and that is the common case when someone backs out because the entry looked
    wrong.
- **`MeshBasicMaterial`, not `MeshStandardMaterial`.** A lit material would
  depend on the framework's lights; `ar-scene-environment.ts` records what a
  wrong AR lighting assumption costs — every affected shader silently fails to
  compile and the geometry vanishes with no error raised. An unlit plane cannot
  fail that way, and it is faded to nothing over six seconds, so shading buys
  nothing.
- **`depthWrite: false`.** A transparent plane that writes depth punches a hole
  in everything drawn after it.
  - **It cannot occlude anything, and an earlier version of this sidecar claimed
    it could.** `ar-building-material.ts` renders the AR city with
    `AdditiveBlending` and `depthWrite: false`, so **nothing in the AR scene
    writes depth at all** — the buffer is empty, every depth test passes, and
    buildings under the plane are additively painted _through_ it. Caught in
    cold review.
  - **What this plane actually is:** a tinted backdrop giving the descent
    something to read motion against, not an occluder. Enough for what it was
    asked to do; the next change should not assume otherwise.
  - `renderOrder = -1` still matters and is still right: both materials sit in
    the transparent list, so draw order is not decided by depth.
- **`DoubleSide`.** An interrupted descent or a manual nudge can leave the user
  under the plane, and a single-sided plane simply disappears from there — which
  reads as a rendering fault rather than as being below ground.
- **Geometry is authored flat**, rotated into the North/East plane at build
  time, so the scene root's NUE frame needs no rotation on the mesh.
  - The test reads the geometry's own `normal` attribute to check it faces UP.
    An earlier version applied the mesh quaternion — which is identity, since
    the rotation is baked into the geometry — to `(0,0,1)` and asserted the
    result had length 1, i.e. `expect(1).toBeCloseTo(1)`. It would have passed
    with the plane facing DOWN, which `side: DoubleSide` then hides.
- **The plane is positioned by `applyComposed` in `ar-mode.ts` and nowhere else.**
  It must sit at the city’s own height, `geometricOffset.up + composeElevationM(
auto, trim, descent)` — not at the descent term alone, which is `auto + trim`
  metres away from the surface the buildings stand on. Both of those are nonzero
  in a real session.
  - Two earlier versions got this wrong in two different ways: first both call
    sites used `descentM` alone, then fixing those two left a **third** path
    uncovered — the manual elevation nudge re-attaches the city without touching
    the frame loop, so the ground lagged a nudge until the next frame. Three call
    sites, one of them missed, is the argument for none.
  - The `ar-mode.test.ts` guard states this as an **equality against the offset
    the content was actually attached with**, and applies a nudge first so the
    trim term is nonzero — without that the two candidate formulas return the
    same number and the assertion passes against the defect.

## Examples

```ts
const ground = createArEntryGround();
ground.setHeightM(geometricOffset.up + descentM); // starts below, rises
ground.setOpacity(entryGroundOpacity({ elapsedS: 0, startM: descentStartM }));
scene.add(ground.mesh);
// …each frame…
ground.setHeightM(geometricOffset.up + descentM);
ground.setOpacity(entryGroundOpacity({ elapsedS, startM: descentStartM }));
// …on landing OR on session end…
ground.dispose();
```

## Tests

- `ar-entry-ground.test.ts` — the curve (opaque through the hold, exactly zero on
  landing and after, monotonic, no ground for a zero or non-finite descent) and
  the mesh (flat, large enough, hidden at zero, clamped opacity, no depth write,
  detached _and_ freed on dispose, non-finite height survivable).
- `ar-mode.test.ts` — the wiring: the ground is added at the city's starting
  depth, rises with it, and is **removed from the scene** on landing; and no
  ground is added at all when there is no height to fall from.

## Related

- [`ar-descent.ts`](./ar-descent.ts.md) — the clock and the curve both read from.
- [`ar-scene-environment.ts`](./ar-scene-environment.ts.md) — why AR materials are
  chosen conservatively.
