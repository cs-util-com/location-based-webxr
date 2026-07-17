/**
 * HUD status summary — turns the REAL HUD scene state (the indicator meshes
 * the framework presenter attached to the camera) plus the target list into
 * a one-line DOM status.
 *
 * Deliberately reads the presenter's OUTPUT (camera children by name +
 * visibility) instead of re-running the placement math: the status line is
 * then evidence of what the HUD actually shows, which is what the Playwright
 * walk-flow spec asserts hysteresis transitions against.
 */

import type * as THREE from "three";

/** The structural slice of a camera child the summary reads. */
export interface HudIndicatorLike {
  readonly name: string;
  readonly visible: boolean;
}

export interface HudSceneSummary {
  targets: number;
  /** Visible edge arrows (off-screen targets). */
  arrows: number;
  /** Visible on-screen rings. */
  rings: number;
  /** Targets with no visible indicator (hidden / "arrived"). */
  hidden: number;
  /** Distance to the nearest target in meters, or null with no targets. */
  nearest: number | null;
}

function countVisible(
  children: readonly HudIndicatorLike[],
  name: string,
): number {
  let count = 0;
  for (const child of children) {
    if (child.name === name && child.visible) count += 1;
  }
  return count;
}

/**
 * Summarize the HUD's current scene output for a target list.
 * `cameraChildren` is the presenter's camera `.children` array (extra
 * non-HUD children are ignored by name).
 */
export function summarizeHudScene(
  cameraChildren: readonly HudIndicatorLike[],
  cameraPosition: THREE.Vector3,
  targets: readonly THREE.Vector3[],
): HudSceneSummary {
  const arrows = countVisible(cameraChildren, "wayfinding-arrow");
  const rings = countVisible(cameraChildren, "wayfinding-circle");
  let nearest: number | null = null;
  for (const target of targets) {
    const distance = cameraPosition.distanceTo(target);
    if (nearest === null || distance < nearest) nearest = distance;
  }
  return {
    targets: targets.length,
    arrows,
    rings,
    hidden: Math.max(0, targets.length - arrows - rings),
    nearest,
  };
}

/** Format a summary as the status line, e.g.
 * `targets 4 · arrows 3 · rings 1 · hidden 0 · nearest 19.2 m`. */
export function formatHudStatus(summary: HudSceneSummary): string {
  const nearest =
    summary.nearest === null ? "–" : `${summary.nearest.toFixed(1)} m`;
  return (
    `targets ${summary.targets} · arrows ${summary.arrows} · ` +
    `rings ${summary.rings} · hidden ${summary.hidden} · nearest ${nearest}`
  );
}
