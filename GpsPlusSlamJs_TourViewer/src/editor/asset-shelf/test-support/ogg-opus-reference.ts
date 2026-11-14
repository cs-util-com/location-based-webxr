/**
 * A reference Ogg Opus file written by FFmpeg (libopus, bit-exact mode,
 * stream serial 0): half a second of a 440 Hz sine, 48 kHz mono, 24 kbps.
 * Three pages - the identification header, the comment header and one
 * audio page carrying every packet - so the writer can be checked byte for
 * byte against another implementation, CRC included. Test-only.
 *
 * Made with: ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.5"
 *   -ac 1 -c:a libopus -b:a 24k -serial_offset 0 -fflags +bitexact
 *   -flags:a +bitexact ref.opus
 */
export const FFMPEG_OGG_OPUS_BASE64 = [
  "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",
].join("");
