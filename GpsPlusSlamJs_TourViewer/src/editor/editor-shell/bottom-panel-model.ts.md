# bottom-panel-model.ts

## Purpose

The editor's bottom panel's rules, without the page: its tabs, the badges
on the bottom bar's toggles (only when there is something to see), its
height (clamped, started, dragged), what the browser keeps of it, the
toggles' open and close, the History tab's rows and the Performance
chart's feed. `bottom-panel.ts` draws them.

## Public API

- `PANEL_TABS` - `problems` "Problems", `history` "History", `tiles` "Map
  loading", `perf` "Performance", in the bar's order; `PanelTab` their ids.
- `PanelBadge` - `{ text, tone: error | warning | note | busy, title }`.
  - `problemsBadge(counts)` - the total, toned by the worst severity; null
    without a problem.
  - `historyBadge({ position, past, future })` - "past/total", only while
    there are steps to redo.
  - `tilesBadge(load | null)` - the map server's wait as a countdown
    (warning), else the failed tiles (error), else the ones loading
    (busy); null once loaded or without a map. `countdown(s)` gives
    "0:04" (whole seconds, rounded up).
  - `perfBadge(slowFrames)` - the frames over 50 ms in 5 s, null for none.
- `PANEL_HEIGHT` - default 220, min 90, topMargin 60, closeBelow 70,
  maxWithin 30, startFloor 120 (px).
  - `clampHeight(h, main)` - between min and the view less topMargin; a
    non-finite height is min.
  - `startHeight(saved, main)` - the first open of a visit: the kept height
    (or the default), at most half the view but never under 120, clamped.
  - `dragged(h, main)` - a grip drag's end: `close` under 70 px, `max`
    within 30 px of the view's top, else the clamped `height`.
- `readSaved(raw)` - `{ heightPx, tab }` from the kept JSON (`{ h, tab }`);
  anything malformed gives `{ null, "problems" }`.
- `PanelState` - `{ open, tab, max }`; `toggled(state, tab?)` - a toggle
  (or Ctrl+J without a tab): a closed panel opens on it, an open one
  switches to it, its own tab closes it; a close ends the maximum.
- `HistoryRow` - `{ what, state: current | done | undone, steps, saved,
step }`;
  `historyRows({ past, future, position, savedAt })` - newest first: the
  undone steps (the next redo, `future.at(-1)`, nearest the current row),
  the current view, the steps before it, then "Opened the tour" (or
  "Earlier steps" once the history's bound dropped older ones). `steps` is
  what a click takes: negative undoes, positive redoes, 0 is the current
  row. `saved` marks the view the file written in place holds. `step` is
  the history's own step object (the panel reads its time by it), null
  for the base row.
- `minutesAgo(ms)` - a row's age: "just now" under a minute (and for a
  negative or non-finite age, a clock that stepped back), else "N min
  ago" in whole minutes.
- `PanelState.max` - maximised: the panel takes the view's whole height
  (the view above it, pushed up, keeps none).
- `withNewFrames(kept, recent, frameCount, seenCount, cap = 240)` - the
  chart's frames: only the intervals timed since the last look, taken
  from the view's latest `recent` ones, the last `cap` kept.

## Invariants & assumptions

- Pure; no DOM, no storage access (the panel reads and writes and hands
  the raw text here).
- Every height a drag keeps is inside the clamp; every start is at least
  the minimum (a property test).
- The History rows' step counts are distinct, sorted, with exactly one 0
  (a property test): a click lands on that row's view.
- No `-0` step: `0 - n` is used where the count may be zero.

## Examples

```ts
toggled({ open: false, tab: "problems", max: false }, "history");
// { open: true, tab: "history", max: false }
historyRows({
  past: [{ what: "Moved A" }],
  future: [],
  position: 1,
  savedAt: null,
});
// [{ what: "Moved A", state: "current", steps: 0, saved: false },
//  { what: "Opened the tour", state: "done", steps: -1, saved: false }]
```

## Tests

`bottom-panel-model.test.ts`: each badge's presence and tone, the
countdown, the clamp, start and drag outcomes, the kept values read
defensively, the toggles, the History rows (with the saved mark, the
dropped-steps base and each row's own step) and their property,
`minutesAgo`, and the chart's feed.
