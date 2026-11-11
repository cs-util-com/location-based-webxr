/**
 * The character maker page (`characters.html`): the library of characters
 * on this device, and the six steps that make one from a picture an image
 * AI drew. Wiring only; the rules live in the modules it imports, each
 * with its own tests, and the page as a whole is covered end to end.
 *
 * @see maker-main.ts.md
 */

import "./maker.css";

import { escapeHtml as esc } from "gps-plus-slam-app-framework/utils/escape-html";
import { guardSlidersIn } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";

import { exchangeBytes, exchangeFileName } from "./character-exchange.js";
import { createImportFlow } from "./character-import.js";
import {
  type CharacterLibrary,
  createCharacterLibrary,
} from "./character-library.js";
import type { CharacterRecord } from "./character-record.js";
import { cropThumb, whenMade } from "./character-thumb.js";
import { CutFailed, type CutWorker, createCutClient } from "./cut-client.js";
import {
  type BackdropId,
  CUT_CHOICE_DEFAULTS,
  CUT_SLIDERS,
  type CutChoice,
  type CutSliderKey,
  cutSettingsFor,
  draftOf,
  freshDraft,
  hasDraft,
  MAKER_STEPS,
  type MakerDraft,
  nextLabel,
  reachable,
  stepInfo,
} from "./maker-draft.js";
import {
  type Backdrop,
  BACKDROPS,
  beckonIndex,
  canvasOf,
  createAnimSet,
  drawFeet,
  drawFigure,
  pngOf,
  talkIndex,
} from "./maker-preview.js";
import {
  IDEAS,
  PROMPT_BODY,
  PROMPT_EMPTY,
  PROMPT_HEAD,
  promptText,
} from "./maker-prompt.js";
import { busy, offerUndo } from "./maker-ui.js";
import { LibraryUnavailable, opfsLibraryStore } from "./opfs-library-store.js";
import type { RgbaImage } from "./rgba-image.js";
import { composeSheet } from "./sheet-align.js";
import { CUT_PHASES, type PhaseState } from "./sheet-analyze.js";
import type { FrameCheck } from "./sheet-check.js";

// ------------------------------------------------------------ page handles

function $<T extends HTMLElement = HTMLElement>(
  sel: string,
  root: ParentNode = document,
): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`the page has no ${sel}`);
  return el;
}
const $$ = <T extends HTMLElement = HTMLElement>(
  sel: string,
  root: ParentNode = document,
): T[] => Array.from(root.querySelectorAll<T>(sel));

const EMBEDDED = new URLSearchParams(location.search).get("in") === "editor";
const DRAFT_KEY = "characters:maker-draft";
const ERROR_LINGER_MS = 9000;
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const toastLine = createToast($("#toasts"));
function toast(message: string, error = false): void {
  toastLine.show(
    message,
    error ? { className: "toast err", lingerMs: ERROR_LINGER_MS } : {},
  );
}
const undoBox = $("#undoBox");

// ------------------------------------------------------------ state

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft = Omit<Mutable<MakerDraft>, "cut"> & { cut: Mutable<CutChoice> };

function loadDraft(): Draft {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    // private mode, or a broken entry: start fresh
  }
  const d = draftOf(raw);
  return { ...d, cut: { ...d.cut } };
}
function freshFor(ground: BackdropId): Draft {
  const d = freshDraft();
  return { ...d, cut: { ...d.cut }, ground };
}

let S: Draft = loadDraft();
function persist(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(S));
  } catch {
    // private mode: the page works without memory
  }
}

interface CutResult {
  readonly raw: readonly RgbaImage[];
  readonly rawSteady: readonly RgbaImage[];
  readonly frames: HTMLCanvasElement[];
  readonly steady: HTMLCanvasElement[];
  readonly check: FrameCheck;
}
let R: CutResult | null = null;
let cutting = false;
/** Bumped on every new cut or choice, so the previews redraw. */
let version = 0;
const justMade = new Set<string>();

const chosenFrames = (): HTMLCanvasElement[] | null =>
  R ? (S.choice === "steady" ? R.steady : R.frames) : null;
const chosenRaw = (): readonly RgbaImage[] | null =>
  R ? (S.choice === "steady" ? R.rawSteady : R.raw) : null;

// ------------------------------------------------------------ services

