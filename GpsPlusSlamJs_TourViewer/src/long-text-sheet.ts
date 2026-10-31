/**
 * The reading sheet of a long text: its whole body, rendered from its
 * Markdown (`long-text-render.ts`), in the narrated-text prototype's
 * sheet (`public/prototypes/station-blocks-1-narrated-text/`) - a bottom
 * sheet on a phone held upright, a side panel held sideways and on a
 * desktop. It has the prototype's three modes:
 * - `silent` (a text with no voice): a calm reading mark the visitor
 *   moves by tapping a sentence or by the previous and next buttons, a
 *   readout of where they are, and the paragraphs as ticks on the bar;
 * - `plain` (a voice, but no read-along that fits the text, or one still
 *   being checked): play, back 10 s, the voice's clock, and no mark;
 * - `live` (a voice and a fitting read-along): the sentence spoken is
 *   marked, its word too on a word track read from a file, the sheet
 *   follows the voice until the visitor scrolls ("Back to the voice"),
 *   a tap on a sentence plays from it, and the paragraphs are ticks at
 *   their times.
 * A stale read-along is plain, with nothing said to the visitor.
 *
 * Pictures are fetched and decoded only near the view and within the
 * decode budget (`long-text-pictures.ts`); a link asks before it leaves
 * an AR session (`createLinkGuard`), in a bar inside the sheet.
 *
 * @see long-text-sheet.ts.md
 */
import "./long-text-sheet.css";

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import { pictureFit, type PictureFit } from "./image-cap.js";
import { placeLeaves, rangeOf, type PlacedLeaf } from "./long-text-leaves.js";
import {
  createLongTextPictures,
  screensAway,
  type LongTextPictures,
} from "./long-text-pictures.js";
import {
  createLinkGuard,
  leaveArQuestion,
  renderLongText,
} from "./long-text-render.js";
import {
  indexSentences,
  sentenceAt,
  type SentenceIndex,
} from "./long-text-sentences.js";
import type { NarrationClock } from "./narration-player.js";
import {
  clockText,
  cursorAt,
  marksWords,
  narrationMinutes,
  previousSentenceMs,
  sentenceSeekMs,
  sentenceStarts,
  type ReadAlongCursor,
} from "./read-along.js";

/** A text's voice, as the sheet plays it. */
export interface SheetNarration {
  /** The one clock the sheet and the captions strip share. */
  readonly player: NarrationClock;
  /** The read-along when it fits the text, null when it does not (or
   *  there is none). The sheet is plain until it settles; a rejection
   *  counts as null. */
  readonly timing: Promise<TourTiming | null>;
  readonly synthetic: boolean;
  readonly voiceCredit?: string;
}

/** What the sheet shows. */
export interface LongTextSheetContent {
  /** The line above the title (the station, as the prototype's
   *  "Old market square · Station 1"); empty for none. */
  readonly over: string;
  readonly title: string;
  /** The block's Markdown body (`parseTourMarkdown` reads it). */
  readonly body: string;
  /** The text's language (hyphenation, sentence rules); "en" when absent. */
  readonly lang?: string;
  /** The voice; absent for a text read in silence. */
  readonly narration?: SheetNarration;
}

export interface LongTextSheetDeps {
  /** Where the sheet is mounted (in AR: the DOM overlay's root). */
  readonly host: HTMLElement;
  /** A picture's file from the open tour, by its asset id. */
  loadAsset(asset: string): Promise<Blob>;
  /** An AR session runs now: a link then asks before it opens. */
  arActive(): boolean;
  /** Opens a link's page in a new tab, with no opener and no referrer. */
  openLink(href: string): void;
  /** The sheet was closed (its button, Escape, or `close()`). */
  onClose?(): void;
  /** Defaults to `pictureFit` (`image-cap.ts`). */
  readonly fit?: (blob: Blob) => Promise<PictureFit>;
  /** Default to `URL.createObjectURL` / `URL.revokeObjectURL`. */
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
  /** The text position under a point; defaults to the browser's caret
   *  lookup (`caretPositionFromPoint`, `caretRangeFromPoint`). */
  caretAt?(x: number, y: number): { node: Node; offset: number } | null;
}

export type LongTextSheetMode = "silent" | "plain" | "live";

