/**
 * Tests for `detectArSupport`.
 *
 * Why this test matters:
 * This single signal decides which whole path the demo runs (live AR vs. desktop
 * replay). It must be robustly defensive: a browser with no WebXR, or one whose
 * capability probe throws, must fall back to the replay path rather than crash on
 * startup — so every non-`true` branch is pinned here.
 */

import { describe, it, expect, vi } from "vitest";
import { detectArSupport, applyModeEntry } from "./mode-detection";

describe("detectArSupport", () => {
  it("returns false when navigator.xr is absent", async () => {
    expect(await detectArSupport(undefined)).toBe(false);
  });

  it("returns false when isSessionSupported is missing", async () => {
    expect(await detectArSupport({})).toBe(false);
  });

  it("returns true when immersive-ar is supported", async () => {
    const xr = { isSessionSupported: vi.fn().mockResolvedValue(true) };
    expect(await detectArSupport(xr)).toBe(true);
    expect(xr.isSessionSupported).toHaveBeenCalledWith("immersive-ar");
  });

  it("returns false when immersive-ar is unsupported", async () => {
    expect(
      await detectArSupport({
        isSessionSupported: () => Promise.resolve(false),
      }),
    ).toBe(false);
  });

  it("returns false when the probe rejects (no crash)", async () => {
    expect(
      await detectArSupport({
        isSessionSupported: () => Promise.reject(new Error("nope")),
      }),
    ).toBe(false);
  });
});

describe("applyModeEntry", () => {
  // Why this test matters: user feedback #4 (2026-07-15) — the mode screen must
  // offer EXACTLY ONE entry path. Before this seam the recording file-row was
  // always visible and only "Start AR" was conditionally revealed, so a
  // WebXR-capable phone showed BOTH. These two branches pin the either-or.
  it("shows only Start AR (hides the file-row) on a WebXR-capable device", () => {
    const startArButton = { hidden: true };
    const fileRow = { hidden: false };
    applyModeEntry(true, { startArButton, fileRow });
    expect(startArButton.hidden).toBe(false);
    expect(fileRow.hidden).toBe(true);
  });

  it("shows only the file-row (Start AR hidden) on the desktop", () => {
    const startArButton = { hidden: false };
    const fileRow = { hidden: true };
    applyModeEntry(false, { startArButton, fileRow });
    expect(startArButton.hidden).toBe(true);
    expect(fileRow.hidden).toBe(false);
  });
});
