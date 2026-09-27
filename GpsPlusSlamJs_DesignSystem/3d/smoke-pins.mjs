/**
 * The look-dev smoke's default pins (round-3 plan 2026-09-27-0532 §8), kept
 * free of Playwright so a unit test can import them.
 *
 * WHY THE PINS. The page's defaults follow the owner (the dense city since
 * round 2; shadows, the catalog and the slab clouds planned in round 3), but
 * the tests were measured on the plain scene. One default flip in round 2
 * failed three unrelated tests and took the run from 8.5 to 20.9 min
 * (plan 2026-09-26-2055 §9). So a hash that does not name a pinned key gets
 * the plain value; a test about a default opts out (`smoke-boot.mjs`,
 * `pageDefaults`), and a test about the catalog or a pinned feature names
 * the key itself. A stream that adds a default adds its key here in the
 * same commit.
 */

/** The plain scene every test was measured on, unless it names the key. */
export const SMOKE_PINS = {
  city: "0",
  shadows: "0",
  catalog: "0",
  cloudMode: "dome",
  ao: "0",
};

/**
 * The hash with every pin the hash does not name appended. A key named with
 * an empty value counts as named (the page reads it as its own empty case).
 */
export function pinnedHash(hash, pins = SMOKE_PINS) {
  const named = new URLSearchParams(hash);
  let out = hash;
  for (const [key, value] of Object.entries(pins)) {
    if (!named.has(key)) out += `${out ? "&" : ""}${key}=${value}`;
  }
  return out;
}
