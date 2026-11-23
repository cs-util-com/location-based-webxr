/**
 * One committer per object: the claim that keeps two systems from writing
 * the same object's transform.
 *
 * A GPS anchor, a deferred anchor and the AR-space correction each move the
 * objects they own. Two of them on one object, or on an object and one of
 * its ancestors, apply their corrections on top of each other. Each claims
 * an object before it first writes it and releases it when it stops; a
 * claim that would overlap another one throws at the call that made it.
 *
 * Checked at claim time only: an app that later re-parents a claimed object
 * into another claimed one is not seen here (each committer's own guards
 * cover what they can).
 *
 * Sidecar: `pose-committer.ts.md`.
 */
import type { Object3D } from 'three';

/** Who commits an object's pose. */
export type PoseCommitter =
  'GPS anchor' | 'deferred anchor' | 'AR-space correction';

const claims = new WeakMap<Object3D, PoseCommitter>();

/** The committer holding `object` itself, or `null`. */
export function poseCommitterOf(object: Object3D): PoseCommitter | null {
  return claims.get(object) ?? null;
}

/** The first claim on `from` or above it. */
function claimedAncestor(from: Object3D | null): PoseCommitter | null {
  for (let p = from; p; p = p.parent) {
    const c = claims.get(p);
    if (c) return c;
  }
  return null;
}

function claimedDescendant(object: Object3D): PoseCommitter | null {
  let found: PoseCommitter | null = null;
  object.traverse((o) => {
    if (found === null && o !== object) found = claims.get(o) ?? null;
  });
  return found;
}

/**
 * Claim `object` for `committer`. Throws when `object` is already claimed,
 * or sits inside or holds a claimed object (nested claims are not
 * supported, whoever holds them). A committer that re-parents the object as
 * part of its claim passes the new parent as `into`: the ancestors are then
 * read from there, the chain the object is about to live in.
 */
export function claimPose(
  object: Object3D,
  committer: PoseCommitter,
  into: Object3D | null = object.parent
): void {
  const own = claims.get(object);
  if (own) {
    throw new Error(`${committer}: the object is already committed by ${own}`);
  }
  const other = claimedAncestor(into) ?? claimedDescendant(object);
  if (other) {
    throw new Error(
      `${committer}: nested pose committers are not supported; the object ` +
        `sits inside, or holds, an object committed by ${other}`
    );
  }
  claims.set(object, committer);
}

/** Release `committer`'s claim on `object`; a no-op for anyone else's. */
export function releasePose(object: Object3D, committer: PoseCommitter): void {
  if (claims.get(object) === committer) claims.delete(object);
}
