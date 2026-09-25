/**
 * @vitest-environment jsdom
 */
import { AudioContext as ThreeAudioContext } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSceneAudioListener } from "./audio-listener.js";

/** Minimal stand-in for a real (unlocked) Web Audio context. */
function fakeAudioContext(label: string) {
  const context = {
    label,
    state: "running" as const,
    destination: { label: `${label}-destination` },
    createGain: vi.fn(),
  };
  context.createGain.mockImplementation(() => ({
    context,
    connect: vi.fn(),
    gain: { value: 1 },
  }));
  return context as unknown as AudioContext & { label: string };
}

afterEach(() => {
  // Leave no global context behind for the next test file.
  ThreeAudioContext.setContext(undefined as unknown as AudioContext);
});

describe("createSceneAudioListener", () => {
  it("binds the listener to the unlocked context", () => {
    const unlocked = fakeAudioContext("unlocked");

    const listener = createSceneAudioListener(unlocked);

    expect(listener.context).toBe(unlocked);
  });

  it("builds the listener's gain node on the unlocked context (R4)", () => {
    // The assertion that fails under `listener.context = unlocked`: the gain
    // node — and therefore every PositionalAudio built from this listener —
    // would still live on three's own, still-locked context, and the visitor
    // would hear nothing while no error is raised anywhere.
    const stale = fakeAudioContext("stale");
    ThreeAudioContext.setContext(stale);
    const unlocked = fakeAudioContext("unlocked");

    const listener = createSceneAudioListener(unlocked);

    expect(listener.gain.context).toBe(unlocked);
    expect(stale.createGain).not.toHaveBeenCalled();
  });

  it("connects the gain node to the unlocked context's destination", () => {
    const unlocked = fakeAudioContext("unlocked");

    const listener = createSceneAudioListener(unlocked);

    expect(listener.gain.connect).toHaveBeenCalledWith(unlocked.destination);
  });
});
