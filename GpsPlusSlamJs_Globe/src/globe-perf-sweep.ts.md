# globe-perf-sweep.ts - the frame-hitch recorder's in-page sweep

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 §4.4 and §4.3. The
  sweep runs once on a phone and its one export is pasted, so the cell list
  and its time estimate are fixed here.
- Public API:
  - `PerfFactors`, `PerfCell` (with `hooks`: the recorder's event hooks
    on, or off for frame intervals only; and `drive`: `place` sets the
    camera on the path, `controls` feeds the controls' wheel input on the
    same law, H5), `PerfSweep`, `PERF_DEFAULT_CELL`.
    The defaults:
    - 0.5 decades a second;
    - `adjustHeight` 1;
    - relief cache 64 MiB;
    - parse jobs 5;
    - downloads per origin 25;
    - pixel ratio 2.
  - `perfSweepCells("quick" | "full" | "overhead")`, in run order:
    - `quick`: the four places at the defaults, three repeats each, one
      zoom at the Alps driven through the controls (the zoom-point
      raycasts a pinch costs), then the first cell again (`heatCheck`,
      §4.1).
    - `full`: `quick`'s thirteen, then (with `pauseBefore` on the first:
      two halves against heat) the Alps varied ONE factor at a time,
      three repeats each, then the first cell again. The variants: speed
      0.25 and 1; `adjustHeight` 0; relief cache 32 MiB; parse jobs 1 and
      2; downloads 6 and 12; pixel ratio 1.
    - `overhead` (§4.1, the recorder's own cost): the Alps at the
      defaults, six runs alternating the hooks off and on (off first), so
      a phone warming over them weighs on both kinds alike.
    - RangeError for another name.
  - `perfSweepEstimateMs(cells)`: the 2 s idle calibration, each cell's
    zoom (`perfZoomDurationMs`) and an 8 s move whenever the place
    changes.
    - About 4 min for `quick` and 11 min for `full`.
    - The plan's "about 25 min" for `full` assumed runs of 12-45 s; by
      its own law a run is 15.3 s.
- `perfOverheadVerdict(runs)`: the mean p50 and p95 with the hooks on
  minus off, against the off runs' spread (max - min); `pass` when both
  stay within it, `passAt` at the spread x0.5, x1 and x2. Null without
  two usable runs of each kind.
- Invariants & assumptions: factors that need a reload (`relief`, a cold
  cache) are not cells; they are separate links (§4.4).
- Tests: `globe-perf-sweep.test.ts`:
  - `quick`'s order and heat cell;
  - `full`'s one-factor variants, three repeats each;
  - the one pause;
  - the estimate built from the same list;
  - the overhead sweep's alternation;
  - the overhead verdict at both outcomes and its swept bound;
  - the refusal.
