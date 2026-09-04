/**
 * Target validation for the wayfinding HUD — the pure half of
 * `createWayfindingHud`, split out 2026-09-04 (simplify loop).
 *
 * The HUD polls `getTargets()` every frame and must never throw from inside
 * the frame loop, so every consumer mistake at that boundary — a getter that
 * returns a non-array, a plain `Vector3` from the pre-2026-07-20 API, an
 * element without a position, a duplicate id, an inverted deadband — is
 * turned into "hide that target and log ONCE", with the log entry cleared
 * when the offending target heals so a later regression logs again. That
 * bookkeeping is the whole content of this module; it needs no scene, no
 * camera and no THREE resources, which is why it now lives apart from the
 * rendering half and can be tested directly.
 *
 * See `wayfinding-targets.ts.md`.
 */

import type * as THREE from 'three';
import { createLogger } from '../utils/logger';

const log = createLogger('WayfindingHud');

/**
 * One wayfinding target as returned by `WayfindingHudOptions.getTargets`
 * (2026-07-20 per-target config plan — clean break from the earlier
 * `Vector3[]` contract).
 */
export interface WayfindingTarget {
  /**
   * Stable identity for per-target hysteresis state; must be unique within
   * one `getTargets()` result. Omit to fall back to index keying (state then
   * sticks to the array position, not the target — fine for static lists).
   */
  id?: string;
  /** The target's world position. */
  position: THREE.Vector3;
  /** Distance (m) below which this target's indicator hides ("arrived").
   * Defaults to the HUD-level `distanceMin`. */
  distanceMin?: number;
  /** Distance (m) this target must reach to reactivate once hidden.
   * Defaults to the HUD-level `distanceMax`. */
  distanceMax?: number;
  /**
   * Show the off-screen edge arrow for this target even while it is
   * DEACTIVATED (below its `distanceMin`) — the pre-2026-07-18 "always
   * guide me back" behavior, per target. On-screen it still shows nothing,
   * and the distanceMax reactivation gate is unaffected. Default false.
   */
  showArrowWhenInactive?: boolean;
  /** Show the distance label with the inactive arrow. Default true (old
   * parity); only meaningful together with `showArrowWhenInactive`. */
  showLabelWhenInactive?: boolean;
}

/** One target after boundary triage: every optional field resolved. */
export interface ResolvedTarget {
  key: string | number;
  position: THREE.Vector3;
  distanceMin: number;
  distanceMax: number;
  showArrowWhenInactive: boolean;
  showLabelWhenInactive: boolean;
}

export interface TargetResolverOptions {
  /** The HUD-level deadband a target falls back to. */
  readonly distanceMin: number;
  readonly distanceMax: number;
}

export interface TargetResolver {
  /**
   * Triage one raw `getTargets()` result into the targets the HUD may show.
   * Never throws; a bad element is hidden and logged once.
   */
  resolve(raw: unknown): ResolvedTarget[];
}

function isVector3(value: unknown): value is THREE.Vector3 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as THREE.Vector3).isVector3 === true
  );
}

/** Same `0 ≤ min ≤ max` (finite) rule the placement seam enforces per call. */
function isValidDeadband(min: unknown, max: unknown): boolean {
  return (
    typeof min === 'number' &&
    Number.isFinite(min) &&
    min >= 0 &&
    typeof max === 'number' &&
    Number.isFinite(max) &&
    max >= min
  );
}

/** Shape triage for one raw getTargets() element; null = shape is fine. */
function checkTargetShape(raw: unknown): 'legacy' | 'invalid' | null {
  if (isVector3(raw)) return 'legacy';
  if (typeof raw !== 'object' || raw === null) return 'invalid';
  const t = raw as Partial<WayfindingTarget>;
  if (!isVector3(t.position)) return 'invalid';
  if (t.id !== undefined && typeof t.id !== 'string') return 'invalid';
  return null;
}

const SHAPE_ISSUE_MESSAGES = {
  legacy:
    'getTargets() returned a plain THREE.Vector3 at index %i — the API takes WayfindingTarget objects now; wrap it as { position: vector }. Hiding it.',
  invalid:
    'getTargets() element at index %i is not a WayfindingTarget ({ position: THREE.Vector3, id?: string, … }). Hiding it.',
} as const;

