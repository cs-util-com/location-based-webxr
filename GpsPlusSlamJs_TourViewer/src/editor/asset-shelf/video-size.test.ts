/**
 * Why these tests matter: a video is used as it is, so this warning is
 * the only hint an author gets that the visitors' phones will download a
 * large file. The limit is a parameter, so its verdicts are shown across
 * the plausible range (15 to 60 MB a minute), not only at the default.
 */
import { describe, expect, it } from "vitest";

import {
  VIDEO_WARN_MB_PER_MINUTE,
  videoMbPerMinute,
  videoSizeWarning,
} from "./video-size.js";

const MB = 1024 * 1024;
/** The bytes a minute of video at `mbit` Mbit/s takes. */
const minuteAt = (mbit: number): number => (mbit * 1_000_000 * 60) / 8;

describe("videoMbPerMinute", () => {
  it("is the size over the length, in MB a minute", () => {
    expect(videoMbPerMinute(60 * MB, 120)).toBe(30);
    expect(videoMbPerMinute(0, 10)).toBe(0);
  });

  it("is null without a usable size or length", () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(videoMbPerMinute(MB, seconds)).toBeNull();
    }
    for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(videoMbPerMinute(bytes, 10)).toBeNull();
    }
  });
});

describe("videoSizeWarning", () => {
  it("warns above the limit, with the rate, and not at or below it", () => {
    expect(VIDEO_WARN_MB_PER_MINUTE).toBe(30);
    expect(videoSizeWarning(30 * MB, 60)).toBeNull();
    expect(videoSizeWarning(90 * MB, 60)).toBe(
      "Large for its length: about 90 MB a minute. A phone downloads all of it; saved at a lower quality it loads faster.",
    );
    expect(videoSizeWarning(90 * MB, Number.NaN)).toBeNull();
  });

  // The sweep: typical rates (Mbit/s) against limits across 15-60 MB a
  // minute. A phone's own 1080p or 4K recording warns at every limit in
  // the range, a messenger copy at none; only exports between about 3
  // and 8 Mbit/s change verdict with the limit. The rates are typical
  // encoder defaults, not measured clips.
  it("keeps its verdicts on phone recordings across the plausible limits", () => {
    const rates = {
      messenger: 1.5,
      export4: 4,
      export720: 5,
      export8: 8,
      phone1080: 17,
      phone4k: 48,
    } as const;
    const verdicts = [15, 30, 45, 60].map((limit) =>
      Object.entries(rates)
        .filter(([, mbit]) => videoSizeWarning(minuteAt(mbit), 60, limit))
        .map(([name]) => name),
    );
    expect(verdicts).toEqual([
      ["export4", "export720", "export8", "phone1080", "phone4k"],
      ["export720", "export8", "phone1080", "phone4k"],
      ["export8", "phone1080", "phone4k"],
      ["phone1080", "phone4k"],
    ]);
  });
});
