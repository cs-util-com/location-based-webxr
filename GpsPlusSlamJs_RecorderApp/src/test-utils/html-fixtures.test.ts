/**
 * Production invariants of index.html and app.css, read through the fixture
 * loader. The loader itself needs no tests of its own: a broken loader fails
 * every suite that consumes it.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  extractElementById,
  loadFullIndexHtml,
  loadAppCss,
} from './html-fixtures';

describe('html-fixtures', () => {
  it('ships the WebXR warning, hidden until a capability check fails', () => {
    // Why: hud.ts finds this element by id at runtime and its unit tests build
    // their own markup, so only this reads the page that actually ships.
    expect(extractElementById('webxr-warning')).toMatch(
      /class="[^"]*\bhidden\b/
    );
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
      // slider's gesture); the framework's utils/slider-scroll-guard protects
      // the value itself. Losing this rule brings the "cannot scroll the panel"
      // half of the bug straight back.
      const css = loadAppCss();
      const rangeRule = css.match(/input\[type='range'\]\s*\{[^}]*?\}/s);
      expect(rangeRule).not.toBeNull();
      expect(rangeRule![0]).toMatch(/touch-action:\s*pan-y/);
    });
  });
});
