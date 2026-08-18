import { test, expect } from './e2e-test.js';

/**
 * Help Section Tests (Issue 2 - User Feedback 2026-01-27)
 *
 * Tests the collapsible "What is this?" help section on the setup screen.
 * The help section explains key concepts: app purpose, scenarios, sessions,
 * and reference points.
 *
 * Why this test matters: Users reported confusion about the terminology
 * on the setup screen. This help section addresses that by providing
 * contextual explanation that's visible by default for first-time users.
 */

// ⚠️ Also defined in src/ui/hud.ts — keep in sync!
const HELP_COLLAPSED_KEY = 'gps-recorder-help-collapsed';
const HELP_SEEN_KEY = 'gps-recorder-help-seen';

/**
 * Helper to toggle the help section by dispatching a click on the summary.
 * We use evaluate to bypass Playwright's viewport checks since the modal
 * content may extend beyond the viewport on smaller screens.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function toggleHelpSection(page) {
  await page.evaluate(() => {
    const summary = document.querySelector('#help-section summary');
    if (summary) {
      summary.click();
    }
  });
}

test.describe('Help Section', () => {
  // Simulate a genuine FIRST-TIME user: clear BOTH the collapsed preference and
  // the "seen" marker, then reload so that reload is the first launch this user
  // has ever made (open by default). The "show the manual once" behaviour
  // (2026-06-19) collapses on every *subsequent* start, so the seen marker must
  // be cleared too or the reload would already count as a return visit.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(
      ([collapsedKey, seenKey]) => {
        localStorage.removeItem(collapsedKey);
        localStorage.removeItem(seenKey);
      },
      [HELP_COLLAPSED_KEY, HELP_SEEN_KEY]
    );
    // Reload to pick up the cleared state (this reload = the first-ever launch).
    await page.reload();
    // Wait for setup modal to be visible
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
  });

  test('help section is visible by default for first-time users', async ({
    page,
  }) => {
    // The help section should exist and be expanded (open) by default
    const helpDetails = page.locator('#help-section');
    await expect(helpDetails).toBeVisible();

    // The content should be visible (details is open)
    const helpContent = page.locator('#help-section-content');
    await expect(helpContent).toBeVisible();
  });

  test('help section is collapsed by default on a return visit (manual shown once)', async ({
    page,
  }) => {
    // beforeEach has already made one (first-time) launch, so the "seen" marker
    // is now set. A plain reload — no explicit collapse — is a return visit and
    // must default to collapsed so the task, not the manual, leads the screen.
    const helpContent = page.locator('#help-section-content');
    await expect(helpContent).toBeVisible(); // first-time launch: open

    await page.reload();
    await page.locator('#setup-modal').waitFor({ state: 'visible' });

    await expect(helpContent).not.toBeVisible(); // return visit: collapsed
  });

  test('help section contains key concept explanations', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Should explain what the app is for. `[\s\S]*` (not `.*`) so the match
    // tolerates the prettier-wrapped multi-line Purpose paragraph — "Record
    // synchronized AR + GPS data …" spans several source lines.
    await expect(helpContent).toContainText(/record[\s\S]*AR[\s\S]*GPS/i);

    // D1 (2026-06-19 round-2 feedback): the Purpose copy now foregrounds the
    // concrete artifact — the ZIP's COLMAP folder structure — rather than the
    // abstract "build 3D reconstructions". Assert the COLMAP linkage survives so
    // the wording can't silently regress to the old generic framing. Kept loose
    // (`/COLMAP/i`) so the exact phrasing ("COLMAP folder structure" /
    // "COLMAP-conform") can be tuned without churning the test.
    await expect(helpContent).toContainText(/COLMAP/i);

    // Should explain what Reference Points are
    await expect(helpContent).toContainText(/reference point/i);
  });

  // D6 item 3 (2026-06-16 user feedback): the Scenario/Session explanations were
  // moved OUT of the top "What is this app?" help and into the self-contained
  // (collapsed) scenario/session section, so the manual no longer dominates the
  // first viewport. The explanations must still exist — just in their new home.
  test('scenario/session explanations live in the scenario section', async ({
    page,
  }) => {
    const scenarioSection = page.locator('#scenario-section');
    // toContainText reads textContent, so it works even while collapsed.
    await expect(scenarioSection).toContainText(/scenario/i);
    await expect(scenarioSection).toContainText(/session/i);
    // And they are no longer duplicated in the help text.
    await expect(page.locator('#help-section-content')).not.toContainText(
      /A named[\s\S]*physical area/i
    );
  });

  test('help section can be collapsed by clicking', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Initially visible
    await expect(helpContent).toBeVisible();

    // Click to collapse using helper (bypasses viewport issues)
    await toggleHelpSection(page);

    // Content should now be hidden
    await expect(helpContent).not.toBeVisible();
  });

  test('collapsed state is saved to localStorage', async ({ page }) => {
    // Collapse the help section using helper
    await toggleHelpSection(page);

    // Check localStorage was updated
    const collapsed = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, HELP_COLLAPSED_KEY);

    expect(collapsed).toBe('true');
  });

  test('help section stays collapsed on page reload if user collapsed it', async ({
    page,
  }) => {
    const helpContent = page.locator('#help-section-content');

    // Collapse the help section using helper
    await toggleHelpSection(page);
    await expect(helpContent).not.toBeVisible();

    // Reload the page
    await page.reload();
    await page.locator('#setup-modal').waitFor({ state: 'visible' });

    // Help content should still be collapsed
    await expect(helpContent).not.toBeVisible();
  });

  test('help section can be re-expanded after collapsing', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Collapse using helper
    await toggleHelpSection(page);
    await expect(helpContent).not.toBeVisible();

    // Re-expand using helper
    await toggleHelpSection(page);
    await expect(helpContent).toBeVisible();
  });
});
