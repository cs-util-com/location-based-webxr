import { test, expect } from './e2e-test.js';
import {
  callRealPopulateScenarios,
  fakeWebXRSupport,
  setStorageReady,
  waitForTestHooks,
} from './test-helpers.js';

/**
 * Setup Modal Flow Tests
 *
 * These tests verify the setup modal workflow that users go through
 * before starting an AR session. This includes folder selection,
 * scenario management, and session notes. One test per state of the modal,
 * because every test pays a boot.
 *
 * Why this test matters: The setup modal is the first thing users interact
 * with, and proper flow is critical for a good user experience.
 */

// D6 item 3 (2026-06-16 user feedback): the scenario/session controls now live
// in a collapsed <details id="scenario-section">. Open it so the <select> is
// actionable for tests that interact with the dropdown.
async function expandScenarioSection(page) {
  await page.evaluate(() => {
    const section = document.getElementById('scenario-section');
    if (section) section.open = true;
  });
}

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for setup modal to be visible (indicates app is ready)
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  // Ensure all testHooks are available before any test runs.
  // This makes the setup consistent with other spec files.
  await waitForTestHooks(page);
});

test.describe('Setup Modal Flow', () => {
  test('the first open: the modal on top, the sections in order and collapsed, then expanded @pr', async ({
    page,
  }) => {
    await test.step('the modal covers the main controls', async () => {
      // Setup modal should be visible, covering main UI
      const setupModal = page.locator('#setup-modal');
      await expect(setupModal).toBeVisible();

      // The buttons exist but modal has higher z-index
      await expect(page.locator('#btn-start')).toBeAttached();
      await expect(page.locator('#btn-map')).toBeAttached();

      // Modal has z-50, so it covers controls
      const modalZIndex = await setupModal.evaluate(
        (el) => window.getComputedStyle(el).zIndex
      );
      expect(parseInt(modalZIndex)).toBeGreaterThanOrEqual(50);
    });

    await test.step('title and status line', async () => {
      await expect(
        page.getByRole('heading', { name: 'GPS + SLAM Recorder' })
      ).toBeVisible();

      const statusText = page.locator('#status-text');
      await expect(statusText).toBeAttached();
      // Should show some status text (Initializing or similar)
      const text = await statusText.textContent();
      expect(text).not.toBe('');
    });

    // D6 item 1 (2026-06-16 user feedback): the Required Permissions section is
    // the upfront action on the setup screen — it must render ABOVE the storage,
    // scenario and notes blocks (it used to be the last block). Codifies the
    // structural reorder so it can't silently regress.
    await test.step('permissions render above storage', async () => {
      const permSection = page.locator('#permission-section');
      const storageSetup = page.locator('#storage-setup');
      await expect(permSection).toBeVisible();
      await expect(storageSetup).toBeVisible();
      const permBox = await permSection.boundingBox();
      const storageBox = await storageSetup.boundingBox();
      expect(permBox).not.toBeNull();
      expect(storageBox).not.toBeNull();
      // Permissions must sit above storage (smaller top y).
      expect(permBox.y).toBeLessThan(storageBox.y);
    });

    await test.step('Enter AR starts disabled', async () => {
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeDisabled();
      await expect(enterButton).toContainText('Enter AR');
    });

    // D6 item 3 (2026-06-16 user feedback): the scenario/session controls are
    // tucked into a self-contained <details> that is COLLAPSED by default so the
    // first viewport shows the real actions, not advanced grouping config.
    await test.step('the scenario section starts collapsed', async () => {
      const section = page.locator('#scenario-section');
      await expect(section).toBeVisible(); // the <summary> chevron is shown
      // The <details> must NOT be open on first paint.
      const isOpen = await section.evaluate((el) => el.open);
      expect(isOpen).toBe(false);
      // Consequently the dropdown inside it is hidden until expanded.
      await expect(page.locator('#scenario-select')).toBeHidden();
    });

    // D2 (2026-06-19 round-2 feedback): session notes is an optional,
    // session-level field, so it now lives INSIDE the collapsed scenario/session
    // <details> — hidden by default, revealed only when the user expands the
    // section.
    await test.step('expanding reveals the dropdown and the session notes', async () => {
      const notes = page.locator('#session-notes');
      // Inside the collapsed <details> → not visible on first paint.
      await expect(notes).toBeHidden();
      // It is a descendant of the scenario/session section, not a sibling after it.
      const insideSection = await notes.evaluate(
        (el) => !!el.closest('#scenario-section')
      );
      expect(insideSection).toBe(true);
      // Expanding the section reveals it.
      await expandScenarioSection(page);
      await expect(notes).toBeVisible();
      // After OPFS auto-initialization, the dropdown should be there too
      // (it may have "Loading..." initially then switch to available scenarios).
      await expect(page.locator('#scenario-select')).toBeVisible();
    });

    await test.step('the notes are enabled once storage is ready', async () => {
      // Simulate mandatory storage selection (Task 1a-fix)
      await setStorageReady(page);
      const notesTextarea = page.locator('#session-notes');
      await expect(notesTextarea).toBeVisible();
      await expect(notesTextarea).toBeEnabled();
    });
  });

  test('the storage steps: the blocker said once, the folder step optional, its progress bar, and a click that cannot crash @pr', async ({
    page,
  }) => {
    // D6 item 8 (2026-06-16 user feedback): the "choose a save location" blocker
    // is stated ONCE, on the disabled Enter AR button's hint — NOT duplicated in
    // #save-status. So #save-status starts empty (it is a pure path-status line)
    // and the single authoritative blocker lives in #enter-ar-hint.
    await test.step('the save-location blocker is on the Enter AR hint only', async () => {
      await expect(page.locator('#folder-status')).toContainText(
        'No folder selected'
      );
      // Pure status line: empty until a save location is chosen.
      await expect(page.locator('#save-status')).toHaveText('');

      // The single authoritative blocker is on the disabled primary action.
      const enterHint = page.locator('#enter-ar-hint');
      await expect(enterHint).toBeVisible();
      await expect(enterHint).toContainText(/save location/i);
    });

    await test.step('the folder step is optional and collapsed', async () => {
      // D5 (2026-06-05): the save location is the only mandatory storage step and
      // is visible by default; the folder-import step is an OPTIONAL collapsed
      // section, so its button is hidden until the section is expanded.
      await expect(page.locator('#btn-choose-save')).toBeVisible();

      await expect(page.locator('#folder-import-section')).toBeVisible(); // the <summary> is shown
      const openFolderBtn = page.locator('#btn-open-folder');
      await expect(openFolderBtn).toBeHidden(); // collapsed by default
    });

    // D2 (2026-07-05 folder-import feedback): the eager ref-point indexing pass
    // drives a determinate progress bar (+ text label) inside the folder-import
    // section. Playwright cannot exercise the real File System Access API, so
    // the bar states are driven via the same testHooks the app wires
    // (setFolderImportProgress) — asserting the transitional AND the durable
    // end state per the CLAUDE.md async-UX rule.
    await test.step('the progress bar shows in-progress and durable end states', async () => {
      const progress = page.getByTestId('folder-import-progress');
      // Hidden while idle.
      await expect(progress).toBeHidden();

      // Expand the optional section (as the auto-expand hint flow would) and
      // start the indexing pass.
      await page.evaluate(() => {
        window.testHooks.setFolderImportExpanded(true);
        window.testHooks.setFolderImportProgress({
          kind: 'progress',
          done: 1,
          total: 3,
        });
      });
      await expect(page.locator('#btn-open-folder')).toBeVisible();
      await expect(progress).toBeVisible();
      await expect(page.locator('#folder-import-progress-text')).toHaveText(
        'Recovering reference points… 1 / 3 recordings'
      );
      // Accessible progress semantics (PR #168 review): the container exposes
      // role="progressbar" with a live aria-valuenow so screen readers can
      // announce the pass — asserted here against the REAL index.html markup
      // (the hud unit tests only cover the JS-driven aria-valuenow).
      await expect(progress).toHaveAttribute('role', 'progressbar');
      await expect(progress).toHaveAttribute('aria-valuemin', '0');
      await expect(progress).toHaveAttribute('aria-valuemax', '100');
      await expect(progress).toHaveAttribute('aria-valuenow', '33');

      // Durable end state: ✓ summary at 100%.
      await page.evaluate(() =>
        window.testHooks.setFolderImportProgress({
          kind: 'done',
          refPointsWritten: 5,
          zipFilesTotal: 3,
        })
      );
      await expect(page.locator('#folder-import-progress-text')).toHaveText(
        '✓ 5 reference points recovered from 3 recordings'
      );
      await expect(progress).toHaveAttribute('aria-valuenow', '100');
      const barWidth = await page
        .locator('#folder-import-progress-bar')
        .evaluate((el) => el.style.width);
      expect(barWidth).toBe('100%');

      // Failure/abort path: a reset hides the bar again.
      await page.evaluate(() => window.testHooks.setFolderImportProgress(null));
      await expect(progress).toBeHidden();
    });

    await test.step('clicking the folder button does not throw', async () => {
      // In test environment without File System Access API, this should
      // fail gracefully (show error toast, not crash)
      const pageErrors = [];
      page.on('pageerror', (error) => {
        // Allow expected errors for showDirectoryPicker / showSaveFilePicker
        if (
          !error.message.includes('showDirectoryPicker') &&
          !error.message.includes('showSaveFilePicker') &&
          !error.message.includes('is not a function') &&
          !error.message.includes('not defined') &&
          !error.message.includes('not supported')
        ) {
          pageErrors.push(error.message);
        }
      });

      await page.locator('#btn-open-folder').click();

      // Give a brief moment for any errors to propagate, then check
      // Use expect.poll to allow for async error propagation
      await expect.poll(() => pageErrors, { timeout: 500 }).toEqual([]);
    });
  });
});

