/**
 * Our own Ogg Opus writer (RFC 7845 over RFC 3533), exact to the sample:
 * the browser encodes Opus (`AudioEncoder`) but writes no container. The
 * identification header carries the encoder's pre-skip, and the last
 * page's granule position the pre-skip plus every input sample, so a
 * player trims the encoder's delay at the start and its padding at the
 * end and the sound lasts exactly as long as what went in. Pure: no DOM,
 * used inside the optimizer's Worker (`sound-step.ts`).
 *
 * @see ogg-opus.ts.md
 */

/** Opus always counts granule positions at 48 kHz (RFC 7845, 4). */
const OPUS_RATE = 48_000;
/** An audio page holds at most this many samples (one second, as FFmpeg
 *  writes), so a player can seek in steps of a second. */
const PAGE_SAMPLES = OPUS_RATE;
/** An Ogg page holds at most 255 lacing values. */
const MAX_SEGMENTS = 255;
/** RFC 6716, 3.2.5: a packet holds at most 120 ms. */
const MAX_PACKET_SAMPLES = 5760;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

/** The Ogg page checksum: CRC-32, polynomial 0x04C11DB7, initial value
 *  0, no reflection, no final xor (RFC 3533, 6). */
export function oggCrc32(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc;
}

/** One Opus frame's length in samples at 48 kHz, by its configuration
 *  number (RFC 6716, 3.1): SILK 0-11, hybrid 12-15, CELT 16-31. */
function frameSamples(config: number): number {
  if (config < 12) return [480, 960, 1920, 2880][config & 3]!;
  if (config < 16) return [480, 960][config & 1]!;
  return [120, 240, 480, 960][config & 3]!;
}

/** How many samples (at 48 kHz) the Opus packet `packet` decodes to, read
 *  from its table-of-contents byte. Throws for an empty packet, a code 3
 *  packet without its frame count or with none, or one over 120 ms. */
export function opusPacketSamples(packet: Uint8Array): number {
  const toc = packet[0];
  if (toc === undefined) throw new Error("an empty Opus packet");
  const code = toc & 3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code < 3) frames = 2;
  else {
    const count = packet[1];
    if (count === undefined)
      throw new Error("an Opus packet without its frame count");
    frames = count & 0x3f;
  }
  const samples = frames * frameSamples(toc >> 3);
  if (frames === 0 || samples > MAX_PACKET_SAMPLES) {
    throw new Error(`an Opus packet of ${frames} frames is not one`);
  }
  return samples;
}

/** What an Opus identification header says, of what the writer needs. */
export interface OpusHead {
  readonly channels: number;
  /** Samples (48 kHz) the decoder drops at the start: the encoder's delay. */
  readonly preSkip: number;
  readonly inputSampleRate: number;
}

const OPUS_HEAD = "OpusHead";
const OPUS_TAGS = "OpusTags";

function startsWith(bytes: Uint8Array, magic: string): boolean {
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

/** The OpusHead the encoder hands over as its decoder description, read;
 *  null for anything else (too short, another magic, version not 1, a
 *  channel mapping family other than 0 - which only mono and stereo use). */
export function opusHeadOf(
  description: Uint8Array | undefined,
): OpusHead | null {
  if (description === undefined || description.length < 19) return null;
  if (!startsWith(description, OPUS_HEAD)) return null;
  const view = new DataView(
    description.buffer,
    description.byteOffset,
    description.byteLength,
  );
  const channels = view.getUint8(9);
  if (view.getUint8(8) !== 1 || view.getUint8(18) !== 0) return null;
  if (channels < 1 || channels > 2) return null;
  return {
    channels,
    preSkip: view.getUint16(10, true),
    inputSampleRate: view.getUint32(12, true),
  };
}

/** The stream's header fields and its Ogg identity. */
export interface OggOpusStream extends OpusHead {
  /** The Ogg stream serial number, 0..2^32-1. */
  readonly serial: number;
  /** The comment header's vendor string. */
  readonly vendor: string;
  /** `KEY=value` comments; none by default. */
  readonly comments?: readonly string[];
}

function identificationHeader(stream: OggOpusStream): Uint8Array {
  const out = new Uint8Array(19);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(OPUS_HEAD), 0);
  view.setUint8(8, 1); // version
  view.setUint8(9, stream.channels);
  view.setUint16(10, stream.preSkip, true);
  view.setUint32(12, stream.inputSampleRate, true);
  view.setInt16(16, 0, true); // output gain
  view.setUint8(18, 0); // mapping family 0: mono or stereo
  return out;
}

