/**
 * What the page says about a tour's signature, in plain words (tour kit
 * plan K1, K-D2): "signed by" a short key fingerprint, "not signed", or -
 * on a browser without Ed25519 - "signed, but not checked here", never
 * "valid". Then the trust-on-first-use warnings (`tour-trust.ts`) and the
 * links to other series. Worded for a visitor, like the rest of the Tour
 * Viewer's copy: a key is never called a person (K2 adds the nickname a
 * player gives a key). Pure: fingerprints come in already computed.
 */

import type { TrustWarning } from "./tour-trust.js";

/** The signature state the copy describes. */
export type SignatureState =
  | { readonly kind: "none" }
  | { readonly kind: "listed" }
  | { readonly kind: "signed"; readonly author: string }
  | { readonly kind: "unsupported"; readonly author: string };

export interface TrustCopyInput {
  readonly signature: SignatureState;
  readonly warnings: readonly TrustWarning[];
  /** The manifest's `links` (`SignedTourManifest.links`). */
  readonly links: readonly {
    readonly seriesId: string;
    readonly author: string;
  }[];
  /** A key's short fingerprint (`keyFingerprint`), precomputed for every
   *  key the input names. */
  readonly fingerprintOf: (author: string) => string;
}

function signatureLine(
  signature: SignatureState,
  fp: (author: string) => string,
): string {
  switch (signature.kind) {
    case "signed":
      return `Signed by key ${fp(signature.author)}: the tour has not been changed since this key signed it. A key is not a verified person - trust it as far as you trust where the link came from.`;
    case "unsupported":
      return `Signed by key ${fp(signature.author)}, but this browser cannot check signatures, so the signature was NOT checked. Update the browser to check it.`;
    case "listed":
      return "Not signed: its files match its own list of contents, but nobody vouches for who made it.";
    case "none":
      return "Not signed: there is no way to check who made this tour or whether it was changed.";
  }
}

function sourceName(source: "link" | "code"): string {
  return source === "code" ? "printed code" : "link";
}

function warningLine(
  warning: TrustWarning,
  fp: (author: string) => string,
): string {
  switch (warning.kind) {
    case "source-key-changed":
      return `Warning: this ${sourceName(warning.source)} used to open a tour signed by key ${fp(warning.was)}. This one is signed by key ${fp(warning.now)}, so it may not come from the same author.`;
    case "source-lost-signature":
      return `Warning: this ${sourceName(warning.source)} used to open a tour signed by key ${fp(warning.was)}. This copy is not signed, so someone else may have replaced it.`;
    case "series-key-changed":
      return `Warning: this tour says it is a version of a tour you opened before, which was signed by key ${fp(warning.was)}. This one is ${
        warning.now === null ? "not signed" : `signed by key ${fp(warning.now)}`
      }.`;
  }
}

/** One line naming the linked series, each by the start of its id and its
 *  key - "the same key" when it is this tour's signer. For a SIGNED tour
 *  only (K1 milestone review R12): links are the author's claim, and
 *  without a checked signature nobody vouches for them - a line naming
 *  keys would lend any key the look of a known author. */
function linksLine(input: TrustCopyInput): string | null {
  if (input.links.length === 0 || input.signature.kind !== "signed") {
    return null;
  }
  const signer = input.signature.author;
  const named = input.links.map(
    (link) =>
      `${link.seriesId.slice(0, 8)} (${
        link.author === signer
          ? "same key"
          : `key ${input.fingerprintOf(link.author)}`
      })`,
  );
  return `Links to ${String(input.links.length)} other ${
    input.links.length === 1 ? "tour" : "tours"
  }: ${named.join(", ")}.`;
}

/** The lines the page shows under the tour, in order: the signature, the
 *  warnings, the links. */
export function trustLines(input: TrustCopyInput): string[] {
  const lines = [
    signatureLine(input.signature, input.fingerprintOf),
    ...input.warnings.map((w) => warningLine(w, input.fingerprintOf)),
  ];
  const links = linksLine(input);
  return links === null ? lines : [...lines, links];
}
