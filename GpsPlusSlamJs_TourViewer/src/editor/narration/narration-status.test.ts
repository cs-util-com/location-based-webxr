/**
 * Why these tests matter: the Narration section is how a creator learns
 * that an edit took the read-along away from part of a text, and what an
 * import or a lining up again did. Each state the section can be in is
 * pinned here with its words (the prototype's), from real timings made by
 * the importer, so a change of wording or of a rule shows up as a diff
 * instead of as a creator who cannot tell why the words stopped lighting
 * up.
 */
import { describe, expect, it } from "vitest";

import { lineUpAgain } from "./re-anchor.js";
import {
  changeWords,
  importResult,
  lineUpResult,
  narrationStatus,
  plural,
} from "./narration-status.js";
import { importTiming } from "./timing-import.js";

const BODY =
  "Welcome to the old brigde. It was built in six years.\n\nThe river is wide.";

const VTT = [
  "WEBVTT",
  "",
  "00:00.000 --> 00:02.000",
  "Welcome to the old brigde.",
  "",
  "00:02.000 --> 00:04.000",
  "It was built in six years.",
  "",
  "00:04.000 --> 00:06.000",
  "The river is wide.",
  "",
].join("\n");

/** The timing entry's text for BODY, as an import writes it. */
async function timingText(body = BODY, vtt = VTT): Promise<string> {
  const done = await importTiming(body, vtt);
  return JSON.stringify(done.timing);
}

const voiced = async (body: string, durationMs: number | null = 161_000) =>
  narrationStatus(body, {
    hasVoice: true,
    durationMs,
    timingText: await timingText(),
  });

describe("plural", () => {
  it("picks the word for one and for many", () => {
    expect(plural(1, "sentence")).toBe("sentence");
    expect(plural(2, "sentence")).toBe("sentences");
    expect(plural(0, "line does", "lines do")).toBe("lines do");
  });
});

describe("changeWords", () => {
  it("names a word changed, words added and words taken out", () => {
    expect(changeWords("the old brigde", "the old bridge")).toBe(
      'you changed "brigde" to "bridge"',
    );
    expect(changeWords("the bridge", "the old bridge")).toBe('you added "old"');
    expect(changeWords("the old bridge", "the bridge")).toBe(
      'you took out "old"',
    );
    expect(changeWords("one two three", "four five three")).toBe(
      "you changed a few words",
    );
  });
});

