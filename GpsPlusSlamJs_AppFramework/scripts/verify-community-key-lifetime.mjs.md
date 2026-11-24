# `verify-community-key-lifetime.mjs` (AppFramework)

## Purpose

Read-only pre-publish guardrail that asserts the bundled
`COMMUNITY_LICENSE_KEY` shipped by the resolved `gps-plus-slam-js`
dependency has at least `COMMUNITY_KEY_MIN_DAYS` (default **300**) and at
most `COMMUNITY_KEY_MAX_DAYS` (default **380**) days of lifetime
remaining.

The core library re-signs the key for about 365 days on each publish, so
the 300-day floor keeps a framework-only release publishable until the
last core release is about 65 days old. Past that, release a new core
version first (it re-signs the key), then the framework.

This is the public-repo defense-in-depth half of Option F documented in
[../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md)
§3.6 ("F. Move ownership of the community license key into the core lib").

It closes this edge case:

> If the core lib does not cut a release for >12 months but the
> AppFramework keeps releasing, the published AppFramework would
> transitively ship an expired community key.

## Public API

Run via `pnpm run verify:community-key-lifetime` (wired into
`prepublishOnly`).

Exit codes:

- `0` — token is within the acceptable lifetime band.
- `1` — token is too short (re-publish core to re-sign), too long
  (suspicious; manual inspection), missing, malformed, or
  `gps-plus-slam-js/community-license-key` cannot be resolved.

## Invariants & assumptions

- `gps-plus-slam-js` is installed in `node_modules` and exposes
  `./community-license-key` via `package.json#exports`.
- The dist file for that sub-path contains a JWT-style token literal
  matching `<base64url>.<base64url>`. If the core lib changes its dist
  shape, update the regex in this script.
- The token's payload has a numeric `exp` claim (UNIX seconds).
- Signature validity is **not** re-checked here — the core lib's own
  `verify-community-key-lifetime.mjs` and unit tests already cover that.
  This script only inspects the `exp` claim.
- Defensive measures: invalid env vars, missing token, non-finite `exp`,
  base64url decode failure, JSON parse failure, and unresolved sub-path
  all yield exit 1 with a clear error message.

## Examples

```bash
# Default 300-380 day band.
pnpm run verify:community-key-lifetime

# Tighten to 350–370 days for stricter CI.
COMMUNITY_KEY_MIN_DAYS=350 COMMUNITY_KEY_MAX_DAYS=370 \
  pnpm run verify:community-key-lifetime
```

## Tests

Covered by [`verify-community-key-lifetime.test.mjs`](./verify-community-key-lifetime.test.mjs)
(27 tests, vitest). The script exposes three pure helpers
(`extractTokenLiteral`, `decodeJwtPayload`, `evaluateLifetime`) so the
parsing/decoding/banding logic can be locked without spawning a
sub-process.

Test groups (with the "why this matters" rationale on each test):

- **Bundler output shape compatibility** — pins the regex against
  backtick template literals (the shape that broke `app-framework@1.0.4`
  publish), single-quoted, double-quoted, and un-minified
  `COMMUNITY_LICENSE_KEY = "..."` forms. Also asserts `null` on missing /
  malformed literals.
- **JWT decoding** — pins the `code` discriminator on the thrown error
  (`no-dot` / `invalid-base64` / `invalid-json`) so `main()` can branch
  on it.
- **Lifetime band logic** — example-based boundary tests
  (mid-band / lower / upper / just-below / just-above) and `invalid-exp`
  rejection for missing / non-number / NaN values.
- **End-to-end** — runs `extract → decode → evaluate` against the actual
  `gps-plus-slam-js@1.0.4` dist line at a `nowSec` 355 days before exp.
- **Property-based (fast-check)** — every finite-`exp` input lands in
  exactly one of `ok` / `too-short` / `too-long`, and any non-finite-
  number `exp` is rejected as `invalid-exp`.

The corresponding behavior in the core library is fully tested in
[../../gps-plus-slam/GpsPlusSlamJs/scripts/verify-community-key-lifetime.mjs.md](../../gps-plus-slam/GpsPlusSlamJs/scripts/verify-community-key-lifetime.mjs.md).
