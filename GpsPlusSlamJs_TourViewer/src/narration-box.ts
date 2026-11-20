/**
 * The narration box: a narrated text at the bottom of the AR view, at
 * most three lines at a time, the speaker's name in their colour at the
 * start of what they say, the words still to come in grey, a thin
 * scrollbar on the right. Scrolling the words is scrubbing the voice (a
 * vertical drag of one line height moves the voice by one line), and a
 * tap pauses or plays, with a play or pause sign under the finger. The
 * calm HUD's scroll box prototype
 * (`public/prototypes/hud-calm-r5-1-scroll-box/`) is its specification.
 *
 * Two slots beside the words stay empty for now: the story's next step and
 * a quiz's action will take them, so the box is shaped as their place
 * (`slots`).
 *
 * The voice (`NarrationClock`) is the clock; the box reads it every frame
 * and tells the page's store (`narration-box-slice.ts`) which text it
 * shows and whether its voice plays, only when that changes.
 *
 * @see narration-box.ts.md
 */

import type { UnknownAction } from "@reduxjs/toolkit";
import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import "./narration-box.css";
import { wordsOf } from "./plain-words.js";
import {
  narrationBoxHidden,
  narrationBoxPlaying,
  narrationBoxScrubbing,
  narrationBoxShown,
} from "./narration-box-slice.js";
import {
  BOX_MAX_ROWS,
  dragScroll,
  followScroll,
  isTap,
  lineFloatAt,
  lineIndices,
  lineStarts,
  thumbGeometry,
  timeAtLine,
  wordAt,
  wordStartsMs,
} from "./narration-box-timeline.js";
import type { NarrationClock } from "./narration-player.js";
import type {
  WordsPaintLayout,
  WordsPaintModel,
  WordsPaintRun,
} from "./narration-words-paint.js";

/** Who speaks: the name shown at the start of the words, in this colour. */
export interface NarrationSpeaker {
  readonly name: string;
  /** A CSS colour (the speaker's own; `#rrggbb`). */
  readonly color: string;
}

export interface NarrationBoxContent {
  /** The shown text's identity: a new key is a new text. */
  readonly key: string;
  readonly title: string;
  readonly speaker: NarrationSpeaker;
  /** The text as the voice reads it (the timing's offsets are into it). */
  readonly plain: string;
  readonly timing: Pick<TourTiming, "segments">;
  readonly player: NarrationClock;
  /** A synthetic voice: said on screen after the name, not only to a
   *  screen reader. */
  readonly synthetic: boolean;
  /** The voice's credit, shown after the name when there is one. */
  readonly voiceCredit?: string;
}

export interface NarrationBoxDeps {
  /** Where the box and its tap signs go. */
  readonly host: HTMLElement;
  readonly store: { dispatch(action: UnknownAction): unknown };
  /** The page's time in ms (`performance.now` by default). */
  readonly now?: () => number;
}

/** What a test or the check page reads. */
export interface NarrationBoxViewState {
  readonly shown: boolean;
  readonly key: string | null;
  /** The lit word's index, -1 before the first. */
  readonly lit: number;
  /** The last lit word's text, or null. */
  readonly word: string | null;
  readonly lines: number;
  readonly rows: number;
  /** The scroll, in lines. */
  readonly scroll: number;
  readonly scrubbing: boolean;
  /** Whether a finger (on the box or forwarded from the plate) is down. */
  readonly pressing: boolean;
  /** The travel mode's head row hint, empty in the natural mode. */
  readonly hint: string;
}

/**
 * How the box measures itself: "natural" fits the text (the HUD box);
 * "travel" takes a fixed 17 em, so the painted plate keeps one shape from
 * sign to sign, and adds a head row for the hint.
 */
type NarrationBoxMeasure = "natural" | "travel";

/** A finger forwarded from elsewhere (the plate), in screen px. */
interface NarrationBoxPress {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** One line of the words as the finger sees it, in screen px. */
  readonly linePx: number;
}