test.describe('Scenario Dropdown Interaction', () => {
  test('selecting existing scenario hides new scenario input', async ({
    page,
  }) => {
    // Populate the dropdown with options using real app function
    await callRealPopulateScenarios(page, ['Existing Scenario']);

    await expandScenarioSection(page);
    const scenarioSelect = page.locator('#scenario-select');
    const newScenarioSection = page.locator('#new-scenario-section');

    // First select "__new__" to show the section
    await scenarioSelect.selectOption('__new__');
    await expect(newScenarioSection).not.toHaveClass(/hidden/);

    // Now select an existing scenario - the real handler should hide the section
    await scenarioSelect.selectOption('Existing Scenario');
    await expect(newScenarioSection).toHaveClass(/hidden/);
  });
});

// D4 (2026-06-19 round-2 feedback, Finding 4): the setup modal splits into a
// scrollable content area (#setup-scroll) + a pinned CTA footer, so the primary
// action (Enter AR) stays visible without scrolling — users were missing it
// below the fold on short screens. These assert the structural/transitional
// contract per the UI-feedback rule; the dominant-CTA *styling* is a visual
// concern checked on-device.
test.describe('Pinned Enter AR footer', () => {
  test('Enter AR and its hint stay in the pinned footer, in the viewport on a short screen @pr', async ({
    page,
  }) => {
    // Force a short viewport so the modal content genuinely overflows — that is
    // the exact situation where the old layout pushed Enter AR below the fold.
    await page.setViewportSize({ width: 390, height: 480 });
    // Open the help section to guarantee the content area overflows.
    await page.evaluate(() => {
      document.getElementById('help-section')?.setAttribute('open', '');
    });

    // The content area must actually be scrollable (otherwise the test would
    // pass trivially and prove nothing about pinning).
    const overflow = await page.evaluate(() => {
      const s = document.getElementById('setup-scroll');
      return s ? s.scrollHeight > s.clientHeight + 1 : false;
    });
    expect(overflow).toBe(true);

    // The core claim: Enter AR is visible in the viewport without scrolling.
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeVisible();
    await expect(enterButton).toBeInViewport();

    // The hint must travel with the button in the footer, and neither may be a
    // descendant of the scrollable content area.
    const shareFooter = await page.evaluate(() => {
      const btn = document.getElementById('btn-enter-ar');
      const hint = document.getElementById('enter-ar-hint');
      const scroll = document.getElementById('setup-scroll');
      if (!btn || !hint || !scroll) return false;
      return (
        btn.parentElement === hint.parentElement &&
        !scroll.contains(btn) &&
        !scroll.contains(hint)
      );
    });
    expect(shareFooter).toBe(true);
  });
});
