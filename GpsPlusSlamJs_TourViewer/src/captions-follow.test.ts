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

  // Why: a visitor's pick the text cannot meet (a lectern for a text
  // with pictures) shows the creator's view instead, so the creator's
  // choice of where the words show comes back with it: the sign's words
  // travel for `words: "sign"`, and stay at the bottom without it.
  it("defers to the creator's choice where the visitor's pick cannot be met", () => {
    const LECTERN = withPreferredView(null, "longText", "world", "lectern");
    const pictured = (words: boolean): TourLongTextBlock => ({
      ...text("p", { words }),
      body: "Words.\n\n![The hall](asset:hall)",
    });
    expect(narratedShown([pictured(true)], LECTERN, live)?.mode).toBe("travel");
    expect(narratedShown([pictured(false)], LECTERN, live)?.mode).toBe("box");
    // A lectern pick the text can meet shows no words at all.
    expect(narratedShown([text("t", { words: true })], LECTERN, live)).toBe(
      null,
    );
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
    // Every chip each sign object was given, in order: a sign painted
    // twice in one frame, or a disposed sign painted again, shows here.
    const history = new Map<ReadingSignHandle, (ReadingSignVoice | null)[]>();
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
      // The store's flag is for the shown text only, as the box's slice.
      playing: (key) => speaking && key === content?.key,
    });
    return {
      box,
      narration,
      follow,
      starts,
      stops,
      chips,
      calls: (sign: ReadingSignHandle) => history.get(sign) ?? [],
      set: (n: Partial<typeof now>) => {
        now = { ...now, ...n };
      },
      give: (c: NarrationBoxContent | null) => {
        content = c;
      },
      mount: (id: string) => {
        const calls: (ReadingSignVoice | null)[] = [];
        const sign = {
          setVoiceState: (s: ReadingSignVoice | null) => {
            calls.push(s);
            chips.set(id, s);
          },
        } as unknown as ReadingSignHandle;
        history.set(sign, calls);
        signs.set(id, sign);
        return sign;
      },
      unmount: (id: string) => {
        signs.delete(id);
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

  /** A text's box content whose voice stands at `nowMs`; `on` is whether
   *  that voice plays, and its `pause` stops it. */
  const at = (nowMs: number, key = "a", on = false) => {
    const player = {
      on,
      nowMs: () => nowMs,
      durationMs: () => 9000,
      playing: () => player.on,
      pause: vi.fn(() => {
        player.on = false;
      }),
    };
    return { key, player } as unknown as NarrationBoxContent & {
      player: typeof player;
    };
  };

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
    // While travelling, the box stays the ghost under the open sheet: the
    // travel hides the words by its own rules.
    follow.sync();
    expect(box.show).toHaveBeenLastCalledWith(content, "travel");
  });

  // Why: a travel hangs the words on one sign's plate; whatever takes
  // the words or the sign away (leaving the station, the sign going, a
  // new sign for the same text, another text) must stop it, or a travel
  // keeps running on a disposed sign.
  describe("stops the travel when its text or sign goes", () => {
    function travelling() {
      const t = make();
      t.give(at(0));
      t.set({ blocks: [text("a")], presentId: "s1", stored: READING });
      t.mount("a");
      t.follow.sync();
      expect(t.starts).toHaveLength(1);
      return t;
    }

    it("on leaving the station", () => {
      const { follow, set, starts, stops } = travelling();
      set({ presentId: null });
      follow.sync();
      expect(stops).toHaveBeenCalledTimes(1);
      expect(starts).toHaveLength(1);
    });

    it("when the sign unmounts", () => {
      const { follow, starts, stops, unmount } = travelling();
      unmount("a");
      follow.sync();
      expect(stops).toHaveBeenCalledTimes(1);
      expect(starts).toHaveLength(1);
    });

    it("when the sign is remounted under the same id, and starts from the new one", () => {
      const { follow, mount, starts, stops } = travelling();
      const again = mount("a");
      follow.sync();
      expect(stops).toHaveBeenCalledTimes(1);
      expect(starts).toHaveLength(2);
      expect(starts[1]?.sign).toBe(again);
    });

    it("when another text is shown, and starts from its sign", () => {
      const { follow, set, mount, starts, stops } = travelling();
      mount("b");
      set({ blocks: [text("b")] });
      follow.sync();
      expect(stops).toHaveBeenCalledTimes(1);
      expect(starts).toHaveLength(2);
      expect(starts[1]?.id).toBe("b");
    });
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

  // Why: leaving pauses the voice, so a sign still standing (every
  // station's content shows with "show all", and a sign fades out over a
  // while without it) must stop saying it speaks; so must a sign whose
  // text is no longer the one shown.
  it("stops a sign's chip saying it plays once its text is no longer shown", () => {
    const { follow, set, give, mount, chips, calls, playing, unmount } = make();
    const first = mount("a");
    set({ blocks: [text("a")], presentId: "s1", stored: null });
    give(at(4000));
    playing(true);
    follow.sync();
    follow.sync();
    follow.sync();
    expect(chips.get("a")).toBe("playing");
    // While it stays shown it is never let go: no "paused" between the
    // frames (that would repaint the sign twice a frame).
    expect(calls(first)).not.toContain("paused");
    // Remounted under the same id: the new sign shows the voice, and the
    // old, disposed one is not painted again.
    const before = calls(first).length;
    const again = mount("a");
    follow.sync();
    expect(calls(first)).toHaveLength(before);
    expect(calls(again)).toEqual(["playing"]);
    // Walking out: the store may still say it plays for a frame.
    set({ blocks: [], presentId: null });
    follow.sync();
    expect(chips.get("a")).toBe("paused");
    // Back in: it plays again.
    set({ blocks: [text("a")], presentId: "s1" });
    follow.sync();
    expect(chips.get("a")).toBe("playing");
    // Straight into the next station, its own text shown: the old sign
    // says paused.
    mount("b");
    give(at(4000, "b"));
    set({ blocks: [text("b")], presentId: "s2" });
    follow.sync();
    expect(chips.get("a")).toBe("paused");
    expect(chips.get("b")).toBe("playing");
    // The shown sign unmounted and gone: nothing paints it again.
    unmount("b");
    chips.delete("b");
    set({ blocks: [], presentId: null });
    follow.sync();
    expect(chips.has("b")).toBe(false);
  });

  // Why: another text of the same station can take the words over (here
  // the visitor's Reading pick turns the station's first text, a lectern
  // till then, into a sign that reads along). Nobody sees the old text's
  // words any more, so its voice must not speak on: it pauses at the
  // switch, and its sign says paused, not idle.
  it("pauses the old text's voice when another text of the station is shown", () => {
    const { follow, set, give, mount, chips, calls, playing } = make();
    const b = text("b", { view: "lectern" });
    const a = text("a");
    mount("b");
    const signA = mount("a");
    set({ blocks: [b, a], presentId: "s1", stored: null });
    const voiceA = at(4000, "a", true);
    give(voiceA);
    playing(true);
    follow.sync();
    expect(chips.get("a")).toBe("playing");
    expect(voiceA.player.pause).not.toHaveBeenCalled();
    // a still speaks at the switch; b's own voice has not started.
    expect(voiceA.player.playing()).toBe(true);
    // The store follows the box, which now shows b: not playing.
    playing(false);
    give(at(0, "b"));
    set({ stored: READING });
    follow.sync();
    expect(voiceA.player.pause).toHaveBeenCalledTimes(1);
    expect(voiceA.player.playing()).toBe(false);
    expect(chips.get("b")).toBe("idle");
    expect(chips.get("a")).toBe("paused");
    // The switch leaves it at paused, not a pause painted over by idle,
    // and the frames after it do not paint it idle either.
    follow.sync();
    follow.sync();
    expect(calls(signA)).not.toContain("idle");
    expect(chips.get("b")).toBe("idle");
    expect(voiceA.player.pause).toHaveBeenCalledTimes(1);
  });

  // Why: leaving the station pauses its voices by name for the return, so
  // the switch rule must not pause a voice on a move between stations:
  // paused there it would no longer be wanted, and would not carry on.
  it("leaves a voice to the station's own pause when the visitor moves on", () => {
    const { follow, set, give, mount } = make();
    mount("a");
    set({ blocks: [text("a")], presentId: "s1", stored: null });
    const voiceA = at(4000, "a", true);
    give(voiceA);
    follow.sync();
    give(at(0, "b"));
    set({ blocks: [text("b")], presentId: "s2" });
    follow.sync();
    expect(voiceA.player.pause).not.toHaveBeenCalled();
  });
});