export interface NarrationBox {
  readonly element: HTMLElement;
  /** The side places for a step's action (empty and hidden for now). */
  readonly slots: { readonly left: HTMLElement; readonly right: HTMLElement };
  /** Shows `content` (cheap for the same content: every frame may call). */
  show(content: NarrationBoxContent, measure?: NarrationBoxMeasure): void;
  hide(): void;
  /** An invisible box that keeps its layout and its gestures. */
  setGhost(on: boolean): void;
  /** Whether the box takes pointers itself. */
  setPointer(on: boolean): void;
  /** What the plate paints, or null when hidden or not in travel mode. */
  paintModel(): WordsPaintModel | null;
  /** Starts a forwarded press; false when one is already down. */
  beginPress(press: NarrationBoxPress): boolean;
  movePress(x: number, y: number): void;
  /** Ends the press: "up" is a tap or a drag's release, "cancel" no tap. */
  endPress(kind: "up" | "cancel", x: number, y: number): void;
  /** Follows the voice; called by `show` and on every frame. */
  tick(): void;
  state(): NarrationBoxViewState;
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const PLAY_PATH = "M8 5v14l11-7z";
const PAUSE_PATH = "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z";
/** The follow's smoothing rate (1/s): the prototype's. */
const FOLLOW_RATE = 9;
/** A frame step longer than this (s) is a pause, not motion. */
const MAX_STEP_S = 0.1;
/** The width rule: 80 % of the window, never wider than 720 px. */
const BOX_SHARE = 0.8;
const BOX_CAP_PX = 720;
/** Box padding (14 + 10), border (2) and the scrollbar's room (12). */
const BOX_CHROME_PX = 38;
const TEXT_MIN_PX = 90;
const FALLBACK_LINE_PX = 22;
const FALLBACK_FONT_PX = 16;
/** The travel mode's fixed width, in em of the words' font. */
const TRAVEL_WIDTH_EM = 17;
/** The travel mode's head row (narration-box.css .nb-head). */
const HEAD_PX = 20;
/** The scrollbar's room right of the words (narration-box.css .nb-win). */
const SBAR_ROOM_PX = 12;
/** A finger's line is never taken as smaller than this (px). */
const MIN_PRESS_LINE_PX = 4;
const FALLBACK_GREY = 0.55;
const FALLBACK_TINT = 0.72;
const FALLBACK_RADIUS_PX = 12;
const HINT_START = "tap the words to listen";
const HINT_PAUSED = "paused - tap to play";
const HINT_END = "the end - tap to hear it again";
/** How long a tap sign may stay if its animation never ends (ms). */
const TAP_SIGN_MS = 1500;

interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** The scroll the drag moves from (moved on where the words are held). */
  s0: number;
  readonly line0: number;
  readonly linePx: number;
}

function icon(doc: Document, d: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function div(doc: Document, className: string): HTMLDivElement {
  const el = doc.createElement("div");
  el.className = className;
  return el;
}

/** Fills `el` with `text`, each word in its own span (the spaces kept as
 *  text), so the painter finds every word where the browser put it. */
function wordSpans(
  doc: Document,
  el: HTMLElement,
  text: string,
): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const parts = text.split(/(\s+)/).map((part) => {
    if (part === "" || /^\s+$/.test(part)) return part;
    const span = doc.createElement("span");
    span.textContent = part;
    spans.push(span);
    return span;
  });
  el.replaceChildren(...parts);
  return spans;
}

/** A positive CSS number, or `fallback` when it is not one. */
function cssNumber(value: string | undefined, fallback: number): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** What is said after the speaker's name: a synthetic voice, and the
 *  voice's credit when there is one; empty for neither. */
function disclosure(c: NarrationBoxContent): string {
  const credit = c.voiceCredit?.trim() ?? "";
  const parts = [
    ...(c.synthetic ? ["synthetic voice"] : []),
    ...(credit === "" ? [] : [credit]),
  ];
  return parts.map((p) => ` · ${p}`).join("");
}

