# billboard/core — pure logic

Framework-free, deterministic, unit-tested logic for the clickable billboard.
**No Three.js, no DOM, no audio element.** Every module here is pure input →
output, so it runs on a desktop with no phone and is reused verbatim by the AR
scene (component 8). The `view/` layer applies these results as side effects.

> The face-the-user yaw (`computeBillboardYaw`) and `clamp01` now live in
> [`src/components/shared/`](../../shared/README.md) because component 2 reuses them
> too; this folder imports them from there.

## Modules

### `playback-transport.ts` — the transport reducer

The single source of truth for playback: which clip is active, playing/paused,
and the playhead. `transportReducer(state, action)` with
`INITIAL` and selectors `isActive` / `isPlaying` / `progressFraction`.

- Actions: `click(id)` · `toggle` · `seek(fraction)` · `tick(id, pos, dur)` ·
  `ended(id)`.
- **`click` always (re)starts** that clip from 0 as the sole active clip.
  Re-clicking the active clip keeps its already-known duration (the bar must
  not flash empty); a new clip's duration is 0 until its first `tick`.
- **`toggle`/`seek` are no-ops when idle** (return the same reference).
- **`seek.fraction` is clamped to [0, 1]**.
- **Stale `ended` and `tick` are ignored** (id ≠ active) so a late event from
  the previous clip — pausing an element emits a final `timeupdate` — can't
  stop or scrub the freshly started clip. Both actions carry the source clip's
  id for this; callers forward events blindly, with no guard of their own.

### `panel-layout.ts` — layout + hit-mapping

The one place that knows _where_ the button and progress track sit on the panel,
as normalized UV rectangles — so the same layout both draws the panel and
decides what a tap means. `hitToAction(uv, layout = DEFAULT_PANEL_LAYOUT)` →
`{ type: "toggle" } | { type: "seek", fraction } | null` — a ready-to-dispatch
`TransportAction` subset (`PanelTapAction`), so callers just
`dispatch(hitToAction(uv))` instead of re-mapping an intermediate "intent".

- UV convention matches `THREE.PlaneGeometry` intersection UVs (origin
  bottom-left, u→right, v→up).
- **Button resolved first**; default regions are disjoint, so ordering is
  unambiguous.
- A tap in the padding/gap → `null` (no phantom seek).

### `transport-reconcile.ts` — model ⇄ player diffing

`reconcilePlayer(state, id, { currentTime, paused })` → the commands the view
executes on one billboard's panel + audio element: `panelVisible`,
`seekToSec | null`, `playback: "play" | "pause" | null`.

- **Seek epsilon (0.3 s)**: a divergence beyond it is a deliberate jump (click
  restart, bar seek) → seek the element; within it is ordinary ~4 Hz
  `timeupdate` feedback → leave the element alone so the loop never fights
  playback.
- An **inactive** billboard only ever gets a `pause` (when still running);
  seeking it is pointless (a later click restarts from 0).

`panel-layout` builds on the shared `Rect` + `contains` UV-geometry primitive and
the shared `clamp01`, both from [`src/components/shared/`](../../shared/README.md).

## Tests

Every module here has a colocated `*.test.ts` (the shared `billboard-math` and
`panel-geometry` are tested under `src/components/shared/`):

- `playback-transport.test.ts` — click start/switch/restart (duration kept),
  toggle, seek (incl. clamp), tick, ended-at-end, the ignored stale `ended`
  _and_ stale `tick`, and selectors.
- `panel-layout.test.ts` — button→toggle, track→seek fraction (centre/edges,
  clamped), gap/chrome→null, and a disjoint-regions guard.
- `transport-reconcile.test.ts` — in-sync playback untouched (no seek/churn),
  click-restart and paused bar-seek reach the element, play/pause diffing,
  inactive pause/no-op.

Run: `pnpm test:unit` (or `pnpm test:watch`).
