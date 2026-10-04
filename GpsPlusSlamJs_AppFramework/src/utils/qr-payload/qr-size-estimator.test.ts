import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  QR_ALPHANUMERIC_CHARSET,
  estimateQrSize,
  type QrEcLevel,
} from './qr-size-estimator';

/**
 * P1 of the QR payload-compression benchmark plan
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-0611-qr-payload-compression-benchmark-plan.md).
 *
 * The estimator is the benchmark's *metric* — every later phase (P2–P5)
 * ranks candidates by its output, so these tests pin it against hand-derived
 * spec values AND against the `qrcode` npm package as an independent oracle
 * (decision D6: strict version equality, no tolerance band).
 */

const EC_LEVELS: readonly QrEcLevel[] = ['L', 'M', 'Q', 'H'];

type ProbeMode = 'numeric' | 'alphanumeric' | 'byte';

/** The qrcode oracle's stored answers; see the oracle section below. */
const ORACLE = JSON.parse(
  readFileSync(
    new URL('./qr-size-estimator.oracle.json', import.meta.url),
    'utf8'
  )
) as {
  oracle: string;
  boundaries: Record<QrEcLevel, Record<ProbeMode, number[]>>;
  mixed: { payload: string; versions: Record<QrEcLevel, number> }[];
};

/** Live oracle checks run where the browser stages run: CI and the milestone run. */
const LIVE_ORACLE = !process.env['GATE_SKIP_BROWSER_STAGES'];

/** The installed oracle, as the fixture records it: `qrcode@<version>`. */
const INSTALLED_QRCODE = `qrcode@${
  (
    JSON.parse(
      readFileSync(
        new URL('../../../node_modules/qrcode/package.json', import.meta.url),
        'utf8'
      )
    ) as { version: string }
  ).version
}`;