const cutClient = createCutClient(
  () =>
    new Worker(new URL("./character-cut.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as CutWorker,
);

let libraryPromise: Promise<CharacterLibrary> | null = null;
function library(): Promise<CharacterLibrary> {
  libraryPromise ??= opfsLibraryStore().then((store) =>
    createCharacterLibrary(store),
  );
  libraryPromise.catch(() => {
    libraryPromise = null;
  });
  return libraryPromise;
}
const reason = (e: unknown): string =>
  e instanceof LibraryUnavailable || e instanceof Error ? e.message : String(e);

// ------------------------------------------------------------ views

function setView(v: "home" | "steps"): void {
  // The library's name question goes with the library view.
  if (v !== "home") importFlow.cancel();
  document.body.dataset.view = v;
  $("#title").textContent =
    v === "home" ? "Your characters" : "Make a character";
  if (v === "home") void renderHome();
  else render();
  $("#body").scrollTop = 0;
}
$("#toHome").addEventListener("click", () => setView("home"));
if (!EMBEDDED) $("#toEditor").hidden = false;
$("#homeLead").textContent = EMBEDDED
  ? "Characters you make here are kept on this device. When you go back to your tour, you can add them there."
  : "Make guide characters with an image AI, as many as you like. They are kept on this device, and the tour editor on this device finds them by itself.";

// ------------------------------------------------------------ the library list

const thumbs = new Map<string, string>();

async function thumbUrl(lib: CharacterLibrary, id: string): Promise<string> {
  const known = thumbs.get(id);
  if (known !== undefined) return known;
  let url = "";
  try {
    url = await cropThumb((await lib.files(id)).image);
  } catch {
    // no thumbnail: the list shows the name only
  }
  thumbs.set(id, url);
  return url;
}

let homeSeq = 0;
async function renderHome(): Promise<void> {
  const seq = ++homeSeq;
  $("#libCount").textContent = "Reading this device...";
  renderDraftRow();
  let lib: CharacterLibrary;
  let listing;
  try {
    lib = await library();
    listing = await lib.list();
  } catch (e) {
    $("#libCount").textContent = "";
    toast(
      `The characters on this device could not be read: ${reason(e)}`,
      true,
    );
    return;
  }
  if (seq !== homeSeq) return;
  const { entries, interrupted } = listing;
  $("#libCount").textContent =
    entries.length === 1 ? "1 character" : `${entries.length} characters`;
  const rows = await Promise.all(entries.map((e) => entryRow(lib, e)));
  if (seq !== homeSeq) return;
  const ul = $("#libList");
  ul.replaceChildren(...rows);
  if (!entries.length) {
    ul.innerHTML =
      '<li class="empty-line" style="display:block">No characters on this device yet. Make one, or import a character file.</li>';
  }
  const ip = $("#interrupted");
  ip.hidden = !interrupted;
  if (interrupted) {
    ip.innerHTML = `${interrupted === 1 ? "One save" : `${interrupted} saves`} did not finish, probably because the page closed too early. ${interrupted === 1 ? "It is" : "They are"} not shown, and tidied up the next time you save. <button class="link small" type="button" id="tidyBtn">Tidy up now</button>`;
    const tidy = $<HTMLButtonElement>("#tidyBtn");
    tidy.addEventListener(
      "click",
      () =>
        void busy(tidy, "Tidying up...", async () => {
          try {
            await lib.tidy();
            toast("Tidied up");
          } catch (e) {
            toast(`Tidying up did not work: ${reason(e)}`, true);
          }
        }).then(() => renderHome()),
    );
  }
}

function renderDraftRow(): void {
  const dr = $("#draftRow");
  dr.hidden = !hasDraft(S);
  if (!hasDraft(S)) return;
  const d = S.desc.trim();
  const said = d
    ? `&ldquo;${esc(d.length > 60 ? `${d.slice(0, 58)}...` : d)}&rdquo; - `
    : "";
  dr.innerHTML = `<div><b>Unfinished character</b><p class="small dim">${said}you stopped at step ${S.step + 1} of 6: ${esc((MAKER_STEPS[S.step] ?? "").toLowerCase())}.</p></div><div class="row"><button class="btn primary small" type="button" data-continue>Continue</button><button class="btn small" type="button" data-discard>Discard</button></div>`;
  $("[data-continue]", dr).addEventListener("click", () => setView("steps"));
  $("[data-discard]", dr).addEventListener("click", () => {
    const before = S;
    const beforeR = R;
    S = freshFor(S.ground);
    R = null;
    persist();
    void renderHome();
    offerUndo(undoBox, "Unfinished character discarded", () => {
      S = before;
      R = beforeR;
      persist();
      void renderHome();
    });
  });
}

async function entryRow(
  lib: CharacterLibrary,
  e: CharacterRecord,
): Promise<HTMLLIElement> {
  const li = document.createElement("li");
  li.dataset.id = e.libraryId;
  const fresh = justMade.has(e.libraryId);
  if (fresh) li.classList.add("fresh");
  const state = fresh
    ? '<span class="state info">Just made</span>'
    : e.autoName
      ? '<span class="state warn">No name yet</span>'
      : '<span class="state">Ready</span>';
  const thumb = await thumbUrl(lib, e.libraryId);
  li.innerHTML = `<img class="thumb" alt="" ${thumb ? `src="${thumb}"` : ""} />
    <div class="who"><b>${esc(e.name)}</b><span class="meta">${state}<span>${esc(whenMade(e.createdAtIso))}</span></span></div>
    <div class="acts"><button class="btn small" type="button" data-act="rename">${e.autoName ? "Give it a name" : "Rename"}</button><button class="btn small" type="button" data-act="file">Save as file</button><button class="btn small danger" type="button" data-act="delete">Delete</button></div>
    <div class="slot wide" data-slot hidden></div>`;
  const slot = $("[data-slot]", li);
  $('[data-act="rename"]', li).addEventListener("click", () => {
    slot.hidden = false;
    slot.innerHTML = `<label class="field">New name<input type="text" maxlength="40" value="${esc(e.autoName ? "" : e.name)}" placeholder="For example: Ranger Rita" /></label><p class="field-msg" hidden></p><div class="row"><button class="btn primary small" type="button" data-ok>Save the name</button><button class="btn small" type="button" data-no>Cancel</button></div>`;
    const input = $<HTMLInputElement>("input", slot);
    input.focus();
    const ok = $<HTMLButtonElement>("[data-ok]", slot);
    const submit = (): void =>
      void busy(ok, "Saving...", async () => {
        try {
          const rec = await lib.rename(e.libraryId, input.value);
          toast(`Renamed: ${rec.name}`);
          void renderHome();
        } catch (err) {
          const m = $(".field-msg", slot);
          m.textContent = reason(err);
          m.hidden = false;
        }
      });
    ok.addEventListener("click", submit);
    input.addEventListener("keydown", (k) => {
      if (k.key === "Enter") submit();
    });
    $("[data-no]", slot).addEventListener("click", () => (slot.hidden = true));
  });
  $('[data-act="delete"]', li).addEventListener("click", () => {
    slot.hidden = false;
    slot.innerHTML = `<p><b>Delete ${esc(e.name)} from this device?</b> Tours that already have ${esc(e.name)} keep their own copy.</p><div class="row"><button class="btn danger primary small" type="button" data-ok>Delete</button><button class="btn small" type="button" data-no>Keep it</button></div>`;
    const ok = $<HTMLButtonElement>("[data-ok]", slot);
    ok.addEventListener(
      "click",
      () =>
        void busy(ok, "Deleting...", async () => {
          try {
            await lib.remove(e.libraryId);
            thumbs.delete(e.libraryId);
            toast(`${e.name} deleted from this device`);
            void renderHome();
          } catch (err) {
            toast(`Deleting did not work: ${reason(err)}`, true);
          }
        }),
    );
    $("[data-no]", slot).addEventListener("click", () => (slot.hidden = true));
  });
  const fileBtn = $<HTMLButtonElement>('[data-act="file"]', li);
  fileBtn.addEventListener(
    "click",
    () =>
      void busy(fileBtn, "Making the file...", async () => {
        try {
          const how = await giveFile(lib, e.libraryId);
          if (how !== "cancelled") {
            toast(
              `${e.name} saved as a file. Send it as a file, not as a photo, so it keeps its see-through background.`,
            );
          }
        } catch (err) {
          toast(`The file could not be made: ${reason(err)}`, true);
        }
      }),
  );
  return li;
}

/** The exchange file: shared on a phone when the browser can, else downloaded. */
async function giveFile(
  lib: CharacterLibrary,
  id: string,
): Promise<"shared" | "saved" | "cancelled"> {
  const { record, frames } = await lib.files(id);
  const bytes = exchangeBytes(
    new Uint8Array(await frames.arrayBuffer()),
    record,
  );
  const file = new File([bytes as BlobPart], exchangeFileName(record.name), {
    type: "image/png",
  });
  if (
    matchMedia("(pointer: coarse)").matches &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "saved";
}

$("#makeBtn").addEventListener("click", () => {
  if (S.savedId) startAnother();
  setView("steps");
});
const importBtn = $<HTMLButtonElement>("#importBtn");
const impFile = $<HTMLInputElement>("#impFile");
importBtn.addEventListener("click", () => impFile.click());
impFile.addEventListener("change", () => {
  const f = impFile.files?.[0];
  impFile.value = "";
  if (f) void importIntoLibrary(f);
});

const importFlow = createImportFlow({
  errBox: $("#homeErr"),
  askBox: $("#homeAsk"),
  chooseAgain: () => impFile.click(),
  toast,
  during: (phase, work) =>
    busy(
      importBtn,
      phase === "reading" ? "Reading the file..." : "Waiting for a name...",
      work,
    ),
});

async function importIntoLibrary(file: File): Promise<void> {
  const r = await importFlow(file);
  if (!r) return;
  await busy(importBtn, "Saving to this device...", async () => {
    try {
      const rec = await (
        await library()
      ).save({
        name: r.name,
        steady: r.steady,
        describedAs: r.describedAs,
        frames: r.framesBlob,
        image: r.imageBlob,
      });
      justMade.add(rec.libraryId);
      toast(`Imported ${rec.name} onto this device`);
    } catch (e) {
      toast(`Saving did not work: ${reason(e)}`, true);
    }
  });
  void renderHome();
}

// ------------------------------------------------------------ the prompt

function promptHtml(): string {
  const d = S.desc.trim();
  return (
    esc(PROMPT_HEAD) +
    (d
      ? `<mark>${esc(d)}</mark>`
      : `<mark class="empty">${esc(PROMPT_EMPTY)}</mark>`) +
    esc(PROMPT_BODY)
  );
}

// ------------------------------------------------------------ previews

type Draw = (
  c: HTMLCanvasElement,
  f: HTMLCanvasElement | null,
  g: Backdrop,
) => void;
interface Anim {
  readonly canvas: HTMLCanvasElement;
  readonly kind: "talk" | "beckon";
  readonly frames: () => HTMLCanvasElement[] | null;
  readonly draw: Draw;
  key: string;
}
/** By the canvas's id: a preview drawn again replaces its animation. */
const anims = createAnimSet<Anim>();
function anim(
  canvas: HTMLCanvasElement,
  kind: Anim["kind"],
  frames: Anim["frames"],
  draw: Draw = drawFigure,
): void {
  anims.put(canvas.id, { canvas, kind, frames, draw, key: "" });
}
function loop(t: number): void {
  for (const a of anims.all()) {
    if (!a.canvas.isConnected || a.canvas.offsetParent === null) continue;
    const fr = a.frames();
    if (!fr) continue;
    const idx = a.kind === "talk" ? talkIndex(t) : beckonIndex(t);
    const key = `${idx}|${S.ground}|${version}`;
    if (key === a.key) continue;
    a.key = key;
    a.draw(a.canvas, fr[idx] ?? null, S.ground);
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------ stepper

function renderSteps(): void {
  const hasCut = R !== null;
  const ol = $("#steps");
  ol.replaceChildren();
  MAKER_STEPS.forEach((label, i) => {
    const info = stepInfo(S, i, hasCut);
    const li = document.createElement("li");
    li.dataset.state = info.state;
    if (i === S.step) li.classList.add("current");
    const mark =
      info.state === "done" && i !== S.step
        ? "&#10003;"
        : info.state === "failed"
          ? "!"
          : String(i + 1);
    li.innerHTML = `<button type="button" ${reachable(S, i, hasCut) ? "" : "disabled"} aria-current="${i === S.step ? "step" : "false"}" aria-label="Step ${i + 1}: ${esc(label)}. ${esc(info.sub)}"><span class="dot">${mark}</span><span class="txt"><span class="lbl">${esc(label)}</span><span class="sub">${esc(info.sub)}</span></span></button>`;
    $("button", li).addEventListener("click", () => go(i));
    ol.append(li);
  });
  const cur = stepInfo(S, S.step, hasCut);
  $("#where").innerHTML =
    `Step ${S.step + 1} of 6: <b>${esc(MAKER_STEPS[S.step] ?? "")}</b>` +
    (cur.state === "failed"
      ? ` <span class="fail">- ${esc(cur.sub)}</span>`
      : "");
}
const landscape = matchMedia("(max-height: 520px)");
function placeRail(): void {
  if (landscape.matches) $("#railSlot").append($("#rail"));
  else $("#app").insertBefore($("#rail"), $("#where"));
}
landscape.addEventListener("change", placeRail);

// ------------------------------------------------------------ navigation

function go(i: number): void {
  if (!reachable(S, i, R !== null)) return;
  S.step = i;
  S.maxStep = Math.max(S.maxStep, Math.min(i, 3));
  persist();
  if (document.body.dataset.view !== "steps") setView("steps");
  else render();
  $("#body").scrollTop = 0;
}
const backBtn = $<HTMLButtonElement>("#backBtn");
const nextBtn = $<HTMLButtonElement>("#nextBtn");
function render(): void {
  renderSteps();
  for (const p of $$("[data-panel]"))
    p.hidden = Number(p.dataset.panel) !== S.step;
  renderGreet();
  backBtn.hidden = S.step === 0 || (S.step === 5 && !!S.savedId);
  if (S.step === 1) {
    $("#prompt").innerHTML = promptHtml();
    renderCopy();
  }
  if (S.step === 3) {
    $<HTMLButtonElement>("#pickBtn").disabled = cutting;
    $<HTMLButtonElement>("#pasteBtn").disabled = cutting;
  }
  if (S.step === 4) renderCheck();
  if (S.step === 5) renderSave();
  if (nextBtn.getAttribute("aria-busy") !== "true") {
    const next = nextLabel(S, R !== null, cutting);
    nextBtn.textContent = next.label;
    nextBtn.disabled = next.disabled;
  }
}
backBtn.addEventListener("click", () => go(Math.max(0, S.step - 1)));
nextBtn.addEventListener("click", () => {
  if (S.step === 0) {
    if (S.desc.trim().length < 3) {
      $("#descMsg").hidden = false;
      $("#desc").focus();
      return;
    }
    S.maxStep = Math.max(S.maxStep, 1);
    go(1);
  } else if (S.step === 1) {
    S.maxStep = Math.max(S.maxStep, 2);
    go(2);
  } else if (S.step === 2) {
    S.maxStep = Math.max(S.maxStep, 3);
    go(3);
  } else if (S.step === 3) {
    if (R && !S.failure) go(4);
    else picFile.click();
  } else if (S.step === 4) go(5);
  else if (S.savedId) {
    startAnother();
    render();
  } else void save();
});
for (const b of $$("[data-go]"))
  b.addEventListener("click", () => go(Number(b.dataset.go)));

let greetHtml = "";
function greet(html: string): void {
  greetHtml = html;
  renderGreet();
}
function renderGreet(): void {
  for (const g of $$("[data-greet]")) {
    const panel = g.closest<HTMLElement>("[data-panel]");
    const show = greetHtml !== "" && Number(panel?.dataset.panel) === S.step;
    g.hidden = !show;
    if (show) {
      g.innerHTML = `<p>${greetHtml}</p><button class="x" type="button" aria-label="Dismiss">&times;</button>`;
      $(".x", g).addEventListener("click", () => greet(""));
    }
  }
}

// ------------------------------------------------------------ steps 1 and 2

const desc = $<HTMLTextAreaElement>("#desc");
for (const t of IDEAS) {
  const b = document.createElement("button");
  b.className = "chip";
  b.type = "button";
  b.textContent = t;
  b.addEventListener("click", () => {
    desc.value = t;
    onDesc();
  });
  $("#ideas").append(b);
}
function onDesc(): void {
  if (desc.value !== S.desc) {
    S.desc = desc.value;
    S.copiedAt = 0;
  }
  $("#descMsg").hidden = true;
  persist();
  renderSteps();
}
desc.addEventListener("input", onDesc);

const copyBtn = $<HTMLButtonElement>("#copyBtn");
function renderCopy(): void {
  const m = $("#copyMsg");
  copyBtn.classList.toggle("done", !!S.copiedAt);
  if (copyBtn.getAttribute("aria-busy") !== "true") {
    copyBtn.textContent = S.copiedAt
      ? "Copied - copy again"
      : "Copy the prompt";
  }
  if (S.copiedAt) {
    m.className = "copy-msg ok";
    m.textContent = "Copied. Now paste it into your image AI.";
  } else if (!m.classList.contains("bad")) m.textContent = "";
}
copyBtn.addEventListener(
  "click",
  () =>
    void busy(copyBtn, "Copying...", async () => {
      const m = $("#copyMsg");
      try {
        await navigator.clipboard.writeText(promptText(S.desc));
        S.copiedAt = Date.now();
        m.classList.remove("bad");
        toast("Prompt copied");
      } catch {
        // The browser did not let the page copy: select the text for the author.
        const sel = getSelection();
        const range = document.createRange();
        range.selectNodeContents($("#prompt"));
        sel?.removeAllRanges();
        sel?.addRange(range);
        S.copiedAt = 0;
        m.className = "copy-msg bad";
        m.textContent =
          "Your browser did not let this page copy. The text is selected: press Ctrl+C, or on a phone tap Copy.";
        toast("Could not copy by itself - the text is selected for you", true);
      }
      persist();
    }).then(() => {
      renderCopy();
      renderSteps();
    }),
);

// ------------------------------------------------------------ steps 3 and 4: the cut

function renderPhases(states: Partial<Record<string, PhaseState>>): void {
  const ol = $("#phases");
  ol.hidden = false;
  ol.replaceChildren();
  for (const p of CUT_PHASES) {
    const s = states[p.id] ?? "todo";
    const li = document.createElement("li");
    li.dataset.s = s;
    li.innerHTML = `<span class="m">${s === "done" ? "&#10003;" : s === "failed" ? "!" : ""}</span><span>${esc(p.label)}</span>`;
    ol.append(li);
  }
}

const EXPLAIN: Readonly<Record<string, string>> = {
  joined:
    "The image AI drew two poses so close together that they touch. This page needs a little empty space between all four poses.",
  missing:
    "The image AI drew fewer than four figures. Your character needs exactly four: resting, two talking, and pointing.",
  extra:
    "There are more than four separate shapes. Often that is text, a label or a small extra drawing.",
  checkerboard:
    "The image AI painted a grey and white checkerboard to look like transparency. It is part of the picture, so it cannot be cut away.",
  busy: "The background is not one plain colour, so the figures cannot be cut out cleanly.",
  empty: "No figure was found in this picture.",
  "not-image":
    "This file is not a picture. Choose a PNG, JPEG or WebP picture.",
  decode:
    "This picture could not be opened. Choose a PNG, JPEG or WebP picture.",
  "too-big":
    "This picture is very large. Choose a smaller copy (about 1536 x 1024 pixels is plenty).",
  "too-small": "This picture is too small to hold four clear poses.",
};

function resultOf(r: {
  frames: readonly RgbaImage[];
  steadyFrames: readonly RgbaImage[];
  check: FrameCheck;
}): CutResult {
  return {
    raw: r.frames,
    rawSteady: r.steadyFrames,
    frames: r.frames.map(canvasOf),
    steady: r.steadyFrames.map(canvasOf),
    check: r.check,
  };
}

const isAbort = (e: unknown): boolean =>
  e instanceof DOMException && e.name === "AbortError";

async function runImport(blob: Blob): Promise<void> {
  if (cutting) return;
  cutting = true;
  S.failure = "";
  R = null;
  S.choice = "drawn";
  S.savedId = "";
  $("#cutErr").hidden = true;
  greet("");
  S.step = 3;
  S.maxStep = Math.max(S.maxStep, 3);
  if (document.body.dataset.view !== "steps") setView("steps");
  const states: Partial<Record<string, PhaseState>> = {};
  renderPhases(states);
  render();
  try {
    const r = await cutClient.cut(
      blob,
      cutSettingsFor(S.cut),
      (phase, state) => {
        states[phase] = state;
        renderPhases(states);
      },
    );
    R = resultOf(r);
    version++;
    persist();
    toast("Four poses found");
    cutting = false;
    await sleep(400);
    go(4);
  } catch (e) {
    if (isAbort(e)) return;
    const known = e instanceof CutFailed;
    S.failure = known ? e.message : "Something went wrong";
    if (!known) console.error(e);
    const card = $("#cutErr");
    card.innerHTML = `<h3>This picture did not work - and here is what to do</h3><p>${esc((known && EXPLAIN[e.code]) || (known ? e.message : "Something unexpected went wrong while cutting the picture."))}</p><div class="row"><button class="btn primary small" type="button" data-again>Choose another picture</button><button class="btn small" type="button" data-go-prompt>See the prompt again</button></div>`;
    card.hidden = false;
    $("[data-again]", card).addEventListener("click", () => picFile.click());
    $("[data-go-prompt]", card).addEventListener("click", () => go(1));
    toast(`The picture did not work: ${S.failure}`, true);
    persist();
  } finally {
    cutting = false;
    if (document.body.dataset.view === "steps") render();
  }
}

const picFile = $<HTMLInputElement>("#picFile");
picFile.addEventListener("change", () => {
  const f = picFile.files?.[0];
  picFile.value = "";
  if (f) void runImport(f);
});
$("#pickBtn").addEventListener("click", () => picFile.click());
$("#betterPic").addEventListener("click", () => {
  go(3);
  picFile.click();
});
// Reading a picture from the clipboard asks for permission and needs HTTPS.
const pasteBtn = $<HTMLButtonElement>("#pasteBtn");
pasteBtn.addEventListener(
  "click",
  () =>
    void busy(pasteBtn, "Reading the clipboard...", async () => {
      if (typeof navigator.clipboard?.read !== "function") {
        toast(
          "This browser cannot hand a copied picture to the page. Save the picture and choose it instead.",
          true,
        );
        return;
      }
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            setTimeout(() => void runImport(blob), 0);
            return;
          }
        }
        toast(
          "The clipboard holds no picture. In your image AI, copy the picture itself, then tap Paste picture again.",
          true,
        );
      } catch (e) {
        toast(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "This page was not allowed to read the clipboard. Allow it when the browser asks, or choose the picture instead."
            : "The clipboard could not be read. Save the picture and choose it instead.",
          true,
        );
      }
    }),
);
const drop = $("#drop");
if (matchMedia("(pointer: fine)").matches) {
  $("#dropHint").textContent =
    "from your files, or press Ctrl+V, or drop the file on this box";
}
const app = $("#app");
for (const ev of ["dragenter", "dragover"]) {
  app.addEventListener(ev, (e) => {
    e.preventDefault();
    if (S.step === 3) drop.classList.add("over");
  });
}
for (const ev of ["dragleave", "drop"]) {
  app.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  });
}
app.addEventListener("drop", (e) => {
  const f = Array.from(e.dataTransfer?.files ?? [])[0];
  if (!f) return;
  if (document.body.dataset.view === "home") void importIntoLibrary(f);
  else void runImport(f);
});
document.addEventListener("paste", (e) => {
  const target = e.target;
  if (target instanceof Element && target.closest("textarea, input")) return;
  const f = Array.from(e.clipboardData?.files ?? []).find((x) =>
    x.type.startsWith("image/"),
  );
  if (f) {
    e.preventDefault();
    void runImport(f);
  } else if (S.step === 3 && document.body.dataset.view === "steps") {
    toast(
      "That was text, not a picture. Copy the picture itself, then paste again.",
      true,
    );
  }
});

