/**
 * Unit tests for the recorder's toast notification component.
 *
 * Why this test matters:
 * - User Feedback Issue #1 Part B: users need real-time feedback when file
 *   write operations fail, not just a count at the end. The toast provides
 *   immediate visibility into data loss.
 * - 2026-06-16 user feedback, Finding 4 / D4: under WebXR DOM Overlay only the
 *   element passed to `initAR` (`#app`) and its descendants composite over the
 *   camera feed. A toast on `document.body` fired and was never seen during a
 *   recording. Descendant-of-`#app` is the invariant that makes it visible.
 *
 * REWRITTEN 2026-08-24, when this module moved onto the framework's shared
 * `utils/toast-core`. Three of its behaviours changed, and the tests changed
 * with them rather than the mechanism being bent to keep them:
 *
 * - **The element is attached on show and removed on hide**, instead of living
 *   in the DOM permanently behind a `hidden` class. Assertions about that class
 *   became assertions about presence.
 * - **The text is written one task later than the insertion**, which is what
 *   makes a live region actually announce. Every assertion that reads the text
 *   now advances timers by 0 first — and that is not a test artifact, it is the
 *   behaviour: a screen reader is why the write is deferred.
 * - **The toast announces at all.** This module had no `role` and no
 *   `aria-live` before, so every message it has ever shown was silent to
 *   assistive technology. That is the reason the move was worth doing.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  initToast,
  showToast,
  hideToast,
  destroyToast,
  TOAST_DURATION_ERROR,
} from './toast.js';

/** The toast element while it is shown, or null when nothing is showing. */
const toastElement = (): HTMLElement | null =>
  document.getElementById('toast-container');

/** Show a message and let the deferred text write land. */
function show(...args: Parameters<typeof showToast>): void {
  showToast(...args);
  vi.advanceTimersByTime(0);
}

