// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { swapScreen } from "./screen-transition.js";

describe("swapScreen", () => {
  it("adds the exit class, then removes the outgoing element and mounts the next screen once the exit animation ends", () => {
    const outgoing = document.createElement("div");
    document.body.appendChild(outgoing);
    const mountIncoming = vi.fn();

    swapScreen(outgoing, mountIncoming);

    expect(outgoing.classList.contains("screen-exit")).toBe(true);
    expect(mountIncoming).not.toHaveBeenCalled();
    expect(outgoing.isConnected).toBe(true);

    outgoing.dispatchEvent(new Event("animationend"));

    expect(outgoing.isConnected).toBe(false);
    expect(mountIncoming).toHaveBeenCalledTimes(1);
  });

  it("only fires mountIncoming once even if animationend fires twice", () => {
    const outgoing = document.createElement("div");
    document.body.appendChild(outgoing);
    const mountIncoming = vi.fn();

    swapScreen(outgoing, mountIncoming);
    outgoing.dispatchEvent(new Event("animationend"));
    outgoing.dispatchEvent(new Event("animationend"));

    expect(mountIncoming).toHaveBeenCalledTimes(1);
  });
});
