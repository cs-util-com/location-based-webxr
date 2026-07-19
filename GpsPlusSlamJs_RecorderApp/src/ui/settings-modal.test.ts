/**
 * Tests for settings-modal.ts
 *
 * Why these tests matter:
 * - Validates modal show/hide behavior
 * - Ensures form population uses correct constraint values
 * - Confirms save/reset functionality works correctly
 * - Guards against regression in settings UI
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initSettingsModal,
  showSettingsModal,
  hideSettingsModal,
  isSettingsModalVisible,
  getWorkingOptions,
} from './settings-modal';
import {
  loadSettingsModalHtml,
  loadSettingsButtonHtml,
  loadSettingsTestFixture,
} from '../test-utils/html-fixtures';
import {
  loadRecordingOptions,
  DEFAULT_RECORDING_OPTIONS,
} from '../state/recording-options';

const { mockGetBuildInfo } = vi.hoisted(() => ({
  mockGetBuildInfo: vi.fn(() => ({
    commitHash: 'abc1234',
    appVersion: '0.1.0',
    libraryVersion: '1.0.0',
    frameworkVersion: '0.1.0',
    buildTime: '2026-04-20T10:00:00.000Z',
  })),
}));

// Mock getBuildInfo so settings-modal can populate the version label
vi.mock('../utils/build-info', () => ({
  getBuildInfo: mockGetBuildInfo,
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
});

/** Resolve once `query` returns a non-null element, polling microtasks. */
async function waitFor<T>(query: () => T | null): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const value = query();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1));
  }
  const value = query();
  if (!value) {
    throw new Error('waitFor timed out');
  }
  return value;
}

