/**
 * Pure presentation mapping for the live streaming counters: numbers in,
 * display strings out. Kept free of DOM so the mapping is unit-testable and
 * `main.ts` stays a thin renderer (the AnchorStarter view-model pattern).
 */

import { formatFileSize } from "gps-plus-slam-app-framework/utils/format-file-size";

import type { StreamStats } from "./tour-session.js";

export interface StatsView {
  /** e.g. "132 KB of 3.4 MB fetched (3.8%)" */
  readonly headline: string;
  /** e.g. "9 range requests · 4 cache reads · serving from network" */
  readonly detail: string;
}

export function toStatsView(
  stats: Readonly<StreamStats>,
  archiveSize: number,
  origin: "network" | "cache",
): StatsView {
  const percent =
    archiveSize > 0
      ? Math.min(100, (stats.networkBytes / archiveSize) * 100)
      : 0;
  return {
    headline: `${formatFileSize(stats.networkBytes)} of ${formatFileSize(archiveSize)} fetched (${percent.toFixed(1)}%)`,
    detail: `${String(stats.networkRequests)} range requests · ${String(stats.cacheReads)} cache reads · serving from ${origin}`,
  };
}
