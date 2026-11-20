/**
 * The splat trainer page, as a module that mounts into any element: the
 * "darkroom" look - a contact sheet with one print per stretch of the
 * walk that develops while it trains, a quiet bar at the bottom, and
 * dialogs for stopping, saving and a closer look. It renders from the
 * page's store (`trainer-page-store.ts`) and dispatches what the person
 * does; it holds no state of the run itself, only which dialog is open.
 *
 * @see trainer-page.ts.md
 */

import "./trainer-page.css";

import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";
import { escapeHtml as esc } from "gps-plus-slam-app-framework/utils/escape-html";
import { ZIP_FILE_TYPE } from "gps-plus-slam-app-framework/storage";
import {
  pickSaveFile,
  type SaveFilePick,
  type SavePickerWindow,
} from "gps-plus-slam-app-framework/storage/save-target";
import type { UnknownAction } from "@reduxjs/toolkit";

import { mulberry32 } from "gps-plus-slam-app-framework/utils/mulberry32";

import type { Verdict } from "./trainer-adapter.js";
import { packageFileName } from "./save-package.js";
import {
  canTrainAgain,
  currentWindow,
  finishedWindows,
  secondsLeftInRun,
  stretchNo,
  trainerPageActions as A,
  type TrainerPageState,
  undecidedWindows,
  verdictCounts,
  type WindowState,
  windowsInFile,
} from "./trainer-page-slice.js";
import type { TrainerSideTables } from "./trainer-page-store.js";

const VERDICT_WORD: Readonly<Record<Verdict, string>> = {
  good: "Good",
  weak: "Weak",
  poor: "Not good enough",
};

/** The class every rule of `trainer-page.css` is scoped under. */
const PAGE_CLASS = "splat-page";

const LOCK =
  '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';

const ART = {
  monitor:
    '<svg viewBox="0 0 120 84"><rect x="20" y="8" width="80" height="52" rx="4"/><path d="M50 72h20M60 60v12"/><path class="cross" d="M48 22l24 24M72 22L48 46"/></svg>',
  phone:
    '<svg viewBox="0 0 120 84"><rect x="6" y="14" width="30" height="56" rx="5"/><path class="cross" d="M12 34l18 18M30 34L12 52"/><path d="M44 42h18m-6-6 6 6-6 6"/><rect x="70" y="18" width="46" height="32" rx="3"/><path d="M86 62h14M93 50v12"/><path class="tick" d="M84 34l6 6 12-12"/></svg>',
  file: '<svg viewBox="0 0 120 84"><path d="M38 6h32l16 16v56H38z"/><path d="M70 6v16h16"/><path class="cross" d="M50 38l20 20M70 38L50 58"/></svg>',
} as const;

const PAGE_HTML = `
<div class="app" data-ref="app">
  <header class="top">
    <div class="top-title">
      <h1>Make a splat</h1>
      <span class="chip" data-ref="modeChip" data-tone="warn" hidden>Practice run</span>
      <span class="chip" data-ref="fileChip" hidden></span>
      <span class="chip" data-ref="gpuChip" hidden></span>
    </div>
    <p class="top-local">${LOCK} Everything happens on this computer. Nothing is uploaded.</p>
  </header>
  <main class="main">
    <section class="drop" data-ref="drop" hidden>
      <div class="drop-sheet" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="drop-card">
        <h2 class="drop-head">Drop a recording here</h2>
        <p class="prose">The zip file the recorder app saved on your phone. It is read here, on this computer, and never uploaded.</p>
        <button type="button" class="btn btn--accent" data-ref="chooseBtn">Choose recording</button>
        <input type="file" accept=".zip,application/zip" data-ref="fileInput" hidden />
        <p class="hint hint--dim" data-ref="readLine" role="status" hidden></p>
      </div>
    </section>
    <section class="census" data-ref="census" hidden>
      <div class="warn-card" data-ref="gpuWarn" hidden>
        <h2 class="warn-head">This computer seems to use its built-in graphics</h2>
        <p class="prose">Built-in graphics are much slower for this. If the computer also has a graphics card, Windows can give it to the browser:</p>
        <ol class="prose steps">
          <li>Open <strong>Settings</strong>, then System, Display, Graphics.</li>
          <li>Pick your browser in the list and choose <strong>High performance</strong>.</li>
          <li>Close the browser completely and open this page again.</li>
        </ol>
        <div class="row">
          <button type="button" class="btn" data-ref="gpuRecheck">Check again</button>
          <button type="button" class="btn btn--quiet" data-ref="gpuAnyway">Use the built-in graphics anyway</button>
        </div>
        <p class="hint hint--dim" data-ref="gpuRecheckLine" role="status"></p>
      </div>
      <article class="census-card">
        <div data-ref="censusLead"></div>
        <p class="census-local">${LOCK} The recording is read here, on this computer. Nothing is uploaded.</p>
        <p class="census-note prose" data-ref="unavailable" hidden><strong>The splat maker is not ready yet.</strong> This page can already read a recording and show how it would be made, but it cannot make the splat itself yet.</p>
        <div class="census-actions">
          <button type="button" class="btn btn--accent" data-ref="startBtn">Make the splat</button>
          <button type="button" class="btn btn--quiet" data-ref="otherBtn">Choose another recording</button>
        </div>
      </article>
    </section>
    <p class="banner" data-ref="banner" role="status" hidden></p>
    <section class="sheet" data-ref="sheet" aria-label="Stretches of the walk" hidden></section>
    <section class="refusal" data-ref="refusal" hidden>
      <div class="refusal-card">
        <div class="refusal-art" data-ref="refusalArt" aria-hidden="true"></div>
        <h2 class="refusal-head" data-ref="refusalHead"></h2>
        <div class="refusal-body" data-ref="refusalBody"></div>
        <div class="refusal-actions" data-ref="refusalActions"></div>
      </div>
    </section>
  </main>
  <footer class="bar" data-ref="bar" hidden>
    <div class="bar-strip" data-ref="strip" aria-hidden="true"></div>
    <div class="bar-text">
      <p class="bar-line" data-ref="barLine" role="status" aria-live="polite"></p>
      <p class="bar-sub hint hint--dim" data-ref="barSub"></p>
    </div>
    <div class="bar-actions">
      <button type="button" class="btn btn--quiet" data-ref="showBtn" hidden></button>
      <button type="button" class="btn btn--quiet" data-ref="stopBtn" hidden>Stop</button>
      <button type="button" class="btn" data-ref="continueBtn" hidden>Continue</button>
      <button type="button" class="btn" data-ref="saveBtn" hidden>Save</button>
    </div>
  </footer>
</div>
<div class="veil" data-ref="veil" hidden>
  <div class="modal" data-ref="modal" role="dialog" aria-modal="true" aria-labelledby="splat-modal-head"></div>
</div>`;

