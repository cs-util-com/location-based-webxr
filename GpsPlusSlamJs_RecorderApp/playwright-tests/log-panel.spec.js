import { test, expect } from './e2e-test.js';

/**
 * Log Panel E2E Tests
 *
 * These tests verify the expandable log panel that appears when users tap
 * the status area. The session summary's way to the panel is held in
 * session-summary.spec.js.
 *
 * Why this test matters: User feedback Issue #5 requested a way to view
 * detailed logs during field testing to verify everything is working.
 *
 * See docs/2026-01-25-user-feedback.md Issue #5 for context.
 */

test.describe('Log Panel', () => {
  test('clicking status area shows log panel', async ({ page }) => {
    await page.goto('/');
    // Wait for log panel to exist (hidden by default)
    await page.locator('#log-panel').waitFor({ state: 'attached' });

    // Hide the setup modal so it does not cover the status area.
    await page.evaluate(() => {
      document.getElementById('setup-modal')?.classList.add('hidden');
    });
    const panel = page.locator('#log-panel');

    await page.locator('#status').click();

    await expect(panel).not.toHaveClass(/hidden/);
    await expect(panel).toBeVisible();
  });
});