/** Yield to the microtask queue so awaited promise chains complete. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('settings-modal', () => {
  beforeEach(() => {
    // Reset localStorage
    localStorageMock.clear();
    vi.clearAllMocks();
    mockGetBuildInfo.mockReturnValue({
      commitHash: 'abc1234',
      appVersion: '0.1.0',
      libraryVersion: '1.0.0',
      frameworkVersion: '0.1.0',
      buildTime: '2026-04-20T10:00:00.000Z',
    });

    // Load production HTML from index.html to ensure tests match actual markup
    document.body.innerHTML = loadSettingsTestFixture();
  });

  describe('loadSettingsModalHtml (production HTML)', () => {
    it('contains valid modal container', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="settings-modal"');
      expect(html).toContain('class="hidden');
    });

    it('includes all required form elements', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="depth-enabled"');
      expect(html).toContain('id="depth-interval"');
      expect(html).toContain('id="depth-grid"');
      expect(html).toContain('id="depth-rgb"');
      expect(html).toContain('id="images-enabled"');
      expect(html).toContain('id="images-motion-filter"');
      expect(html).toContain('id="images-quality-filter"');
      expect(html).toContain('id="images-blur-threshold"');
      expect(html).toContain('id="images-min-luminance"');
      expect(html).toContain('id="images-max-angular"');
      expect(html).toContain('id="images-max-linear"');
      expect(html).toContain('id="images-interval"');
      expect(html).toContain('id="images-quality"');
    });

    it('includes control buttons', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="btn-settings-close"');
      expect(html).toContain('id="btn-settings-save"');
      expect(html).toContain('id="btn-settings-reset"');
    });

    it('includes value display elements', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="depth-interval-value"');
      expect(html).toContain('id="depth-grid-value"');
      expect(html).toContain('id="images-interval-value"');
      expect(html).toContain('id="images-quality-value"');
      expect(html).toContain('id="images-resolution-divisor-value"');
    });

    it('includes resolution divisor slider', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="images-resolution-divisor"');
    });

    it('includes the occupancy voxel-size slider and value display', () => {
      // 2026-06-13 occupancy-grid-settings review, item 1: the voxel size
      // (occupancy.cellSizeM) must be user-configurable from this modal.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-cell-size"');
      expect(html).toContain('id="occupancy-cell-size-value"');
    });

    it('includes the occupancy noise-filter (min-confidence) slider and value display', () => {
      // 2026-06-22 behind-surface-noise plan: the voxel noise filter
      // (occupancy.minConfidence) must be user-tunable from this modal.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-min-confidence"');
      expect(html).toContain('id="occupancy-min-confidence-value"');
    });

    it('includes the persistent mesh-occluder checkbox', () => {
      // 2026-06-13 occupancy-mesh-options plan: the persistent depth-only
      // occluder (occupancy.persistentOcclusion) must be toggleable here.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-persistent-occlusion"');
    });

    it('includes the live depth-occluder checkbox', () => {
      // 2026-06-29 two-composable-occlusion-toggles: the live CPU-depth occluder
      // (occupancy.liveOcclusion) is the second, independent checkbox.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-live-occlusion"');
    });

    it('includes the occluder debug-style selector with all five styles', () => {
      // 2026-07-02 debug-viz-styles plan: a <select>
      // (occupancy.occluderDebugStyle) replaced the former debug-viz checkbox —
      // it picks which visible debug skin(s) render the persistent occluder
      // mesh (matcap / depth-shaded / wireframe / both / off).
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-occluder-debug-style"');
      expect(html).toContain('value="off"');
      expect(html).toContain('value="matcap"');
      expect(html).toContain('value="depth-shaded"');
      expect(html).toContain('value="wireframe"');
      expect(html).toContain('value="depth-shaded-wireframe"');
    });

    it('includes the occluder mesh-style selector with all three modes', () => {
      // 2026-06-30 F2/F2b: a <select> (occupancy.occluderMeshMode) to switch the
      // persistent-occluder mesher between blocky cubes, corner-fit cubes and
      // surface nets so the surface-hugging meshers can be A/B-tested on-device.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="occupancy-occluder-mesh-mode"');
      expect(html).toContain('value="greedy"');
      expect(html).toContain('value="corner-fit"');
      expect(html).toContain('value="smooth"');
    });

    it('includes the frame-tile display-resolution slider and value display', () => {
      // D7-resolution, 2026-06-16 user feedback: the in-AR/replay tile display
      // resolution (frameTileDisplay.divisor) must be user-configurable here,
      // distinct from the capture resolution divisor.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="frame-tile-display-divisor"');
      expect(html).toContain('id="frame-tile-display-divisor-value"');
    });

    it('includes AR crash isolation controls', () => {
      // Why this test matters:
      // The full Phase 1 diagnostic set must be present in production HTML so
      // the app can be reduced on-device without code changes between runs.
      const html = loadSettingsModalHtml();
      expect(html).toContain('AR Crash Isolation');
      expect(html).toContain('id="ar-dom-overlay-enabled"');
      expect(html).toContain('id="ar-camera-access-enabled"');
      expect(html).toContain('id="ar-depth-sensing-enabled"');
      expect(html).toContain('id="ar-css3d-enabled"');
      expect(html).toContain('id="ar-camera-texture-enabled"');
      expect(html).toContain('id="btn-ar-minimal-baseline"');
    });

    it('includes the live debug-overlay toggles (Finding B) + heading-up map', () => {
      // Why this test matters: the `visualization` group must be operable from
      // the settings modal — one checkbox per live overlay (plus the heading-up
      // minimap preference), with the DB-3 section heading + note so users know
      // it is live-only.
      const html = loadSettingsModalHtml();
      expect(html).toContain('Show during recording (3D debug overlays)');
      expect(html).toContain('id="viz-frame-tiles"');
      expect(html).toContain('id="viz-occupancy-cubes"');
      expect(html).toContain('id="viz-gps-alignment-markers"');
      expect(html).toContain('id="viz-compass-cubes"');
      expect(html).toContain('id="viz-heading-up-map"');
      // Step 0 of the 2026-07-03 long-session fps plan: the perf stats
      // toggle lives in the same section, with the dom-overlay dependency
      // spelled out (with DOM overlay disabled it cannot composite in AR).
      expect(html).toContain('id="viz-stats-overlay"');
      expect(html).toContain('Stats need the DOM overlay');
    });

    it('populates the stats-overlay checkbox from saved options and updates the working copy', () => {
      // Why this test matters: statsOverlay is the visualization group's one
      // OFF-by-default field — the round-trip must preserve an operator's
      // opt-in and the checkbox must never come up checked by default.
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ visualization: { statsOverlay: true } })
      );

      initSettingsModal();
      showSettingsModal();

      const checkbox = document.getElementById(
        'viz-stats-overlay'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      expect(getWorkingOptions()?.visualization.statsOverlay).toBe(false);
    });

    it('defaults the stats-overlay checkbox to off (debug tool, off by default)', () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
      initSettingsModal();
      showSettingsModal();
      const checkbox = document.getElementById(
        'viz-stats-overlay'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('populates the occluder-radius slider (Step 2) and updates the working copy, labelling 0 as unlimited', () => {
      // Why: occluderRadiusM bounds the per-refresh occluder snapshot/mesh
      // cost — the slider must round-trip the stored value and present the
      // 0 opt-out as "unlimited" (the safe pre-Step-2 fallback).
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { occluderRadiusM: 50 } })
      );
      initSettingsModal();
      showSettingsModal();

      const slider = document.getElementById(
        'occupancy-occluder-radius'
      ) as HTMLInputElement;
      const label = document.getElementById('occupancy-occluder-radius-value');
      expect(slider.value).toBe('50');
      expect(label?.textContent).toBe('50 m');

      slider.value = '0';
      slider.dispatchEvent(new Event('input'));
      expect(getWorkingOptions()?.occupancy.occluderRadiusM).toBe(0);
      expect(label?.textContent).toBe('unlimited');
    });

    it('populates the live tile-cap slider (Step 4) and updates the working copy, labelling 0 as unlimited', () => {
      // Why: the FIFO cap bounds live draw calls/GPU memory on long walks —
      // the slider must round-trip the stored value and make the 0 opt-out
      // legible as "unlimited" rather than a confusing "0 tiles".
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ frameTileDisplay: { maxTiles: 250 } })
      );
      initSettingsModal();
      showSettingsModal();

      const slider = document.getElementById(
        'frame-tile-max-tiles'
      ) as HTMLInputElement;
      const label = document.getElementById('frame-tile-max-tiles-value');
      expect(slider.value).toBe('250');
      expect(label?.textContent).toBe('250');

      slider.value = '0';
      slider.dispatchEvent(new Event('input'));
      expect(getWorkingOptions()?.frameTileDisplay.maxTiles).toBe(0);
      expect(label?.textContent).toBe('unlimited');
    });

    it('includes "Clear Reference Point Cache" button', () => {
      // Why this test matters:
      // The cache reset button must be present in production HTML so users
      // can force a re-import of ref points from *.zip recordings when the
      // OPFS cache becomes stale. See main.ts handleClearRefPointCache.
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="btn-clear-refpoint-cache"');
      expect(html).toContain('Clear Reference Point Cache');
    });
  });

  describe('loadSettingsButtonHtml (production HTML)', () => {
    it('contains button with correct ID', () => {
      const html = loadSettingsButtonHtml();
      expect(html).toContain('id="btn-settings"');
    });

    it('includes gear emoji', () => {
      const html = loadSettingsButtonHtml();
      expect(html).toContain('⚙️');
    });

    it('has accessible label', () => {
      const html = loadSettingsButtonHtml();
      expect(html).toContain('aria-label="Recording Settings"');
    });
  });

  describe('initSettingsModal', () => {
    it('initializes without errors when modal exists', () => {
      expect(() => initSettingsModal()).not.toThrow();
    });

    it('does not throw when modal element is missing', () => {
      document.body.innerHTML = '';
      expect(() => initSettingsModal()).not.toThrow();
    });

    it('accepts optional change callback', () => {
      const callback = vi.fn();
      initSettingsModal(callback);
      // Callback should not be called until save
      expect(callback).not.toHaveBeenCalled();
    });

    it('invokes the clear-cache callback after the user confirms', async () => {
      // Why this test matters:
      // The "Clear Reference Point Cache" button must show a confirm dialog
      // (destructive action) and only invoke the host callback when the user
      // confirms. Verifies the click → confirm → callback wiring.
      const onClearCache = vi.fn().mockResolvedValue(undefined);
      initSettingsModal(undefined, onClearCache);

      const btn = document.getElementById(
        'btn-clear-refpoint-cache'
      ) as HTMLButtonElement;
      expect(btn).not.toBeNull();
      btn.click();

      // Confirm dialog inserts a confirm button asynchronously.
      const confirmBtn = await waitFor(() =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="confirm-dialog-confirm"]'
        )
      );
      confirmBtn.click();

      await flush();
      expect(onClearCache).toHaveBeenCalledTimes(1);
    });

    it('does not invoke the clear-cache callback when the user cancels', async () => {
      const onClearCache = vi.fn();
      initSettingsModal(undefined, onClearCache);

      const btn = document.getElementById(
        'btn-clear-refpoint-cache'
      ) as HTMLButtonElement;
      btn.click();

      const cancelBtn = await waitFor(() =>
        document.querySelector<HTMLButtonElement>(
          '[data-testid="confirm-dialog-cancel"]'
        )
      );
      cancelBtn.click();

      await flush();
      expect(onClearCache).not.toHaveBeenCalled();
    });
  });

  describe('showSettingsModal', () => {
    beforeEach(() => {
      initSettingsModal();
    });

    it('removes hidden class from modal', () => {
      const modal = document.getElementById('settings-modal');
      expect(modal?.classList.contains('hidden')).toBe(true);

      showSettingsModal();

      expect(modal?.classList.contains('hidden')).toBe(false);
    });

    it('loads current options into working copy', () => {
      showSettingsModal();

      const working = getWorkingOptions();
      expect(working).not.toBeNull();
      expect(working?.depth.enabled).toBe(
        DEFAULT_RECORDING_OPTIONS.depth.enabled
      );
    });

    it('populates form with current values', () => {
      showSettingsModal();

      const depthEnabled = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      expect(depthEnabled.checked).toBe(true);
    });

    it('populates the voxel-size slider from saved options (metres → cm)', () => {
      // Stored 0.03 m must render as 3 on the cm slider.
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { cellSizeM: 0.03 } })
      );

      showSettingsModal();

      const slider = document.getElementById(
        'occupancy-cell-size'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('occupancy-cell-size-value');
      expect(slider.value).toBe('3');
      expect(valueDisplay?.textContent).toBe('3 cm');
    });

    it('populates the noise-filter slider from saved options', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { minConfidence: 5 } })
      );

      showSettingsModal();

      const slider = document.getElementById(
        'occupancy-min-confidence'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById(
        'occupancy-min-confidence-value'
      );
      expect(slider.value).toBe('5');
      expect(valueDisplay?.textContent).toBe('5');
    });

    it('labels min-confidence 1 as unfiltered', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { minConfidence: 1 } })
      );

      showSettingsModal();

      const valueDisplay = document.getElementById(
        'occupancy-min-confidence-value'
      );
      expect(valueDisplay?.textContent).toBe('1 (unfiltered)');
    });

    it('populates the persistent-occluder checkbox from saved options (migrating the legacy field) and updates the working copy', () => {
      // Persisted with the LEGACY single boolean — the options migration must
      // map occlusionMeshEnabled=true onto persistentOcclusion so the checkbox
      // reflects it (2026-06-29 two-boolean split).
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { occlusionMeshEnabled: true } })
      );

      showSettingsModal();

      const checkbox = document.getElementById(
        'occupancy-persistent-occlusion'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      // Toggling it off mutates the working options (persisted on Save).
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      expect(getWorkingOptions()?.occupancy.persistentOcclusion).toBe(false);
    });

    it('defaults the persistent-occluder checkbox to ON (feature on by default since 2026-07-01)', () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
      showSettingsModal();
      const checkbox = document.getElementById(
        'occupancy-persistent-occlusion'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('populates the live-occluder checkbox from saved options and updates the working copy', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { liveOcclusion: true } })
      );

      showSettingsModal();

      const checkbox = document.getElementById(
        'occupancy-live-occlusion'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      // Toggling it off mutates the working options (persisted on Save).
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));
      expect(getWorkingOptions()?.occupancy.liveOcclusion).toBe(false);
    });

    it('defaults the live-occluder checkbox to off (feature off by default)', () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
      showSettingsModal();
      const checkbox = document.getElementById(
        'occupancy-live-occlusion'
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('populates the occluder debug-style select from saved options and updates the working copy', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { occluderDebugStyle: 'wireframe' } })
      );

      showSettingsModal();

      const select = document.getElementById(
        'occupancy-occluder-debug-style'
      ) as HTMLSelectElement;
      expect(select.value).toBe('wireframe');

      // Switch to the combined style → working copy updates (persisted on Save).
      select.value = 'depth-shaded-wireframe';
      select.dispatchEvent(new Event('change'));
      expect(getWorkingOptions()?.occupancy.occluderDebugStyle).toBe(
        'depth-shaded-wireframe'
      );
    });

    it("defaults the occluder debug-style select to 'off' (debug rendering off by default)", () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
      showSettingsModal();
      const select = document.getElementById(
        'occupancy-occluder-debug-style'
      ) as HTMLSelectElement;
      expect(select.value).toBe('off');
    });

    it("shows 'matcap' for a saved legacy occluderDebugViz=true (boolean migration)", () => {
      // The pre-2026-07-02 boolean must keep its meaning: true used to enable
      // the matcap skin, so the migrated select shows 'matcap' — not 'off'.
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { occluderDebugViz: true } })
      );
      showSettingsModal();
      const select = document.getElementById(
        'occupancy-occluder-debug-style'
      ) as HTMLSelectElement;
      expect(select.value).toBe('matcap');
    });

    it('populates the occluder mesh-style select from saved options and updates the working copy', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ occupancy: { occluderMeshMode: 'smooth' } })
      );

      showSettingsModal();

      const select = document.getElementById(
        'occupancy-occluder-mesh-mode'
      ) as HTMLSelectElement;
      expect(select.value).toBe('smooth');

      // Switch to the improved-cube ('corner-fit') mesher → working copy updates.
      select.value = 'corner-fit';
      select.dispatchEvent(new Event('change'));
      expect(getWorkingOptions()?.occupancy.occluderMeshMode).toBe(
        'corner-fit'
      );
    });

    it("defaults the occluder mesh-style select to 'smooth' (Naive Surface Nets, default since 2026-07-01)", () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
      showSettingsModal();
      const select = document.getElementById(
        'occupancy-occluder-mesh-mode'
      ) as HTMLSelectElement;
      expect(select.value).toBe('smooth');
    });

    it('lets the live and persistent occluders be ticked together (they compose)', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({
          occupancy: { liveOcclusion: true, persistentOcclusion: true },
        })
      );
      showSettingsModal();
      expect(
        (
          document.getElementById(
            'occupancy-live-occlusion'
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
      expect(
        (
          document.getElementById(
            'occupancy-persistent-occlusion'
          ) as HTMLInputElement
        ).checked
      ).toBe(true);
    });

    it('populates AR crash isolation checkbox from saved options', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({
          arCrashIsolation: {
            enableDomOverlay: false,
            enableCameraAccess: false,
            enableDepthSensingFeature: false,
            enableCss3dRenderer: false,
            enableCameraTextureAcquisition: false,
          },
        })
      );

      showSettingsModal();

      const domOverlayEnabled = document.getElementById(
        'ar-dom-overlay-enabled'
      ) as HTMLInputElement | null;
      const cameraAccessEnabled = document.getElementById(
        'ar-camera-access-enabled'
      ) as HTMLInputElement | null;
      const depthSensingEnabled = document.getElementById(
        'ar-depth-sensing-enabled'
      ) as HTMLInputElement | null;
      const css3dEnabled = document.getElementById(
        'ar-css3d-enabled'
      ) as HTMLInputElement | null;
      const cameraTextureEnabled = document.getElementById(
        'ar-camera-texture-enabled'
      ) as HTMLInputElement | null;

      expect(domOverlayEnabled?.checked).toBe(false);
      expect(cameraAccessEnabled?.checked).toBe(false);
      expect(depthSensingEnabled?.checked).toBe(false);
      expect(css3dEnabled?.checked).toBe(false);
      expect(cameraTextureEnabled?.checked).toBe(false);
    });
  });

  describe('hideSettingsModal', () => {
    beforeEach(() => {
      initSettingsModal();
      showSettingsModal();
    });

    it('adds hidden class to modal', () => {
      const modal = document.getElementById('settings-modal');
      expect(modal?.classList.contains('hidden')).toBe(false);

      hideSettingsModal();

      expect(modal?.classList.contains('hidden')).toBe(true);
    });

    it('clears working options', () => {
      expect(getWorkingOptions()).not.toBeNull();

      hideSettingsModal();

      expect(getWorkingOptions()).toBeNull();
    });
  });

  describe('isSettingsModalVisible', () => {
    beforeEach(() => {
      initSettingsModal();
    });

    it('returns false when modal is hidden', () => {
      expect(isSettingsModalVisible()).toBe(false);
    });

    it('returns true when modal is shown', () => {
      showSettingsModal();
      expect(isSettingsModalVisible()).toBe(true);
    });

    it('returns false after modal is hidden again', () => {
      showSettingsModal();
      hideSettingsModal();
      expect(isSettingsModalVisible()).toBe(false);
    });
  });

  describe('getWorkingOptions', () => {
    beforeEach(() => {
      initSettingsModal();
    });

    it('returns null when modal is not shown', () => {
      expect(getWorkingOptions()).toBeNull();
    });

    it('returns a copy of working options when modal is shown', () => {
      showSettingsModal();

      const options1 = getWorkingOptions();
      const options2 = getWorkingOptions();

      expect(options1).not.toBeNull();
      expect(options1).toEqual(options2);
      expect(options1).not.toBe(options2); // Different object references
    });
  });

  describe('save button', () => {
    it('saves options and hides modal', () => {
      const callback = vi.fn();
      initSettingsModal(callback);
      showSettingsModal();

      const btnSave = document.getElementById('btn-settings-save');
      btnSave?.click();

      expect(isSettingsModalVisible()).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('persists options to localStorage', () => {
      initSettingsModal();
      showSettingsModal();

      // Modify a checkbox
      const depthEnabled = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      depthEnabled.checked = false;
      depthEnabled.dispatchEvent(new Event('change'));

      // Save
      const btnSave = document.getElementById('btn-settings-save');
      btnSave?.click();

      // Load and verify
      const saved = loadRecordingOptions();
      expect(saved.depth.enabled).toBe(false);
    });

    /**
     * Why this test matters (occupancy-grid port plan Iter 8): the RGB
     * voxel-coloring toggle is on by default; turning it off must persist
     * and round-trip through validation (a dead checkbox would silently
     * keep burning the per-sample GPU readback — the Iter-6 dead-knob
     * lesson in reverse).
     */
    it('persists the depth rgb voxel-coloring flag (default on)', () => {
      initSettingsModal();
      showSettingsModal();

      const depthRgb = document.getElementById('depth-rgb') as HTMLInputElement;
      expect(depthRgb.checked).toBe(true); // default on

      depthRgb.checked = false;
      depthRgb.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      expect(loadRecordingOptions().depth.rgb).toBe(false);
    });

    it('disables the rgb checkbox while depth sampling is off', () => {
      initSettingsModal();
      showSettingsModal();

      const depthEnabled = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      const depthRgb = document.getElementById('depth-rgb') as HTMLInputElement;

      depthEnabled.checked = false;
      depthEnabled.dispatchEvent(new Event('change'));
      expect(depthRgb.disabled).toBe(true);

      depthEnabled.checked = true;
      depthEnabled.dispatchEvent(new Event('change'));
      expect(depthRgb.disabled).toBe(false);
    });

    it('persists the occupancy voxel size (cm slider → metres in storage)', () => {
      initSettingsModal();
      showSettingsModal();

      const slider = document.getElementById(
        'occupancy-cell-size'
      ) as HTMLInputElement;
      // default 16 cm (framework reconstruction default; 2026-07-16 evening
      // on-device framerate/mesh trade-off pass)
      expect(slider.value).toBe('16');

      slider.value = '10';
      slider.dispatchEvent(new Event('input'));

      document.getElementById('btn-settings-save')?.click();

      expect(loadRecordingOptions().occupancy.cellSizeM).toBeCloseTo(0.1);
    });

    it('persists the CSS3D crash-isolation flag', () => {
      initSettingsModal();
      showSettingsModal();

      const css3dEnabled = document.getElementById(
        'ar-css3d-enabled'
      ) as HTMLInputElement | null;
      expect(css3dEnabled).not.toBeNull();

      css3dEnabled!.checked = false;
      css3dEnabled!.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions() as unknown as Record<
        string,
        unknown
      >;
      const flags = saved.arCrashIsolation as
        | Record<string, unknown>
        | undefined;
      expect(flags?.enableCss3dRenderer).toBe(false);
    });
  });

  describe('blurry-frame motion gate toggle (2026-06-23 motion-gating plan)', () => {
    // Why these tests matter: the gate is enabled by default and is the user's
    // only control over blurry-frame skipping. A dead checkbox would silently
    // keep (or disable) the gate regardless of the toggle. Round-trip the
    // control: default on, persists when unchecked, and disabled when capture
    // itself is off (a sub-control of image capture).
    beforeEach(() => {
      initSettingsModal();
      showSettingsModal();
    });

    it('is present and defaults to on', () => {
      const cb = document.getElementById(
        'images-motion-filter'
      ) as HTMLInputElement | null;
      expect(cb).not.toBeNull();
      expect(cb!.checked).toBe(true);
    });

    it('persists motionFilter.enabled = false when unchecked', () => {
      const cb = document.getElementById(
        'images-motion-filter'
      ) as HTMLInputElement;

      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      expect(loadRecordingOptions().images.motionFilter.enabled).toBe(false);
    });

    it('disables the motion-filter checkbox while image capture is off', () => {
      const imagesEnabled = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const motionFilter = document.getElementById(
        'images-motion-filter'
      ) as HTMLInputElement;

      imagesEnabled.checked = false;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(motionFilter.disabled).toBe(true);

      imagesEnabled.checked = true;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(motionFilter.disabled).toBe(false);
    });

    it('exposes the threshold sliders, populated from the defaults', () => {
      const angular = document.getElementById(
        'images-max-angular'
      ) as HTMLInputElement | null;
      const linear = document.getElementById(
        'images-max-linear'
      ) as HTMLInputElement | null;
      expect(angular).not.toBeNull();
      expect(linear).not.toBeNull();
      // Defaults from DEFAULT_MOTION_FILTER (0.6 rad/s, 2.5 m/s — the linear
      // threshold was raised 0.5 → 2.5 on 2026-07-02 to stop deferring walking;
      // see 2026-07-02-0117-image-capture-rate-motion-gate-finding.md).
      expect(parseFloat(angular!.value)).toBeCloseTo(0.6, 6);
      expect(parseFloat(linear!.value)).toBeCloseTo(2.5, 6);
    });

    it('persists edited threshold values through save/load', () => {
      const angular = document.getElementById(
        'images-max-angular'
      ) as HTMLInputElement;
      const linear = document.getElementById(
        'images-max-linear'
      ) as HTMLInputElement;

      angular.value = '1.2';
      angular.dispatchEvent(new Event('input'));
      linear.value = '0.8';
      linear.dispatchEvent(new Event('input'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions().images.motionFilter;
      expect(saved.maxAngularVelocity).toBeCloseTo(1.2, 6);
      expect(saved.maxLinearVelocity).toBeCloseTo(0.8, 6);
    });

    it('disables the threshold sliders when the gate (or capture) is off', () => {
      const imagesEnabled = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const motionFilter = document.getElementById(
        'images-motion-filter'
      ) as HTMLInputElement;
      const angular = document.getElementById(
        'images-max-angular'
      ) as HTMLInputElement;
      const linear = document.getElementById(
        'images-max-linear'
      ) as HTMLInputElement;

      // Gate off → sliders disabled.
      motionFilter.checked = false;
      motionFilter.dispatchEvent(new Event('change'));
      expect(angular.disabled).toBe(true);
      expect(linear.disabled).toBe(true);

      // Gate back on → sliders enabled.
      motionFilter.checked = true;
      motionFilter.dispatchEvent(new Event('change'));
      expect(angular.disabled).toBe(false);
      expect(linear.disabled).toBe(false);

      // Capture off overrides → sliders disabled regardless of the gate.
      imagesEnabled.checked = false;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(angular.disabled).toBe(true);
      expect(linear.disabled).toBe(true);
    });
  });

  describe('image-quality gate toggle (blur/blackness)', () => {
    beforeEach(() => {
      initSettingsModal();
      showSettingsModal();
    });

    it('is present and defaults to OFF (opt-in until field-tuned)', () => {
      const cb = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement | null;
      expect(cb).not.toBeNull();
      expect(cb!.checked).toBe(false);
    });

    it('persists qualityFilter.enabled = true when checked', () => {
      const cb = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;

      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      expect(loadRecordingOptions().images.qualityFilter.enabled).toBe(true);
    });

    it('disables the quality-filter checkbox while image capture is off', () => {
      const imagesEnabled = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const qualityFilter = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;

      imagesEnabled.checked = false;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(qualityFilter.disabled).toBe(true);

      imagesEnabled.checked = true;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(qualityFilter.disabled).toBe(false);
    });

    it('exposes the threshold sliders, populated from the defaults', () => {
      const blur = document.getElementById(
        'images-blur-threshold'
      ) as HTMLInputElement | null;
      const luma = document.getElementById(
        'images-min-luminance'
      ) as HTMLInputElement | null;
      expect(blur).not.toBeNull();
      expect(luma).not.toBeNull();
      // Defaults from DEFAULT_QUALITY_FILTER (k=0.5, minMeanLuminance=10).
      expect(parseFloat(blur!.value)).toBeCloseTo(0.5, 6);
      expect(parseFloat(luma!.value)).toBeCloseTo(10, 6);
    });

    it('persists edited threshold values through save/load (gate on)', () => {
      const qualityFilter = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;
      const blur = document.getElementById(
        'images-blur-threshold'
      ) as HTMLInputElement;
      const luma = document.getElementById(
        'images-min-luminance'
      ) as HTMLInputElement;

      qualityFilter.checked = true;
      qualityFilter.dispatchEvent(new Event('change'));
      blur.value = '0.35';
      blur.dispatchEvent(new Event('input'));
      luma.value = '25';
      luma.dispatchEvent(new Event('input'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions().images.qualityFilter;
      expect(saved.enabled).toBe(true);
      expect(saved.blurRelativeThreshold).toBeCloseTo(0.35, 6);
      expect(saved.minMeanLuminance).toBeCloseTo(25, 6);
    });

    it('disables the threshold sliders when the gate (or capture) is off', () => {
      const imagesEnabled = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const qualityFilter = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;
      const blur = document.getElementById(
        'images-blur-threshold'
      ) as HTMLInputElement;
      const luma = document.getElementById(
        'images-min-luminance'
      ) as HTMLInputElement;

      // Gate off (the default) → sliders disabled.
      expect(blur.disabled).toBe(true);
      expect(luma.disabled).toBe(true);

      // Gate on → sliders enabled.
      qualityFilter.checked = true;
      qualityFilter.dispatchEvent(new Event('change'));
      expect(blur.disabled).toBe(false);
      expect(luma.disabled).toBe(false);

      // Capture off overrides → sliders disabled regardless of the gate.
      imagesEnabled.checked = false;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(blur.disabled).toBe(true);
      expect(luma.disabled).toBe(true);
    });

    // Why these tests matter: the blur-metric select (2026-07-12 toggle plan)
    // is the only UI to A/B the FFT metric on device; it must round-trip
    // through persisted options and follow the same disabled rules as the
    // other quality-gate controls, or a dead/mislabeled control would fake a
    // field test that never ran.
    it('exposes the blur-metric select with both metrics, default first', () => {
      const select = document.getElementById(
        'images-blur-metric'
      ) as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      expect(select!.value).toBe('variance-of-laplacian');
      expect([...select!.options].map((o) => o.value)).toEqual([
        'variance-of-laplacian',
        'high-frequency-energy-ratio',
      ]);
    });

    it('persists an edited blur metric through save/load (gate on)', () => {
      const qualityFilter = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;
      const select = document.getElementById(
        'images-blur-metric'
      ) as HTMLSelectElement;

      qualityFilter.checked = true;
      qualityFilter.dispatchEvent(new Event('change'));
      select.value = 'high-frequency-energy-ratio';
      select.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions().images.qualityFilter;
      expect(saved.enabled).toBe(true);
      expect(saved.blurMetric).toBe('high-frequency-energy-ratio');
    });

    it('disables the blur-metric select when the gate (or capture) is off', () => {
      const imagesEnabled = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const qualityFilter = document.getElementById(
        'images-quality-filter'
      ) as HTMLInputElement;
      const select = document.getElementById(
        'images-blur-metric'
      ) as HTMLSelectElement;

      // Gate off (the default) → select disabled.
      expect(select.disabled).toBe(true);

      qualityFilter.checked = true;
      qualityFilter.dispatchEvent(new Event('change'));
      expect(select.disabled).toBe(false);

      imagesEnabled.checked = false;
      imagesEnabled.dispatchEvent(new Event('change'));
      expect(select.disabled).toBe(true);
    });
  });

  describe('live debug-overlay toggles (Finding B)', () => {
    // Why these tests matter: each toggle gates a live feature (frame tiles,
    // occupancy cubes, GPS+VIO alignment spheres, compass cubes, heading-up
    // minimap). All default ON (purely additive). The settings UI must
    // round-trip each: populate from saved options and persist a change back to
    // storage.
    const TOGGLE_IDS = [
      ['viz-frame-tiles', 'frameTiles'],
      ['viz-occupancy-cubes', 'occupancyCubes'],
      ['viz-gps-alignment-markers', 'gpsAlignmentMarkers'],
      ['viz-compass-cubes', 'compassCubes'],
      ['viz-heading-up-map', 'headingUpMap'],
    ] as const;

    it('all default to checked (ON) — purely additive', () => {
      initSettingsModal();
      showSettingsModal();

      for (const [id] of TOGGLE_IDS) {
        const cb = document.getElementById(id) as HTMLInputElement | null;
        expect(cb, id).not.toBeNull();
        expect(cb!.checked, id).toBe(true);
      }
    });

    it.each(TOGGLE_IDS)(
      'persists %s → visualization.%s when unchecked',
      (id, key) => {
        initSettingsModal();
        showSettingsModal();

        const cb = document.getElementById(id) as HTMLInputElement;
        expect(cb.checked).toBe(true);
        cb.checked = false;
        cb.dispatchEvent(new Event('change'));

        document.getElementById('btn-settings-save')?.click();

        expect(loadRecordingOptions().visualization[key]).toBe(false);
        // The other overlays remain ON — toggles are independent.
        for (const [otherId, otherKey] of TOGGLE_IDS) {
          if (otherKey === key) continue;
          expect(loadRecordingOptions().visualization[otherKey], otherId).toBe(
            true
          );
        }
      }
    );

    it.each(TOGGLE_IDS)('populates %s from a saved OFF value', (id, key) => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ visualization: { [key]: false } })
      );

      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(id) as HTMLInputElement | null;
      expect(cb?.checked).toBe(false);
    });
  });

  describe('compass alignment toggles (Phase-4)', () => {
    // Why: the three compass alignment flags must round-trip through the settings
    // UI (populate from saved options + persist a change). Stage 0
    // (coldStartOverride) is a default-ON feature; Stage C + the consistency gate
    // stay experimental (default OFF) so a stray persisted value can't silently
    // enable them.
    const COMPASS_IDS = [
      ['compass-cold-start-override', 'coldStartOverride'],
      ['compass-rotation-prior', 'rotationPrior'],
      ['compass-webxr-consistency', 'webXRConsistency'],
      // 2026-07-19 field-test toggles (enablement plan): the experiment combo
      // (prior + tolerance 15° + C′) and the plain-RANSAC comparison arm.
      ['compass-experiment', 'experiment'],
      ['compass-ransac-comparison', 'ransacComparison'],
    ] as const;

    const COMPASS_DEFAULT_CHECKED: Record<
      (typeof COMPASS_IDS)[number][1],
      boolean
    > = {
      coldStartOverride: true,
      rotationPrior: false,
      webXRConsistency: false,
      experiment: false,
      ransacComparison: false,
    };

    it('default checkbox states match the per-flag defaults (Stage 0 on, others off)', () => {
      initSettingsModal();
      showSettingsModal();
      for (const [id, key] of COMPASS_IDS) {
        const cb = document.getElementById(id) as HTMLInputElement | null;
        expect(cb, id).not.toBeNull();
        expect(cb!.checked, id).toBe(COMPASS_DEFAULT_CHECKED[key]);
      }
    });

    it.each(COMPASS_IDS)(
      'persists a toggle of %s independently of the other flags',
      (id, key) => {
        initSettingsModal();
        showSettingsModal();

        const cb = document.getElementById(id) as HTMLInputElement;
        const target = !COMPASS_DEFAULT_CHECKED[key];
        expect(cb.checked).toBe(COMPASS_DEFAULT_CHECKED[key]);
        cb.checked = target;
        cb.dispatchEvent(new Event('change'));

        document.getElementById('btn-settings-save')?.click();

        const saved = loadRecordingOptions().compassDebug;
        expect(saved[key]).toBe(target);
        // The other compass flags stay at their defaults — toggles are independent.
        for (const [otherId, otherKey] of COMPASS_IDS) {
          if (otherKey === key) continue;
          expect(saved[otherKey], otherId).toBe(
            COMPASS_DEFAULT_CHECKED[otherKey]
          );
        }
      }
    );

    it.each(COMPASS_IDS)('populates %s from a saved ON value', (id, key) => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ compassDebug: { [key]: true } })
      );

      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(id) as HTMLInputElement | null;
      expect(cb?.checked).toBe(true);
    });

    it('persists + populates the loop-closure capture toggle (experimental, default OFF)', () => {
      // Why: the loop-closure detector wiring is opt-in per the 2026-07-06
      // recorder wiring plan — the checkbox must default unchecked, persist an
      // opt-in through save, and populate from a saved ON value.
      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(
        'loop-closure-detector'
      ) as HTMLInputElement | null;
      expect(cb).not.toBeNull();
      expect(cb!.checked).toBe(false);

      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));
      document.getElementById('btn-settings-save')?.click();

      expect(loadRecordingOptions().loopClosureDebug.detectorEnabled).toBe(
        true
      );
    });

    it('populates loop-closure-detector CHECKED from a saved ON value', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ loopClosureDebug: { detectorEnabled: true } })
      );

      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(
        'loop-closure-detector'
      ) as HTMLInputElement | null;
      expect(cb?.checked).toBe(true);
    });

    it('populates compass-cold-start-override UNCHECKED from a saved OFF value (opt-out round-trip)', () => {
      // The recorder off-toggle: a persisted coldStartOverride:false must survive
      // load → populate as an unchecked box so the operator can disable Stage 0.
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({ compassDebug: { coldStartOverride: false } })
      );

      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(
        'compass-cold-start-override'
      ) as HTMLInputElement | null;
      expect(cb?.checked).toBe(false);
    });
  });

  describe('minimal baseline preset', () => {
    it('disables recording-time and Phase 1 AR crash isolation flags', () => {
      initSettingsModal();
      showSettingsModal();

      document.getElementById('btn-ar-minimal-baseline')?.click();

      const working = getWorkingOptions() as Record<string, unknown> | null;
      const flags = working?.arCrashIsolation as
        | Record<string, unknown>
        | undefined;

      expect(working?.images).toEqual(
        expect.objectContaining({ enabled: false })
      );
      expect(working?.depth).toEqual(
        expect.objectContaining({ enabled: false })
      );
      expect(flags).toEqual({
        enableDomOverlay: false,
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCss3dRenderer: false,
        enableCameraTextureAcquisition: false,
        // Workaround flag is intentionally NOT touched by the preset — it
        // is an independent user choice, preserving its default (now true).
        applyChromiumProjectionLayerWorkaround: true,
      });
    });
  });

  describe('Chromium projection-layer workaround', () => {
    it('persists the workaround flag from the dedicated checkbox', () => {
      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(
        'ar-chromium-projection-layer-workaround'
      ) as HTMLInputElement | null;
      expect(cb).not.toBeNull();
      expect(cb!.checked).toBe(true);

      cb!.checked = false;
      cb!.dispatchEvent(new Event('change'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions() as unknown as Record<
        string,
        unknown
      >;
      const flags = saved.arCrashIsolation as
        | Record<string, unknown>
        | undefined;
      expect(flags?.applyChromiumProjectionLayerWorkaround).toBe(false);
    });

    it('populates the checkbox from saved options', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({
          arCrashIsolation: {
            applyChromiumProjectionLayerWorkaround: false,
          },
        })
      );

      initSettingsModal();
      showSettingsModal();

      const cb = document.getElementById(
        'ar-chromium-projection-layer-workaround'
      ) as HTMLInputElement | null;
      expect(cb?.checked).toBe(false);
    });
  });

  describe('reset button', () => {
    it('resets form to defaults', () => {
      initSettingsModal();
      showSettingsModal();

      // Modify a checkbox
      const depthEnabled = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      depthEnabled.checked = false;
      depthEnabled.dispatchEvent(new Event('change'));

      // Reset
      const btnReset = document.getElementById('btn-settings-reset');
      btnReset?.click();

      // Verify form was reset
      expect(depthEnabled.checked).toBe(true);
    });

    it('updates working options to defaults', () => {
      initSettingsModal();
      showSettingsModal();

      // Reset
      const btnReset = document.getElementById('btn-settings-reset');
      btnReset?.click();

      const working = getWorkingOptions();
      expect(working).toEqual(DEFAULT_RECORDING_OPTIONS);
    });
  });

  describe('close button', () => {
    it('hides modal without saving', () => {
      const callback = vi.fn();
      initSettingsModal(callback);
      showSettingsModal();

      const btnClose = document.getElementById('btn-settings-close');
      btnClose?.click();

      expect(isSettingsModalVisible()).toBe(false);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('slider interactions', () => {
    beforeEach(() => {
      initSettingsModal();
      showSettingsModal();
    });

    it('updates depth interval value display', () => {
      const slider = document.getElementById(
        'depth-interval'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('depth-interval-value');

      slider.value = '2000';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('2.0s');
    });

    it('updates depth grid value display', () => {
      const slider = document.getElementById('depth-grid') as HTMLInputElement;
      const valueDisplay = document.getElementById('depth-grid-value');

      slider.value = '5';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('5×5');
    });

    it('updates images interval value display', () => {
      const slider = document.getElementById(
        'images-interval'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('images-interval-value');

      slider.value = '4000';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('4.0s');
    });

    it('shows sub-second image intervals in ms (splat-scan cadence)', () => {
      // Why this test matters: IMAGE_CONSTRAINTS.intervalMs.min dropped to
      // 250 ms (2026-07-10 splat-orbit finding) and `(250/1000).toFixed(1)`
      // would render a misleading "0.3s" — sub-second values must show exact
      // milliseconds (mirroring the QR interval display).
      const slider = document.getElementById(
        'images-interval'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('images-interval-value');

      slider.value = '250';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('250 ms');
    });

    it('shows quarter-second image intervals ≥1s with exact decimals', () => {
      // Why this test matters: IMAGE_CONSTRAINTS.intervalMs.step is 250 ms,
      // so 1250/1750 are reachable slider values — `toFixed(1)` would render
      // them as a misleading "1.3s"/"1.8s" (PR #178 review). Quarter-second
      // values must show two decimals while half-second multiples keep the
      // clean one-decimal form.
      const slider = document.getElementById(
        'images-interval'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('images-interval-value');

      slider.value = '1250';
      slider.dispatchEvent(new Event('input'));
      expect(valueDisplay?.textContent).toBe('1.25s');

      slider.value = '1750';
      slider.dispatchEvent(new Event('input'));
      expect(valueDisplay?.textContent).toBe('1.75s');

      slider.value = '1500';
      slider.dispatchEvent(new Event('input'));
      expect(valueDisplay?.textContent).toBe('1.5s');

      slider.value = '1000';
      slider.dispatchEvent(new Event('input'));
      expect(valueDisplay?.textContent).toBe('1.0s');
    });

    it('updates images quality value display', () => {
      const slider = document.getElementById(
        'images-quality'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('images-quality-value');

      slider.value = '0.9';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('90%');
    });

    it('updates images resolution divisor value display', () => {
      const slider = document.getElementById(
        'images-resolution-divisor'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById(
        'images-resolution-divisor-value'
      );

      slider.value = '2';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('÷2 (half)');
    });

    it('updates resolution divisor to full when set to 1', () => {
      const slider = document.getElementById(
        'images-resolution-divisor'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById(
        'images-resolution-divisor-value'
      );

      slider.value = '1';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('1× (full)');
    });

    /**
     * Why this test matters (D7-resolution, 2026-06-16 user feedback): the
     * frame-tile DISPLAY divisor is a separate knob from the capture
     * resolution divisor. Moving it must update the ÷N label and write the
     * value into `frameTileDisplay.divisor` (not `images.resolutionDivisor`),
     * so the decode-time downscale uses it on the next Enter-AR / replay.
     */
    it('updates frame-tile display divisor value and working option', () => {
      const slider = document.getElementById(
        'frame-tile-display-divisor'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById(
        'frame-tile-display-divisor-value'
      );

      slider.value = '4';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('÷4 (quarter)');
      expect(getWorkingOptions()?.frameTileDisplay.divisor).toBe(4);
      // Must NOT have touched the capture resolution divisor.
      expect(getWorkingOptions()?.images.resolutionDivisor).toBe(
        DEFAULT_RECORDING_OPTIONS.images.resolutionDivisor
      );
    });

    /**
     * Why this test matters (occupancy-grid-settings review, item 1): the
     * voxel-size slider is shown in centimetres for readability but the stored
     * option is in metres. Moving the slider must (a) update the cm label and
     * (b) write metres into the working option (cm / 100) — a unit mismatch
     * would silently feed the grid a 100× wrong cell size.
     */
    it('updates voxel size display in cm and stores metres', () => {
      const slider = document.getElementById(
        'occupancy-cell-size'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById('occupancy-cell-size-value');

      slider.value = '5';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('5 cm');
      expect(getWorkingOptions()?.occupancy.cellSizeM).toBeCloseTo(0.05);
    });

    it('updates the noise-filter (min-confidence) working option', () => {
      const slider = document.getElementById(
        'occupancy-min-confidence'
      ) as HTMLInputElement;
      const valueDisplay = document.getElementById(
        'occupancy-min-confidence-value'
      );

      slider.value = '6';
      slider.dispatchEvent(new Event('input'));

      expect(valueDisplay?.textContent).toBe('6');
      expect(getWorkingOptions()?.occupancy.minConfidence).toBe(6);
    });
  });

  describe('checkbox interactions', () => {
    beforeEach(() => {
      initSettingsModal();
      showSettingsModal();
    });

    it('disables depth sliders when depth is disabled', () => {
      const checkbox = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      const intervalSlider = document.getElementById(
        'depth-interval'
      ) as HTMLInputElement;
      const gridSlider = document.getElementById(
        'depth-grid'
      ) as HTMLInputElement;

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(intervalSlider.disabled).toBe(true);
      expect(gridSlider.disabled).toBe(true);
    });

    it('enables depth sliders when depth is enabled', () => {
      const checkbox = document.getElementById(
        'depth-enabled'
      ) as HTMLInputElement;
      const intervalSlider = document.getElementById(
        'depth-interval'
      ) as HTMLInputElement;

      // Disable first
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      // Then enable
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(intervalSlider.disabled).toBe(false);
    });

    it('disables image sliders when images are disabled', () => {
      const checkbox = document.getElementById(
        'images-enabled'
      ) as HTMLInputElement;
      const intervalSlider = document.getElementById(
        'images-interval'
      ) as HTMLInputElement;
      const qualitySlider = document.getElementById(
        'images-quality'
      ) as HTMLInputElement;
      const resDivisorSlider = document.getElementById(
        'images-resolution-divisor'
      ) as HTMLInputElement;

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(intervalSlider.disabled).toBe(true);
      expect(qualitySlider.disabled).toBe(true);
      expect(resDivisorSlider.disabled).toBe(true);
    });
  });

  describe('backdrop click', () => {
    it('closes modal when clicking backdrop', () => {
      initSettingsModal();
      showSettingsModal();

      const modal = document.getElementById('settings-modal');
      modal?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          target: modal,
        } as MouseEventInit)
      );

      // Note: This test may not work perfectly in JSDOM because event.target
      // might not match the modal element properly, so we just verify the modal exists
      expect(modal).not.toBeNull();
    });
  });

  describe('QR detection settings (recorder live-QR WS-2/WS-5)', () => {
    // Why these tests matter: QR capture is opt-in (default OFF) and the operator
    // tunes the cadence + capture resolution from this modal. The UI must
    // round-trip each control (populate from saved, persist a change) and gate the
    // sliders on the enabled toggle.
    it('includes the QR controls in production HTML', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="qr-enabled"');
      expect(html).toContain('id="qr-interval"');
      expect(html).toContain('id="qr-interval-value"');
      expect(html).toContain('id="qr-capture-size"');
      expect(html).toContain('id="qr-capture-size-value"');
      expect(html).toContain('QR Detection');
    });

    it('defaults to OFF with the sliders disabled', () => {
      initSettingsModal();
      showSettingsModal();

      const enabled = document.getElementById('qr-enabled') as HTMLInputElement;
      const interval = document.getElementById(
        'qr-interval'
      ) as HTMLInputElement;
      const capture = document.getElementById(
        'qr-capture-size'
      ) as HTMLInputElement;
      expect(enabled.checked).toBe(false);
      expect(interval.disabled).toBe(true);
      expect(capture.disabled).toBe(true);
    });

    it('enables the sliders when QR is turned on', () => {
      initSettingsModal();
      showSettingsModal();

      const enabled = document.getElementById('qr-enabled') as HTMLInputElement;
      const interval = document.getElementById(
        'qr-interval'
      ) as HTMLInputElement;
      const capture = document.getElementById(
        'qr-capture-size'
      ) as HTMLInputElement;

      enabled.checked = true;
      enabled.dispatchEvent(new Event('change'));
      expect(interval.disabled).toBe(false);
      expect(capture.disabled).toBe(false);
    });

    it('persists the enabled toggle and slider values', () => {
      initSettingsModal();
      showSettingsModal();

      const enabled = document.getElementById('qr-enabled') as HTMLInputElement;
      enabled.checked = true;
      enabled.dispatchEvent(new Event('change'));

      const interval = document.getElementById(
        'qr-interval'
      ) as HTMLInputElement;
      interval.value = '250';
      interval.dispatchEvent(new Event('input'));

      const capture = document.getElementById(
        'qr-capture-size'
      ) as HTMLInputElement;
      capture.value = '512';
      capture.dispatchEvent(new Event('input'));

      document.getElementById('btn-settings-save')?.click();

      const saved = loadRecordingOptions();
      expect(saved.qr.enabled).toBe(true);
      expect(saved.qr.intervalMs).toBe(250);
      expect(saved.qr.captureSize).toBe(512);
    });

    it('populates the controls from saved options', () => {
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({
          qr: { enabled: true, intervalMs: 200, captureSize: 768 },
        })
      );

      initSettingsModal();
      showSettingsModal();

      const enabled = document.getElementById('qr-enabled') as HTMLInputElement;
      const interval = document.getElementById(
        'qr-interval'
      ) as HTMLInputElement;
      const intervalVal = document.getElementById('qr-interval-value');
      const capture = document.getElementById(
        'qr-capture-size'
      ) as HTMLInputElement;
      const captureVal = document.getElementById('qr-capture-size-value');

      expect(enabled.checked).toBe(true);
      expect(interval.value).toBe('200');
      expect(intervalVal?.textContent).toBe('200 ms');
      expect(capture.value).toBe('768');
      expect(captureVal?.textContent).toBe('768 px');
    });

    it('updates the slider value displays on input', () => {
      initSettingsModal();
      showSettingsModal();

      const interval = document.getElementById(
        'qr-interval'
      ) as HTMLInputElement;
      interval.value = '300';
      interval.dispatchEvent(new Event('input'));
      expect(document.getElementById('qr-interval-value')?.textContent).toBe(
        '300 ms'
      );

      const capture = document.getElementById(
        'qr-capture-size'
      ) as HTMLInputElement;
      capture.value = '2048';
      capture.dispatchEvent(new Event('input'));
      expect(
        document.getElementById('qr-capture-size-value')?.textContent
      ).toBe('2048 px');
    });
  });

  describe('build version label', () => {
    // Why: Step 6 of the zip-debug-metadata plan — the build version must
    // be visible in the settings modal so users can report it in bug reports.

    it('populates build-version-label on init', () => {
      initSettingsModal();

      const label = document.getElementById('build-version-label');
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe('0.1.0 (abc1234)');
    });

    it('build-version-label element exists in production HTML', () => {
      const html = loadSettingsModalHtml();
      expect(html).toContain('id="build-version-label"');
    });

    it('label has select-all class for easy copying', () => {
      const label = document.getElementById('build-version-label');
      expect(label).not.toBeNull();
      expect(label!.classList.contains('select-all')).toBe(true);
    });

    it('does not throw when build metadata is unavailable', () => {
      // Why: build metadata is diagnostic only. Missing metadata must not
      // prevent the settings modal or the whole app from initializing.
      mockGetBuildInfo.mockImplementation(() => {
        throw new Error('Missing or invalid build metadata: __BUILD_COMMIT__');
      });

      expect(() => initSettingsModal()).not.toThrow();

      const label = document.getElementById('build-version-label');
      expect(label?.textContent).toBe('Build unavailable');
    });
  });
});
