# playback-transport.ts

## Purpose

Pure playback "transport" model — the single source of truth for which clip
is active, whether it is playing or paused, and where the playhead is. One
reducer drives the exclusive one-clip-at-a-time policy (`click`), the
play/stop button (`toggle`), and the seekable progress bar (`seek` + `tick`

- `progressFraction`). Framework-free and view-free: no Three.js, no DOM, no
  audio element — the view layer maps these actions to `HTMLAudioElement`
  calls and forwards `tick`/`ended` back in.

## Public API

- **`TransportState`** — `{ activeId, status, positionSec, durationSec }`.
  `activeId` is `null` when idle; `status` is `'playing' | 'paused'`.
- **`TransportAction`** — discriminated union: `click` (id), `toggle`,
  `seek` (fraction), `tick` (id, positionSec, durationSec), `ended` (id).
  `tick`/`ended` carry the source clip's id so a stale event from a clip the
  user already switched away from is ignored rather than scrubbing/stopping
  the new one.
- **`INITIAL: TransportState`** — idle state.
- **`transportReducer(state, action): TransportState`**.
- **`isActive(state, id): boolean`**, **`isPlaying(state, id): boolean`**.
- **`progressFraction(state): number`** — playhead fraction in `[0, 1]`; `0`
  when duration is not yet known.

## Invariants & assumptions

- `toggle` and `seek` are no-ops while no clip is active (`activeId === null`).
- `tick`/`ended` for a non-active `id` are no-ops (guards the stale-event
  race described above).
- A re-`click` on the already-active clip keeps its known `durationSec`
  (same element, still valid); clicking a different clip resets it to `0`
  until the next `tick`.
- Depends on `clamp.ts` only.

## Examples

```ts
import {
  INITIAL,
  transportReducer,
  isPlaying,
  progressFraction,
} from 'gps-plus-slam-app-framework/visualization';

let state = transportReducer(INITIAL, { type: 'click', id: 'clip-1' });
isPlaying(state, 'clip-1'); // true
state = transportReducer(state, {
  type: 'tick',
  id: 'clip-1',
  positionSec: 4,
  durationSec: 10,
});
progressFraction(state); // 0.4
```

## Tests

- `playback-transport.test.ts` — the exclusive one-clip policy, toggle/seek
  no-ops while idle, stale `tick`/`ended` rejection, and `progressFraction`
  before/after duration is known.
