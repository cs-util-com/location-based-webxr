/**
 * A video's captions (pure): the creator's WebVTT text read into timed
 * cues, defensively - the text comes from a tour file - and the line the
 * visitor's player shows at a time. Only what a caption strip needs is
 * read: a cue's times and its words. Cue settings, styles, regions and
 * notes are passed over; markup in a cue's words is taken out, so a cue
 * never reaches the page as HTML. A block that is not a cue the reader
 * can use is left out and counted, so the editor can say so.
 *
 * @see video-captions.ts.md
 */

/** One caption: shown from `startS` to before `endS` (s). */
export interface CaptionCue {
  readonly startS: number;
  readonly endS: number;
  readonly text: string;
}

/** What a captions text reads to. */
export interface Captions {
  /** The cues in their start order. */
  readonly cues: readonly CaptionCue[];
  /** Blocks that looked like a cue but could not be read (a bad time, an
   *  end not after its start, no words), and cues over `CAPTION_MAX_CUES`. */
  readonly skipped: number;
  /** Null, or why nothing was read at all (no `WEBVTT` header). */
  readonly problem: string | null;
}

/** The most cues one video reads: a long film's subtitles fit, and an
 *  outsized file costs no more than this. */
export const CAPTION_MAX_CUES = 5000;

/** The most characters one cue shows: a strip, not a page. */
export const CAPTION_MAX_CUE_CHARS = 400;

/** `hh:mm:ss.ttt` or `mm:ss.ttt` (WebVTT's timestamps). */
const TIME = /^(?:(\d+):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

/** A timing line: two times and the cue's settings after them. */
const TIMING = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t].*)?$/;

/** Markup in a cue's words (`<v Anna>`, `<i>`, `<00:01.000>`); a
 *  bracket left over after it is taken out too. */
const TAG = /<[^>]*>/g;

/** The header: `WEBVTT` alone or followed by a space or tab and text. */
const HEADER = /^WEBVTT(?:[ \t].*)?$/;

/** A WebVTT time in seconds; null when it is not one. */
export function captionTime(text: string): number | null {
  const m = TIME.exec(text);
  if (m === null) return null;
  const [, h, mm, ss, ms] = m;
  // Counted in whole milliseconds, so a time reads back as written.
  const whole =
    (Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + Number(ms);
  return whole / 1000;
}

const NOTHING: Captions = { cues: [], skipped: 0, problem: null };

/** The blocks after the header's (which runs to the first blank line),
 *  each its non-blank lines. */
function blocksOf(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  const firstBlank = lines.findIndex((l) => l.trim() === "");
  const body = firstBlank < 0 ? [] : lines.slice(firstBlank + 1);
  for (const line of body) {
    if (line.trim() !== "") {
      block.push(line);
      continue;
    }
    if (block.length > 0) blocks.push(block);
    block = [];
  }
  if (block.length > 0) blocks.push(block);
  return blocks;
}

/** A block's cue; "pass" for a NOTE, STYLE or REGION block; null for a
 *  block that is no cue the reader can use. */
function cueOf(block: readonly string[]): CaptionCue | "pass" | null {
  // A cue's timing is its first line, or its second after an id.
  const at = block.findIndex((l) => l.includes("-->"));
  if (at < 0 || at > 1) {
    return /^(NOTE|STYLE|REGION)\b/.test(block[0] ?? "") ? "pass" : null;
  }
  const timing = TIMING.exec((block[at] ?? "").trim());
  if (timing === null) return null;
  const start = captionTime(timing[1] ?? "");
  const end = captionTime(timing[2] ?? "");
  const words = block
    .slice(at + 1)
    .map((l) => l.replace(TAG, "").replace(/[<>]/g, "").trim())
    .filter((l) => l !== "")
    .join("\n");
  if (start === null || end === null || end <= start || words === "") {
    return null;
  }
  return {
    startS: start,
    endS: end,
    text: words.slice(0, CAPTION_MAX_CUE_CHARS),
  };
}

/** The cues of `text`; anything that is not text reads to none. */
export function readCaptions(text: unknown): Captions {
  if (typeof text !== "string" || text.trim() === "") return NOTHING;
  // A byte-order mark before the header is allowed.
  const bare = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = bare.replace(/\r\n?/g, "\n").split("\n");
  if (!HEADER.test(lines[0] ?? "")) {
    return {
      cues: [],
      skipped: 0,
      problem: "WebVTT starts with a line that says WEBVTT",
    };
  }
  const cues: CaptionCue[] = [];
  let skipped = 0;
  for (const block of blocksOf(lines)) {
    const cue = cueOf(block);
    if (cue === "pass") continue;
    if (cue === null || cues.length >= CAPTION_MAX_CUES) skipped++;
    else cues.push(cue);
  }
  cues.sort((a, b) => a.startS - b.startS);
  return { cues, skipped, problem: null };
}

/** The words shown at `timeS`: every cue on at that time, in start order,
 *  one per line; "" when none is (or the time is no number). */
export function captionAt(cues: readonly CaptionCue[], timeS: number): string {
  if (!Number.isFinite(timeS)) return "";
  return cues
    .filter((c) => c.startS <= timeS && timeS < c.endS)
    .map((c) => c.text)
    .join("\n");
}

/** What the editor says under the captions: how many cues it read and
 *  how many characters they hold, and what it left out; null for none. */
export function captionsStatus(text: unknown): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const read = readCaptions(text);
  if (read.problem !== null) return `Not read: ${read.problem}.`;
  const chars = read.cues.reduce((n, c) => n + c.text.length, 0);
  const cues = `${String(read.cues.length)} ${read.cues.length === 1 ? "cue" : "cues"}`;
  const said = `${cues} · ${String(chars)} characters`;
  return read.skipped === 0
    ? said
    : `${said} · ${String(read.skipped)} left out (a bad time or no words)`;
}