describe("narrationStatus", () => {
  it("says there is no voice, and a voice without a timing", async () => {
    expect(
      await narrationStatus(BODY, {
        hasVoice: false,
        durationMs: null,
        timingText: null,
      }),
    ).toMatchObject({ summary: "No voice yet", tone: "", stale: null });
    expect(
      await narrationStatus(BODY, {
        hasVoice: true,
        durationMs: 9000,
        timingText: null,
      }),
    ).toMatchObject({ summary: "Voice, no timing yet", timing: null });
  });

  it("reads along with the voice's length when the timing fits", async () => {
    const status = await voiced(BODY);
    expect(status).toMatchObject({
      summary: "Reads along, 2:41",
      tone: "ok",
      problem: null,
      stale: null,
      unvoiced: [],
    });
    expect(status.timing?.segments).toHaveLength(3);
  });

  it("counts the sentences the timing does not voice as notes", async () => {
    const body = `${BODY} Nobody knows who paid.`;
    const status = await narrationStatus(body, {
      hasVoice: true,
      durationMs: null,
      timingText: await timingText(body),
    });
    expect(status.summary).toBe("Reads along · 1 note");
    expect(status.unvoiced.map((n) => n.text)).toEqual([
      '"Nobody knows who paid." has no voice.',
    ]);
  });

  it("explains a damaged timing and one that runs past the voice", async () => {
    expect(
      await narrationStatus(BODY, {
        hasVoice: true,
        durationMs: null,
        timingText: "{ not json",
      }),
    ).toMatchObject({ tone: "amber", summary: "The timing does not read" });
    const short = await voiced(BODY, 3000);
    expect(short.tone).toBe("amber");
    expect(short.summary).toBe("The timing runs past the voice");
    expect(short.problem).toContain("another recording");
  });

  it("names the word a creator changed after the voice was lined up", async () => {
    const status = await voiced(BODY.replace("brigde", "bridge"));
    expect(status.tone).toBe("amber");
    expect(status.summary).toBe("Needs lining up: 1 sentence");
    expect(status.stale?.items.map((n) => [n.kind, n.text])).toEqual([
      [
        "changed",
        '"Welcome to the old bridge.": you changed "brigde" to "bridge".',
      ],
    ]);
  });

  // Why: a word added at a voiced sentence's end changes no segment's
  // words, so the re-anchoring reports nothing changed - the timing is
  // stale by its hash all the same, and the notice once read "0 sentences"
  // with nothing listed and no Show link.
  it("names words added beside the voiced ones", async () => {
    const status = await voiced(
      BODY.replace("six years.", "six long years, 1904."),
    );
    expect(status.summary).toBe("Needs lining up: 1 sentence");
    expect(status.stale?.items.map((n) => [n.kind, n.text])).toEqual([
      [
        "changed",
        '"It was built in six long years, 1904.": you added "long 1904".',
      ],
    ]);
  });

  it("names a new sentence, a rewritten one and one taken out", async () => {
    const added = await voiced(
      BODY.replace("The river", "Nobody knows who paid. The river"),
    );
    expect(added.stale?.items.map((n) => n.kind)).toEqual(["new"]);
    expect(added.stale?.items[0]?.text).toBe(
      'New: "Nobody knows who paid.". The voice does not read it yet.',
    );

    const rewritten = await voiced(
      BODY.replace("It was built in six years.", "Nobody knows who paid."),
    );
    expect(rewritten.stale?.items.map((n) => [n.kind, n.text])).toEqual([
      ["rewritten", 'Rewritten: "Nobody knows who paid.".'],
    ]);

    const cut = await voiced(BODY.replace(" It was built in six years.", ""));
    expect(cut.stale?.items.map((n) => n.kind)).toEqual(["taken-out"]);
    expect(cut.stale?.items[0]?.text).toContain("It was built in six years");
    expect(cut.stale?.items[0]?.text).toContain("The voice still reads it.");
    expect(cut.summary).toBe("Needs lining up: 1 sentence");
  });

  it("never throws for a timing of another text", async () => {
    const status = await narrationStatus("Something else entirely.", {
      hasVoice: true,
      durationMs: 1000,
      timingText: await timingText(),
    });
    expect(status.tone).toBe("amber");
    expect(status.stale).not.toBeNull();
  });
});

describe("importResult", () => {
  it("says how many lines matched, lists the others, and the unvoiced sentences", async () => {
    const body = BODY.replace("The river is wide.", "The lake is deep.");
    const card = importResult("talk.vtt", await importTiming(body, VTT));
    expect(card.title).toBe("Imported talk.vtt");
    expect(card.partial).toBe(true);
    expect(card.text).toBe(
      "2 of 3 lines of the file match your text. 1 line does not match your text; it is listed below. The voice still plays it, with nothing lit up. 1 sentence of your text has no voice.",
    );
    expect(card.notes.map((n) => n.text)).toEqual([
      'Line 9 of the file · 0:04-0:06 "The river is wide." is not in your text.',
    ]);
  });

  it("says a file that fits fits", async () => {
    const card = importResult("talk.vtt", await importTiming(BODY, VTT));
    expect(card.partial).toBe(false);
    expect(card.text).toBe(
      "3 of 3 lines of the file match your text. Every sentence of your text has its voice.",
    );
  });
});

describe("lineUpResult", () => {
  it("says what the edited sentence kept and what could not be matched", async () => {
    const timing = (await importTiming(BODY, VTT)).timing;
    if (timing === null) throw new Error("no timing");
    const typo = lineUpResult(
      await lineUpAgain(timing, BODY.replace("brigde", "bridge")),
    );
    expect(typo).toMatchObject({ title: "Lined up again", partial: false });
    expect(typo.text).toBe(
      "3 of 3 sentences have their voice. The part you edited keeps its voice: the words around the change set the timing. Nothing was lost.",
    );
    const rewritten = lineUpResult(
      await lineUpAgain(
        timing,
        BODY.replace("It was built in six years.", "Nobody knows who paid."),
      ),
    );
    expect(rewritten.partial).toBe(true);
    expect(rewritten.text).toBe(
      "2 of 3 sentences have their voice. 1 sentence could not be matched: visitors see it without the highlight, and the rest reads along as before. To give it a voice, record that part again and import a new timing.",
    );
  });
});
