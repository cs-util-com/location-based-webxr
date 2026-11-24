/**
 * verify-community-key-lifetime.mjs (AppFramework defense-in-depth)
 *
 * Read-only pre-publish guardrail for `gps-plus-slam-app-framework`.
 *
 * Decodes the bundled `COMMUNITY_LICENSE_KEY` shipped by the resolved
 * `gps-plus-slam-js` dependency and asserts its remaining lifetime falls
 * inside the acceptable band (default 300-380 days). Closes the
 * "no core release for >12 months but framework keeps releasing" edge
 * case from
 * `../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md`
 * §3.6.
 *
 * No `NPM_SIGNING_PRIVATE_KEY` needed — this only reads the constant and
 * inspects its `exp` claim. Signature validity is already covered by the
 * core library's own tests.
 *
 * Configuration (env vars, both optional):
 *   COMMUNITY_KEY_MIN_DAYS  default 300
 *   COMMUNITY_KEY_MAX_DAYS  default 380
 *
 * The pure helpers (`extractTokenLiteral`, `decodeJwtPayload`,
 * `evaluateLifetime`) are exported so `verify-community-key-lifetime.test.mjs`
 * can lock the parsing/decoding/banding logic against historical and future
 * bundler output shapes.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// --- Pure helpers (exported for tests) --------------------------------------

/**
 * Find the JWT-style `<payloadB64url>.<sigB64url>` literal assigned to a
 * top-level variable in a bundled ESM source. Accepts single-quoted,
 * double-quoted, and template-literal (backtick) string forms because all
 * three appear across tsdown/rolldown versions — `gps-plus-slam-js@1.0.4`
 * ships the constant as a backtick template literal.
 *
 * Returns the matched token (without quotes) or `null` if no literal
 * matches the grammar.
 *
 * @param {string} source
 * @returns {string | null}
 */
export function extractTokenLiteral(source) {
  const m = source.match(
    /(?:COMMUNITY_LICENSE_KEY|[A-Za-z_$][\w$]*)\s*=\s*['"`]([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)['"`]/
  );
  return m ? m[1] : null;
}

/**
 * Decode a JWT-style `<payload>.<sig>` token's payload. Throws an `Error`
 * with a stable `code` property on malformed input so callers can branch
 * on the failure mode.
 *
 *   code = 'no-dot'           — token has no '.' separator (or starts with one)
 *   code = 'invalid-base64'   — payload is not valid base64url
 *   code = 'invalid-json'     — payload base64url decoded but is not JSON
 *
 * @param {string} token
 * @returns {Record<string, unknown>}
 */
export function decodeJwtPayload(token) {
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0) {
    const err = new Error(
      `Token is not a "<payload>.<signature>" pair: ${JSON.stringify(token)}`
    );
    err.code = 'no-dot';
    throw err;
  }
  const payloadB64 = token.slice(0, dotIndex);
  let json;
  try {
    json = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch (cause) {
    const err = new Error(
      `Failed to base64url-decode JWT payload: ${cause.message}`
    );
    err.code = 'invalid-base64';
    err.cause = cause;
    throw err;
  }
  try {
    return JSON.parse(json);
  } catch (cause) {
    const err = new Error(
      `Failed to JSON.parse JWT payload: ${cause.message}`
    );
    err.code = 'invalid-json';
    err.cause = cause;
    throw err;
  }
}

/**
 * Compare the JWT payload's `exp` claim against an acceptable lifetime
 * band. Returns a discriminated result so the caller can format messages
 * and decide exit codes; no I/O, no `process.exit` here.
 *
 * @param {Record<string, unknown>} payload
 * @param {{ nowSec: number, minDays: number, maxDays: number }} opts
 * @returns {{ ok: true, remainingDays: number, exp: number }
 *         | { ok: false, reason: 'invalid-exp', exp: unknown }
 *         | { ok: false, reason: 'too-short' | 'too-long', remainingDays: number, exp: number }}
 */
export function evaluateLifetime(payload, { nowSec, minDays, maxDays }) {
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: 'invalid-exp', exp: payload.exp };
  }
  const remainingDays = (payload.exp - nowSec) / 86_400;
  if (remainingDays < minDays) {
    return { ok: false, reason: 'too-short', remainingDays, exp: payload.exp };
  }
  if (remainingDays > maxDays) {
    return { ok: false, reason: 'too-long', remainingDays, exp: payload.exp };
  }
  return { ok: true, remainingDays, exp: payload.exp };
}

/**
 * Default band for the remaining key lifetime, in days. The core library
 * re-signs the key for about 365 days on each publish, so a floor of 300
 * keeps a framework-only release publishable until the last core release
 * is about 65 days old, while still blocking a key that is running out.
 */