export interface LongTextSheetState {
  readonly open: boolean;
  readonly title: string;
  readonly mode: LongTextSheetMode;
  /** The marked sentence (silent: the visitor's place; live: the
   *  voice's), from 0; -1 for none. */
  readonly sentence: number;
  readonly sentences: number;
  /** The marked sentence's paragraph, from 0; -1 for none. */
  readonly paragraph: number;
  readonly paragraphs: number;
  /** The sentence mark is drawn (the browser has the Custom Highlight
   *  API). */
  readonly marked: boolean;
  /** The voice's word is marked: its stretch of `P`, or null. */
  readonly word: { readonly from: number; readonly to: number } | null;
  /** The sheet follows the voice (live; false after the visitor scrolls
   *  away, until "Back to the voice"). */
  readonly following: boolean;
}

export interface LongTextSheet {
  readonly element: HTMLElement;
  /** Open the sheet on `content` (or show other content in it). */
  show(content: LongTextSheetContent): void;
  close(): void;
  isOpen(): boolean;
  /** Mark sentence `i` (clamped) and scroll it into view (silent). */
  goTo(i: number): void;
  /** Follow the voice: called on every frame while open (the AR frame
   *  loop; the page's own when there is none); cheap when nothing moved. */
  tick(): void;
  state(): LongTextSheetState;
  /** Close and take the sheet out of the page. */
  dispose(): void;
}

/** Reading speed for "about M min to read" (words a minute). */
const WORDS_A_MINUTE = 200;

/** How far back "back 10 s" goes. */
const BACK_MS = 10_000;

/** How far a bar's arrow key moves the voice. */
const KEY_STEP_MS = 5_000;

/** The name the reading mark is registered under (`::highlight()`). */
export const LONG_TEXT_MARK = "long-text-place";

/** The names the voice's sentence and word marks are registered under. */
export const LONG_TEXT_VOICE = "long-text-voice";
export const LONG_TEXT_WORD = "long-text-word";

/** Minutes to read `words` words, at least 1 (the prototype's rule). */
export function readMinutes(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 1;
  return Math.max(1, Math.round(words / WORDS_A_MINUTE));
}

/** The words of a body's plain text. */
export function wordCount(body: string): number {
  const text = plainTextOf(parseTourMarkdown(body)).text;
  return text.split(/\s+/u).filter((w) => w !== "").length;
}

/** The line under the title (the prototype's "sound off" line). */
export function sheetMeta(words: number): string {
  return `${words.toLocaleString("en")} words · about ${String(readMinutes(words))} min to read · sound off`;
}

/** The line under the title of a narrated text (the prototype's), with
 *  its language when the tour names one. */
export function narrationMeta(
  words: number,
  durationMs: number,
  lang?: string,
): string {
  const base = `${words.toLocaleString("en")} words · ${String(narrationMinutes(durationMs))} min narration`;
  return lang === undefined || lang === ""
    ? base
    : `${base} · ${lang.toUpperCase()}`;
}

/** The line under the controls. */
export const SHEET_CREDIT =
  "No narration in this view · tap a sentence to keep your place";

const SVG_NS = "http://www.w3.org/2000/svg";

interface IconSpec {
  readonly stroke: boolean;
  readonly d: readonly string[];
  readonly rects?: readonly (readonly [number, number, number, number])[];
  readonly text?: string;
}

/** The prototype's icons. */
const ICONS = {
  close: { stroke: true, d: ["M6 6l12 12M18 6L6 18"] },
  prev: {
    stroke: false,
    d: [
      "M5 5h2.4v14H5z",
      "M19 6.2v11.6a.9.9 0 0 1-1.4.75L9.7 13a1.2 1.2 0 0 1 0-2l7.9-5.55a.9.9 0 0 1 1.4.75z",
    ],
  },
  next: {
    stroke: false,
    d: [
      "M16.6 5H19v14h-2.4z",
      "M5 6.2v11.6a.9.9 0 0 0 1.4.75L14.3 13a1.2 1.2 0 0 0 0-2L6.4 5.45A.9.9 0 0 0 5 6.2z",
    ],
  },
  back10: {
    stroke: false,
    d: ["M12 5V2L7.5 5.8 12 9.6V6.8a6.2 6.2 0 1 1-6.2 6.2H4a8 8 0 1 0 8-8z"],
    text: "10",
  },
  play: {
    stroke: false,
    d: [
      "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
    ],
  },
  pause: {
    stroke: false,
    d: [],
    rects: [
      [6.5, 5, 4, 14],
      [13.5, 5, 4, 14],
    ],
  },
} as const satisfies Record<string, IconSpec>;

