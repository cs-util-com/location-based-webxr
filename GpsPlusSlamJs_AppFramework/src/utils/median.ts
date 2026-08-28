/**
 * Shared median helpers (2026-07-10 quality-review A-2).
 *
 * Six private copies with two silently different semantics used to live in
 * `ar/qr/qr-size-from-depth.ts`, `state/tracking-quality.ts`,
 * `visualization/gps-anchor.ts` (interpolating) and `ar/image-quality.ts`,
 * `ar/qr/qr-pose-aggregation.ts`, `state/qr-detected-slice.ts` (lower-middle).
 * The two variants are deliberately separate named exports — picking the
 * wrong one is exactly the drift this consolidation prevents.
 */

/**
 * Interpolating median: mean of the two middle values for even-length input.
 * Use when a fabricated in-between value is meaningful (continuous
 * measurements: depths, accuracies, coordinates).
 *
 * Empty input → `0` (the "no samples yet" neutral the tracking-quality
 * consumer relies on; the other former copies never receive empty input).
 */
export function interpolatingMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid]!;
  const lo = sorted[mid - 1]!;
  const hi = sorted[mid]!;
  const mean = (lo + hi) / 2;
  // lo + hi can overflow to ±Infinity for huge finite middle values; the
  // half-then-add form is immune (only reached at magnitudes where halving
  // loses no precision), keeping the result within [min, max].
  return Number.isFinite(mean) ? mean : lo / 2 + hi / 2;
}

/**
 * Lower-middle median: for even-length input returns the LOWER of the two
 * middle values — always an actually-observed sample, never a fabricated
 * average. Use when selecting a representative real observation (per-axis
 * QR poses, sharpness histories).
 *
 * Empty input → `NaN` (defensive; all callers guarantee non-empty).
 */
export function lowerMedian(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * Median of `values` under `weights` — the value where half the WEIGHT lies
 * on either side.
 *
 * Lower-median convention, matching {@link lowerMedian}: the result is always
 * an observed sample, and on an exact half-weight tie the LOWER of the two
 * straddling values wins. That convention is shared with the core library's
 * private weighted median inside the alignment solver, and the two are now
 * cross-checked against each other in
 * `GpsPlusSlamJs_Investigation/src/regression/weighted-median-cross-check.test.ts`
 * — the only package that may reach the core's internals; this one may not
 * (IP-protection audit §9).
 *
 * They agree on every well-formed input and differ on four degenerate ones
 * (empty input, a negative weight, a NaN weight, a NaN value), because this is
 * a public utility with arbitrary callers while the core's is private behind a
 * caller that clamps its weights first. The sidecar lists them; the
 * cross-check pins them.
 *
 * Non-finite or non-positive weights are dropped: a weight of zero means "this
 * sample does not count", and a NaN weight is a bug upstream that must not
 * silently move the answer. When nothing survives, falls back to the unweighted
 * {@link lowerMedian} so a caller never gets NaN from a usable sample set.
 */
export function weightedMedian(
  values: readonly number[],
  weights: readonly number[]
): number {
  const pairs: { value: number; weight: number }[] = [];
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const weight = weights[i];
    if (value === undefined || !Number.isFinite(value)) continue;
    if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    pairs.push({ value, weight });
    total += weight;
  }
  if (pairs.length === 0) return lowerMedian(values);
  pairs.sort((a, b) => a.value - b.value);

  const half = total / 2;
  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= half) return pair.value;
  }
  // Unreachable for finite positive weights; kept total rather than throwing.
  return pairs[pairs.length - 1]?.value ?? lowerMedian(values);
}
