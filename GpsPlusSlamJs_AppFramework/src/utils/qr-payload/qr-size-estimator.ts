/**
 * QR size estimator — the metric of the QR payload-compression benchmark
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-0611-qr-payload-compression-benchmark-plan.md §3).
 *
 * Given a payload string and an error-correction level it returns the QR
 * bit-stream size after OPTIMAL mode segmentation, the minimum QR version
 * that holds it, and the resulting module width — or `null` when the payload
 * exceeds the v25 capacity table. Total: never throws on any input.
 *
 * Segmentation uses the per-character dynamic programme described by Nayuki
 * ("Optimal text segmentation for QR Codes"): costs are tracked in 1/6-bit
 * units so the fractional per-character costs of numeric (10/3 bits) and
 * alphanumeric (11/2 bits) modes stay exact integers; switching modes rounds
 * the accumulated cost up to whole bits and pays the new segment header.
 * Kanji mode and ECI are not modelled (the benchmark corpus is ASCII).
 */

/**
 * Every QR error-correction level, and **the source of truth for the type**.
 *
 * Const first, type derived: {@link EC_LEVELS} is a RUNTIME validator
 * (`estimateQrModuleCount` rejects a level absent from it), and while it was
 * written as `readonly QrEcLevel[]` an incomplete list still type-checked — so
 * a level added to the union would have compiled everywhere and then been
 * rejected at runtime. Derived this way that cannot happen.
 *
 * `DATA_CODEWORDS` below is `Record<QrEcLevel, …>`, which TypeScript already
 * checks for exhaustiveness — so the table could not drift, but the list
 * guarding the door could. That asymmetry is exactly what made it easy to miss.
 */
const EC_LEVELS = ['L', 'M', 'Q', 'H'] as const;

export type QrEcLevel = (typeof EC_LEVELS)[number];

export interface QrSizeEstimate {
  /** Bit-stream size of the optimally segmented payload. */
  bits: number;
  /** Smallest QR version (1–25) whose data capacity holds `bits`. */
  version: number;
  /** Module width of that version: `17 + 4·version`. */
  modules: number;
}

/** The 45-character QR alphanumeric-mode charset, in spec value order. */
export const QR_ALPHANUMERIC_CHARSET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/**
 * Data codewords per version (index = version − 1) and EC level, versions
 * 1–25, ISO/IEC 18004. Data capacity in bits is `codewords × 8`. Every entry
 * is pinned by the oracle boundary test against the `qrcode` package.
 */
const DATA_CODEWORDS: Record<QrEcLevel, readonly number[]> = {
  L: [
    19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589,
    647, 721, 795, 861, 932, 1006, 1094, 1174, 1276,
  ],
  M: [
    16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453,
    507, 563, 627, 669, 714, 782, 860, 914, 1000,
  ],
  Q: [
    13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325,
    367, 397, 445, 485, 512, 568, 614, 664, 718,
  ],
  H: [
    9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283,
    313, 341, 385, 406, 442, 464, 514, 538,
  ],
};

/** Modes are indexed 0 = numeric, 1 = alphanumeric, 2 = byte throughout. */
type ModeCosts = [number, number, number];

interface VersionGroup {
  minVersion: number;
  maxVersion: number;
  /** Character-count-indicator bit widths per mode for this group. */
  cci: ModeCosts;
}

/**
 * Version groups share CCI widths, so the segmentation bit count is constant
 * within a group. v27–40 is deliberately absent — the capacity table (and the
 * plan) stop at v25, so group 2 is clamped there.
 */
const VERSION_GROUPS: readonly VersionGroup[] = [
  { minVersion: 1, maxVersion: 9, cci: [10, 9, 8] },
  { minVersion: 10, maxVersion: 25, cci: [12, 11, 16] },
];

/**
 * Estimate the QR footprint of `payload` at `ecLevel`.
 *
 * Returns `null` when the payload does not fit any version ≤ 25 at that EC
 * level, or when `ecLevel` is not one of L/M/Q/H (defensive boundary — a
 * caller bug degrades to "doesn't fit", never a throw).
 */
export function estimateQrSize(
  payload: string,
  ecLevel: QrEcLevel
): QrSizeEstimate | null {
  if (typeof payload !== 'string' || !EC_LEVELS.includes(ecLevel)) {
    return null;
  }
  for (const group of VERSION_GROUPS) {
    const bits = minimalBitCost(payload, group.cci);
    const version = smallestFittingVersion(bits, ecLevel, group);
    if (version !== null) {
      return { bits, version, modules: 17 + 4 * version };
    }
  }
  return null;
}

/** Smallest version within `group` whose data capacity holds `bits`, or null. */
function smallestFittingVersion(
  bits: number,
  ecLevel: QrEcLevel,
  group: VersionGroup
): number | null {
  const codewords = DATA_CODEWORDS[ecLevel];
  for (let version = group.minVersion; version <= group.maxVersion; version++) {
    const capacity = codewords[version - 1];
    if (capacity !== undefined && bits <= capacity * 8) {
      return version;
    }
  }
  return null;
}

/**
 * Minimal bit-stream size of `payload` under the CCI widths of one version
 * group, via the 1/6-bit dynamic programme (see module doc). Zero for the
 * empty payload — no segments are emitted at all.
 */
function minimalBitCost(payload: string, cci: ModeCosts): number {
  if (payload.length === 0) {
    return 0;
  }
  const headerCosts: ModeCosts = [
    (4 + cci[0]) * 6,
    (4 + cci[1]) * 6,
    (4 + cci[2]) * 6,
  ];
  let costs: ModeCosts = [...headerCosts];
  for (const char of payload) {
    costs = relaxCharacter(costs, charCosts(char), headerCosts);
  }
  return Math.ceil(Math.min(...costs) / 6);
}

/** Per-character cost in 1/6 bits for each mode; Infinity when ineligible. */
function charCosts(char: string): ModeCosts {
  const isDigit = char >= '0' && char <= '9';
  const isAlnum = QR_ALPHANUMERIC_CHARSET.includes(char);
  return [
    isDigit ? 20 : Number.POSITIVE_INFINITY, // 10 bits / 3 chars
    isAlnum ? 33 : Number.POSITIVE_INFINITY, // 11 bits / 2 chars
    utf8ByteLength(char) * 48, // 8 bits / byte
  ];
}

/**
 * One DP step: extend each mode by the character, then allow switching into
 * each mode from the cheapest other one, rounding the source cost up to whole
 * bits (segment boundaries end on whole bits) and paying the new header.
 */
function relaxCharacter(
  previous: ModeCosts,
  perChar: ModeCosts,
  headerCosts: ModeCosts
): ModeCosts {
  const extended: ModeCosts = [
    previous[0] + perChar[0],
    previous[1] + perChar[1],
    previous[2] + perChar[2],
  ];
  const result: ModeCosts = [...extended];
  for (const target of [0, 1, 2] as const) {
    for (const source of [0, 1, 2] as const) {
      if (source === target || !Number.isFinite(extended[source])) {
        continue;
      }
      const switched =
        Math.ceil(extended[source] / 6) * 6 + headerCosts[target];
      if (switched < result[target]) {
        result[target] = switched;
      }
    }
  }
  return result;
}

/** UTF-8 byte length of one code point (the string is one `for…of` unit). */
function utf8ByteLength(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  if (codePoint < 0x10000) {
    return 3;
  }
  return 4;
}
