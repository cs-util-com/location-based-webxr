/**
 * The reading sheet's check page (`long-text-check.html`): one long text
 * open in the production reading sheet (`long-text-sheet.ts`), with no
 * AR session, so the sheet can be put side by side with the narrated-text
 * prototype's sheet and the layout e2e can pin where its parts land.
 * Linked from nothing. The e2e and the side-by-side check drive it
 * through `window.__longTextCheck`, which is always installed.
 *
 * `?text=rich` opens a body with headings, a nested list, a link and two
 * pictures served from files made in the page; `?ar=1` makes the sheet
 * behave as during an AR session (a link asks before it opens).
 *
 * `?voice=timed` gives the text a voice and a word read-along that fits
 * it, `?voice=stale` one made for other words; both go through the
 * visitor's own narration (`narration-visitor.ts`), with a stand-in clock
 * the page moves by `at(ms)` in place of a sound, and a timing made in
 * the page the way the prototype makes its own. `?view=captions` shows
 * the captions strip (`captions-strip.ts`, through `captions-follow.ts`)
 * in place of the sheet; `?open=0` opens nothing until `show()` (or
 * `follow()` for the strip).
 *
 * @see long-text-check.ts.md
 */
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import type { TourLongTextBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourTimingSegment } from "gps-plus-slam-app-framework/ar/tour-timing";

import { wordsOf } from "../caption-chunks.js";
import {
  createCaptionsFollow,
  type CaptionsFollow,
} from "../captions-follow.js";
import {
  createCaptionsStrip,
  type CaptionsStrip,
  type CaptionsStripState,
} from "../captions-strip.js";
import {
  createLongTextSheet,
  LONG_TEXT_MARK,
  LONG_TEXT_VOICE,
  LONG_TEXT_WORD,
  type LongTextSheetContent,
  type LongTextSheetState,
} from "../long-text-sheet.js";
import { plainSentences, type TextSpan } from "../long-text-sentences.js";
import type { NarrationPlayer } from "../narration-player.js";
import type { NarrationVerdict } from "../narration-timing.js";
import {
  createNarrationVisitor,
  type NarrationVisitor,
} from "../narration-visitor.js";
import { withPreferredView } from "../visitor-prefs.js";
import { CHECK_TEXT } from "./lectern-check-text.js";

/** A part's box on the page (CSS px). */
interface PartRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The parts the layout e2e measures, by their `data-testid`. */
const PARTS = {
  sheet: "long-text-sheet",
  head: "long-text-head",
  over: "long-text-over",
  title: "long-text-title",
  meta: "long-text-meta",
  close: "long-text-close",
  wrap: "long-text-wrap",
  text: "long-text-text",
  foot: "long-text-foot",
  bar: "long-text-bar",
  prev: "long-text-prev",
  next: "long-text-next",
  position: "long-text-position",
  credit: "long-text-credit",
  back: "long-text-back",
  play: "long-text-play",
} as const;

type PartName = keyof typeof PARTS;

/** The captions strip's parts the layout e2e measures, by selector. */
const CAPTION_PARTS = {
  strip: '[data-testid="captions-strip"]',
  text: '[data-testid="captions-text"]',
  chunk: ".cs-chunk",
  row: ".cs-row",
  play: '[data-testid="captions-play"]',
  back: '[data-testid="captions-back"]',
  title: '[data-testid="captions-title"]',
  sub: '[data-testid="captions-sub"]',
  full: '[data-testid="captions-full"]',
  bar: '[data-testid="captions-bar"]',
} as const;

type CaptionPartName = keyof typeof CAPTION_PARTS;

interface LongTextCheckState {
  readonly sheet: LongTextSheetState;
  readonly parts: Readonly<Record<PartName, PartRect | null>>;
  /** The text's first paragraph, as rendered. */
  readonly firstParagraph: PartRect | null;
  /** The space between its first and second paragraphs (px), or null. */
  readonly paragraphGap: number | null;
  readonly fontSize: number;
  readonly lineHeight: number;
  /** The reading mark is registered with the browser. */
  readonly highlightRegistered: boolean;
}

/** The voice's side of the page (`?voice=`). */
interface VoiceCheckState {
  readonly verdict: NarrationVerdict | undefined;
  /** How often the timing entry was read. */
  readonly timingReads: number;
  /** What the narration reported (stale reasons go to the console in
   *  the app, never to the visitor). */
  readonly warnings: readonly string[];
  /** The marked word's text in the sheet, or null. */
  readonly wordText: string | null;
  readonly captions: CaptionsStripState | null;
  readonly captionParts: Readonly<Record<CaptionPartName, PartRect | null>>;
  /** The stand-in clock (ms). */
  readonly nowMs: number;
}

