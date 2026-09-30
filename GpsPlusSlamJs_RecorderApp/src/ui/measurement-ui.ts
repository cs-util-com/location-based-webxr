/**
 * Measurement UI — coaching prompts, confirm button, undo, crosshair overlay.
 *
 * Subscribes to the Redux store and updates DOM elements that represent
 * the live measurement marking flow. All DOM manipulation is centralized
 * here — the rest of the measurement stack (handlers, slice, view) is
 * framework-free.
 *
 * The crosshair is a fixed center reticle. Tap events on the AR canvas
 * are normalized to [0, 1] screen coordinates and forwarded to
 * `handleShootRay(normX, normY)`.
 *
 * Phase 4 of the integration plan.
 */

import type { MeasurementPointHandlers } from '../measurement-points/measurement-point-handlers';
import {
  selectMeasurementDraft,
  selectPendingRays,
  DEFAULT_QUALITY_THRESHOLDS,
} from '../state/measurement-points-slice';
import type {
  CoachingPrompt,
  LiveMeasurementDraft,
} from '../utils/live-measurement-quality';
import { normalizePointerCoordinates } from '../utils/aiming-ray-capture';
import type { RecorderStore } from '../state/recorder-store';

// ---------------------------------------------------------------------------
// Coaching text map
// ---------------------------------------------------------------------------

const COACHING_TEXT: Record<CoachingPrompt, string> = {
  none: '',
  move_sideways: '↔ Move sideways for better parallax',
  add_more_rays: '⊕ Tap to add more observation rays',
  reaim_target: '🎯 Re-aim at the target point',
  ready_to_confirm: '✓ Ready — tap Confirm to save',
};

// ---------------------------------------------------------------------------
// DOM creation helpers
// ---------------------------------------------------------------------------

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL_STYLES = `
  position: fixed;
  bottom: 25%;
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 520px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 50;
  pointer-events: none;
`;

const COACHING_STYLES = `
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-family: 'Inter', 'Roboto', system-ui, sans-serif;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 20px;
  max-width: 100%;
  text-align: center;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
`;

const BUTTON_BASE_STYLES = `
  font-family: 'Inter', 'Roboto', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  padding: 10px 24px;
  cursor: pointer;
  pointer-events: auto;
  transition: opacity 0.2s, transform 0.1s;
`;

const CROSSHAIR_STYLES = `
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 66px;
  height: 66px;
  z-index: 50;
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.95));
`;

const UNCERTAINTY_STYLES = `
  background: rgba(0, 0, 0, 0.6);
  color: #aaa;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 10px;
`;

// ---------------------------------------------------------------------------
// MeasurementUI
// ---------------------------------------------------------------------------

export interface MeasurementUIOptions {
  /** The container element to append the UI to. */
  container: HTMLElement;
  /** The AR canvas element for tap events. */
  arCanvas: HTMLElement;
  /** Optional camera viewport in client coordinates; defaults to arCanvas. */
  getAimingViewport?: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  /** Measurement point handlers (for shoot/confirm/undo/delete). */
  handlers: MeasurementPointHandlers;
  /** Redux store. */
  store: RecorderStore;
  /** Current scenario ID for confirm. */
  getScenarioId: () => string;
  /**
   * Optional integrated confirm callback.
   * When provided, the Confirm button calls this instead of the
   * standalone handleConfirmPoint — allowing the caller to wire
   * in the ref-point creation + measurement persistence flow.
   */
  onConfirmIntegrated?: (
    confirmationMode: 'quality' | 'override'
  ) => Promise<void>;
}

export interface MeasurementUIInstance {
  /** Show the measurement UI panel. */
  show(): void;
  /** Hide the measurement UI panel. */
  hide(): void;
  /** Dispose of the UI and unsubscribe from the store. */
  dispose(): void;
}

/**
 * Create and mount the measurement UI.
 * Returns a handle to show/hide/dispose.
 */
