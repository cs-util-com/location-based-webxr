# audio-player.ts

## Purpose

Thin, spatialized wrapper around a ready `HTMLAudioElement` (view layer). Fed
an already-constructed audio element, it exposes the few imperative calls a
reconciler needs — play / pause / seek — and forwards the element's
`timeupdate` / `ended` events back out as plain callbacks, so the pure
`playback-transport.ts` reducer stays the single source of truth. It also
owns spatialization: the element's output is routed through a
`THREE.PositionalAudio` panner built from a shared `AudioListener`, so
playback is attenuated and panned from the returned node's world position
once a caller adds it to the scene graph.

## Public API

- **`AudioPlayer`** — `play()`, `pause()`, `seekToSeconds(seconds)`,
  `currentTime` (getter), `paused` (getter), `spatialNode: PositionalAudio`
  (add to the scene graph so playback is positioned), `dispose()`.
- **`createAudioPlayer(element: HTMLAudioElement, listener: AudioListener, callbacks: { onTick(positionSec, durationSec): void; onEnded(): void }): AudioPlayer`**.

## Invariants & assumptions

- The element still owns transport (play/pause/seek/tick/ended); only the
  _output path_ is spatial — `spatialNode.play()` is never called directly.
- `play()` resumes a suspended `AudioContext` first (autoplay policy); call
  it from a user-gesture handler.
- `dispose()` detaches listeners, disconnects and removes `spatialNode`, and
  clears the element's `src`.
- Not unit-tested — glue over a DOM media element + WebAudio node; the
  decision logic it drives is `transport-reconcile.ts` and
  `playback-transport.ts`, both unit-tested. Depends on `three` only.

## Examples

```ts
import { createAudioPlayer } from 'gps-plus-slam-app-framework/visualization';

const player = createAudioPlayer(audioEl, listener, {
  onTick: (pos, dur) =>
    dispatch({ type: 'tick', id, positionSec: pos, durationSec: dur }),
  onEnded: () => dispatch({ type: 'ended', id }),
});
group.add(player.spatialNode);
player.play();
```

## Tests

- Not unit-tested (DOM media element + WebAudio glue); exercised manually via
  the consuming demo.