// ------------------------------------------------------------ step 5: check

for (const b of BACKDROPS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.ground = b.id;
  btn.innerHTML = `<i style="background:${b.css}"></i>${esc(b.label)}`;
  btn.addEventListener("click", () => {
    S.ground = b.id;
    persist();
    markGround();
  });
  $("#groundSeg").append(btn);
}
function markGround(): void {
  for (const x of $$("#groundSeg button")) {
    x.setAttribute("aria-pressed", String(x.dataset.ground === S.ground));
  }
}

let styleVersion = -1;
function renderCheck(): void {
  if (!R) return;
  const c = R.check;
  markGround();
  $("#summary").innerHTML =
    '<span class="pill">&#10003; 4 poses found</span><span class="pill">&#10003; Background removed</span><span class="pill">&#10003; Lined up on one ground line</span>' +
    (c.jitter
      ? '<span class="pill info">Lively body while talking</span>'
      : '<span class="pill">&#10003; The body stays still while talking</span>');
  if (styleVersion !== version) {
    styleVersion = version;
    const pct = Math.round(c.bodyDiff * 100);
    $("#talkStyle").innerHTML = `<h3>How it talks</h3>
      <div class="choices" role="radiogroup" aria-label="How it talks">
        <label class="choice"><input type="radio" name="style" value="drawn" /><canvas id="pvDrawn" width="240" height="320"></canvas><b>As drawn</b><span class="why">Exactly the picture, like a hand-drawn cartoon.</span></label>
        <label class="choice"><input type="radio" name="style" value="steady" /><canvas id="pvSteady" width="240" height="320"></canvas><b>Steady body</b><span class="why">Only the head moves. The body of pose 1 is kept.</span></label>
      </div>
      <p class="small dim">${
        c.jitter
          ? `The image AI drew each talking pose a little differently: ${pct} in every 100 dots of the body change, so the body moves along while it talks.`
          : "Only the mouth changes between the talking poses, so both versions look almost the same."
      }</p>`;
    for (const r of $$<HTMLInputElement>('input[name="style"]')) {
      r.addEventListener("change", () => {
        S.choice = r.value === "steady" ? "steady" : "drawn";
        persist();
        version++;
        styleVersion = version;
        renderSteps();
        renderFrameStrip();
        toast(r.value === "steady" ? "Steady body chosen" : "As drawn chosen");
      });
    }
    anim($<HTMLCanvasElement>("#pvDrawn"), "talk", () => R?.frames ?? null);
    anim($<HTMLCanvasElement>("#pvSteady"), "talk", () => R?.steady ?? null);
  }
  for (const r of $$<HTMLInputElement>('input[name="style"]'))
    r.checked = r.value === S.choice;
  renderCutControls();
  renderFrameStrip();
}
function renderFrameStrip(): void {
  const fr = chosenFrames();
  const strip = $("#framesStrip");
  strip.replaceChildren();
  ["1. Resting", "2. Talking", "3. Talking wide", "4. Pointing"].forEach(
    (label, i) => {
      const f = document.createElement("figure");
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 256;
      drawFigure(c, fr?.[i] ?? null, "checks");
      f.append(c, label);
      strip.append(f);
    },
  );
}

