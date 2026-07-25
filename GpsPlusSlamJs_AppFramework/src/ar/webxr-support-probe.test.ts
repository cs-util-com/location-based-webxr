/**
 * Tests for the timeout-guarded immersive-ar support probe.
 *
 * Why this suite matters: on 2026-07-24 a wedged OS XR runtime made
 * `navigator.xr.isSessionSupported('immersive-ar')` NEVER settle (while
 * `'inline'` resolved instantly) — and every caller that awaited it bare
 * hung its app's entire boot: the recorder never reached the replay-mode
 * switch and the wayfinding demo never built its canvas. The probe must
 * therefore treat "no answer within the timeout" as "not supported" instead
 * of propagating the hang. A browser API is a module boundary — validate
 * its behavior, including the failure mode where it simply never answers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  probeImmersiveArSupport,
  probeImmersiveArSupportOutcome,
  WEBXR_SUPPORT_PROBE_TIMEOUT_MS,
} from './webxr-support-probe';

afterEach(() => {
  vi.useRealTimers();
});

describe('probeImmersiveArSupport', () => {
  it('resolves false when no XR system is available', async () => {
    await expect(probeImmersiveArSupport({ xr: undefined })).resolves.toBe(
      false
    );
  });

  it('resolves false when isSessionSupported is missing', async () => {
    await expect(probeImmersiveArSupport({ xr: {} })).resolves.toBe(false);
  });

  it('resolves true when the browser reports immersive-ar support', async () => {
    const xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };
    await expect(probeImmersiveArSupport({ xr })).resolves.toBe(true);
    expect(xr.isSessionSupported).toHaveBeenCalledWith('immersive-ar');
  });

  it('resolves false when the browser reports no support', async () => {
    const xr = { isSessionSupported: vi.fn().mockResolvedValue(false) };
    await expect(probeImmersiveArSupport({ xr })).resolves.toBe(false);
  });

  // 'error' vs 'timeout' vs 'unsupported' matter to the permission checker:
  // only a confirmed 'unsupported' earns the "install ARCore" guidance —
  // error/timeout keep the transient "try again" framing.
  it("resolves false with outcome 'error' when the probe rejects", async () => {
    const xr = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('nope')),
    };
    await expect(probeImmersiveArSupport({ xr })).resolves.toBe(false);
    const rejecting = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('nope')),
    };
    await expect(
      probeImmersiveArSupportOutcome({ xr: rejecting })
    ).resolves.toBe('error');
  });

  // The 2026-07-24 field failure: the promise never settles. The probe must
  // give up after the timeout instead of hanging every consumer's boot.
  it("resolves false with outcome 'timeout' when isSessionSupported never settles", async () => {
    vi.useFakeTimers();
    const xr = {
      isSessionSupported: vi
        .fn()
        .mockReturnValue(new Promise<boolean>(() => {})),
    };
    const result = probeImmersiveArSupport({ xr });
    const outcome = probeImmersiveArSupportOutcome({ xr });
    await vi.advanceTimersByTimeAsync(WEBXR_SUPPORT_PROBE_TIMEOUT_MS + 1);
    await expect(result).resolves.toBe(false);
    await expect(outcome).resolves.toBe('timeout');
  });

  it('honors a caller-provided timeout', async () => {
    vi.useFakeTimers();
    const xr = {
      isSessionSupported: vi
        .fn()
        .mockReturnValue(new Promise<boolean>(() => {})),
    };
    const result = probeImmersiveArSupport({ xr, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);
    await expect(result).resolves.toBe(false);
  });
});