export function createTargetResolver(
  options: TargetResolverOptions
): TargetResolver {
  const { distanceMin, distanceMax } = options;
  let warnedBadTargets = false;

  /**
   * One-shot bookkeeping for consumer bugs surfaced at the boundary:
   * `<reason>:<key>` → already logged. Entries are cleared when the
   * offending target heals, so a later regression logs again instead of
   * staying silent forever.
   */
  const loggedIssues = new Set<string>();

  function logIssueOnce(issueKey: string, message: string): void {
    if (loggedIssues.has(issueKey)) return;
    loggedIssues.add(issueKey);
    log.error(`createWayfindingHud: ${message}`);
  }

  /** A getter returning garbage counts as "no targets" (logged once). */
  function readTargets(raw: unknown): WayfindingTarget[] {
    if (Array.isArray(raw)) return raw as WayfindingTarget[];
    if (!warnedBadTargets) {
      warnedBadTargets = true;
      log.error(
        'getTargets() did not return an array; treating as empty target list',
        raw
      );
    }
    return [];
  }

  /** Returns null (target hidden, one log) instead of throwing. */
  function resolveDeadband(
    target: WayfindingTarget,
    key: string | number
  ): { min: number; max: number } | null {
    const min = target.distanceMin ?? distanceMin;
    const max = target.distanceMax ?? distanceMax;
    const issueKey = `deadband:${String(key)}`;
    if (!isValidDeadband(min, max)) {
      logIssueOnce(
        issueKey,
        `target "${String(key)}" must satisfy 0 ≤ distanceMin ≤ distanceMax (finite), got distanceMin=${String(min)}, distanceMax=${String(max)}. Hiding it.`
      );
      return null;
    }
    loggedIssues.delete(issueKey);
    return { min, max };
  }

  /** Boundary triage for one raw element → ResolvedTarget, or null when the
   * element must be hidden (shape/duplicate/deadband issue, logged once). */
  function resolveTarget(
    raw: WayfindingTarget,
    index: number,
    seenIds: Set<string>,
    duplicateIds: Set<string>,
    deadbandKeys: Set<string>
  ): ResolvedTarget | null {
    const shapeIssue = checkTargetShape(raw);
    if (shapeIssue) {
      logIssueOnce(
        `${shapeIssue}:${index}`,
        SHAPE_ISSUE_MESSAGES[shapeIssue].replace('%i', String(index))
      );
      return null;
    }
    loggedIssues.delete(`legacy:${index}`);
    loggedIssues.delete(`invalid:${index}`);

    if (raw.id !== undefined) {
      if (seenIds.has(raw.id)) {
        duplicateIds.add(raw.id);
        logIssueOnce(
          `duplicate:${raw.id}`,
          `duplicate target id "${raw.id}" in one getTargets() result — only the first occurrence is shown.`
        );
        return null;
      }
      seenIds.add(raw.id);
    }

    const key = raw.id ?? index;
    // Named this frame under this key: its deadband entry, if any, survives
    // the sweep below only while the key keeps appearing.
    deadbandKeys.add(String(key));
    const deadband = resolveDeadband(raw, key);
    if (!deadband) return null;
    return {
      key,
      position: raw.position,
      distanceMin: deadband.min,
      distanceMax: deadband.max,
      showArrowWhenInactive: raw.showArrowWhenInactive ?? false,
      showLabelWhenInactive: raw.showLabelWhenInactive ?? true,
    };
  }

  /**
   * Per-frame sweep of the entries keyed by CONSUMER-CHOSEN keys, which is
   * what keeps this set bounded from the frame loop:
   *
   * - A duplicate-id entry is keyed by id, not index, so it is cleared only
   *   once the duplication actually disappears from the result (clearing it
   *   while the duplicate persists would re-log every frame).
   * - A deadband entry is keyed by the target's key and used to be released
   *   only when THAT key resolved cleanly again. A consumer minting ids per
   *   frame with a wrong deadband therefore added one permanent entry per
   *   frame (PR #412 review). It is now dropped with the first frame that no
   *   longer names its key, so a key that leaves and returns still wrong is
   *   logged again, and the set never outgrows the largest result seen.
   *
   * Shape entries (`legacy:`/`invalid:`) are keyed by index and bounded by
   * the longest list, so they need no sweep.
   */
  function sweepDepartedKeys(
    duplicateIds: Set<string>,
    deadbandKeys: Set<string>
  ): void {
    for (const issue of loggedIssues) {
      if (
        issue.startsWith('duplicate:') &&
        !duplicateIds.has(issue.slice('duplicate:'.length))
      ) {
        loggedIssues.delete(issue);
      } else if (
        issue.startsWith('deadband:') &&
        !deadbandKeys.has(issue.slice('deadband:'.length))
      ) {
        loggedIssues.delete(issue);
      }
    }
  }

  return {
    resolve(raw: unknown): ResolvedTarget[] {
      const seenIds = new Set<string>();
      const duplicateIds = new Set<string>();
      const deadbandKeys = new Set<string>();
      const resolved: ResolvedTarget[] = [];
      readTargets(raw).forEach((target, index) => {
        const result = resolveTarget(
          target,
          index,
          seenIds,
          duplicateIds,
          deadbandKeys
        );
        if (result) resolved.push(result);
      });
      sweepDepartedKeys(duplicateIds, deadbandKeys);
      return resolved;
    },
  };
}
