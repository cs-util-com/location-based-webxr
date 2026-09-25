/**
 * The impure browser-facing half of component 9. Wraps the framework's
 * `permission-checker` (already tested there) and maps its result shape onto
 * `GateAction`s for the pure `core/permission-gate.ts` reducer. This module
 * never calls `getUserMedia`/`geolocation` itself — see plan §"Reuse: the
 * framework already owns permission requests".
 *
 * @see plans/2026-08-07-onboarding-plan.md
 */

import {
  ALL_PERMISSIONS,
  type GateAction,
  type PermissionKind,
} from "../core/permission-gate.js";

/** Matches `gps-plus-slam-app-framework/sensors`'s `PermissionStatus` shape. */
export interface PermissionStatus {
  readonly supported: boolean;
  readonly granted: boolean | null;
  readonly error?: string;
}

export interface OnboardingAdapterDeps {
  /** Kinds to check/request; defaults to camera + GPS. The camera functions
   *  may be omitted when `camera` is not required. */
  readonly required?: readonly PermissionKind[];
  readonly checkCameraPermission?:
    (() => Promise<PermissionStatus>) | undefined;
  readonly checkGeolocationPermission: () => Promise<PermissionStatus>;
  readonly requestCameraPermission?:
    (() => Promise<PermissionStatus>) | undefined;
  readonly requestGeolocationPermission: () => Promise<PermissionStatus>;
  readonly dispatch: (action: GateAction) => void;
}

function toResultAction(
  kind: PermissionKind,
  status: PermissionStatus,
): GateAction {
  return {
    type: "permissionResult",
    kind,
    granted: status.granted === true,
    message: status.granted === true ? undefined : status.error,
  };
}

function isRequired(
  deps: OnboardingAdapterDeps,
  kind: PermissionKind,
): boolean {
  return (deps.required ?? ALL_PERMISSIONS).includes(kind);
}

/** O4: non-prompting check for both, run once on mount. */
export async function checkExistingPermissions(
  deps: OnboardingAdapterDeps,
): Promise<void> {
  if (isRequired(deps, "camera") && deps.checkCameraPermission) {
    const camera = await deps.checkCameraPermission();
    deps.dispatch(toResultAction("camera", camera));
  }
  const gps = await deps.checkGeolocationPermission();
  deps.dispatch(toResultAction("gps", gps));
}

async function requestOne(
  kind: PermissionKind,
  request: () => Promise<PermissionStatus>,
  dispatch: (action: GateAction) => void,
): Promise<void> {
  try {
    const status = await request();
    dispatch(toResultAction(kind, status));
  } catch (err) {
    dispatch({
      type: "permissionResult",
      kind,
      granted: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** O3/O5: sequential prompting request pair, fired by the Grant Access click. */
export async function requestPermissions(
  deps: OnboardingAdapterDeps,
): Promise<void> {
  deps.dispatch({ type: "grantAccessRequested" });
  if (isRequired(deps, "camera") && deps.requestCameraPermission) {
    await requestOne("camera", deps.requestCameraPermission, deps.dispatch);
  }
  await requestOne("gps", deps.requestGeolocationPermission, deps.dispatch);
}
