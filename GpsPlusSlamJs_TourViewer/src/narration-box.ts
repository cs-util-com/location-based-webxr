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
  followScroll,
  isTap,
  lineFloatAt,
  lineIndices,
  lineStarts,
  rubberBand,
  thumbGeometry,
  timeAtLine,
  wordAt,
  wordStartsMs,
} from "./narration-box-timeline.js";
import type { NarrationClock } from "./narration-player.js";

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
}

export interface NarrationBox {
  readonly element: HTMLElement;
  /** The side places for a step's action (empty and hidden for now). */
  readonly slots: { readonly left: HTMLElement; readonly right: HTMLElement };
  /** Shows `content` (cheap for the same content: every frame may call). */
  show(content: NarrationBoxContent): void;
  hide(): void;
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
/** How long a tap sign may stay if its animation never ends (ms). */
const TAP_SIGN_MS = 1500;

interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly s0: number;
  readonly line0: number;
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
  mid.append(winEl);
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
    who.textContent = c.speaker.name;
    who.style.color = c.speaker.color;
    whoEl = who;
    const said = disclosure(c);
    const disc = said === "" ? null : doc.createElement("span");
    if (disc !== null) {
      disc.className = "nb-disc";
      disc.dataset.testid = "narration-box-disclosure";
      disc.textContent = said;
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
    const boxMax = Math.min(viewW * BOX_SHARE, BOX_CAP_PX);
    const natural = measure.getBoundingClientRect().width;
    const slotW = slotR.getBoundingClientRect().width;
    const room = Math.max(TEXT_MIN_PX, boxMax - BOX_CHROME_PX - slotW);
    const textW = Math.floor(
      Math.min(room, Math.max(TEXT_MIN_PX, natural + 2)),
    );
    col.style.width = `${String(textW)}px`;
    mid.style.width = `${String(textW + 12)}px`;
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
    // Whoever carried the voice on (the page's sound gate at a return),
    // the finger still holds it.
    if (dragging && resume && c.player.playing()) holdVoice(c.player);
    // A drag holds the voice for the finger only: it still counts as
    // playing, so neither the store nor a screen reader hears of it.
    const playing = dragging ? resume : c.player.playing();
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

  const onDown = (e: PointerEvent): void => {
    if (!shown || content === null || press !== null) return;
    if ((e.target as Element | null)?.closest?.("button") != null) return;
    const ms = content.player.nowMs();
    press = {
      id: pointerIdOf(e),
      x: e.clientX,
      y: e.clientY,
      s0: scroll,
      line0: lineFloatAt(ls, ms),
    };
    if (typeof root.setPointerCapture === "function") {
      try {
        root.setPointerCapture(pointerIdOf(e));
      } catch {
        // A pointer that is already gone: the press still works without.
      }
    }
  };
  const onMove = (e: PointerEvent): void => {
    const c = content;
    if (press === null || c === null || pointerIdOf(e) !== press.id) return;
    const dy = press.y - e.clientY; // finger up, text up: ahead
    if (!dragging && !isTap(e.clientX - press.x, dy)) startDrag(c);
    if (!dragging) return;
    const moved = dy / lh;
    dragMs = timeAtLine(ls, press.line0 + moved);
    scroll = rubberBand(press.s0 + moved, Math.max(0, lines - rows));
    tick();
  };
  const onUp = (e: PointerEvent): void => {
    const c = content;
    if (press === null || pointerIdOf(e) !== press.id) return;
    press = null;
    if (c === null) return;
    if (dragging) {
      endDrag(c);
      return;
    }
    if (e.type === "pointercancel") return;
    toggle(e.clientX, e.clientY);
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
  root.addEventListener("keydown", onKey);
  win?.addEventListener("resize", onResize);

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
    show(next) {
      const same =
        content !== null &&
        content.key === next.key &&
        content.timing === next.timing &&
        content.plain === next.plain &&
        content.speaker.name === next.speaker.name &&
        content.speaker.color === next.speaker.color;
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
      };
    },
    dispose() {
      cancelDrag();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("keydown", onKey);
      win?.removeEventListener("resize", onResize);
      for (const fx of signs) fx.remove();
      signs.clear();
      root.remove();
      if (shown) deps.store.dispatch(narrationBoxHidden());
      shown = false;
      content = null;
    },
  };
}
