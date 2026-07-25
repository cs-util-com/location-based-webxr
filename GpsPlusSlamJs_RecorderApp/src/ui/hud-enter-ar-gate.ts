/**
 * Enter-AR readiness gate — the setup screen state that decides whether the
 * Enter AR button is enabled: permission status rows, the save-location
 * flag, and the button/hint validation itself.
 *
 * Extracted from the monolithic hud.ts (simplify-loop Area 5 stage C2,
 * 2026-07-24). hud.ts re-exports the public surface so all HUD consumers
 * keep one import seam; the shared flags live on hudState (hud-state.ts).
 */

import type { PermissionCheckResult } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import { listFormatter } from 'gps-plus-slam-app-framework/utils/list-formatter';
import { hudState } from './hud-state';

/**
 * Enable/disable the Enter AR button based on form validity.
 * Also updates the hint text to guide users on what action is needed.
 *
 * Requirements (Issue 1a-fix; folder requirement dropped per the 2026-06-05
 * setup-UX decision D5 — the read folder is an optional import/recovery step):
 * 1. Save location must be chosen (for writing new recording)
 * 2. Permissions must be ready (camera, location)
 * 3. A scenario must be selected or new scenario name entered
 */
export function validateEnterButton(): void {
  if (!hudState.cachedElements) {
    throw new Error('validateEnterButton called before initUI()');
  }
  const { btnEnterAR, scenarioSelect } = hudState.cachedElements;
  // newScenarioName is optional - only shown when creating new scenario
  const newScenarioName = document.getElementById(
    'new-scenario-name'
  ) as HTMLInputElement | null;
  // Hint element for user guidance
  const hint = document.getElementById('enter-ar-hint');

  let valid = false;
  let hintText = '';

  // Check requirements in order of UI flow. The read folder is NOT gated here:
  // recordings are written to the chosen save location (and OPFS), and scenarios
  // load from OPFS without a folder. The folder is an optional import/recovery
  // step (see setFolderImportExpanded + the 2026-06-05 recorder setup-UX
  // decision D5), so only the save location, permissions, and a scenario gate.
  if (!hudState.saveLocationSelected) {
    hintText = 'Choose a save location for this recording';
  } else if (!hudState.permissionsReady) {
    hintText = 'Grant required permissions to continue';
  } else if (scenarioSelect.value && scenarioSelect.value !== '__new__') {
    valid = true;
  } else if (scenarioSelect.value === '__new__') {
    if (newScenarioName?.value.trim()) {
      valid = true;
    } else {
      hintText = 'Enter a scenario name to continue';
    }
  } else {
    // Fallback for unexpected states (e.g., dropdown enabled but no value)
    hintText = 'Please select or create a scenario';
  }

  btnEnterAR.disabled = !valid;

  // Update hint visibility and text
  if (hint) {
    if (valid) {
      hint.classList.add('hidden');
    } else {
      hint.classList.remove('hidden');
      hint.textContent = hintText;
    }
  }
}

/**
 * Update the permission status display in the setup modal.
 * Shows visual indicators for each permission and updates the
 * "Grant Permissions" button visibility.
 */