function commentHeader(stream: OggOpusStream): Uint8Array {
  const text = new TextEncoder();
  const vendor = text.encode(stream.vendor);
  const comments = (stream.comments ?? []).map((c) => text.encode(c));
  const size =
    8 + 4 + vendor.length + 4 + comments.reduce((n, c) => n + 4 + c.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(text.encode(OPUS_TAGS), 0);
  let at = 8;
  view.setUint32(at, vendor.length, true);
  out.set(vendor, at + 4);
  at += 4 + vendor.length;
  view.setUint32(at, comments.length, true);
  at += 4;
  for (const comment of comments) {
    view.setUint32(at, comment.length, true);
    out.set(comment, at + 4);
    at += 4 + comment.length;
  }
  return out;
}

const FLAG_FIRST = 0x02;
const FLAG_LAST = 0x04;

/** One page of whole packets (never a continued one). */
function page(
  stream: OggOpusStream,
  sequence: number,
  flags: number,
  granule: number,
  packets: readonly Uint8Array[],
): Uint8Array {
  const lacing: number[] = [];
  for (const packet of packets) {
    for (let left = packet.length; ; left -= 255) {
      lacing.push(Math.min(left, 255));
      if (left < 255) break;
    }
  }
  if (lacing.length > MAX_SEGMENTS) {
    throw new Error("an Opus packet too large for one Ogg page");
  }
  const bodyLength = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  view.setUint8(4, 0); // version
  view.setUint8(5, flags);
  view.setBigInt64(6, BigInt(granule), true);
  view.setUint32(14, stream.serial, true);
  view.setUint32(18, sequence, true);
  // The checksum (22..25) is computed with its own field as zero.
  view.setUint8(26, lacing.length);
  out.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const packet of packets) {
    out.set(packet, at);
    at += packet.length;
  }
  view.setUint32(22, oggCrc32(out), true);
  return out;
}

/** How many lacing values `packet` takes. */
const segmentsOf = (packet: Uint8Array) => Math.floor(packet.length / 255) + 1;

function checkStream(stream: OggOpusStream): void {
  const whole = (n: number, max: number) =>
    Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (stream.channels !== 1 && stream.channels !== 2) {
    throw new Error(`an Ogg Opus stream of ${stream.channels} channels`);
  }
  if (!whole(stream.preSkip, 0xffff))
    throw new Error("a pre-skip out of range");
  if (
    !whole(stream.inputSampleRate, 0xffffffff) ||
    !whole(stream.serial, 0xffffffff)
  ) {
    throw new Error("an input rate or serial number out of range");
  }
}

/**
 * The pages of an Ogg Opus file: the identification header, the comment
 * header, then the audio `packets` (as the encoder made them, in order) on
 * pages of at most a second, the last one marked end of stream with the
 * granule position `preSkip + totalSamples`. `totalSamples` is how many
 * samples (at 48 kHz) went into the encoder.
 *
 * Throws when the packets are shorter than that, when it is not a positive
 * whole number, or when trimming would have to reach past the last page
 * (RFC 7845, 4.5: only the last page may end early).
 */
export function oggOpusPages(
  stream: OggOpusStream,
  packets: readonly Uint8Array[],
  totalSamples: number,
): Uint8Array[] {
  checkStream(stream);
  if (!Number.isSafeInteger(totalSamples) || totalSamples <= 0) {
    throw new Error("a sound of no samples");
  }
  const end = stream.preSkip + totalSamples;
  const pages = [
    page(stream, 0, FLAG_FIRST, 0, [identificationHeader(stream)]),
    page(stream, 1, 0, 0, [commentHeader(stream)]),
  ];
  let granule = 0;
  let pageStart = 0;
  let held: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    if (last) {
      if (end > granule) {
        throw new Error("the sound is longer than its Opus packets");
      }
      if (end <= pageStart) {
        throw new Error("the sound ends before the last page");
      }
    }
    pages.push(
      page(
        stream,
        pages.length,
        last ? FLAG_LAST : 0,
        last ? end : granule,
        held,
      ),
    );
    pageStart = granule;
    held = [];
    segments = 0;
  };
  for (const packet of packets) {
    const need = segmentsOf(packet);
    if (
      held.length > 0 &&
      (segments + need > MAX_SEGMENTS || granule - pageStart >= PAGE_SAMPLES)
    ) {
      flush(false);
    }
    granule += opusPacketSamples(packet);
    held.push(packet);
    segments += need;
  }
  if (held.length === 0) throw new Error("a sound of no Opus packets");
  flush(true);
  return pages;
}