describe('Toast Notification', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyToast();
    vi.useRealTimers();
  });

  describe('initToast', () => {
    it('shows nothing until a message is given', () => {
      // Why: the element is attached on show. An always-present container is
      // what the AR overlay root must not have — `#ar-root`-style roots are
      // `position: fixed; inset: 0` and a permanent child eats every tap.
      initToast();

      expect(toastElement()).toBeNull();
    });

    it('is idempotent (multiple calls do not create duplicates)', () => {
      // Why: safe to call init multiple times, and a second init must not
      // orphan the first toast's timer.
      initToast();
      initToast();
      initToast();
      show('Test message');

      expect(document.querySelectorAll('#toast-container')).toHaveLength(1);
    });

    it('is not required — showToast initialises on demand', () => {
      // Why: main.ts calls initToast() during boot, but the failure paths that
      // use showToast must not depend on that having happened.
      show('Save failed');

      expect(toastElement()?.textContent).toContain('Save failed');
    });
  });

  describe('showToast', () => {
    beforeEach(() => {
      initToast();
    });

    it('displays the provided message', () => {
      show('⚠️ Save failed - check folder permissions');

      expect(toastElement()?.textContent).toContain('Save failed');
    });

    it('attaches the element empty, and fills it one task later', () => {
      // THE ASSERTION THE MOVE WAS FOR. A live region is announced when its
      // content changes while it is in the accessibility tree; one inserted
      // already carrying its text is commonly not announced at all. A test that
      // only checked the final text would pass for the silent version too.
      showToast('Announce me');
      expect(toastElement()).not.toBeNull();
      expect(toastElement()?.textContent).toBe('');

      vi.advanceTimersByTime(0);
      expect(toastElement()?.textContent).toBe('Announce me');
    });

    it('announces politely to assistive technology', () => {
      // Why: this module had NO aria attributes before 2026-08-24, so every
      // message it showed was invisible to a screen reader. Polite rather than
      // assertive: these are information, not interruptions.
      show('Test message');

      const element = toastElement();
      expect(element?.getAttribute('role')).toBe('status');
      expect(element?.getAttribute('aria-live')).toBe('polite');
    });

    it('auto-hides after the default timeout (5 seconds)', () => {
      show('Temporary message');

      vi.advanceTimersByTime(5000);

      expect(toastElement()).toBeNull();
    });

    it('supports a custom timeout duration', () => {
      show('Important message', { duration: 10000 });

      vi.advanceTimersByTime(5000);
      expect(toastElement()).not.toBeNull();

      vi.advanceTimersByTime(5000);
      expect(toastElement()).toBeNull();
    });

    it('supports different severity levels (warning, error)', () => {
      show('Warning message', { severity: 'warning' });
      expect(toastElement()?.classList.contains('toast-warning')).toBe(true);

      show('Error message', { severity: 'error' });
      expect(toastElement()?.classList.contains('toast-error')).toBe(true);
      // The previous severity must not linger, or every later message wears
      // the last error's colour.
      expect(toastElement()?.classList.contains('toast-warning')).toBe(false);
    });

    it('replaces the previous toast rather than stacking', () => {
      show('First message');
      show('Second message');

      expect(document.querySelectorAll('#toast-container')).toHaveLength(1);
      expect(toastElement()?.textContent).not.toContain('First');
      expect(toastElement()?.textContent).toContain('Second');
    });

    it('restarts the timer on a replacement', () => {
      // Why: a second message arriving late in the first one's linger must get
      // its own full reading time, not the remainder of the first's.
      show('First message');
      vi.advanceTimersByTime(4000);
      show('Second message');

      vi.advanceTimersByTime(4000);
      expect(toastElement()?.textContent).toContain('Second');

      vi.advanceTimersByTime(1000);
      expect(toastElement()).toBeNull();
    });
  });

  describe('exported duration constants', () => {
    // Why these tests matter: named constants prevent magic numbers in callers
    // (e.g. main.ts) and centralize duration semantics in the toast module.
    it('exports TOAST_DURATION_ERROR as 8000ms (longer display for errors)', () => {
      expect(TOAST_DURATION_ERROR).toBe(8000);
    });
  });

  describe('hideToast', () => {
    beforeEach(() => {
      initToast();
    });

    it('hides the toast immediately', () => {
      show('Test message');
      hideToast();

      expect(toastElement()).toBeNull();
    });

    it('beats a queued text write', () => {
      // Why: hiding between the insertion and the deferred write must cancel
      // that write. If it did not, an empty element would be re-populated after
      // it was dismissed — and announced.
      showToast('Never seen');
      hideToast();
      vi.advanceTimersByTime(0);

      expect(toastElement()).toBeNull();
    });

    it('is safe to call when already hidden', () => {
      expect(() => {
        hideToast();
        hideToast();
      }).not.toThrow();
    });
  });

  describe('uses Tailwind classes instead of inline styles', () => {
    // Why: the rest of the Recorder App UI uses Tailwind utility classes via
    // className/classList. Inline `Object.assign(el.style, {...})` is
    // inconsistent with the project convention and harder to maintain.
    it('styles the container with Tailwind layout classes', () => {
      show('Anything');
      const container = toastElement();

      expect(container).not.toBeNull();
      expect(container!.className).toContain('fixed');
      expect(container!.className).toContain('bottom-20');
      expect(container!.className).toContain('left-1/2');
      expect(container!.className).toContain('-translate-x-1/2');
      expect(container!.className).toContain('z-[100]');
      expect(container!.style.position).toBe('');
      expect(container!.style.bottom).toBe('');
    });

    it('applies severity colors via Tailwind classes not inline styles', () => {
      show('Info', { severity: 'info' });
      expect(toastElement()!.className).toContain('bg-blue-500/90');
      expect(toastElement()!.style.backgroundColor).toBe('');

      show('Warning', { severity: 'warning' });
      expect(toastElement()!.className).toContain('bg-amber-400/90');

      show('Error', { severity: 'error' });
      expect(toastElement()!.className).toContain('bg-red-500/90');
      expect(toastElement()!.style.backgroundColor).toBe('');
    });
  });

  describe('destroyToast', () => {
    it('removes the toast container from the DOM', () => {
      initToast();
      show('Something');
      destroyToast();

      expect(toastElement()).toBeNull();
    });

    it('lets a later showToast build a fresh toast', () => {
      // Why: destroy is used for test cleanup and app lifecycle; a module left
      // holding a dead handle would silently stop showing anything.
      initToast();
      destroyToast();
      show('After destroy');

      expect(toastElement()?.textContent).toBe('After destroy');
    });
  });

  describe('AR DOM-overlay nesting (D4 F4-A)', () => {
    // Why these tests matter (2026-06-16 user feedback, Finding 4 / D4):
    // Under WebXR DOM Overlay, ONLY the element passed to `initAR` (the
    // recorder's `#app`, bound as `domOverlay = { root: container }`) and its
    // descendants are composited over the AR camera feed. The toast container
    // was appended to `document.body` — a SIBLING of `#app` — so the
    // "Re-observed '<name>'" confirmation fired but was never visible during a
    // recording session. See the 2026-06-05 HUD-stacking finding (the same
    // ancestor-of-`initAR` rule).

    it('mounts inside the #app overlay root so it composites over the AR camera', () => {
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      initToast();
      show('In AR');

      expect(app.contains(toastElement())).toBe(true);
    });

    it('keeps a non-AR toast visible after the re-parent (replay/setup regression)', () => {
      // `showToast` is also used on the replay screen ("✅ Replay complete") and
      // for setup/save failures (main.ts). Re-parenting into `#app` must NOT
      // regress those: `#app` is the persistent page root that also hosts the
      // setup and replay UI.
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      initToast();
      show('✅ Replay complete', { severity: 'info' });

      expect(app.contains(toastElement())).toBe(true);
      expect(toastElement()?.textContent).toContain('Replay complete');
    });

    it('falls back to document.body when no #app overlay root exists', () => {
      // Defensive: in non-recorder/test contexts where `#app` is absent the
      // toast must still mount somewhere rather than throwing.
      expect(document.getElementById('app')).toBeNull();

      initToast();
      show('No overlay root');

      expect(toastElement()?.parentElement).toBe(document.body);
    });

    it('re-resolves the overlay root when the toast is rebuilt', () => {
      // Why: `initToast()` runs at boot, and the recorder's `#app` is in the
      // static markup — but a test context (or a future teardown) can replace
      // it. Binding the root once at module load would leave the toast writing
      // into a detached element, which is the same silent-invisibility bug D4
      // was about.
      initToast();
      show('Before');
      expect(toastElement()?.parentElement).toBe(document.body);

      destroyToast();
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      initToast();
      show('After');
      expect(app.contains(toastElement())).toBe(true);
    });
  });
});
