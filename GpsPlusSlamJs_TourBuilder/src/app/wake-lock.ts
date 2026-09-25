/**
 * Screen Wake Lock, shared by both composed app modes (authoring plan AC11,
 * viewing plan VC16 — it lives at `src/app/` because both use it). The phone
 * screen
 * sleeping mid-walk stalls the live GPS position source silently — a real
 * field-failure mode. Feature-detected and non-fatal: an unsupported browser
 * or a rejected request degrades to "no wake lock," never a crash.
 *
 * Viewing mode uses it on the non-immersive screens only (loader, tour-entry
 * overview); an immersive WebXR session keeps the display awake by itself.
 */

export interface WakeLockHandle {
  release(): void;
}

const noopHandle: WakeLockHandle = { release() {} };

export async function requestWakeLock(): Promise<WakeLockHandle> {
  if (!("wakeLock" in navigator)) return noopHandle;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    return {
      release() {
        void sentinel.release();
      },
    };
  } catch {
    return noopHandle;
  }
}
