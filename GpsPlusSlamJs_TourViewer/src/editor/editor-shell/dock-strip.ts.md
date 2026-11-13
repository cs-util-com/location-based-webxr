# dock-strip.ts

## Purpose

The docked groups' tab strips scroll sideways when their tabs do not fit
(a phone's one group holds seven panels): what a finger on a tab means
there, how far a strip moves to show a tab, and the wiring that applies
both to every horizontal strip under the docking's root. A general rule
for every docked strip, not a phone's special case: at a desk a strip
that overflows (a narrow group between two columns) scrolls the same way.

## Public API

- `STRIP_SLOP_PX` (10) - how far a finger moves before a touch on a tab is
  a swipe or a drag, not a tap or a hold: about Android's touch slop (8 dp)
  and more than the docking library's press tolerance (8 px).
- `STRIP_HOLD_MS` (250) - the docking library's arming delay for a touch:
  a move after it drags the tab.
- `STRIP_REST_PX` (5, half the slop) - how far a finger moves before it
  no longer rests on its tab.
- `restEndedAt(ended, { dx, dy }, now, restPx?)` - when the finger stopped
  resting: `ended` once set, `now` at the first move of `restPx` or more,
  else `null`; a move that is not numbers keeps `null`.
- `StripGesture` - `undecided`, `scroll` or `drag`.
- `stripGesture({ dx, dy, ms }, canScroll, slopPx?, holdMs?)` - `ms` is
  how long the finger rested before it moved; in order:
  `drag` for a strip that cannot scroll or a move that is not numbers;
  `undecided` under the slop; `drag` from the hold on; else `scroll` when
  the move is more along the strip than across it, `drag` otherwise.
- `scrolledToShow(strip, tab)` - the strip's scroll that shows the tab:
  unchanged when it is in sight, the least move otherwise, the tab's start
  when it is wider than the strip; nonsense leaves the scroll.
- `showTab(tab)` - scrolls a tab's horizontal strip so it is in sight; a
  tab in no such strip is left alone.
- `wireStripScroll(root, activate)` - wires the gesture rule and the focus
  rule under `root`; returns the call that removes the listeners.

## The gesture rule (and why)

The docking library (dockview 8) marks its tabs `touch-action: none` and
owns a touch from its press: a move past its 8 px tolerance before its
250 ms arming is a drag at once, so a flick on a tab could never scroll
the strip. `wireStripScroll`, for a touch or pen press on a tab of a strip
that overflows only:

- prevents the press's default, so the library does not show the tab on
  the press (a swipe must not change the shown tab);
- withholds the moves from the library (a capturing window listener that
  stops them) while the gesture is undecided, so its drag cannot start;
- on a decided `scroll`: sends the library a `pointercancel` for that
  pointer (its pending drag and its long-press menu end), then scrolls
  the strip by the finger, one to one;
- on a decided `drag`: lets the move through, past the library's
  tolerance, which starts its tab drag as before;
- on a release while undecided: a tap, which shows its tab (`activate`).

A strip whose tabs fit is left to the library entirely, as is a mouse.
A tab that takes the keyboard focus is scrolled into sight (`focusin`).

The hold is the time the finger RESTED on the tab before it moved
`STRIP_REST_PX`, not the time since the press: a busy phone (or a test
machine) delivers a swipe's moves far apart, and the clock alone read a
quick swipe as a held drag. A finger that rests, then moves, still drags.

The slop and the hold are swept by a property test (slop 4-24 px, hold
150-500 ms), and the rest by another (2-9 px): the rule keeps its shape
across the range.

## Invariants & assumptions

- The strip is the tab's parent, `.dv-tabs-container` without
  `.dv-tabs-container-vertical` (the library's own class names; an upgrade
  that renames them leaves the strips to the library, unscrolled).
- The scroll is plain `scrollLeft`, without momentum: a fling stops where
  the finger lifts.
- The module never decides the library's drag itself; it only keeps the
  moves away from it until the gesture is known.

## Examples

```ts
const stop = wireStripScroll(root, (tab) => {
  const id = tab.querySelector<HTMLElement>(".dock-tab")?.dataset["panel"];
  if (id !== undefined) host.reveal(id);
});
// ...
stop();
```

## Tests

- `dock-strip.test.ts` - the gesture rule's cases and its slop and hold
  swept, `scrolledToShow`'s cases and a property that the tab always ends
  in sight.
- `editor3d-phone.spec.js` - a finger's swipe along the phone's strip at
  several distances, a tap, a pull across it, the shown tab and a focused
  one in sight.
