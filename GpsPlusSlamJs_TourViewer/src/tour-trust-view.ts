/**
 * The lines the page shows about an opened tour's signature (tour kit plan
 * K1): its signature state from tier 1 (`tour-integrity.ts`), judged
 * against what this phone remembers (`tour-trust.ts`, trust on first use
 * keyed by source), worded by `tour-trust-copy.ts`, with every key named by
 * its short fingerprint. DOM-free, so the page only renders strings.
 */

import { keyFingerprint } from "gps-plus-slam-app-framework/ar/tour-signature";

import type { TourIntegrity } from "./tour-integrity.js";
import { trustLines, type SignatureState } from "./tour-trust-copy.js";
import {
  judgeTrust,
  loadTrustRecords,
  saveTrustRecords,
  type TrustObservation,
  type TrustStorage,
  type TrustWarning,
} from "./tour-trust.js";

/** The signature state a tier-1 result shows. */
export function signatureStateOf(integrity: TourIntegrity): SignatureState {
  if (integrity.kind === "none") return { kind: "none" };
  const signature = integrity.signature;
  if (signature === null) return { kind: "listed" };
  return signature.kind === "valid"
    ? { kind: "signed", author: signature.author }
    : { kind: "unsupported", author: signature.author };
}

/** What trust on first use records for this open; null when the signature
 *  could not be checked here (an unchecked key must neither be learned nor
 *  compared). */
function observationOf(
  integrity: TourIntegrity,
  state: SignatureState,
): TrustObservation | null {
  if (state.kind === "unsupported") return null;
  return {
    author: state.kind === "signed" ? state.author : null,
    seriesId: integrity.kind === "none" ? null : integrity.manifest.seriesId,
  };
}

function keysNamed(
  state: SignatureState,
  warnings: readonly TrustWarning[],
  links: readonly { author: string }[],
): string[] {
  const keys = new Set<string>();
  if (state.kind === "signed" || state.kind === "unsupported")
    keys.add(state.author);
  for (const w of warnings) {
    keys.add(w.was);
    if (w.kind !== "source-lost-signature" && w.now !== null) keys.add(w.now);
  }
  for (const link of links) keys.add(link.author);
  return [...keys];
}

/**
 * Judge an opened tour and word the result. Records the sight on the
 * device (unless its signature could not be checked).
 *
 * @param sources the open's trust keys (`linkTrustKey`, `codeTrustKey`)
 */
export async function describeTourTrust(input: {
  readonly integrity: TourIntegrity;
  readonly sources: readonly string[];
  readonly storage: TrustStorage | undefined;
  readonly nowMs: number;
}): Promise<string[]> {
  const state = signatureStateOf(input.integrity);
  const observed = observationOf(input.integrity, state);
  let warnings: TrustWarning[] = [];
  if (observed !== null) {
    const judged = judgeTrust(
      loadTrustRecords(input.storage),
      input.sources,
      observed,
      input.nowMs,
    );
    saveTrustRecords(input.storage, judged.records);
    warnings = judged.warnings;
  }
  const links =
    input.integrity.kind === "none" ? [] : input.integrity.manifest.links;
  const keys = keysNamed(state, warnings, links);
  const prints = new Map(
    await Promise.all(
      keys.map(async (k) => [k, await keyFingerprint(k)] as const),
    ),
  );
  return trustLines({
    signature: state,
    warnings,
    links,
    fingerprintOf: (author) => prints.get(author) ?? author,
  });
}
