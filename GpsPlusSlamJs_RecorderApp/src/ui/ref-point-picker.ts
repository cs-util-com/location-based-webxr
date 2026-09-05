/**
 * Reference Point Picker - a name prompt.
 *
 * Asks the user for a display name when a NEW reference point is marked.
 * That is the only thing it does: since the H3 migration the ref-point ID is
 * the cell the user stands in (`ref-point-handlers.ts`), and a re-observation
 * of a nearby point never opens this prompt - the handler resolves it by
 * proximity and marks it in one tap. Until 2026-09-04 this module also
 * carried a suggestion list (search filter, unused/used partition, click to
 * select); its only caller passed an empty list, so none of it could ever
 * show. Collapsed by owner decision (simplify loop, 2026-09-04 interview).
 *
 * Public API:
 * - showRefPointPicker(): Promise<RefPointPickerResult | null>
 * - cancelRefPointPicker(): void
 * - isRefPointPickerVisible(): boolean
 * - createRefPointPickerHtml(): string
 *
 * Invariants:
 * - Only one prompt can be pending at a time
 * - Result is null if the user cancels
 * - Empty names are not accepted; input is trimmed
 *
 * Tests: src/ui/ref-point-picker.test.ts
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { pushModalState, popModalState } from './navigation';

const log = createLogger('RefPointPicker');

/** Result of the prompt. */
export interface RefPointPickerResult {
  /** The display name the user entered (trimmed, non-empty). */
  id: string;
}

/** Promise resolver for the pending prompt, if any. */
let currentResolver: ((result: RefPointPickerResult | null) => void) | null =
  null;

/**
 * Generate the HTML content for the prompt modal.
 * This is called once to populate the modal container.
 */
export function createRefPointPickerHtml(): string {
  return `
    <div class="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
      <h2 class="text-xl font-bold mb-4 text-center text-white">
        Mark Reference Point
      </h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">
            Name
          </label>
          <input
            type="text"
            id="ref-point-picker-input"
            class="w-full bg-gray-700 text-white py-2 px-4 rounded-lg border border-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="e.g., Bench Corner, Fountain..."
            autocomplete="off"
          />
        </div>

        <div class="flex gap-3 mt-4">
          <button
            id="ref-point-picker-cancel"
            class="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            id="ref-point-picker-confirm"
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-all"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  `;
}

/** Is the prompt currently visible? */
export function isRefPointPickerVisible(): boolean {
  const modal = document.getElementById('ref-point-picker-modal');
  return modal !== null && !modal.classList.contains('hidden');
}

function hideRefPointPicker(): void {
  const modal = document.getElementById('ref-point-picker-modal');
  modal?.classList.add('hidden');
}

/**
 * Cancel the prompt from outside (e.g. the browser back button).
 * Resolves the pending promise with null and hides the modal.
 */
export function cancelRefPointPicker(): void {
  resolveWith(null);
}

function confirmButton(): HTMLButtonElement | null {
  return document.getElementById(
    'ref-point-picker-confirm'
  ) as HTMLButtonElement | null;
}

function nameInput(): HTMLInputElement | null {
  return document.getElementById(
    'ref-point-picker-input'
  ) as HTMLInputElement | null;
}

function handleConfirm(): void {
  // Ignore a second click: the button is disabled once the prompt resolved.
  if (confirmButton()?.disabled) {
    return;
  }
  const value = nameInput()?.value.trim() ?? '';
  if (!value) {
    return;
  }
  resolveWith({ id: value });
}

function handleCancel(): void {
  resolveWith(null);
}

/**
 * Resolve the pending promise and hide the modal. Disables the confirm
 * button so a stale tap after resolution does nothing.
 */
function resolveWith(result: RefPointPickerResult | null): void {
  const confirmBtn = confirmButton();
  if (confirmBtn) {
    confirmBtn.disabled = true;
  }

  hideRefPointPicker();

  // Pop the history entry pushed by showRefPointPicker.
  // No-op if the browser back button already popped it.
  popModalState();

  if (currentResolver) {
    currentResolver(result);
    currentResolver = null;
  }
}

/**
 * (Re)attach the button listeners. The buttons and the input are cloned to
 * drop listeners from a previous prompt - the simple way to make repeated
 * prompts independent of each other.
 */
function setupEventListeners(): void {
  const confirmBtn = document.getElementById('ref-point-picker-confirm');
  const cancelBtn = document.getElementById('ref-point-picker-cancel');
  const input = document.getElementById('ref-point-picker-input');

  if (confirmBtn) {
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode?.replaceChild(newConfirm, confirmBtn);
    newConfirm.addEventListener('click', handleConfirm);
  }

  if (cancelBtn) {
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode?.replaceChild(newCancel, cancelBtn);
    newCancel.addEventListener('click', handleCancel);
  }

  if (input) {
    const newInput = input.cloneNode(true) as HTMLInputElement;
    input.parentNode?.replaceChild(newInput, input);
    setTimeout(() => newInput.focus(), 50);
  }
}

/**
 * Show the name prompt and return what the user entered.
 *
 * @returns the trimmed name, or null if cancelled
 */
export function showRefPointPicker(): Promise<RefPointPickerResult | null> {
  return new Promise((resolve) => {
    // Defense in depth: if a previous resolver is still pending (e.g. due to
    // concurrent calls that bypassed the caller's guard), resolve it with null
    // to prevent orphaned promises. (2026-02-27 Issue 2 recurring fix)
    if (currentResolver) {
      log.warn('Overwriting pending resolver — resolving previous with null');
      const staleResolver = currentResolver;
      currentResolver = null;
      staleResolver(null);
    }
    currentResolver = resolve;

    const modal = document.getElementById('ref-point-picker-modal');
    if (!modal) {
      log.error(
        'Modal element not found. Ensure #ref-point-picker-modal exists in the DOM.'
      );
      resolve(null);
      return;
    }
    modal.classList.remove('hidden');

    // Push a history entry so the browser back button can close this modal
    pushModalState();

    const confirmBtn = confirmButton();
    if (confirmBtn) {
      confirmBtn.disabled = false;
    }
    const input = nameInput();
    if (input) {
      input.value = '';
    }

    setupEventListeners();
  });
}
