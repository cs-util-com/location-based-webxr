/**
 * Codec A5 of the QR payload-compression benchmark (plan §4): fixed binary
 * layout for the `?show=`-style anchor envelope — the inline variant's
 * "maximum effort" density bound (decision D8).
 *
 * Wire layout v0x01 (little-endian):
 * `[version u8][count u8]` then per anchor
 * `[flags u8][lat i32 = deg·1e7][lon i32 = deg·1e7][alt i16 = m·10]`
 * `(+ name: u8 length + UTF-8)(+ ui: u8)(+ s: u16 = ·100)(+ r: u16 = deg·10)`
 * with flags bit0 = name, bit1 = ui, bit2 = s, bit3 = r.
 *
 * DELIBERATELY LOSSY: 1e-7° (≈ 1.1 cm), 0.1 m altitude, 0.01 scale, 0.1°
 * rotation. `decode(encode(x))` returns the canonical re-serialisation of
 * the quantised values (short keys, key order lat/lon/alt/n/ui/s/r), which
 * makes encode→decode→encode idempotent.
 *
 * `encode` throws `TypeError` on inputs that are not a valid envelope
 * (boundary validation); `decode` is TOTAL — malformed input → `null`.
 */

import { decodeBase64Url, encodeBase64Url } from './base64url';
import { utf8DecodeTotal, utf8Encode } from './utf8';
import { normalizeBearingDeg } from '../bearing-degrees.js';

const BINARY_VERSION = 0x01;
const FLAG_NAME = 1;
const FLAG_UI = 2;
const FLAG_SCALE = 4;
const FLAG_ROTATION = 8;
/** i16 decimetres bound the representable altitude. */
const MAX_ABS_ALT = 3276.7;
/** u16 hundredths bound the representable scale. */
const MAX_SCALE = 655.35;

interface WireAnchor {
  lat: number;
  lon: number;
  alt: number;
  n?: string;
  ui?: number;
  s?: number;
  r?: number;
}

/**
 * Promise-returning (not `async` — the work is synchronous) so all
 * benchmark codecs share one signature; validation failures REJECT with
 * `TypeError` rather than throwing synchronously.
 */
export function encodeBinaryAnchorPayload(payload: string): Promise<string> {
  try {
    const anchors = parseEnvelope(payload);
    const out: number[] = [BINARY_VERSION, anchors.length];
    for (const anchor of anchors) {
      packAnchor(anchor, out);
    }
    return Promise.resolve(encodeBase64Url(Uint8Array.from(out)));
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new TypeError(String(error))
    );
  }
}

/** Total decode to the canonical envelope JSON, or `null`. */
export function decodeBinaryAnchorPayload(
  text: string
): Promise<string | null> {
  return Promise.resolve(decodeBinaryAnchorSync(text));
}

function decodeBinaryAnchorSync(text: string): string | null {
  const bytes = decodeBase64Url(text);
  if (bytes === null || bytes.length < 2 || bytes[0] !== BINARY_VERSION) {
    return null;
  }
  const count = bytes[1] ?? 0;
  if (count === 0) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const anchors: WireAnchor[] = [];
  let offset = 2;
  for (let i = 0; i < count; i++) {
    const read = readAnchor(bytes, view, offset);
    if (read === null) {
      return null;
    }
    anchors.push(read.anchor);
    offset = read.next;
  }
  if (offset !== bytes.length) {
    return null; // trailing garbage would break canonical idempotence
  }
  return JSON.stringify({ a: anchors });
}

/** Parse and validate the envelope; throws `TypeError` on any violation. */
function parseEnvelope(payload: string): WireAnchor[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new TypeError('binary anchor codec: payload is not valid JSON');
  }
  const list = (parsed as { a?: unknown })?.a;
  if (!Array.isArray(list) || list.length === 0 || list.length > 255) {
    throw new TypeError(
      'binary anchor codec: envelope must hold 1–255 anchors under key "a"'
    );
  }
  return list.map(validateAnchor);
}

function validateAnchor(entry: unknown): WireAnchor {
  const anchor = entry as Record<string, unknown>;
  const { lat, lon, alt } = anchor;
  if (
    !isFiniteInRange(lat, -90, 90) ||
    !isFiniteInRange(lon, -180, 180) ||
    !isFiniteInRange(alt, -MAX_ABS_ALT, MAX_ABS_ALT)
  ) {
    throw new TypeError('binary anchor codec: lat/lon/alt out of range');
  }
  const result: WireAnchor = { lat, lon, alt };
  assignOptionals(result, anchor);
  return result;
}

function assignOptionals(
  result: WireAnchor,
  anchor: Record<string, unknown>
): void {
  assignName(result, anchor.n);
  assignUi(result, anchor.ui);
  assignScale(result, anchor.s);
  assignRotation(result, anchor.r);
}

/** Empty names are treated as absent (matches the `?show=` wire form). */
function assignName(result: WireAnchor, n: unknown): void {
  if (typeof n !== 'string' || n === '') {
    return;
  }
  if (utf8Encode(n).length > 255) {
    throw new TypeError('binary anchor codec: name exceeds 255 UTF-8 bytes');
  }
  result.n = n;
}

