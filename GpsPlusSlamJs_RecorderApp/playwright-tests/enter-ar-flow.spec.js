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

// A boot in recording mode: the app ready, the scenario section open.
async function openSetup(page) {
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
}

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await openSetup(page);
});

test.describe('Permission Verification', () => {
  // The unit tests hold the Grant button; only here do the row labels meet the
  // real page, so one test walks the rows through their states.
  test('the permission rows: File Storage first, then Ready, Denied and Pending as the checks change', async ({
    page,
  }) => {
    await test.step('the rows are there', async () => {
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

    await test.step('File Storage comes first', async () => {
      // Why this test matters: User Feedback Issue #1 - File storage should be
      // the first permission shown since it's the most common failure point.
      const permSection = page.locator('#permission-section .bg-gray-700\\/50');
      const firstPermRow = permSection.locator('> div').first();
      await expect(firstPermRow).toHaveAttribute('id', 'perm-filestorage');
      await expect(firstPermRow).toContainText('File Storage');
    });

    await test.step('the WebXR row says AR + Depth Sensing', async () => {
      // Why this test matters: User feedback indicated confusion about the
      // "3D map of surroundings" permission appearing after clicking Enter AR.
      // The label now clarifies that depth sensing is part of the AR permission.
      await expect(page.locator('#perm-webxr')).toContainText(
        'AR + Depth Sensing'
      );
    });

    const fileStorageStatus = page.locator('#perm-filestorage-status');
    const webxrStatus = page.locator('#perm-webxr-status');

    await test.step('File Storage is ready after storage is selected', async () => {
      // Why this test matters: Task 1a-fix - With mandatory storage selection,
      // file storage permission shows ready after both folder AND save location selected.
      await setStorageReady(page);
      await expect(fileStorageStatus).toContainText('Ready', { timeout: 5000 });
    });

    await test.step('File Storage is denied when the folder is read-only', async () => {
      // Why this test matters: User Feedback Issue #1 - When write verification
      // fails (read-only folder), we need to show a clear error message.
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
      await expect(fileStorageStatus).toContainText('Denied');

      // Permission error should be visible with the error message
      const permError = page.locator('#permission-error');
      await expect(permError).toBeVisible();
      await expect(permError).toContainText('read-only');
    });

    await test.step('File Storage is granted with a writable folder', async () => {
      // Why this test matters: User Feedback Issue #1 - After successful folder
      // selection with verified write access, status should show granted.
      // After the denied step, or the Ready of the step before it would pass
      // this without the update doing anything.
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
      await expect(fileStorageStatus).toContainText('Ready');
    });

    await test.step('WebXR is pending while depth is not yet granted', async () => {
      // Why this test matters: The depth-sensing permission is requested via a probe
      // session. If not yet granted, WebXR status should show as pending/checking.
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
      await expect(webxrStatus).toContainText('Pending');
    });

    await test.step('WebXR is denied when AR access is refused', async () => {
      // Why this test matters: When user denies the "3D map" permission,
      // the UI should clearly show WebXR as denied with an error message.
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
      await expect(webxrStatus).toContainText('Denied');

      // Enter AR button should be disabled
      await expect(page.locator('#btn-enter-ar')).toBeDisabled();
    });
  });
});

test.describe('With Permissions Granted', () => {
  // This hook applies to all nested suites - sets permissions AND storage as ready
  // so we can test scenario validation logic
  test.beforeEach(async ({ page }) => {
    await setStorageReady(page);
    await setPermissionsReady(page);
  });

  test('the scenario name decides Enter AR: the prefill enables it, an empty name disables it and says why', async ({
    page,
  }) => {
    const enterButton = page.locator('#btn-enter-ar');
    const nameInput = page.locator('#new-scenario-name');
    const hint = page.locator('#enter-ar-hint');

    await test.step('enabled by default with the prefilled name', async () => {
      // Why this test matters: UX feedback 2026-05-03 — when a folder has no
      // existing scenarios, the user should be able to tap "Enter AR" without
      // typing because `index.html` prefills the new-scenario-name input with
      // the canonical default scenario name. See
      // docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md.
      await callRealPopulateScenarios(page, []);
      await expect(nameInput).toHaveValue('Default Scenario');
      await expect(enterButton).toBeEnabled();
      await expect(hint).toBeHidden();
    });

    await test.step('a cleared name disables it, and the hint says why', async () => {
      // Why this test matters: When user selects "+ Create new scenario" and
      // clears the prefilled default, they need to know that entering a name
      // is required before they can proceed.
      await nameInput.clear();
      await page.evaluate(() => window.testHooks.validateEnterButton());
      await expect(enterButton).toBeDisabled();
      await expect(hint).toBeVisible();
      await expect(hint).toContainText('Enter a scenario name');
    });

    await test.step('typing a name enables it and hides the hint', async () => {
      // Why this test matters: Verifies the complete flow of creating a new
      // scenario and being able to proceed to AR mode.
      await nameInput.fill('My Test Scenario');
      await expect(enterButton).toBeEnabled();
      await expect(hint).toBeHidden();
    });

    await test.step('clearing it again disables it as the user types', async () => {
      // Why this test matters: Validates that the button state updates
      // dynamically as the user types or clears the input.
      await nameInput.clear();
      await expect(enterButton).toBeDisabled();
      await expect(hint).toBeVisible();
    });

    await test.step('choosing "new" focuses the name input', async () => {
      // Why this test matters: When user selects "+ Create new scenario",
      // auto-focusing the name input guides them to the next required action.
      await callRealPopulateScenarios(page, ['Existing']);
      await page.locator('#scenario-select').selectOption('__new__');
      await expect(nameInput).toBeFocused();
    });

    await test.step('an existing scenario enables it and hides the hint', async () => {
      // Why this test matters: Once requirements are met, the hint should disappear
      // to avoid visual clutter.
      await callRealPopulateScenarios(page, ['TestScenario']);
      await page.locator('#scenario-select').selectOption('TestScenario');
      await expect(enterButton).toBeEnabled();
      await expect(hint).toBeHidden();
    });
  });

  test('clicking enabled Enter AR hides the setup modal, for a new scenario and for an existing one @pr', async ({
    page,
  }) => {
    // Why this test matters: Verifies the happy path - user can actually
    // proceed to AR mode after completing the required steps. The new scenario
    // was a reported pain point in user feedback.
    // See docs/2026-01-23-user-feedback.md
    const scenarioSelect = page.locator('#scenario-select');
    const enterButton = page.locator('#btn-enter-ar');
    const setupModal = page.locator('#setup-modal');

    await test.step('a new scenario', async () => {
      // Simulate folder selection with no existing scenarios
      await callRealPopulateScenarios(page, []);

      // Only "__new__" option exists
      await expect(scenarioSelect).toHaveValue('__new__');

      // Enter a scenario name
      await page.locator('#new-scenario-name').fill('My New Recording Session');
      await expect(enterButton).toBeEnabled();

      await enterButton.click();

      // Setup modal should be hidden - user is now in AR mode
      await expect(setupModal).toHaveClass(/hidden/);
    });

    await test.step('an existing scenario, after a fresh boot', async () => {
      // Entering AR is one way, so the second path needs its own boot.
      await openSetup(page);
      await setStorageReady(page);
      await setPermissionsReady(page);

      // Simulate folder selection with existing scenario
      await callRealPopulateScenarios(page, ['TestScenario']);
      await scenarioSelect.selectOption('TestScenario');
      await expect(enterButton).toBeEnabled();

      await enterButton.click();
      await expect(setupModal).toHaveClass(/hidden/);
    });
  });

  test.describe('Bug: New scenario flow when folder has no existing scenarios', () => {
    test('with no scenarios the name input is shown and focused; with scenarios the first is chosen and the input hidden', async ({
      page,
    }) => {
      const scenarioSelect = page.locator('#scenario-select');
      const newScenarioSection = page.locator('#new-scenario-section');
      const nameInput = page.locator('#new-scenario-name');

      await test.step('no existing scenarios', async () => {
        // Why this test matters: When a user selects a folder with no existing scenarios,
        // the dropdown auto-selects "__new__" but the input section stays hidden because
        // no change event fires. This leaves users stuck - they can see "+ Create new scenario"
        // is selected but have no way to enter a name.
        // See docs/2026-01-23-user-feedback.md for user reports of this issue.

        // Simulate folder selection with NO existing scenarios (empty array)
        await callRealPopulateScenarios(page, []);

        // The dropdown should show "__new__" as the selected value
        await expect(scenarioSelect).toHaveValue('__new__');

        // The new-scenario-section should be visible so user can enter a name
        await expect(newScenarioSection).toBeVisible();
        await expect(nameInput).toBeVisible();

        // For good UX, when the only option is to create a new scenario, we
        // auto-focus the input so the user can immediately start typing.
        await expect(nameInput).toBeFocused();
      });

      await test.step('existing scenarios', async () => {
        // Why this test matters: When there are existing scenarios, the first one
        // is auto-selected and the new scenario input should stay hidden.
        await callRealPopulateScenarios(page, [
          'ExistingScenario1',
          'ExistingScenario2',
        ]);

        // The dropdown should show the first existing scenario
        await expect(scenarioSelect).toHaveValue('ExistingScenario1');

        // The new-scenario-section should be hidden
        await expect(newScenarioSection).toBeHidden();

        // Enter AR button should be enabled since an existing scenario is selected
        await expect(page.locator('#btn-enter-ar')).toBeEnabled();
      });
    });
  });
}); // End of 'With Permissions Granted' parent describe block

test.describe('D5: read folder is optional for Enter AR', () => {
  test('Enter AR enables without opening a folder; folder section collapsed by default @pr', async ({
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
