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
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrationChange, NarrationFacts } from "../editor-session.js";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import {
  createNarrationSection,
  type NarrationSection,
  type NarrationSectionDeps,
} from "./narration-section.js";
import { settle } from "../../test-support/settle.js";
import { normalVoiceCredit, VOICE_CREDIT_MAX } from "../../voice-credit.js";

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
  synthetic?: boolean;
  voiceCredit?: string;
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
        synthetic: held.synthetic ?? false,
        voiceCredit: held.voiceCredit ?? "",
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
        if (change.kind === "synthetic") held.synthetic = change.synthetic;
        // The session stores a credit normalised: so does the fake.
        if (change.kind === "voiceCredit") {
          held.voiceCredit = normalVoiceCredit(change.text) ?? "";
        }
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
            gate = null;
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
async function quiet(): Promise<void> {
  await settle(() => [
    section.node.innerHTML,
    said.length,
    shown.length,
    edits.length,
  ]);
  await section.settled();
}
/** Run a started action to its end, or to the edit a test holds. Its text
 *  hash runs on the thread pool, where no fingerprint sees it and nothing
 *  but the action's own state says it is still running, however long the
 *  hash takes. */
async function flush(): Promise<void> {
  await vi.waitUntil(
    () => section.node.getAttribute("aria-busy") !== "true" || gate !== null,
    { timeout: 4000, interval: 2 },
  );
  await quiet();
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

  // Why: a length the browser does not read in
  // time (a slow phone, 5 s) was dropped silently; the voice is still
  // added, and the author is told the tour shows no length for it.
  it("tells the author when the voice's length could not be read", async () => {
    section = make({ durationOf: () => Promise.resolve(undefined) });
    document.body.replaceChildren(section.node);
    section.update({ blockId: "essay", body: BODY, key: "1" });
    await flush();
    await section.takeFiles([file("x", "voice.mp3")]);
    await flush();
    expect(edits.at(-1)).not.toHaveProperty("durationMs");
    expect(said.at(-1)).toContain("voice.mp3 (1 B) added");
    expect(said.at(-1)).toContain(
      "Its length could not be read, so the tour shows no length for it.",
    );
  });

  it("says nothing of the length when it was read", async () => {
    await section.takeFiles([file("x", "voice.mp3")]);
    await flush();
    expect(said.at(-1)).toContain("voice.mp3 (1 B) added");
    expect(said.at(-1)).not.toContain("length");
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
    await quiet();
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

describe("who speaks the voice", () => {
  const box = () =>
    section.node.querySelector<HTMLInputElement>('[data-ln="synthetic"]');
  const credit = () =>
    section.node.querySelector<HTMLInputElement>('[data-ln="credit"]');
  async function voiced(): Promise<void> {
    held.hasVoice = true;
    held.audioId = "voice-1";
    section.update({ blockId: "essay", body: BODY, key: "2" });
    await flush();
  }

  // Why: the mark and the credit describe a voice; without one there is
  // nothing to describe, and the format has no narration to hold them.
  it("offers neither the switch nor the field before there is a voice", () => {
    expect(box()).toBeNull();
    expect(credit()).toBeNull();
  });

  it("shows a voice as a person's with no credit, labelled as the visitor reads it", async () => {
    await voiced();
    expect(box()?.checked).toBe(false);
    expect(box()?.closest("label")?.textContent).toBe("Synthetic voice");
    expect(credit()?.value).toBe("");
    expect(credit()?.maxLength).toBe(2 * VOICE_CREDIT_MAX);
    const label = section.node.querySelector(
      `label[for="${credit()?.id ?? "none"}"]`,
    );
    expect(label?.textContent).toBe("Spoken by");
  });

  // Why: the switch's write is async (the async-feedback rule): it is
  // disabled while it runs, and ends in what the tour holds.
  it("marks the voice synthetic: disabled while it runs, checked once the tour holds it", async () => {
    await voiced();
    holdNext = true;
    box()?.click();
    await flush();
    expect(edits.at(-1)).toEqual({ kind: "synthetic", synthetic: true });
    expect(box()?.disabled).toBe(true);
    expect(section.node.getAttribute("aria-busy")).toBe("true");
    gate?.release("written");
    await flush();
    expect(box()?.disabled).toBe(false);
    expect(box()?.checked).toBe(true);
    expect(said.at(-1)).toBe(
      "Marked as a synthetic voice: visitors are told so. Ctrl+Z undoes it.",
    );
  });

  // Why: both paths of the async-feedback rule, while the write is held:
  // the tick stays and the switch is disabled while it runs; a refusal
  // enables it again on the tour's mark, with nothing said.
  it("goes back to the tour's mark when the tour refuses it", async () => {
    await voiced();
    holdNext = true;
    box()?.click();
    await flush();
    expect(box()?.disabled).toBe(true);
    expect(box()?.checked).toBe(true);
    gate?.release("refused");
    await flush();
    expect(box()?.disabled).toBe(false);
    expect(box()?.checked).toBe(false);
    expect(said).toEqual([]);
  });

  // Why: one edit per finished entry (the field's change, on leaving it or
  // Enter), never per key, so one undo takes back one credit; the field
  // then shows the credit as stored.
  it("writes the credit once it is entered, and shows it as stored", async () => {
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.value = "  Read by   Anna ";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(edits.filter((e) => e.kind === "voiceCredit")).toEqual([]);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(edits.at(-1)).toEqual({
      kind: "voiceCredit",
      text: "  Read by   Anna ",
    });
    expect(credit()?.value).toBe("Read by Anna");
    expect(said.at(-1)).toBe("Spoken by: Read by Anna. Ctrl+Z undoes it.");
    // The same credit again is no edit.
    const count = edits.length;
    field.value = "Read by Anna ";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(edits.length).toBe(count);
    expect(credit()?.value).toBe("Read by Anna");
  });

  // Why: the credit's write is async too: the field is read-only while it
  // runs and takes typing again once the tour holds the credit.
  it("keeps the field read-only while the credit is written", async () => {
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    holdNext = true;
    field.value = "Anna";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(field.readOnly).toBe(true);
    expect(section.node.getAttribute("aria-busy")).toBe("true");
    gate?.release("written");
    await flush();
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe("Anna");
  });

  // Why: a refused credit must not stay in the field as if it were held;
  // the field (still focused, as after Enter) shows the tour's credit.
  it("shows the tour's credit again when the tour refuses the entry", async () => {
    held.voiceCredit = "Anna";
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.focus();
    holdNext = true;
    field.value = "Berta";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    gate?.release("refused");
    await flush();
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe("Anna");
    expect(said).toEqual([]);
  });

  // Why: one action at a time; a credit entered while the switch's write
  // runs is not taken, and the creator is told to enter it again.
  it("asks for the credit again when it is entered while another action runs", async () => {
    await voiced();
    holdNext = true;
    box()?.click();
    await flush();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.value = "Anna";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(edits.filter((e) => e.kind === "voiceCredit")).toEqual([]);
    expect(said.at(-1)).toBe(
      "The synthetic voice mark is still being changed. Enter the credit again once it is done.",
    );
    gate?.release("written");
    await flush();
  });

  // Why: the format's cap counts letters (code points), `maxlength` UTF-16
  // units: a credit of letters outside the basic plane takes two units
  // each, so a field capped at the format's number would stop at half of
  // it, and the cut that keeps the cap would never be reached.
  it("lets a credit of astral letters reach the format's cap, and cuts there", async () => {
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    const atCap = "\u{1D49C}".repeat(VOICE_CREDIT_MAX);
    expect(atCap.length).toBeLessThanOrEqual(field.maxLength);
    field.value = `${atCap}\u{1D49C}`;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(field.value).toBe(atCap);
    expect([...field.value].length).toBe(VOICE_CREDIT_MAX);
    expect(said.at(-1)).toBe(
      `Spoken by: ${atCap}. Cut to ${String(VOICE_CREDIT_MAX)} letters. Ctrl+Z undoes it.`,
    );
  });

  // Why: letters typed past a credit already at the cap leave the stored
  // credit as it was, so no edit runs; the field going back without a word
  // would read as the typing being lost for no reason.
  it("says the cap when letters typed past a credit already at it are cut", async () => {
    const atCap = "a".repeat(VOICE_CREDIT_MAX);
    held.voiceCredit = atCap;
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    const count = edits.length;
    field.value = `${atCap} more`;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(edits.length).toBe(count);
    expect(field.value).toBe(atCap);
    expect(said.at(-1)).toBe(
      `A credit keeps at most ${String(VOICE_CREDIT_MAX)} letters: it stays as it was.`,
    );
  });

  // Why: a credit within the cap is stored word for word, so its toast
  // must not claim a cut.
  it("says no cut for a credit within the cap", async () => {
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.value = "Anna";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(said.at(-1)).toBe("Spoken by: Anna. Ctrl+Z undoes it.");
  });

  it("takes the credit off when the field is emptied", async () => {
    held.voiceCredit = "Anna";
    await voiced();
    expect(credit()?.value).toBe("Anna");
    const field = credit();
    if (field === null) throw new Error("no field");
    field.value = "";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(edits.at(-1)).toEqual({ kind: "voiceCredit", text: "" });
    expect(credit()?.value).toBe("");
    expect(said.at(-1)).toBe("Credit removed. Ctrl+Z brings it back.");
  });

  // Why: the section draws itself again whenever the tour changes (a
  // save, an edit elsewhere); a field rebuilt mid-typing would lose the
  // creator's words and their focus.
  it("keeps the field and what is typed in it across a redraw", async () => {
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.focus();
    field.value = "Read by A";
    section.update({ blockId: "essay", body: BODY, key: "3" });
    await flush();
    expect(credit()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Read by A");
  });

  // Why: the field is one node for the section's life; selecting another
  // text while it is focused must show that text's credit, never a blank
  // field the next change would write as "no credit". It holds because
  // the field leaves the page while the new text is read, which takes its
  // focus; this pins that.
  it("shows the next text's credit when another text is selected while the field is focused", async () => {
    held.voiceCredit = "Anna";
    await voiced();
    const field = credit();
    if (field === null) throw new Error("no field");
    field.focus();
    // The next text carries its own credit, so a field that kept the first
    // text's value would show "Anna", not "Berta".
    held.voiceCredit = "Berta";
    section.update({ blockId: "other", body: BODY, key: "1" });
    expect(document.activeElement).not.toBe(field);
    await flush();
    expect(credit()).toBe(field);
    expect(field.value).toBe("Berta");
  });
});