// The cut sliders: each change cuts the picture again, the previews follow.
const CUT_INPUTS: readonly [
  string,
  string,
  CutSliderKey,
  (v: number) => string,
][] = [
  ["rTol", "oTol", "whiteTol", String],
  ["rFloor", "oFloor", "shadowFloor", String],
  ["rSpeck", "oSpeck", "islandMin", (v) => (v ? `up to ${v} dots` : "off")],
  ["rEdge", "oEdge", "edgeSoft", String],
];
for (const [r, , k] of CUT_INPUTS) {
  const input = $<HTMLInputElement>(`#${r}`);
  input.min = String(CUT_SLIDERS[k].min);
  input.max = String(CUT_SLIDERS[k].max);
  input.step = String(CUT_SLIDERS[k].step);
}
const shadowBox = $<HTMLInputElement>("#cShadow");
function renderCutControls(): void {
  for (const [r, o, k, f] of CUT_INPUTS) {
    $<HTMLInputElement>(`#${r}`).value = String(S.cut[k]);
    $(`#${o}`).textContent = f(S.cut[k]);
  }
  shadowBox.checked = S.cut.shadowOn;
  $("#floorRow").classList.toggle("off", !S.cut.shadowOn);
  $<HTMLInputElement>("#rFloor").disabled = !S.cut.shadowOn;
}
let recutTimer: ReturnType<typeof setTimeout> | undefined;
function cutStatus(kind: "ok" | "bad" | "busy", text: string): void {
  const s = $("#cutStatus");
  s.className = `cut-status ${kind}`;
  s.textContent = text;
}
function onCutChange(): void {
  for (const [r, , k] of CUT_INPUTS)
    S.cut[k] = Number($<HTMLInputElement>(`#${r}`).value);
  S.cut.shadowOn = shadowBox.checked;
  persist();
  renderCutControls();
  cutStatus("busy", "Cutting again...");
  $("#stage").classList.add("recutting");
  clearTimeout(recutTimer);
  recutTimer = setTimeout(() => void recut(), 220);
}
for (const [r] of CUT_INPUTS) $(`#${r}`).addEventListener("input", onCutChange);
shadowBox.addEventListener("change", onCutChange);
$("#cutReset").addEventListener("click", () => {
  S.cut = { ...CUT_CHOICE_DEFAULTS };
  renderCutControls();
  onCutChange();
});
async function recut(): Promise<void> {
  if (!R) return;
  try {
    // null: the worker cuts the picture it already holds again. A newer
    // change replaces this request, which then ends as an AbortError.
    const r = await cutClient.cut(null, cutSettingsFor(S.cut));
    R = resultOf(r);
    version++;
    cutStatus(
      "ok",
      !S.cut.islandMin
        ? "Updated. Cleaning small specks is off."
        : r.specks
          ? `Updated. ${r.specks} small speck${r.specks === 1 ? "" : "s"} cleaned away.`
          : "Updated. No small specks found.",
    );
    renderCheck();
  } catch (e) {
    if (isAbort(e)) return;
    cutStatus(
      "bad",
      `With these settings the picture cannot be cut: ${e instanceof Error ? e.message : "it did not work."} The last good cut is still shown.`,
    );
  }
  $("#stage").classList.remove("recutting");
}