/** Whether `a` and `b` draw the same words, disclosure and label (the
 *  player may differ: the box reads whichever it is given). */
function drawsSame(a: NarrationBoxContent, b: NarrationBoxContent): boolean {
  return (
    a.key === b.key &&
    a.timing === b.timing &&
    a.plain === b.plain &&
    a.speaker.name === b.speaker.name &&
    a.speaker.color === b.speaker.color &&
    a.title === b.title &&
    a.synthetic === b.synthetic &&
    a.voiceCredit === b.voiceCredit
  );
}

const pointerIdOf = (e: Event): number => {
  const id = (e as Partial<PointerEvent>).pointerId;
  return typeof id === "number" ? id : 0;
};

export function createNarrationBox(deps: NarrationBoxDeps): NarrationBox {
  const doc = deps.host.ownerDocument;
  const win = doc.defaultView;
  const now = deps.now ?? (() => performance.now());
  const reduceMotion =
    typeof win?.matchMedia === "function" &&
    win.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const root = doc.createElement("section");
  root.className = "narration-box nb-off";
  root.dataset.testid = "narration-box";
  root.tabIndex = 0;
  root.setAttribute("aria-roledescription", "narration");
  root.inert = true;
  const slotL = div(doc, "nb-slot nb-slot-l");
  const mid = div(doc, "nb-mid");
  // The travel mode's hint row: the painted plate draws it, the box keeps
  // its place.
  const headEl = div(doc, "nb-head");
  headEl.dataset.testid = "narration-box-hint";
  headEl.setAttribute("aria-hidden", "true");
  headEl.hidden = true;
  const winEl = div(doc, "nb-win");
  const col = div(doc, "nb-col");
  const sbar = div(doc, "nb-sbar");
  const thumb = doc.createElement("i");
  sbar.append(thumb);
  const measure = doc.createElement("span");
  measure.className = "nb-measure";
  measure.setAttribute("aria-hidden", "true");
  // Whether the voice plays, for a screen reader (the tap sign is gone
  // after 0.75 s).
  const live = doc.createElement("span");
  live.className = "nb-live";
  live.setAttribute("aria-live", "polite");
  winEl.append(col, sbar, measure, live);
  mid.append(headEl, winEl);
  const slotR = div(doc, "nb-slot nb-slot-r");
  root.append(slotL, mid, slotR);
  deps.host.append(root);

  let content: NarrationBoxContent | null = null;
  let shown = false;
  let spans: HTMLSpanElement[] = [];
  let starts: number[] = [];
  let lineOf: number[] = [];
  let ls: number[] = [0, 0];
  let lines = 1;
  let rows = 1;
  let lh = FALLBACK_LINE_PX;
  let litUpTo = -1;
  let scroll = 0;
  let lastFrame: number | null = null;
  let dirty = true;
  let press: Press | null = null;
  let dragging = false;
  let dragMs = 0;
  let resume = false;
  let ticking = false;
  /** The play state the store and the live region last heard, null for
   *  none yet in this showing. */
  let told: boolean | null = null;
  let whoEl: HTMLElement | null = null;
  let whoParts: HTMLElement[] = [];
  let discParts: HTMLElement[] = [];
  let mode: NarrationBoxMeasure = "natural";
  let hint = "";
  let paintLayout: WordsPaintLayout | null = null;
  const signs = new Set<HTMLElement>();

  function totalMs(): number {
    const d = content?.player.durationMs() ?? 0;
    const last = starts.at(-1) ?? 0;
    return Number.isFinite(d) && d > last ? d : last;
  }

  function build(c: NarrationBoxContent): void {
    const words = wordsOf(c.plain, 0, c.plain.length);
    starts = wordStartsMs(words, c.timing);
    const who = doc.createElement("b");
    who.className = "nb-who";
    who.dataset.testid = "narration-box-who";
    whoParts = wordSpans(doc, who, c.speaker.name);
    who.style.color = c.speaker.color;
    whoEl = who;
    const said = disclosure(c);
    const disc = said === "" ? null : doc.createElement("span");
    if (disc !== null) {
      disc.className = "nb-disc";
      disc.dataset.testid = "narration-box-disclosure";
      discParts = wordSpans(doc, disc, said);
    } else {
      discParts = [];
    }
    const head: Node[] = disc === null ? [who] : [who, disc];
    const parts: (Node | string)[] = [...head, " "];
    spans = [];
    let at = 0;
    for (const w of words) {
      parts.push(c.plain.slice(at, w.from));
      const span = doc.createElement("span");
      span.className = "nb-w";
      span.textContent = c.plain.slice(w.from, w.to);
      parts.push(span);
      spans.push(span);
      at = w.to;
    }
    parts.push(c.plain.slice(at));
    col.replaceChildren(...parts);
    // The bold name and the disclosure too, so the width rule measures
    // what is drawn.
    const copies = head.map((n) => {
      const copy = n.cloneNode(true) as HTMLElement;
      delete copy.dataset.testid;
      return copy;
    });
    measure.replaceChildren(...copies, ` ${c.plain}`);
    root.setAttribute(
      "aria-label",
      `${c.speaker.name} reads "${c.title}"${
        c.synthetic ? ", a synthetic voice" : ""
      }. Tap to pause or play, drag up or down to move through the text;` +
        " with a keyboard, Space or Enter plays or pauses and the arrow" +
        " keys move a line.",
    );
    litUpTo = -1;
    told = null;
    live.textContent = "";
    dirty = true;
    root.classList.remove("nb-swap");
    void root.offsetWidth;
    root.classList.add("nb-swap");
  }

  /** The width rule and the lines, from where the browser put the words. */
  function layout(): void {
    dirty = false;
    const lineHeight =
      win === null ? NaN : parseFloat(win.getComputedStyle(col).lineHeight);
    lh =
      Number.isFinite(lineHeight) && lineHeight > 0
        ? lineHeight
        : FALLBACK_LINE_PX;
    const viewW = win?.innerWidth ?? 0;
    const travel = mode === "travel";
    const fontPx = cssNumber(
      win?.getComputedStyle(col).fontSize,
      FALLBACK_FONT_PX,
    );
    const boxMax = Math.min(
      viewW * BOX_SHARE,
      BOX_CAP_PX,
      travel ? TRAVEL_WIDTH_EM * fontPx : Infinity,
    );
    const natural = measure.getBoundingClientRect().width;
    const slotW = slotR.getBoundingClientRect().width;
    const room = Math.max(TEXT_MIN_PX, boxMax - BOX_CHROME_PX - slotW);
    const textW = Math.floor(
      travel ? room : Math.min(room, Math.max(TEXT_MIN_PX, natural + 2)),
    );
    col.style.width = `${String(textW)}px`;
    mid.style.width = `${String(textW + SBAR_ROOM_PX)}px`;
    lineOf = lineIndices(
      spans.map((s) => s.offsetTop),
      lh,
      whoEl?.offsetTop,
    );
    lines = Math.max(1, ...lineOf.map((l) => l + 1));
    rows = Math.min(BOX_MAX_ROWS, lines);
    root.style.setProperty("--nb-rows", String(rows));
    ls = lineStarts(starts, lineOf, totalMs());
    sbar.classList.toggle("nb-none", lines <= rows);
    scroll = target(content?.player.nowMs() ?? 0);
    paintLayout =
      travel && content !== null ? measurePaint(content, textW) : null;
  }

  function fontOf(el: Element, fallback: string): string {
    const cs = win?.getComputedStyle(el);
    if (cs === undefined || cs.fontSize === "" || cs.fontFamily === "") {
      return fallback;
    }
    return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  function runsOf(
    els: readonly HTMLElement[],
    kind: WordsPaintRun["kind"],
  ): WordsPaintRun[] {
    const at = lineIndices(
      els.map((el) => el.offsetTop),
      lh,
      whoEl?.offsetTop,
    );
    return els.map((el, i) => ({
      kind,
      text: el.textContent ?? "",
      x: el.offsetLeft,
      line: at[i] ?? 0,
      word: -1,
    }));
  }

  /**
   * The punctuation between the word spans (a colon, a full stop, an
   * opening quote), as runs at the browser's place: it lives in the text
   * between the spans, which only a Range can measure. A chunk glued to the
   * next word fades with it, any other with the word before.
   */
  function gapRuns(): WordsPaintRun[] {
    const range = doc.createRange();
    if (typeof range.getBoundingClientRect !== "function") return [];
    const colRect = col.getBoundingClientRect();
    const out: WordsPaintRun[] = [];
    let seen = 0;
    for (const node of col.childNodes) {
      if (node.nodeType === 3) {
        out.push(...chunkRuns(node, seen, range, colRect));
      } else if (spans.includes(node as HTMLSpanElement)) {
        seen += 1;
      }
    }
    range.detach();
    return out;
  }

  /** The non-space chunks of one text node between the words. */
  function chunkRuns(
    node: ChildNode,
    seen: number,
    range: Range,
    colRect: DOMRect,
  ): WordsPaintRun[] {
    const text = node.textContent ?? "";
    const beforeWord = spans.includes(node.nextSibling as HTMLSpanElement);
    const out: WordsPaintRun[] = [];
    for (const m of text.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (r.width <= 0) continue;
      const glued = beforeWord && m.index + m[0].length === text.length;
      out.push({
        kind: "word",
        text: m[0],
        x: r.left - colRect.left,
        line: lineIndices([r.top - colRect.top], lh, whoEl?.offsetTop)[0] ?? 0,
        word: glued ? seen : Math.max(0, seen - 1),
      });
    }
    return out;
  }

  /** The words as the browser laid them out, in the box's CSS px (offsets
   *  ignore transforms, so a box that moves or scales measures the same). */
  function measurePaint(
    c: NarrationBoxContent,
    textW: number,
  ): WordsPaintLayout {
    const bx = root.clientLeft;
    const by = root.clientTop;
    const words: WordsPaintRun[] = spans.map((el, i) => ({
      kind: "word",
      text: el.textContent ?? "",
      x: el.offsetLeft,
      line: lineOf[i] ?? 0,
      word: i,
    }));
    const rootCs = win?.getComputedStyle(root);
    const wordFont = fontOf(
      col,
      `500 ${String(FALLBACK_FONT_PX)}px sans-serif`,
    );
    return {
      width: root.offsetWidth,
      height: root.offsetHeight,
      radius: cssNumber(rootCs?.borderTopLeftRadius, FALLBACK_RADIUS_PX),
      win: {
        x: winEl.offsetLeft + bx,
        y: winEl.offsetTop + by,
        w: textW + SBAR_ROOM_PX,
        h: rows * lh,
      },
      head: {
        x: headEl.offsetLeft + bx,
        y: headEl.offsetTop + by,
        w: textW,
        h: headEl.offsetHeight > 0 ? headEl.offsetHeight : HEAD_PX,
      },
      fontPx: cssNumber(win?.getComputedStyle(col).fontSize, FALLBACK_FONT_PX),
      lineHeight: lh,
      rows,
      lines,
      fonts: {
        word: wordFont,
        who: whoEl === null ? wordFont : fontOf(whoEl, wordFont),
        disc: fontOf(discParts[0] ?? col, wordFont),
        hint: fontOf(headEl, "600 11px sans-serif"),
      },
      whoColor: c.speaker.color,
      grey: cssNumber(rootCs?.getPropertyValue("--nb-grey"), FALLBACK_GREY),
      tint: cssNumber(rootCs?.getPropertyValue("--nb-tint"), FALLBACK_TINT),
      runs: [
        ...runsOf(whoParts, "who"),
        ...runsOf(discParts, "disc"),
        ...words,
        ...gapRuns(),
      ],
      startsMs: starts,
    };
  }

  /** The head row's hint: how to start, go on or hear it again. */
  function hintOf(c: NarrationBoxContent, playing: boolean): string {
    if (mode !== "travel" || playing || dragging) return "";
    const ms = c.player.nowMs();
    const total = totalMs();
    if (total > 0 && ms >= total) return HINT_END;
    return ms <= 0 ? HINT_START : HINT_PAUSED;
  }

  function litAt(ms: number): number {
    return wordAt(starts, ms - 0.001);
  }

  function target(ms: number): number {
    const cur = Math.max(0, litAt(ms));
    const line = lineOf[cur] ?? 0;
    const first = lineOf[0] ?? 0;
    // Until the words pass their first line, the name and its disclosure
    // above them stay in view as far as the rows allow.
    if (line <= first) return Math.max(0, first - (rows - 1));
    return followScroll(line, lines, rows);
  }

  function draw(c: NarrationBoxContent): void {
    const total = totalMs();
    if ((ls.at(-1) ?? 0) !== total) ls = lineStarts(starts, lineOf, total);
    const ms = dragging ? dragMs : c.player.nowMs();
    const lit = litAt(ms);
    if (lit !== litUpTo) {
      const lo = Math.min(lit, litUpTo);
      const hi = Math.max(lit, litUpTo);
      for (let i = Math.max(0, lo + 1); i <= hi; i += 1) {
        spans[i]?.classList.toggle("nb-on", i <= lit);
      }
      litUpTo = lit;
    }
    const t = now();
    const dt =
      lastFrame === null
        ? 0
        : Math.min(MAX_STEP_S, Math.max(0, (t - lastFrame) / 1000));
    lastFrame = t;
    if (!dragging) {
      const want = target(ms);
      scroll = reduceMotion
        ? want
        : scroll + (want - scroll) * (1 - Math.exp(-dt * FOLLOW_RATE));
      if (Math.abs(want - scroll) < 0.002) scroll = want;
    }
    col.style.transform = `translateY(${(-scroll * lh).toFixed(2)}px)`;
    const g = thumbGeometry(scroll, lines, rows, rows * lh - 4);
    thumb.style.height = `${g.height.toFixed(1)}px`;
    thumb.style.transform = `translateY(${g.offset.toFixed(1)}px)`;
    // Whoever carried the voice on during the drag (the page's sound gate
    // at a return, the voice channel when a clip ends), the finger still
    // holds it, and lets it go on playing at the release.
    if (dragging && c.player.playing()) {
      resume = true;
      holdVoice(c.player);
    }
    // A drag holds the voice for the finger only: it still counts as
    // playing, so neither the store nor a screen reader hears of it.
    const playing = dragging ? resume : c.player.playing();
    const nextHint = hintOf(c, playing);
    if (nextHint !== hint) {
      hint = nextHint;
      headEl.textContent = hint;
    }
    const speaking = playing && !dragging ? "yes" : "no";
    if (root.dataset.speaking !== speaking) root.dataset.speaking = speaking;
    if (told !== playing) {
      if (told !== null) live.textContent = playing ? "Playing" : "Paused";
      told = playing;
      deps.store.dispatch(narrationBoxPlaying(playing));
    }
  }

  function tick(): void {
    if (!shown || content === null || ticking) return;
    ticking = true;
    try {
      if (dirty) layout();
      draw(content);
    } finally {
      ticking = false;
    }
  }

  function tapSign(x: number, y: number, playing: boolean): void {
    const fx = div(doc, "nb-tapfx");
    fx.dataset.testid = "narration-box-tap";
    fx.dataset.sign = playing ? "play" : "pause";
    fx.style.left = `${String(x)}px`;
    fx.style.top = `${String(y)}px`;
    fx.append(icon(doc, playing ? PLAY_PATH : PAUSE_PATH));
    deps.host.append(fx);
    signs.add(fx);
    const drop = (): void => {
      fx.remove();
      signs.delete(fx);
    };
    fx.addEventListener("animationend", drop);
    win?.setTimeout(drop, TAP_SIGN_MS);
  }

  function toggle(x: number, y: number): void {
    const c = content;
    if (c === null) return;
    const total = totalMs();
    if (!c.player.playing() && total > 0 && c.player.nowMs() >= total) {
      c.player.seek(0);
      c.player.play();
    } else if (c.player.playing()) {
      c.player.pause();
    } else {
      c.player.play();
    }
    tapSign(x, y, c.player.playing());
    tick();
  }

  /** Pauses `player` for the finger, keeping its place in the voice
   *  channel where it can (`hold`). */
  function holdVoice(player: NarrationClock): void {
    if (player.hold === undefined) player.pause();
    else player.hold();
  }

  /** A drag holds a playing voice for the finger; a voice not playing is
   *  left alone, so one the channel holds stays held. */
  function startDrag(c: NarrationBoxContent): void {
    dragging = true;
    resume = c.player.playing();
    dragMs = c.player.nowMs();
    if (resume) holdVoice(c.player);
    col.classList.add("nb-scrub");
    root.classList.add("nb-dragging");
    deps.store.dispatch(narrationBoxScrubbing(true));
  }

  /** The finger lets go: the voice goes on from where the words are, or,
   *  past the end, is paused for good (its channel handed back). */
  function endDrag(c: NarrationBoxContent): void {
    dragging = false;
    col.classList.remove("nb-scrub");
    root.classList.remove("nb-dragging");
    c.player.seek(dragMs);
    if (resume) {
      // In a hidden page the voice stays held, the channel's voice: the
      // page's sound gate carries it on at the return.
      if (dragMs >= totalMs()) c.player.pause();
      else if (!doc.hidden) c.player.play();
    }
    resume = false;
    deps.store.dispatch(narrationBoxScrubbing(false));
    tick();
  }

  function beginPress(p: NarrationBoxPress): boolean {
    if (!shown || content === null || press !== null) return false;
    press = {
      id: p.id,
      x: p.x,
      y: p.y,
      s0: scroll,
      line0: lineFloatAt(ls, content.player.nowMs()),
      linePx: Math.max(MIN_PRESS_LINE_PX, p.linePx),
    };
    return true;
  }
  function movePress(x: number, y: number): void {
    const c = content;
    if (press === null || c === null) return;
    const dy = press.y - y; // finger up, text up: ahead
    if (!dragging && !isTap(x - press.x, dy)) startDrag(c);
    if (!dragging) return;
    const moved = dy / press.linePx;
    dragMs = timeAtLine(ls, press.line0 + moved);
    const raw = press.s0 + moved;
    const read = lineOf[Math.max(0, litAt(dragMs))] ?? 0;
    scroll = dragScroll(raw, Math.max(0, lines - rows), read, rows);
    // Held at an edge in the text, the words move on from there with the
    // finger rather than jump to catch up once the read line moves on.
    if (raw >= 0 && raw <= lines - rows) press.s0 += scroll - raw;
    tick();
  }
  function endPress(kind: "up" | "cancel", x: number, y: number): void {
    const c = content;
    if (press === null) return;
    press = null;
    if (c === null) return;
    if (dragging) {
      endDrag(c);
      return;
    }
    // A cancelled pointer or a capture the system took is no tap.
    if (kind === "up") toggle(x, y);
  }

  const onDown = (e: PointerEvent): void => {
    if ((e.target as Element | null)?.closest?.("button") != null) return;
    const started = beginPress({
      id: pointerIdOf(e),
      x: e.clientX,
      y: e.clientY,
      linePx: lh,
    });
    if (!started) return;
    if (typeof root.setPointerCapture === "function") {
      try {
        root.setPointerCapture(pointerIdOf(e));
      } catch {
        // A pointer that is already gone: the press still works without.
      }
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (press === null || pointerIdOf(e) !== press.id) return;
    movePress(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent): void => {
    if (press === null || pointerIdOf(e) !== press.id) return;
    endPress(e.type === "pointerup" ? "up" : "cancel", e.clientX, e.clientY);
  };
  const onKey = (e: KeyboardEvent): void => {
    const c = content;
    if (c === null || !shown) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      toggle(r.left + r.width / 2, r.top + r.height / 2);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      c.player.seek(timeAtLine(ls, lineFloatAt(ls, c.player.nowMs()) + step));
      tick();
    }
  };
  const onResize = (): void => {
    dirty = true;
  };
  // A hidden page is not the box's to silence: the page's sound gate
  // pauses every voice and carries the held one on at the return.
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  // The system can take the capture without a pointerup or pointercancel
  // (a notification, the browser taking the gesture): the press ends there.
  root.addEventListener("lostpointercapture", onUp);
  root.addEventListener("keydown", onKey);
  win?.addEventListener("resize", onResize);
  // The box's own size changes when its styles or fonts arrive after the
  // first layout (a stylesheet a module injects, a late web font): lay it
  // out again, or the plate keeps painting the words where they were.
  const sizeWatch =
    typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  sizeWatch?.observe(root);

  /** A drag cut off (the box hides, another text comes): the voice keeps
   *  the dragged place but does not play on, and a voice the drag held is
   *  paused properly, its channel handed back. */
  function cancelDrag(): void {
    if (dragging && content !== null) {
      const c = content;
      const held = resume;
      resume = false;
      endDrag(c);
      if (held) c.player.pause();
    }
    press = null;
  }

  return {
    element: root,
    slots: { left: slotL, right: slotR },
    show(next, how = "natural") {
      if (how !== mode) {
        mode = how;
        root.classList.toggle("nb-travel", mode === "travel");
        headEl.hidden = mode !== "travel";
        if (mode !== "travel") {
          hint = "";
          headEl.textContent = "";
        }
        dirty = true;
      }
      const same = content !== null && drawsSame(content, next);
      // The store hears of a new text or a new showing, never per frame.
      const fresh = !same || !shown;
      if (!same) {
        cancelDrag();
        content = next;
        build(next);
      } else {
        content = next;
      }
      if (!shown) {
        shown = true;
        lastFrame = null;
        root.classList.remove("nb-off");
        root.inert = false;
      }
      if (fresh) deps.store.dispatch(narrationBoxShown(next.key));
      tick();
    },
    hide() {
      if (!shown) return;
      cancelDrag();
      shown = false;
      told = null;
      root.dataset.speaking = "no";
      root.classList.add("nb-off");
      root.inert = true;
      deps.store.dispatch(narrationBoxHidden());
    },
    tick,
    setGhost(on) {
      root.classList.toggle("nb-ghost", on);
    },
    setPointer(on) {
      root.classList.toggle("nb-nopointer", !on);
    },
    paintModel() {
      const c = content;
      if (!shown || c === null) return null;
      if (dirty) layout();
      if (paintLayout === null) return null;
      return {
        layout: paintLayout,
        frame: {
          voiceMs: dragging ? dragMs : c.player.nowMs(),
          lit: litUpTo,
          scroll,
          scrubbing: dragging,
          hint,
        },
      };
    },
    beginPress,
    movePress,
    endPress,
    state() {
      return {
        shown,
        key: shown ? (content?.key ?? null) : null,
        lit: litUpTo,
        word: litUpTo < 0 ? null : (spans[litUpTo]?.textContent ?? null),
        lines,
        rows,
        scroll,
        scrubbing: dragging,
        pressing: press !== null,
        hint,
      };
    },
    dispose() {
      cancelDrag();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("lostpointercapture", onUp);
      root.removeEventListener("keydown", onKey);
      win?.removeEventListener("resize", onResize);
      sizeWatch?.disconnect();
      for (const fx of signs) fx.remove();
      signs.clear();
      root.remove();
      if (shown) deps.store.dispatch(narrationBoxHidden());
      shown = false;
      content = null;
    },
  };
}
