# globe-band-step.ts - the altitude band's per-frame step

- Purpose: the relief's share of the pixels and the release of a carrier
  that left the band, moved out of the globe lab's `updateFrame` (one-scene
  plan §3, round-6 plan G6-1) as a pure refactor: same order, same state,
  same log and mark events.
- Public API:
  - `createBandShare({ globeTiles, reliefTiles, reliefSettled, log, mark })`
    returns `{ step(nowMs, frame), share(), target() }`.
    - `frame`: `{ altitudeM, fixedShare, highM, lowM, gate, sharp }` (the
      lab's `bandShare`, `bandHigh`/`bandLow` in metres, `bandGate`,
      `bandSharp`). `step` returns the drawn share.
    - A fixed share or `gate: false` follows the target at once; otherwise
      `nextDrawnShare` moves it, the relief ready only when its top level is
      ready and (unless it already has pixels or `sharp` is false) its view
      is refined. The first gated frame starts on the globe (drawn 0, dt 0);
      a gap counts at most 250 ms.
    - Events: `band.hold` / `band.go` when the hold changes, `band.edge`
      when the share crosses 0 or 1, `band.mixed` each mixed frame,
      `band.share` at each new 0.1 step.
    - `share()` is 1 before the first step (the lab's start with a relief),
      `target()` 0.
  - `createBandRelease({ globe, relief, log, mark, clock? })` returns
    `{ step(nowMs, frame), outOfBand, released, settled() }`.
    - A carrier is `{ cache: TileCache, keep: () => keepFn }`; `keep` is
      asked anew each frame (it reads the tiles' frame count).
    - `frame`: `{ share, altitudeM, frozen, releaseMs, drainTiles }`. The
      globe is out at a share of 1, the relief at 0. After `releaseMs` out,
      the carrier's cache is drained `drainTiles` a frame (`drainTileCache`,
      keeping what `keep` names), or released whole with 0. A return resets
      the wait and the done flag; `frozen` (a smoke's held share) restarts
      the wait without releasing.
    - `outOfBand[key]` is `{ since, done, last }`, `last` the smokes' record
      (`leftAt`, `releasedAt`, `drainedAt`, `frames`, `maxPerFrame`,
      `releaseMs`, `worstFrameMs`, `bytes`); `released[key]` the bytes
      freed. Both are live objects the page reads.
    - Events: `release.<key>` on a new release, `drain.<key>` each drain
      frame, `drained.<key>` (log) when nothing is left to drain.
- Invariants: no validation beyond what `carrierShareAt`, `nextDrawnShare`
  and `drainTileCache` throw (RangeError on a bad band, share or drain
  step). The clock is only for the drain's cost.
- Example:

  ```ts
  const band = createBandShare({
    globeTiles,
    reliefTiles,
    reliefSettled,
    log,
    mark,
  });
  const share = band.step(now, {
    altitudeM,
    fixedShare: null,
    highM: 8000,
    lowM: 2000,
    gate: true,
    sharp: true,
  });
  ```

- Tests: `globe-band-step.test.ts` (the first frame, the 250 ms cap, fixed
  and ungated shares, a hold logged once, mixed marks and 0.1 steps; the
  release after the wait with its record, a return and a freeze, a whole
  release and a new release after a return).
