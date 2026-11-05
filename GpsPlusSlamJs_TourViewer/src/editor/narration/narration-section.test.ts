// @vitest-environment jsdom
/**
 * Why these tests matter: the Narration section is where a creator adds
 * a voice, imports its timing and lines it up again after editing the
 * text. Every one of those is async (a file read, a duration read, the
 * tour's write), so the async-feedback rule is pinned for each: the
 * button says what runs and is disabled while it runs, and the section
 * ends in the state the tour holds - the new state on success, the old
 * one (with the reason said) on failure. A malformed timing file must
 * never reach the tour, and the timing written must be compact JSON (the
 * format's cap counts bytes).
 */
import { parseTourTimingText } from "gps-plus-slam-app-framework/ar/tour-timing";
import { beforeEach, describe, expect, it } from "vitest";

import type { NarrationChange, NarrationFacts } from "../editor-session.js";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import {
  createNarrationSection,
  type NarrationSection,
  type NarrationSectionDeps,
} from "./narration-section.js";
import { settle } from "../../test-support/settle.js";

const BODY = "The mill turned all day. The miller slept at night.";
const VTT = [
  "WEBVTT",
  "",
  "00:00.000 --> 00:02.000",
  "The mill turned all day.",
  "",
  "00:02.000 --> 00:04.000",
  "The miller slept at night.",
  "",
].join("\n");

interface Held {
  hasVoice: boolean;
  audioId: string | null;
  timingText: string | null;
}

/** Each voice the fake tour takes gets a new asset id, as the session's. */
let voices = 0;

let held: Held;
let said: string[];
let shown: [number, number, string][];
let edits: NarrationChange[];
/** Set to hold the next edit until released. */
let gate: { release: (outcome: TypedEditOutcome) => void } | null;
let holdNext: boolean;
let refuseNext: boolean;
let section: NarrationSection;

function make(over: Partial<NarrationSectionDeps> = {}): NarrationSection {
  return createNarrationSection({
    document,
    read: () =>
      Promise.resolve<NarrationFacts>({
        kind: "narration",
        hasVoice: held.hasVoice,
        audioId: held.audioId,
        durationMs: held.hasVoice ? 4000 : null,
        timingText: held.timingText,
        timingUnread: false,
      }),
    edit: (_id, change) => {
      edits.push(change);
      const apply = (outcome: TypedEditOutcome): TypedEditOutcome => {
        if (outcome !== "written") return outcome;
        if (change.kind === "voice") {
          held.hasVoice = true;
          held.audioId = `voice-${String(++voices)}`;
        }
        if (change.kind === "removeVoice") {
          held = { hasVoice: false, audioId: null, timingText: null };
        }
        if (change.kind === "timing") held.timingText = change.text;
        if (change.kind === "removeTiming") held.timingText = null;
        return outcome;
      };
      if (refuseNext) {
        refuseNext = false;
        return Promise.resolve("refused");
      }
      if (!holdNext) return Promise.resolve(apply("written"));
      holdNext = false;
      return new Promise((resolve) => {
        gate = {
          release: (outcome) => {
            resolve(apply(outcome));
          },
        };
      });
    },
    say: (text) => said.push(text),
    onSummary: () => undefined,
    onShow: (from, to, plain) => shown.push([from, to, plain]),
    durationOf: () => Promise.resolve(4000),
    ...over,
  });
}

const q = (sel: string) => section.node.querySelector<HTMLElement>(sel);
const btn = (act: string) =>
  section.node.querySelector<HTMLButtonElement>(`[data-ln="${act}"]`);
const file = (text: string, name: string) => new File([text], name);
/** Let the awaited reads and file reads run. */
async function flush(): Promise<void> {
  await settle(() => [
    section.node.innerHTML,
    said.length,
    shown.length,
    edits.length,
  ]);
  await section.settled();
}

beforeEach(async () => {
  held = { hasVoice: false, audioId: null, timingText: null };
  voices = 0;
  said = [];
  shown = [];
  edits = [];
  gate = null;
  holdNext = false;
  refuseNext = false;
  section = make();
  document.body.replaceChildren(section.node);
  section.update({ blockId: "essay", body: BODY, key: "1" });
  await flush();
});

