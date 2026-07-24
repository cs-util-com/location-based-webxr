# Permission Checker Module

## Purpose

Provides utilities to check and verify mandatory device permissions required for AR+GPS tracking: WebXR (immersive-ar), Camera, Geolocation, File Storage, and depth-sensing. This module is used by the setup modal to verify permissions BEFORE the user enters AR mode, providing clear feedback on what's missing.

The module now includes:

- A **depth-sensing probe** that triggers the "3D map of surroundings" permission upfront during the permission request flow
- **File system permission tracking** (User Feedback Issue #1) to detect read-only folder handles before recording starts

## Public API

### Types

| Type                    | Description                                               |
| :---------------------- | :-------------------------------------------------------- |
| `PermissionStatus`      | Status of a single permission (supported, granted, error) |
| `PermissionCheckResult` | Aggregated status of all mandatory permissions            |

### Functions

| Function                          | Signature                                                            | Description                                                                                                                                                                                                                                                                                  |
| :-------------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkWebXRSupport`               | `() => Promise<PermissionStatus>`                                    | Check WebXR immersive-ar support (no prompt). Uses the timeout-guarded [`ar/webxr-support-probe.ts`](../ar/webxr-support-probe.ts.md) — a never-answering OS XR runtime degrades to supported:false with the transient try-again message instead of hanging every consumer boot (2026-07-24) |
| `checkGeolocationPermission`      | `() => Promise<PermissionStatus>`                                    | Check geolocation status (no prompt)                                                                                                                                                                                                                                                         |
| `requestGeolocationPermission`    | `(timeoutMs?: number) => Promise<PermissionStatus>`                  | Request geolocation with prompt                                                                                                                                                                                                                                                              |
| `checkCameraPermission`           | `() => Promise<PermissionStatus>`                                    | Check camera status (no prompt)                                                                                                                                                                                                                                                              |
| `requestCameraPermission`         | `() => Promise<PermissionStatus>`                                    | Request camera with prompt                                                                                                                                                                                                                                                                   |
| `checkOrientationPermission`      | `() => Promise<PermissionStatus>`                                    | Check device orientation status                                                                                                                                                                                                                                                              |
| `requestOrientationPermission`    | `() => Promise<PermissionStatus>`                                    | Request orientation (iOS 13+)                                                                                                                                                                                                                                                                |
| `checkFileSystemPermission`       | `() => PermissionStatus`                                             | Check file system access status (sync)                                                                                                                                                                                                                                                       |
| `setFileSystemState`              | `(state: Partial<FileSystemState>) => void`                          | Update file system permission state                                                                                                                                                                                                                                                          |
| `resetFileSystemState`            | `() => void`                                                         | Reset file system state (for testing)                                                                                                                                                                                                                                                        |
| `checkAllPermissions`             | `() => Promise<PermissionCheckResult>`                               | Check all permissions without prompts                                                                                                                                                                                                                                                        |
| `requestAllPermissions`           | `() => Promise<PermissionCheckResult>`                               | Request all pending permissions incl. depth probe                                                                                                                                                                                                                                            |
| `requestWebXRWithDepthPermission` | `() => Promise<PermissionStatus>`                                    | Start probe XR session to trigger depth prompt                                                                                                                                                                                                                                               |
| `subscribePermissionChanges`      | `(cb: (r: PermissionCheckResult) => void) => PermissionSubscription` | Re-run `checkAllPermissions` on Permissions API `change`, page visibility, and window focus events                                                                                                                                                                                           |

## Invariants & Assumptions

- **Mandatory permissions**: WebXR, Geolocation, Camera, FileSystem must all be granted for AR to work
- **Optional permission**: Device orientation (compass) is recommended but not blocking
- **Depth-sensing probe**: `requestAllPermissions` now starts a short XR session to trigger the "3D map" permission, then immediately ends it
- **Request order (GPS last)**: `requestAllPermissions` prompts in a fixed order — WebXR/depth → Camera → Orientation → **Geolocation last** (D6 item 2, 2026-06-16 RecorderApp user feedback). The AR essentials are requested before Location so GPS doesn't interrupt the AR+camera flow. Locked by the `requests GPS last` test. Consumer apps that surface permission rows should mirror this order.
- **File system state**: Unlike other permissions, file system status is tracked via `setFileSystemState()` called by file-system.ts after folder selection and write verification
- **No prompts on check**: `check*` functions use Permissions API and never trigger browser prompts
- **Prompts on request**: `request*` functions will trigger browser permission prompts
- **Permission persistence**: Once the user grants depth-sensing, subsequent `requestSession()` calls won't re-prompt

## Examples

### Check permissions on page load

```typescript
import { checkAllPermissions } from './sensors/permission-checker';

const result = await checkAllPermissions();
if (!result.allMandatoryReady) {
  // Show permission UI to user
}
```

### Request all pending permissions

```typescript
import { requestAllPermissions } from './sensors/permission-checker';

const result = await requestAllPermissions();
if (result.allMandatoryReady) {
  // All permissions granted, can enter AR
} else {
  // Show specific error for each denied permission
  if (!result.geolocation.granted) {
    console.error(result.geolocation.error);
  }
}
```

## Tests

- Unit tests: `permission-checker.test.ts`
- E2E tests: Covered in `enter-ar-flow.spec.js` permission scenarios
