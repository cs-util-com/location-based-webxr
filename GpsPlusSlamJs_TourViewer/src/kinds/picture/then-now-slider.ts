/**
 * Then and now's slider: the panel a visitor lined up with the viewpoint
 * gets on the page's screen (`WorldScreen`). The picture's year and first
 * sentence, a switch between two ways to compare, and the control of the
 * chosen one: Fade, a slider from today to then, the old picture's share
 * (the part moves it while the fade-in runs; once the visitor moves it,
 * the visitor's value holds, `then-now-fade.ts`); Swipe, a line across
 * the whole screen with a knob, the old picture left of it and today
 * right of it (`then-now-swipe.ts`).
 *
 * @see then-now-slider.ts.md
 */
import {
  clampSwipeSplit,
  swipeSplitAt,
  SWIPE_SPLIT_MAX,
  SWIPE_SPLIT_MIN,
} from "./then-now-swipe.js";
import "./then-now-slider.css";

/** What the panel shows beside the slider. */
export interface ThenNowSliderContent {
  readonly year?: string | undefined;
  readonly caption?: string | undefined;
}

/** The two ways to compare, in the switch's order. */
export type ThenNowMode = "swipe" | "fade";
const MODES: readonly { readonly mode: ThenNowMode; readonly label: string }[] =
  [
    { mode: "swipe", label: "Swipe" },
    { mode: "fade", label: "Fade" },
  ];

/** Where the panel starts: the way to compare, the old picture's share
 *  (0 to 1) and the line's place (a share of the screen's width). */
export interface ThenNowSliderStart {
  readonly mode: ThenNowMode;
  readonly fade: number;
  readonly split: number;
}

/** What the part hears of the visitor's moves. */
export interface ThenNowSliderListeners {
  readonly fade: (fade: number) => void;
  readonly mode: (mode: ThenNowMode) => void;
  readonly split: (split: number) => void;
}

/** The slider's steps: a share in hundredths. */
const STEPS = 100;
/** How far an arrow key moves the line (a share of the width). */
const KEY_STEP = 0.05;
/** The caption's first sentence, cut at about two lines. */
const FIRST_SENTENCE_MAX = 110;
const SWIPE_HINT = "Drag the line to compare";

/** The caption's first sentence, cut at a word within the limit. */
export function firstSentence(text: string | undefined): string {
  const first = (text ?? "").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (first.length <= FIRST_SENTENCE_MAX) return first;
  return `${first.slice(0, FIRST_SENTENCE_MAX - 2).replace(/\s+\S*$/, "")}…`;
}

const percent = (share: number): string => String(Math.round(share * 100));

/** How far a key moves the line: arrows a step, Home and End all the way. */
function keyStep(key: string): number {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return -KEY_STEP;
    case "ArrowRight":
    case "ArrowUp":
      return KEY_STEP;
    case "Home":
      return -1;
    case "End":
      return 1;
    default:
      return 0;
  }
}

/** The line across the screen and its knob; `place` moves it. */
function buildSwipeLine(
  doc: Document,
  year: string,
  moved: (split: number) => void,
): {
  readonly layer: HTMLElement;
  readonly place: (split: number) => void;
  readonly dispose: () => void;
} {
  const layer = doc.createElement("div");
  layer.className = "then-now-swipe";
  const line = doc.createElement("div");
  line.className = "then-now-swipe-line";
  const thenLabel = doc.createElement("span");
  thenLabel.className = "then-now-swipe-label then-now-swipe-then";
  thenLabel.textContent = year === "" ? "Then" : year;
  const nowLabel = doc.createElement("span");
  nowLabel.className = "then-now-swipe-label then-now-swipe-now";
  nowLabel.textContent = "Today";
  line.append(thenLabel, nowLabel);
  const knob = doc.createElement("div");
  knob.className = "then-now-swipe-knob";
  knob.tabIndex = 0;
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-label", "Line between then and today");
  knob.setAttribute("aria-valuemin", percent(SWIPE_SPLIT_MIN));
  knob.setAttribute("aria-valuemax", percent(SWIPE_SPLIT_MAX));
  knob.setAttribute("aria-orientation", "horizontal");
  // The chosen page's arrows, left and right.
  const svgNs = "http://www.w3.org/2000/svg";
  const arrows = doc.createElementNS(svgNs, "svg");
  arrows.setAttribute("viewBox", "0 0 24 24");
  arrows.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(svgNs, "path");
  path.setAttribute("d", "M9 7l-5 5 5 5M15 7l5 5-5 5");
  arrows.append(path);
  knob.append(arrows);
  layer.append(line, knob);

  let split = clampSwipeSplit(Number.NaN);
  const place = (value: number): void => {
    split = clampSwipeSplit(value);
    const left = `${String(split * 100)}%`;
    line.style.left = left;
    knob.style.left = left;
    knob.setAttribute("aria-valuenow", percent(split));
    knob.setAttribute("aria-valuetext", `${percent(split)} % then`);
  };
  const move = (value: number): void => {
    place(value);
    moved(split);
  };

  // The knob holds the pointer it was pressed with, so a drag past it
  // keeps moving the line and never reaches the world below.
  let dragging: number | null = null;
  const onDown = (e: PointerEvent): void => {
    dragging = e.pointerId;
    knob.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e: PointerEvent): void => {
    if (dragging !== e.pointerId) return;
    const box = layer.getBoundingClientRect();
    move(swipeSplitAt(e.clientX, box.left, box.width));
  };
  const onEnd = (e: PointerEvent): void => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    if (knob.hasPointerCapture(e.pointerId)) {
      knob.releasePointerCapture(e.pointerId);
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    const step = keyStep(e.key);
    if (step === 0) return;
    e.preventDefault();
    move(split + step);
  };
  knob.addEventListener("pointerdown", onDown);
  knob.addEventListener("pointermove", onMove);
  knob.addEventListener("pointerup", onEnd);
  knob.addEventListener("pointercancel", onEnd);
  knob.addEventListener("lostpointercapture", onEnd);
  knob.addEventListener("keydown", onKey);
  return {
    layer,
    place,
    dispose() {
      knob.removeEventListener("pointerdown", onDown);
      knob.removeEventListener("pointermove", onMove);
      knob.removeEventListener("pointerup", onEnd);
      knob.removeEventListener("pointercancel", onEnd);
      knob.removeEventListener("lostpointercapture", onEnd);
      knob.removeEventListener("keydown", onKey);
      layer.remove();
    },
  };
}