describe("the voice", () => {
  it("offers a voice first, and no timing import until there is one", () => {
    expect(btn("voice-pick")?.textContent).toBe("Add a voice file");
    expect(btn("timing-pick")?.disabled).toBe(true);
  });

  it("says what runs while a voice is added, then shows it", async () => {
    holdNext = true;
    const done = section.takeFiles([file("x", "voice.mp3")]);
    await flush();
    expect(btn("voice-pick")?.textContent).toBe("Adding the voice...");
    expect(btn("voice-pick")?.disabled).toBe(true);
    expect(section.node.getAttribute("aria-busy")).toBe("true");
    gate?.release("written");
    await done;
    await flush();
    expect(section.node.getAttribute("aria-busy")).toBe("false");
    expect(q(".ln-fn")?.textContent).toBe("voice.mp3");
    expect(btn("voice-pick")?.textContent).toBe("Replace");
    expect(btn("timing-pick")?.disabled).toBe(false);
    expect(said.at(-1)).toContain("voice.mp3 (1 B) added");
  });

  // Why: a file dropped while another action runs was ignored without a
  // word, so the creator could not tell it had not been taken.
  it("says to wait when a file is dropped while another action runs", async () => {
    holdNext = true;
    const done = section.takeFiles([file("x", "voice.mp3")]);
    await flush();
    await section.takeFiles([file(VTT, "voice.vtt")]);
    expect(said.at(-1)).toBe(
      "The voice is still being added. Wait until it is done, then drop voice.vtt again.",
    );
    gate?.release("written");
    await done;
    await flush();
    expect(edits.map((e) => e.kind)).toEqual(["voice"]);
  });

  it("goes back to where it was when the tour refuses the voice", async () => {
    holdNext = true;
    const done = section.takeFiles([file("x", "voice.mp3")]);
    await flush();
    gate?.release("refused");
    await done;
    await flush();
    expect(btn("voice-pick")?.textContent).toBe("Add a voice file");
    expect(btn("voice-pick")?.disabled).toBe(false);
    expect(said).toEqual([]);
  });

  // Why: a voice file is held in memory and written into every save; one
  // above the autosave cap could never be saved by itself, so it is
  // refused up front with its size named, and the "added" toast names the
  // size too so a large file is never a surprise. The cap is per file:
  // the words promise nothing about the whole tour, which other files add
  // to.
  it("refuses a voice above the autosave cap, naming its size", async () => {
    const big = file("x", "long.mp3");
    Object.defineProperty(big, "size", { value: 300 * 1024 * 1024 });
    await section.takeFiles([big]);
    await flush();
    expect(edits).toEqual([]);
    expect(said.at(-1)).toBe(
      "long.mp3 is 300.0 MiB: a voice file can be at most 200.0 MiB.",
    );
    expect(btn("voice-pick")?.textContent).toBe("Add a voice file");
  });

  // Why: the page's autosave cap can be set for a run (the dev server's
  // setting); the voice's limit follows it rather than the default.
  it("takes the page's cap when it is given one", async () => {
    section = make({ voiceMaxBytes: 1024 });
    section.update({ blockId: "essay", body: BODY, key: "k-cap" });
    await flush();
    await section.takeFiles([file("x".repeat(2048), "voice.mp3")]);
    await flush();
    expect(edits).toEqual([]);
    expect(said.at(-1)).toBe(
      "voice.mp3 is 2.0 KiB: a voice file can be at most 1.0 KiB.",
    );
  });

  it("names the voice's size when it is added", async () => {
    await section.takeFiles([file("x".repeat(2048), "voice.mp3")]);
    await flush();
    expect(said.at(-1)).toContain("voice.mp3 (2.0 KiB) added");
  });

  // Why: the file name describes one recording; after an undo the tour
  // holds the earlier one, and the row must name that one, not the file
  // chosen last.
  it("names the voice the tour holds after an undo, not the last file chosen", async () => {
    await section.takeFiles([file("x", "first.mp3")]);
    await flush();
    await section.takeFiles([file("x", "second.mp3")]);
    await flush();
    expect(q(".ln-fn")?.textContent).toBe("second.mp3");
    held.audioId = "voice-1"; // the undo
    section.update({ blockId: "essay", body: BODY, key: "undone" });
    await flush();
    expect(q(".ln-fn")?.textContent).toBe("first.mp3");
  });

  it("refuses a file that is neither a voice nor a timing, naming it", async () => {
    await section.takeFiles([file("x", "notes.docx")]);
    expect(q(".ln-err")?.textContent).toContain("notes.docx");
    expect(edits).toEqual([]);
  });
});

