/**
 * `mountOnboardingGate` — the reusable DOM view for component 9. Renders the
 * camera/GPS checklist, wires the Grant Access + Start buttons, and owns the
 * user gesture that unlocks the injected `AudioContext` on Start. Reused by
 * Goal-2 composition for both Authoring and Viewing bootstrap, not just the
 * demo (plan §Architecture).
 *
 * Rows are built once and updated in place on every state change (icon
 * class/content, status text, explanation) rather than torn down and
 * rebuilt — a freshly-created DOM node can't CSS-transition from a prior
 * state, and permission status changes are rare enough per session that the
 * small extra bookkeeping here is worth it (see
 * plans/2026-09-02-authoring-composition-ui-refresh-design.md, Onboarding
 * gate section).
 *
 * @see plans/2026-08-07-onboarding-plan.md
 */

import { ICONS } from "../../shared/icons.js";
import {
  canGrantAccess,
  canStart,
  explanationFor,
  gateReducer,
  ALL_PERMISSIONS,
  createInitialGateState,
  type GateAction,
  type GateState,
  type PermissionState,
  type PermissionKind,
} from "../core/permission-gate.js";
import {
  checkExistingPermissions,
  requestPermissions,
  type OnboardingAdapterDeps,
  type PermissionStatus,
} from "./onboarding-adapter.js";

export interface OnboardingGateDeps {
  /** Permissions Start waits on; defaults to camera + GPS. Authoring passes
   *  `["gps"]` — it never opens the camera — and may omit the camera deps. */
  readonly required?: readonly PermissionKind[];
  readonly checkCameraPermission?:
    (() => Promise<PermissionStatus>) | undefined;
  readonly checkGeolocationPermission: () => Promise<PermissionStatus>;
  readonly requestCameraPermission?:
    (() => Promise<PermissionStatus>) | undefined;
  readonly requestGeolocationPermission: () => Promise<PermissionStatus>;
  /** Injected so tests never touch real Web Audio. */
  readonly createAudioContext: () => AudioContext;
  /** Fires once, only after the resumed context reports `running`. */
  readonly onComplete: (audioContext: AudioContext) => void;
  /** Optional: every new state, for a demo/debug state log. Not used by
   *  Goal-2 composition — the checklist UI itself is the product surface. */
  readonly onStateChange?: (state: GateState) => void;
}

export interface OnboardingGate {
  readonly destroy: () => void;
}

const PERMISSION_LABEL: Record<PermissionKind, string> = {
  camera: "Camera",
  gps: "Location",
};

const ROW_TESTID: Record<PermissionKind, string> = {
  camera: "row-camera",
  gps: "row-gps",
};

interface RowElements {
  readonly root: HTMLElement;
  readonly icon: HTMLElement;
  readonly explanation: HTMLParagraphElement;
}

function buildRow(kind: PermissionKind): RowElements {
  const row = document.createElement("div");
  row.className = "perm-row";
  row.dataset["testid"] = ROW_TESTID[kind];

  const icon = document.createElement("div");
  icon.className = "perm-icon";

  const body = document.createElement("div");
  body.className = "perm-body";

  const name = document.createElement("div");
  name.className = "perm-name";
  name.textContent = PERMISSION_LABEL[kind];

  const explanation = document.createElement("p");
  explanation.className = "perm-explanation";
  explanation.dataset["testid"] = `explanation-${kind}`;
  explanation.hidden = true;

  body.append(name, explanation);
  row.append(icon, body);

  return { root: row, icon, explanation };
}

function updateRow(
  row: RowElements,
  state: PermissionState,
  message: string | null,
): void {
  row.icon.className = `perm-icon perm-icon-${state}`;
  row.icon.innerHTML =
    state === "requesting"
      ? ICONS.spinner
      : state === "granted"
        ? ICONS.check
        : state === "denied"
          ? ICONS.x
          : "";

  if (message !== null) {
    row.explanation.hidden = false;
    row.explanation.textContent = message;
  } else {
    row.explanation.hidden = true;
    row.explanation.textContent = "";
  }
}

export function mountOnboardingGate(
  root: HTMLElement,
  deps: OnboardingGateDeps,
): OnboardingGate {
  const required = deps.required ?? ALL_PERMISSIONS;
  let state: GateState = createInitialGateState(required);
  let destroyed = false;

  const cameraRow = buildRow("camera");
  const gpsRow = buildRow("gps");

  const grantButton = document.createElement("button");
  grantButton.dataset["testid"] = "grant-access";
  grantButton.textContent = "Grant Access";

  const startButton = document.createElement("button");
  startButton.className = "primary";
  startButton.dataset["testid"] = "start";
  startButton.textContent = "Start";

  const permList = document.createElement("div");
  permList.className = "perm-list";
  if (required.includes("camera")) permList.append(cameraRow.root);
  permList.append(gpsRow.root);

  root.append(permList, grantButton, startButton);

  const dispatch = (action: GateAction): void => {
    if (destroyed) return;
    state = gateReducer(state, action);
    render();
    deps.onStateChange?.(state);
  };

  const adapterDeps: OnboardingAdapterDeps = {
    required,
    checkCameraPermission: deps.checkCameraPermission,
    checkGeolocationPermission: deps.checkGeolocationPermission,
    requestCameraPermission: deps.requestCameraPermission,
    requestGeolocationPermission: deps.requestGeolocationPermission,
    dispatch,
  };

  function render(): void {
    updateRow(cameraRow, state.camera, explanationFor(state, "camera"));
    updateRow(gpsRow, state.gps, explanationFor(state, "gps"));
    grantButton.disabled = !canGrantAccess(state);
    startButton.disabled = !canStart(state);
  }

  grantButton.addEventListener("click", () => {
    void requestPermissions(adapterDeps);
  });
  startButton.addEventListener("click", handleStart);

  function handleStart(): void {
    const audioContext = deps.createAudioContext();
    // O7: resume() must be the click handler's first statement — the Web
    // Audio autoplay policy needs the resume call itself inside the gesture.
    const resumed = audioContext.resume();
    void resumed.then(() => {
      const unlocked = audioContext.state === "running";
      dispatch({ type: "audioUnlocked", unlocked });
      if (unlocked) deps.onComplete(audioContext);
    });
  }

  render();
  deps.onStateChange?.(state);
  void checkExistingPermissions(adapterDeps);

  return {
    destroy(): void {
      destroyed = true;
      root.innerHTML = "";
    },
  };
}
