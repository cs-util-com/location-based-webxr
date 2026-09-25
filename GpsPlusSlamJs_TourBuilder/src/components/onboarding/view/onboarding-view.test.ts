/**
 * `mountOnboardingGate` DOM wiring tests. jsdom, no real browser APIs — the
 * four framework permission calls and `AudioContext` are all injected.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PermissionStatus } from "./onboarding-adapter.js";
import {
  mountOnboardingGate,
  type OnboardingGateDeps,
} from "./onboarding-view.js";

function granted(): Promise<PermissionStatus> {
  return Promise.resolve({ supported: true, granted: true });
}

function denied(message: string): Promise<PermissionStatus> {
  return Promise.resolve({ supported: true, granted: false, error: message });
}

function makeAudioContext(finalState: "running" | "suspended" = "running") {
  const ctx = {
    state: "suspended" as AudioContextState,
    resume: vi.fn(() => {
      ctx.state = finalState;
      return Promise.resolve();
    }),
  };
  return ctx as unknown as AudioContext;
}

function harness(overrides: Partial<OnboardingGateDeps> = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const onComplete = vi.fn();
  const deps: OnboardingGateDeps = {
    checkCameraPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
    ),
    checkGeolocationPermission: vi.fn(() =>
      Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
    ),
    requestCameraPermission: vi.fn(() => granted()),
    requestGeolocationPermission: vi.fn(() => granted()),
    createAudioContext: vi.fn(() => makeAudioContext()),
    onComplete,
    ...overrides,
  };
  const gate = mountOnboardingGate(root, deps);
  return { root, deps, gate, onComplete };
}

function startButton(root: HTMLElement): HTMLButtonElement {
  const btn = root.querySelector<HTMLButtonElement>('[data-testid="start"]');
  if (!btn) throw new Error("start button not found");
  return btn;
}

function grantButton(root: HTMLElement): HTMLButtonElement {
  const btn = root.querySelector<HTMLButtonElement>(
    '[data-testid="grant-access"]',
  );
  if (!btn) throw new Error("grant access button not found");
  return btn;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountOnboardingGate", () => {
  it("Start stays disabled until both permissions are granted", async () => {
    const { root, gate } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => granted(),
    });

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    gate.destroy();
  });

  it("Start remains disabled when only one permission is granted", async () => {
    const { root, gate } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => denied("Location access denied."),
    });

    await vi.waitFor(() =>
      expect(root.textContent).toContain("Location access denied."),
    );
    expect(startButton(root).disabled).toBe(true);
    gate.destroy();
  });

  it("renders the red explanation only for a denied item, not a granted one", async () => {
    const { root, gate } = harness({
      checkCameraPermission: () => denied("Camera access denied."),
      checkGeolocationPermission: () => granted(),
    });

    await vi.waitFor(() =>
      expect(root.textContent).toContain("Camera access denied."),
    );
    const gpsRow = root.querySelector('[data-testid="row-gps"]');
    expect(gpsRow?.textContent).not.toContain("denied");
    gate.destroy();
  });

  it("Grant Access sequences camera then geolocation and updates the checklist", async () => {
    const order: string[] = [];
    const { root, gate } = harness({
      requestCameraPermission: () => {
        order.push("camera");
        return Promise.resolve({ supported: true, granted: true });
      },
      requestGeolocationPermission: () => {
        order.push("gps");
        return Promise.resolve({ supported: true, granted: true });
      },
    });

    await vi.waitFor(() => expect(grantButton(root).disabled).toBe(false));
    grantButton(root).click();

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    expect(order).toEqual(["camera", "gps"]);
    gate.destroy();
  });

  it("Start click resumes the injected AudioContext synchronously (O7)", async () => {
    const ctx = makeAudioContext();
    const { root, gate } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => granted(),
      createAudioContext: () => ctx,
    });

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    startButton(root).click();

    // No await between click() and this assertion: resume() must already
    // have been invoked as the handler's first synchronous statement.
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    gate.destroy();
  });

  it("onComplete fires exactly once with the unlocked context", async () => {
    const ctx = makeAudioContext("running");
    const { root, gate, onComplete } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => granted(),
      createAudioContext: () => ctx,
    });

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    startButton(root).click();

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith(ctx);
    gate.destroy();
  });

  it("never calls onComplete when the context stays suspended", async () => {
    const ctx = makeAudioContext("suspended");
    const { root, gate, onComplete } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => granted(),
      createAudioContext: () => ctx,
    });

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    startButton(root).click();

    await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalledTimes(1));
    // Give any (incorrect) async completion a chance to fire before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onComplete).not.toHaveBeenCalled();
    gate.destroy();
  });

  it("calls onStateChange with every new state, for demo/debug state logs", async () => {
    const states: Array<{ camera: string; gps: string }> = [];
    const { root, gate } = harness({
      checkCameraPermission: () => granted(),
      checkGeolocationPermission: () => granted(),
      onStateChange: (state) =>
        states.push({ camera: state.camera, gps: state.gps }),
    });

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));

    expect(states[0]).toEqual({ camera: "unknown", gps: "unknown" });
    expect(states.at(-1)).toEqual({ camera: "granted", gps: "granted" });
    gate.destroy();
  });

  it("destroy() clears the DOM and stops further updates", async () => {
    let resolveCheck!: (status: PermissionStatus) => void;
    const pending = new Promise<PermissionStatus>((resolve) => {
      resolveCheck = resolve;
    });
    const { root, gate } = harness({
      checkCameraPermission: () => pending,
    });

    gate.destroy();
    expect(root.innerHTML).toBe("");

    resolveCheck({ supported: true, granted: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.innerHTML).toBe("");
  });

  it("updates rows in place rather than rebuilding them (so CSS transitions on the icon/status can run)", async () => {
    const { root, gate } = harness({
      checkCameraPermission: () =>
        Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
      checkGeolocationPermission: () =>
        Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
    });

    const rowBefore = root.querySelector('[data-testid="row-camera"]');
    await vi.waitFor(() => expect(grantButton(root).disabled).toBe(false));
    grantButton(root).click();

    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    const rowAfter = root.querySelector('[data-testid="row-camera"]');

    expect(rowAfter).toBe(rowBefore);
    gate.destroy();
  });
});

describe("mountOnboardingGate with required: ['gps']", () => {
  function gpsOnlyHarness() {
    const root = document.createElement("div");
    document.body.append(root);
    const onComplete = vi.fn();
    const gate = mountOnboardingGate(root, {
      required: ["gps"],
      checkGeolocationPermission: () =>
        Promise.resolve<PermissionStatus>({ supported: true, granted: false }),
      requestGeolocationPermission: () => granted(),
      createAudioContext: () => makeAudioContext(),
      onComplete,
    });
    return { root, gate, onComplete };
  }

  it("renders no camera row", () => {
    const { root, gate } = gpsOnlyHarness();
    expect(root.querySelector('[data-testid="row-camera"]')).toBeNull();
    expect(root.querySelector('[data-testid="row-gps"]')).not.toBeNull();
    gate.destroy();
  });

  it("enables Start after granting GPS alone", async () => {
    const { root, gate } = gpsOnlyHarness();
    await vi.waitFor(() => expect(grantButton(root).disabled).toBe(false));
    grantButton(root).click();
    await vi.waitFor(() => expect(startButton(root).disabled).toBe(false));
    gate.destroy();
  });
});
