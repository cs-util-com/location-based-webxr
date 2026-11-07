/**
 * Why this test matters: the visitor's narrated texts tie the open tour
 * to the sheet and the strip. A timing must be read only when its text
 * opens (never when the tour opens, never twice), from the tour's own
 * wrap folder; the sheet and the strip must share ONE voice per text, so
 * the strip and the sheet never talk over each other; the strip must get
 * nothing until the read-along is known to fit, and nothing ever for a
 * stale one; and a new tour must let the old tour's voices go.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  TourBlock,
  TourLongTextBlock,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import {
  audioAssetPath,
  createNarrationVisitor,
  type NarratedTour,
} from "./narration-visitor.js";
import { createNarrationPlayer } from "./narration-player.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const BODY = "The hall burned. It was built again.";

function text(timing?: string): TourLongTextBlock {
  return {
    id: "hall",
    kind: "longText",
    view: "reading",
    title: "The hall",
    body: BODY,
    pose: POSE,
    narration: {
      audio: "voice",
      synthetic: true,
      voiceCredit: "Read by the archive",
      ...(timing === undefined ? {} : { timing }),
    },
  };
}

async function timingFile(hashOf = BODY): Promise<string> {
  const p = plainTextOf(parseTourMarkdown(hashOf)).text;
  const segments = [...p.matchAll(/\S+/gu)].map((m, i) => ({
    startMs: i * 400,
    endMs: i * 400 + 350,
    from: m.index,
    to: m.index + m[0].length,
  }));
  return JSON.stringify({
    granularity: "word",
    source: "file",
    textHash: await textHashOf(p),
    segments,
  });
}

class FakePlayer {
  on = false;
  disposed = false;
  nowMs = () => 0;
  durationMs = () => 1000;
  playing = () => this.on;
  play = () => {
    this.on = true;
  };
  pause = () => {
    this.on = false;
  };
  seek = () => undefined;
  onChange = () => () => undefined;
  dispose = () => {
    this.disposed = true;
  };
}

function make(file: () => Promise<string>) {
  const reads: string[] = [];
  const tour: NarratedTour = {
    manifestWrap: "wrap/",
    loadEntryText: (name) => {
      reads.push(name);
      return file();
    },
  };
  let open: NarratedTour | null = tour;
  const made: FakePlayer[] = [];
  const loads: string[] = [];
  const warn = vi.fn();
  const visitor = createNarrationVisitor({
    tour: () => open,
    assets: () => [{ id: "voice", path: "media/voice.ogg", kind: "audio" }],
    loadAsset: (path) => {
      loads.push(path);
      return Promise.resolve(new Blob(["x"]));
    },
    onError: () => undefined,
    warn,
    makePlayer: (deps) => {
      const p = new FakePlayer();
      made.push(p);
      void deps.load();
      return p;
    },
  });
  return {
    visitor,
    reads,
    made,
    loads,
    warn,
    close: () => {
      open = null;
    },
    reopen: (t: NarratedTour) => {
      open = t;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the visitor's narrated texts", () => {
  it("reads nothing until a text opens, then its timing once, from the wrap", async () => {
    const { visitor, reads } = make(() => timingFile());
    const block = text("timing/hall.json");
    expect(visitor.verdictOf(block)).toBe("unread");
    expect(reads).toEqual([]);
    const narration = visitor.sheetNarration(block);
    expect(narration?.synthetic).toBe(true);
    expect(narration?.voiceCredit).toBe("Read by the archive");
    expect((await narration?.timing)?.segments).toHaveLength(7);
    visitor.sheetNarration(block);
    await flush();
    expect(reads).toEqual(["wrap/timing/hall.json"]);
    expect(visitor.verdictOf(block)).toBe("live");
  });

  it("gives the sheet and the strip one voice per text, read from its asset", async () => {
    const { visitor, made, loads } = make(() => timingFile());
    const block = text("timing/hall.json");
    const sheet = visitor.sheetNarration(block);
    await sheet?.timing;
    await flush();
    const strip = visitor.captions(block);
    expect(strip).not.toBeNull();
    expect(strip?.player).toBe(sheet?.player);
    expect(made).toHaveLength(1);
    expect(loads).toEqual(["media/voice.ogg"]);
    expect(strip?.plain).toBe(BODY);
    expect(strip?.sentences.map((s) => BODY.slice(s.from, s.to))).toEqual([
      "The hall burned.",
      "It was built again.",
    ]);
  });

  it("gives the strip nothing while its timing is read, then the content", async () => {
    const { visitor, reads } = make(() => timingFile());
    const block = text("timing/hall.json");
    const before = visitor.revision();
    expect(visitor.captions(block)).toBeNull();
    // The check hashes the text off the main thread: wait for it to
    // settle rather than for a fixed number of turns.
    await vi.waitFor(() => {
      expect(visitor.revision()).toBe(before + 1);
    });
    expect(reads).toEqual(["wrap/timing/hall.json"]);
    expect(visitor.captions(block)?.key).toBe("hall");
  });

  it("gives the strip nothing ever for a stale timing, and tells the console", async () => {
    const { visitor, warn } = make(() =>
      timingFile("Another text altogether."),
    );
    const block = text("timing/hall.json");
    expect(await visitor.sheetNarration(block)?.timing).toBeNull();
    await flush();
    expect(visitor.verdictOf(block)).toBe("stale");
    expect(visitor.captions(block)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("has no narration for a silent text, and no verdict for another kind", () => {
    const { visitor } = make(() => timingFile());
    // The same text, its narration left out (as a tour without a voice).
    const copy: Record<string, unknown> = { ...text() };
    delete copy["narration"];
    const silent = copy as unknown as TourLongTextBlock;
    expect(visitor.sheetNarration(silent)).toBeUndefined();
    expect(visitor.captions(silent)).toBeNull();
    expect(visitor.verdictOf(silent)).toBe("none");
    expect(visitor.captions(text())).toBeNull();
    const pin = { id: "p", kind: "shortText", view: "pin" } as TourBlock;
    expect(visitor.verdictOf(pin)).toBeUndefined();
  });

  it("pauses every voice, and lets them go with the tour", () => {
    const { visitor, made, close } = make(() => timingFile());
    visitor.sheetNarration(text());
    const player = made[0];
    player?.play();
    visitor.pauseAll();
    expect(player?.on).toBe(false);
    close();
    expect(visitor.verdictOf(text("timing/hall.json"))).toBe("none");
    expect(player?.disposed).toBe(true);
  });

  // Why: walking away pauses a voice and it carries on at return. Both
  // voices of a station that were wanted come back in the one channel: the
  // first plays, the second waits for a tap. A station whose voices were
  // left alone wakes nothing.
  it("carries on what a station's leaving paused, at that station's return", () => {
    const { visitor, made } = make(() => timingFile());
    const first = visitor.sheetNarration(text())?.player;
    const second = visitor.sheetNarration({ ...text(), id: "yard" })?.player;
    first?.play();
    second?.play();
    expect(made[0]?.on).toBe(false);
    expect(made[1]?.on).toBe(true);
    visitor.pauseAll("gate");
    expect(made.map((p) => p.on)).toEqual([false, false]);
    visitor.carryOn("yard");
    expect(made.map((p) => p.on)).toEqual([false, false]);
    visitor.carryOn("gate");
    expect(made.filter((p) => p.on)).toHaveLength(1);
    visitor.carryOn("gate");
    expect(made.filter((p) => p.on)).toHaveLength(1);
  });

  // Why: the one heard last plays at return, and the other, held behind it,
  // carries on when that one is over: a station's second voice is not lost.
  it("the voice held behind the first carries on when that one is over", () => {
    const { visitor, made } = make(() => timingFile());
    const first = visitor.sheetNarration(text())?.player;
    const second = visitor.sheetNarration({ ...text(), id: "yard" })?.player;
    first?.play();
    second?.play();
    visitor.pauseAll("gate");
    visitor.carryOn("gate");
    expect(made.map((p) => p.on)).toEqual([false, true]);
    second?.pause();
    expect(made.map((p) => p.on)).toEqual([true, false]);
  });

  // Why: a voice stopped by the visitor is off until tapped, and passing
  // through another station must not forget what the first one left.
  it("leaves a paused voice off, and remembers a station across another", () => {
    const { visitor, made } = make(() => timingFile());
    const voice = visitor.sheetNarration(text())?.player;
    voice?.play();
    voice?.pause();
    visitor.pauseAll("gate");
    visitor.carryOn("gate");
    expect(made[0]?.on).toBe(false);

    voice?.play();
    visitor.pauseAll("gate");
    visitor.pauseAll("yard");
    visitor.carryOn("gate");
    expect(made[0]?.on).toBe(true);
  });

  it("starts afresh for a new tour", async () => {
    const { visitor, reads, reopen } = make(() => timingFile());
    const block = text("timing/hall.json");
    await visitor.sheetNarration(block)?.timing;
    reopen({
      manifestWrap: "",
      loadEntryText: (name) => {
        reads.push(`new:${name}`);
        return timingFile();
      },
    });
    expect(visitor.verdictOf(block)).toBe("unread");
    await visitor.sheetNarration(block)?.timing;
    expect(reads).toEqual(["wrap/timing/hall.json", "new:timing/hall.json"]);
  });

  it("finds an audio asset by its id and kind only", () => {
    const assets = [
      { id: "a", path: "a.png", kind: "image" },
      { id: "v", path: "v.ogg", kind: "audio" },
    ];
    expect(audioAssetPath(assets, "v")).toBe("v.ogg");
    expect(audioAssetPath(assets, "a")).toBeNull();
    expect(audioAssetPath(undefined, "v")).toBeNull();
  });
});

describe("a closed tour's voices", () => {
  // Why this test matters: a voice holds an audio element and a blob URL
  // of the tour's file. The page calls `reset()` where a tour closes; if
  // that did not let the real player go, the closed tour's audio would
  // stay loaded and its blob URL would never be revoked.
  it("removes the audio's source and revokes its blob URL on reset", async () => {
    const audio = {
      src: "",
      currentTime: 0,
      duration: 3,
      paused: true,
      preload: "",
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeAttribute: vi.fn((name: string) => {
        if (name === "src") audio.src = "";
      }),
      load: vi.fn(),
    };
    const revoked: string[] = [];
    const tour: NarratedTour = {
      manifestWrap: "",
      loadEntryText: () => timingFile(),
    };
    const visitor = createNarrationVisitor({
      tour: () => tour,
      assets: () => [{ id: "voice", path: "media/voice.ogg", kind: "audio" }],
      loadAsset: () => Promise.resolve(new Blob(["x"])),
      onError: () => undefined,
      makePlayer: (deps) =>
        createNarrationPlayer({
          ...deps,
          audio: () => audio,
          createUrl: () => "blob:voice",
          revokeUrl: (url) => {
            revoked.push(url);
          },
        }),
    });
    const player = visitor.sheetNarration(text())?.player;
    player?.play();
    await vi.waitFor(() => {
      expect(audio.src).toBe("blob:voice");
    });
    visitor.reset();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.src).toBe("");
    expect(revoked).toEqual(["blob:voice"]);
  });
});