interface Refusal {
  readonly art: keyof typeof ART;
  readonly head: string;
  readonly body: readonly string[];
  readonly action: "copy" | "again";
}

function refusalOf(s: TrainerPageState): Refusal | null {
  const r = s.refusal;
  if (r === null) return null;
  if (r.kind === "phone") {
    return {
      art: "phone",
      head: "Use a desktop computer",
      body: [
        "Making a splat keeps a graphics card busy for a long time. A phone cannot do that, so this page only works on a desktop computer with Chrome or Edge.",
        "Copy the recording from your phone to the computer, then open this page there.",
      ],
      action: "copy",
    };
  }
  if (r.kind === "no-webgpu") {
    return {
      art: "monitor",
      head: "This browser cannot make splats",
      body: [
        "Making a splat uses the graphics card through a feature called WebGPU. This browser does not offer it, or it is switched off.",
        "Open this page in Chrome or Edge on a desktop computer. Your recording stays where it is.",
      ],
      action: "copy",
    };
  }
  const reason = r.reason ?? "The file could not be read as a recording.";
  const noDepth = r.code === "no-depth";
  return {
    art: "file",
    head: noDepth
      ? "This recording has no depth"
      : "This recording cannot be used",
    body: [
      reason,
      noDepth
        ? "Record the place again on a phone that records depth."
        : "Record the place again with the current recorder app.",
    ],
    action: "again",
  };
}

/* ---------- small pure helpers the view and its tests share ---------- */

const metres = (m: number): string => String(Math.round(m));

/** "about 12 min" or "about 2 hours"; empty for a time that is not a
 *  finite, non-negative number of seconds. */
export function minutesText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const min = Math.max(1, Math.round(seconds / 60));
  return min >= 90 ? `about ${Math.round(min / 60)} hours` : `about ${min} min`;
}

/** The census card's sentences, as markup with escaped numbers. */
function censusLeadHtml(s: TrainerPageState): string {
  const c = s.recording?.census;
  if (c === null || c === undefined) return "";
  const n = s.windows.length;
  const every =
    c.medianSpacingM === null
      ? ""
      : `, about one every <strong>${esc(c.medianSpacingM.toFixed(1))} m</strong>`;
  const skipped =
    c.skippedFrames > 0
      ? ` <strong>${c.skippedFrames} ${c.skippedFrames === 1 ? "photo is" : "photos are"}</strong> missing from the file and left out.`
      : "";
  const stretches =
    n === 1
      ? "<strong>one stretch</strong>"
      : `<strong>${n} stretches</strong> of about ${esc(metres(c.pathM / n))} m, one after the other`;
  return `<p class="census-lead">This walk has <strong>${c.frames} photos</strong> over <strong>${esc(metres(c.pathM))} m</strong>${every}. Depth is there.${skipped}</p>
<p class="census-lead">It is made in ${stretches}. You can leave it running, or stop and continue: finished stretches are kept.</p>`;
}

function sayFor(w: WindowState): string {
  if (w.status === "stopped")
    return "Stopped here. This stretch starts over when you continue.";
  if (w.status === "queued")
    return "Waiting to train again, with twice the time.";
  if (w.status !== "done" || w.judgement === null) return "";
  if (w.decision === "keep")
    return `${w.judgement.say} Kept in the file, marked.`;
  if (w.decision === "discard") return "Left out of the file.";
  return w.judgement.say;
}

function stampFor(w: WindowState): string {
  if (w.status === "stopped") return "Stopped - starts over";
  if (w.status === "queued") return "Trains again";
  return w.decision === "discard" ? "Left out" : "";
}

type ActionTone = "accent" | "quiet" | "";
interface PrintAction {
  readonly key: string;
  readonly label: string;
  readonly tone: ActionTone;
}

function actionsFor(w: WindowState): PrintAction[] {
  if (w.status !== "done" || w.judgement === null) return [];
  if (w.decision !== null) return [{ key: "undo", label: "Undo", tone: "" }];
  const again: PrintAction = {
    key: "again",
    label: "Train again with more time",
    tone: "",
  };
  if (w.judgement.verdict === "poor") {
    return [
      { ...again, tone: "accent" },
      { key: "keep", label: "Save anyway, marked", tone: "quiet" },
      { key: "discard", label: "Discard", tone: "quiet" },
    ];
  }
  return canTrainAgain(w) ? [again] : [];
}

