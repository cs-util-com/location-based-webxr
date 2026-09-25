import { describe, expect, it, vi } from "vitest";

import type { GateAction } from "../core/permission-gate.js";
import {
  checkExistingPermissions,
  requestPermissions,
  type OnboardingAdapterDeps,
  type PermissionStatus,
} from "./onboarding-adapter.js";

/**
 * Why these tests matter: the adapter is the only place component 9 touches
 * the framework's `permission-checker` (plan §"Reuse: the framework already
 * owns permission requests"). Two behaviors are worth pinning here: the
 * granted/denied/unsupported mapping onto `permissionResult`, and the O3
 * sequencing (camera before GPS) — a `Promise.all` regression would still
 * satisfy every other assertion, so call order gets its own test.
 */

function harness(overrides: Partial<OnboardingAdapterDeps> = {}) {
  const actions: GateAction[] = [];
  const deps: OnboardingAdapterDeps = {
    checkCameraPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
    ),
    checkGeolocationPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
    ),
    requestCameraPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: true }),
    ),
    requestGeolocationPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: true }),
    ),
    dispatch: (action) => actions.push(action),
    ...overrides,
  };
  return { deps, actions };
}

describe("checkExistingPermissions", () => {
  it("dispatches granted for each already-granted permission", async () => {
    const { deps, actions } = harness({
      checkCameraPermission: () =>
        Promise.resolve({ supported: true, granted: true }),
      checkGeolocationPermission: () =>
        Promise.resolve({ supported: true, granted: true }),
    });

    await checkExistingPermissions(deps);

    expect(actions).toEqual([
      {
        type: "permissionResult",
        kind: "camera",
        granted: true,
        message: undefined,
      },
      {
        type: "permissionResult",
        kind: "gps",
        granted: true,
        message: undefined,
      },
    ]);
  });

  it("maps a denied status to a denied result carrying its message", async () => {
    const { deps, actions } = harness({
      checkCameraPermission: () =>
        Promise.resolve({
          supported: true,
          granted: false,
          error: "Camera access denied. Please enable in browser settings.",
        }),
    });

    await checkExistingPermissions(deps);

    expect(actions[0]).toEqual({
      type: "permissionResult",
      kind: "camera",
      granted: false,
      message: "Camera access denied. Please enable in browser settings.",
    });
  });

  it("maps an unsupported browser (granted: null) to denied with the framework's message", async () => {
    const { deps, actions } = harness({
      checkGeolocationPermission: () =>
        Promise.resolve({
          supported: false,
          granted: null,
          error: "Geolocation API not available in this browser.",
        }),
    });

    await checkExistingPermissions(deps);

    expect(actions[1]).toEqual({
      type: "permissionResult",
      kind: "gps",
      granted: false,
      message: "Geolocation API not available in this browser.",
    });
  });
});

describe("requestPermissions", () => {
  it("dispatches grantAccessRequested first, then both results", async () => {
    const { deps, actions } = harness();

    await requestPermissions(deps);

    expect(actions[0]).toEqual({ type: "grantAccessRequested" });
    expect(actions).toContainEqual({
      type: "permissionResult",
      kind: "camera",
      granted: true,
      message: undefined,
    });
    expect(actions).toContainEqual({
      type: "permissionResult",
      kind: "gps",
      granted: true,
      message: undefined,
    });
  });

  it("requests camera before geolocation (O3 — avoids stacking two native prompts)", async () => {
    const order: string[] = [];
    const { deps } = harness({
      requestCameraPermission: () => {
        order.push("camera");
        return Promise.resolve({ supported: true, granted: true });
      },
      requestGeolocationPermission: () => {
        order.push("gps");
        return Promise.resolve({ supported: true, granted: true });
      },
    });

    await requestPermissions(deps);

    expect(order).toEqual(["camera", "gps"]);
  });

  it("a rejected framework call maps to a denied result instead of throwing", async () => {
    const { deps, actions } = harness({
      requestCameraPermission: () => Promise.reject(new Error("boom")),
    });

    await expect(requestPermissions(deps)).resolves.toBeUndefined();
    expect(actions).toContainEqual({
      type: "permissionResult",
      kind: "camera",
      granted: false,
      message: "boom",
    });
  });
});

describe("gps-only (no camera dependencies)", () => {
  it("never checks or requests the camera", async () => {
    const { deps, actions } = harness({
      required: ["gps"],
      checkCameraPermission: undefined,
      requestCameraPermission: undefined,
    });

    await checkExistingPermissions(deps);
    await requestPermissions(deps);

    const kinds = actions.flatMap((a) =>
      a.type === "permissionResult" ? [a.kind] : [],
    );
    expect(kinds).toEqual(["gps", "gps"]);
  });
});
