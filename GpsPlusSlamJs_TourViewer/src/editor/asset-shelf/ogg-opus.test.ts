/**
 * Why these tests matter: a sound made smaller must play exactly as long
 * as the original, or a narration's read-along drifts from the voice. The
 * Ogg container carries that length (the pre-skip in the header, the last
 * sample in the final page's granule position), and the browser has no
 * Ogg writer, so ours must be right byte for byte. The reference is a file
 * FFmpeg wrote: the same packets and header fields must give the same
 * bytes, CRCs included.
 */
import { describe, expect, it } from "vitest";

import {
  oggCrc32,
  oggOpusPages,
  opusHeadOf,
  opusPacketSamples,
  type OggOpusStream,
} from "./ogg-opus.js";
import { FFMPEG_OGG_OPUS_BASE64 } from "./test-support/ogg-opus-reference.js";

function base64Bytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

interface ReadPage {
  readonly type: number;
  readonly granule: bigint;
  readonly serial: number;
  readonly seq: number;
  readonly packets: Uint8Array[];
  readonly bytes: Uint8Array;
}

/** An independent reader of Ogg pages (no continued packets). */
function readPages(file: Uint8Array): ReadPage[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const pages: ReadPage[] = [];
  let at = 0;
  while (at < file.length) {
    const segments = file[at + 26]!;
    const lacing = file.subarray(at + 27, at + 27 + segments);
    let body = at + 27 + segments;
    const packets: Uint8Array[] = [];
    let start = body;
    let length = 0;
    for (const lace of lacing) {
      length += lace;
      if (lace < 255) {
        packets.push(file.subarray(start, start + length));
        start += length;
        length = 0;
      }
    }
    body = start;
    pages.push({
      type: file[at + 5]!,
      granule: view.getBigInt64(at + 6, true),
      serial: view.getUint32(at + 14, true),
      seq: view.getUint32(at + 18, true),
      packets,
      bytes: file.subarray(at, body),
    });
    at = body;
  }
  return pages;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("the Ogg CRC", () => {
  it("has the Ogg polynomial's check value (direct, no reflection, no final xor)", () => {
    // CRC-32 with polynomial 0x04C11DB7, initial 0, no reflection and no
    // final xor gives 0x89A1897F for "123456789".
    expect(oggCrc32(new TextEncoder().encode("123456789"))).toBe(0x89a1897f);
  });
});

describe("an Opus packet's length in samples (RFC 6716, 3.1)", () => {
  it("reads the frame size and count from the table-of-contents byte", () => {
    // config 31 (CELT 20 ms), one frame
    expect(opusPacketSamples(Uint8Array.of(31 << 3))).toBe(960);
    // config 16 (CELT 2.5 ms), two equal frames (code 1)
    expect(opusPacketSamples(Uint8Array.of((16 << 3) | 1))).toBe(240);
    // config 3 (SILK 60 ms), one frame
    expect(opusPacketSamples(Uint8Array.of(3 << 3))).toBe(2880);
    // config 13 (hybrid 20 ms), code 3 with 3 frames
    expect(opusPacketSamples(Uint8Array.of((13 << 3) | 3, 3))).toBe(2880);
    // config 0 (SILK 10 ms), code 2 (two frames of different sizes)
    expect(opusPacketSamples(Uint8Array.of(2, 1, 0))).toBe(960);
  });

  it("refuses a packet it cannot read: empty, a code 3 without its count, or over 120 ms", () => {
    expect(() => opusPacketSamples(new Uint8Array(0))).toThrow();
    expect(() => opusPacketSamples(Uint8Array.of((31 << 3) | 3))).toThrow();
    // code 3 with 0 frames
    expect(() => opusPacketSamples(Uint8Array.of((31 << 3) | 3, 0))).toThrow();
    // 7 frames of 20 ms = 140 ms
    expect(() => opusPacketSamples(Uint8Array.of((31 << 3) | 3, 7))).toThrow();
  });
});

describe("the identification header the encoder hands over", () => {
  it("reads the channels, pre-skip and input rate of an OpusHead", () => {
    // The description Chromium's AudioEncoder gives for 48 kHz mono.
    const description = Uint8Array.of(
      79,
      112,
      117,
      115,
      72,
      101,
      97,
      100,
      1,
      1,
      56,
      1,
      128,
      187,
      0,
      0,
      0,
      0,
      0,
    );
    expect(opusHeadOf(description)).toEqual({
      channels: 1,
      preSkip: 312,
      inputSampleRate: 48000,
    });
  });

  it("returns null for anything that is no OpusHead of mapping family 0", () => {
    expect(opusHeadOf(undefined)).toBeNull();
    expect(opusHeadOf(new Uint8Array(19))).toBeNull();
    const familyOne = Uint8Array.of(
      79,
      112,
      117,
      115,
      72,
      101,
      97,
      100,
      1,
      2,
      56,
      1,
      128,
      187,
      0,
      0,
      0,
      0,
      1,
    );
    expect(opusHeadOf(familyOne)).toBeNull();
    expect(opusHeadOf(familyOne.subarray(0, 12))).toBeNull();
  });
});

describe("the Ogg Opus writer", () => {
  const reference = base64Bytes(FFMPEG_OGG_OPUS_BASE64);
  const refPages = readPages(reference);

  it("writes FFmpeg's file byte for byte from the same packets and header", () => {
    // What FFmpeg's file says about itself, read independently.
    expect(refPages).toHaveLength(3);
    const head = opusHeadOf(refPages[0]!.packets[0]);
    expect(head).toEqual({ channels: 1, preSkip: 312, inputSampleRate: 48000 });
    const packets = refPages[2]!.packets;
    const stream: OggOpusStream = {
      channels: 1,
      preSkip: 312,
      inputSampleRate: 48000,
      serial: 0,
      vendor: "ffmpeg",
      comments: ["encoder=Lavc libopus"],
    };
    // 0.5 s at 48 kHz: the last page's granule is the pre-skip plus that.
    const written = concat(oggOpusPages(stream, packets, 24000));
    expect(Buffer.from(written).toString("hex")).toBe(
      Buffer.from(reference).toString("hex"),
    );
  });

  it("puts the exact length in the last page: pre-skip plus every input sample", () => {
    const packets = Array.from({ length: 120 }, (_, i) =>
      Uint8Array.of(31 << 3, i & 0xff, 7),
    );
    // 120 packets of 960 samples = 115 200; 114 000 input samples + 312
    // pre-skip leave 888 to trim at the end.
    const pages = readPages(
      concat(
        oggOpusPages(
          {
            channels: 2,
            preSkip: 312,
            inputSampleRate: 44100,
            serial: 7,
            vendor: "x",
          },
          packets,
          114_000,
        ),
      ),
    );
    const last = pages[pages.length - 1]!;
    expect(last.type).toBe(4); // end of stream
    expect(last.granule).toBe(114_312n);
    expect(pages[0]!.type).toBe(2); // beginning of stream
    expect(pages.map((p) => p.seq)).toEqual(pages.map((_, i) => i));
    expect(new Set(pages.map((p) => p.serial))).toEqual(new Set([7]));
    // Every packet comes back, in order, and no audio page holds more than
    // a second.
    expect(pages.slice(2).flatMap((p) => p.packets)).toEqual(packets);
    let before = 0n;
    for (const page of pages.slice(2, -1)) {
      expect(page.granule - before).toBeLessThanOrEqual(48_000n);
      before = page.granule;
    }
  });

  it("refuses a length the packets do not reach, and one it would have to cut past the last page", () => {
    const one = [Uint8Array.of(31 << 3)];
    const stream = {
      channels: 1,
      preSkip: 312,
      inputSampleRate: 48000,
      serial: 1,
      vendor: "x",
    } as const;
    expect(() => oggOpusPages(stream, one, 960)).toThrow(/longer/);
    expect(() => oggOpusPages(stream, one, 0)).toThrow();
    expect(() => oggOpusPages(stream, [], 0)).toThrow();
    // 60 packets fill more than one page; a length ending a whole page
    // before the end cannot be trimmed from the last page alone.
    const many = Array.from({ length: 60 }, () => Uint8Array.of(31 << 3));
    expect(() => oggOpusPages(stream, many, 1000)).toThrow(/last page/);
  });

  it("refuses header fields out of range", () => {
    const ok = {
      channels: 1,
      preSkip: 312,
      inputSampleRate: 48000,
      serial: 1,
      vendor: "x",
    };
    const packets = [Uint8Array.of(31 << 3)];
    expect(() => oggOpusPages({ ...ok, channels: 3 }, packets, 100)).toThrow();
    expect(() => oggOpusPages({ ...ok, preSkip: -1 }, packets, 100)).toThrow();
    expect(() =>
      oggOpusPages({ ...ok, serial: 2 ** 32 }, packets, 100),
    ).toThrow();
  });
});
