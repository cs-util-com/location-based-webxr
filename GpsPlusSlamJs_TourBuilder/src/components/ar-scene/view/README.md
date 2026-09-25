# ar-scene/view — the Three.js layer

The one real implementation of the `SceneAdapter` port, plus the THREE-specific
pieces it composes. Everything here is either mechanical (attach, detach, set
visible) or reuse of components 1 and 2 — the decisions live in `core/` and the
orchestration in `runtime/`.

## Modules

### `three-scene-adapter.ts` — the adapter

Holds one `Group` per waypoint under the `arWorldGroup`, stamps
`userData.arScene` on pickable meshes, yaws every waypoint group toward the
camera each frame (component 1's `computeBillboardYaw`, yaw only — never pitch or
roll), and wires up the audio player (component 1) and the transcript label
(component 2).

Framework specifics are **injected**, not imported: `createAnchor`, `toWorld` and
`getUserWorldPos`. That is the seam that lets the demo run this same adapter on a
desktop with an identity anchor factory, and the composed app pass
`createGpsAnchor` and the framework's alignment conversion.

Two policies that live here because they are THREE facts, not orchestration:

- **Pick targets contain only visible meshes.** `Raycaster` does not skip
  invisible objects, so a PREFETCHING (invisible) knight left in the set would
  swallow taps aimed past it — component 1's existing discipline.
- **The fallback marker owns its own geometry** (nothing shares it), so unlike a
  clone it _is_ disposed on release.
- **A breadcrumb-only stop (no image, no model) with a transcript skips the
  marker.** `buildFallbackVisual`'s `showMarker` flag still builds the cone
  mesh (uniform release/dispose bookkeeping) but leaves it detached and
  invisible; `showTranscript`'s `centered` flag then places the text in the
  visual's own slot (local X = 0) instead of beside a cone nobody would see.

### `gltf-loading.ts` — template vs instance

`parseTemplate` produces the shared, GPU-resident asset (`GLTFLoader.loadAsync`
on a Blob URL — the expensive step the PREFETCH zone hides). Sprites become a
textured **plane**, not a `THREE.Sprite`, because a Sprite cannot keep a fixed
up-axis (the cylindrical-billboard rule from TASK §2.3.1).

`instantiateTemplate` clones with **`SkeletonUtils.clone`, unconditionally**: a
plain `Object3D.clone()` shares geometry and material (which is what we want) but
does not rebind a skeleton, so a skinned knight renders collapsed. There is no
reason to branch on it.

`releaseInstance` merely detaches; only `disposeTemplate` walks the graph calling
`geometry/material/texture.dispose()`. Deep-disposing a clone would free the
template other clones still render from — a black or crashing scene that is very
hard to trace back here, which is why the jsdom test pins it.

### `breadcrumb-orbs.ts` — the recycled pool

A fixed number of orb meshes sharing one geometry and one material, re-pointed at
new trail coordinates through the anchor's `setGpsPoint` + `markMovedExternally`.
Cost per frame is O(pool), not O(trail). The pulse collapses to a static glow
under `prefers-reduced-motion` (injectable for tests).

### `breadcrumb-guide.ts` — the single "walk here next" indicator

One `createWayfindingHud` instance (the framework's arrow/ring/label
presenter), pointed at exactly one target at a time via a re-usable anchor —
same re-pointing pattern as `breadcrumb-orbs.ts`'s pool, but a single marker
instead of many. A fresh `id: bc-${index}` is given on every swap so the
presenter's own per-target hysteresis state never carries over from the
previous, unrelated breadcrumb. Manually ticked
(`autoRegisterFrameUpdate: false`) from the adapter's own `update()`, which
every host (real AR, desktop preview, replay) already calls once per
orchestrator tick — relying on the framework's own ambient frame-loop
registry instead would behave differently between modes.

### `ray-sources.ts` — the desktop/AR seam

`createPointerRaySource` wraps the shared tap-gated `pointer-tap-picker`;
`createXrSelectRaySource` raycasts along the XR input source's target ray. Both
report the same nearest `Intersection`, so everything downstream is identical.
The tap-vs-drag gate belongs to the pointer path **only** — in a session,
`select` already is the completed gesture, and re-gating it would drop real taps.

## Tests

`three-scene-adapter.test.ts` runs in jsdom with real THREE objects and no WebGL
(the convention component 7 uses for Leaflet). It covers exactly the rules that
break silently in the field: shared geometry across clones, release-does-not-dispose,
the `userData` parent walk on a deeply nested model, hidden meshes staying out of
the pick set, and a suspended `AudioContext` being reported rather than ignored.
Pixels and real GLTF parsing are demo- and phone-verified (§2.3.8 excludes the
render from the coverage target).
