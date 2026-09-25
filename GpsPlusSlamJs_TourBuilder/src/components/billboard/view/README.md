# billboard/view — Three.js + DOM view layer

The impure side. These modules turn `core/`'s pure results into meshes, canvas
pixels, audio playback, and pointer picking. They hold **no playback state** of
their own — they read `core/` selectors and forward DOM events back in as
actions. Mostly not unit-tested (WebGL/DOM/media are view-layer); verified via
the demo. The exception is `clickable-billboard`'s pick-target policy, which is
node-tested with the media/canvas pieces mocked. This is the layer component 8
swaps piece-by-piece for AR.

## Modules

### `clickable-billboard.ts` — the composition unit

A textured sprite plane + the in-world transport panel below it, both yawing to
face the user, with an audio element driven by the reducer. Fed **ready
resources** (a loaded `THREE.Texture` + an `HTMLAudioElement`) — the seam
component 8 reuses, swapping the plane for a GLTF model and the element for an
asset-provider URL.

- `faceCamera(camPos)` yaws the whole group (panel sits on the group's Y axis,
  so it stays directly below the sprite while both face the camera).
- `applyState(state)` is this billboard's reconcile slice. The _decision_
  (seek-vs-leave-alone epsilon, play/pause diffing) is the pure, unit-tested
  `reconcilePlayer` in `core/transport-reconcile.ts`; this layer only executes
  the returned commands (panel visibility/redraw, seek, play/pause).
- Only the active billboard's panel is `visible`, and `getPickTargets()`
  returns the panel **only while it is shown** — the raycaster does not skip
  invisible meshes, so a hidden panel in the target set would soak up taps
  meant for whatever is behind it. Pickability is owned here, not by callers.
- Stamps `BillboardUserData` (`{ billboardId, role: "sprite" | "panel" }`) on
  each pickable mesh for raycaster classification.
- Adds the player's `spatialNode` (`PositionalAudio`) to the group, so audio
  emanates from the billboard's world position. Takes the shared
  `AudioListener` and forwards it to `audio-player`.

### `transport-panel-view.ts` — the in-world panel

Draws the play/stop button and progress bar into a 2D canvas wrapped as a
`THREE.CanvasTexture` on a plane. Canvas-texture (not a DOM/CSS overlay) because
overlays are unreliable in immersive WebXR (TASK §2.3.2); component 2 reuses the
technique for rich text. Draws from the **same `PanelLayout`** used for
hit-mapping, so pixels and tap regions line up. `redraw` reads only pure
selectors.

### `audio-player.ts` — spatialized media wrapper

Thin wrapper over a ready `HTMLAudioElement`: `play`/`pause`/`seekToSeconds`
plus forwarding `timeupdate`/`ended` out as `onTick`/`onEnded` callbacks, so the
reducer stays the source of truth. Injected ready (takes the element, not a URL)
— the seam component 8 reuses with an asset-provider URL. `dispose()` releases
the media.

Also owns **spatialization**: routes the element through a `THREE.PositionalAudio`
panner (`setMediaElementSource`) built from the injected `AudioListener`, and
exposes it as `spatialNode` for the billboard to add to its group. The element
keeps transport control (we never call `spatialNode.play()`); only the output is
spatial. `play()` resumes the `AudioContext` on the first click (it starts
suspended, which would otherwise leave a media-element source silent). Tuning:
`refDistance` 1 m, `rolloffFactor` 1.5, `maxDistance` 40 m, inverse distance
model.

### `billboard-interaction.ts` — pointer picking

Raycasts the sprite + panel meshes on a click and reports a classified hit — a
sprite click (by id → `core` `click`) or a panel hit (by id + local UV →
`core` `hitToAction`). The tap-vs-drag gate (≤ 5 px, released ≤ 400 ms, pure and
unit-tested) and the multi-touch/`pointercancel` bookkeeping live in the shared
`pointer-tap-picker` / `tap-gate`. Inactive panels never enter the raycast set
(`getPickTargets()`), so only the open panel is interactive. This is the **only** desktop/AR difference:
component 8 swaps the `pointerup`-raycast for the WebXR `select` ray, keeping
the same callbacks.

## Dependencies

`view/` imports from `core/` (`../core/…`) only — never the reverse. Within
`view/`, `clickable-billboard` composes `audio-player` + `transport-panel-view`,
and `billboard-interaction` reads the `BillboardUserData` type from
`clickable-billboard`.