// ------------------------------------------------------------ step 6: name and save

const charName = $<HTMLInputElement>("#charName");
function renderSave(): void {
  if (!R) return;
  charName.value = S.name;
  $("#facts").innerHTML =
    `<li><b>4 poses</b>: resting, two talking, pointing</li>
    <li><b>How it talks: ${S.choice === "steady" ? "steady body" : "as drawn"}</b> <button class="link small" type="button" data-go-check>change</button></li>`;
  $("[data-go-check]").addEventListener("click", () => go(4));
  const sb = $("#savedBox");
  sb.hidden = !S.savedId;
  if (!S.savedId) return;
  sb.innerHTML = `<h3>Saved. ${esc(S.savedName)} is on this device now.</h3>
    <p>${EMBEDDED ? "Go back to your tour with the button at the top, and add it there." : "The tour editor on this device finds it the next time you open it or switch back to it."}</p>
    <div class="row"><button class="btn primary" type="button" data-another>Make another</button><button class="btn" type="button" data-home>All characters</button></div>`;
  $("[data-another]", sb).addEventListener("click", () => {
    startAnother();
    render();
  });
  $("[data-home]", sb).addEventListener("click", () => {
    startAnother();
    setView("home");
  });
}
charName.addEventListener("input", () => {
  S.name = charName.value;
  persist();
});
function startAnother(): void {
  S = freshFor(S.ground);
  R = null;
  desc.value = "";
  $("#phases").hidden = true;
  $("#cutErr").hidden = true;
  persist();
}
async function save(): Promise<void> {
  const raw = chosenRaw();
  if (!raw) return;
  await busy(nextBtn, "Saving...", async () => {
    try {
      const frames = await pngOf(canvasOf(composeSheet(raw)));
      const image = await pngOf(canvasOf(raw[0]!));
      const rec = await (
        await library()
      ).save({
        name: S.name,
        steady: S.choice === "steady",
        describedAs: S.desc.trim(),
        frames,
        image,
      });
      S.savedId = rec.libraryId;
      S.savedName = rec.name;
      justMade.add(rec.libraryId);
      persist();
      toast(`Saved on this device: ${rec.name}`);
    } catch (e) {
      toast(
        `Saving did not work: ${reason(e)}. Your character is still here - try again.`,
        true,
      );
    }
  });
  render();
}
$("#restart").addEventListener("click", () => {
  const before = S;
  const beforeR = R;
  startAnother();
  greet("");
  render();
  offerUndo(undoBox, "Started over", () => {
    S = before;
    R = beforeR;
    desc.value = S.desc;
    persist();
    render();
  });
});

