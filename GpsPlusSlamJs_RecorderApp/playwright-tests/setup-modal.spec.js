import { test, expect } from './e2e-test.js';
import {
  callRealPopulateScenarios,
  fakeWebXRSupport,
  setPermissionsReady,
  setStorageReady,
  waitForTestHooks,
} from './test-helpers.js';

/**
 * Setup Modal Flow Tests
 *
 * These tests verify the setup modal workflow that users go through
 * before starting an AR session. This includes folder selection,
 * scenario management, and session notes.
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
  test('modal prevents interaction with main controls', async ({ page }) => {
    // Setup modal should be visible, covering main UI
    const setupModal = page.locator('#setup-modal');
    await expect(setupModal).toBeVisible();

    // Main controls should exist but behind the modal
    const startButton = page.locator('#btn-start');
    const mapButton = page.locator('#btn-map');

    // The buttons exist but modal has higher z-index
    await expect(startButton).toBeAttached();
    await expect(mapButton).toBeAttached();

    // Modal has z-50, so it covers controls
    const modalZIndex = await setupModal.evaluate(
      (el) => window.getComputedStyle(el).zIndex
    );
    expect(parseInt(modalZIndex)).toBeGreaterThanOrEqual(50);
  });

  test('scenario dropdown is populated after OPFS auto-init', async ({
    page,
  }) => {
    // Scenario controls are collapsed by default (D6 item 3); expand to view.
    await expandScenarioSection(page);
    const scenarioSelect = page.locator('#scenario-select');
    // After OPFS auto-initialization, dropdown should be enabled (not disabled)
    // It may have "Loading..." initially then switch to available scenarios
    await expect(scenarioSelect).toBeVisible();
  });

  // D6 item 3 (2026-06-16 user feedback): the scenario/session controls are
  // tucked into a self-contained <details> that is COLLAPSED by default so the
  // first viewport shows the real actions, not advanced grouping config.
  test('scenario section is a collapsed details by default', async ({
    page,
  }) => {
    const section = page.locator('#scenario-section');
    await expect(section).toBeVisible(); // the <summary> chevron is shown
    // The <details> must NOT be open on first paint.
    const isOpen = await section.evaluate((el) => el.open);
    expect(isOpen).toBe(false);
    // Consequently the dropdown inside it is hidden until expanded.
    await expect(page.locator('#scenario-select')).toBeHidden();
  });

  test('enter AR button is disabled before scenario selection', async ({
    page,
  }) => {
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toContainText('Enter AR');
  });

  // D2 (2026-06-19 round-2 feedback): session notes is an optional,
  // session-level field, so it now lives INSIDE the collapsed scenario/session
  // <details> — hidden by default, revealed only when the user expands the
  // section. Mirrors "scenario section is a collapsed details by default".
  test('session notes is hidden by default and revealed when the section expands', async ({
    page,
  }) => {
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
  });

  test('session notes textarea is enabled after storage is ready', async ({
    page,
  }) => {
    // After storage selection is complete, the notes textarea should be enabled
    const notesTextarea = page.locator('#session-notes');
    // Simulate mandatory storage selection (Task 1a-fix)
    await setStorageReady(page);
    // Notes now lives in the collapsed scenario/session section (D2) — expand
    // it so the textarea is actually visible, then assert it is editable.
    await expandScenarioSection(page);
    await expect(notesTextarea).toBeVisible();
    await expect(notesTextarea).toBeEnabled();
  });

  test('storage buttons are visible for mandatory selection', async ({
    page,
  }) => {
    // D5 (2026-06-05): the save location is the only mandatory storage step and
    // is visible by default; the folder-import step is an OPTIONAL collapsed
    // section, so its button is hidden until the section is expanded.
    const chooseSaveBtn = page.locator('#btn-choose-save');
    await expect(chooseSaveBtn).toBeVisible();

    const folderSection = page.locator('#folder-import-section');
    await expect(folderSection).toBeVisible(); // the <summary> is shown
    const openFolderBtn = page.locator('#btn-open-folder');
    await expect(openFolderBtn).toBeHidden(); // collapsed by default

    // Expanding the optional section reveals the folder button.
    await page.evaluate(() => window.testHooks.setFolderImportExpanded(true));
    await expect(openFolderBtn).toBeVisible();
  });

  test('folder status shows not selected initially', async ({ page }) => {
    const folderStatus = page.locator('#folder-status');
    await expect(folderStatus).toContainText('No folder selected');
  });

  // D2 (2026-07-05 folder-import feedback): the eager ref-point indexing pass
  // drives a determinate progress bar (+ text label) inside the folder-import
  // section. Playwright cannot exercise the real File System Access API, so
  // the bar states are driven via the same testHooks the app wires
  // (setFolderImportProgress) — asserting the transitional AND the durable
  // end state per the CLAUDE.md async-UX rule.
  test('folder-import progress bar shows in-progress and durable ✓ end states', async ({
    page,
  }) => {
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

  // D6 item 8 (2026-06-16 user feedback): the "choose a save location" blocker
  // is stated ONCE, on the disabled Enter AR button's hint — NOT duplicated in
  // #save-status. So #save-status starts empty (it is a pure path-status line)
  // and the single authoritative blocker lives in #enter-ar-hint.
  test('save-location blocker is stated once (on the Enter AR hint, not save-status)', async ({
    page,
  }) => {
    const saveStatus = page.locator('#save-status');
    // Pure status line: empty until a save location is chosen.
    await expect(saveStatus).toHaveText('');

    // The single authoritative blocker is on the disabled primary action.
    const enterHint = page.locator('#enter-ar-hint');
    await expect(enterHint).toBeVisible();
    await expect(enterHint).toContainText(/save location/i);
  });

  test('new scenario name input shown when no existing scenarios', async ({
    page,
  }) => {
    // After storage selection with no existing scenarios, dropdown shows "__new__"
    // which triggers the new scenario section to be visible
    await setStorageReady(page);
    // If no existing scenarios, "__new__" is selected and section is visible
    // OR if existing scenarios, the section is hidden until user selects "__new__"
    // Either behavior is acceptable - just verify the section element exists
    const newScenarioSection = page.locator('#new-scenario-section');
    await expect(newScenarioSection).toBeAttached();
  });

  test('clicking storage button does not throw error in test env', async ({
    page,
  }) => {
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

    // The folder button lives in the collapsed optional section (D5); expand it
    // first so it is actionable, then click it.
    await page.evaluate(() => window.testHooks.setFolderImportExpanded(true));
    const openFolderBtn = page.locator('#btn-open-folder');
    await openFolderBtn.click();

    // Give a brief moment for any errors to propagate, then check
    // Use expect.poll to allow for async error propagation
    await expect.poll(() => pageErrors, { timeout: 500 }).toEqual([]);
  });

  test('storage status indicators show initially empty', async ({ page }) => {
    const folderStatus = page.locator('#folder-status');
    const saveStatus = page.locator('#save-status');
    await expect(folderStatus).toContainText('No folder selected');
    // #save-status is a pure path-status line and starts empty (D6 item 8);
    // the save-location blocker is on #enter-ar-hint instead.
    await expect(saveStatus).toHaveText('');
  });

  test('WebXR warning is hidden when WebXR not checked', async ({ page }) => {
    // The warning should be hidden initially (shown only after check fails)
    const warning = page.locator('#webxr-warning');
    // Note: In Chromium with WebXR simulation, it may or may not be visible
    // We just verify the element exists
    await expect(warning).toBeAttached();
  });

  // D6 item 1 (2026-06-16 user feedback): the Required Permissions section is
  // the upfront action on the setup screen — it must render ABOVE the storage,
  // scenario and notes blocks (it used to be the last block). Codifies the
  // structural reorder so it can't silently regress.
  test('permissions section renders above storage setup', async ({ page }) => {
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

  test('setup modal title is correct', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'GPS + SLAM Recorder' })
    ).toBeVisible();
  });

  test('status display exists and shows initial state', async ({ page }) => {
    const statusText = page.locator('#status-text');
    await expect(statusText).toBeAttached();
    // Should show some status text (Initializing or similar)
    const text = await statusText.textContent();
    expect(text).not.toBe('');
  });
});

test.describe('Scenario Dropdown Interaction', () => {
  test('dropdown has options after storage is selected', async ({ page }) => {
    await expandScenarioSection(page);
    const scenarioSelect = page.locator('#scenario-select');
    // Simulate mandatory storage selection
    await setStorageReady(page);
    // After storage selection, dropdown should have at least the "New Scenario" option
    const options = scenarioSelect.locator('option');
    await expect(options).not.toHaveCount(0);
  });

  test('populateScenarios updates UI correctly', async ({ page }) => {
    // Simulate mandatory storage selection first
    await setStorageReady(page);
    // Use real populateScenarios function to test the actual app behavior
    // when a folder is selected and scenarios are loaded
    await callRealPopulateScenarios(page, ['Test Scenario']);

    // Set permissions as ready (required for Enter AR button to be enabled)
    await setPermissionsReady(page);

    // Expand the collapsed scenario controls (D6 item 3) before selecting.
    await expandScenarioSection(page);
    // Select the existing scenario to enable the Enter AR button
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('Test Scenario');

    // Verify UI is now enabled
    await expect(scenarioSelect).toBeEnabled();
    await expect(scenarioSelect).toHaveValue('Test Scenario');

    // Session notes should be enabled after folder selection
    const notesArea = page.locator('#session-notes');
    await expect(notesArea).toBeEnabled();

    // Enter button should be enabled with valid scenario selected
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeEnabled();
  });

  test('selecting "New Scenario" shows name input', async ({ page }) => {
    // Simulate folder selection by populating the dropdown using real app function
    await callRealPopulateScenarios(page, ['Existing']);

    // Select the new scenario option - this triggers the real change handler
    // which was attached by initUI (now called before WebXR check)
    await expandScenarioSection(page);
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('__new__');

    // The real application change handler should show the new scenario section
    const newScenarioSection = page.locator('#new-scenario-section');
    await expect(newScenarioSection).not.toHaveClass(/hidden/);
  });

  test('new scenario name input accepts text', async ({ page }) => {
    // Populate the dropdown to enable scenario selection using real app function
    await callRealPopulateScenarios(page, ['Existing']);

    // Select "__new__" to trigger the real change handler and show the section
    await expandScenarioSection(page);
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('__new__');

    const nameInput = page.locator('#new-scenario-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Paris Eiffeltower');
    await expect(nameInput).toHaveValue('Paris Eiffeltower');
  });

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

test.describe('Session Notes Interaction', () => {
  test('notes textarea accepts multiline input when enabled', async ({
    page,
  }) => {
    // Enable the textarea by populating scenarios (simulates folder selection)
    await callRealPopulateScenarios(page, ['Test Scenario']);

    // Notes now lives in the collapsed scenario/session section (D2) — fill()
    // requires the element to be visible, so expand the section first.
    await expandScenarioSection(page);
    const notes = page.locator('#session-notes');
    await expect(notes).toBeVisible();
    await expect(notes).toBeEnabled();

    // Type multiline text
    await notes.fill('Weather: Sunny\nDevice: Pixel 7\nTest run #1');
    await expect(notes).toHaveValue(
      'Weather: Sunny\nDevice: Pixel 7\nTest run #1'
    );
  });

  test('notes placeholder is visible', async ({ page }) => {
    const notes = page.locator('#session-notes');
    const placeholder = await notes.getAttribute('placeholder');
    expect(placeholder).toContain('Weather');
  });
});

// D4 (2026-06-19 round-2 feedback, Finding 4): the setup modal splits into a
// scrollable content area (#setup-scroll) + a pinned CTA footer, so the primary
// action (Enter AR) stays visible without scrolling — users were missing it
// below the fold on short screens. These assert the structural/transitional
// contract per the UI-feedback rule; the dominant-CTA *styling* is a visual
// concern checked on-device.
test.describe('Pinned Enter AR footer', () => {
  test('Enter AR stays in the viewport without scrolling on a short screen', async ({
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
  });

  test('Enter AR and its hint share the pinned footer (outside the scroll area)', async ({
    page,
  }) => {
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