export type SheetIconName = keyof typeof ICONS;

/** One of the prototype's icons as an inline SVG (the captions strip
 *  shares them). */
export function sheetIcon(doc: Document, name: SheetIconName): SVGSVGElement {
  const spec: IconSpec = ICONS[name];
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", spec.stroke ? "lt-icon-stroke" : "lt-icon-fill");
  for (const d of spec.d) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  for (const [x, y, w, h] of spec.rects ?? []) {
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "1.2");
    svg.appendChild(rect);
  }
  if (spec.text !== undefined) {
    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", "12");
    text.setAttribute("y", "16.6");
    text.setAttribute("font-size", "7.2");
    text.setAttribute("font-family", "system-ui,Segoe UI,Arial");
    text.setAttribute("font-weight", "700");
    text.setAttribute("text-anchor", "middle");
    text.textContent = spec.text;
    svg.appendChild(text);
  }
  return svg;
}

/** The voice's credit as the prototype shows it: "Synthetic voice" set
 *  apart, then the creator's credit; empty for a person's voice with no
 *  credit. */
export function fillCredit(
  into: HTMLElement,
  narration: Pick<SheetNarration, "synthetic" | "voiceCredit">,
): void {
  const doc = into.ownerDocument;
  into.replaceChildren();
  const credit = narration.voiceCredit ?? "";
  if (narration.synthetic) {
    const i = doc.createElement("i");
    i.textContent = "Synthetic voice";
    into.appendChild(i);
    if (credit !== "") into.append(" · ");
  }
  if (credit !== "") into.append(credit);
}

interface HighlightApi {
  readonly registry: {
    set(name: string, h: unknown): void;
    delete(name: string): void;
  };
  readonly create: (ranges: readonly Range[]) => unknown;
}

/** The Custom Highlight API, where the browser has it. */
function highlightApi(): HighlightApi | null {
  const registry = (
    globalThis.CSS as { highlights?: HighlightApi["registry"] } | undefined
  )?.highlights;
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown })
    .Highlight;
  if (registry === undefined || Ctor === undefined) return null;
  return { registry, create: (ranges) => new Ctor(...ranges) };
}