// ------------------------------------------------------------ leaving and coming back

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    S.leftAt = Date.now();
    persist();
    return;
  }
  if (document.body.dataset.view === "home") {
    void renderHome(); // another tab may have changed the library
    return;
  }
  const away = Date.now() - (S.leftAt || Date.now());
  if (
    away > 1500 &&
    ((S.step === 1 && S.copiedAt) || S.step === 2) &&
    !cutting
  ) {
    S.maxStep = Math.max(S.maxStep, 3);
    go(3);
    greet(
      "<b>Welcome back.</b> Did your image AI make the picture? Paste it or choose it below.",
    );
  }
});

// ------------------------------------------------------------ start

// A vertical swipe that starts on a slider scrolls the page (a phone).
guardSlidersIn(document);

const chosen = (): HTMLCanvasElement[] | null => chosenFrames();
anim($<HTMLCanvasElement>("#pvTalk"), "talk", chosen);
anim($<HTMLCanvasElement>("#pvBeckon"), "beckon", chosen);
anim($<HTMLCanvasElement>("#pvSave"), "talk", chosen);
anim($<HTMLCanvasElement>("#pvCutTalk"), "talk", chosen);
anim($<HTMLCanvasElement>("#pvFeet"), "talk", chosen, drawFeet);
requestAnimationFrame(loop);

desc.value = S.desc;
placeRail();
if (S.savedId) startAnother();
// The cut picture is not kept over a reload: ask for it again, calmly.
if (S.step >= 4 && !R) {
  S.step = 3;
  greet(
    "<b>Welcome back.</b> Bring the picture in once more: this page does not keep it when it is reloaded.",
  );
}
setView(
  new URLSearchParams(location.search).get("start") === "new"
    ? "steps"
    : "home",
);