/**
 * Builds the panel into `host` from `start`. `heard` hears the visitor's
 * moves (the fade, the way to compare, the line); `set` moves the fade
 * from the part (not heard back); `dispose` is the screen's clean-up.
 */
export function buildThenNowSlider(
  host: HTMLElement,
  content: ThenNowSliderContent,
  start: ThenNowSliderStart,
  heard: ThenNowSliderListeners,
): { readonly set: (fade: number) => void; readonly dispose: () => void } {
  const doc = host.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "then-now-slider";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Then and now");
  const words = doc.createElement("div");
  words.className = "then-now-words";
  const year = content.year?.trim() ?? "";
  if (year !== "") {
    const y = doc.createElement("span");
    y.className = "then-now-year";
    y.textContent = year;
    words.append(y);
  }
  const line = doc.createElement("span");
  line.className = "then-now-caption";
  line.textContent = firstSentence(content.caption);
  words.append(line);

  const switcher = doc.createElement("div");
  switcher.className = "then-now-modes";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Compare by");
  const buttons = MODES.map(({ mode, label }) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset["mode"] = mode;
    switcher.append(b);
    return b;
  });

  const row = doc.createElement("label");
  row.className = "then-now-row";
  const now = doc.createElement("span");
  now.textContent = "Today";
  const then = doc.createElement("span");
  then.textContent = "Then";
  const input = doc.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = String(STEPS);
  input.step = "1";
  input.setAttribute("aria-label", "Between today and then");
  const show = (value: number): void => {
    const clamped = Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : 0;
    input.value = String(Math.round(clamped * STEPS));
    input.setAttribute("aria-valuetext", `${percent(clamped)} % then`);
  };
  show(start.fade);
  const onInput = (): void => {
    const value = Number(input.value) / STEPS;
    show(value);
    heard.fade(value);
  };
  input.addEventListener("input", onInput);
  row.append(now, input, then);

  const hint = doc.createElement("p");
  hint.className = "then-now-hint";
  hint.textContent = SWIPE_HINT;

  const swipe = buildSwipeLine(doc, year, heard.split);
  swipe.place(start.split);

  const choose = (mode: ThenNowMode): void => {
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(b.dataset["mode"] === mode));
    }
    const swiping = mode === "swipe";
    row.hidden = swiping;
    hint.hidden = !swiping;
    swipe.layer.hidden = !swiping;
  };
  choose(start.mode === "swipe" ? "swipe" : "fade");
  const onSwitch = (e: Event): void => {
    const target = e.target instanceof Element ? e.target : null;
    const chosen = target?.closest("button")?.dataset["mode"];
    const mode = MODES.find((m) => m.mode === chosen)?.mode;
    if (mode === undefined) return;
    choose(mode);
    heard.mode(mode);
  };
  switcher.addEventListener("click", onSwitch);

  panel.append(words, switcher, row, hint);
  // The line first, so the panel draws over it.
  host.append(swipe.layer, panel);
  return {
    set(value) {
      // The visitor's thumb is not moved under them.
      if (doc.activeElement !== input) show(value);
    },
    dispose() {
      input.removeEventListener("input", onInput);
      switcher.removeEventListener("click", onSwitch);
      swipe.dispose();
      panel.remove();
    },
  };
}