export const DEFAULT_MIN_DAYS = 300;
export const DEFAULT_MAX_DAYS = 380;

// --- CLI entry point --------------------------------------------------------

/**
 * Run the verification end-to-end against the resolved
 * `gps-plus-slam-js/community-license-key` dist file. Logs to console and
 * exits the process. Only invoked when this file is run as a script.
 */
function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  const MIN_DAYS = Number.parseInt(
    process.env.COMMUNITY_KEY_MIN_DAYS ?? String(DEFAULT_MIN_DAYS),
    10
  );
  const MAX_DAYS = Number.parseInt(
    process.env.COMMUNITY_KEY_MAX_DAYS ?? String(DEFAULT_MAX_DAYS),
    10
  );
  if (
    !Number.isFinite(MIN_DAYS) ||
    !Number.isFinite(MAX_DAYS) ||
    MIN_DAYS >= MAX_DAYS
  ) {
    console.error(
      `❌ Invalid COMMUNITY_KEY_MIN_DAYS/MAX_DAYS: ${MIN_DAYS}/${MAX_DAYS}`
    );
    process.exit(1);
  }

  // Resolve the installed `gps-plus-slam-js/community-license-key` sub-path
  // export against the AppFramework's own node_modules. We use createRequire
  // instead of an `import()` because we want to fail with a clear error if
  // the dependency is not installed (rather than spawn a dynamic ESM load).
  const require = createRequire(import.meta.url);
  let bundledTokenFile;
  try {
    bundledTokenFile = require.resolve(
      'gps-plus-slam-js/community-license-key',
      { paths: [resolve(__dirname, '..')] }
    );
  } catch (err) {
    console.error(
      `❌ Could not resolve 'gps-plus-slam-js/community-license-key'. ` +
        `Make sure 'gps-plus-slam-js' is installed and at a version that exposes ` +
        `the sub-path export ('./community-license-key' in its package.json#exports). ` +
        `Underlying error: ${err.message}`
    );
    process.exit(1);
  }

  const distSource = readFileSync(bundledTokenFile, 'utf8');
  const token = extractTokenLiteral(distSource);
  if (!token) {
    console.error(
      `❌ Could not locate a JWT-style token literal in ${bundledTokenFile}. ` +
        `The minified output may have changed shape; update the regex in ` +
        `scripts/verify-community-key-lifetime.mjs.`
    );
    process.exit(1);
  }

  let payload;
  try {
    payload = decodeJwtPayload(token);
  } catch (err) {
    if (err.code === 'no-dot') {
      console.error(
        `❌ COMMUNITY_LICENSE_KEY is not a "<payload>.<signature>" token.`
      );
    } else {
      console.error(`❌ ${err.message}`);
    }
    process.exit(1);
  }

  const result = evaluateLifetime(payload, {
    nowSec: Math.floor(Date.now() / 1000),
    minDays: MIN_DAYS,
    maxDays: MAX_DAYS,
  });

  if (result.ok) {
    const expIso = new Date(result.exp * 1000).toISOString();
    console.log(
      `✅ Bundled COMMUNITY_LICENSE_KEY (from gps-plus-slam-js) has ${result.remainingDays.toFixed(1)} days left ` +
        `(expires ${expIso}), within ${MIN_DAYS}–${MAX_DAYS} day band.`
    );
    return;
  }

  if (result.reason === 'invalid-exp') {
    console.error(
      `❌ COMMUNITY_LICENSE_KEY payload.exp is not a finite number: ${JSON.stringify(result.exp)}`
    );
    process.exit(1);
  }

  const expIso = new Date(result.exp * 1000).toISOString();
  if (result.reason === 'too-short') {
    console.error(
      `\n❌ BLOCKED: bundled COMMUNITY_LICENSE_KEY (from gps-plus-slam-js) has only ` +
        `${result.remainingDays.toFixed(1)} days left (expires ${expIso}); minimum ${MIN_DAYS} days.`
    );
    console.error(
      `\nFix: bump the 'gps-plus-slam-js' dependency in package.json to a version ` +
        `whose CI re-signed the bundled token, then re-run 'pnpm install'.\n`
    );
    process.exit(1);
  }

  // result.reason === 'too-long'
  console.error(
    `\n❌ BLOCKED: bundled COMMUNITY_LICENSE_KEY has ${result.remainingDays.toFixed(1)} days left ` +
      `(expires ${expIso}); maximum acceptable is ${MAX_DAYS} days. ` +
      `Investigate the core re-sign step.\n`
  );
  process.exit(1);
}

// Run only when invoked directly, not when imported by tests.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}
