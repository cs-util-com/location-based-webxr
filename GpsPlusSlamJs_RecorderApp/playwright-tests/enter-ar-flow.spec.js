import { test, expect } from './e2e-test.js';
import {
  callRealPopulateScenarios,
  fakeWebXRSupport,
  setPermissionsReady,
  setStorageReady,
  waitForTestHooks,
} from './test-helpers.js';

// NOTE: This file intentionally uses .js (not .ts) for consistency with all other
// Playwright tests in this folder. JSDoc annotations provide type hints without
// requiring a separate tsconfig for e2e tests or global declarations for testHooks.
// If migrating to TypeScript, convert all spec files together as a coordinated effort.

/**
 * Enter AR Flow Tests
 *
 * These tests verify the complete flow from setup modal to entering AR mode,
 * addressing user feedback about unclear button states and missing visual hints.
 *
 * Why this test matters: Users reported confusion about why the "Enter AR"
 * button wasn't clickable and lacked feedback about required actions.
 * See docs/2026-01-23-user-feedback.md for full context.
 */

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for setup modal to be visible (indicates app is ready)
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  // Ensure all testHooks are available before any test runs.
  // This replaces per-test waitForFunction calls for individual hooks.
  await waitForTestHooks(page);
  // D6 item 3 (2026-06-16 user feedback): scenario/session controls now live in
  // a collapsed <details id="scenario-section">. These flow tests drive the
  // scenario dropdown + new-scenario name input, so open the section up front to
  // keep those elements actionable (the dropdown is the focus here, not the
  // collapse behaviour — that is covered in setup-modal.spec.js).
  await page.evaluate(() => {
    const section = document.getElementById('scenario-section');
    if (section) section.open = true;
  });
});