function assignUi(result: WireAnchor, ui: unknown): void {
  if (ui === undefined) {
    return;
  }
  if (!isFiniteInRange(ui, 0, 255) || !Number.isInteger(ui)) {
    throw new TypeError('binary anchor codec: ui must be a u8 integer');
  }
  result.ui = ui;
}

function assignScale(result: WireAnchor, s: unknown): void {
  if (s === undefined) {
    return;
  }
  if (!isFiniteInRange(s, 0.005, MAX_SCALE)) {
    throw new TypeError('binary anchor codec: s out of (0, 655.35]');
  }
  result.s = s;
}

function assignRotation(result: WireAnchor, r: unknown): void {
  if (r === undefined) {
    return;
  }
  if (typeof r !== 'number' || !Number.isFinite(r)) {
    throw new TypeError('binary anchor codec: r must be a finite number');
  }
  result.r = r;
}

function isFiniteInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function packAnchor(anchor: WireAnchor, out: number[]): void {
  const nameBytes = anchor.n === undefined ? null : utf8Encode(anchor.n);
  let flags = 0;
  if (nameBytes !== null) flags |= FLAG_NAME;
  if (anchor.ui !== undefined) flags |= FLAG_UI;
  if (anchor.s !== undefined) flags |= FLAG_SCALE;
  if (anchor.r !== undefined) flags |= FLAG_ROTATION;
  out.push(flags);
  pushInt32(out, Math.round(anchor.lat * 1e7));
  pushInt32(out, Math.round(anchor.lon * 1e7));
  pushInt16(out, Math.round(anchor.alt * 10));
  if (nameBytes !== null) {
    out.push(nameBytes.length, ...nameBytes);
  }
  if (anchor.ui !== undefined) {
    out.push(anchor.ui);
  }
  if (anchor.s !== undefined) {
    pushInt16(out, Math.round(anchor.s * 100));
  }
  if (anchor.r !== undefined) {
    const wrapped = normalizeBearingDeg(anchor.r);
    pushInt16(out, Math.round(wrapped * 10) % 3600);
  }
}

function pushInt32(out: number[], value: number): void {
  const v = value | 0;
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

function pushInt16(out: number[], value: number): void {
  const v = value & 0xffff;
  out.push(v & 0xff, (v >>> 8) & 0xff);
}

interface AnchorRead {
  anchor: WireAnchor;
  next: number;
}

function readAnchor(
  bytes: Uint8Array,
  view: DataView,
  offset: number
): AnchorRead | null {
  if (offset + 11 > bytes.length) {
    return null;
  }
  const flags = bytes[offset] ?? 0;
  const lat = view.getInt32(offset + 1, true) / 1e7;
  const lon = view.getInt32(offset + 5, true) / 1e7;
  const alt = view.getInt16(offset + 9, true) / 10;
  if (!isFiniteInRange(lat, -90, 90) || !isFiniteInRange(lon, -180, 180)) {
    return null;
  }
  const anchor: WireAnchor = { lat, lon, alt };
  return readOptionals(bytes, view, offset + 11, flags, anchor);
}

function readOptionals(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  flags: number,
  anchor: WireAnchor
): AnchorRead | null {
  let offset: number | null = start;
  if (flags & FLAG_NAME) {
    offset = readName(bytes, offset, anchor);
  }
  if (offset !== null && flags & FLAG_UI) {
    offset = readUi(bytes, offset, anchor);
  }
  if (offset !== null && flags & FLAG_SCALE) {
    offset = readScale(bytes, view, offset, anchor);
  }
  if (offset !== null && flags & FLAG_ROTATION) {
    offset = readRotation(bytes, view, offset, anchor);
  }
  return offset === null ? null : { anchor, next: offset };
}

function readName(
  bytes: Uint8Array,
  offset: number,
  anchor: WireAnchor
): number | null {
  const length = bytes[offset] ?? 0;
  if (length === 0 || offset + 1 + length > bytes.length) {
    return null;
  }
  const name = utf8DecodeTotal(bytes.subarray(offset + 1, offset + 1 + length));
  if (name === null) {
    return null;
  }
  anchor.n = name;
  return offset + 1 + length;
}

function readUi(
  bytes: Uint8Array,
  offset: number,
  anchor: WireAnchor
): number | null {
  if (offset + 1 > bytes.length) {
    return null;
  }
  anchor.ui = bytes[offset] ?? 0;
  return offset + 1;
}

function readScale(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  anchor: WireAnchor
): number | null {
  if (offset + 2 > bytes.length) {
    return null;
  }
  anchor.s = view.getUint16(offset, true) / 100;
  return offset + 2;
}

function readRotation(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  anchor: WireAnchor
): number | null {
  if (offset + 2 > bytes.length) {
    return null;
  }
  anchor.r = view.getUint16(offset, true) / 10;
  return offset + 2;
}
