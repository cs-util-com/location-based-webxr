import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCtaDeviceClaim,
  AR_SUPPORT_PROBE_TIMEOUT_MS,
  CTA_CLAIM_CAPABLE,
  CTA_CLAIM_ELEMENT_ID,
  detectImmersiveArSupport,
} from "./ar-support";

afterEach(() => {
  vi.useRealTimers();
});

// Why this test matters: the CTA's "run on your phone right now" claim is
// only true on devices with immersive-ar WebXR (round-8 Z6). The static
// HTML ships the universally-true Android+Chrome sentence and this module
// upgrades it ONLY on capable devices — a wrong detection result would
// either overpromise (iOS/desktop reading "right now") or waste the
// strongest hook on the exact users who could tap a demo immediately.
// navigator.xr is untrusted input: absent, malformed, or throwing — every
// path must resolve to a boolean, never throw.

describe("detectImmersiveArSupport", () => {
  it("is false when navigator.xr is missing (iOS Safari, desktop Firefox)", async () => {
    await expect(detectImmersiveArSupport(undefined)).resolves.toBe(false);
    await expect(detectImmersiveArSupport(null)).resolves.toBe(false);
  });

  it("is false when xr lacks a callable isSessionSupported", async () => {
    await expect(detectImmersiveArSupport({} as never)).resolves.toBe(false);
  });

  it("mirrors the browser's immersive-ar answer", async () => {
    await expect(
      detectImmersiveArSupport({
        isSessionSupported: (mode: string) =>
          Promise.resolve(mode === "immersive-ar"),
      }),
    ).resolves.toBe(true);
    await expect(
      detectImmersiveArSupport({
        isSessionSupported: () => Promise.resolve(false),
      }),
    ).resolves.toBe(false);
  });

  it("treats a rejecting isSessionSupported as unsupported (SecurityError etc.)", async () => {
    await expect(
      detectImmersiveArSupport({
        isSessionSupported: () => Promise.reject(new Error("denied")),
      }),
    ).resolves.toBe(false);
  });

  // Why this test matters: on 2026-07-24 a wedged OS XR runtime made the real
  // browser's isSessionSupported('immersive-ar') NEVER settle — a bare await
  // hung the CTA upgrade forever and the desktop QR-handoff e2e failed. The
  // probe must give up after the timeout and keep the honest static claim.
  it("treats a never-settling isSessionSupported as unsupported (timeout)", async () => {
    vi.useFakeTimers();
    const result = detectImmersiveArSupport({
      isSessionSupported: () => new Promise<boolean>(() => {}),
    });
    await vi.advanceTimersByTimeAsync(AR_SUPPORT_PROBE_TIMEOUT_MS + 1);
    await expect(result).resolves.toBe(false);
  });
});

describe("applyCtaDeviceClaim", () => {
  // The unit suite runs in plain node (no DOM env) — a minimal element
  // stub is all applyCtaDeviceClaim touches (textContent only).
  function docWithClaim(): {
    doc: Pick<Document, "getElementById">;
    el: { textContent: string | null };
  } {
    const el = {
      textContent: "The demos below run on Android phones with Chrome",
    };
    return {
      doc: {
        getElementById: (id: string) =>
          id === CTA_CLAIM_ELEMENT_ID ? (el as unknown as HTMLElement) : null,
      },
      el,
    };
  }

  it("upgrades the claim on capable devices", () => {
    const { doc, el } = docWithClaim();
    applyCtaDeviceClaim(doc, true);
    expect(el.textContent).toBe(CTA_CLAIM_CAPABLE);
  });

  it("keeps the honest static default on unsupported devices", () => {
    const { doc, el } = docWithClaim();
    const before = el.textContent;
    applyCtaDeviceClaim(doc, false);
    expect(el.textContent).toBe(before);
  });

  it("tolerates a missing claim element (degrade, never crash)", () => {
    expect(() =>
      applyCtaDeviceClaim({ getElementById: () => null }, true),
    ).not.toThrow();
  });
});