describe("the timing", () => {
  beforeEach(async () => {
    held.hasVoice = true;
    section.update({ blockId: "essay", body: BODY, key: "2" });
    await flush();
  });

  it("imports a subtitle file as compact JSON, saying what runs, then shows what it did", async () => {
    holdNext = true;
    const done = section.takeFiles([file(VTT, "voice.vtt")]);
    await flush();
    expect(btn("timing-pick")?.textContent).toBe("Importing...");
    expect(btn("timing-pick")?.disabled).toBe(true);
    gate?.release("written");
    await done;
    await flush();
    const change = edits.at(-1);
    expect(change?.kind).toBe("timing");
    const text = change?.kind === "timing" ? change.text : "";
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(parseTourTimingText(text).segments).toHaveLength(2);
    expect(q('[data-testid="narration-result"]')?.textContent).toContain(
      "Imported voice.vtt",
    );
    expect(btn("timing-pick")?.textContent).toBe("Import a new timing...");
    btn("last-ok")?.click();
    expect(q('[data-testid="narration-result"]')).toBeNull();
  });

  it("never writes a malformed file, and says why with the timing unchanged", async () => {
    await section.takeFiles([file("WEBVTT\n\nnot a cue at all", "bad.vtt")]);
    await flush();
    expect(edits).toEqual([]);
    const err = q(".ln-err");
    expect(err?.getAttribute("role")).toBe("alert");
    expect(err?.textContent).toContain("bad.vtt");
    expect(err?.textContent).toContain("current timing are unchanged");
    expect(said.at(-1)).toContain("Could not use bad.vtt");
    expect(btn("timing-pick")?.disabled).toBe(false);
  });

  it("takes the timing off, saying what runs, the voice kept", async () => {
    await section.takeFiles([file(VTT, "voice.vtt")]);
    await flush();
    holdNext = true;
    btn("timing-remove")?.click();
    await flush();
    expect(btn("timing-remove")?.textContent).toBe("Removing...");
    expect(btn("timing-pick")?.disabled).toBe(true);
    gate?.release("written");
    await flush();
    expect(edits.at(-1)).toEqual({ kind: "removeTiming" });
    expect(btn("timing-remove")).toBeNull();
    expect(btn("voice-pick")?.textContent).toBe("Replace");
    expect(said.at(-1)).toContain("Timing removed");
  });

  // Why: the result card and the timing's file name describe one import;
  // an undo brings back another timing, so both must follow the timing
  // the tour holds.
  it("names the timing the tour holds after an undo, and drops the undone import's card", async () => {
    await section.takeFiles([file(VTT, "first.vtt")]);
    await flush();
    const first = held.timingText;
    btn("last-ok")?.click();
    await section.takeFiles([
      file(VTT.replace("00:04.000", "00:04.500"), "second.vtt"),
    ]);
    await flush();
    expect(held.timingText).not.toBe(first);
    expect(q('[data-testid="narration-result"]')?.textContent).toContain(
      "second.vtt",
    );
    held.timingText = first; // the undo
    section.update({ blockId: "essay", body: BODY, key: "undone" });
    await flush();
    const names = [...section.node.querySelectorAll(".ln-fn")].map(
      (n) => n.textContent,
    );
    expect(names).toContain("first.vtt");
    expect(names).not.toContain("second.vtt");
    expect(q('[data-testid="narration-result"]')).toBeNull();
  });

  // Why: an import may finish after the creator selected another text;
  // its card describes the text it was for, never the one now shown.
  it("drops a late import result once another text is shown", async () => {
    holdNext = true;
    const done = section.takeFiles([file(VTT, "voice.vtt")]);
    await flush();
    section.update({ blockId: "other", body: BODY, key: "1" });
    gate?.release("written");
    await done;
    await flush();
    expect(q('[data-testid="narration-result"]')).toBeNull();
    expect(q(".ln-err")).toBeNull();
  });

  it("drops a late import failure once another text is shown", async () => {
    let release: (() => void) | undefined;
    const slow = file("WEBVTT\n\nnot a cue at all", "bad.vtt");
    const text = slow.text.bind(slow);
    slow.text = () =>
      new Promise<string>((resolve) => {
        release = () => {
          void text().then(resolve);
        };
      });
    const done = section.takeFiles([slow]);
    await flush();
    section.update({ blockId: "other", body: BODY, key: "1" });
    release?.();
    await done;
    await flush();
    expect(q(".ln-err")).toBeNull();
  });

  it("shows no result when the tour refuses the timing", async () => {
    refuseNext = true;
    await section.takeFiles([file(VTT, "voice.vtt")]);
    await flush();
    expect(q('[data-testid="narration-result"]')).toBeNull();
    expect(btn("timing-pick")?.textContent).toBe("Import timing...");
  });
});

