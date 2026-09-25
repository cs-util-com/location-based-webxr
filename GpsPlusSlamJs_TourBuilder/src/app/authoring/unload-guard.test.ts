/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disableBeforeUnloadWarning,
  enableBeforeUnloadWarning,
} from "./unload-guard.js";

afterEach(() => {
  disableBeforeUnloadWarning();
});

describe("enableBeforeUnloadWarning", () => {
  it("prevents unload when shouldWarn() is true at fire time", () => {
    enableBeforeUnloadWarning(() => true);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not prevent unload when shouldWarn() is false at fire time", () => {
    enableBeforeUnloadWarning(() => false);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("re-evaluates shouldWarn() on every fire, not just at registration", () => {
    let warn = false;
    enableBeforeUnloadWarning(() => warn);

    const first = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);

    warn = true;
    const second = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
  });

  it("does not double-register when called twice", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    enableBeforeUnloadWarning(() => true);
    enableBeforeUnloadWarning(() => true);

    const beforeUnloadCalls = addSpy.mock.calls.filter(
      ([type]) => type === "beforeunload",
    );
    expect(beforeUnloadCalls).toHaveLength(1);

    addSpy.mockRestore();
  });
});

describe("disableBeforeUnloadWarning", () => {
  it("allows unload after disabling", () => {
    enableBeforeUnloadWarning(() => true);
    disableBeforeUnloadWarning();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op when not enabled", () => {
    expect(() => disableBeforeUnloadWarning()).not.toThrow();
  });
});