test.describe('Permission Verification', () => {
  test('shows permission status section in setup modal', async ({ page }) => {
    // Why this test matters: Users need to see what permissions are required
    // before attempting to enter AR mode.
    const permSection = page.locator('#permission-section');
    await expect(permSection).toBeVisible();

    // Check individual permission status indicators exist
    await expect(page.locator('#perm-filestorage')).toBeVisible();
    await expect(page.locator('#perm-webxr')).toBeVisible();
    await expect(page.locator('#perm-gps')).toBeVisible();
    await expect(page.locator('#perm-camera')).toBeVisible();

    // D3 (2026-06-19 round-2 feedback): the Compass/orientation row was removed
    // — it is permanently granted (non-actionable) on every Android device that
    // can record. Assert it is GONE so the dead row can't silently come back.
    await expect(page.locator('#perm-orientation')).toHaveCount(0);
  });

  test('shows File Storage as first permission item', async ({ page }) => {
    // Why this test matters: User Feedback Issue #1 - File storage should be
    // the first permission shown since it's the most common failure point.
    const permSection = page.locator('#permission-section .bg-gray-700\\/50');
    const firstPermRow = permSection.locator('> div').first();
    await expect(firstPermRow).toHaveAttribute('id', 'perm-filestorage');
    await expect(firstPermRow).toContainText('File Storage');
  });

  test('shows File Storage as ready after storage is selected', async ({
    page,
  }) => {
    // Why this test matters: Task 1a-fix - With mandatory storage selection,
    // file storage permission shows ready after both folder AND save location selected.
    await setStorageReady(page);
    const fileStorageStatus = page.locator('#perm-filestorage-status');
    await expect(fileStorageStatus).toContainText('Ready', { timeout: 5000 });
  });

  test('shows File Storage as granted when folder with write access is selected', async ({
    page,
  }) => {
    // Why this test matters: User Feedback Issue #1 - After successful folder
    // selection with verified write access, status should show granted.
    // waitForTestHooks in beforeEach already ensures updatePermissionStatus is ready
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        webxr: { supported: true, granted: true },
        geolocation: { supported: true, granted: true },
        camera: { supported: true, granted: true },
        orientation: { supported: true, granted: true },
        fileSystem: { supported: true, granted: true },
        allMandatoryReady: true,
      });
    });

    const fileStorageStatus = page.locator('#perm-filestorage-status');
    await expect(fileStorageStatus).toContainText('Ready');
  });

  test('shows File Storage as denied when folder is read-only', async ({
    page,
  }) => {
    // Why this test matters: User Feedback Issue #1 - When write verification
    // fails (read-only folder), we need to show a clear error message.
    // waitForTestHooks in beforeEach already ensures updatePermissionStatus is ready
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        webxr: { supported: true, granted: true },
        geolocation: { supported: true, granted: true },
        camera: { supported: true, granted: true },
        orientation: { supported: true, granted: true },
        fileSystem: {
          supported: true,
          granted: false,
          error: 'Folder is read-only. Please select a different folder.',
        },
        allMandatoryReady: false,
      });
    });

    const fileStorageStatus = page.locator('#perm-filestorage-status');
    await expect(fileStorageStatus).toContainText('Denied');

    // Permission error should be visible with the error message
    const permError = page.locator('#permission-error');
    await expect(permError).toBeVisible();
    await expect(permError).toContainText('read-only');
  });

  test('shows "AR + Depth Sensing" label for WebXR permission', async ({
    page,
  }) => {
    // Why this test matters: User feedback indicated confusion about the
    // "3D map of surroundings" permission appearing after clicking Enter AR.
    // The label now clarifies that depth sensing is part of the AR permission.
    const webxrRow = page.locator('#perm-webxr');
    await expect(webxrRow).toContainText('AR + Depth Sensing');
  });

  test('shows permission hint when permissions not ready', async ({ page }) => {
    // Why this test matters: Users should know they need to grant permissions
    // before they can enter AR mode.
    // First set storage as ready so the hint shows permission-related message
    await setStorageReady(page);
    const hint = page.locator('#enter-ar-hint');
    await expect(hint).toBeVisible();
    // Hint could be about permissions or scenario name
    const hintText = await hint.textContent();
    expect(
      hintText.includes('permissions') || hintText.includes('scenario')
    ).toBe(true);
  });

  test('shows Grant Permissions button when permissions are pending', async ({
    page,
  }) => {
    // Why this test matters: Users need a clear way to trigger permission prompts.
    // Note: This test checks the button can be shown; actual prompt triggers
    // require real browser context which E2E mocks can't fully simulate.

    // Simulate pending permission state (camera pending)
    // waitForTestHooks in beforeEach already ensures updatePermissionStatus is ready
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        webxr: { supported: true, granted: true },
        geolocation: { supported: true, granted: true },
        camera: { supported: true, granted: null }, // pending
        orientation: { supported: true, granted: true },
        fileSystem: { supported: true, granted: true },
        allMandatoryReady: false,
      });
    });

    const grantButton = page.locator('#btn-request-permissions');
    await expect(grantButton).toBeVisible();
  });

  test('shows WebXR as pending when depth permission not yet granted', async ({
    page,
  }) => {
    // Why this test matters: The depth-sensing permission is requested via a probe
    // session. If not yet granted, WebXR status should show as pending/checking.
    // waitForTestHooks in beforeEach already ensures updatePermissionStatus is ready
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        webxr: { supported: true, granted: null }, // not yet probed
        geolocation: { supported: true, granted: true },
        camera: { supported: true, granted: true },
        orientation: { supported: true, granted: true },
        fileSystem: { supported: true, granted: true },
        allMandatoryReady: false,
      });
    });

    // WebXR status should show pending state - positive assertion is stronger than negated check
    const webxrStatus = page.locator('#perm-webxr-status');
    await expect(webxrStatus).toContainText('Pending');
  });

  test('shows WebXR as denied when AR access is refused', async ({ page }) => {
    // Why this test matters: When user denies the "3D map" permission,
    // the UI should clearly show WebXR as denied with an error message.
    // waitForTestHooks in beforeEach already ensures updatePermissionStatus is ready
    await page.evaluate(() => {
      window.testHooks.updatePermissionStatus({
        webxr: { supported: true, granted: false, error: 'AR access denied' },
        geolocation: { supported: true, granted: true },
        camera: { supported: true, granted: true },
        orientation: { supported: true, granted: true },
        fileSystem: { supported: true, granted: true },
        allMandatoryReady: false,
      });
    });

    // WebXR status should show denial
    const webxrStatus = page.locator('#perm-webxr-status');
    await expect(webxrStatus).toContainText('Denied');

    // Enter AR button should be disabled
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeDisabled();
  });
});

