# ogg-opus.ts

**Purpose:** our own Ogg Opus writer (RFC 3533 pages, RFC 7845 mapping): the packets an Opus encoder made, with its OpusHead, written as a file that lasts exactly as many samples as its input.

## Public API

- `oggCrc32(bytes)`: the Ogg page checksum (polynomial 0x04C11DB7, initial 0, not reflected, no final xor; the check value of "123456789" is 0x89A1897F).
- `opusPacketSamples(packet)`: the 48 kHz samples one Opus packet holds, read from its TOC byte (RFC 6716 3.1: frame size by config, frame count by code 0-3). Throws for an empty packet, a code-3 packet without its count byte, or a frame count that is no frame count.
- `OpusHead`: `{ channels, preSkip, inputSampleRate }`.
- `opusHeadOf(description)`: the OpusHead an encoder's decoder description carries (WebCodecs `decoderConfig.description`), or null for anything else: fewer than 19 bytes, not "OpusHead", not version 1, a mapping family other than 0, or not 1-2 channels.
- `OggOpusStream`: an `OpusHead` plus `serial`, `vendor` and optional `comments`.
- `oggOpusPages(stream, packets, totalSamples)`: the file's pages, in order.

## Invariants

- Page 0 holds the OpusHead alone (beginning of stream), page 1 the OpusTags; audio pages follow, each holding at most one second of samples and at most 255 lacing segments; the last page is marked end of stream.
- The last page's granule is `preSkip + totalSamples`, so a decoder trims the encoder's padding and the file plays exactly `totalSamples` samples. A packet that starts after that sample is refused ("the sound is longer than its Opus packets"), and packets that end before it are refused ("the sound ends before the last page"): a wrong length would move every caption timed against the sound.
- Granules never decrease; a page that only continues a packet carries granule -1, as the format asks.
- Header fields out of range (channels, pre-skip, input rate, serial) throw with words rather than write a file a player would misread.

## Examples

```ts
const head = opusHeadOf(description);
const pages = oggOpusPages(
  { ...head!, serial, vendor: "tour editor" },
  packets,
  frames,
);
const blob = new Blob(pages, { type: "audio/ogg" });
```

## Tests

- `ogg-opus.test.ts`: the CRC check value, TOC cases, OpusHead parsing and refusals, the exact last granule, and a file FFmpeg wrote (`test-support/ogg-opus-reference.ts`) reproduced byte for byte from its own packets.
- `ogg-opus.property.test.ts`: for random packet runs, every page's CRC, sequence numbers, non-decreasing granules, the segment cap, the packets read back in order and the final granule.
