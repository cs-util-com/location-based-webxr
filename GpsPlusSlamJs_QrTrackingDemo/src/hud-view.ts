/**
 * HUD view-model — pure formatting of the measured-size readout the developer
 * uses to confirm a freshly printed QR against a tape measure (Note 4).
 *
 * No DOM here; `main.ts` copies these strings onto the overlay. Keeping it pure
 * makes the formatting (cm/mm rounding, the lifecycle labels) unit-testable.
 */

import type { QrSizeEstimate } from "gps-plus-slam-app-framework/ar";
import type {
  QrFusedPose,
  QrMotion,
  QrMotionState,
} from "gps-plus-slam-app-framework/ar/qr";

export type DemoStatus = "idle" | "scanning" | "tracking";

export interface HudView {
  /** Top-line status: looking for a code vs. locked + glued. */
  statusLabel: string;
  /** Running median size, e.g. `20.1 cm`, or a placeholder while unknown. */
  sizeLabel: string;
  /** Accepted-sample count, e.g. `12 samples`. */
  sampleLabel: string;
  /** Sample spread, e.g. `±2 mm`. */
  spreadLabel: string;
  /** Size lifecycle stage (`unknown` | `measuring` | `estimated`). */
  lifecycleLabel: string;
  /**
   * The fused pose (QR near-frontal pose plan M3b b5): which rotation the
   * overlay shows and how well the views agree, e.g.
   * `joint · stable · 7 views · fit 0.6 px`, or `—` before any.
   */
  poseLabel: string;
  /**
   * The code's motion mode (plan §26) with its speeds, e.g.
   * `moving · 12 cm/s`, `still`, or `—` before any reading.
   */
  motionLabel: string;
  /** The mode's colour (`MOTION_COLORS`), or null for the default text colour. */
  motionColor: string | null;
}

/**
 * One colour per motion mode, shared by the HUD label and the 3D trail
 * (plan §26). Bright and saturated, to stay readable on the translucent
 * plate outdoors; "still" keeps the design system's own text colour.
 */
export const MOTION_COLORS: Record<QrMotionState, string | null> = {
  still: null,
  moving: "#ffb020",
  turning: "#33ddff",
  "moving+turning": "#ff5ad2",
};

const STATUS_LABELS: Record<DemoStatus, string> = {
  idle: "Point at a QR code",
  scanning: "Scanning…",
  tracking: "Locked — axis + cube glued",
};

function formatSizeCm(estimateM: number | null): string {
  if (estimateM === null || !Number.isFinite(estimateM)) return "—";
  return `${(estimateM * 100).toFixed(1)} cm`;
}

/**
 * Spread (robust confidence half-width) as a mm label. A positive spread that
 * rounds below 1 mm reads `<1 mm` rather than `±0 mm` — the latter looked like
 * false infinite precision on device once the estimate converged tightly (the
 * half-width is `1.4826·MAD/√N`, which goes sub-mm at high sample counts). A
 * genuine zero (no spread yet, <2 samples) still reads `±0 mm`.
 */
function formatSpread(spreadM: number): string {
  if (!(spreadM > 0)) return "±0 mm";
  const mm = spreadM * 1000;
  return mm < 0.5 ? "<1 mm" : `±${Math.round(mm)} mm`;
}

/** The fused-pose line: method, state, views and the median per-view fit. */
function formatPose(fused: QrFusedPose | null | undefined): string {
  if (!fused || fused.status === "unknown" || !fused.method) return "—";
  const fit = Number.isFinite(fused.fitPx)
    ? `fit ${fused.fitPx.toFixed(1)} px`
    : "fit —";
  if (fused.method === "averaged") return `averaged (views disagree) · ${fit}`;
  return `joint · ${fused.status} · ${fused.views} views · ${fit}`;
}

const MOTION_NAMES: Record<QrMotionState, string> = {
  still: "still",
  moving: "moving",
  turning: "turning",
  "moving+turning": "moving + turning",
};

/** The motion line: the mode, then the speeds of what is moving. */
function formatMotion(motion: QrMotion | null | undefined): string {
  if (!motion) return "—";
  const parts = [MOTION_NAMES[motion.state]];
  if (motion.moving && motion.speedMps !== null) {
    parts.push(`${Math.round(motion.speedMps * 100)} cm/s`);
  }
  if (motion.turning && motion.turnRateDegPerS !== null) {
    parts.push(`${Math.round(motion.turnRateDegPerS)}°/s`);
  }
  return parts.join(" · ");
}

export function toHudView(
  status: DemoStatus,
  size: QrSizeEstimate | undefined,
  fused?: QrFusedPose | null,
): HudView {
  const sizeEstimate = size ?? {
    status: "unknown" as const,
    estimateM: null,
    sampleCount: 0,
    spreadM: 0,
  };
  return {
    statusLabel: STATUS_LABELS[status],
    sizeLabel:
      sizeEstimate.status === "measuring" && sizeEstimate.estimateM === null
        ? "measuring…"
        : formatSizeCm(sizeEstimate.estimateM),
    sampleLabel: `${sizeEstimate.sampleCount} sample${sizeEstimate.sampleCount === 1 ? "" : "s"}`,
    spreadLabel: formatSpread(sizeEstimate.spreadM),
    lifecycleLabel: sizeEstimate.status,
    poseLabel: formatPose(fused),
    motionLabel: formatMotion(fused?.motion),
    motionColor: fused?.motion ? MOTION_COLORS[fused.motion.state] : null,
  };
}