test.describe('With Permissions Granted', () => {
  // This hook applies to all nested suites - sets permissions AND storage as ready
  // so we can test scenario validation logic
  test.beforeEach(async ({ page }) => {
    await setStorageReady(page);
    await setPermissionsReady(page);
  });

  test.describe('Enter AR Button Feedback', () => {
    test('shows hint text when Enter AR button is disabled without scenario name', async ({
      page,
    }) => {
      // Why this test matters: With mandatory storage selection complete,
      // the hint shows when a scenario name is needed (for new scenarios).
      // The new-scenario-name input is prefilled with the canonical default
      // (UX feedback 2026-05-03), so we explicitly clear it to exercise the
      // empty-name path.
      await callRealPopulateScenarios(page, []);
      await page.locator('#new-scenario-name').clear();
      await page.evaluate(() => window.testHooks.validateEnterButton());

      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeDisabled();

      // There should be a hint element explaining why the button is disabled
      // With no existing scenarios, the hint tells user to enter a scenario name
      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('scenario name');
    });

    test('shows hint about scenario name when new scenario selected but name empty', async ({
      page,
    }) => {
      // Why this test matters: When user selects "+ Create new scenario" and
      // clears the prefilled default, they need to know that entering a name
      // is required before they can proceed.

      // Simulate folder selection with no existing scenarios
      await callRealPopulateScenarios(page, []);
      await page.locator('#new-scenario-name').clear();
      await page.evaluate(() => window.testHooks.validateEnterButton());

      // At this point, only "__new__" is selected (first option)
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeDisabled();

      // Hint should tell user to enter a scenario name
      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('Enter a scenario name');
    });

    test('hides hint when Enter AR button becomes enabled', async ({
      page,
    }) => {
      // Why this test matters: Once requirements are met, the hint should disappear
      // to avoid visual clutter.

      // Simulate folder selection with an existing scenario
      await callRealPopulateScenarios(page, ['TestScenario']);

      // Select the existing scenario
      const scenarioSelect = page.locator('#scenario-select');
      await scenarioSelect.selectOption('TestScenario');

      // Button should be enabled and hint should be hidden
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeEnabled();

      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeHidden();
    });
  });

  test.describe('New Scenario Creation Flow', () => {
    test('auto-focuses scenario name input when new scenario selected', async ({
      page,
    }) => {
      // Why this test matters: When user selects "+ Create new scenario",
      // auto-focusing the name input guides them to the next required action.

      await callRealPopulateScenarios(page, ['Existing']);

      const scenarioSelect = page.locator('#scenario-select');
      await scenarioSelect.selectOption('__new__');

      // The new scenario name input should be focused
      const nameInput = page.locator('#new-scenario-name');
      await expect(nameInput).toBeFocused();
    });

    test('Enter AR button enables after entering new scenario name', async ({
      page,
    }) => {
      // Why this test matters: Verifies the complete flow of creating a new
      // scenario and being able to proceed to AR mode. We clear the prefill
      // first so this test exercises the user-typing flow rather than the
      // default-prefill flow (which is covered by a separate test).

      await callRealPopulateScenarios(page, []);
      const nameInput = page.locator('#new-scenario-name');
      await nameInput.clear();
      await page.evaluate(() => window.testHooks.validateEnterButton());

      // After clearing, button should be disabled
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeDisabled();

      // Enter a scenario name
      await nameInput.fill('My Test Scenario');

      // Button should now be enabled
      await expect(enterButton).toBeEnabled();

      // Hint should be hidden
      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeHidden();
    });

    test('Enter AR button is enabled by default with prefilled scenario name', async ({
      page,
    }) => {
      // Why this test matters: UX feedback 2026-05-03 — when a folder has no
      // existing scenarios, the user should be able to tap "Enter AR" without
      // typing because `index.html` prefills the new-scenario-name input with
      // the canonical default scenario name. See
      // docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md.

      await callRealPopulateScenarios(page, []);

      const nameInput = page.locator('#new-scenario-name');
      await expect(nameInput).toHaveValue('Default Scenario');

      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeEnabled();

      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeHidden();
    });

    test('Enter AR button disables if scenario name is cleared', async ({
      page,
    }) => {
      // Why this test matters: Validates that the button state updates
      // dynamically as the user types or clears the input.

      await callRealPopulateScenarios(page, []);

      const nameInput = page.locator('#new-scenario-name');
      const enterButton = page.locator('#btn-enter-ar');

      // Enter a name
      await nameInput.fill('Test');
      await expect(enterButton).toBeEnabled();

      // Clear the name
      await nameInput.clear();
      await expect(enterButton).toBeDisabled();

      // Hint should reappear
      const hint = page.locator('#enter-ar-hint');
      await expect(hint).toBeVisible();
    });
  });

  test.describe('Complete Enter AR Flow', () => {
    test('clicking enabled Enter AR button hides setup modal', async ({
      page,
    }) => {
      // Why this test matters: Verifies the happy path - user can actually
      // proceed to AR mode after completing the required steps.

      // Simulate folder selection with existing scenario
      await callRealPopulateScenarios(page, ['TestScenario']);

      const scenarioSelect = page.locator('#scenario-select');
      await scenarioSelect.selectOption('TestScenario');

      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeEnabled();

      // Click Enter AR
      await enterButton.click();

      // Setup modal should be hidden
      const setupModal = page.locator('#setup-modal');
      await expect(setupModal).toHaveClass(/hidden/);
    });

    test('new scenario creation completes Enter AR flow', async ({ page }) => {
      // Why this test matters: Verifies the complete happy path for NEW scenario
      // creation - user selects folder with no scenarios, enters a name, and
      // proceeds to AR mode. This was a reported pain point in user feedback.
      // See docs/2026-01-23-user-feedback.md

      // Simulate folder selection with no existing scenarios
      await callRealPopulateScenarios(page, []);

      // Only "__new__" option exists
      const scenarioSelect = page.locator('#scenario-select');
      await expect(scenarioSelect).toHaveValue('__new__');

      // Enter a scenario name
      const nameInput = page.locator('#new-scenario-name');
      await nameInput.fill('My New Recording Session');

      // Button should now be enabled
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeEnabled();

      // Click Enter AR
      await enterButton.click();

      // Setup modal should be hidden - user is now in AR mode
      const setupModal = page.locator('#setup-modal');
      await expect(setupModal).toHaveClass(/hidden/);
    });
  });

  test.describe('Bug: New scenario flow when folder has no existing scenarios', () => {
    test('new scenario input section should be visible when folder has no existing scenarios', async ({
      page,
    }) => {
      // Why this test matters: When a user selects a folder with no existing scenarios,
      // the dropdown auto-selects "__new__" but the input section stays hidden because
      // no change event fires. This leaves users stuck - they can see "+ Create new scenario"
      // is selected but have no way to enter a name.
      // See docs/2026-01-23-user-feedback.md for user reports of this issue.

      // Simulate folder selection with NO existing scenarios (empty array)
      await callRealPopulateScenarios(page, []);

      // The dropdown should show "__new__" as the selected value
      const scenarioSelect = page.locator('#scenario-select');
      await expect(scenarioSelect).toHaveValue('__new__');

      // The new-scenario-section should be visible so user can enter a name
      const newScenarioSection = page.locator('#new-scenario-section');
      await expect(newScenarioSection).toBeVisible();

      // The name input should be visible so user can enter a scenario name
      const nameInput = page.locator('#new-scenario-name');
      await expect(nameInput).toBeVisible();
    });

    test('new scenario input should be auto-focused when folder has no existing scenarios', async ({
      page,
    }) => {
      // Why this test matters: For good UX, when the only option is to create a new
      // scenario, we should auto-focus the input so the user can immediately start typing.

      await callRealPopulateScenarios(page, []);

      const nameInput = page.locator('#new-scenario-name');
      await expect(nameInput).toBeFocused();
    });

    test('new scenario section should be hidden when folder has existing scenarios', async ({
      page,
    }) => {
      // Why this test matters: When there are existing scenarios, the first one
      // is auto-selected and the new scenario input should stay hidden.

      await callRealPopulateScenarios(page, [
        'ExistingScenario1',
        'ExistingScenario2',
      ]);

      // The dropdown should show the first existing scenario
      const scenarioSelect = page.locator('#scenario-select');
      await expect(scenarioSelect).toHaveValue('ExistingScenario1');

      // The new-scenario-section should be hidden
      const newScenarioSection = page.locator('#new-scenario-section');
      await expect(newScenarioSection).toBeHidden();

      // Enter AR button should be enabled since an existing scenario is selected
      const enterButton = page.locator('#btn-enter-ar');
      await expect(enterButton).toBeEnabled();
    });
  });
}); // End of 'With Permissions Granted' parent describe block

test.describe('D5: read folder is optional for Enter AR', () => {
  test('Enter AR enables without opening a folder; folder section collapsed by default', async ({
    page,
  }) => {
    // Why this test matters: D5 (2026-06-05 recorder setup UX) makes the read
    // folder an OPTIONAL import step. Enter AR is gated only on the save
    // location, permissions and a scenario — not on opening a folder — and the
    // folder-import section is collapsed by default (its summary visible, its
    // button hidden until expanded).
    await expect(page.locator('#btn-open-folder')).toBeHidden();
    await expect(page.locator('#folder-import-section')).toBeVisible();

    // Pick a scenario, then set ONLY the save location + permissions (no folder).
    await callRealPopulateScenarios(page, ['SomeScenario']);
    await page.locator('#scenario-select').selectOption('SomeScenario');
    await page.evaluate(() => {
      window.testHooks.setSaveLocationSelected(true);
      window.testHooks.setPermissionsReady(true);
      window.testHooks.validateEnterButton();
    });

    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeEnabled();
    // Still collapsed — we never opened the folder.
    await expect(page.locator('#btn-open-folder')).toBeHidden();
  });
});
