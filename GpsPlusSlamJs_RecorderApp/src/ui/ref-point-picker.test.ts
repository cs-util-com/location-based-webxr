/**
 * Reference Point Picker Tests
 *
 * Tests for the reference point picker UI component.
 * The picker allows users to select an existing reference point name
 * or enter a new one, enabling consistent naming across sessions.
 *
 * Why these tests matter:
 * - The picker is critical for cross-session reference point alignment
 * - User input validation prevents empty or duplicate names
 * - Promise-based API ensures proper async handling
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showRefPointPicker,
  isRefPointPickerVisible,
  createRefPointPickerHtml,
  cancelRefPointPicker,
} from './ref-point-picker';
import {
  isModalStatePushed,
  destroyNavigation,
  initModalNavigation,
} from './navigation';

describe('Reference Point Picker', () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a container for the picker
    container = document.createElement('div');
    container.id = 'ref-point-picker-modal';
    container.innerHTML = createRefPointPickerHtml();
    container.classList.add('hidden');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Cleanup
    document.body.removeChild(container);
    destroyNavigation();
  });

  describe('createRefPointPickerHtml', () => {
    it('should return valid HTML with required elements', () => {
      const html = createRefPointPickerHtml();

      expect(html).toContain('ref-point-picker-input');
      expect(html).toContain('ref-point-picker-confirm');
      expect(html).toContain('ref-point-picker-cancel');
    });
  });

  describe('isRefPointPickerVisible', () => {
    it('should return false when picker is hidden', () => {
      container.classList.add('hidden');
      expect(isRefPointPickerVisible()).toBe(false);
    });

    it('should return true when picker is visible', () => {
      container.classList.remove('hidden');
      expect(isRefPointPickerVisible()).toBe(true);
    });

    it('should return false when picker element does not exist', () => {
      document.body.removeChild(container);
      expect(isRefPointPickerVisible()).toBe(false);
      // Re-add for cleanup
      document.body.appendChild(container);
    });
  });

  describe('showRefPointPicker', () => {
    it('should show the picker modal', async () => {
      // Start showing the picker (don't await - we'll interact with it)
      const resultPromise = showRefPointPicker();

      // Check that modal is visible
      expect(container.classList.contains('hidden')).toBe(false);

      // Click cancel to resolve the promise
      const cancelBtn = document.getElementById('ref-point-picker-cancel');
      cancelBtn?.click();

      const result = await resultPromise;
      expect(result).toBeNull();
    });

    it('should return new ref point when user enters custom name', async () => {
      const resultPromise = showRefPointPicker();

      // Enter a custom name
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'My Custom Point';

      // Click confirm
      document.getElementById('ref-point-picker-confirm')?.click();

      const result = await resultPromise;
      expect(result).not.toBeNull();
      expect(result?.id).toBe('My Custom Point');
    });

    it('should return null when cancel is clicked', async () => {
      const resultPromise = showRefPointPicker();

      document.getElementById('ref-point-picker-cancel')?.click();

      const result = await resultPromise;
      expect(result).toBeNull();
    });

    it('should not confirm with empty input when no suggestion selected', async () => {
      const resultPromise = showRefPointPicker();

      // Try to confirm with empty input
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = '';

      // Confirm should not work with empty input
      document.getElementById('ref-point-picker-confirm')?.click();

      // Modal should still be visible (not resolved)
      expect(isRefPointPickerVisible()).toBe(true);

      // Now cancel to clean up
      document.getElementById('ref-point-picker-cancel')?.click();
      const result = await resultPromise;
      expect(result).toBeNull();
    });

    it('should trim whitespace from input', async () => {
      const resultPromise = showRefPointPicker();

      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = '  Trimmed Name  ';

      document.getElementById('ref-point-picker-confirm')?.click();

      const result = await resultPromise;
      expect(result?.id).toBe('Trimmed Name');
    });
  });

  describe('Issue 5: confirm button disable after click', () => {
    // Why: Prevents multiple clicks on confirm from creating duplicates
    // when the picker is shown multiple times via rapid button taps.
    it('should disable confirm button after first confirm click', async () => {
      const resultPromise = showRefPointPicker();

      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Test Point';

      const confirmBtn = document.getElementById(
        'ref-point-picker-confirm'
      ) as HTMLButtonElement;

      confirmBtn.click();
      await resultPromise;

      // After resolving, confirm button should be disabled
      expect(confirmBtn.disabled).toBe(true);
    });

    // Why: Each new picker session must start with an enabled confirm button
    it('should re-enable confirm button when picker is shown again', async () => {
      // First session
      const resultPromise1 = showRefPointPicker();
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Test Point';
      document.getElementById('ref-point-picker-confirm')?.click();
      await resultPromise1;

      // Second session — confirm should be re-enabled
      const resultPromise2 = showRefPointPicker();
      const confirmBtn = document.getElementById(
        'ref-point-picker-confirm'
      ) as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(false);

      // Cleanup
      document.getElementById('ref-point-picker-cancel')?.click();
      await resultPromise2;
    });

    // Why: Clicking confirm twice rapidly should not resolve two different promises
    it('should ignore second confirm click after first resolves', async () => {
      const resultPromise = showRefPointPicker();

      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Test Point';

      const confirmBtn = document.getElementById(
        'ref-point-picker-confirm'
      ) as HTMLButtonElement;

      // Click confirm twice rapidly
      confirmBtn.click();
      confirmBtn.click();

      const result = await resultPromise;
      expect(result?.id).toBe('Test Point');
      // Second click should have been ignored (button disabled after first)
      expect(confirmBtn.disabled).toBe(true);
    });

    // Why: Clicking cancel should also disable confirm to prevent stale interactions
    it('should disable confirm button after cancel click', async () => {
      const resultPromise = showRefPointPicker();

      const cancelBtn = document.getElementById(
        'ref-point-picker-cancel'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await resultPromise;

      const confirmBtn = document.getElementById(
        'ref-point-picker-confirm'
      ) as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(true);
    });

    /**
     * Why this test matters (2026-02-27 Issue 2 — recurring multi-click bug):
     * If showRefPointPicker is called while a previous promise is still pending
     * (e.g., due to a race condition bypassing the caller's guard), the old
     * resolver must be resolved with null to prevent orphaned promises. Without
     * this, the old promise hangs forever inside handleMarkRefPoint and the
     * markRefPointInProgress lock is never released.
     */
    it('should resolve stale resolver with null when called again while pending', async () => {
      // Start first picker session (don't resolve it)
      const resultPromise1 = showRefPointPicker();

      // Start second picker session while first is still pending
      const resultPromise2 = showRefPointPicker();

      // First promise should resolve with null (stale resolver cleared)
      const result1 = await resultPromise1;
      expect(result1).toBeNull();

      // Second promise is now active — resolve it normally
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Test Point';
      document.getElementById('ref-point-picker-confirm')?.click();
      const result2 = await resultPromise2;
      expect(result2?.id).toBe('Test Point');
    });
  });

  describe('Issue 7: browser back button closes picker (navigation integration)', () => {
    let pushStateSpy: ReturnType<typeof vi.spyOn>;
    let backSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      pushStateSpy = vi.spyOn(history, 'pushState');
      backSpy = vi.spyOn(history, 'back').mockImplementation(() => {
        // jsdom doesn't fire popstate from history.back()
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Why: opening the picker must push a history state so the back button can close it
    it('should push modal history state when picker is shown', async () => {
      const resultPromise = showRefPointPicker();

      expect(pushStateSpy).toHaveBeenCalledOnce();
      expect(isModalStatePushed()).toBe(true);

      document.getElementById('ref-point-picker-cancel')?.click();
      await resultPromise;
    });

    // Why: confirm/cancel close must pop the history entry to keep history stack clean
    it('should pop modal history state when picker is confirmed', async () => {
      const resultPromise = showRefPointPicker();

      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Test Point';
      document.getElementById('ref-point-picker-confirm')?.click();

      await resultPromise;

      expect(backSpy).toHaveBeenCalledOnce();
      expect(isModalStatePushed()).toBe(false);
    });

    // Why: cancel should also pop the history entry
    it('should pop modal history state when picker is cancelled', async () => {
      const resultPromise = showRefPointPicker();

      document.getElementById('ref-point-picker-cancel')?.click();

      await resultPromise;

      expect(backSpy).toHaveBeenCalledOnce();
      expect(isModalStatePushed()).toBe(false);
    });

    // Why: clicking a suggestion auto-confirms, must also pop state
    // Why: browser back button should cancel the picker and resolve with null;
    // the handler must NOT call history.back() again (state already popped by browser)
    it('should cancel picker when popstate fires (simulating back button)', async () => {
      initModalNavigation(() => {
        // This callback should cancel the picker if it's visible
        if (isRefPointPickerVisible()) {
          cancelRefPointPicker();
        }
      });

      const resultPromise = showRefPointPicker();

      // Simulate browser back button
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      const result = await resultPromise;
      expect(result).toBeNull();
      // history.back() should NOT have been called since browser already popped
      expect(backSpy).not.toHaveBeenCalled();
      expect(isModalStatePushed()).toBe(false);
    });
  });

  // =========================================================================
  // Bug investigation: naming inconsistencies in 2026-03-08 recordings
  // =========================================================================
  describe('Bug investigation: ref point naming (2026-03-08)', () => {
    // Context: Cross-recording analysis showed that same-name ref points
    // are 100-500m apart while different-name points can be at the same
    // physical spot. User reports having to press OK multiple times in the
    // dialog. Tests below probe specific failure modes.

    it('should not leak typed value from a previous picker session into the next', async () => {
      // Why: If the input retains text from a previous session, the user
      // might press confirm thinking the input is empty or has their new
      // text, but the old text is still there.

      // Session 1: type a name and confirm
      const result1Promise = showRefPointPicker();
      let input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Old Name From Session 1';
      document.getElementById('ref-point-picker-confirm')?.click();
      const result1 = await result1Promise;
      expect(result1?.id).toBe('Old Name From Session 1');

      // Session 2: show picker again — input should be empty
      const result2Promise = showRefPointPicker();
      input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('');

      // Cancel session 2
      document.getElementById('ref-point-picker-cancel')?.click();
      await result2Promise;
    });

    it('should use current input value when confirm is clicked, not a stale reference', async () => {
      // Why: If handleConfirm reads from a stale DOM reference (old input
      // before cloneNode), it might read empty string instead of user's text.
      // This would explain "had to press OK multiple times" (empty → ignored).

      const resultPromise = showRefPointPicker();

      // Get the input that's actually in the DOM after setupEventListeners
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;

      // Simulate typing character by character (triggering input events)
      input.value = 'B';
      input.dispatchEvent(new Event('input'));
      input.value = 'Br';
      input.dispatchEvent(new Event('input'));
      input.value = 'Brücke';
      input.dispatchEvent(new Event('input'));

      // Now click confirm
      document.getElementById('ref-point-picker-confirm')?.click();

      const result = await resultPromise;
      expect(result?.id).toBe('Brücke');
    });

    it('should handle rapid 4-session sequence without cross-contamination', async () => {
      // Why: Simulates the actual recording scenario — 4 ref points marked
      // in quick succession. Each should get exactly the name the user typed.

      const expectedNames = [
        'Lärm Schild',
        'Bank',
        'Brücke links',
        'Eingang Pfad',
      ];

      for (let i = 0; i < expectedNames.length; i++) {
        const resultPromise = showRefPointPicker();

        const input = document.getElementById(
          'ref-point-picker-input'
        ) as HTMLInputElement;
        expect(input.value).toBe(''); // Must start empty

        input.value = expectedNames[i];
        input.dispatchEvent(new Event('input'));

        document.getElementById('ref-point-picker-confirm')?.click();

        const result = await resultPromise;
        expect(result?.id).toBe(expectedNames[i]);
      }
    });

    it('should correctly resolve when confirm is clicked, cancelled, then shown again', async () => {
      // Why: The "multiple OK presses" report — if first press resolves as
      // cancel (empty input), the user gets confused and tries again.
      // The next session must work correctly.

      // Session 1: show picker, press confirm with empty input (does nothing)
      const resultPromise1 = showRefPointPicker();
      let input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      expect(input.value).toBe('');

      // Click confirm with empty input — should NOT resolve
      document.getElementById('ref-point-picker-confirm')?.click();
      expect(isRefPointPickerVisible()).toBe(true); // Still open

      // Now cancel
      document.getElementById('ref-point-picker-cancel')?.click();
      const result1 = await resultPromise1;
      expect(result1).toBeNull();

      // Session 2: show picker again, type name, confirm
      const resultPromise2 = showRefPointPicker();
      input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;
      input.value = 'Beta';
      document.getElementById('ref-point-picker-confirm')?.click();
      const result2 = await resultPromise2;
      expect(result2?.id).toBe('Beta');
    });

    it('should handle the cloneNode input value correctly after setupEventListeners', async () => {
      // Why: setupEventListeners uses cloneNode(true) which clones the
      // HTML value attribute, NOT the JS .value property. If .value was set
      // before cloneNode but after the HTML attribute, the clone might
      // have an unexpected value.

      const resultPromise = showRefPointPicker();

      // After showRefPointPicker, setupEventListeners has already cloned
      // the input. Get the clone.
      const input = document.getElementById(
        'ref-point-picker-input'
      ) as HTMLInputElement;

      // Verify the clone starts with empty value
      expect(input.value).toBe('');
      expect(input.defaultValue).toBe('');

      // Type something
      input.value = 'Test Point';

      // Verify .value and .defaultValue diverge (as expected)
      expect(input.value).toBe('Test Point');
      // defaultValue should still be '' (unchanged by .value setter)
      expect(input.defaultValue).toBe('');

      // Confirm — should read .value, not .defaultValue
      document.getElementById('ref-point-picker-confirm')?.click();
      const result = await resultPromise;
      expect(result?.id).toBe('Test Point');
    });
  });
});
