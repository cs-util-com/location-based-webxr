/**
 * Why this test matters: the narrated text's words must show exactly while
 * the visitor stands at a station whose text has a fitting read-along -
 * at the bottom (the box) or travelling from the sign, as the visitor's
 * pick or else the creator's choice says - never outside a station,
 * never for a text the lectern already shows, never an empty box for a
 * stale timing, and a voice must not follow the visitor out of its
 * station.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  chipOf,
  createCaptionsFollow,
  narratedShown,
  type TravelStart,
} from "./captions-follow.js";
import type { NarrationBoxContent } from "./narration-box.js";
import type { NarrationClock } from "./narration-player.js";
import type { NarrationVerdict } from "./narration-timing.js";
import type { ReadingSignHandle, ReadingSignVoice } from "./reading-sign.js";
import { withPreferredView } from "./visitor-prefs.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

function text(
  id: string,
  { timing = true, words = false, view = "reading" } = {},
): TourLongTextBlock {
  return {
    id,
    kind: "longText",
    view,
    title: id,
    body: "Words.",
    pose: POSE,
    narration: {
      audio: "v",
      synthetic: false,
      ...(timing ? { timing: `timing/${id}.json` } : {}),
      ...(words ? { words: "sign" as const } : {}),
    },
  } as TourLongTextBlock;
}

const PIN = { id: "pin", kind: "shortText", view: "pin" } as TourBlock;
const CAPTIONS = withPreferredView(null, "longText", "world", "captions");
const READING = withPreferredView(null, "longText", "world", "reading");
const live = (): NarrationVerdict => "live";

describe("narratedShown", () => {
  // Why: one value decides where every narrated text's words go. The
  // visitor's pick wins; without one the creator's `words: "sign"` sends
  // them to the sign; without either they sit at the bottom.
  it("is the box for captions, the travel for a reading pick or a creator's sign, else the box", () => {
    const signed = text("s", { words: true });
    const plain = text("p");
    expect(narratedShown([PIN, plain], CAPTIONS, live)).toEqual({
      block: plain,
      mode: "box",
    });
    expect(narratedShown([plain], READING, live)?.mode).toBe("travel");
    expect(narratedShown([signed], null, live)?.mode).toBe("travel");
    expect(narratedShown([plain], null, live)?.mode).toBe("box");
    // A Captions pick beats the creator's sign.
    expect(narratedShown([signed], CAPTIONS, live)?.mode).toBe("box");
  });

  it("restores the creator's mode once the visitor takes the creator's choice again", () => {
    const signed = text("s", { words: true });
    const reset = withPreferredView(CAPTIONS, "longText", "world", null);
    expect(narratedShown([signed], reset, live)?.mode).toBe("travel");
    const plain = text("p");
    const resetReading = withPreferredView(READING, "longText", "world", null);
    expect(narratedShown([plain], resetReading, live)?.mode).toBe("box");
  });

  // Why: the reading stand shows the words itself, so a box would show
  // them twice; a text without a fitting timing has no words to follow.
  it("shows nothing for a lectern, a stale timing or none, and goes on to the next text", () => {
    const lectern = text("l", { view: "lectern" });
    expect(narratedShown([lectern], null, live)).toBeNull();
    expect(narratedShown([text("a")], CAPTIONS, () => "stale")).toBeNull();
    expect(
      narratedShown([text("a", { timing: false })], null, live),
    ).toBeNull();
    const next = text("b");
    expect(narratedShown([lectern, next], null, live)?.block).toBe(next);
  });
});

describe("chipOf", () => {
  const clock = (nowMs: number, durationMs: number) =>
    ({ nowMs: () => nowMs, durationMs: () => durationMs }) as Pick<
      NarrationClock,
      "nowMs" | "durationMs"
    >;
  it("reads playing from the store, the end and a pause from the voice", () => {
    expect(chipOf(clock(0, 9000), true)).toBe("playing");
    expect(chipOf(clock(0, 9000), false)).toBe("idle");
    expect(chipOf(clock(1200, 9000), false)).toBe("paused");
    expect(chipOf(clock(9000, 9000), false)).toBe("ended");
    // A length not known yet is no end.
    expect(chipOf(clock(1200, 0), false)).toBe("paused");
  });
});

describe("createCaptionsFollow", () => {
  function make() {
    const box = { show: vi.fn(), hide: vi.fn() };
    let content: NarrationBoxContent | null = null;
    const narration = {
      verdictOf: vi.fn((): NarrationVerdict => "live"),
      captions: vi.fn(() => content),
      pauseAll: vi.fn(),
      carryOn: vi.fn(),
    };
    let now = {
      blocks: [] as readonly TourBlock[],
      presentId: null as string | null,
      stored: CAPTIONS as unknown,
    };
    const signs = new Map<string, ReadingSignHandle>();
    const chips = new Map<string, ReadingSignVoice | null>();
    const starts: TravelStart[] = [];
    const stops = vi.fn();
    let camera = true;
    let sheet = false;
    let speaking = false;
    const follow = createCaptionsFollow({
      box,
      narration,
      read: () => now,
      travel: (start) => {
        if (!camera) return null;
        starts.push(start);
        return { stop: stops };
      },
      signOf: (id) => signs.get(id) ?? null,
      sheetOpen: () => sheet,
      playing: () => speaking,
    });
    return {
      box,
      narration,
      follow,
      starts,
      stops,
      chips,
      set: (n: Partial<typeof now>) => {
        now = { ...now, ...n };
      },
      give: (c: NarrationBoxContent | null) => {
        content = c;
      },
      mount: (id: string) => {
        const sign = {
          setVoiceState: (s: ReadingSignVoice | null) => chips.set(id, s),
        } as unknown as ReadingSignHandle;
        signs.set(id, sign);
        return sign;
      },
      noCamera: () => {
        camera = false;
      },
      sheetOpen: (open: boolean) => {
        sheet = open;
      },
      playing: (on: boolean) => {
        speaking = on;
      },
    };
  }

  const at = (nowMs: number) =>
    ({
      key: "a",
      player: { nowMs: () => nowMs, durationMs: () => 9000 },
    }) as unknown as NarrationBoxContent;

  // Why: walking away pauses a voice and it carries on at return, so each
  // station's voices must be named on the way out and on the way back, and a
  // station passed on the way must not wake another's.
  it("names the station it leaves, and the one it comes back to", () => {
    const { narration, follow, set } = make();
    set({ presentId: "a" });
    follow.sync();
    expect(narration.carryOn).toHaveBeenLastCalledWith("a");
    set({ presentId: null });
    follow.sync();
    expect(narration.pauseAll).toHaveBeenLastCalledWith("a");
    set({ presentId: "b" });
    follow.sync();
    expect(narration.carryOn).toHaveBeenLastCalledWith("b");
  });

  it("shows the box at a captions station once the read-along fits", () => {
    const { box, follow, set, give } = make();
    follow.sync();
    expect(box.hide).toHaveBeenCalled();
    set({ blocks: [text("a")], presentId: "s1" });
    follow.sync();
    expect(box.show).not.toHaveBeenCalled();
    const content = { key: "a" } as NarrationBoxContent;
    give(content);
    follow.sync();
    expect(box.show).toHaveBeenLastCalledWith(content, "natural");
  });

  // Why: a narrated text is heard only inside its station's radius. The
  // page hands this follow the present station's blocks, and none outside
  // one; should a caller ever hand blocks with no present station, the
  // box still must not show, nor a voice play on from it.
  it("shows no box outside a station, even when handed its blocks", () => {
    const { box, narration, follow, set, give } = make();
    give({ key: "a" } as NarrationBoxContent);
    set({ blocks: [text("a")], presentId: null });
    follow.sync();
    expect(box.show).not.toHaveBeenCalled();
    expect(narration.captions).not.toHaveBeenCalled();
    set({ presentId: "s1" });
    follow.sync();
    expect(box.show).toHaveBeenCalledTimes(1);
    set({ presentId: null });
    follow.sync();
    expect(box.hide).toHaveBeenCalledTimes(2);
    expect(box.show).toHaveBeenCalledTimes(1);
    expect(narration.pauseAll).toHaveBeenLastCalledWith("s1");
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

  // Why: the travel needs the sign it starts from; one travel per text
  // and sign, made once, and stopped when the words go back to the box
  // and when the session ends.
  it("travels from the mounted sign, once, and stops on a switch to the box and on stop", () => {
    const { box, follow, set, give, mount, starts, stops } = make();
    const content = at(0);
    give(content);
    set({ blocks: [text("a")], presentId: "s1", stored: READING });
    follow.sync();
    // No sign yet: the words sit at the bottom meanwhile.
    expect(starts).toHaveLength(0);
    expect(box.show).toHaveBeenLastCalledWith(content, "natural");
    const sign = mount("a");
    follow.sync();
    follow.sync();
    expect(starts).toHaveLength(1);
    expect(starts[0]?.id).toBe("a");
    expect(starts[0]?.sign).toBe(sign);
    expect(starts[0]?.travelling()).toBe(true);
    expect(starts[0]?.inStation()).toBe(true);
    expect(starts[0]?.voice()).toBe(true);
    expect(box.show).toHaveBeenLastCalledWith(content, "travel");
    set({ stored: CAPTIONS });
    follow.sync();
    expect(stops).toHaveBeenCalledTimes(1);
    expect(box.show).toHaveBeenLastCalledWith(content, "natural");
    set({ stored: READING });
    follow.sync();
    expect(starts).toHaveLength(2);
    follow.stop();
    expect(stops).toHaveBeenCalledTimes(2);
    expect(box.hide).toHaveBeenCalled();
  });

  it("keeps the words at the bottom where the page cannot travel them", () => {
    const { box, follow, set, give, mount, noCamera, starts } = make();
    const content = at(0);
    give(content);
    mount("a");
    noCamera();
    set({ blocks: [text("a")], presentId: "s1", stored: READING });
    follow.sync();
    expect(starts).toHaveLength(0);
    expect(box.show).toHaveBeenLastCalledWith(content, "natural");
  });

  // Why: the sheet shows the whole text with the voice marked, so the
  // words never show twice: the box hides, and a travel is told the sheet
  // is open (its rules then hide the words on the sign and in flight).
  it("hides the words while the reading sheet is open, in both modes", () => {
    const { box, follow, set, give, mount, starts, sheetOpen } = make();
    const content = at(0);
    give(content);
    set({ blocks: [text("a")], presentId: "s1", stored: CAPTIONS });
    sheetOpen(true);
    follow.sync();
    expect(box.show).not.toHaveBeenCalled();
    expect(box.hide).toHaveBeenCalledTimes(1);
    sheetOpen(false);
    follow.sync();
    expect(box.show).toHaveBeenLastCalledWith(content, "natural");
    mount("a");
    set({ stored: READING });
    follow.sync();
    expect(starts[0]?.sheetOpen()).toBe(false);
    sheetOpen(true);
    expect(starts[0]?.sheetOpen()).toBe(true);
  });

  // Why: the chip on a narrated sign says whether its voice speaks, so
  // the visitor knows the sign talks before looking down; every fitting
  // narrated sign has one, the shown text's follows its voice.
  it("gives each narrated sign its chip, the shown text's from its voice", () => {
    const { follow, set, give, mount, chips, playing } = make();
    const shown = text("a");
    const other = text("b");
    const silent = text("c", { timing: false });
    mount("a");
    mount("b");
    mount("c");
    set({ blocks: [shown, other, silent], presentId: "s1", stored: null });
    give(at(0));
    follow.sync();
    expect(chips.get("a")).toBe("idle");
    expect(chips.get("b")).toBe("idle");
    expect(chips.has("c")).toBe(false);
    playing(true);
    follow.sync();
    expect(chips.get("a")).toBe("playing");
    expect(chips.get("b")).toBe("idle");
    playing(false);
    give(at(4000));
    follow.sync();
    expect(chips.get("a")).toBe("paused");
    give(at(9000));
    follow.sync();
    expect(chips.get("a")).toBe("ended");
  });
});
