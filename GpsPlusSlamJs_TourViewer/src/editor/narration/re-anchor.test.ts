/**
 * Why these tests matter: a creator who fixes a typo in a narrated text
 * must not lose the read-along of the whole text. The track is lined up
 * again by its segments' own words, so every segment the edit did not
 * touch keeps its voice and moves with its words; the property tests hold
 * that for any text and any edit inside one word, for both kinds of
 * track. The sweep records how the one judgement in it - how alike an
 * edited word must stay to keep its voice - behaves across its range on
 * real edits, so the chosen value is a reading of evidence, not a guess.
 */
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  parseTourTimingText,
  tourTimingStaleReason,
  type TourTiming,
  type TourTimingSegment,
} from "gps-plus-slam-app-framework/ar/tour-timing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  lineUpAgain,
  REANCHOR_MIN_SIMILARITY,
  reAnchorSegments,
  wordSimilarity,
} from "./re-anchor.js";
import { wordTokens } from "./word-diff.js";

/** A word track of `text`: one segment per word, 300 ms each. */
function wordTrack(text: string): TourTiming {
  return {
    granularity: "word",
    source: "file",
    segments: wordTokens(text).map((w, k) => ({
      startMs: k * 300,
      endMs: k * 300 + 250,
      from: w.from,
      to: w.to,
      text: text.slice(w.from, w.to),
    })),
    textHash: "sha256:old",
  };
}

/** A sentence track of sentences joined by ". ": one segment per
 *  sentence, from its first word to its last. */
function sentenceTrack(sentences: readonly string[][]): {
  text: string;
  timing: TourTiming;
} {
  const segments: TourTimingSegment[] = [];
  let text = "";
  sentences.forEach((words, k) => {
    if (k > 0) text += " ";
    const from = text.length;
    text += words.join(" ");
    segments.push({
      startMs: k * 2000,
      endMs: k * 2000 + 1800,
      from,
      to: text.length,
      text: text.slice(from),
    });
    text += ".";
  });
  return {
    text,
    timing: { granularity: "sentence", source: "file", segments, textHash: "" },
  };
}

describe("wordSimilarity", () => {
  it("counts a swap of two letters as one slip, and a figure only as itself", () => {
    expect(wordSimilarity("teh", "the")).toBeCloseTo(2 / 3);
    expect(wordSimilarity("bridge", "bridge")).toBe(1);
    expect(wordSimilarity("1890", "1891")).toBe(0);
    expect(wordSimilarity("old", "new")).toBe(0);
  });
});

