/**
 * Why this test matters: the strip must show exactly while the visitor
 * stands at a station whose text they see in captions and whose
 * read-along fits - never outside a station, never for a text shown in
 * another view, never an empty strip for a stale timing - and a voice
 * must not follow the visitor out of its station.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { captionsBlock, createCaptionsFollow } from "./captions-follow.js";
import type { CaptionsContent } from "./captions-strip.js";
import type { NarrationVerdict } from "./narration-timing.js";
import { withPreferredView } from "./visitor-prefs.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function text(id: string, timing = true): TourLongTextBlock {
  return {
    id,
    kind: "longText",
    view: "reading",
    title: id,
    body: "Words.",
    pose: POSE,
    narration: {
      audio: "v",
      synthetic: false,
      ...(timing ? { timing: `timing/${id}.json` } : {}),
    },
  };
}

const PIN = { id: "pin", kind: "shortText", view: "pin" } as TourBlock;
const CAPTIONS = withPreferredView(null, "longText", "world", "captions");

describe("captionsBlock", () => {
  it("is the first long text shown in captions", () => {
    const live = () => "live" as NarrationVerdict;
    expect(
      captionsBlock([PIN, text("a", false), text("b")], CAPTIONS, live)?.id,
    ).toBe("b");
    expect(captionsBlock([text("b")], null, live)).toBeNull();
    expect(captionsBlock([text("b")], CAPTIONS, () => "stale")).toBeNull();
  });
});

describe("createCaptionsFollow", () => {
  function make() {
    const strip = { show: vi.fn(), hide: vi.fn() };
    let content: CaptionsContent | null = null;
    const narration = {
      verdictOf: vi.fn((): NarrationVerdict => "live"),
      captions: vi.fn(() => content),
      pauseAll: vi.fn(),
    };
    let now = {
      blocks: [] as readonly TourBlock[],
      presentId: null as string | null,
      stored: CAPTIONS as unknown,
    };
    const follow = createCaptionsFollow({ strip, narration, read: () => now });
    return {
      strip,
      narration,
      follow,
      set: (n: Partial<typeof now>) => {
        now = { ...now, ...n };
      },
      give: (c: CaptionsContent | null) => {
        content = c;
      },
    };
  }

  it("shows the strip at a captions station once the read-along fits", () => {
    const { strip, follow, set, give } = make();
    follow.sync();
    expect(strip.hide).toHaveBeenCalled();
    set({ blocks: [text("a")], presentId: "s1" });
    follow.sync();
    expect(strip.show).not.toHaveBeenCalled();
    const content = { key: "a" } as CaptionsContent;
    give(content);
    follow.sync();
    expect(strip.show).toHaveBeenLastCalledWith(content);
  });

  it("pauses the voice on leaving the station, and on stop", () => {
    const { narration, follow, set } = make();
    set({ blocks: [text("a")], presentId: "s1" });
    follow.sync();
    expect(narration.pauseAll).not.toHaveBeenCalled();
    set({ blocks: [], presentId: null });
    follow.sync();
    expect(narration.pauseAll).toHaveBeenCalledTimes(1);
    follow.sync();
    expect(narration.pauseAll).toHaveBeenCalledTimes(1);
    follow.stop();
    expect(narration.pauseAll).toHaveBeenCalledTimes(2);
  });
});