describe('estimateQrSize — hand-derived spec values', () => {
  // Why this test matters: "HELLO WORLD" is the ISO 18004 worked example —
  // 11 alphanumeric chars = 5 pairs (55 bits) + 1 remainder (6 bits) + mode
  // indicator (4) + char-count indicator (9 in v1–9) = 74 bits, fitting v1
  // at every EC level except H is also v1 (H capacity 72 bits < 74 → v2? no:
  // 9 codewords = 72 bits < 74 bits → v2 at H).
  it('encodes the classic alphanumeric example at the spec bit cost', () => {
    const result = estimateQrSize('HELLO WORLD', 'Q');
    expect(result).toEqual({ bits: 74, version: 1, modules: 21 });
    // 74 bits exceed v1-H's 9 data codewords (72 bits) → v2 at EC H.
    expect(estimateQrSize('HELLO WORLD', 'H')).toEqual({
      bits: 74,
      version: 2,
      modules: 25,
    });
  });

  // Why this test matters: numeric mode is the cheapest (10 bits / 3 digits)
  // and its remainder handling (2 digits → 7 bits) is easy to get wrong.
  it('encodes pure digits in numeric mode', () => {
    // 4 (mode) + 10 (CCI v1-9) + 2×10 + 7 = 41 bits.
    expect(estimateQrSize('01234567', 'L')).toEqual({
      bits: 41,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: lowercase letters are NOT in the QR alphanumeric
  // charset, so they must cost 8 bits/char in byte mode.
  it('encodes lowercase text in byte mode', () => {
    // 4 + 8 (CCI v1-9) + 5×8 = 52 bits.
    expect(estimateQrSize('hello', 'L')).toEqual({
      bits: 52,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: the whole benchmark hinges on correct mode
  // *segmentation*, and the optimum is subtle — ':' and '/' ARE in the QR
  // alphanumeric charset, so the cheapest split of "https://ABC" is NOT at
  // the "://" boundary: byte("https") = 4+8+5×8 = 52 bits, then
  // alnum("://ABC") = 4+9+3×11 = 46 bits → 98 total, beating both the pure
  // byte segment (4+8+11×8 = 100) and a split at "https://" (≥ 106).
  it('finds the optimal split inside the URL scheme separator', () => {
    expect(estimateQrSize('https://ABC', 'L')?.bits).toBe(98);
  });

  it('splits into byte + alphanumeric segments when the run is long enough', () => {
    // byte("https") = 52 bits, alnum("://" + 40×'A' = 43 chars) =
    // 4 + 9 + 21×11 + 6 = 250 bits → 302 total (vs 396 pure byte).
    expect(estimateQrSize(`https://${'A'.repeat(40)}`, 'L')?.bits).toBe(302);
  });

  // Why this test matters: multi-byte UTF-8 chars must be costed at their
  // byte length, not 8 bits per JS char (ö = 2 bytes, 😀 = 4 bytes).
  it('costs non-ASCII characters at their UTF-8 byte length', () => {
    // 4 + 8 + 2×8 = 28 bits.
    expect(estimateQrSize('ö', 'L')?.bits).toBe(28);
    // 4 + 8 + 4×8 = 44 bits (astral char = one code point, 4 UTF-8 bytes).
    expect(estimateQrSize('😀', 'L')?.bits).toBe(44);
  });

  it('returns version 1 with zero bits for the empty payload', () => {
    expect(estimateQrSize('', 'H')).toEqual({
      bits: 0,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: the plan (§3) requires `null`, never a throw, for
  // payloads beyond the v25 capacity table.
  it('returns null for payloads exceeding the v25 capacity table', () => {
    expect(estimateQrSize('a'.repeat(1300), 'L')).toBeNull();
    expect(estimateQrSize('a'.repeat(600), 'H')).toBeNull();
  });

  // Why this test matters: defensive-boundary rule — invalid EC levels are a
  // caller bug but must degrade to null, matching the totality convention.
  it('returns null for an invalid EC level', () => {
    expect(estimateQrSize('abc', 'X' as QrEcLevel)).toBeNull();
  });

  it('exposes the 45-char QR alphanumeric charset', () => {
    expect(QR_ALPHANUMERIC_CHARSET).toHaveLength(45);
    expect(QR_ALPHANUMERIC_CHARSET).toBe(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'
    );
  });
});

/**
 * Oracle cross-validation (decision D6): our chosen version must EQUAL the
 * `qrcode` package's for every probe. Instead of sweeping every length
 * (too slow), we probe each (version, EC, mode) capacity BOUNDARY: the
 * longest single-mode string the oracle still fits in version v must need
 * exactly v by our estimate too, and one more char must push both past v.
 * A wrong entry anywhere in the v1–25 capacity table fails here. The
 * oracle's boundaries are stored (see the GATE SPEED note below).
 */
describe('estimateQrSize — qrcode oracle boundary agreement', () => {
  const MODE_PROBES = [
    { label: 'numeric', char: '8' },
    { label: 'alphanumeric', char: 'A' },
    { label: 'byte', char: 'a' },
  ] as const;

  function oracleVersion(payload: string, ec: QrEcLevel): number {
    return QRCode.create(payload, { errorCorrectionLevel: ec }).version;
  }

  // GATE SPEED (gate-speed plan 2026-10-04, G3): the oracle's answers never
  // change with our code, so they are stored in qr-size-estimator.oracle.json:
  // for every EC level, mode and version 1-25 the longest single-mode string
  // the oracle still fits in that version (found by binary search on the
  // ORACLE alone, so the table does not lean on our estimator), and the
  // oracle's version for every mixed payload below. Every run checks the
  // estimator against that table. A run with GATE_SKIP_BROWSER_STAGES unset
  // (CI and the milestone run) also asks the live oracle the original two
  // questions at every stored boundary (exactly v there, more than v one
  // character later), so a stale fixture or an oracle upgrade fails there and
  // cannot pass silently. In the fast per-commit gate those live checks are
  // reported as skipped. The fixture is written by
  // `pnpm run regenerate:qr-oracle` (scripts/regenerate-qr-oracle-fixture.mjs),
  // never by hand, and records the qrcode version it came from.
  //
  // Why this test matters (milestone review R10): a qrcode upgrade must not
  // leave the fast gate comparing against the old version's answers until the
  // next live run notices; the recorded version must be the installed one.
  it('was recorded from the installed qrcode version', () => {
    expect(
      ORACLE.oracle,
      `qrcode is now ${INSTALLED_QRCODE}: run \`pnpm run regenerate:qr-oracle\` in GpsPlusSlamJs_AppFramework and commit the JSON`
    ).toBe(INSTALLED_QRCODE);
  });

  for (const ec of EC_LEVELS) {
    for (const probe of MODE_PROBES) {
      it(`matches the oracle's v1–25 ${probe.label} capacities at EC ${ec}`, () => {
        const stored = ORACLE.boundaries[ec][probe.label];
        expect(stored).toHaveLength(25);
        for (let version = 1; version <= 25; version++) {
          // The oracle's boundary must be OUR boundary too: exactly v at it,
          // more than v one character later. Two estimates instead of a
          // binary search: the estimator's version only grows with the
          // repeat count, the property the search relied on as well.
          const maxChars = stored[version - 1]!;
          expect(
            estimateQrSize(probe.char.repeat(maxChars), ec)?.version,
            `${probe.label}×${maxChars} @ EC ${ec} should need v${version}`
          ).toBe(version);
          const over = estimateQrSize(probe.char.repeat(maxChars + 1), ec);
          expect(
            over === null || over.version > version,
            `${probe.label}×${maxChars + 1} @ EC ${ec} should exceed v${version}`
          ).toBe(true);
        }
      });
    }
  }

  // Why this test matters: the benchmark's real payloads are MIXED-mode
  // (lowercase URL prefix + uppercase/numeric encoded tail), so segmentation
  // itself — not just the capacity table — must match the oracle.
  const MIXED_PROBES = [
    'https://gps.csutil.com/?qr=a1b2c',
    'HTTPS://GPS.CSUTIL.COM/S/A1B2C',
    'https://raw.githubusercontent.com/user/repo/main/qr/scene-demo.json',
    'https://gps.csutil.com/?qr=UOX5AT2MNRAVIT3EGVQVCSKBJZKESRKSGQ3UMMSF',
    '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}',
    `https://gps.csutil.com/?qr=${'JBSWY3DPEB3W64TMMQQQ'.repeat(10)}`,
    '8'.repeat(120) + 'A'.repeat(50) + 'a'.repeat(30),
  ];

  it('stores the oracle answer for exactly these mixed payloads', () => {
    expect(
      ORACLE.mixed.map((m) => m.payload),
      'the list changed: update MIXED_PAYLOADS in scripts/regenerate-qr-oracle-fixture.mjs and run `pnpm run regenerate:qr-oracle`'
    ).toEqual(MIXED_PROBES);
  });

  for (const [i, payload] of MIXED_PROBES.entries()) {
    it(`agrees with the oracle on mixed payload "${payload.slice(0, 24)}…"`, () => {
      for (const ec of EC_LEVELS) {
        const estimate = estimateQrSize(payload, ec);
        expect(estimate).not.toBeNull();
        expect(estimate?.version, `EC ${ec}: ${payload.slice(0, 40)}`).toBe(
          ORACLE.mixed[i]!.versions[ec]
        );
      }
    });
  }

  describe.runIf(LIVE_ORACLE)(
    'the stored answers against the live qrcode package',
    () => {
      for (const ec of EC_LEVELS) {
        for (const probe of MODE_PROBES) {
          it(
            `still fits exactly the stored ${probe.label} boundaries at EC ${ec}`,
            // Wall-clock heavy (50 oracle QR encodes per probe), but the
            // assertions are structural, so a generous budget weakens nothing.
            { timeout: 60_000 },
            () => {
              for (let version = 1; version <= 25; version++) {
                const maxChars =
                  ORACLE.boundaries[ec][probe.label][version - 1]!;
                expect(
                  oracleVersion(probe.char.repeat(maxChars), ec),
                  `${probe.label}×${maxChars} @ EC ${ec} should need v${version}`
                ).toBe(version);
                expect(
                  oracleVersion(probe.char.repeat(maxChars + 1), ec),
                  `${probe.label}×${maxChars + 1} @ EC ${ec} should exceed v${version}`
                ).toBeGreaterThan(version);
              }
            }
          );
        }
      }

      it('still picks the stored version for every mixed payload', () => {
        for (const { payload, versions } of ORACLE.mixed) {
          for (const ec of EC_LEVELS) {
            expect(
              oracleVersion(payload, ec),
              `EC ${ec}: ${payload.slice(0, 40)}`
            ).toBe(versions[ec]);
          }
        }
      });
    }
  );
});
