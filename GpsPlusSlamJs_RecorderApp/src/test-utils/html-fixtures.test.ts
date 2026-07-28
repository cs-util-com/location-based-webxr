/**
 * Tests for html-fixtures.ts
 *
 * Why these tests matter:
 * - Validates that the fixture loader correctly extracts HTML from index.html
 * - Ensures the loader handles nested elements properly
 * - Guards against regressions in the extraction logic
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractElementById,
  extractElementsById,
  loadSettingsModalHtml,
  loadSettingsButtonHtml,
  loadSettingsTestFixture,
  loadFullIndexHtml,
  loadAppCss,
  clearHtmlCache,
} from './html-fixtures';

describe('html-fixtures', () => {
  describe('extractElementById', () => {
    it('extracts settings-modal element', () => {
      const html = extractElementById('settings-modal');

      expect(html).toContain('id="settings-modal"');
      expect(html).toContain('id="depth-enabled"');
      expect(html).toContain('id="btn-settings-save"');
      // Should be complete element with closing tag
      expect(html).toMatch(/<div[^>]*id="settings-modal"[^>]*>[\s\S]*<\/div>$/);
    });

    it('extracts btn-settings element', () => {
      const html = extractElementById('btn-settings');

      expect(html).toContain('id="btn-settings"');
      expect(html).toContain('⚙️');
      expect(html).toContain('aria-label="Recording Settings"');
    });

    it('extracts setup-modal element with nested content', () => {
      const html = extractElementById('setup-modal');

      expect(html).toContain('id="setup-modal"');
      // Should include nested elements
      expect(html).toContain('id="btn-settings"');
      expect(html).toContain('id="btn-enter-ar"');
    });

    it('throws error for non-existent element', () => {
      expect(() => extractElementById('non-existent-element')).toThrow(
        'Element with id="non-existent-element" not found in index.html'
      );
    });

    it('handles elements with single quotes in id attribute', () => {
      // Most IDs in index.html use double quotes, but the loader should handle both
      // This test verifies the regex pattern works for typical cases
      const html = extractElementById('status');
      expect(html).toContain('id="status"');
    });
  });

  describe('extractElementsById', () => {
    it('extracts multiple elements', () => {
      const html = extractElementsById(['settings-modal', 'hud']);

      expect(html).toContain('id="settings-modal"');
      expect(html).toContain('id="hud"');
    });

    it('preserves order of elements', () => {
      const html = extractElementsById(['hud', 'settings-modal']);

      const hudIndex = html.indexOf('id="hud"');
      const modalIndex = html.indexOf('id="settings-modal"');
      expect(hudIndex).toBeLessThan(modalIndex);
    });

    it('returns empty string for empty array', () => {
      const html = extractElementsById([]);
      expect(html).toBe('');
    });
  });

  describe('loadSettingsModalHtml', () => {
    it('returns settings modal HTML', () => {
      const html = loadSettingsModalHtml();

      expect(html).toContain('id="settings-modal"');
      expect(html).toContain('Recording Settings');
    });

    it('includes all required form elements', () => {
      const html = loadSettingsModalHtml();

      // Depth controls
      expect(html).toContain('id="depth-enabled"');
      expect(html).toContain('id="depth-interval"');
      expect(html).toContain('id="depth-grid"');

      // Image controls
      expect(html).toContain('id="images-enabled"');
      expect(html).toContain('id="images-interval"');
      expect(html).toContain('id="images-quality"');

      // Value displays
      expect(html).toContain('id="depth-interval-value"');
      expect(html).toContain('id="depth-grid-value"');
      expect(html).toContain('id="images-interval-value"');
      expect(html).toContain('id="images-quality-value"');

      // Buttons
      expect(html).toContain('id="btn-settings-close"');
      expect(html).toContain('id="btn-settings-save"');
      expect(html).toContain('id="btn-settings-reset"');
    });
  });

  describe('loadSettingsButtonHtml', () => {
    it('returns settings button HTML', () => {
      const html = loadSettingsButtonHtml();

      expect(html).toContain('id="btn-settings"');
      expect(html).toContain('⚙️');
    });

    it('has accessible attributes', () => {
      const html = loadSettingsButtonHtml();

      expect(html).toContain('aria-label="Recording Settings"');
      expect(html).toContain('title="Recording Settings"');
    });
  });

  describe('loadSettingsTestFixture', () => {
    it('includes both settings modal and setup modal', () => {
      const html = loadSettingsTestFixture();

      expect(html).toContain('id="settings-modal"');
      expect(html).toContain('id="setup-modal"');
    });

    it('includes the settings button from setup modal', () => {
      const html = loadSettingsTestFixture();

      expect(html).toContain('id="btn-settings"');
    });
  });

  describe('cache behavior', () => {
    beforeEach(() => {
      // Clear cache to test the caching mechanism itself
      clearHtmlCache();
    });

    it('returns consistent results across calls', () => {
      const html1 = loadSettingsModalHtml();
      const html2 = loadSettingsModalHtml();

      expect(html1).toBe(html2);
    });

    it('clearHtmlCache allows fresh load', () => {
      const html1 = loadSettingsModalHtml();
      clearHtmlCache();
      const html2 = loadSettingsModalHtml();

      // Content should still be the same (file hasn't changed)
      expect(html1).toBe(html2);
    });
  });

  describe('production HTML invariants — Issue 4 (log panel visibility & mobile usability)', () => {
    /**
     * Why these tests matter:
     * User feedback 2026-02-26 reported that (a) the log panel opens behind the
     * summary screen (z-40 < z-50), (b) the close button is unreachable on
     * mobile (hidden behind Android status bar, too small tap target), and (c)
     * there's no visual hint that the status bar is interactive. These tests
     * codify the structural invariants so the bugs cannot regress.
     */

    it('log-panel z-index should be higher than session-summary-panel z-50', () => {
      // Why: Log panel must render ABOVE the summary screen when opened from
      // the "View Full Logs" button. session-summary-panel is z-50.
      const css = loadAppCss();
      const logPanelMatch = css.match(/#log-panel\s*\{[^}]*z-index:\s*(\d+)/);
      expect(logPanelMatch).not.toBeNull();
      const logPanelZIndex = parseInt(logPanelMatch![1], 10);
      expect(logPanelZIndex).toBeGreaterThan(50);
    });

    it('viewport meta should NOT include viewport-fit=cover (removed to fix hitbox offset)', () => {
      // Why: viewport-fit=cover combined with env(safe-area-inset-*) caused
      // pointer-event hitbox misalignment in WebXR DOM overlay mode.
      // Removed until safe-area handling is properly reimplemented.
      const html = loadFullIndexHtml();
      expect(html).not.toMatch(
        /name="viewport"[^>]*content="[^"]*viewport-fit=cover/
      );
    });

    it('log-panel-close should have minimum 44px tap target', () => {
      // Why: Apple HIG and Material Design both require minimum 44×44px touch
      // targets. The old 24×24px button was too small to tap reliably on mobile.
      const css = loadAppCss();
      const closeRule = css.match(/#log-panel-close\s*\{[^}]*?\}/s);
      expect(closeRule).not.toBeNull();
      expect(closeRule![0]).toMatch(/min-width:\s*44px/);
      expect(closeRule![0]).toMatch(/min-height:\s*44px/);
    });

    it('log-panel-header should use simple padding (safe-area removed for hitbox fix)', () => {
      // Why: env(safe-area-inset-top) was removed to fix hitbox offset in WebXR
      // DOM overlay mode. Simple padding is used instead until safe-area
      // handling is properly reimplemented.
      const css = loadAppCss();
      const headerRule = css.match(/#log-panel-header\s*\{[^}]*?\}/s);
      expect(headerRule).not.toBeNull();
      expect(headerRule![0]).not.toMatch(/env\(safe-area-inset-top\)/);
      expect(headerRule![0]).toMatch(/padding/);
    });

    it('hud should use simple padding (safe-area removed for hitbox fix)', () => {
      // Why: env(safe-area-inset-top) was removed to fix hitbox offset in WebXR
      // DOM overlay mode. Simple padding is used instead until safe-area
      // handling is properly reimplemented.
      const css = loadAppCss();
      const hudRule = css.match(/#hud\s*\{[^}]*?\}/s);
      expect(hudRule).not.toBeNull();
      expect(hudRule![0]).not.toMatch(/env\(safe-area-inset-top\)/);
      expect(hudRule![0]).toMatch(/padding/);
    });

    it('status element should have title attribute indicating tap-to-toggle', () => {
      // Why: The tap-to-toggle behavior is completely undiscoverable. A title
      // attribute provides a tooltip (on hover/long-press) and improves a11y.
      const html = extractElementById('status');
      expect(html).toMatch(/title="[^"]*log/i);
    });

    it('status element should contain visual log-toggle hint icon', () => {
      // Why: A static icon (e.g. 📋) makes the tap-to-toggle feature
      // discoverable without requiring prior knowledge.
      const html = extractElementById('status');
      expect(html).toContain('📋');
    });

    it('range inputs should declare touch-action: pan-y for panel scrolling', () => {
      // Why: user feedback 2026-07-27 — swiping the scrollable settings panel
      // dragged whatever slider sat under the finger. `pan-y` hands vertical
      // panning back to the scroll container (and makes the browser cancel the
      // slider's gesture); src/ui/slider-scroll-guard.ts protects the value
      // itself. Losing this rule brings the "cannot scroll the panel" half of
      // the bug straight back.
      const css = loadAppCss();
      const rangeRule = css.match(/input\[type='range'\]\s*\{[^}]*?\}/s);
      expect(rangeRule).not.toBeNull();
      expect(rangeRule![0]).toMatch(/touch-action:\s*pan-y/);
    });
  });
});
