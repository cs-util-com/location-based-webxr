/**
 * The captions strip of a narrated long text (the narrated-text
 * prototype's `#caption`): a few lines at a time at the bottom of the AR
 * view, with the voice, so the visitor's eyes stay on the place. The
 * chunk holding the spoken word is shown (`caption-chunks.ts`), the word
 * marked and the words still to come dimmer; below it play, back 10 s,
 * the title with the clock and the voice's credit, and "Full text", which
 * opens the reading sheet.
 *
 * It is shown only with a read-along that fits (`narration-timing.ts`):
 * without one there is nothing to show, and the page draws the reading
 * view instead. A track that marks no words (a sentence track, or one
 * marked by hand) shows its sentence's chunks by the share of the
 * segment's time spent, with no word marked.
 *
 * @see captions-strip.ts.md
 */

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import "./captions-strip.css";
import {
  CAPTION_MAX_CHARS,
  captionChunks,
  chunkHolding,
  wordHolding,
  type CaptionChunk,
  type CaptionLayout,
  type CaptionWord,
} from "./caption-chunks.js";
import { fillCredit, sheetIcon } from "./long-text-sheet.js";
import type { TextSpan } from "./long-text-sentences.js";
import type { NarrationClock } from "./narration-player.js";
import { clockText, cursorAt, marksWords } from "./read-along.js";

/** Seconds the back button goes back (the prototype's). */
const BACK_MS = 10_000;

/** The media queries the strip's CSS lays itself out by (the reading
 *  sheet's: upright under 0.85, sideways under 520 px high). */
const PORTRAIT_QUERY = "(max-aspect-ratio: 17/20)";
const LANDSCAPE_QUERY = "(min-aspect-ratio: 17/20) and (max-height: 519.98px)";

/** The layout the window is in, by the strip's own media queries;
 *  `portrait` where there is no `matchMedia`. */
export function captionLayout(
  win: Pick<Window, "matchMedia"> | null,
): CaptionLayout {
  if (win === null || typeof win.matchMedia !== "function") return "portrait";
  if (win.matchMedia(PORTRAIT_QUERY).matches) return "portrait";
  if (win.matchMedia(LANDSCAPE_QUERY).matches) return "landscape";
  return "desktop";
}

/** What the strip shows: one narrated text with a read-along that fits. */
export interface CaptionsContent {
  /** Who the content is (a block id): a new key starts afresh. */
  readonly key: string;
  readonly title: string;
  /** The text's plain text `P`, which the timing counts in. */
  readonly plain: string;
  /** Its sentences, in `P` order (`plainSentences`). */
  readonly sentences: readonly TextSpan[];
  readonly timing: TourTiming;
  readonly player: NarrationClock;
  readonly synthetic: boolean;
  readonly voiceCredit?: string;
}

export interface CaptionsStripDeps {
  /** Where the strip is mounted (the AR overlay root). */
  readonly host: HTMLElement;
  /** "Full text": the reading sheet for the content shown. */
  openFullText(): void;
  /** The layout now; by default from the window's media queries. */
  layout?: () => CaptionLayout;
}

export interface CaptionsStripState {
  readonly shown: boolean;
  readonly key: string | null;
  /** The chunk's text, as shown. */
  readonly chunk: string;
  /** The marked word, or null. */
  readonly word: string | null;
  readonly layout: CaptionLayout;
}

export interface CaptionsStrip {
  /** Shows `content` (the same key again keeps its place). */
  show(content: CaptionsContent): void;
  /** Hides the strip; the voice plays on (the page pauses it). */
  hide(): void;
  /** Follows the voice; cheap enough for every frame. */
  tick(): void;
  state(): CaptionsStripState;
  dispose(): void;
}

/** The voice's credit as one line ("Synthetic voice · Read by ..."). */
export function captionCredit(
  narration: Pick<CaptionsContent, "synthetic" | "voiceCredit">,
): string {
  const parts: string[] = [];
  if (narration.synthetic) parts.push("Synthetic voice");
  const credit = narration.voiceCredit?.trim() ?? "";
  if (credit !== "") parts.push(credit);
  return parts.join(" · ");
}

/**
 * Where the voice is, in `P`, on a track that marks no words: the share
 * of its segment's time spent, as a share of the segment's text.
 */
