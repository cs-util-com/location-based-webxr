/**
 * Deterministic per-feature variation — the one hash every builder shares.
 *
 * WHY IT IS ITS OWN MODULE (§4a, DEC-R6-20). `stableHash` and `unit` were
 * written inside `trees.ts` for `natural=tree`, and W6 used them to stop a row
 * of untagged trees looking like a row of clones. §4a needs exactly the same
 * thing for POI markers. Two copies of a hash is two hashes that can drift, and
 * the drift would be invisible: both would still look random.
 *
 * THE PROPERTY THAT MATTERS IS NOT RANDOMNESS, IT IS STABILITY. The demo
 * rebuilds its whole working set on every position change, so a value drawn
 * from `Math.random()` would make a bench visibly rotate as the user walks past
 * it, and would make the same street look different on two phones standing next
 * to each other. Everything here is a pure function of a feature key, so the
 * same feature gets the same variation forever, on every device.
 *
 * NOT A PRNG, AND THE DIFFERENCE IS DELIBERATE. There is no sequence and no
 * state — `unit(key, salt)` is a lookup, not a draw. That is what makes it
 * order-independent: a marker's yaw cannot change because a neighbour entered
 * or left the working set, which a seeded sequence would not guarantee.
 *
 * @see stable-jitter.ts.md
 */

/**
 * A stable 32-bit hash of a string.
 *
 * FNV-1a: small, fast, no dependency, and — the property that matters —
 * deterministic across runs, devices and platforms. `Math.random()` here would
 * make the same street look different on two phones standing next to each
 * other, which defeats the overlay's whole purpose.
 */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A deterministic value in `[0, 1)` from a key and a salt.
 *
 * The SALT is what lets one feature carry several independent variations — a
 * tree's height and its rotation come from the same key and must not correlate,
 * or tall trees would all face the same way. Use a different salt per axis.
 */
export function unit(key: string, salt: string): number {
  return stableHash(`${key}#${salt}`) / 0x1_0000_0000;
}

/**
 * How far a POI marker's size may stray from its model's true size, as a
 * fraction.
 *
 * DELIBERATELY SMALL, and this is a constraint rather than a taste. DEC-R6-8
 * keeps POI models at REAL-WORLD scale precisely so that a marker is evidence
 * about the extruder — a bench that measures 1.8 m says the ENU frame and the
 * ground sampling are right. Jitter wide enough to be obvious would destroy
 * that evidence, so this stays inside the range real tagging already varies by.
 * `poi-jitter.test.ts` pins the ceiling.
 */
export const POI_SCALE_JITTER = 0.05;

/**
 * The salt for a rotation about the vertical axis.
 *
 * Named rather than inlined because `trees.ts` and `poi.ts` must use the SAME
 * one for the same axis — two builders disagreeing about a salt is the drift
 * this module exists to prevent, and it would look like nothing at all.
 */
const ROTATION_SALT = "r";

/** The salt for a POI marker's size jitter. */
const POI_SCALE_SALT = "s";

/** A yaw in `[0, 2π)` for a feature key. */
export function stableRotationY(key: string): number {
  return unit(key, ROTATION_SALT) * Math.PI * 2;
}

/**
 * A uniform size multiplier around 1 for a feature key.
 *
 * Centred on 1 rather than biased, so a crowd of markers averages out at its
 * true modelled size instead of drifting systematically small or large.
 */
export function stablePoiScale(key: string): number {
  return 1 + (unit(key, POI_SCALE_SALT) * 2 - 1) * POI_SCALE_JITTER;
}
