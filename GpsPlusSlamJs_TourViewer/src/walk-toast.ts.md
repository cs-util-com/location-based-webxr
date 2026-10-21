# walk-toast.ts

## Purpose

The visitor's toast in AR (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M2, §1.4): a thin wrapper over the framework's one toast
(`gps-plus-slam-app-framework/utils/toast-core`, its 6 s linger and its
polite live region) that says a news item once per AR entry.

## Public API

- `createWalkToast(toast: Pick<Toast, "show" | "clear">): WalkToast`
  - `say(text)` - show now (an event: "Skipped The well.", "Welcome back
    - your progress is kept.");
  - `sayOnce(text)` - show once this AR entry (news re-derived every
    camera frame: "Tour placed by GPS (less exact)");
  - `reset()` - a new entry: forget what was said, take the toast down.
- "" is never said.

## Invariants & assumptions

- What was said lives in the closure, not the store: it is the dedup of a
  DOM resource (a re-shown toast restarts its timer and is announced
  again), not walk state any view reads.
- `main.ts` creates the toast in `#walk-toast-root` with the class
  `walk-toast` (design.css's `.toast` class is not used, plan §1.2);
  `ar-entry.ts` resets it at the session's end.

## Examples

```ts
const toast = createWalkToast(
  createToast(root, { className: "walk-toast", id: "walk-toast" }),
);
toast.sayOnce("Tour placed by GPS (less exact)");
```

## Tests

- `walk-toast.test.ts` - once per entry and again after a reset; an
  event every time; never an empty text.
