# The haze veil's screen colour into the framework: follow-up

## Where it stands

The city look's haze veil is split across two packages:

- In the framework (`src/visualization/atmosphere/`), reusable by any app
  that renders the physical sky:
  - `AtmosphereHaze.setVeil(rgb)`: the scene-linear colour the haze fades
    toward ([atmosphere-haze.ts.md](../src/visualization/atmosphere/atmosphere-haze.ts.md));
  - `AtmosphereHaze.setRim(centre, inner, outer)`: the radial fade that hides
    a finite ground tile's edge;
  - `SkyAtmosphere.setHorizonVeil(rgb, riseDeg)` and `horizon-veil.ts`: the
    veil reaching a few degrees up the visible sky, so ground and sky meet
    without a step ([horizon-veil.ts.md](../src/visualization/atmosphere/horizon-veil.ts.md)).
- In the OSM demo only:
  - `haze-veil.ts`: the veil stated as a screen colour (CIE L\* and b\*) and
    turned into the scene-linear colour above by inverting three's Neutral
    tone mapping ([haze-veil.ts.md](../../GpsPlusSlamJs_OsmDemo/src/haze-veil.ts.md));
  - `atmosphere-rig.ts`: which calls all three framework setters from one
    `setHazeVeil(veil)`, and keeps the rim on only while a veil is set.

So another app (an editor's 3D view, the Tour Viewer's globe) can use the veil
today, but only by stating it in scene-linear units, or by copying
`haze-veil.ts`. The screen-colour form is the one people tune by eye.

## What to do

1. Move `haze-veil.ts` (with its test and sidecar) into
   `GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/`, deep-imported
   (not through the barrel). It depends on nothing but three's tone-mapping
   formula, which it mirrors, and that mirror is the part a second copy would
   let drift.
2. Give the framework one entry point that takes the screen form:
   `applyHazeVeil({ haze, sky }, veil | null, exposure)`, doing what
   `AtmosphereRig.setHazeVeil` does today (veil colour to the haze, the rise
   to the sky). The demo's rig then calls it; the rim stays the app's
   choice, because only the app knows its ground's extent.
3. Keep `HAZE_VEIL_TINT` and `HAZE_VEIL_RISE_DEG` with the light settings
   that own the defaults, or move them with the module; either way one
   place.

## Why it was not done in the same change

The change that added the horizon veil and the rim already touched both
packages' atmosphere code; moving a module with its tests across packages on
top would have mixed a refactor into a look change. The move is mechanical
and testable on its own: the existing `haze-veil.test.ts` moves with it, and
the rig's tests pin that the demo still renders the same veil.

## Related

- [atmosphere-rig.ts.md](../../GpsPlusSlamJs_OsmDemo/src/atmosphere-rig.ts.md):
  the rig's veil and rim contract.
- [sky-atmosphere.ts.md](../src/visualization/atmosphere/sky-atmosphere.ts.md):
  `setHorizonVeil`.