describe("a text edited after the voice was lined up", () => {
  const EDITED = "The mill turned all day long. The miller slept at night.";

  beforeEach(async () => {
    held.hasVoice = true;
    section.update({ blockId: "essay", body: BODY, key: "2" });
    await flush();
    await section.takeFiles([file(VTT, "voice.vtt")]);
    await flush();
    btn("last-ok")?.click();
    section.update({ blockId: "essay", body: EDITED, key: "3" });
    await flush();
  });

  it("explains what no longer lines up, with a Show link into the plain text", () => {
    const notice = q('[data-testid="narration-stale"]');
    expect(notice?.textContent).toContain(
      "You edited the text after the voice was lined up",
    );
    btn("show")?.click();
    expect(shown).toHaveLength(1);
    const [from, to, plain] = shown[0] ?? [0, 0, ""];
    expect(plain).toBe(EDITED);
    expect(to).toBeGreaterThan(from);
  });

  it("counts the places it no longer lines up with", () => {
    expect(q('[data-testid="narration-stale"]')?.textContent).toContain(
      "The voice no longer lines up with the text in 1 place.",
    );
  });

  // Why: a punctuation-only edit leaves nothing to name; the notice must
  // not read "in 0 places".
  it("says only that it no longer lines up when no place can be named", async () => {
    section.update({
      blockId: "essay",
      body: "The mill turned all day! The miller slept at night.",
      key: "4",
    });
    await flush();
    const notice = q('[data-testid="narration-stale"]')?.textContent ?? "";
    expect(notice).toContain("The voice no longer lines up with the text.");
    expect(notice).not.toContain("0 place");
  });

  it("lines the voice up again, saying what runs, and the notice goes", async () => {
    holdNext = true;
    btn("lineup")?.click();
    await flush();
    expect(btn("lineup")?.textContent).toBe("Lining up...");
    expect(btn("lineup")?.disabled).toBe(true);
    gate?.release("written");
    await flush();
    expect(q('[data-testid="narration-stale"]')).toBeNull();
    expect(q('[data-testid="narration-result"]')?.textContent).toContain(
      "Lined up again",
    );
    expect(said.at(-1)).toContain("Lined up again");
  });

  it("keeps the notice when the tour refuses the lining up", async () => {
    refuseNext = true;
    btn("lineup")?.click();
    await flush();
    expect(q('[data-testid="narration-stale"]')).not.toBeNull();
    expect(btn("lineup")?.textContent).toBe("Line the voice up again");
    expect(btn("lineup")?.disabled).toBe(false);
  });
});

describe("following the selection", () => {
  it("reads again for another text, and draws nothing without one", async () => {
    held.hasVoice = true;
    section.update({ blockId: "other", body: BODY, key: "1" });
    await flush();
    expect(btn("voice-pick")?.textContent).toBe("Replace");
    section.update(null);
    await flush();
    expect(section.node.querySelector("[data-ln]")).toBeNull();
  });
});
