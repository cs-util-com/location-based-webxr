/**
 * Whether a video is large for its length. A tour is downloaded on a
 * phone, often over mobile data, and a video is used as it is (the
 * browser cannot make it smaller), so the shelf says so above a size per
 * minute. Pure.
 *
 * @see video-size.ts.md
 */

/** Above this a video is large for its length, in MB (2^20 bytes) a
 *  minute: about 4 Mbit/s, a well-compressed 1080p clip. A phone's own
 *  recording is several times that. */
export const VIDEO_WARN_MB_PER_MINUTE = 30;

const MB = 1024 * 1024;

/** `bytes` over `seconds` in MB a minute; null when either is not a
 *  usable number (a negative or non-finite size, no known length). */
export function videoMbPerMinute(
  bytes: number,
  seconds: number,
): number | null {
  if (!(Number.isFinite(bytes) && bytes >= 0)) return null;
  if (!(Number.isFinite(seconds) && seconds > 0)) return null;
  return bytes / MB / (seconds / 60);
}

/** The shelf's words for a video of `bytes` lasting `seconds` above
 *  `limit` MB a minute; null at or below it, or with no known length. */
export function videoSizeWarning(
  bytes: number,
  seconds: number,
  limit: number = VIDEO_WARN_MB_PER_MINUTE,
): string | null {
  const rate = videoMbPerMinute(bytes, seconds);
  if (rate === null || !(rate > limit)) return null;
  return `Large for its length: about ${String(Math.round(rate))} MB a minute. A phone downloads all of it; saved at a lower quality it loads faster.`;
}
