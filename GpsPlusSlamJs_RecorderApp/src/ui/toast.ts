/**
 * Toast Notification Component
 *
 * A toast notification system for displaying temporary messages to users.
 * Primarily used for alerting users of write failures.
 *
 * User Feedback Issue #1 Part B: Users need real-time feedback
 * when file write operations fail, not just a count at the end.
 *
 * WHAT THIS MODULE OWNS, since 2026-08-24: the recorder's PLACEMENT (a
 * document-level singleton inside the AR overlay root) and its LOOK (Tailwind
 * classes, three severities, a longer linger for errors). The mechanism — the
 * element, the ARIA contract, the timer, replace-and-restart — comes from the
 * framework's `utils/toast-core`, which is the one toast implementation in the
 * workspace.
 *
 * WHY THAT MOVE WAS WORTH A REWRITE. This module had **no `role` and no
 * `aria-live`**, so every message it has ever shown was silent to assistive
 * technology, and it wrote its text in the same task as the insertion, which is
 * the other half of the same bug. Both were solved once in `ar-toast.ts` at a
 * cost of three review rounds, and neither is visible in finished code — which
 * is exactly why a second hand-written copy reproduced the bugs instead of the
 * fixes.
 *
 * @see toast.ts.md
 */

import {
  createToast,
  type Toast,
} from 'gps-plus-slam-app-framework/utils/toast-core';

// --- Types ---

type ToastSeverity = 'info' | 'warning' | 'error';

interface ToastOptions {
  /** How long to show the toast in milliseconds (default: 5000) */
  duration?: number;
  /** Visual severity level (default: 'warning') */
  severity?: ToastSeverity;
}

// --- Constants ---

const DEFAULT_DURATION = 5000;
/** Longer display duration for error toasts (ms) */
export const TOAST_DURATION_ERROR = 8000;
const TOAST_CONTAINER_ID = 'toast-container';

/**
 * Id of the AR DOM-overlay root — the element handed to `initAR` and bound as
 * `domOverlay = { root: container }`. Under WebXR DOM Overlay only this element
 * and its descendants composite over the camera feed, so the toast container
 * must mount INSIDE it (not as a sibling on `document.body`) to be visible in
 * an immersive-ar session. See 2026-06-05 HUD-stacking finding (Finding 3) and
 * 2026-06-16 user-feedback Finding 4 / D4.
 */
const AR_OVERLAY_ROOT_ID = 'app';

/** Layout classes, applied to every message regardless of severity. */
const LAYOUT_CLASSES = [
  'fixed',
  'bottom-20',
  'left-1/2',
  '-translate-x-1/2',
  'py-3',
  'px-6',
  'rounded-lg',
  'font-medium',
  'z-[100]',
  'max-w-[90%]',
  'text-center',
];

/** Severity-specific Tailwind classes, plus the semantic marker class. */
const SEVERITY_CLASSES: Record<ToastSeverity, string[]> = {
  info: [
    'toast-info',
    'bg-blue-500/90',
    'text-white',
    'border',
    'border-blue-500',
  ],
  warning: [
    'toast-warning',
    'bg-amber-400/90',
    'text-black',
    'border',
    'border-amber-400',
  ],
  error: [
    'toast-error',
    'bg-red-500/90',
    'text-white',
    'border',
    'border-red-500',
  ],
};

// --- State ---

let toast: Toast | null = null;

// --- Implementation ---

/** The full class string for one severity. */
function classNameFor(severity: ToastSeverity): string {
  return [...LAYOUT_CLASSES, ...SEVERITY_CLASSES[severity]].join(' ');
}

/**
 * Initialize the toast notification system.
 * Safe to call multiple times (idempotent).
 *
 * Nothing appears in the DOM until {@link showToast} is called — the core
 * attaches its element on show and removes it on hide.
 *
 * **That is inherited, not required here.** The rule exists for the OSM demo's
 * `#ar-root`, which is `position: fixed; inset: 0` and hidden only while
 * `:empty`, so a permanent child there keeps a full-viewport click-eating layer
 * over the page whenever AR is not running. This app's `#app` is
 * `position: relative` (see `styles/app.css`) and the old element carried
 * Tailwind's `hidden` when idle, so neither problem applied here. One rule for
 * both callers is worth more than the saved DOM operation — and a review
 * rightly rejected an earlier version of this comment that claimed the demo's
 * reason as this module's own.
 *
 * **The overlay root is resolved HERE rather than at module load**, so a page
 * whose `#app` arrives late (or is replaced) still gets a toast inside it.
 */
export function initToast(): void {
  if (toast) return;

  const overlayRoot = document.getElementById(AR_OVERLAY_ROOT_ID);
  toast = createToast(overlayRoot ?? document.body, {
    id: TOAST_CONTAINER_ID,
    className: classNameFor('warning'),
    lingerMs: DEFAULT_DURATION,
  });
}

/**
 * Show a toast notification with the given message.
 * Replaces any currently visible toast and restarts its timer.
 *
 * The message text lands one task later than the element, which is what makes
 * the live region announce it. Callers never see the difference; tests do, and
 * `toast.test.ts` explains why that is the behaviour rather than an artifact.
 *
 * @param message - The message to display
 * @param options - Optional configuration (duration, severity)
 */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (!toast) initToast();

  const { duration = DEFAULT_DURATION, severity = 'warning' } = options;
  toast?.show(message, {
    className: classNameFor(severity),
    lingerMs: duration,
  });
}

/**
 * Hide the toast notification immediately.
 * Safe to call when already hidden, and it cancels a text write that has been
 * queued but not yet run.
 */
export function hideToast(): void {
  toast?.clear();
}

/**
 * Destroy the toast system and remove it from the DOM.
 * Primarily for testing cleanup and app lifecycle.
 *
 * Drops the handle as well as clearing, so the next `showToast` re-resolves the
 * overlay root instead of writing into an element whose parent is gone.
 */
export function destroyToast(): void {
  toast?.clear();
  toast = null;
}
