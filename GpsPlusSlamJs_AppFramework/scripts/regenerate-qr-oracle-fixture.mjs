// NOTE: no shebang; invoked as `node scripts/regenerate-qr-oracle-fixture.mjs`
// (or `pnpm run regenerate:qr-oracle`), and imported by its colocated test.
//
// Regenerates src/utils/qr-payload/qr-size-estimator.oracle.json: the `qrcode`
// oracle's own answers that qr-size-estimator.test.ts checks the estimator
// against (gate-speed plan 2026-10-04, G3; milestone review R10). For every
// EC level, mode and version 1-25 it stores the longest single-mode string
// the ORACLE still fits in that version, found by binary search on the oracle
// alone, so the table never leans on the estimator it is used to check; and
// the oracle's version for each mixed payload. The fixture records the
// `qrcode` version it came from, and the test fails when the installed
// version differs, naming this script.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The EC levels, in the order the fixture lists them. */
export const EC_LEVELS = ['L', 'M', 'Q', 'H'];

/** One repeated character per QR mode: numeric, alphanumeric, byte. */
export const MODE_CHARS = { numeric: '8', alphanumeric: 'A', byte: 'a' };

/**
 * The mixed payloads the test compares; kept here so the fixture and the test
 * cannot disagree on the list (the test asserts they are equal).
 */
export const MIXED_PAYLOADS = [
  'https://gps.csutil.com/?qr=a1b2c',
  'HTTPS://GPS.CSUTIL.COM/S/A1B2C',
  'https://raw.githubusercontent.com/user/repo/main/qr/scene-demo.json',
  'https://gps.csutil.com/?qr=UOX5AT2MNRAVIT3EGVQVCSKBJZKESRKSGQ3UMMSF',
  '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}',
  `https://gps.csutil.com/?qr=${'JBSWY3DPEB3W64TMMQQQ'.repeat(10)}`,
  '8'.repeat(120) + 'A'.repeat(50) + 'a'.repeat(30),
];

/**
 * Derives the fixture from an oracle.
 *
 * @param {(payload: string, ec: string) => number} versionOf the oracle's
 *   version for a payload at an EC level; Infinity when it does not fit at all
 * @param {string} oracleLabel e.g. `qrcode@1.5.4`
 * @param {number} [maxChars] upper bound of the binary search
 * @returns {{ oracle: string, boundaries: Record<string, Record<string, number[]>>, mixed: { payload: string, versions: Record<string, number> }[] }}
 */
export function deriveOracleFixture(versionOf, oracleLabel, maxChars = 4000) {
  /** @type {Record<string, Record<string, number[]>>} */
  const boundaries = {};
  for (const ec of EC_LEVELS) {
    boundaries[ec] = {};
    for (const [mode, ch] of Object.entries(MODE_CHARS)) {
      boundaries[ec][mode] = Array.from({ length: 25 }, (_, i) =>
        longestFitting((n) => versionOf(ch.repeat(n), ec) <= i + 1, maxChars)
      );
    }
  }
  const mixed = MIXED_PAYLOADS.map((payload) => ({
    payload,
    versions: Object.fromEntries(EC_LEVELS.map((ec) => [ec, versionOf(payload, ec)])),
  }));
  return { oracle: oracleLabel, boundaries, mixed };
}

/**
 * The largest `n` in [0, maxChars] for which `fits(n)` holds, by binary
 * search; `fits` must hold for every value below one that fits.
 *
 * @param {(n: number) => boolean} fits
 * @param {number} maxChars
 * @returns {number}
 */
function longestFitting(fits, maxChars) {
  let lo = 0;
  let hi = maxChars;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** The fixture's path, beside the test that reads it. */
export const FIXTURE_PATH = fileURLToPath(
  new URL('../src/utils/qr-payload/qr-size-estimator.oracle.json', import.meta.url)
);

// Write the fixture only when run directly, never when imported by the test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const require = createRequire(import.meta.url);
  const QRCode = require('qrcode');
  const { version } = require('qrcode/package.json');
  const versionOf = (payload, ec) => {
    try {
      return QRCode.create(payload, { errorCorrectionLevel: ec }).version;
    } catch {
      return Number.POSITIVE_INFINITY; // too long for any version
    }
  };
  const fixture = deriveOracleFixture(versionOf, `qrcode@${version}`);
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`wrote ${FIXTURE_PATH} from qrcode@${version}`);
  // Prettier lays the arrays out differently; the content is what counts.
  console.log('run `pnpm run format` (or any gate) to apply the repo layout before committing');
}
