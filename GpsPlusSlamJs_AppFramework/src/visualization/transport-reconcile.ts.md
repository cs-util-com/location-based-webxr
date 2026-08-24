# transport-reconcile.ts

## Purpose

Pure reconcile step between the `playback-transport.ts` model and one
billboard's audio player. Decides when a divergence between the model's
playhead and the audio element is a _deliberate jump_ (a click restart or a
bar seek → issue a seek) versus ordinary ~4 Hz `timeupdate` feedback (→ leave
the element alone, or the two would fight), and when a play/pause call must
be issued at all. As a pure function it is unit-tested and reusable by any
view (e.g. an AR scene) without duplicating the decision.

## Public API

- **`PlayerSnapshot`** — `{ currentTime: number, paused: boolean }`, the
  slice of the audio element's state the decision reads.
- **`ReconcileCommands`** — `{ panelVisible: boolean, seekToSec: number | null, playback: 'play' | 'pause' | null }`.
  `seekToSec` is `null` when the element is already in sync; `playback` is
  `null` when no play/pause call is needed.
- **`reconcilePlayer(state: TransportState, id: string, player: PlayerSnapshot): ReconcileCommands`**
  — the view executes the result mechanically: set panel visibility, seek if
  `seekToSec` is non-null, then call `play()`/`pause()` per `playback`.

## Invariants & assumptions

- For an inactive billboard (`id !== state.activeId`) the only possible
  command is pausing a still-running element; seeking it is never issued (a
  later click restarts from `0` anyway).
- Re-seeks only when `|player.currentTime - state.positionSec| > 0.3s`
  (`SEEK_SYNC_EPSILON_SEC`) — small enough to catch a deliberate jump, large
  enough that normal `timeupdate` feedback never trips it.
- Depends on `playback-transport.ts` only.

## Examples

```ts
import { reconcilePlayer } from 'gps-plus-slam-app-framework/visualization';

const commands = reconcilePlayer(state, 'clip-1', {
  currentTime: audioEl.currentTime,
  paused: audioEl.paused,
});
if (commands.seekToSec !== null) audioEl.currentTime = commands.seekToSec;
if (commands.playback === 'play') audioEl.play();
```

## Tests

- `transport-reconcile.test.ts` — active vs. inactive billboard, seek issued
  only past the drift epsilon, and play/pause commands for every
  shouldPlay×paused combination.
