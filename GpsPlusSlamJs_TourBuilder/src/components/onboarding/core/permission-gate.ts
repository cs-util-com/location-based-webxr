/**
 * Onboarding permissions gate — the pure heart of component 9 (TASK.md §2.3).
 * Start is only enabled once the browser itself has reported both camera and
 * GPS as granted; there is no user-ticked checkbox anywhere in this state.
 *
 * Framework-free: no browser APIs, no DOM. `view/onboarding-adapter.ts` maps
 * the framework's `PermissionStatus` onto the actions below; this module
 * never calls `getUserMedia`/`geolocation` itself.
 *
 * @see plans/2026-08-07-onboarding-plan.md
 */

export type PermissionState = "unknown" | "requesting" | "granted" | "denied";

export type PermissionKind = "camera" | "gps";

export interface GateState {
  readonly camera: PermissionState;
  readonly gps: PermissionState;
  readonly cameraMessage?: string | undefined;
  readonly gpsMessage?: string | undefined;
  readonly audioUnlocked: boolean;
  /** Kinds Start waits on and Grant Access prompts for. Authoring needs GPS
   *  only; viewing needs both. */
  readonly required: readonly PermissionKind[];
}

export const ALL_PERMISSIONS: readonly PermissionKind[] = ["camera", "gps"];

export function createInitialGateState(
  required: readonly PermissionKind[] = ALL_PERMISSIONS,
): GateState {
  return {
    camera: "unknown",
    gps: "unknown",
    audioUnlocked: false,
    required,
  };
}

export const initialGateState: GateState = createInitialGateState();

export type GateAction =
  | { readonly type: "grantAccessRequested" }
  | {
      readonly type: "permissionResult";
      readonly kind: PermissionKind;
      readonly granted: boolean;
      readonly message?: string | undefined;
    }
  | { readonly type: "audioUnlocked"; readonly unlocked: boolean };

export function gateReducer(state: GateState, action: GateAction): GateState {
  switch (action.type) {
    case "grantAccessRequested":
      return {
        ...state,
        ...(state.required.includes("camera")
          ? { camera: "requesting", cameraMessage: undefined }
          : {}),
        ...(state.required.includes("gps")
          ? { gps: "requesting", gpsMessage: undefined }
          : {}),
      };
    case "permissionResult": {
      const status: PermissionState = action.granted ? "granted" : "denied";
      return action.kind === "camera"
        ? { ...state, camera: status, cameraMessage: action.message }
        : { ...state, gps: status, gpsMessage: action.message };
    }
    case "audioUnlocked":
      return { ...state, audioUnlocked: action.unlocked };
  }
}

export function canGrantAccess(state: GateState): boolean {
  return state.required.every((kind) => state[kind] !== "requesting");
}

export function canStart(state: GateState): boolean {
  return state.required.every((kind) => state[kind] === "granted");
}

export function explanationFor(
  state: GateState,
  kind: PermissionKind,
): string | null {
  if (kind === "camera") {
    return state.camera === "denied" ? (state.cameraMessage ?? null) : null;
  }
  return state.gps === "denied" ? (state.gpsMessage ?? null) : null;
}