describe("reAnchorSegments", () => {
  it("keeps every segment of an unchanged text as it was", () => {
    const text = "Welcome to the old bridge.";
    const timing = wordTrack(text);
    const out = reAnchorSegments(timing, text);
    expect(out.segments).toEqual(timing.segments);
    expect(out.kept).toBe(5);
    expect(out.adjusted).toBe(0);
    expect(out.lost).toEqual([]);
  });

  it("moves the words after an inserted sentence, keeping their times", () => {
    const timing = wordTrack("The old bridge.");
    const out = reAnchorSegments(timing, "Hello there. The old bridge.");
    expect(out.segments.map((s) => [s.startMs, s.from, s.text])).toEqual([
      [0, 13, "The"],
      [300, 17, "old"],
      [600, 21, "bridge"],
    ]);
    expect(out.kept).toBe(3);
  });

  it("keeps the voice of a typo fixed, and lists a word replaced", () => {
    const timing = wordTrack("The old brigde was built in six years.");
    const out = reAnchorSegments(
      timing,
      "The old bridge was built in seven years.",
    );
    expect(out.segments.find((s) => s.startMs === 600)?.text).toBe("bridge");
    expect(out.adjusted).toBe(1);
    expect(out.changed).toEqual([
      { startMs: 600, from: 8, to: 14, was: "brigde" },
    ]);
    expect(out.lost).toEqual([{ startMs: 1800, endMs: 2050, text: "six" }]);
  });

  it("keeps a sentence with one word changed, and loses one rewritten", () => {
    const { text, timing } = sentenceTrack([
      ["The", "old", "bridge", "was", "built", "in", "six", "years"],
      ["It", "crosses", "the", "river"],
    ]);
    const edited = text
      .replace("six", "seven")
      .replace("It crosses the river", "Nobody knows who paid");
    const out = reAnchorSegments(timing, edited);
    expect(out.segments).toEqual([
      {
        startMs: 0,
        endMs: 1800,
        from: 0,
        to: 39,
        text: "The old bridge was built in seven years",
      },
    ]);
    expect(out.lost.map((l) => l.text)).toEqual(["It crosses the river"]);
  });

  it("loses a segment without words to place it by", () => {
    const out = reAnchorSegments(
      {
        granularity: "sentence",
        source: "marked",
        segments: [{ startMs: 0, endMs: 900, from: 0, to: 5 }],
        anchors: [{ ms: 0, at: 0 }],
        textHash: "",
      },
      "Hello world",
    );
    expect(out.segments).toEqual([]);
    expect(out.lost).toEqual([{ startMs: 0, endMs: 900, text: "" }]);
    expect(out.anchors).toEqual([]);
  });

  it("an edit inside one word keeps every other segment, for any text (both kinds of track)", () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(
      fc.property(
        fc.array(fc.array(word, { minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.nat(),
        fc.nat(),
        fc.stringMatching(/^[a-z]{0,3}$/),
        fc.nat(3),
        fc.boolean(),
        (sentences, pick, at, insert, cut, byWord) => {
          const { text, timing: sentence } = sentenceTrack(sentences);
          const timing = byWord ? wordTrack(text) : sentence;
          const words = wordTokens(text);
          const w = words[pick % words.length]!;
          const len = w.to - w.from;
          const start = w.from + (at % (len + 1));
          const end = Math.min(w.to, start + cut);
          const replaced =
            text.slice(w.from, start) + insert + text.slice(end, w.to);
          // The edit must leave one word there (not none, not a merge).
          fc.pre(replaced.length > 0);
          const edited = text.slice(0, start) + insert + text.slice(end);
          const shift = edited.length - text.length;
          const out = reAnchorSegments(timing, edited);
          for (const seg of timing.segments) {
            if (seg.from <= w.from && w.to <= seg.to) continue;
            const moved = seg.from >= w.to ? shift : 0;
            expect(out.segments).toContainEqual({
              ...seg,
              from: seg.from + moved,
              to: seg.to + moved,
            });
          }
        },
      ),
    );
  });
});

describe("the threshold over real edits", () => {
  // A typo fixed or a spelling changed: the voice says the word the text
  // now has, so its voice should stay on it.
  const typos: [string, string][] = [
    ["teh", "the"],
    ["brigde", "bridge"],
    ["Beethovn", "Beethoven"],
    ["recieve", "receive"],
    ["colour", "color"],
    ["centre", "center"],
    ["buidling", "building"],
    ["catle", "castle"],
    ["cathedrale", "cathedral"],
    ["Mozzart", "Mozart"],
    ["goverment", "government"],
    ["fountian", "fountain"],
    ["wiht", "with"],
    ["adn", "and"],
    ["theatre", "theater"],
    ["neighbourhood", "neighborhood"],
    ["stauts", "status"],
    ["si", "is"],
  ];
  // A word replaced: the voice says the old word, so lighting it up on
  // the new one would show a word the visitor does not hear.
  const replaced: [string, string][] = [
    ["six", "seven"],
    ["old", "new"],
    ["north", "south"],
    ["1890", "1891"],
    ["left", "right"],
    ["king", "queen"],
    ["red", "rod"],
    ["first", "second"],
    ["eight", "nine"],
    ["bridge", "bride"],
    ["east", "west"],
    ["1066", "1067"],
    ["Roman", "Norman"],
    ["tall", "wall"],
    ["lake", "late"],
    ["ten", "tea"],
    ["his", "her"],
    ["main", "rain"],
  ];
  /** Whether the voice stays on the edited word of a word track. */
  const relit = (from: string, to: string, minSimilarity: number) => {
    const text = `We stood by the ${from} near the gate.`;
    const out = reAnchorSegments(wordTrack(text), text.replace(from, to), {
      minSimilarity,
    });
    return out.segments.length === 8;
  };

  it("keeps most typo fixes and few replacements across the range", () => {
    const sweep: Record<string, [number, number]> = {};
    for (let t = 30; t <= 95; t += 5) {
      const v = t / 100;
      sweep[v.toFixed(2)] = [
        typos.filter(([a, b]) => relit(a, b, v)).length,
        replaced.filter(([a, b]) => relit(a, b, v)).length,
      ];
    }
    // [typos kept, replacements relit] of 18 each.
    expect(sweep).toEqual({
      "0.30": [18, 10],
      "0.35": [18, 9],
      "0.40": [18, 9],
      "0.45": [18, 9],
      "0.50": [18, 9],
      "0.55": [17, 8],
      "0.60": [17, 8],
      "0.65": [17, 7],
      "0.70": [15, 4],
      "0.75": [15, 4],
      "0.80": [14, 1],
      "0.85": [9, 0],
      "0.90": [3, 0],
      "0.95": [0, 0],
    });
    expect(REANCHOR_MIN_SIMILARITY).toBe(0.8);
  });

  // German tours: umlauts and the sharp s written out or not, long
  // compounds, and short words. Word keys fold accents (u for ü) and the
  // sharp s (ss for ß), so "Strasse"/"Straße" is no edit. Why: the threshold was chosen
  // on English pairs alone; this pins how it fares on German ones.
  const germanTypos: [string, string][] = [
    ["Strasse", "Straße"],
    ["Bruecke", "Brücke"],
    ["Muenchen", "München"],
    ["Kirhce", "Kirche"],
    ["Rathausplaz", "Rathausplatz"],
    ["Stadmauer", "Stadtmauer"],
    ["Brunen", "Brunnen"],
    ["Kathedrahle", "Kathedrale"],
    ["Jahrhundret", "Jahrhundert"],
    ["Fluß", "Fluss"],
    ["daß", "dass"],
    ["Schloß", "Schloss"],
    ["Kaiserplfaz", "Kaiserpfalz"],
    ["Bürgerhuas", "Bürgerhaus"],
    ["Strassenbahn", "Straßenbahn"],
    ["ud", "und"],
    ["dei", "die"],
    ["Hauptbahnhfo", "Hauptbahnhof"],
  ];
  const germanReplaced: [string, string][] = [
    ["Nord", "Süd"],
    ["alt", "neu"],
    ["links", "rechts"],
    ["König", "Königin"],
    ["Rathaus", "Rathausplatz"],
    ["Stadttor", "Stadtturm"],
    ["Westturm", "Ostturm"],
    ["Kirche", "Kirsche"],
    ["Bach", "Dach"],
    ["Mauer", "Bauer"],
    ["Burg", "Berg"],
    ["Marktplatz", "Marktkirche"],
    ["Stadtmauer", "Stadtpark"],
    ["Hauptbahnhof", "Hauptpost"],
    ["zehn", "zwei"],
    ["Sommer", "Winter"],
    ["Domplatz", "Domberg"],
    ["Ostseite", "Westseite"],
  ];
  const relitDe = (from: string, to: string, minSimilarity: number) => {
    const text = `Wir standen an der ${from} nahe dem Tor.`;
    const out = reAnchorSegments(wordTrack(text), text.replace(from, to), {
      minSimilarity,
    });
    return out.segments.length === 8;
  };

  it("keeps most German typo fixes and few replacements across the range", () => {
    const sweep: Record<string, [number, number]> = {};
    for (let t = 30; t <= 95; t += 5) {
      const v = t / 100;
      sweep[v.toFixed(2)] = [
        germanTypos.filter(([a, b]) => relitDe(a, b, v)).length,
        germanReplaced.filter(([a, b]) => relitDe(a, b, v)).length,
      ];
    }
    // [typos kept, replacements relit] of 18 each.
    expect(sweep).toEqual({
      "0.30": [18, 14],
      "0.35": [18, 13],
      "0.40": [18, 12],
      "0.45": [18, 11],
      "0.50": [18, 10],
      "0.55": [18, 10],
      "0.60": [18, 9],
      "0.65": [18, 8],
      "0.70": [16, 8],
      "0.75": [16, 7],
      "0.80": [16, 2],
      "0.85": [14, 1],
      "0.90": [11, 0],
      "0.95": [5, 0],
    });
    // At the chosen value: the typos that lose their voice, and the
    // replacements that keep it.
    expect(germanTypos.filter(([a, b]) => !relitDe(a, b, 0.8))).toEqual([
      ["ud", "und"],
      ["dei", "die"],
    ]);
    expect(germanReplaced.filter(([a, b]) => relitDe(a, b, 0.8))).toEqual([
      ["Kirche", "Kirsche"],
      ["Mauer", "Bauer"],
    ]);
    expect(REANCHOR_MIN_SIMILARITY).toBe(0.8);
  });

  it("keeps a sentence with one word edited, and loses one mostly rewritten, across the share's range", () => {
    // The second parameter: how much of a segment must remain. A sentence
    // of eight words with one replaced keeps its voice for any share up to
    // 7/8; with five of eight rewritten it is lost from a half up.
    const { text, timing } = sentenceTrack([
      ["The", "old", "bridge", "was", "built", "in", "six", "years"],
    ]);
    const one = text.replace("six", "seven");
    const five = text.replace(
      "was built in six years",
      "fell down last spring",
    );
    for (const share of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      expect(
        reAnchorSegments(timing, one, { minShare: share }).segments,
      ).toHaveLength(1);
      expect(
        reAnchorSegments(timing, five, { minShare: share }).segments,
      ).toHaveLength(share <= 3 / 8 ? 1 : 0);
    }
  });
});

describe("lineUpAgain", () => {
  it("gives a track the visitor's reader accepts as fitting the edited text", async () => {
    const body = "Welcome to the old brigde.\n\nIt was built in six years.";
    const plain = plainTextOf(parseTourMarkdown(body)).text;
    const fixed = body.replace("brigde", "bridge");
    const out = await lineUpAgain(wordTrack(plain), fixed);
    expect(out.timing).not.toBeNull();
    const timing = parseTourTimingText(JSON.stringify(out.timing));
    const now = plainTextOf(parseTourMarkdown(fixed)).text;
    expect(
      tourTimingStaleReason(timing, {
        plainLength: now.length,
        textHash: await textHashOf(now),
      }),
    ).toBeNull();
    expect(out.kept).toBe(10);
    expect(out.adjusted).toBe(1);
    expect(out.unvoiced).toEqual([]);
  });

  it("names the sentences no segment voices any more", async () => {
    const body = "One two three.\n\nFour five six.";
    const plain = plainTextOf(parseTourMarkdown(body)).text;
    const out = await lineUpAgain(
      wordTrack(plain),
      "One two three.\n\nSomething else entirely.",
    );
    expect(out.unvoiced).toEqual([{ from: 16, to: 40 }]);
    expect(out.lost).toHaveLength(3);
  });

  it("gives no track when nothing of the voice is left", async () => {
    const out = await lineUpAgain(wordTrack("One two."), "Three four.");
    expect(out.timing).toBeNull();
  });
});
