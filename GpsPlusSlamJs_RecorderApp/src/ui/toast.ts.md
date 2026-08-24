# Toast Notification Component

## Purpose

A toast notification system for displaying temporary messages to users. Primarily used for alerting users of file write failures in real-time.

**This module owns the recorder's PLACEMENT and LOOK only.** Since 2026-08-24 the mechanism — the element, the ARIA contract, the timer, replace-and-restart — comes from the framework's `utils/toast-core`, the one toast implementation in the workspace. The public API here did not change; two behaviours did:

- **Messages are now announced to assistive technology.** This module had no `role` and no `aria-live`, so every message it had ever shown was silent to a screen reader.
- **The element is attached on show and removed on hide**, instead of living in the DOM permanently behind a `hidden` class. This is inherited from the shared mechanism rather than needed here: the rule exists for the OSM demo's `#ar-root` (`position: fixed; inset: 0`, hidden only while `:empty`), where a permanent child keeps a full-viewport click-eating layer over the page. This app's `#app` is `position: relative` and the old element carried Tailwind's `hidden` when idle, so neither problem applied. One rule for both callers is the reason, and it is worth more than the saved DOM operation.

**User Feedback Issue #1 Part B**: Users need immediate feedback when file write operations fail, not just a count at the end of the session.

## Public API

### `initToast(): void`

Initialize the toast notification system, bound to the **AR DOM-overlay root** (`#app`), falling back to `document.body` when that root is absent. Safe to call multiple times (idempotent).

**Nothing appears in the DOM until `showToast` is called** — the element is attached on show and removed on hide. The overlay root is resolved here rather than at module load, so a page whose `#app` arrives late still gets its toast inside it.

**Why `#app` and not `document.body`:** under WebXR DOM Overlay only the element passed to `initAR` (bound as `domOverlay = { root: container }` — the recorder's `#app`) and its descendants composite over the camera feed. The toast previously appended to `document.body`, a _sibling_ of `#app`, so the "Re-observed '\<name>'" confirmation fired but was invisible during an immersive-ar session (2026-06-16 user-feedback Finding 4 / D4; same ancestor-of-`initAR` rule as the 2026-06-05 HUD-stacking finding). `#app` is also the persistent page root hosting the setup + replay UI, so non-AR toasts (replay "✅ Replay complete", setup/save failures) remain visible.

**Example:**

```typescript
import { initToast } from './ui/toast';

// Call during app initialization
initToast();
```

### `showToast(message: string, options?: ToastOptions): void`

Show a toast notification with the given message. Replaces any currently visible toast.

**Parameters:**

- `message` - The message to display
- `options` - Optional configuration:
  - `duration` - How long to show in ms (default: 5000)
  - `severity` - Visual level: 'info' | 'warning' | 'error' (default: 'warning')

**Example:**

```typescript
import { showToast } from './ui/toast';

// Warning toast (default)
showToast('⚠️ Save failed - check folder permissions');

// Error toast with standard error duration
showToast('Critical error!', {
  severity: 'error',
  duration: TOAST_DURATION_ERROR,
});
```

### `TOAST_DURATION_ERROR` (exported constant)

Standard duration (8000ms) for error-severity toasts. Use instead of inline magic numbers.

```typescript
import { showToast, TOAST_DURATION_ERROR } from './ui/toast';
showToast('⚠️ Save failed', {
  severity: 'error',
  duration: TOAST_DURATION_ERROR,
});
```

### `hideToast(): void`

Hide the toast notification immediately. Safe to call when already hidden.

### `destroyToast(): void`

Remove the toast system from DOM. Primarily for testing cleanup.

## Invariants & Assumptions

- Only one toast is visible at a time (new toast replaces old), and a replacement **restarts** the timer — a late second message gets its own full reading time, not the remainder of the first's
- Toast auto-hides after duration expires
- **The message text is written one task after the element is attached.** A live region is announced when its content changes while it is in the accessibility tree; one inserted already carrying its text is commonly not announced at all. Tests must advance timers by 0 before reading the text — that is the behaviour, not a test artifact
- **Hiding cancels a queued text write**, so a dismissed toast cannot be repopulated and announced a moment later
- Container is positioned at bottom-center of viewport
- z-index 100 ensures visibility over most content
- **AR overlay nesting:** the container is a descendant of the `#app` overlay root so it composites over the AR camera in immersive-ar; it degrades to `document.body` only when `#app` is absent.
- **Tailwind utility classes:** All styling (layout + severity colors) uses Tailwind utility classes via `classList`, consistent with the rest of the Recorder App UI. Severity-specific classes are declared in the `SEVERITY_CLASSES` constant map.

## Tests

Located in [toast.test.ts](toast.test.ts):

- Nothing in the DOM until a message is shown; `initToast` idempotent; `showToast` initialises on demand
- The empty-then-filled sequence, which is the only way to pin the deferred write — a test reading only the final text passes for the silent version too
- `role="status"` / `aria-live="polite"`
- Message display, replacement, and timer restart on replacement
- Auto-hide after timeout, and custom duration support
- Severity styling (info/warning/error), including that the previous severity does not linger
- Manual hide, hide beating a queued write, and hide being safe when nothing is showing
- `destroyToast` removing the toast and letting a later `showToast` build a fresh one
- Tailwind class assertions for container layout and severity colors
- AR DOM-overlay nesting (D4 F4-A): container mounts inside `#app`; non-AR toast still visible after re-parent; `document.body` fallback when `#app` absent; the overlay root re-resolved when the toast is rebuilt

The mechanism itself is covered by the framework's `utils/toast-core.test.ts`; these tests cover what this module adds.