export function createMeasurementUI(
  options: MeasurementUIOptions
): MeasurementUIInstance {
  const { container, arCanvas, handlers, store, getScenarioId } = options;

  // ── Crosshair ──
  const crosshair = createEl('div', { id: 'measurement-crosshair' });
  crosshair.setAttribute('style', CROSSHAIR_STYLES);
  crosshair.innerHTML = `
    <svg viewBox="0 0 66 66" width="66" height="66" aria-hidden="true">
      <circle cx="33" cy="33" r="30" fill="none" stroke="#00e5ff" stroke-width="2"/>
      <line x1="3" y1="33" x2="63" y2="33" stroke="#00e5ff" stroke-width="2"/>
      <line x1="33" y1="3" x2="33" y2="63" stroke="#00e5ff" stroke-width="2"/>
    </svg>
  `;

  // ── Panel (coaching + buttons) ──
  const panel = createEl('div', { id: 'measurement-panel' });
  panel.setAttribute('style', PANEL_STYLES);

  const coachingBanner = createEl('div', { id: 'measurement-coaching' });
  coachingBanner.setAttribute('style', COACHING_STYLES);

  const uncertaintyLabel = createEl('div', { id: 'measurement-uncertainty' });
  uncertaintyLabel.setAttribute('style', UNCERTAINTY_STYLES);

  const rayCountLabel = createEl('div', { id: 'measurement-ray-count' });
  rayCountLabel.setAttribute(
    'style',
    'color: #ff0000; font: 600 13px system-ui, sans-serif;'
  );

  const buttonRow = createEl('div');
  buttonRow.setAttribute(
    'style',
    'display: flex; gap: 8px; pointer-events: auto;'
  );

  const confirmBtn = createEl(
    'button',
    { id: 'measurement-confirm-btn' },
    '✓ Confirm'
  );
  confirmBtn.setAttribute(
    'style',
    `${BUTTON_BASE_STYLES} background: rgba(0, 150, 60, 0.55); color: #fff;`
  );
  confirmBtn.title =
    'Save anyway stores the estimate even when the quality gate is not ready.';

  const undoBtn = createEl(
    'button',
    { id: 'measurement-undo-btn' },
    '↩ Undo Ray'
  );
  undoBtn.setAttribute(
    'style',
    `${BUTTON_BASE_STYLES} background: rgba(255,255,255,0.15); color: #fff;`
  );

  let aimingMode: 'crosshair' | 'tap' = 'crosshair';
  const aimModeBtn = createEl(
    'button',
    { id: 'measurement-aim-mode-btn' },
    'Aiming mode: Crosshair'
  );
  aimModeBtn.setAttribute(
    'style',
    `${BUTTON_BASE_STYLES} background: rgba(0, 229, 255, 0.22); color: #fff;`
  );

  buttonRow.appendChild(aimModeBtn);
  buttonRow.appendChild(undoBtn);
  buttonRow.appendChild(confirmBtn);

  panel.appendChild(coachingBanner);
  panel.appendChild(rayCountLabel);
  panel.appendChild(uncertaintyLabel);
  panel.appendChild(buttonRow);

  container.appendChild(crosshair);
  container.appendChild(panel);

  // ── Tap handler (shoot ray) ──
  function handleTap(event: PointerEvent): void {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest('#measurement-panel') ||
        target.closest('button') ||
        target.closest('a'))
    ) {
      return;
    }

    if (aimingMode === 'crosshair') {
      handlers.handleShootRay(0.5, 0.5);
      return;
    }

    const rect =
      options.getAimingViewport?.() ?? arCanvas.getBoundingClientRect();
    const normalized = normalizePointerCoordinates(
      event.clientX,
      event.clientY,
      rect
    );
    if (!normalized) return;

    handlers.handleShootRay(normalized.screenX, normalized.screenY);
  }

  arCanvas.addEventListener('pointerdown', handleTap);

  aimModeBtn.addEventListener('click', () => {
    aimingMode = aimingMode === 'crosshair' ? 'tap' : 'crosshair';
    aimModeBtn.textContent =
      aimingMode === 'crosshair'
        ? 'Aiming mode: Crosshair'
        : 'Aiming mode: Tap';
    if (visible) {
      crosshair.style.display = aimingMode === 'crosshair' ? 'block' : 'none';
      updateUI();
    }
  });

  // ── Button handlers ──
  confirmBtn.addEventListener('click', () => {
    const confirmationMode = selectMeasurementDraft(store.getState()).canConfirm
      ? 'quality'
      : 'override';
    if (options.onConfirmIntegrated) {
      void options.onConfirmIntegrated(confirmationMode);
    } else {
      void handlers.handleConfirmPoint(getScenarioId(), confirmationMode);
    }
  });

  undoBtn.addEventListener('click', () => {
    handlers.handleUndoRay();
  });

  // ── Redux subscription ──
  let visible = false;
  let lastDraft: LiveMeasurementDraft | null = null;
  let lastRayCount = 0;

  function updateUncertainty(draft: LiveMeasurementDraft): void {
    if (
      draft.uncertainty !== undefined &&
      draft.status !== 'idle' &&
      draft.status !== 'confirmed'
    ) {
      uncertaintyLabel.textContent = `Error: ± ${(draft.uncertainty * 100).toFixed(1)} cm`;
      uncertaintyLabel.style.display = 'block';
    } else {
      uncertaintyLabel.style.display = 'none';
    }
  }

  // eslint-disable-next-line complexity
  function updateUI(): void {
    const state = store.getState();
    const draft = selectMeasurementDraft(state);
    const rays = selectPendingRays(state);
    const hasProvisionalPoint =
      draft.provisionalPointAr !== undefined && rays.length >= 1;

    // Skip redundant DOM updates
    if (draft === lastDraft && rays.length === lastRayCount) return;
    lastDraft = draft;
    lastRayCount = rays.length;

    // Coaching banner
    let text = COACHING_TEXT[draft.prompt];
    if (
      draft.prompt === 'add_more_rays' ||
      (draft.prompt === 'none' && rays.length === 0)
    ) {
      if (rays.length === 0) {
        text =
          aimingMode === 'crosshair'
            ? 'Tap anywhere to shoot observation ray through ⊕'
            : 'Tap anywhere to shoot observation ray at tap location';
      } else if (draft.prompt === 'add_more_rays') {
        text =
          aimingMode === 'crosshair'
            ? 'Tap anywhere to shoot observation ray through ⊕'
            : 'Tap anywhere to shoot observation ray at tap location';
      }
    }
    coachingBanner.textContent = text;
    coachingBanner.style.display = text ? 'block' : 'none';

    updateUncertainty(draft);

    const isUnderHardThreshold =
      draft.uncertainty !== undefined &&
      draft.uncertainty <= DEFAULT_QUALITY_THRESHOLDS.maxUncertaintyHard + 1e-4; // FP tolerance

    confirmBtn.disabled = !hasProvisionalPoint;
    if (draft.canConfirm || isUnderHardThreshold) {
      confirmBtn.textContent = '✓ Confirm';
    } else if (hasProvisionalPoint) {
      const thresholdText = `threshold ± ${(DEFAULT_QUALITY_THRESHOLDS.maxUncertaintyHard * 100).toFixed(1)} cm`;
      confirmBtn.textContent = `⚠ Save anyway (${thresholdText})`;
    } else {
      confirmBtn.textContent = '✓ Confirm';
    }
    confirmBtn.style.opacity = hasProvisionalPoint ? '1' : '1';
    confirmBtn.style.display = hasProvisionalPoint ? 'inline-block' : 'none';

    rayCountLabel.textContent = `${rays.length} observation ray${rays.length === 1 ? '' : 's'}`;
    undoBtn.disabled = rays.length === 0 || draft.status === 'confirm_pending';
    undoBtn.style.opacity = undoBtn.disabled ? '0.4' : '1';
    undoBtn.style.display = rays.length === 0 ? 'none' : 'inline-block';

    // Keep aiming controls visible whenever the measurement UI is active,
    // including before the first ray and after a confirmed save.
    panel.style.display = visible ? 'flex' : 'none';
  }

  const unsubscribe = store.subscribe(updateUI);
  // Initial render
  updateUI();

  // ── Public API ──
  return {
    show() {
      visible = true;
      crosshair.style.display = aimingMode === 'crosshair' ? 'block' : 'none';
      // Visibility is not part of the Redux render cache. Force one update
      // when the UI is shown after construction or a recording swap.
      lastDraft = null;
      updateUI();
    },
    hide() {
      visible = false;
      crosshair.style.display = 'none';
      panel.style.display = 'none';
    },
    dispose() {
      unsubscribe();
      arCanvas.removeEventListener('pointerdown', handleTap);
      crosshair.remove();
      panel.remove();
    },
  };
}
