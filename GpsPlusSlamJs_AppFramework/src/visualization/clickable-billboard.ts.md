# clickable-billboard.ts

## Purpose

The clickable cylindrical billboard (view layer / composition unit):
composes the pure pieces into one Three.js object — a textured sprite plane
plus an in-world transport panel below it, both yawing to face the user
(`billboard-math.ts`), with a spatialized audio element driven by the
`playback-transport.ts` reducer via `transport-reconcile.ts`. It is fed ready
resources (a loaded `THREE.Texture`, an `HTMLAudioElement`, and a shared
`THREE.AudioListener`) — the caller owns loading — which is the seam a
GLTF-model-based AR variant would reuse, swapping the plane for a model and
the element for an asset-provider URL.

## Public API

- **`BillboardUserData`** — `{ billboardId: string, role: 'sprite' | 'panel' }`,
  stamped onto each pickable mesh so a raycaster hit can be classified (see
  `billboard-interaction.ts`).
- **`ClickableBillboard`** — `{ id, group: Group, getPickTargets(): readonly Mesh[], faceCamera(cameraWorldPosition): void, applyState(state): void, dispose(): void }`.
- **`createClickableBillboard(options: { id, position: Vector3, texture: Texture, audio: HTMLAudioElement, listener: AudioListener, onTick, onEnded }): ClickableBillboard`**.

## Invariants & assumptions

- `getPickTargets()` returns only the sprite while the panel is hidden — the
  raycaster does not skip invisible meshes, so a hidden panel left in the
  target set would soak up taps meant for whatever is behind it.
- `applyState` is this billboard's slice of the reconcile step: the
  _decision_ (seek-vs-leave-alone epsilon, play/pause diffing) is the pure
  `reconcilePlayer`; this layer only executes the returned commands on the
  panel and player.
- `faceCamera` yaws the whole `group` (not just the sprite), which keeps the
  panel directly below the sprite while both face the camera.
- `dispose()` disposes the audio player, the sprite's GPU resources (via
  `three-dispose.ts`), and the panel.
- Depends on `three`, `three-dispose.ts`, `billboard-math.ts`,
  `audio-player.ts`, `transport-panel-view.ts`, `playback-transport.ts`, and
  `transport-reconcile.ts`.

## Examples

```ts
import { createClickableBillboard } from 'gps-plus-slam-app-framework/visualization';

const billboard = createClickableBillboard({
  id: 'clip-1',
  position: new Vector3(0, 1.6, -2),
  texture,
  audio: audioEl,
  listener,
  onTick: (id, pos, dur) =>
    dispatch({ type: 'tick', id, positionSec: pos, durationSec: dur }),
  onEnded: (id) => dispatch({ type: 'ended', id }),
});
scene.add(billboard.group);
// per frame:
billboard.faceCamera(camera.position);
billboard.applyState(transportState);
```

## Tests

- `clickable-billboard.test.ts` — pick-target visibility toggling with the
  panel shown/hidden, and `userData` role stamping on both meshes.
