/**
 * Unit tests for mode detection.
 *
 * Why these tests matter: the demo must never crash on a browser without
 * WebXR — a missing/throwing probe routes to the desktop simulator — and the
 * mode screen is either-or: exactly one entry path (Start AR / simulator
 * hint) may be visible, mirroring the PhysicsDemo convention.
 */
import { describe, expect, it } from "vitest";

import { applyModeEntry, detectArSupport } from "./mode-detection";

describe("detectArSupport", () => {
  it("resolves false when navigator.xr is missing", async () => {
    await expect(detectArSupport(undefined)).resolves.toBe(false);
  });

  it("resolves false when isSessionSupported is missing", async () => {
    await expect(detectArSupport({})).resolves.toBe(false);
  });

  it("resolves false when the probe rejects", async () => {
    await expect(
      detectArSupport({
        isSessionSupported: () => Promise.reject(new Error("nope")),
      }),
    ).resolves.toBe(false);
  });

  it("resolves the probe result for immersive-ar", async () => {
    await expect(
      detectArSupport({
        isSessionSupported: (mode) => Promise.resolve(mode === "immersive-ar"),
      }),
    ).resolves.toBe(true);
  });
});

describe("applyModeEntry", () => {
  it("shows only Start AR on a capable device", () => {
    const startArButton = { hidden: true };
    const simNote = { hidden: false };
    applyModeEntry(true, { startArButton, simNote });
    expect(startArButton.hidden).toBe(false);
    expect(simNote.hidden).toBe(true);
  });

  it("shows only the simulator hint on the desktop", () => {
    const startArButton = { hidden: false };
    const simNote = { hidden: true };
    applyModeEntry(false, { startArButton, simNote });
    expect(startArButton.hidden).toBe(true);
    expect(simNote.hidden).toBe(false);
  });
});
