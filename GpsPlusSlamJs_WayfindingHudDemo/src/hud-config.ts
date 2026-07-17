/**
 * HUD demo configuration — the slider-driven subset of the framework's
 * WayfindingHudOptions, with per-mode defaults and defensive sanitising.
 *
 * The demo re-creates the HUD whenever a slider changes, so every value that
 * reaches `createWayfindingHud` flows through `sanitizeHudDemoConfig` first —
 * the framework throws on malformed ranges (by design), and a slider glitch
 * must degrade to a clamped value, not a dead HUD.
 */

export interface HudDemoConfig {
  /** Distance (m) below which a visible indicator hides ("arrived"). */
  distanceMin: number;
  /** Distance (m) a hidden target must reach before it reactivates. */
  distanceMax: number;
  /** Uniform scale multiplier for the arrow/ring indicators. */
  indicatorScale: number;
}

/** Real-world walking distances — the AR tap-to-place mode. */
export const AR_HUD_CONFIG: HudDemoConfig = {
  distanceMin: 1.5,
  distanceMax: 3.0,
  indicatorScale: 1.0,
};

/**
 * Simulator-scale distances — the desktop waypoints sit 10–25 m out
 * (Prototype-1 precedent), so the deadband is wider to stay visible while
 * walking with WASD.
 */
export const SIM_HUD_CONFIG: HudDemoConfig = {
  distanceMin: 8,
  distanceMax: 12,
  indicatorScale: 1.0,
};

const INDICATOR_SCALE_MIN = 0.1;
const INDICATOR_SCALE_MAX = 5;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Clamp a raw (slider-derived) config into the shape the framework accepts:
 * `0 ≤ distanceMin ≤ distanceMax`, positive indicator scale. Non-finite
 * fields fall back to the given mode default.
 */
export function sanitizeHudDemoConfig(
  raw: HudDemoConfig,
  fallback: HudDemoConfig,
): HudDemoConfig {
  const distanceMin = Math.max(
    0,
    finiteOr(raw.distanceMin, fallback.distanceMin),
  );
  const distanceMax = Math.max(
    distanceMin,
    finiteOr(raw.distanceMax, fallback.distanceMax),
  );
  const indicatorScale = Math.min(
    INDICATOR_SCALE_MAX,
    Math.max(
      INDICATOR_SCALE_MIN,
      finiteOr(raw.indicatorScale, fallback.indicatorScale),
    ),
  );
  return { distanceMin, distanceMax, indicatorScale };
}