function browserCaretAt(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?(
      x: number,
      y: number,
    ): {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  if (typeof d.caretPositionFromPoint === "function") {
    const p = d.caretPositionFromPoint(x, y);
    return p === null ? null : { node: p.offsetNode, offset: p.offset };
  }
  if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    return r === null
      ? null
      : { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

const EMPTY_INDEX: SentenceIndex = {
  sentences: [],
  paragraphs: 0,
  paragraphStarts: [],
};

/** Builds the sheet (closed) into `deps.host`. */
export function createLongTextSheet(deps: LongTextSheetDeps): LongTextSheet {
  const doc = deps.host.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    testId?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.className = className;
    if (testId !== undefined) e.dataset["testid"] = testId;
    return e;
  };
  const button = (
    className: string,
    testId: string,
    label: string,
    iconName: SheetIconName,
  ): HTMLButtonElement => {
    const b = el("button", className, testId);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.appendChild(sheetIcon(doc, iconName));
    return b;
  };

  const sheet = el("section", "lt-sheet", "long-text-sheet");
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "The text");
  const grab = el("div", "lt-grab");
  const header = el("header", "lt-head", "long-text-head");
  const over = el("div", "lt-over", "long-text-over");
  const title = el("h2", "lt-title", "long-text-title");
  const meta = el("div", "lt-meta", "long-text-meta");
  const close = button("lt-close", "long-text-close", "Close", "close");
  header.append(over, title, meta, close);
  const body = el("div", "lt-body");
  const wrap = el("div", "lt-wrap", "long-text-wrap");
  const article = el("article", "lt-text", "long-text-text");
  wrap.appendChild(article);
  const follow = el("button", "lt-follow", "long-text-follow");
  follow.type = "button";
  follow.textContent = "Back to the voice";
  follow.hidden = true;
  body.append(wrap, follow);
  const ask = el("div", "lt-ask", "long-text-ask");
  ask.hidden = true;
  ask.setAttribute("role", "alertdialog");
  const askText = el("p", "lt-ask-text");
  const askOpen = el("button", "lt-ask-open");
  askOpen.type = "button";
  askOpen.textContent = "Open";
  const askStay = el("button", "lt-ask-stay");
  askStay.type = "button";
  askStay.textContent = "Stay";
  ask.append(askText, askOpen, askStay);
  const foot = el("footer", "lt-foot", "long-text-foot");
  const bar = el("div", "lt-bar", "long-text-bar");
  bar.setAttribute("role", "slider");
  bar.setAttribute("aria-label", "Place in the text");
  bar.tabIndex = 0;
  const track = el("div", "lt-track");
  const fill = el("div", "lt-fill");
  const knob = el("div", "lt-knob");
  bar.append(track, fill, knob);
  const row = el("div", "lt-row");
  const t0 = el("span", "lt-time", "long-text-paragraph");
  const t1 = el("span", "lt-time lt-r", "long-text-percent");
  const btns = el("div", "lt-btns");
  const back = button("lt-cb", "long-text-back", "Back 10 seconds", "back10");
  const prev = button("lt-cb", "long-text-prev", "Previous sentence", "prev");
  const pos = el("span", "lt-pos", "long-text-position");
  pos.setAttribute("aria-live", "polite");
  const play = el("button", "lt-cb lt-play", "long-text-play");
  play.type = "button";
  play.setAttribute("aria-label", "Play or pause");
  const next = button("lt-cb", "long-text-next", "Next sentence", "next");
  btns.append(back, prev, pos, play, next);
  row.append(t0, btns, t1);
  const credit = el("div", "lt-credit", "long-text-credit");
  credit.textContent = SHEET_CREDIT;
  foot.append(bar, row, credit);
  sheet.append(grab, header, body, ask, foot);
  deps.host.appendChild(sheet);

  const highlights = highlightApi();
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  let index: SentenceIndex = EMPTY_INDEX;
  let leaves: readonly PlacedLeaf[] = [];
  let current = -1;
  let pictures: LongTextPictures | null = null;
  let pendingAsk: ((yes: boolean) => void) | null = null;
  let open = false;
  let mode: LongTextSheetMode = "silent";
  let narration: SheetNarration | null = null;
  let timing: TourTiming | null = null;
  let starts: number[] = [];
  let words = 0;
  let lang: string | undefined;
  /** Bumped by every show and close: a timing settling for an earlier
   *  text is ignored. */
  let generation = 0;
  let unsubscribe: (() => void) | null = null;
  let following = true;
  let cursor: ReadAlongCursor | null = null;
  let cursorKey = "";
  let word: { from: number; to: number } | null = null;
  let playShown: boolean | null = null;
  let clockShown = "";
  let durationShown = -1;

  function answer(yes: boolean): void {
    const settle = pendingAsk;
    pendingAsk = null;
    ask.hidden = true;
    settle?.(yes);
  }
  askOpen.addEventListener("click", () => {
    answer(true);
  });
  askStay.addEventListener("click", () => {
    answer(false);
  });

  const guard = createLinkGuard({
    arActive: () => deps.arActive(),
    ask: (host) => {
      answer(false);
      askText.textContent = leaveArQuestion(host);
      ask.hidden = false;
      return new Promise<boolean>((resolve) => {
        pendingAsk = resolve;
      });
    },
    open: (href) => {
      deps.openLink(href);
    },
  });

  function setBar(frac: number): void {
    const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
    fill.style.width = `${String(f * 100)}%`;
    knob.style.left = `${String(f * 100)}%`;
  }

  function paintSilent(scroll: boolean): void {
    const n = index.sentences.length;
    foot.hidden = n === 0;
    if (n === 0) {
      highlights?.registry.delete(LONG_TEXT_MARK);
      return;
    }
    const s = index.sentences[current];
    const frac = (current + 1) / n;
    setBar(frac);
    t0.textContent = `¶ ${String((s?.paragraph ?? 0) + 1)}/${String(index.paragraphs)}`;
    t1.textContent = `${String(Math.round(frac * 100))}%`;
    pos.textContent = `Sentence ${String(current + 1)} of ${String(n)}`;
    bar.setAttribute("aria-valuemin", "1");
    bar.setAttribute("aria-valuemax", String(n));
    bar.setAttribute("aria-valuenow", String(current + 1));
    bar.setAttribute("aria-valuetext", pos.textContent);
    if (s !== undefined && highlights !== null) {
      highlights.registry.set(LONG_TEXT_MARK, highlights.create([s.range]));
    }
    if (scroll && s !== undefined) scrollTo(s.range);
  }

  /** Draws the highlight `name` over `ranges`, or clears it for none. */
  function setMark(name: string, ranges: readonly Range[]): void {
    if (highlights === null) return;
    if (ranges.length > 0) {
      highlights.registry.set(name, highlights.create([...ranges]));
    } else highlights.registry.delete(name);
  }

  /** The ranges of the sentences `s0` to `s1`. */
  function sentenceRanges(s0: number, s1: number): Range[] {
    const ranges: Range[] = [];
    for (let s = s0; s <= s1; s += 1) {
      const r = index.sentences[s]?.range;
      if (r !== undefined) ranges.push(r);
    }
    return ranges;
  }

  /** The voice's marks for the cursor, drawn only when it moved. */
  function markVoice(): void {
    const key =
      cursor === null
        ? ""
        : `${String(cursor.segment)}:${String(cursor.s0)}:${String(cursor.s1)}`;
    if (key === cursorKey) return;
    const sentenceMoved =
      cursor?.s0 !== undefined && cursorKey.split(":")[1] !== String(cursor.s0);
    cursorKey = key;
    word = null;
    if (cursor === null || timing === null) {
      highlights?.registry.delete(LONG_TEXT_VOICE);
      highlights?.registry.delete(LONG_TEXT_WORD);
      return;
    }
    const ranges = sentenceRanges(cursor.s0, cursor.s1);
    setMark(LONG_TEXT_VOICE, ranges);
    const wordRange = marksWords(timing)
      ? rangeOf(doc, leaves, cursor.from, cursor.to)
      : null;
    if (wordRange !== null) word = { from: cursor.from, to: cursor.to };
    setMark(LONG_TEXT_WORD, wordRange === null ? [] : [wordRange]);
    const first = ranges[0];
    if (sentenceMoved && following && first !== undefined) scrollTo(first);
  }

  function voiceTicks(durationMs: number): void {
    for (const t of bar.querySelectorAll(".lt-tick")) t.remove();
    durationShown = durationMs;
    if (mode !== "live" || timing === null || !(durationMs > 0)) return;
    index.paragraphStarts.forEach((s0, i) => {
      if (i === 0 || timing === null) return;
      const k = starts[s0];
      const seg = k === undefined || k < 0 ? undefined : timing.segments[k];
      if (seg === undefined) return;
      const t = el("div", "lt-tick");
      t.style.left = `${String((seg.startMs / durationMs) * 100)}%`;
      bar.insertBefore(t, fill);
    });
  }

  /** The voice's controls and marks, from the shared clock. */
  function paintVoice(): void {
    const player = narration?.player;
    if (player === undefined) return;
    const now = player.nowMs();
    const dur = player.durationMs();
    if (dur !== durationShown) {
      voiceTicks(dur);
      meta.textContent = narrationMeta(words, dur, lang);
    }
    setBar(dur > 0 ? now / dur : 0);
    const clock = `${clockText(now)}|${clockText(Math.max(0, dur - now))}`;
    if (clock !== clockShown) {
      clockShown = clock;
      t0.textContent = clockText(now);
      t1.textContent = `-${clockText(Math.max(0, dur - now))}`;
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(Math.round(dur / 1000)));
      bar.setAttribute("aria-valuenow", String(Math.round(now / 1000)));
      bar.setAttribute("aria-valuetext", t0.textContent);
    }
    const playing = player.playing();
    if (playing !== playShown) {
      playShown = playing;
      play.replaceChildren(sheetIcon(doc, playing ? "pause" : "play"));
      play.setAttribute("aria-pressed", String(playing));
    }
    if (mode === "live" && timing !== null) {
      cursor = cursorAt(timing, index.sentences, now);
      markVoice();
    }
  }

  /** Scroll so the sentence sits a little above the middle of the text
   *  (where the prototype keeps it). */
  function scrollTo(range: Range): void {
    if (typeof range.getBoundingClientRect !== "function") return;
    if (typeof wrap.scrollTo !== "function") return;
    const box = range.getBoundingClientRect();
    const view = wrap.getBoundingClientRect();
    const top = wrap.scrollTop + box.top - view.top - wrap.clientHeight * 0.28;
    wrap.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function goTo(i: number, scroll = true): void {
    const n = index.sentences.length;
    if (mode !== "silent" || n === 0 || !Number.isFinite(i)) return;
    current = Math.min(n - 1, Math.max(0, Math.round(i)));
    paintSilent(scroll);
  }

  function silentTicks(): void {
    for (const t of bar.querySelectorAll(".lt-tick")) t.remove();
    const n = index.sentences.length;
    index.paragraphStarts.forEach((s0, i) => {
      if (i === 0 || n === 0) return;
      const t = el("div", "lt-tick");
      t.style.left = `${String((s0 / n) * 100)}%`;
      bar.insertBefore(t, fill);
    });
  }

  /** The chrome of the mode: which controls show, the lines, the ticks. */
  function applyMode(): void {
    sheet.classList.toggle("lt-silent", mode === "silent");
    sheet.classList.toggle("lt-plain", mode === "plain");
    sheet.classList.toggle("lt-live", mode === "live");
    sheet.dataset["mode"] = mode;
    const silent = mode === "silent";
    back.hidden = silent;
    play.hidden = silent;
    next.hidden = !silent;
    pos.hidden = !silent;
    prev.hidden = mode === "plain";
    follow.hidden = true;
    following = true;
    cursorKey = "x";
    cursor = null;
    clockShown = "";
    playShown = null;
    durationShown = -1;
    highlights?.registry.delete(LONG_TEXT_MARK);
    highlights?.registry.delete(LONG_TEXT_VOICE);
    highlights?.registry.delete(LONG_TEXT_WORD);
    if (silent || narration === null) {
      meta.textContent = sheetMeta(words);
      credit.textContent = SHEET_CREDIT;
      silentTicks();
      paintSilent(false);
      return;
    }
    foot.hidden = false;
    fillCredit(credit, narration);
    paintVoice();
  }

  function viewSpan(): { top: number; bottom: number } {
    const r = wrap.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  }

  function reset(): void {
    generation += 1;
    answer(false);
    pictures?.dispose();
    pictures = null;
    unsubscribe?.();
    unsubscribe = null;
    narration?.player.pause();
    narration = null;
    timing = null;
    starts = [];
    highlights?.registry.delete(LONG_TEXT_MARK);
    highlights?.registry.delete(LONG_TEXT_VOICE);
    highlights?.registry.delete(LONG_TEXT_WORD);
    article.replaceChildren();
    index = EMPTY_INDEX;
    leaves = [];
    current = -1;
    cursor = null;
    word = null;
  }

  function show(content: LongTextSheetContent): void {
    reset();
    const shown = generation;
    lang = content.lang;
    over.textContent = content.over;
    over.hidden = content.over === "";
    title.textContent = content.title === "" ? "Untitled" : content.title;
    words = wordCount(content.body);
    article.lang = lang ?? "en";
    const parsed = parseTourMarkdown(content.body);
    const rendered = renderLongText(parsed, {
      document: doc,
      onLinkTap: guard,
    });
    article.appendChild(rendered.fragment);
    const plain = plainTextOf(parsed);
    leaves = placeLeaves(plain, rendered.leaves);
    index = indexSentences(doc, plain.text, leaves, lang ?? "en");
    current = index.sentences.length === 0 ? -1 : 0;
    narration = content.narration ?? null;
    mode = narration === null ? "silent" : "plain";
    sheet.hidden = false;
    open = true;
    wrap.scrollTop = 0;
    applyMode();
    if (narration !== null) {
      unsubscribe = narration.player.onChange(paintVoice);
      narration.timing.then(
        (t) => {
          if (generation !== shown || t === null || narration === null) return;
          timing = t;
          starts = sentenceStarts(t, index.sentences);
          mode = "live";
          applyMode();
        },
        () => undefined,
      );
    }
    pictures = createLongTextPictures({
      pictures: rendered.pictures,
      document: doc,
      load: (asset) => deps.loadAsset(asset),
      fit: deps.fit ?? pictureFit,
      screensAway: (holder) => {
        const r = holder.getBoundingClientRect();
        return screensAway({ top: r.top, bottom: r.bottom }, viewSpan());
      },
      createUrl,
      revokeUrl,
    });
    pictures.update();
  }

  function closeSheet(): void {
    if (!open) return;
    open = false;
    reset();
    sheet.hidden = true;
    deps.onClose?.();
  }

  function seek(ms: number): void {
    narration?.player.seek(ms);
  }

  close.addEventListener("click", closeSheet);
  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
  });
  wrap.addEventListener(
    "scroll",
    () => {
      pictures?.update();
    },
    { passive: true },
  );
  // The visitor scrolling away stops the sheet following the voice.
  for (const type of ["wheel", "touchmove"]) {
    wrap.addEventListener(
      type,
      () => {
        if (mode !== "live" || !following) return;
        following = false;
        follow.hidden = false;
      },
      { passive: true },
    );
  }
  follow.addEventListener("click", () => {
    following = true;
    follow.hidden = true;
    const r = cursor === null ? undefined : index.sentences[cursor.s0]?.range;
    if (r !== undefined) scrollTo(r);
  });
  prev.addEventListener("click", () => {
    if (mode === "silent") {
      goTo(current - 1);
      return;
    }
    const player = narration?.player;
    if (player === undefined || timing === null) return;
    seek(
      previousSentenceMs(timing, index.sentences, starts, player.nowMs()) ?? 0,
    );
  });
  next.addEventListener("click", () => {
    goTo(current + 1);
  });
  back.addEventListener("click", () => {
    const player = narration?.player;
    if (player !== undefined) seek(player.nowMs() - BACK_MS);
  });
  play.addEventListener("click", () => {
    const player = narration?.player;
    if (player === undefined) return;
    if (player.playing()) player.pause();
    else player.play();
  });
  bar.addEventListener("click", (event) => {
    const r = bar.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const f = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
    if (mode === "silent") goTo(f * (index.sentences.length - 1));
    else seek(f * (narration?.player.durationMs() ?? 0));
  });
  bar.addEventListener("keydown", (event) => {
    if (mode === "silent") {
      const to: Record<string, number> = {
        ArrowLeft: current - 1,
        ArrowDown: current - 1,
        ArrowRight: current + 1,
        ArrowUp: current + 1,
        Home: 0,
        End: index.sentences.length - 1,
      };
      const target = to[event.key];
      if (target === undefined) return;
      event.preventDefault();
      goTo(target);
      return;
    }
    const player = narration?.player;
    if (player === undefined) return;
    const now = player.nowMs();
    const to: Record<string, number> = {
      ArrowLeft: now - KEY_STEP_MS,
      ArrowDown: now - KEY_STEP_MS,
      ArrowRight: now + KEY_STEP_MS,
      ArrowUp: now + KEY_STEP_MS,
      Home: 0,
      End: player.durationMs(),
    };
    const target = to[event.key];
    if (target === undefined) return;
    event.preventDefault();
    seek(target);
  });
  // A tap on a sentence keeps the place there, or plays the voice from it
  // (not on a link: it opens; not in a plain sheet: nothing is marked).
  article.addEventListener("click", (event) => {
    if (mode === "plain") return;
    if (event.target instanceof Element && event.target.closest("a") !== null) {
      return;
    }
    const at = (deps.caretAt ?? ((x, y) => browserCaretAt(doc, x, y)))(
      event.clientX,
      event.clientY,
    );
    if (at === null) return;
    const i = sentenceAt(index, at.node, at.offset);
    if (i === null) return;
    if (mode === "silent") {
      goTo(i, false);
      return;
    }
    const player = narration?.player;
    const ms = timing === null ? null : sentenceSeekMs(timing, starts, i);
    if (player === undefined || ms === null) return;
    following = true;
    follow.hidden = true;
    player.seek(ms);
    player.play();
  });

  return {
    element: sheet,
    show,
    close: closeSheet,
    isOpen: () => open,
    goTo: (i) => {
      goTo(i);
    },
    tick() {
      if (open && mode !== "silent") paintVoice();
    },
    state: () => {
      const sentence = mode === "live" ? (cursor?.s0 ?? -1) : current;
      const live = mode === "live" ? cursor !== null : sentence >= 0;
      return {
        open,
        title: title.textContent,
        mode,
        sentence: mode === "plain" ? -1 : sentence,
        sentences: index.sentences.length,
        paragraph:
          mode === "plain" ? -1 : (index.sentences[sentence]?.paragraph ?? -1),
        paragraphs: index.paragraphs,
        marked: open && mode !== "plain" && live && highlights !== null,
        word: open && mode === "live" ? word : null,
        following,
      };
    },
    dispose() {
      closeSheet();
      sheet.remove();
    },
  };
}
