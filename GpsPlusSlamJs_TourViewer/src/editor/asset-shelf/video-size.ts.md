# video-size.ts

## Purpose

Whether a video on the asset shelf is large for its length. A video is
used as it is (the browser cannot make one smaller), and a tour is
downloaded on a phone, so the shelf's card says so above a size per
minute.

## Public API

- `VIDEO_WARN_MB_PER_MINUTE` - 30: the limit, in MB (2^20 bytes) a minute,
  about 4 Mbit/s.
- `videoMbPerMinute(bytes, seconds)` -> `number | null`: the rate; null
  for a negative or non-finite size, or a length that is not a positive
  finite number.
- `videoSizeWarning(bytes, seconds, limit?)` -> `string | null`: the
  card's words above `limit`, naming the rounded rate; null at or below
  it, or without a usable rate.

## Invariants & assumptions

- The length is the one the video element read while minting the poster
  (`video-poster.ts`, `videoLookOf`); a video with no known length gets no
  warning, never a guessed one.
- The rule is the rate alone: a short clip at a phone's own rate warns
  too, though it may be small in bytes. A size floor would be a second
  parameter and is not part of the rule.
- The limit's verdicts across 15 to 60 MB a minute, against typical
  encoder rates (not measured clips): a phone's own 1080p (about 17 Mbit/s,
  about 120 MB a minute) or 4K recording warns at every limit in the
  range; a messenger copy (about 1.5 Mbit/s) at none; exports between
  about 3 and 8 Mbit/s change verdict with the limit.

## Example

```ts
videoSizeWarning(90 * 1024 * 1024, 60);
// "Large for its length: about 90 MB a minute. ..."
videoSizeWarning(10 * 1024 * 1024, 60); // null
```

## Tests

- `video-size.test.ts`: the rate, the unusable inputs, the words, and the
  sweep of the limit over 15, 30, 45 and 60.
- `video-size.property.test.ts`: more bytes never warn less, the rate
  alone decides, and no length never warns.