/** Bar sentences for a phase; null hides the bar. */
export function barText(s: TrainerPageState): [string, string] | null {
  const total = s.windows.length;
  if (s.phase === "training") {
    const cur = currentWindow(s);
    const line =
      cur === undefined
        ? "Training paused while you decide"
        : `Training stretch ${stretchNo(cur)}${cur.attempt > 1 ? " again" : ""} of ${total}`;
    const left = secondsLeftInRun(s);
    const leftText = left === null ? "" : minutesText(left);
    const est =
      leftText === ""
        ? "Measuring how fast this computer is..."
        : `${leftText} left.`;
    return [
      line,
      `${est} You can leave it running, or stop: finished stretches are kept.`,
    ];
  }
  if (s.phase === "stopped") {
    const done = finishedWindows(s).length;
    const next = s.windows.find((w) => w.id === s.queue[0]);
    const cont =
      next === undefined
        ? ""
        : `Continue starts at stretch ${stretchNo(next)}.`;
    const saved = s.save.savedCount ?? 0;
    return [
      `Stopped. ${done} of ${total} stretches ${done === 1 ? "is" : "are"} finished and kept while this page stays open.`,
      s.save.status === "saved"
        ? `Saved: ${saved} ${saved === 1 ? "stretch is" : "stretches are"} in the file.${cont === "" ? "" : ` ${cont}`}`
        : cont,
    ];
  }
  if (s.phase !== "done") return null;
  const inFile = windowsInFile(s).length;
  if (s.save.status === "saved") {
    return [
      `Saved. ${s.save.savedCount ?? inFile} ${(s.save.savedCount ?? inFile) === 1 ? "stretch is" : "stretches are"} in the file.`,
      s.trainer === "practice"
        ? "This practice run saved a placeholder file: it holds no splat yet."
        : "Open it in the tour editor by dropping it onto the globe.",
    ];
  }
  const c = verdictCounts(s);
  const parts = [`${c.good} good`];
  if (c.weak > 0) parts.push(`${c.weak} weak`);
  if (c.poor > 0) parts.push(`${c.poor} not good enough`);
  const open = undecidedWindows(s);
  const sub =
    open.length > 0
      ? `Stretch ${open.map(stretchNo).join(", ")} ${open.length === 1 ? "is" : "are"} not good enough: train it again, keep it marked, or discard it. Then save.`
      : `Ready to save: ${inFile} ${inFile === 1 ? "stretch goes" : "stretches go"} into the file.`;
  return [parts.join(", "), sub];
}

function saveContentsLine(s: TrainerPageState): string {
  const files = windowsInFile(s);
  const weak = files.filter((w) => w.judgement?.verdict === "weak").length;
  const poor = files.filter((w) => w.judgement?.verdict === "poor").length;
  const marks: string[] = [];
  if (weak > 0) marks.push(`${weak} marked weak`);
  if (poor > 0) marks.push(`${poor} marked not good enough`);
  let line = `The file holds ${files.length} ${files.length === 1 ? "stretch" : "stretches"}`;
  line +=
    marks.length > 0
      ? `: ${marks.join(", ")}.`
      : files.length > 0
        ? ", all good."
        : ".";
  const open = undecidedWindows(s);
  if (open.length > 0) {
    line += ` Stretch ${open.map(stretchNo).join(", ")} is left out unless you choose "Save anyway, marked" on its print.`;
  }
  return line;
}

/** The stop dialog's sentence, from the live state of the stretch it is for. */
function stopDialogText(s: TrainerPageState): string {
  const w = s.windows.find((x) => x.id === s.stopDialog);
  const kept = finishedWindows(s).length;
  const keptText = `The ${kept} finished ${kept === 1 ? "stretch stays" : "stretches stay"} on this computer.`;
  if (w === undefined) return keptText;
  if (w.status === "done") {
    return `${keptText} Stretch ${stretchNo(w)} has just finished and is kept. The next stretch waits until you choose.`;
  }
  return `${keptText} Stretch ${stretchNo(w)} is ${Math.floor(w.progress * 100)} % done and starts over when you continue.`;
}

/** Started stretches the loupe can show: never one that has not started. */
const showable = (w: WindowState): boolean => w.status !== "waiting";

export function loupeWord(w: WindowState): string {
  if (w.status === "done" && w.judgement !== null)
    return VERDICT_WORD[w.judgement.verdict];
  if (w.status === "training") return "Still training";
  if (w.status === "stopped") return "Stopped";
  return "Waiting";
}

/* ---------- the walk sketch and the hand-drawn ring ---------- */

function walkPoint(t: number): [number, number] {
  return [
    4 + 46 * t + 3 * Math.sin(t * 9),
    13 + 7 * Math.sin(t * 5.3) + 3 * Math.cos(t * 13),
  ];
}

