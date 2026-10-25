/**
 * The file-access check's pure parts (`file-access-check.html`): the
 * check files it writes and the verdict on what it reads back. A check file
 * is a header line naming its body's length and seed, then that many bytes
 * a seeded mix gives for each position, so a file read back after an
 * interrupted write says by itself whether it is a whole check file, one
 * cut short, or a damaged one - no copy of what was written has to survive
 * the closed tab.
 *
 * @see file-access-check.ts.md
 */

/** The header's first word: a file without it is no check file. */
const MAGIC = "FILE-ACCESS-CHECK-1";

/** The longest header line looked for (bytes). */
const MAX_HEADER_BYTES = 64;

/** The largest body a check writes (bytes): 1 GiB, past any sensible test
 *  on a phone. */
export const MAX_BODY_BYTES = 1024 * 1024 * 1024;

/** What a check file was written as: its body's length and its seed. */
export interface CheckFileSpec {
  readonly bodyBytes: number;
  /** A 32-bit seed. */
  readonly seed: number;
}

/** Whether `spec` describes a check file this page may write. */
export function isCheckFileSpec(spec: CheckFileSpec): boolean {
  return (
    Number.isInteger(spec.bodyBytes) &&
    spec.bodyBytes >= 0 &&
    spec.bodyBytes <= MAX_BODY_BYTES &&
    Number.isInteger(spec.seed) &&
    spec.seed >= 0 &&
    spec.seed <= 0xffffffff
  );
}

function requireSpec(spec: CheckFileSpec): void {
  if (!isCheckFileSpec(spec)) {
    throw new RangeError(
      `Not a check file's size and seed: ${String(spec.bodyBytes)}, ${String(spec.seed)}`,
    );
  }
}

/** The header line of a check file written as `spec` (ASCII). */
export function headerOf(spec: CheckFileSpec): Uint8Array {
  requireSpec(spec);
  return new TextEncoder().encode(
    `${MAGIC} ${String(spec.bodyBytes)} ${String(spec.seed)}\n`,
  );
}

/** The whole file's length in bytes for `spec`. */
export function fileBytes(spec: CheckFileSpec): number {
  return headerOf(spec).length + spec.bodyBytes;
}

/** A 32-bit mix of the seed and a word's index (an integer hash, the
 *  "lowbias32" constants): any word of the body without the ones before. */
function wordAt(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** The body's byte at `position`. */
function bodyByte(seed: number, position: number): number {
  return (
    (wordAt(seed, Math.floor(position / 4)) >>> ((position % 4) * 8)) & 0xff
  );
}

/**
 * The body's bytes from `offset`, `length` of them (cut at the body's end),
 * so a large body is written chunk by chunk.
 */
export function bodyChunk(
  spec: CheckFileSpec,
  offset: number,
  length: number,
): Uint8Array {
  requireSpec(spec);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length)) {
    throw new RangeError("A chunk needs a whole offset and length.");
  }
  const end = Math.min(spec.bodyBytes, offset + Math.max(0, length));
  const out = new Uint8Array(Math.max(0, end - offset));
  for (let i = 0; i < out.length; i += 1)
    out[i] = bodyByte(spec.seed, offset + i);
  return out;
}

/** A whole check file for `spec` in one array (for small ones). */
export function checkFile(spec: CheckFileSpec): Uint8Array {
  const header = headerOf(spec);
  const out = new Uint8Array(header.length + spec.bodyBytes);
  out.set(header, 0);
  out.set(bodyChunk(spec, 0, spec.bodyBytes), header.length);
  return out;
}

/** What a file read back is. */
export type Verdict =
  /** A whole check file, as written. */
  | { readonly kind: "whole"; readonly spec: CheckFileSpec }
  /** The start of a check file, cut short after `bodyBytesRead` bytes of
   *  its body (an interrupted write that kept what it had). */
  | {
      readonly kind: "cut-short";
      readonly spec: CheckFileSpec;
      readonly bodyBytesRead: number;
    }
  /** A check file's header, but bytes that are not its body (from
   *  `firstWrongAt` in the body), or more bytes than it names. */
  | {
      readonly kind: "damaged";
      readonly spec: CheckFileSpec;
      readonly firstWrongAt: number;
    }
  /** Empty: a write that emptied the file and wrote nothing. */
  | { readonly kind: "empty" }
  /** No check file at all (no header). */
  | { readonly kind: "foreign" };