export function offsetBySharedTime(
  segment: { startMs: number; endMs: number; from: number; to: number },
  ms: number,
): number {
  const span = segment.endMs - segment.startMs;
  const share =
    span > 0 ? Math.min(1, Math.max(0, (ms - segment.startMs) / span)) : 0;
  return Math.min(
    segment.to - 1,
    segment.from + Math.floor(share * (segment.to - segment.from)),
  );
}

interface Cut {
  readonly key: string;
  readonly words: CaptionWord[];
  readonly chunks: CaptionChunk[];
}

function button(
  doc: Document,
  testid: string,
  className: string,
  label: string,
): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = className;
  b.dataset.testid = testid;
  b.setAttribute("aria-label", label);
  return b;
}

export function createCaptionsStrip(deps: CaptionsStripDeps): CaptionsStrip {
  const doc = deps.host.ownerDocument;
  const win = doc.defaultView;
  const layoutNow = deps.layout ?? (() => captionLayout(win));

  const root = doc.createElement("div");
  root.className = "captions-strip cs-hide";
  root.dataset.testid = "captions-strip";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Captions");
  root.inert = true;
  const text = doc.createElement("div");
  text.className = "cs-text";
  text.dataset.testid = "captions-text";
  const row = doc.createElement("div");
  row.className = "cs-row";
  const play = button(doc, "captions-play", "cs-cb cs-play", "Play or pause");
  play.setAttribute("aria-pressed", "false");
  const back = button(doc, "captions-back", "cs-cb", "Back 10 seconds");
  back.append(sheetIcon(doc, "back10"));
  const meta = doc.createElement("div");
  meta.className = "cs-meta";
  const title = doc.createElement("div");
  title.className = "cs-title";
  title.dataset.testid = "captions-title";
  const sub = doc.createElement("div");
  sub.className = "cs-sub";
  sub.dataset.testid = "captions-sub";
  // The clock, then the credit with "Synthetic voice" set apart.
  const subClock = doc.createTextNode("");
  const subCredit = doc.createElement("span");
  sub.append(subClock, subCredit);
  meta.append(title, sub);
  const full = doc.createElement("button");
  full.type = "button";
  full.className = "cs-pill";
  full.dataset.testid = "captions-full";
  full.textContent = "Full text";
  row.append(play, back, meta, full);
  const bar = doc.createElement("div");
  bar.className = "cs-bar";
  bar.dataset.testid = "captions-bar";
  const fill = doc.createElement("div");
  bar.append(fill);
  root.append(text, row, bar);
  deps.host.append(root);

  let content: CaptionsContent | null = null;
  let shown = false;
  let cut: Cut | null = null;
  let chunkKey = "";
  let wordSpans: HTMLSpanElement[] = [];
  let firstWord = 0;
  let markedWord = -2;
  let markedWordText: string | null = null;
  let chunkText = "";
  let playIcon: "play" | "pause" | null = null;
  let subText = "";
  let creditText: string | null = null;
  let fillWidth = "";
  let layout: CaptionLayout = "portrait";

  function setPlayIcon(playing: boolean): void {
    const want = playing ? "pause" : "play";
    play.setAttribute("aria-pressed", String(playing));
    if (playIcon === want) return;
    playIcon = want;
    play.replaceChildren(sheetIcon(doc, want));
  }

  function cutFor(c: CaptionsContent, s0: number, s1: number): Cut {
    const key = `${String(s0)}:${String(s1)}:${layout}`;
    if (cut?.key === key) return cut;
    const from = c.sentences[s0]?.from ?? 0;
    const to = c.sentences[s1]?.to ?? c.plain.length;
    const made = captionChunks(c.plain, from, to, CAPTION_MAX_CHARS[layout]);
    cut = { key, ...made };
    return cut;
  }

  function drawChunk(c: CaptionsContent, now: Cut, ci: number): void {
    const chunk = now.chunks[ci];
    const key = `${now.key}:${String(ci)}`;
    if (chunk === undefined || key === chunkKey) return;
    chunkKey = key;
    markedWord = -2;
    const span = doc.createElement("span");
    span.className = "cs-chunk";
    wordSpans = [];
    firstWord = chunk.w0;
    let at = chunk.from;
    if (chunk.w0 >= 0) {
      for (let i = chunk.w0; i < chunk.w1; i += 1) {
        const w = now.words[i];
        if (w === undefined) continue;
        span.append(c.plain.slice(at, w.from));
        const ws = doc.createElement("span");
        ws.className = "cs-w";
        ws.textContent = c.plain.slice(w.from, w.to);
        span.append(ws);
        wordSpans.push(ws);
        at = w.to;
      }
    }
    span.append(c.plain.slice(at, chunk.to));
    chunkText = c.plain.slice(chunk.from, chunk.to);
    text.replaceChildren(span);
  }

  function markWord(w: number): void {
    if (w === markedWord) return;
    markedWord = w;
    markedWordText = null;
    wordSpans.forEach((ws, k) => {
      const i = firstWord + k;
      ws.classList.toggle("cs-on", i === w);
      ws.classList.toggle("cs-todo", w >= 0 && i > w);
      if (i === w) markedWordText = ws.textContent;
    });
  }

  function follow(c: CaptionsContent): void {
    const ms = c.player.nowMs();
    const cursor = cursorAt(c.timing, c.sentences, ms);
    const s0 = Math.max(0, cursor?.s0 ?? 0);
    const s1 = Math.max(s0, cursor?.s1 ?? 0);
    const now = cutFor(c, s0, s1);
    const seg = cursor === null ? undefined : c.timing.segments[cursor.segment];
    let w = -1;
    let ci = 0;
    if (seg !== undefined && marksWords(c.timing)) {
      w = wordHolding(now.words, seg.from);
      ci = chunkHolding(now.chunks, w);
    } else if (seg !== undefined) {
      ci = chunkHolding(
        now.chunks,
        wordHolding(now.words, offsetBySharedTime(seg, ms)),
      );
    }
    drawChunk(c, now, ci);
    markWord(w);
  }

  function drawMeta(c: CaptionsContent): void {
    const pos = c.player.nowMs();
    const dur = c.player.durationMs();
    const credit = captionCredit(c);
    if (credit !== creditText) {
      creditText = credit;
      fillCredit(subCredit, c);
      if (credit !== "") subCredit.prepend(" · ");
    }
    const next = `${clockText(pos)} / ${clockText(dur)}`;
    if (next !== subText) {
      subText = next;
      subClock.textContent = next;
    }
    const width = `${String(dur > 0 ? Math.min(100, (pos / dur) * 100) : 0)}%`;
    if (width !== fillWidth) {
      fillWidth = width;
      fill.style.width = width;
    }
    setPlayIcon(c.player.playing());
  }

  function tick(): void {
    if (!shown || content === null) return;
    const l = layoutNow();
    if (l !== layout) {
      layout = l;
      cut = null;
      chunkKey = "";
    }
    follow(content);
    drawMeta(content);
  }

  const onPlay = (): void => {
    const c = content;
    if (c === null) return;
    if (c.player.playing()) c.player.pause();
    else c.player.play();
    tick();
  };
  const onBack = (): void => {
    const c = content;
    if (c === null) return;
    c.player.seek(c.player.nowMs() - BACK_MS);
    tick();
  };
  const onFull = (): void => {
    if (content !== null) deps.openFullText();
  };
  play.addEventListener("click", onPlay);
  back.addEventListener("click", onBack);
  full.addEventListener("click", onFull);

  return {
    show(next) {
      if (content?.key !== next.key || content.timing !== next.timing) {
        content = next;
        cut = null;
        chunkKey = "";
        title.textContent = next.title;
      } else {
        content = next;
      }
      if (!shown) {
        shown = true;
        root.classList.remove("cs-hide");
        root.inert = false;
      }
      tick();
    },
    hide() {
      if (!shown) return;
      shown = false;
      root.classList.add("cs-hide");
      root.inert = true;
    },
    tick,
    state() {
      return {
        shown,
        key: content?.key ?? null,
        chunk: chunkText,
        word: markedWordText,
        layout,
      };
    },
    dispose() {
      play.removeEventListener("click", onPlay);
      back.removeEventListener("click", onBack);
      full.removeEventListener("click", onFull);
      root.remove();
      content = null;
      shown = false;
    },
  };
}