interface LongTextCheck {
  /** Open the sheet on a text (the prototype's by default). */
  show(content?: Partial<LongTextSheetContent>): void;
  goTo(i: number): void;
  state(): LongTextCheckState;
  /** The first line box of the marked sentence, or null. */
  markRect(): PartRect | null;
  /** The links the sheet opened (only ever after a yes in AR). */
  opened(): readonly string[];
  /** Starts the captions strip following the visitor's rule
   *  (`?view=captions` only; at once unless `?open=0`). */
  follow(): void;
  /** Moves the stand-in clock to `ms` and lets the views follow. */
  at(ms: number): void;
  /** The prototype's demo position on the check timing (ms; 0 without
   *  a voice). */
  readonly demoMs: number;
  /** The check timing's segments (the words of `P`; none without a
   *  voice). */
  readonly segments: readonly TourTimingSegment[];
  /** Null without `?voice=`. */
  voice(): VoiceCheckState | null;
  /** The first line box of the voice's sentence, and of its word. */
  voiceRect(): PartRect | null;
  wordRect(): PartRect | null;
}

declare global {
  interface Window {
    __longTextCheck?: LongTextCheck;
  }
}

/** The check page's line above the title, as the prototype's. */
const CHECK_OVER = "Old market square · Station 1";

/** The picture assets of the rich text, by id. */
const CHECK_PICTURES = { mill: "#7b8f5a", bell: "#a0623c" } as const;

/**
 * The rich text (`?text=rich`): a heading, a nested list and a link on the
 * first screen; the two pictures several screens below it, so they are
 * decoded only once the sheet is scrolled near them.
 */
export const CHECK_RICH_BODY = [
  "# The square",
  "",
  "What stands here, **from the oldest**:",
  "",
  "- The keep",
  "  - its broken wall",
  "  - its first-floor door",
  "- The guild house",
  "",
  "See [the town map](https://town.example/map) for the way on.",
  "",
  CHECK_TEXT.body,
  "",
  CHECK_TEXT.body,
  "",
  "![The mill](asset:mill)",
  "",
  "## The hall",
  "",
  CHECK_TEXT.body,
  "",
  "![The bell](asset:bell)",
].join("\n");

export interface LongTextCheckOptions {
  readonly rich: boolean;
  readonly ar: boolean;
  /** A voice whose read-along fits (`timed`) or not (`stale`). */
  readonly voice: "timed" | "stale" | null;
  readonly view: "reading" | "captions";
  /** Open the sheet (or start the strip) at once. */
  readonly open: boolean;
}

/** What the page's query asks for. */
export function longTextCheckOptions(search: string): LongTextCheckOptions {
  const query = new URLSearchParams(search);
  const voice = query.get("voice");
  return {
    rich: query.get("text") === "rich",
    ar: query.get("ar") === "1",
    voice: voice === "timed" || voice === "stale" ? voice : null,
    view: query.get("view") === "captions" ? "captions" : "reading",
    open: query.get("open") !== "0",
  };
}

/** The voice's credit, as the prototype's demo record names its own. */
export const CHECK_VOICE_CREDIT =
  "Demo narration: a generated tone pattern standing in for a recorded voice";

/** The pause after a word, by what stands between it and the next. */
function pauseAfter(gap: string): number {
  if (/\n\s*\n/u.test(gap)) return 1100;
  if (/[.!?]/u.test(gap)) return 430;
  if (/[,;:]/u.test(gap)) return 190;
  return 0;
}

/**
 * A word track over the words of `plain`, timed as the prototype times
 * its stand-in narration: from 600 ms, a word lasts 105 ms plus 44 ms a
 * character (at most 720 ms), then 40 ms, plus 1 100 ms after a paragraph,
 * 430 ms after a sentence and 190 ms after a comma, semicolon or colon.
 */
export function checkSegments(plain: string): TourTimingSegment[] {
  const words = wordsOf(plain, 0, plain.length);
  const out: TourTimingSegment[] = [];
  let t = 600;
  words.forEach((w, i) => {
    const dur = Math.min(720, 105 + 44 * (w.to - w.from));
    out.push({
      startMs: Math.round(t),
      endMs: Math.round(t + dur),
      from: w.from,
      to: w.to,
      text: plain.slice(w.from, w.to),
    });
    const next = words[i + 1];
    const pause =
      next === undefined ? 0 : pauseAfter(plain.slice(w.to, next.from));
    t += dur + 40 + pause;
  });
  return out;
}

/** The prototype's demo position: 60 ms into the seventh word of the
 *  third sentence (0 when the text is shorter). */
export function checkDemoMs(
  sentences: readonly TextSpan[],
  segments: readonly TourTimingSegment[],
): number {
  const third = sentences[2];
  if (third === undefined) return 0;
  const first = segments.findIndex((s) => s.from >= third.from);
  const seventh = first < 0 ? undefined : segments[first + 6];
  return seventh === undefined ? 0 : seventh.startMs + 60;
}

