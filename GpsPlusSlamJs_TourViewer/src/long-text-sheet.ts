/**
 * The reading sheet of a long text: its whole body, rendered from its
 * Markdown (`long-text-render.ts`), in the narrated-text prototype's
 * sheet (`public/prototypes/station-blocks-1-narrated-text/`, its "sound
 * off" view) - a bottom sheet on a phone held upright, a side panel held
 * sideways and on a desktop. The format has no narration for a long text
 * yet, so the sheet is the prototype's sheet without playback: a calm
 * reading mark the visitor moves by tapping a sentence or by the
 * previous and next buttons, a readout of where they are, and the
 * paragraphs as ticks on the bar.
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

import { pictureFit, type PictureFit } from "./image-cap.js";
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

export interface LongTextSheetState {
  readonly open: boolean;
  readonly title: string;
  /** The marked sentence, from 0; -1 for a text with none. */
  readonly sentence: number;
  readonly sentences: number;
  /** The marked sentence's paragraph, from 0; -1 for none. */
  readonly paragraph: number;
  readonly paragraphs: number;
  /** The mark is drawn (the browser has the Custom Highlight API). */
  readonly marked: boolean;
}

export interface LongTextSheet {
  readonly element: HTMLElement;
  /** Open the sheet on `content` (or show other content in it). */
  show(content: LongTextSheetContent): void;
  close(): void;
  isOpen(): boolean;
  /** Mark sentence `i` (clamped) and scroll it into view. */
  goTo(i: number): void;
  state(): LongTextSheetState;
  /** Close and take the sheet out of the page. */
  dispose(): void;
}

/** Reading speed for "about M min to read" (words a minute). */
const WORDS_A_MINUTE = 200;

/** The name the reading mark is registered under (`::highlight()`). */
export const LONG_TEXT_MARK = "long-text-place";

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

/** The line under the controls. */
export const SHEET_CREDIT =
  "No narration in this view · tap a sentence to keep your place";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The prototype's icons: close, previous and next sentence. */
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
} as const;

