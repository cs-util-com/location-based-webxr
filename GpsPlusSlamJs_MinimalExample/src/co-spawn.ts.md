# co-spawn.ts

## Purpose

The Step 4 contrast co-spawn. On a GPS-gated tap the example spawns two objects
**near the tapped point** under different parents, to make the framework's
drift-compensation value visible:

- the **root cube** under the GPS-aligned `scene` (the deliberate floater — see
  [placement.ts](placement.ts)), offset a short fixed distance to the side of
  the tap, and
- an **anchor marker** under `arWorldGroup`, placed exactly on the tapped point
  and handed to `createGpsAnchor` so it holds its tapped pose during bootstrap
  and then snaps to the GPS median when off-screen.

This module is the pure geometry that places the anchor on the tapped world
point (across the `scene`↔`arWorldGroup` frame change) and the floater cube at
`worldPosition + CUBE_SPAWN_OFFSET`. The live `createGpsAnchor` wiring
(store-bound alignment getters, GPS seed, default bootstrap) lives in
[main.ts](main.ts) because it needs the running store and is verified on-device.

## Public API

- `ANCHOR_MODE: GpsAnchorMode = 'snap-when-offscreen'` — the required mode; keeps
  the teaching "jump" out of view (the anchor only corrects while out of view,
  where it is and where it would land).
- `ANCHOR_SPHERE_RADIUS = 0.15` — radius (m) of the green anchor sphere (modestly
  enlarged from the original 0.1 m so it reads at a few metres).
- `CUBE_HALF_EXTENT = 0.1` — half the 0.2 m orange floater cube edge.
- `CUBE_SPAWN_OFFSET: Vector3` — fixed world offset of the floater cube from the
  tapped point (the anchor stays on the tap so it doesn't snap on first commit).
- `coSpawnAtWorldPose({ scene, arWorldGroup, worldPosition }): { cube, anchorObject }`
  - anchorObject → under `arWorldGroup` at `arWorldGroup.worldToLocal(worldPosition)`
    (exactly on the tapped world point). `arWorldGroup`'s world matrix is
    refreshed first so the conversion uses the current transform;
  - cube → `placeRootCube(scene, worldPosition + CUBE_SPAWN_OFFSET)` (GPS-aligned
    root, offset to the side so the pair don't occlude).

## Invariants & assumptions

- The anchor object must land **exactly** on the tapped world point: `main.ts`
  bootstraps it by medianing the **object's own world pose** (via
  `worldNueToGps`), so it pins to where it was actually placed — not the phone's
  GPS — and its first steady-state commit is a small residual, not a jump toward
  the device. `arWorldGroup` carries the alignment
  (`enableArWorldGroupAlignment`), so the world→local conversion is required and
  the object's world position is GPS-world NUE.
- The cube and anchor must be far enough apart at spawn to be individually
  visible (centres separated by more than `CUBE_HALF_EXTENT + ANCHOR_SPHERE_RADIUS`)
  — the original coincident pair read as one object in the field.
- The cube is parented to `scene`, the anchor object to `arWorldGroup`. Do not
  swap these — the whole demo depends on the contrast.
- `createGpsAnchor` must use the **default bootstrap** (no `skipBootstrap`): the
  marker holds its tapped pose while sampling its own world pose, then makes one
  lazy
  `snap-when-offscreen` correction. The bootstrap "no movement" and snap
  behaviours are owned and tested by the framework
  ([gps-anchor.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/gps-anchor.ts)),
  not re-tested here.

## Tests

[co-spawn.test.ts](co-spawn.test.ts) — pins the anchor on the tapped point and
the cube at tap+offset under a non-trivial `arWorldGroup` transform, the
individual-visibility gap (no occlusion — the field-report reproduction guard),
the parenting (cube→scene, anchor→arWorldGroup), and
`ANCHOR_MODE === 'snap-when-offscreen'`.
