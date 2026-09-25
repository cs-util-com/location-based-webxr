import { describe, expect, it } from "vitest";

import {
  canGrantAccess,
  canStart,
  explanationFor,
  gateReducer,
  createInitialGateState,
  initialGateState,
  type GateState,
} from "./permission-gate.js";

/**
 * Why these tests matter: TASK.md §2.3 component 9 requires Start to stay
 * disabled until the browser itself reports both camera and GPS as granted
 * (never a user-ticked checkbox), and a denied item to show its explanation.
 * This is the pure state machine behind that rule — no browser APIs, no DOM.
 */

describe("initialGateState", () => {
  it("starts unknown, cannot start, no explanations", () => {
    expect(initialGateState.camera).toBe("unknown");
    expect(initialGateState.gps).toBe("unknown");
    expect(initialGateState.audioUnlocked).toBe(false);
    expect(canStart(initialGateState)).toBe(false);
    expect(canGrantAccess(initialGateState)).toBe(true);
    expect(explanationFor(initialGateState, "camera")).toBeNull();
    expect(explanationFor(initialGateState, "gps")).toBeNull();
  });
});

describe("grantAccessRequested", () => {
  it("moves both items to requesting and disables another grant", () => {
    const next = gateReducer(initialGateState, {
      type: "grantAccessRequested",
    });
    expect(next.camera).toBe("requesting");
    expect(next.gps).toBe("requesting");
    expect(canGrantAccess(next)).toBe(false);
  });
});

describe("permissionResult", () => {
  const requesting = gateReducer(initialGateState, {
    type: "grantAccessRequested",
  });

  it("resolving only one kind leaves canStart false and the other kind untouched", () => {
    const next = gateReducer(requesting, {
      type: "permissionResult",
      kind: "camera",
      granted: true,
    });
    expect(next.camera).toBe("granted");
    expect(next.gps).toBe("requesting");
    expect(canStart(next)).toBe(false);
  });

  it("both granted enables Start", () => {
    let next = gateReducer(requesting, {
      type: "permissionResult",
      kind: "camera",
      granted: true,
    });
    next = gateReducer(next, {
      type: "permissionResult",
      kind: "gps",
      granted: true,
    });
    expect(canStart(next)).toBe(true);
  });

  it("a denied result carries its message through unchanged (no core-invented copy)", () => {
    const next = gateReducer(requesting, {
      type: "permissionResult",
      kind: "camera",
      granted: false,
      message: "Camera access denied. Please enable in browser settings.",
    });
    expect(next.camera).toBe("denied");
    expect(explanationFor(next, "camera")).toBe(
      "Camera access denied. Please enable in browser settings.",
    );
    expect(canStart(next)).toBe(false);
  });

  it("explanationFor is null for a granted item even if a stale message lingers", () => {
    let state: GateState = gateReducer(requesting, {
      type: "permissionResult",
      kind: "camera",
      granted: false,
      message: "denied once",
    });
    state = gateReducer(state, {
      type: "grantAccessRequested",
    });
    state = gateReducer(state, {
      type: "permissionResult",
      kind: "camera",
      granted: true,
    });
    expect(explanationFor(state, "camera")).toBeNull();
  });

  it("re-requesting after a denial clears the stale message until the new result arrives", () => {
    const denied = gateReducer(requesting, {
      type: "permissionResult",
      kind: "camera",
      granted: false,
      message: "denied once",
    });
    const retrying = gateReducer(denied, { type: "grantAccessRequested" });
    expect(retrying.camera).toBe("requesting");
    expect(explanationFor(retrying, "camera")).toBeNull();
  });
});

describe("audioUnlocked", () => {
  it("only flips the audio flag, independent of camera/gps state", () => {
    const next = gateReducer(initialGateState, {
      type: "audioUnlocked",
      unlocked: true,
    });
    expect(next.audioUnlocked).toBe(true);
    expect(next.camera).toBe("unknown");
    expect(next.gps).toBe("unknown");
    expect(canStart(next)).toBe(false);
  });
});

describe("gps-only gate (authoring needs no camera)", () => {
  const gpsOnly = createInitialGateState(["gps"]);

  it("grantAccessRequested only moves the required kinds", () => {
    const next = gateReducer(gpsOnly, { type: "grantAccessRequested" });
    expect(next.gps).toBe("requesting");
    expect(next.camera).toBe("unknown");
  });

  it("Start enables on GPS alone, whatever the camera state", () => {
    const next = gateReducer(gpsOnly, {
      type: "permissionResult",
      kind: "gps",
      granted: true,
    });
    expect(canStart(next)).toBe(true);
  });

  it("a denied camera does not block Start", () => {
    let next = gateReducer(gpsOnly, {
      type: "permissionResult",
      kind: "camera",
      granted: false,
    });
    next = gateReducer(next, {
      type: "permissionResult",
      kind: "gps",
      granted: true,
    });
    expect(canStart(next)).toBe(true);
  });

  it("Start stays disabled until GPS is granted", () => {
    expect(canStart(gpsOnly)).toBe(false);
  });
});