export function updatePermissionStatus(result: PermissionCheckResult): void {
  // Update internal state
  hudState.permissionsReady = result.allMandatoryReady;

  // Update File Storage status (shown first per user feedback Issue #1)
  updateSinglePermissionStatus(
    'perm-filestorage-status',
    result.fileSystem.supported,
    result.fileSystem.granted,
    result.fileSystem.error
  );

  // Update WebXR status
  updateSinglePermissionStatus(
    'perm-webxr-status',
    result.webxr.supported,
    result.webxr.granted,
    result.webxr.error
  );

  // Update Geolocation status
  updateSinglePermissionStatus(
    'perm-gps-status',
    result.geolocation.supported,
    result.geolocation.granted,
    result.geolocation.error
  );

  // Update Camera status
  updateSinglePermissionStatus(
    'perm-camera-status',
    result.camera.supported,
    result.camera.granted,
    result.camera.error
  );

  // No Orientation status row to update (D3, 2026-06-19): the Compass row was
  // removed because it is permanently granted (and so non-actionable) on every
  // device that can record. `result.orientation` is still consumed below to
  // keep the Grant Permissions button visible while orientation is ungranted.

  // Show/hide "Grant Permissions" button based on whether any permissions
  // need requesting OR have been denied. The button must stay visible until
  // every mandatory permission reports granted === true so the user can
  // re-decide after flipping a permission in browser settings. See
  // docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md (Issue 2).
  const btnRequestPermissions = document.getElementById(
    'btn-request-permissions'
  );
  // Mandatory permissions mirror `allMandatoryReady` in permission-checker.ts:
  // WebXR, Location and Camera must all be granted to enter AR. (File system
  // is mandatory too but is requested separately via the folder picker, not
  // this button, so it is omitted here.) `requestAllPermissions` probes WebXR,
  // so a denied AR/depth probe must keep the button visible for retry.
  const missingMandatory: string[] = [];
  if (result.webxr.supported && result.webxr.granted !== true) {
    missingMandatory.push('AR');
  }
  if (result.geolocation.supported && result.geolocation.granted !== true) {
    missingMandatory.push('Location');
  }
  if (result.camera.supported && result.camera.granted !== true) {
    missingMandatory.push('Camera');
  }
  // Recommended (non-mandatory) permissions: Compass/orientation improves
  // tracking but is intentionally excluded from `allMandatoryReady`. The Grant
  // Permissions button still requests it, so a missing Compass keeps the
  // button visible — but it must never be labeled "mandatory" (see below).
  const missingRecommended: string[] = [];
  if (result.orientation.supported && result.orientation.granted !== true) {
    missingRecommended.push('Compass');
  }
  const needsRequest =
    missingMandatory.length > 0 || missingRecommended.length > 0;

  if (btnRequestPermissions) {
    if (needsRequest) {
      btnRequestPermissions.classList.remove('hidden');
    } else {
      btnRequestPermissions.classList.add('hidden');
    }
  }

  // Show any critical errors
  const permissionError = document.getElementById('permission-error');
  if (permissionError) {
    const errors: string[] = [];
    if (!result.webxr.supported && result.webxr.error) {
      errors.push(result.webxr.error);
    }

    // File system access errors need special handling - show inline message
    if (result.fileSystem.granted === false && result.fileSystem.error) {
      errors.push(result.fileSystem.error);
    }

    // Consolidate denied permission messages for conciseness (consistent with main.ts).
    // Order mirrors missingMandatory (AR, Location, Camera) so the consolidated
    // denied message reads consistently with the mandatory hint. WebXR/AR denial
    // is a real state: requestWebXRWithDepthPermission returns granted === false
    // on a NotAllowedError, so it must surface the actionable "denied" message
    // rather than the generic mandatory fallback.
    const denied: string[] = [];
    if (result.webxr.granted === false) {
      denied.push('AR');
    }
    if (result.geolocation.granted === false) {
      denied.push('Location');
    }
    if (result.camera.granted === false) {
      denied.push('Camera');
    }
    if (denied.length > 0) {
      errors.push(
        `${listFormatter.format(denied)} access denied. Please enable in browser settings.`
      );
    } else if (missingMandatory.length > 0) {
      // Nothing explicitly denied yet, but mandatory permissions are still
      // pending. Surface a generic red explanation next to the visible
      // "Grant Permissions" button so the button's purpose is obvious
      // without changing its label. Compass is excluded — it is not mandatory.
      errors.push(
        `${listFormatter.format(missingMandatory)} access is mandatory for AR recording.`
      );
    }

    if (errors.length > 0) {
      permissionError.textContent = errors.join(' ');
      permissionError.classList.remove('hidden');
    } else {
      permissionError.classList.add('hidden');
    }
  }

  // Re-validate Enter AR button with new permission state
  validateEnterButton();
}

/**
 * Update a single permission status indicator.
 */
function updateSinglePermissionStatus(
  elementId: string,
  supported: boolean,
  granted: boolean | null,
  error?: string
): void {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  // Remove all color classes first
  element.classList.remove(
    'text-green-400',
    'text-red-400',
    'text-yellow-400',
    'text-gray-400'
  );

  if (!supported) {
    element.textContent = '❌ Not supported';
    element.classList.add('text-red-400');
    element.title = error ?? 'Feature not supported';
  } else if (granted === true) {
    element.textContent = '✅ Ready';
    element.classList.add('text-green-400');
    element.title = 'Permission granted';
  } else if (granted === false) {
    element.textContent = '❌ Denied';
    element.classList.add('text-red-400');
    element.title = error ?? 'Permission denied';
  } else {
    element.textContent = '⏳ Pending';
    element.classList.add('text-yellow-400');
    element.title = 'Permission not yet requested';
  }
}

/**
 * Set the hudState.permissionsReady flag directly.
 * Used for testing to simulate permission states.
 * @internal
 */
export function setPermissionsReady(ready: boolean): void {
  hudState.permissionsReady = ready;
}

/**
 * Set the hudState.saveLocationSelected flag.
 * Called after user successfully chooses a save location.
 * @internal
 */
export function setSaveLocationSelected(selected: boolean): void {
  hudState.saveLocationSelected = selected;
}

/**
 * Get the current hudState.saveLocationSelected state.
 * Used for testing.
 * @internal
 */
export function getSaveLocationSelected(): boolean {
  return hudState.saveLocationSelected;
}
