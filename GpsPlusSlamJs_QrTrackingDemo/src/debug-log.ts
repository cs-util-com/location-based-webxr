/**
 * Debug log for the QR-tracking demo — a tiny bounded line buffer + formatters
 * so the HUD can show *when* detections happen and how fast they follow one
 * another. This is the on-device tuning aid (Note 2.6 of the on-device follow-up):
 * the per-lock Δt makes the real detection cadence visible so the throttle and
 * the accumulator thresholds can be tuned against actual hardware.
 *
 * Pure + bounded so it's unit-testable and can't leak. No DOM here; `main.ts`
 * renders `lines` into a `<pre>`.
 */

export interface DebugLog {
  /** Append one line, dropping the oldest beyond the cap. */
  append(line: string): void;
  /** The retained lines, oldest first. */
  readonly lines: readonly string[];
}

/** A bounded (ring) line buffer. Default cap 40 — enough to eyeball cadence. */
export function createDebugLog(maxLines = 40): DebugLog {
  const lines: string[] = [];
  return {
    append(line: string): void {
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    },
    get lines(): readonly string[] {
      return lines;
    },
  };
}

/** Truncate a payload for a compact log line. */
function shorten(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One per-frame diagnostics line — the on-device root-cause readout for the
 * "0 samples / nothing glued" investigation. Packs, for the detected frame:
 * clock (s) + Δt since the previous logged frame (cadence), the (shortened)
 * payload, **depth coverage** `dN/4` (how many of the 4 corners resolved a
 * finite, positive depth — distinguishes "depth absent" from "depth present"),
 * this frame's **raw** size observation (cm) and **quality**, the accepted-sample
 * count, the size lifecycle stage, and a single-line verdict/rejection `reason`.
 *
 * Reading it: `d<4` ⇒ depth missing at corners (sparse/stale grid); `d4/4` with a
 * wildly wrong size or low quality ⇒ depth present but noisy/coarse; `q` below the
 * accept threshold with `(0)` ⇒ the quality gate is rejecting every sample.
 */
export function formatDiagnosticsLine(input: {
  clockMs: number;
  deltaMs: number | null;
  text: string;
  depthCornerHits: number | null;
  sizeM: number | null;
  quality: number | null;
  sampleCount: number;
  status: string;
  reason: string;
}): string {
  const t = (input.clockMs / 1000).toFixed(2);
  const dt = input.deltaMs === null ? "—" : `${Math.round(input.deltaMs)}ms`;
  const depth =
    input.depthCornerHits === null ? "d—" : `d${input.depthCornerHits}/4`;
  const size =
    input.sizeM === null ? "?" : `${(input.sizeM * 100).toFixed(1)}cm`;
  const q = input.quality === null ? "q?" : `q${input.quality.toFixed(2)}`;
  return `[${t}s Δ${dt}] "${shorten(input.text)}" ${depth} ${size} ${q} (${input.sampleCount}) ${input.status} — ${input.reason}`;
}

/** A status-transition line (scanning/tracking/idle), with a clock stamp. */
export function formatStatusLine(clockMs: number, status: string): string {
  return `[${(clockMs / 1000).toFixed(2)}s] → ${status}`;
}