function walkPath(a: number, b: number): string {
  const pts: string[] = [];
  for (let n = 0; n <= 40; n++) {
    const [x, y] = walkPoint(a + ((b - a) * n) / 40);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

function ringPath(seed: number): string {
  const r = mulberry32(seed * 31 + 3);
  const j = (): string => ((r() - 0.5) * 6).toFixed(2);
  const p = (x: number, y: number): string =>
    `${x + Number(j())} ${y + Number(j())}`;
  return `M ${p(8, 14)} C ${p(40, 4)}, ${p(260, 2)}, ${p(292, 12)} C ${p(300, 60)}, ${p(298, 150)}, ${p(288, 190)} C ${p(220, 198)}, ${p(60, 197)}, ${p(10, 188)} C ${p(3, 140)}, ${p(4, 50)}, ${p(14, 8)}`;
}

/* ---------- mounting ---------- */

export interface PageEnvironment {
  /** The window the page lives in (clipboard, save dialog, location). */
  readonly win: Window & SavePickerWindow;
  /** True on a phone-sized screen: the page refuses. */
  readonly isPhone: boolean;
}

/** What the page needs of its store (`createTrainerPageStore` provides it). */
export interface PageController {
  readonly store: {
    getState(): TrainerPageState;
    dispatch(action: UnknownAction): unknown;
    subscribe(listener: () => void): () => void;
  };
  readonly sides: Pick<TrainerSideTables, "previews">;
  chooseRecording(file: File): void;
  save(pick: Promise<SaveFilePick>): Promise<void>;
}

export interface MountedTrainerPage {
  dispose(): void;
}

type Modal =
  | { readonly kind: "stop" }
  | { readonly kind: "save" }
  | { readonly kind: "loupe"; readonly id: string };

export function mountSplatTrainerPage(
  root: HTMLElement,
  controller: PageController,
  env: PageEnvironment,
): MountedTrainerPage {
  const { store, sides } = controller;
  const doc = root.ownerDocument;
  root.classList.add(PAGE_CLASS);
  root.innerHTML = PAGE_HTML;
  const ref = <T extends HTMLElement = HTMLElement>(name: string): T => {
    const el = root.querySelector<T>(`[data-ref="${name}"]`);
    if (el === null) throw new Error(`splat trainer page: no ${name}`);
    return el;
  };
  const els = {
    modeChip: ref("modeChip"),
    fileChip: ref("fileChip"),
    gpuChip: ref("gpuChip"),
    drop: ref("drop"),
    chooseBtn: ref<HTMLButtonElement>("chooseBtn"),
    fileInput: ref<HTMLInputElement>("fileInput"),
    readLine: ref("readLine"),
    census: ref("census"),
    gpuWarn: ref("gpuWarn"),
    gpuRecheck: ref<HTMLButtonElement>("gpuRecheck"),
    gpuRecheckLine: ref("gpuRecheckLine"),
    gpuAnyway: ref<HTMLButtonElement>("gpuAnyway"),
    censusLead: ref("censusLead"),
    unavailable: ref("unavailable"),
    startBtn: ref<HTMLButtonElement>("startBtn"),
    otherBtn: ref<HTMLButtonElement>("otherBtn"),
    banner: ref("banner"),
    sheet: ref("sheet"),
    refusal: ref("refusal"),
    refusalArt: ref("refusalArt"),
    refusalHead: ref("refusalHead"),
    refusalBody: ref("refusalBody"),
    refusalActions: ref("refusalActions"),
    bar: ref("bar"),
    strip: ref("strip"),
    barLine: ref("barLine"),
    barSub: ref("barSub"),
    showBtn: ref<HTMLButtonElement>("showBtn"),
    stopBtn: ref<HTMLButtonElement>("stopBtn"),
    continueBtn: ref<HTMLButtonElement>("continueBtn"),
    saveBtn: ref<HTMLButtonElement>("saveBtn"),
    veil: ref("veil"),
    modal: ref("modal"),
  };

  const app = ref("app");
  let modal: Modal | null = null;
  /** Where the focus was before the open dialog; it goes back there. */
  let returnFocus: HTMLElement | null = null;
  let restoreFocus = false;
  let modalBuiltFor: string | null = null;
  let sheetBuiltFor: string | null = null;
  let refusalBuiltFor: string | null = null;
  const drawn = new Map<string, CanvasImageSource | null>();
  const flashTimers = new Set<number>();
  const disposers: (() => void)[] = [];

  const on = <K extends keyof HTMLElementEventMap>(
    el: EventTarget,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void => {
    el.addEventListener(type, fn as EventListener);
    disposers.push(() => el.removeEventListener(type, fn as EventListener));
  };

  const setText = (el: HTMLElement, text: string): void => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setData = (
    el: HTMLElement,
    key: string,
    value: string | null,
  ): void => {
    if (value === null) delete el.dataset[key];
    else if (el.dataset[key] !== value) el.dataset[key] = value;
  };
  const paper = (): string =>
    doc.defaultView
      ?.getComputedStyle(root)
      .getPropertyValue("--print-paper")
      .trim() || "#2c3142";

  /* ----- pictures ----- */

  function paint(
    canvas: HTMLCanvasElement,
    picture: CanvasImageSource | undefined,
  ): void {
    let g: CanvasRenderingContext2D | null;
    try {
      g = canvas.getContext("2d");
    } catch {
      g = null;
    }
    if (g === null) return;
    g.fillStyle = paper();
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (picture !== undefined)
      g.drawImage(picture, 0, 0, canvas.width, canvas.height);
  }

  /* ----- action buttons that keep the keyboard focus ----- */

  /**
   * Fills `box` with the action buttons, rebuilding them only when the
   * list changed. When the focus was inside `box` (the person just used
   * one of its buttons) it moves to the new list's first button, or to
   * `fallback` when the list is empty - never to the page body.
   */
  function fillActions(
    box: HTMLElement,
    list: readonly PrintAction[],
    id: string,
    fallback: HTMLElement,
  ): void {
    const key = list.map((a) => a.key).join("|");
    if (box.dataset.actions === key) return;
    const hadFocus = box.contains(doc.activeElement);
    box.dataset.actions = key;
    box.textContent = "";
    for (const a of list) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `btn btn--small${a.tone === "" ? "" : ` btn--${a.tone}`}`;
      b.textContent = a.label;
      b.dataset.act = a.key;
      b.dataset.id = id;
      box.append(b);
    }
    if (hadFocus) {
      const first = box.querySelector<HTMLButtonElement>("button");
      (first ?? fallback).focus({ preventScroll: true });
    }
  }

  function fillReasons(box: HTMLElement, w: WindowState): void {
    const reasons =
      w.status === "done" && w.decision !== "discard"
        ? (w.judgement?.reasons ?? [])
        : [];
    const key = reasons.join("|");
    if (box.dataset.reasons === key) return;
    box.dataset.reasons = key;
    box.textContent = "";
    for (const reason of reasons) {
      const span = doc.createElement("span");
      span.className = "reason";
      span.textContent = reason;
      box.append(span);
    }
  }

  function onAction(act: string, id: string): void {
    if (act === "again") store.dispatch(A.trainAgainAsked({ id }));
    else if (act === "keep")
      store.dispatch(A.decided({ id, decision: "keep" }));
    else if (act === "discard")
      store.dispatch(A.decided({ id, decision: "discard" }));
    else if (act === "undo") store.dispatch(A.decided({ id, decision: null }));
  }

  /* ----- the contact sheet ----- */

  function buildSheet(s: TrainerPageState): void {
    const pathM = s.recording?.census?.pathM ?? 0;
    const frac = (m: number): number =>
      pathM > 0 ? Math.min(1, Math.max(0, m / pathM)) : 0;
    els.sheet.textContent = "";
    drawn.clear();
    for (const w of s.windows) {
      const el = doc.createElement("article");
      el.className = "print";
      el.dataset.id = w.id;
      el.innerHTML = `
      <button type="button" class="print-frame" aria-label="Look closer at stretch ${stretchNo(w)}">
        <canvas width="480" height="320"></canvas>
        <span class="print-hatch"></span>
        <svg class="print-ring" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true"><path d="${ringPath(w.index + 1)}" /></svg>
        <span class="print-mark"></span>
        <span class="print-reasons"></span>
        <span class="print-progress"><span></span></span>
        <span class="print-live"><span><span class="print-live-dot"></span><span class="live-pct"></span></span><span class="live-next"></span></span>
        <span class="print-empty">Waiting</span>
        <span class="print-stamp"><span></span></span>
      </button>
      <div class="print-cap">
        <div class="print-head">
          <span class="print-no">Stretch ${stretchNo(w)}</span>
          <span class="print-where">${esc(metres(w.fromM))}-${esc(metres(w.toM))} m</span>
          <svg class="print-path" viewBox="0 0 54 26" aria-hidden="true">
            <polyline class="walk" points="${walkPath(0, 1)}" />
            <polyline class="here" points="${walkPath(frac(w.fromM), frac(w.toM))}" />
          </svg>
        </div>
        <p class="print-say"></p>
        <div class="print-actions"></div>
      </div>`;
      els.sheet.append(el);
    }
  }

  function printOf(id: string): HTMLElement | null {
    for (const el of els.sheet.children) {
      if (el instanceof HTMLElement && el.dataset.id === id) return el;
    }
    return null;
  }

  function renderPrint(el: HTMLElement, w: WindowState): void {
    setData(el, "status", w.status);
    setData(
      el,
      "verdict",
      w.status === "done" ? (w.judgement?.verdict ?? null) : null,
    );
    setData(el, "decision", w.decision);
    const mark = el.querySelector<HTMLElement>(".print-mark");
    if (mark !== null) {
      setText(
        mark,
        w.status === "done" && w.judgement !== null
          ? VERDICT_WORD[w.judgement.verdict] +
              (w.decision === "keep" ? ", marked" : "")
          : "",
      );
    }
    const say = el.querySelector<HTMLElement>(".print-say");
    if (say !== null) setText(say, sayFor(w));
    const stamp = el.querySelector<HTMLElement>(".print-stamp span");
    if (stamp !== null) setText(stamp, stampFor(w));
    const reasons = el.querySelector<HTMLElement>(".print-reasons");
    if (reasons !== null) fillReasons(reasons, w);
    const frame = el.querySelector<HTMLButtonElement>(".print-frame");
    const actions = el.querySelector<HTMLElement>(".print-actions");
    if (actions !== null && frame !== null)
      fillActions(actions, actionsFor(w), w.id, frame);
    const fill = el.querySelector<HTMLElement>(".print-progress span");
    if (fill !== null)
      fill.style.width = `${(w.status === "training" ? w.progress * 100 : 0).toFixed(1)}%`;
    const pct = el.querySelector<HTMLElement>(".live-pct");
    if (pct !== null)
      setText(pct, `Training ${Math.floor(w.progress * 100)} %`);
    const next = el.querySelector<HTMLElement>(".live-next");
    if (next !== null) {
      setText(
        next,
        w.nextPreviewInS === null
          ? ""
          : `new look in ${Math.ceil(w.nextPreviewInS)} s`,
      );
    }
    const picture = sides.previews.get(w.id) ?? null;
    if (drawn.get(w.id) !== picture) {
      drawn.set(w.id, picture);
      const canvas = el.querySelector("canvas");
      if (canvas !== null) paint(canvas, picture ?? undefined);
    }
  }

  function renderStrip(s: TrainerPageState): void {
    if (els.strip.children.length !== s.windows.length) {
      els.strip.textContent = "";
      for (const w of s.windows) {
        const seg = doc.createElement("div");
        seg.className = "seg";
        seg.style.flex = String(Math.max(0.01, w.toM - w.fromM));
        seg.append(doc.createElement("span"));
        els.strip.append(seg);
      }
    }
    s.windows.forEach((w, i) => {
      const seg = els.strip.children[i] as HTMLElement | undefined;
      if (seg === undefined) return;
      setData(
        seg,
        "v",
        w.decision === "discard"
          ? "discard"
          : w.status === "done"
            ? (w.judgement?.verdict ?? null)
            : null,
      );
      const fill = seg.firstElementChild as HTMLElement | null;
      if (fill !== null)
        fill.style.width =
          w.status === "training" ? `${w.progress * 100}%` : "0";
    });
  }

  /* ----- refusals ----- */

  function renderRefusal(s: TrainerPageState): void {
    const r = refusalOf(s);
    const key = r === null ? null : `${r.head}|${r.body.join("|")}`;
    if (r === null || refusalBuiltFor === key) return;
    refusalBuiltFor = key;
    els.refusalArt.innerHTML = ART[r.art];
    setText(els.refusalHead, r.head);
    els.refusalBody.innerHTML = r.body.map((t) => `<p>${esc(t)}</p>`).join("");
    els.refusalActions.textContent = "";
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "btn btn--accent";
    b.textContent =
      r.action === "copy"
        ? "Copy this page's link"
        : "Choose another recording";
    b.dataset.refusal = r.action;
    els.refusalActions.append(b);
  }

  /* ----- dialogs ----- */

  /** Not hidden by any ancestor: a place the focus can stay. */
  const shown = (el: Element): boolean =>
    root.contains(el) && el.closest("[hidden]") === null;

  /** The current phase's main action, where the focus goes when the
   *  element that had it is gone: the first visible, enabled one. */
  function focusPhaseAction(): void {
    const candidates: (HTMLElement | null)[] = [
      els.stopBtn,
      els.continueBtn,
      els.saveBtn,
      els.showBtn,
      els.startBtn,
      els.chooseBtn,
      els.refusalActions.querySelector<HTMLElement>("button"),
    ];
    const target = candidates.find(
      (el): el is HTMLElement =>
        el !== null &&
        shown(el) &&
        !(el instanceof HTMLButtonElement && el.disabled),
    );
    if (target !== undefined) {
      target.focus({ preventScroll: true });
      return;
    }
    const head = root.querySelector<HTMLElement>("h1");
    if (head !== null) {
      head.tabIndex = -1;
      head.focus({ preventScroll: true });
    }
  }

  /** True while a save is being written: its dialog cannot be closed. */
  const saveLocked = (): boolean =>
    modal?.kind === "save" && store.getState().save.status === "saving";

  function openModal(next: Modal): void {
    if (modal === null) {
      const active = doc.activeElement;
      returnFocus = active instanceof HTMLElement ? active : null;
      app.setAttribute("inert", "");
    }
    modal = next;
    modalBuiltFor = null;
    render();
  }

  /** Takes the dialog down without rendering; the next render gives the
   *  focus back to where it was before the dialog opened. */
  function hideModal(): void {
    modal = null;
    modalBuiltFor = null;
    els.veil.hidden = true;
    els.modal.textContent = "";
    delete els.modal.dataset.wide;
    app.removeAttribute("inert");
    restoreFocus = true;
  }

  function closeModal(): void {
    if (saveLocked()) return;
    if (modal?.kind === "stop") store.dispatch(A.stopDismissed());
    hideModal();
    render();
  }

  /** After a dialog closed, or when the focused element was hidden by a
   *  phase change: never leave the focus on the body or on a hidden
   *  button. */
  function settleFocus(): void {
    if (modal !== null) return;
    if (restoreFocus) {
      restoreFocus = false;
      const back = returnFocus;
      returnFocus = null;
      if (back !== null && shown(back)) back.focus({ preventScroll: true });
      else focusPhaseAction();
      return;
    }
    const active = doc.activeElement;
    if (
      active instanceof HTMLElement &&
      root.contains(active) &&
      !shown(active)
    )
      focusPhaseAction();
  }

  function focusFirst(): void {
    const first =
      els.modal.querySelector<HTMLElement>("[data-focus]") ??
      els.modal.querySelector<HTMLElement>("button");
    first?.focus();
  }

  function renderStopModal(s: TrainerPageState): void {
    if (s.stopDialog === null) {
      // The dialog's stretch is gone (the run ended): nothing left to stop.
      hideModal();
      return;
    }
    if (modalBuiltFor !== "stop") {
      modalBuiltFor = "stop";
      els.modal.dataset.wide = "false";
      els.modal.innerHTML = `
        <h2 id="splat-modal-head">Stop training?</h2>
        <p class="prose" data-ref="stopText"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn--quiet" data-act="close" data-focus>Keep training</button>
          <button type="button" class="btn" data-act="stop">Stop</button>
        </div>`;
      els.veil.hidden = false;
      focusFirst();
    }
    const text = els.modal.querySelector<HTMLElement>('[data-ref="stopText"]');
    if (text !== null) setText(text, stopDialogText(s));
  }

  function renderSaveModal(s: TrainerPageState): void {
    if (modalBuiltFor !== "save") {
      modalBuiltFor = "save";
      els.modal.dataset.wide = "false";
      els.modal.innerHTML = `
        <h2 id="splat-modal-head">Save the splat</h2>
        <p class="prose" data-ref="saveContents"></p>
        <div class="modal-privacy">${LOCK}<p class="prose"><strong>The file contains where it was recorded.</strong> Anyone you give it to can see the place. It is saved to your disk only; nothing is uploaded.</p></div>
        <p class="prose hint hint--dim" data-ref="savePractice" hidden>This practice run saves a placeholder file: it holds no splat yet.</p>
        <p class="save-error prose" role="alert" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn btn--quiet" data-act="close">Cancel</button>
          <button type="button" class="btn btn--accent" data-act="save" data-focus>Save to disk</button>
        </div>`;
      els.veil.hidden = false;
      focusFirst();
    }
    const contents = els.modal.querySelector<HTMLElement>(
      '[data-ref="saveContents"]',
    );
    if (contents !== null) setText(contents, saveContentsLine(s));
    const practice = els.modal.querySelector<HTMLElement>(
      '[data-ref="savePractice"]',
    );
    if (practice !== null) practice.hidden = s.trainer !== "practice";
    const err = els.modal.querySelector<HTMLElement>(".save-error");
    const btn = els.modal.querySelector<HTMLButtonElement>('[data-act="save"]');
    const cancel =
      els.modal.querySelector<HTMLButtonElement>('[data-act="close"]');
    if (err === null || btn === null) return;
    const failed = s.save.status === "failed";
    err.hidden = !failed;
    const left = s.save.left === null ? "" : ` ${s.save.left}`;
    setText(
      err,
      failed
        ? `Saving did not work: the disk may be full, or the folder cannot be written to.${left} Try again, or pick another folder.`
        : "",
    );
    const saving = s.save.status === "saving";
    if (cancel !== null) cancel.disabled = saving;
    btn.disabled = saving;
    setData(btn, "busy", saving ? "true" : null);
    setText(btn, saving ? "Saving..." : failed ? "Try again" : "Save to disk");
  }

  function loupeNeighbour(
    s: TrainerPageState,
    id: string,
    dir: -1 | 1,
  ): WindowState | undefined {
    const at = s.windows.findIndex((w) => w.id === id);
    for (let i = at + dir; i >= 0 && i < s.windows.length; i += dir) {
      const w = s.windows[i];
      if (w !== undefined && showable(w)) return w;
    }
    return undefined;
  }

  function renderLoupe(s: TrainerPageState, id: string): void {
    const w = s.windows.find((x) => x.id === id);
    if (w === undefined || !showable(w)) {
      closeModal();
      return;
    }
    if (modalBuiltFor !== `loupe:${id}`) {
      modalBuiltFor = `loupe:${id}`;
      els.modal.dataset.wide = "true";
      els.modal.innerHTML = `
        <div class="loupe">
          <canvas width="1200" height="800" aria-label="Preview of stretch ${stretchNo(w)}"></canvas>
          <div class="loupe-side">
            <h2 id="splat-modal-head">Stretch ${stretchNo(w)} <span class="hint hint--dim">${esc(metres(w.fromM))}-${esc(metres(w.toM))} m</span></h2>
            <p class="print-no loupe-word"></p>
            <p class="prose loupe-say"></p>
            <div class="print-reasons" data-loupe></div>
            <details><summary class="hint">Numbers</summary><div class="numbers"></div></details>
            <div class="print-actions" data-loupe></div>
            <div class="modal-actions">
              <button type="button" class="btn btn--small" data-act="prev">Previous</button>
              <button type="button" class="btn btn--small" data-act="next">Next</button>
              <button type="button" class="btn btn--small" data-act="close" data-focus>Close</button>
            </div>
          </div>
        </div>`;
      els.veil.hidden = false;
      drawn.delete(`loupe:${id}`);
      focusFirst();
    }
    setData(
      els.modal,
      "verdict",
      w.status === "done" ? (w.judgement?.verdict ?? null) : null,
    );
    const word = els.modal.querySelector<HTMLElement>(".loupe-word");
    if (word !== null) setText(word, loupeWord(w));
    const say = els.modal.querySelector<HTMLElement>(".loupe-say");
    if (say !== null)
      setText(
        say,
        sayFor(w) ||
          "This is the newest look. It gets sharper while it trains.",
      );
    const reasons = els.modal.querySelector<HTMLElement>(
      ".print-reasons[data-loupe]",
    );
    if (reasons !== null) fillReasons(reasons, w);
    const close = els.modal.querySelector<HTMLElement>('[data-act="close"]');
    const actions = els.modal.querySelector<HTMLElement>(
      ".print-actions[data-loupe]",
    );
    if (actions !== null && close !== null)
      fillActions(actions, actionsFor(w), w.id, close);
    const numbers = els.modal.querySelector<HTMLElement>(".numbers");
    if (numbers !== null) {
      const rows: [string, string][] =
        w.status === "done" && w.metrics !== null
          ? [
              [
                "Sharpness at the photos",
                `${w.metrics.atCameraDb.toFixed(1)} dB`,
              ],
              [
                "Sharpness between them",
                w.metrics.heldOutDb === null
                  ? "-"
                  : `${w.metrics.heldOutDb.toFixed(1)} dB`,
              ],
              ["Photos used", String(w.metrics.photosUsed)],
              [
                "Training time",
                w.trainingS === null
                  ? "-"
                  : minutesText(w.trainingS).replace("about ", ""),
              ],
            ]
          : [["Progress", `${Math.floor(w.progress * 100)} %`]];
      const html = rows
        .map(
          ([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`,
        )
        .join("");
      if (numbers.innerHTML !== html) numbers.innerHTML = html;
    }
    const prev =
      els.modal.querySelector<HTMLButtonElement>('[data-act="prev"]');
    const next =
      els.modal.querySelector<HTMLButtonElement>('[data-act="next"]');
    if (prev !== null) prev.disabled = loupeNeighbour(s, id, -1) === undefined;
    if (next !== null) next.disabled = loupeNeighbour(s, id, 1) === undefined;
    const picture = sides.previews.get(id) ?? null;
    if (drawn.get(`loupe:${id}`) !== picture) {
      drawn.set(`loupe:${id}`, picture);
      const canvas = els.modal.querySelector("canvas");
      if (canvas !== null) paint(canvas, picture ?? undefined);
    }
  }

  /* ----- the whole page ----- */

  function render(): void {
    const s = store.getState();
    const phase = s.phase;
    els.drop.hidden = !(phase === "start" || phase === "reading");
    els.census.hidden = phase !== "census";
    els.refusal.hidden = phase !== "refused";
    const sheetOn =
      phase === "census" ||
      phase === "training" ||
      phase === "stopped" ||
      phase === "done";
    els.sheet.hidden = !sheetOn;
    setData(els.sheet, "dim", String(phase === "census"));
    els.banner.hidden = s.banner === null;
    setText(els.banner, s.banner ?? "");
    els.modeChip.hidden = s.trainer !== "practice" || phase === "refused";
    els.fileChip.hidden = !sheetOn;
    setText(els.fileChip, s.recording?.name ?? "");
    els.gpuChip.hidden = !sheetOn || s.gpu.status === "probing";
    const integrated = s.gpu.status === "integrated";
    setText(
      els.gpuChip,
      integrated ? "Built-in graphics (slow)" : "Graphics card ready",
    );
    setData(els.gpuChip, "tone", integrated ? "warn" : null);

    const reading = phase === "reading";
    els.chooseBtn.disabled = reading;
    setData(els.chooseBtn, "busy", reading ? "true" : null);
    els.readLine.hidden = !reading;
    setText(
      els.readLine,
      reading ? "Reading the recording on this computer..." : "",
    );

    if (phase === "census") {
      const lead = censusLeadHtml(s);
      if (els.censusLead.innerHTML !== lead) els.censusLead.innerHTML = lead;
      const warn = integrated && !s.gpu.accepted;
      els.gpuWarn.hidden = !warn || s.trainer !== "practice";
      els.unavailable.hidden = s.trainer === "practice";
      els.startBtn.hidden = s.trainer !== "practice";
      els.startBtn.disabled = warn || s.gpu.status === "probing";
      const checking = s.gpu.recheck === "checking";
      els.gpuRecheck.disabled = checking;
      setData(els.gpuRecheck, "busy", checking ? "true" : null);
      if (checking) els.gpuRecheck.setAttribute("aria-busy", "true");
      else els.gpuRecheck.removeAttribute("aria-busy");
      setText(els.gpuRecheck, checking ? "Checking..." : "Check again");
      setText(
        els.gpuRecheckLine,
        s.gpu.recheck === "unchanged" && integrated
          ? "Still the built-in graphics."
          : "",
      );
    }

    if (phase === "refused") renderRefusal(s);
    else refusalBuiltFor = null;

    if (sheetOn) {
      const sheetKey = `${s.recording?.id ?? ""}:${s.windows.length}`;
      if (sheetBuiltFor !== sheetKey) {
        sheetBuiltFor = sheetKey;
        buildSheet(s);
      }
      for (const w of s.windows) {
        const el = printOf(w.id);
        if (el !== null) renderPrint(el, w);
      }
    } else if (sheetBuiltFor !== null) {
      sheetBuiltFor = null;
      els.sheet.textContent = "";
      drawn.clear();
    }

    const bar = barText(s);
    els.bar.hidden = bar === null;
    if (bar !== null) {
      setText(els.barLine, bar[0]);
      setText(els.barSub, bar[1]);
      renderStrip(s);
    }
    const open = phase === "done" ? undecidedWindows(s) : [];
    const firstOpen = open[0];
    els.showBtn.hidden = firstOpen === undefined;
    setText(
      els.showBtn,
      firstOpen === undefined ? "" : `Show stretch ${stretchNo(firstOpen)}`,
    );
    els.stopBtn.hidden = phase !== "training" || s.current === null;
    els.continueBtn.hidden = phase !== "stopped";
    els.saveBtn.hidden = !(
      (phase === "done" || phase === "stopped") &&
      windowsInFile(s).length > 0
    );
    els.saveBtn.classList.toggle(
      "btn--accent",
      phase === "done" && s.save.status !== "saved",
    );
    setText(
      els.saveBtn,
      phase === "stopped"
        ? "Save the finished ones"
        : s.save.status === "saved"
          ? "Save again"
          : "Save",
    );

    if (modal?.kind === "stop") renderStopModal(s);
    else if (modal?.kind === "save") {
      if (s.save.status === "saved") closeModal();
      else renderSaveModal(s);
    } else if (modal?.kind === "loupe") renderLoupe(s, modal.id);
    settleFocus();
  }

  /* ----- wiring ----- */

  on(els.chooseBtn, "click", () => els.fileInput.click());
  on(els.fileInput, "change", () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = "";
    if (file !== undefined) controller.chooseRecording(file);
  });
  on(els.drop, "dragover", (e) => {
    e.preventDefault();
    els.drop.dataset.over = "true";
  });
  on(els.drop, "dragleave", () => delete els.drop.dataset.over);
  on(els.drop, "drop", (e) => {
    e.preventDefault();
    delete els.drop.dataset.over;
    const file = e.dataTransfer?.files[0];
    if (file !== undefined) controller.chooseRecording(file);
  });
  on(els.startBtn, "click", () => store.dispatch(A.trainingStarted()));
  on(els.otherBtn, "click", () => store.dispatch(A.anotherRecordingChosen()));
  on(els.gpuRecheck, "click", () => store.dispatch(A.recheckRequested()));
  on(els.gpuAnyway, "click", () => store.dispatch(A.integratedAccepted()));
  on(els.stopBtn, "click", () => {
    store.dispatch(A.stopAsked());
    if (store.getState().stopDialog !== null) openModal({ kind: "stop" });
  });
  on(els.continueBtn, "click", () => store.dispatch(A.continued()));
  on(els.saveBtn, "click", () => {
    // A running save is never reset; its dialog is already open.
    if (store.getState().save.status === "saving") return;
    store.dispatch(A.saveCancelled());
    openModal({ kind: "save" });
  });
  on(els.showBtn, "click", () => {
    const w = undecidedWindows(store.getState())[0];
    const el = w === undefined ? null : printOf(w.id);
    if (el === null) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.dataset.flash = "true";
    el.querySelector<HTMLElement>(".print-frame")?.focus({
      preventScroll: true,
    });
    const t = env.win.setTimeout(() => {
      delete el.dataset.flash;
      flashTimers.delete(t);
    }, 2000);
    flashTimers.add(t);
  });
  on(els.sheet, "click", (e) => {
    const target = e.target as Element;
    const act = target.closest<HTMLElement>("[data-act]");
    if (
      act !== null &&
      act.dataset.act !== undefined &&
      act.dataset.id !== undefined
    ) {
      onAction(act.dataset.act, act.dataset.id);
      return;
    }
    const frame = target.closest(".print-frame");
    const id = frame?.closest<HTMLElement>(".print")?.dataset.id;
    const w =
      id === undefined
        ? undefined
        : store.getState().windows.find((x) => x.id === id);
    if (w !== undefined && showable(w)) openModal({ kind: "loupe", id: w.id });
  });
  on(els.refusalActions, "click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>(
      "[data-refusal]",
    );
    if (b === null) return;
    if (b.dataset.refusal === "again") {
      store.dispatch(A.anotherRecordingChosen());
      return;
    }
    const clip = env.win.navigator.clipboard as Clipboard | undefined;
    void copyWithFeedback(
      b,
      env.win.location.href,
      clip === undefined ? undefined : (t) => clip.writeText(t),
      {
        busy: "Copying...",
        done: "Link copied",
        failed: "Could not copy the link",
      },
    );
  });
  on(els.modal, "click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-act]");
    const act = b?.dataset.act;
    if (b === null || act === undefined) return;
    const s = store.getState();
    if (act === "close") closeModal();
    else if (act === "stop") {
      const id = s.stopDialog;
      hideModal();
      if (id !== null) store.dispatch(A.stopConfirmed({ id }));
      render();
    } else if (act === "save") {
      // The save dialog is asked for here, in the click, before any await.
      const pick = pickSaveFile(
        env.win,
        packageFileName(s.recording?.name ?? ""),
        ZIP_FILE_TYPE,
      );
      void controller.save(pick);
    } else if ((act === "prev" || act === "next") && modal?.kind === "loupe") {
      const w = loupeNeighbour(s, modal.id, act === "prev" ? -1 : 1);
      if (w !== undefined) openModal({ kind: "loupe", id: w.id });
    } else if (b.dataset.id !== undefined) {
      onAction(act, b.dataset.id);
    }
  });
  on(els.veil, "click", (e) => {
    if (e.target === els.veil) closeModal();
  });
  on(doc as unknown as HTMLElement, "keydown", (e) => {
    if (e.key === "Escape" && modal !== null) closeModal();
  });

  if (env.isPhone) store.dispatch(A.phoneRefused());
  const unsubscribe = store.subscribe(render);
  render();

  return {
    dispose() {
      unsubscribe();
      for (const off of disposers) off();
      for (const t of flashTimers) env.win.clearTimeout(t);
      root.textContent = "";
      root.classList.remove(PAGE_CLASS);
    },
  };
}