/** The spec a file's header names, or null for none. */
export function specOf(bytes: Uint8Array): CheckFileSpec | null {
  const head = bytes.subarray(0, MAX_HEADER_BYTES);
  const end = head.indexOf(0x0a);
  if (end < 0) return null;
  const line = new TextDecoder().decode(head.subarray(0, end));
  const match = /^FILE-ACCESS-CHECK-1 (\d{1,10}) (\d{1,10})$/.exec(line);
  if (match === null) return null;
  const spec = { bodyBytes: Number(match[1]), seed: Number(match[2]) };
  return isCheckFileSpec(spec) ? spec : null;
}

/** What `bytes`, a file read back, is (`Verdict`). */
export function judge(bytes: Uint8Array): Verdict {
  if (bytes.length === 0) return { kind: "empty" };
  const spec = specOf(bytes);
  if (spec === null) return { kind: "foreign" };
  const start = headerOf(spec).length;
  const read = bytes.length - start;
  const checked = Math.min(read, spec.bodyBytes);
  for (let i = 0; i < checked; i += 1) {
    if (bytes[start + i] !== bodyByte(spec.seed, i)) {
      return { kind: "damaged", spec, firstWrongAt: i };
    }
  }
  if (read > spec.bodyBytes) {
    return { kind: "damaged", spec, firstWrongAt: spec.bodyBytes };
  }
  if (read < spec.bodyBytes) {
    return { kind: "cut-short", spec, bodyBytesRead: read };
  }
  return { kind: "whole", spec };
}

/** `bytes` as a person reads a size: "812 B", "1.5 KiB", "50.0 MiB". */
export function sizeWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "an unknown size";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * The verdict in plain words for the log, naming which of the files the
 * check wrote it is: `before` (the file as it was before the rewrite) and
 * `after` (the rewrite's).
 */
export function verdictWords(
  verdict: Verdict,
  written: {
    readonly before?: CheckFileSpec | undefined;
    readonly after?: CheckFileSpec | undefined;
  } = {},
): string {
  const which = (spec: CheckFileSpec): string => {
    if (sameSpec(spec, written.after)) return "the rewritten file";
    if (sameSpec(spec, written.before)) return "the file as it was before";
    return "a check file";
  };
  switch (verdict.kind) {
    case "whole":
      return `WHOLE: ${which(verdict.spec)}, every byte as written (${sizeWords(verdict.spec.bodyBytes)} of data).`;
    case "cut-short":
      return `CUT SHORT: ${which(verdict.spec)}, only ${sizeWords(verdict.bodyBytesRead)} of its ${sizeWords(verdict.spec.bodyBytes)} of data.`;
    case "damaged":
      return `DAMAGED: ${which(verdict.spec)}'s header, but wrong bytes from byte ${String(verdict.firstWrongAt)} of its data.`;
    case "empty":
      return "EMPTY: the file holds nothing.";
    case "foreign":
      return "NOT A CHECK FILE: no check header at its start.";
  }
}

function sameSpec(a: CheckFileSpec, b: CheckFileSpec | undefined): boolean {
  return b !== undefined && a.bodyBytes === b.bodyBytes && a.seed === b.seed;
}

/** How step 4's rewrite was interrupted: the tab closed, or the whole
 *  browser closed (swiped away from the recent apps, or force-stopped). */
export type Interruption = "tab" | "browser";

/** The way of interrupting in plain words, for the log. */
export function interruptionWords(kind: Interruption): string {
  return kind === "tab"
    ? "the tab was closed during the write"
    : "the whole browser was closed during the write (swiped away from the recent apps, or force-stopped)";
}

/** The way of interrupting a stored record names; null for anything that
 *  is not exactly one of the two (an older record, a damaged one). */
export function interruptionOf(value: unknown): Interruption | null {
  return value === "tab" || value === "browser" ? value : null;
}

/** The part of `navigator` the platform line reads. */
export interface PlatformFacts {
  readonly userAgent?: string;
  readonly userAgentData?: {
    readonly platform?: string;
    readonly mobile?: boolean;
  };
}

/**
 * The platform as the log states it: the client hints' platform, whether
 * the user agent names Android, and whether the hints say mobile. Run
 * once with Chrome's "Desktop site" on, it answers whether the hints still
 * say Android while the user agent hides it.
 */
export function platformWords(nav: PlatformFacts): string {
  const platform = nav.userAgentData?.platform;
  const hinted =
    typeof platform === "string" && platform !== "" ? platform : "none given";
  const named = /\bAndroid\b/.test(nav.userAgent ?? "") ? "yes" : "no";
  const mobile = nav.userAgentData?.mobile;
  const mobileWords = mobile === undefined ? "not said" : mobile ? "yes" : "no";
  return `Platform from the client hints: ${hinted} | the user agent names Android: ${named} | mobile: ${mobileWords}`;
}