function icon(doc: Document, name: keyof typeof ICONS): SVGSVGElement {
  const spec = ICONS[name];
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", spec.stroke ? "lt-icon-stroke" : "lt-icon-fill");
  for (const d of spec.d) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

interface HighlightApi {
  readonly registry: {
    set(name: string, h: unknown): void;
    delete(name: string): void;
  };
  readonly create: (range: Range) => unknown;
}

/** The Custom Highlight API, where the browser has it. */
function highlightApi(): HighlightApi | null {
  const registry = (
    globalThis.CSS as { highlights?: HighlightApi["registry"] } | undefined
  )?.highlights;
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown })
    .Highlight;
  if (registry === undefined || Ctor === undefined) return null;
  return { registry, create: (range) => new Ctor(range) };
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

  const sheet = el("section", "lt-sheet", "long-text-sheet");
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "The text");
  const grab = el("div", "lt-grab");
  const header = el("header", "lt-head", "long-text-head");
  const over = el("div", "lt-over", "long-text-over");
  const title = el("h2", "lt-title", "long-text-title");
  const meta = el("div", "lt-meta", "long-text-meta");
  const close = el("button", "lt-close", "long-text-close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.appendChild(icon(doc, "close"));
  header.append(over, title, meta, close);
  const wrap = el("div", "lt-wrap", "long-text-wrap");
  const article = el("article", "lt-text", "long-text-text");
  wrap.appendChild(article);
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
  const prev = el("button", "lt-cb", "long-text-prev");
  prev.type = "button";
  prev.setAttribute("aria-label", "Previous sentence");
  prev.appendChild(icon(doc, "prev"));
  const pos = el("span", "lt-pos", "long-text-position");
  pos.setAttribute("aria-live", "polite");
  const next = el("button", "lt-cb", "long-text-next");
  next.type = "button";
  next.setAttribute("aria-label", "Next sentence");
  next.appendChild(icon(doc, "next"));
  btns.append(prev, pos, next);
  row.append(t0, btns, t1);
  const credit = el("div", "lt-credit", "long-text-credit");
  credit.textContent = SHEET_CREDIT;
  foot.append(bar, row, credit);
  sheet.append(grab, header, wrap, ask, foot);
  deps.host.appendChild(sheet);

  const highlights = highlightApi();
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  let index: SentenceIndex = {
    sentences: [],
    paragraphs: 0,
    paragraphStarts: [],
  };
  let current = -1;
  let pictures: LongTextPictures | null = null;
  let pendingAsk: ((yes: boolean) => void) | null = null;
  let open = false;

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

  function paint(scroll: boolean): void {
    const n = index.sentences.length;
    foot.hidden = n === 0;
    if (n === 0) {
      highlights?.registry.delete(LONG_TEXT_MARK);
      return;
    }
    const s = index.sentences[current];
    const frac = (current + 1) / n;
    fill.style.width = `${String(frac * 100)}%`;
    knob.style.left = `${String(frac * 100)}%`;
    t0.textContent = `¶ ${String((s?.paragraph ?? 0) + 1)}/${String(index.paragraphs)}`;
    t1.textContent = `${String(Math.round(frac * 100))}%`;
    pos.textContent = `Sentence ${String(current + 1)} of ${String(n)}`;
    bar.setAttribute("aria-valuemin", "1");
    bar.setAttribute("aria-valuemax", String(n));
    bar.setAttribute("aria-valuenow", String(current + 1));
    bar.setAttribute("aria-valuetext", pos.textContent);
    if (s !== undefined && highlights !== null) {
      highlights.registry.set(LONG_TEXT_MARK, highlights.create(s.range));
    }
    if (scroll && s !== undefined) scrollTo(s.range);
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
    if (n === 0 || !Number.isFinite(i)) return;
    current = Math.min(n - 1, Math.max(0, Math.round(i)));
    paint(scroll);
  }

  function ticks(): void {
    for (const t of bar.querySelectorAll(".lt-tick")) t.remove();
    const n = index.sentences.length;
    index.paragraphStarts.forEach((s0, i) => {
      if (i === 0 || n === 0) return;
      const t = el("div", "lt-tick");
      t.style.left = `${String((s0 / n) * 100)}%`;
      bar.insertBefore(t, fill);
    });
  }

  function viewSpan(): { top: number; bottom: number } {
    const r = wrap.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  }

  function reset(): void {
    answer(false);
    pictures?.dispose();
    pictures = null;
    highlights?.registry.delete(LONG_TEXT_MARK);
    article.replaceChildren();
    index = { sentences: [], paragraphs: 0, paragraphStarts: [] };
    current = -1;
  }

  function show(content: LongTextSheetContent): void {
    reset();
    const lang = content.lang ?? "en";
    over.textContent = content.over;
    over.hidden = content.over === "";
    title.textContent = content.title === "" ? "Untitled" : content.title;
    meta.textContent = sheetMeta(wordCount(content.body));
    article.lang = lang;
    const rendered = renderLongText(parseTourMarkdown(content.body), {
      document: doc,
      onLinkTap: guard,
    });
    article.appendChild(rendered.fragment);
    index = indexSentences(
      article,
      new Set<Element>(rendered.pictures.map((p) => p.holder)),
      lang,
    );
    current = index.sentences.length === 0 ? -1 : 0;
    ticks();
    sheet.hidden = false;
    open = true;
    wrap.scrollTop = 0;
    paint(false);
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
  prev.addEventListener("click", () => {
    goTo(current - 1);
  });
  next.addEventListener("click", () => {
    goTo(current + 1);
  });
  bar.addEventListener("click", (event) => {
    const r = bar.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const f = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
    goTo(f * (index.sentences.length - 1));
  });
  bar.addEventListener("keydown", (event) => {
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
  });
  // A tap on a sentence keeps the place there (not on a link: it opens).
  article.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a") !== null) {
      return;
    }
    const at = (deps.caretAt ?? ((x, y) => browserCaretAt(doc, x, y)))(
      event.clientX,
      event.clientY,
    );
    if (at === null) return;
    const i = sentenceAt(index, at.node, at.offset);
    if (i !== null) goTo(i, false);
  });

  return {
    element: sheet,
    show,
    close: closeSheet,
    isOpen: () => open,
    goTo: (i) => {
      goTo(i);
    },
    state: () => ({
      open,
      title: title.textContent,
      sentence: current,
      sentences: index.sentences.length,
      paragraph: index.sentences[current]?.paragraph ?? -1,
      paragraphs: index.paragraphs,
      marked: open && current >= 0 && highlights !== null,
    }),
    dispose() {
      closeSheet();
      sheet.remove();
    },
  };
}