/** A clock that stands still until it is moved (`seek`): the check page's
 *  voice, so a screenshot or a test sees one exact moment. */
export function createCheckClock(durationMs: number): NarrationPlayer {
  let now = 0;
  let playing = false;
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    nowMs: () => now,
    durationMs: () => durationMs,
    playing: () => playing,
    play() {
      playing = true;
      changed();
    },
    pause() {
      if (!playing) return;
      playing = false;
      changed();
    },
    seek(ms) {
      const to = Number.isFinite(ms) ? ms : 0;
      now = Math.min(durationMs, Math.max(0, to));
      changed();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
    },
  };
}

/** A small picture file of one colour, made in the page. */
function pictureFile(colour: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("the picture could not be made"));
      else resolve(blob);
    }, "image/png");
  });
}

/** The rich text's picture by asset id; refuses any other id. */
function loadCheckPicture(asset: string): Promise<Blob> {
  const colour = (CHECK_PICTURES as Record<string, string | undefined>)[asset];
  return colour === undefined
    ? Promise.reject(new Error(`the check page has no picture "${asset}"`))
    : pictureFile(colour);
}

function box(r: DOMRect | undefined): PartRect | null {
  return r === undefined
    ? null
    : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function rectOf(element: Element | null): PartRect | null {
  if (element === null || element.getClientRects().length === 0) return null;
  return box(element.getBoundingClientRect());
}

/** The browser's highlight registry, where it has one. */
function registry(): HighlightRegistry | undefined {
  return (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)
    ?.highlights;
}

/** The first line box of a registered highlight, or null. */
function highlightRect(name: string): PartRect | null {
  const mark = registry()?.get(name);
  const range = mark === undefined ? undefined : [...mark][0];
  return range instanceof Range ? box(range.getClientRects()[0]) : null;
}

/** The check text as a narrated block, its timing made in the page. */
interface CheckVoice {
  readonly block: TourLongTextBlock;
  readonly timingJson: string;
  readonly plain: string;
  readonly segments: readonly TourTimingSegment[];
  readonly demoMs: number;
}

async function checkVoice(body: string, stale: boolean): Promise<CheckVoice> {
  const plain = plainTextOf(parseTourMarkdown(body));
  const segments = checkSegments(plain.text);
  const durationMs = (segments.at(-1)?.endMs ?? 0) + 600;
  // A stale track: made for the same words, but its text was reworded.
  const textHash = await textHashOf(
    stale ? `${plain.text} Reworded after timing.` : plain.text,
  );
  return {
    block: {
      id: "text",
      kind: "longText",
      view: "reading",
      title: CHECK_TEXT.title,
      body,
      pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      narration: {
        audio: "voice",
        timing: "timing/text.json",
        synthetic: true,
        voiceCredit: CHECK_VOICE_CREDIT,
        durationMs,
      },
    },
    timingJson: JSON.stringify({
      granularity: "word",
      source: "file",
      segments,
      textHash,
    }),
    plain: plain.text,
    segments,
    demoMs: checkDemoMs(plainSentences(plain.text, plain.leaves), segments),
  };
}

/** The page's voice: the visitor's narration over the check timing, a
 *  stand-in clock, and the captions strip when asked for. */
interface CheckVoiceRun {
  readonly made: CheckVoice;
  readonly clock: NarrationPlayer;
  readonly narration: NarrationVisitor;
  readonly strip: CaptionsStrip | null;
  readonly follow: CaptionsFollow | null;
  reads(): number;
  warnings(): readonly string[];
}

function startVoice(
  host: HTMLElement,
  made: CheckVoice,
  view: LongTextCheckOptions["view"],
  openFullText: () => void,
): CheckVoiceRun {
  let timingReads = 0;
  const warnings: string[] = [];
  const clock = createCheckClock(made.block.narration?.durationMs ?? 0);
  const tour = {
    manifestWrap: "",
    loadEntryText: (name: string) => {
      timingReads += 1;
      return name === "timing/text.json"
        ? Promise.resolve(made.timingJson)
        : Promise.reject(new Error(`the check page has no entry "${name}"`));
    },
  };
  const narration = createNarrationVisitor({
    tour: () => tour,
    assets: () => [{ id: "voice", path: "voice.opus", kind: "audio" }],
    loadAsset: () => Promise.reject(new Error("the check page plays no sound")),
    onError: (message) => warnings.push(message),
    makePlayer: () => clock,
    warn: (message) => warnings.push(message),
  });
  const strip =
    view === "captions" ? createCaptionsStrip({ host, openFullText }) : null;
  const stored = withPreferredView(null, "longText", "world", "captions");
  const follow =
    strip === null
      ? null
      : createCaptionsFollow({
          strip,
          narration,
          read: () => ({ blocks: [made.block], presentId: "check", stored }),
        });
  return {
    made,
    clock,
    narration,
    strip,
    follow,
    reads: () => timingReads,
    warnings: () => [...warnings],
  };
}

function voiceState(
  run: CheckVoiceRun,
  sheet: LongTextSheetState,
  host: HTMLElement,
): VoiceCheckState {
  const word = sheet.word;
  return {
    verdict: run.narration.verdictOf(run.made.block),
    timingReads: run.reads(),
    warnings: run.warnings(),
    wordText: word === null ? null : run.made.plain.slice(word.from, word.to),
    captions: run.strip?.state() ?? null,
    captionParts: Object.fromEntries(
      (Object.keys(CAPTION_PARTS) as CaptionPartName[]).map((name) => [
        name,
        run.strip === null
          ? null
          : rectOf(host.querySelector(CAPTION_PARTS[name])),
      ]),
    ) as Record<CaptionPartName, PartRect | null>,
    nowMs: run.clock.nowMs(),
  };
}

export function startLongTextCheck(host: HTMLElement): void {
  void startCheck(host);
}

async function startCheck(host: HTMLElement): Promise<void> {
  const options = longTextCheckOptions(window.location.search);
  const arActive = options.ar;
  const opened: string[] = [];
  const sheet = createLongTextSheet({
    host,
    loadAsset: loadCheckPicture,
    arActive: () => arActive,
    openLink: (href) => {
      opened.push(href);
      window.open(href, "_blank", "noopener,noreferrer");
    },
  });
  const part = (name: PartName): Element | null =>
    sheet.element.dataset["testid"] === PARTS[name]
      ? sheet.element
      : sheet.element.querySelector(`[data-testid="${PARTS[name]}"]`);
  const defaultBody = options.rich ? CHECK_RICH_BODY : CHECK_TEXT.body;
  const made =
    options.voice === null
      ? null
      : await checkVoice(defaultBody, options.voice === "stale");
  let run: CheckVoiceRun | null = null;
  const show = (content: Partial<LongTextSheetContent> = {}): void => {
    const narration =
      run === null ? undefined : run.narration.sheetNarration(run.made.block);
    sheet.show({
      over: content.over ?? CHECK_OVER,
      title: content.title ?? CHECK_TEXT.title,
      body: content.body ?? defaultBody,
      lang: content.lang ?? "en",
      ...(narration === undefined ? {} : { narration }),
    });
  };
  run =
    made === null
      ? null
      : startVoice(host, made, options.view, () => {
          show();
        });
  let following = false;
  const sync = (): void => {
    sheet.tick();
    if (following) run?.follow?.sync();
  };
  // The page's frame loop stands in for the AR one (`tickStations`).
  const frame = (): void => {
    sync();
    requestAnimationFrame(frame);
  };
  const follow = (): void => {
    following = (run?.follow ?? null) !== null;
    sync();
  };
  window.__longTextCheck = {
    show,
    goTo: (i) => {
      sheet.goTo(i);
    },
    state() {
      const parts = Object.fromEntries(
        (Object.keys(PARTS) as PartName[]).map((name) => [
          name,
          rectOf(part(name)),
        ]),
      ) as Record<PartName, PartRect | null>;
      const text = part("text");
      const style = text === null ? null : getComputedStyle(text);
      const [first, second] = text?.querySelectorAll("p") ?? [];
      const gap =
        first === undefined || second === undefined
          ? null
          : second.getBoundingClientRect().top -
            first.getBoundingClientRect().bottom;
      return {
        sheet: sheet.state(),
        parts,
        firstParagraph: rectOf(first ?? null),
        paragraphGap: gap,
        fontSize: style === null ? 0 : parseFloat(style.fontSize),
        lineHeight: style === null ? 0 : parseFloat(style.lineHeight),
        highlightRegistered: registry()?.has(LONG_TEXT_MARK) ?? false,
      };
    },
    markRect: () => highlightRect(LONG_TEXT_MARK),
    opened: () => [...opened],
    follow,
    at: (ms) => {
      run?.clock.seek(ms);
      sync();
    },
    demoMs: made?.demoMs ?? 0,
    segments: made?.segments ?? [],
    voice: () => (run === null ? null : voiceState(run, sheet.state(), host)),
    voiceRect: () => highlightRect(LONG_TEXT_VOICE),
    wordRect: () => highlightRect(LONG_TEXT_WORD),
  };
  // The prototype's demo opens paused, 13 s or so into the voice.
  if (made !== null) run?.clock.seek(made.demoMs);
  if (options.open && options.view === "captions" && run !== null) follow();
  else if (options.open) show();
  requestAnimationFrame(frame);
}
