/**
 * The long text's writer in the 3D view's inspector (the "in the
 * inspector" prototype, `public/prototypes/longtext-editor-1-in-the-
 * inspector/`): the view picker, the text in a plain text area over a
 * mirror that dims the marks, the formatting toolbar and its shortcuts,
 * the parts shown as typed (underlined, counted in a chip, explained in a
 * callout at the cursor) and the spot the narration takes in a later
 * step. The body stays the tour's Markdown; every button writes the marks
 * the tour's reader formats (`writer-edits.ts`), so a creator never needs
 * to know them.
 *
 * Its node lives across the inspector's draws (`node`): the text area
 * keeps its focus, its selection and the browser's own undo while the
 * tour changes around it. The text is written into the tour after a pause
 * in typing and when it is left (`flush`), one undo step of the tour each.
 *
 * @see long-text-writer.ts.md
 */
import {
  TYPED_PART_TEXT,
  hasPlainTextFix,
  plainTextEdit,
  tourPictureEdit,
  typedParts,
  type TypedPart,
} from "./typed-parts.js";
import type { KeptStore } from "./kept-store.js";
import { mirrorRuns } from "./mirror-marks.js";
import {
  LONG_TEXT_SEGMENTS,
  stepSegment,
  viewPickerModel,
  type LongTextSegment,
} from "./view-picker.js";
import {
  continueList,
  indentLines,
  insertBlock,
  linkEdit,
  toggleHeading,
  toggleList,
  touchesList,
  wrapInline,
  type WriterEdit,
} from "./writer-edits.js";
import { readMinutes, wordCount } from "../../long-text-sheet.js";
import { shellIcon, type ShellIcon } from "gps-plus-slam-editor-kit/chrome";
import type { InspectorLongText } from "../editor-shell/inspector-model.js";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import {
  createNarrationSection,
  type NarrationSectionDeps,
} from "../narration/narration-section.js";
import { truncated } from "../../truncated.js";
import { inputText } from "../../input-text.js";
import { TOUR_BLOCK_TEXT_RULES } from "gps-plus-slam-app-framework/ar/tour-blocks";

/** How long typing pauses before the text is written into the tour. */
export const WRITER_SAVE_MS = 700;

/** The most a long text holds, in UTF-16 units (the format's cap). */
const BODY_MAX = TOUR_BLOCK_TEXT_RULES.longText.body.max;
/** From this length on the stat line counts toward the cap. */
const BODY_NEAR = Math.floor(BODY_MAX * 0.9);

/** Keys that only modify the next one: Esc, then Shift and Tab, leaves. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

/** A text as the tour keeps it: in NFC (as every field the editor writes,
 *  `input-text.ts`), with plain line ends (a browser's text area hands
 *  them over so), without the spaces around it (`blockFieldEdit`). The
 *  one form the writer writes and compares. */
function norm(text: string): string {
  return inputText(text).replace(/\r\n?/g, "\n").trim();
}

/** The pictures a writer's thumbnails were made for. */
function picturesKey(model: InspectorLongText): string {
  return JSON.stringify(model.pictures.map((p) => [p.id, p.path]));
}

export interface LongTextWriterDeps {
  readonly document: Document;
  /** The parts kept as typed, per text (this browser's). */
  readonly kept: KeptStore;
  /** Writes the text's body into the tour: one undo step. */
  readonly writeBody: (blockId: string, body: string) => TypedEditOutcome;
  /** Writes the text's view into the tour. */
  readonly writeView: (blockId: string, view: string) => TypedEditOutcome;
  /** The text's narration, read and changed: the Narration section (none
   *  given: the section says a narration cannot be added here). */
  readonly narration?: Pick<
    NarrationSectionDeps,
    "read" | "edit" | "durationOf" | "voiceMaxBytes"
  >;
  /** A tour file's content (a picture's thumbnail). */
  readonly loadPicture: (path: string) => Promise<Blob>;
  /** A passing line (the page's toast). */
  readonly say: (text: string) => void;
  /** The text as it stands now, typed and not yet written (the preview). */
  readonly onText?: (body: string) => void;
  /** A part shown as typed was gone to: the preview shows it. */
  readonly onShow?: (from: number, to: number, body: string) => void;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
}

export interface LongTextWriter {
  /** The writer's node, the same across draws. */
  readonly node: HTMLElement;
  /** The text the inspector shows now (null: none, the writer idle). */
  update(model: InspectorLongText | null): void;
  /** Text typed and not yet written goes into the tour now. */
  flush(): void;
  /** The text area, for focus. */
  readonly area: HTMLTextAreaElement;
  /** Releases its thumbnails and timers. */
  destroy(): void;
}

let ids = 0;

export function createLongTextWriter(deps: LongTextWriterDeps): LongTextWriter {
  const doc = deps.document;
  const win = doc.defaultView ?? globalThis;
  const createUrl = deps.createUrl ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? ((u: string) => URL.revokeObjectURL(u));
  const n = ++ids;

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (className !== "") e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (
    className: string,
    act: string,
    title: string,
    text: string | null,
  ): HTMLButtonElement => {
    const b = el("button", className);
    b.type = "button";
    b.dataset["lw"] = act;
    if (title !== "") b.title = title;
    if (text !== null) b.textContent = text;
    return b;
  };
  /** A button showing a shell icon, named by its title. */
  const iconButton = (
    className: string,
    act: string,
    title: string,
    icon: ShellIcon,
  ): HTMLButtonElement => {
    const b = button(className, act, title, null);
    b.append(shellIcon(icon));
    b.setAttribute("aria-label", title);
    return b;
  };

  // --- the view picker -----------------------------------------------------
  const viewSec = el("div", "isec lw-vsec");
  const viewLab = el("div", "lw-slab", "Visitors see it as");
  viewLab.id = `lw-vlab-${String(n)}`;
  const seg = el("div", "lw-seg3");
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "How visitors see this text");
  const segButtons = new Map<LongTextSegment, HTMLButtonElement>();
  for (const id of LONG_TEXT_SEGMENTS) {
    const b = el("button");
    b.type = "button";
    b.dataset["lw"] = `view:${id}`;
    b.setAttribute("role", "radio");
    b.append(shellIcon(id), el("span"));
    segButtons.set(id, b);
    seg.append(b);
  }
  const vdesc = el("div", "lw-vdesc");
  vdesc.setAttribute("aria-live", "polite");
  viewSec.append(viewLab, seg, vdesc);

  // --- the writer --------------------------------------------------------------
  const wsec = el("div", "isec lw-wsec");
  const slab = el("div", "lw-slab", "Text");
  const save = el("span", "lw-save", "Saved");
  slab.append(el("span", "sp"), save);
  const tools = el("div", "lw-tools");
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "Formatting");
  const sep = () => el("span", "lw-sepv");
  const helpButton = iconButton(
    "lw-wb",
    "help",
    "Shortcuts and how the text is stored",
    "help",
  );
  helpButton.setAttribute("aria-expanded", "false");
  tools.append(
    button("lw-wb lw-h", "h2", "Heading", "H"),
    button("lw-wb lw-h lw-small", "h3", "Subheading", "H"),
    (() => {
      const b = button("lw-wb", "bold", "Bold (Ctrl+B)", null);
      b.append(el("b", "", "B"));
      b.setAttribute("aria-label", "Bold (Ctrl+B)");
      return b;
    })(),
    button("lw-wb lw-it", "italic", "Italic (Ctrl+I)", "I"),
    sep(),
    iconButton("lw-wb", "ul", "Bulleted list (Ctrl+Shift+8)", "ul"),
    iconButton("lw-wb", "ol", "Numbered list (Ctrl+Shift+7)", "ol"),
    iconButton(
      "lw-wb",
      "outdent",
      "Less indent (Shift+Tab in a list)",
      "outdent",
    ),
    iconButton(
      "lw-wb",
      "indent",
      "More indent: a list inside a list (Tab in a list)",
      "indent",
    ),
    sep(),
    iconButton("lw-wb", "link", "Link (Ctrl+K)", "link"),
    iconButton("lw-wb", "picture", "Picture from the tour's files", "photo"),
    el("span", "sp"),
    helpButton,
  );
  for (const b of tools.querySelectorAll<HTMLButtonElement>(
    ".lw-wb.lw-h, .lw-wb.lw-it",
  )) {
    b.setAttribute("aria-label", b.title);
  }
  // One tab stop: the toolbar's last focused button; the arrow keys, Home
  // and End move along it (the ARIA toolbar pattern).
  const toolButtons = [...tools.querySelectorAll<HTMLButtonElement>(".lw-wb")];
  const rove = (to: HTMLButtonElement) => {
    for (const b of toolButtons) b.tabIndex = b === to ? 0 : -1;
  };
  if (toolButtons[0] !== undefined) rove(toolButtons[0]);
  tools.addEventListener("focusin", (event) => {
    const b = toolButtons.find((t) => t === event.target);
    if (b !== undefined) rove(b);
  });
  tools.addEventListener("keydown", (event) => {
    const at = toolButtons.findIndex((t) => t === event.target);
    if (at === -1) return;
    const last = toolButtons.length - 1;
    const to =
      event.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : event.key === "ArrowLeft"
          ? at === 0
            ? last
            : at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = toolButtons[to];
    if (next === undefined) return;
    event.preventDefault();
    rove(next);
    next.focus();
  });

  const linkRow = el("div", "lw-pop");
  linkRow.hidden = true;
  const linkLine = el("div", "lw-row");
  const linkUrl = el("input", "tfield");
  linkUrl.type = "text";
  linkUrl.placeholder = "Web address, e.g. https://example.org";
  linkUrl.setAttribute("aria-label", "Web address of the link");
  linkUrl.autocomplete = "off";
  linkUrl.spellcheck = false;
  linkLine.append(
    linkUrl,
    button("lw-btn lw-pri", "link-add", "", "Add link"),
    button("lw-btn", "link-cancel", "", "Cancel"),
  );
  const linkNote = el("div", "note");
  linkRow.append(linkLine, linkNote);

  const picPop = el("div", "lw-pop");
  picPop.hidden = true;
  const picHead = el("div", "lw-row");
  picHead.append(
    el("span", "lw-muted", "Pick a picture from this tour's files"),
    el("span", "sp"),
    iconButton("ib", "pic-cancel", "Close", "close"),
  );
  const pics = el("div", "lw-pics");
  picPop.append(picHead, pics);

  const help = el("div", "lw-pop lw-help");
  help.hidden = true;
  const kbd = (k: string) => el("kbd", "", k);
  const line = (...parts: (string | Node)[]) => {
    const d = el("div");
    d.append(...parts);
    return d;
  };
  const code = (t: string) => el("code", "", t);
  const keys = (...k: string[]) =>
    k.flatMap((key, i) => (i === 0 ? [kbd(key)] : ["+", kbd(key)]));
  help.append(
    line(
      ...keys("Ctrl", "B"),
      " bold, ",
      ...keys("Ctrl", "I"),
      " italic, ",
      ...keys("Ctrl", "K"),
      " link, ",
      ...keys("Ctrl", "Z"),
      " undo.",
    ),
    line(
      ...keys("Ctrl", "Shift", "8"),
      " bulleted list, ",
      ...keys("Ctrl", "Shift", "7"),
      " numbered list. In a list, ",
      kbd("Enter"),
      " starts the next line and ",
      kbd("Tab"),
      " / ",
      ...keys("Shift", "Tab"),
      " moves a line in or out. ",
      kbd("Esc"),
      " then ",
      kbd("Tab"),
      " leaves the writer.",
    ),
    (() => {
      const d = line(
        "The marks the buttons add are kept faint in the writer, so you can also type them: ",
        code("**bold**"),
        ", ",
        code("*italic*"),
        ", ",
        code("## Heading"),
        ", ",
        code("- list"),
        ". Anything else shows to visitors exactly as typed, and the writer marks it with a dotted underline.",
      );
      d.className = "lw-help-more";
      return d;
    })(),
  );

  const writer = el("div", "lw-writer");
  const mirror = el("div", "lw-mirror");
  mirror.setAttribute("aria-hidden", "true");
  const area = el("textarea");
  area.spellcheck = true;
  area.setAttribute("aria-label", "The text visitors read");
  area.placeholder = "Write what visitors read at this station...";
  area.dataset["testid"] = "long-text-writer";
  writer.append(mirror, area);

  const callout = el("div", "lw-callout");
  callout.hidden = true;
  callout.setAttribute("role", "region");
  callout.setAttribute("aria-label", "A part shown as typed");
  const coHead = el("div", "lw-ct");
  const coTitle = el("b");
  const coLine = el("span", "lw-ln");
  const coNav = el("span", "lw-nav");
  const coPos = el("span");
  coNav.append(
    coPos,
    iconButton("ib", "part-prev", "Previous part shown as typed", "up"),
    iconButton("ib", "part-next", "Next part shown as typed", "down"),
  );
  coHead.append(shellIcon("note"), coTitle, coLine, el("span", "sp"), coNav);
  const coWhy = el("div", "lw-cw");
  const coButtons = el("div", "lw-cb");
  const coFix = button("lw-btn lw-blue", "part-fix", "", "Make it plain text");
  const coPic = button("lw-btn", "part-picture", "", "Use a tour picture");
  const coKeep = button("lw-btn", "part-keep", "", "Keep as typed");
  coButtons.append(coFix, coPic, coKeep);
  const coNote = el("div", "lw-cn");
  callout.append(coHead, coWhy, coButtons, coNote);

  const stat = el("div", "lw-stat");
  const count = el("span", "", "");
  count.id = `lw-count-${String(n)}`;
  area.setAttribute("aria-describedby", count.id);
  const chip = el("button", "lw-chip");
  chip.type = "button";
  chip.dataset["lw"] = "parts";
  chip.setAttribute("aria-expanded", "false");
  stat.append(count, el("span", "sp"), chip);
  const list = el("div", "lw-list");
  list.hidden = true;
  list.id = `lw-list-${String(n)}`;
  chip.setAttribute("aria-controls", list.id);
  wsec.append(slab, tools, linkRow, picPop, help, writer, callout, stat, list);

  // --- the narration ------------------------------------------------------------
  const nsec = el("div", "lw-nsec");
  const narrHead = el("button", "disc");
  narrHead.type = "button";
  narrHead.dataset["lw"] = "narration";
  narrHead.setAttribute("aria-expanded", "false");
  const narrSum = el("span", "sum");
  narrHead.append(shellIcon("right"), el("span", "lab", "Narration"), narrSum);
  const narrBody = el("div", "lw-nbody");
  narrBody.hidden = true;
  narrBody.id = `lw-narr-${String(n)}`;
  narrHead.setAttribute("aria-controls", narrBody.id);
  const narration =
    deps.narration === undefined
      ? null
      : createNarrationSection({
          document: doc,
          read: deps.narration.read,
          edit: deps.narration.edit,
          ...(deps.narration.durationOf === undefined
            ? {}
            : { durationOf: deps.narration.durationOf }),
          ...(deps.narration.voiceMaxBytes === undefined
            ? {}
            : { voiceMaxBytes: deps.narration.voiceMaxBytes }),
          say: deps.say,
          onSummary: (summary, tone) => {
            narrSum.className = tone === "" ? "sum" : `sum ${tone}`;
            narrSum.replaceChildren(el("i"), summary);
          },
          onShow: (from, to, plain) => {
            deps.onShow?.(from, to, plain);
          },
        });
  narrBody.append(
    narration?.node ??
      el("div", "note", "A narration cannot be added on this page."),
  );
  nsec.append(narrHead, narrBody);

  const node = el("div", "lw-ed");
  node.dataset["testid"] = "long-text-editor";
  node.append(viewSec, wsec, nsec);

  // --- state -----------------------------------------------------------------
  let model: InspectorLongText | null = null;
  /** The body the tour holds, as last seen (`norm`'s form). */
  let known = "";
  const same = (a: string, b: string) => norm(a) === norm(b);
  /** A text the tour refused (over its cap), per block: shown again when
   *  its block is, until it is written or the tour's own text changes
   *  (`base`, the text it was refused over: an undo, another tour). An
   *  emptied text is never kept (`commit`). */
  const refused = new Map<string, { text: string; base: string }>();
  let parts: TypedPart[] = [];
  let current = -1;
  let asked: LongTextSegment | null = null;
  let escForTab = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let committing = false;
  let linkSel: [number, number] | null = null;
  let pictureFor: TypedPart | null = null;
  const thumbs = new Map<string, string>();
  /** Bumped by each release: a picture read that lands after one is not
   *  kept, so no blob address outlives the release that should free it. */
  let thumbsGen = 0;

  const assetExists = (id: string) =>
    model?.pictures.some((p) => p.id === id) ?? false;

  // --- drawing ---------------------------------------------------------------
  function drawView(): void {
    if (model === null) return;
    const picker = viewPickerModel({
      view: model.view,
      hasNarration: model.hasNarration,
      asked,
    });
    const pressed = picker.segments.find((s) => s.pressed)?.id ?? null;
    for (const s of picker.segments) {
      const b = segButtons.get(s.id);
      if (b === undefined) continue;
      b.setAttribute("aria-checked", String(s.pressed));
      b.classList.toggle("off", s.dimmed);
      if (s.dimmed) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
      b.title = s.label;
      const words = b.querySelector("span");
      if (words !== null) words.textContent = s.label;
      // A roving focus: the pressed one, else the first, is in the tab order.
      b.tabIndex = s.id === (pressed ?? "reading") ? 0 : -1;
    }
    vdesc.replaceChildren(picker.description);
    if (picker.offerNarration) {
      vdesc.append(" ", button("", "add-narration", "", "Add a narration"));
    }
    // The section says more once it has read the narration.
    if (narration === null || narrSum.childNodes.length === 0) {
      narrSum.replaceChildren(
        el("i"),
        model.hasNarration ? "Has a voice" : "No voice yet",
      );
    }
  }

  function drawMirror(): void {
    const body = area.value;
    const runs = mirrorRuns(body, parts, current);
    mirror.replaceChildren(
      ...runs.map((r) => {
        const text = body.slice(r.from, r.to);
        if (r.looks.length === 0) return doc.createTextNode(text);
        const span = el("span", r.looks.map((l) => `m-${l}`).join(" "), text);
        if (r.part >= 0) span.dataset["i"] = String(r.part);
        return span;
      }),
      // The text area's last line, also an empty one, has its height.
      doc.createTextNode("\n​"),
    );
    mirror.scrollTop = area.scrollTop;
  }

  const open = () => parts.filter((p) => !p.kept);

  function drawCallout(): void {
    const part = parts[current];
    if (part === undefined || part.kept) {
      callout.hidden = true;
      return;
    }
    const text = TYPED_PART_TEXT[part.kind];
    const shown = open();
    callout.hidden = false;
    coTitle.textContent = text.headline ?? `${text.title} is shown as typed`;
    coLine.textContent = `line ${String(part.line)}`;
    coWhy.textContent = text.why;
    coFix.textContent = text.fix ?? "Make it plain text";
    const fixable = hasPlainTextFix(area.value, part);
    coFix.hidden = !fixable;
    coPic.hidden = text.picture !== true || (model?.pictures.length ?? 0) === 0;
    coNote.textContent = fixable
      ? `${text.fixNote} Ctrl+Z undoes it.`
      : "It cannot be made plain text here: change it by typing, or keep it as typed.";
    coPos.textContent =
      shown.length > 1
        ? `${String(shown.indexOf(part) + 1)} of ${String(shown.length)}`
        : "";
    coNav.hidden = shown.length < 2;
  }

  function drawStat(): void {
    const body = area.value;
    const words = wordCount(body);
    const length = norm(body).length;
    const cap =
      length >= BODY_NEAR
        ? ` · ${length.toLocaleString("en")} of ${BODY_MAX.toLocaleString("en")}`
        : "";
    count.textContent = `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"} · ${String(readMinutes(words))} min read${cap}`;
    const shown = open();
    const kept = parts.filter((p) => p.kept);
    const listOpen = !list.hidden;
    chip.classList.toggle("has", shown.length > 0);
    const arrow = () => shellIcon(listOpen ? "up" : "down");
    chip.replaceChildren(el("i"));
    if (shown.length > 0) {
      chip.append(
        `${String(shown.length)} ${shown.length === 1 ? "part" : "parts"} shown as typed`,
        arrow(),
      );
    } else if (kept.length > 0) {
      chip.append(
        `Everything else formatted · ${String(kept.length)} kept as typed`,
        arrow(),
      );
    } else chip.append("Every part shows as formatted");
    chip.disabled = parts.length === 0;
    if (parts.length === 0) list.hidden = true;
    chip.setAttribute("aria-expanded", String(!list.hidden));
    if (list.hidden) {
      list.replaceChildren();
      return;
    }
    const rows: HTMLElement[] = shown.map((p) => {
      const row = el("button", "lw-iss");
      row.type = "button";
      row.dataset["lw"] = `part:${String(parts.indexOf(p))}`;
      row.append(
        el("span", "lw-t", TYPED_PART_TEXT[p.kind].title),
        el("span", "lw-x", p.text.replace(/\s+/g, " ")),
        el("span", "lw-l", `line ${String(p.line)}`),
      );
      return row;
    });
    if (kept.length > 0) {
      rows.push(el("div", "lw-isshd", "Kept as typed, on purpose"));
      for (const p of kept) {
        const row = el("div", "lw-iss lw-kept");
        const again = button(
          "lw-lnk",
          `unkeep:${String(parts.indexOf(p))}`,
          "",
          "Mark it again",
        );
        row.append(
          el("span", "lw-t", TYPED_PART_TEXT[p.kind].title),
          el("span", "lw-x", p.text.replace(/\s+/g, " ")),
          again,
        );
        rows.push(row);
      }
    }
    list.replaceChildren(...rows);
  }

  /** The part the cursor is in (not kept), or -1. */
  function caretPart(): number {
    if (doc.activeElement !== area && current >= 0) return current;
    const a = area.selectionStart;
    const b = area.selectionEnd;
    return parts.findIndex(
      (p) => !p.kept && a >= p.from && a <= p.to && b <= p.to,
    );
  }

  /** The parts read again from the text as it stands. */
  function readParts(): void {
    const kept =
      model === null ? new Set<string>() : deps.kept.get(model.blockId);
    parts = typedParts(area.value, { assetExists, kept });
    if (current >= parts.length) current = -1;
  }

  function drawAll(): void {
    readParts();
    current = caretPart();
    drawView();
    drawMirror();
    drawCallout();
    drawStat();
  }

  // --- writing into the tour ----------------------------------------------------
  function commit(force: boolean): void {
    if (saveTimer !== null) {
      win.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (model === null) return;
    const value = norm(area.value);
    if (value === known) {
      save.textContent = "Saved";
      return;
    }
    // An emptied text is written only when it is left: the tour refuses
    // it, and a pause while rewriting should not say so.
    if (!force && value === "") return;
    const { blockId } = model;
    committing = true;
    let outcome: TypedEditOutcome;
    try {
      outcome = deps.writeBody(blockId, value);
    } finally {
      committing = false;
    }
    save.textContent = outcome === "written" ? "Saved" : "Not saved";
    // An emptied text is never kept: it would hide the tour's text with
    // no way back, so coming back shows the tour's text again.
    if (outcome === "written" || value === "") refused.delete(blockId);
    else refused.set(blockId, { text: area.value, base: known });
    if (outcome === "written") known = value;
  }

  function changed(): void {
    readParts();
    current = caretPart();
    drawMirror();
    drawCallout();
    drawStat();
    save.textContent = same(area.value, known) ? "Saved" : "Saving...";
    if (saveTimer !== null) win.clearTimeout(saveTimer);
    saveTimer = win.setTimeout(() => {
      saveTimer = null;
      commit(false);
    }, WRITER_SAVE_MS);
    deps.onText?.(area.value);
  }

  /** `edit` made through the browser's own editing, so Ctrl+Z undoes it
   *  like typing; where that is missing, written directly. */
  function apply(
    edit:
      | WriterEdit
      | {
          from: number;
          to: number;
          text: string;
          select?: readonly [number, number] | null;
        },
  ): void {
    const before = area.value;
    const expected =
      before.slice(0, edit.from) + edit.text + before.slice(edit.to);
    area.focus();
    area.setSelectionRange(edit.from, edit.to);
    let done: boolean;
    try {
      done =
        edit.text !== ""
          ? doc.execCommand("insertText", false, edit.text)
          : edit.from === edit.to || doc.execCommand("delete");
    } catch {
      done = false;
    }
    // A browser that says it edited but wrote something else gets the
    // edit written directly.
    if (done && area.value !== expected) {
      area.value = before;
      done = false;
    }
    if (!done) {
      area.setRangeText(edit.text, edit.from, edit.to, "end");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const select = edit.select ?? null;
    if (select !== null) {
      area.setSelectionRange(edit.from + select[0], edit.from + select[1]);
    }
    onCaret();
  }

  function onCaret(): void {
    escForTab = escForTab && doc.activeElement === area;
    const at = caretPart();
    if (at !== current) {
      current = at;
      drawMirror();
      drawCallout();
    }
  }

  function closePops(): void {
    linkRow.hidden = true;
    picPop.hidden = true;
    help.hidden = true;
    helpButton.setAttribute("aria-expanded", "false");
  }

  function openLink(): void {
    closePops();
    linkSel = [area.selectionStart, area.selectionEnd];
    const words = area.value.slice(linkSel[0], linkSel[1]).trim();
    linkNote.textContent =
      words !== ""
        ? `The words "${truncated(words, 40)}" become the link.`
        : "Select some words first to make them the link; otherwise the address itself is shown.";
    linkRow.hidden = false;
    linkUrl.value = "";
    linkUrl.focus();
  }

  function addLink(): void {
    const [a, b] = linkSel ?? [area.selectionStart, area.selectionEnd];
    const edit = linkEdit(area.value, a, b, linkUrl.value);
    if (edit === null) {
      linkUrl.focus();
      return;
    }
    linkRow.hidden = true;
    apply(edit);
  }

  function thumb(path: string, img: HTMLImageElement): void {
    const have = thumbs.get(path);
    if (have !== undefined) {
      img.src = have;
      return;
    }
    const gen = thumbsGen;
    deps.loadPicture(path).then(
      (blob) => {
        if (gen !== thumbsGen) return;
        if (thumbs.has(path)) {
          img.src = thumbs.get(path) ?? "";
          return;
        }
        const url = createUrl(blob);
        thumbs.set(path, url);
        img.src = url;
      },
      () => undefined,
    );
  }

  function openPictures(target: TypedPart | null): void {
    closePops();
    pictureFor = target;
    const choices = model?.pictures ?? [];
    pics.replaceChildren(
      ...(choices.length === 0
        ? [
            el(
              "div",
              "note",
              "This tour has no pictures yet. Add one to the tour first.",
            ),
          ]
        : choices.map((p) => {
            const b = el("button", "lw-picb");
            b.type = "button";
            b.dataset["lw"] = `pic:${p.id}`;
            b.title = p.label;
            const img = el("img");
            img.alt = "";
            thumb(p.path, img);
            b.append(img, p.label);
            return b;
          })),
    );
    picPop.hidden = false;
    pics.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function insertPicture(id: string): void {
    const picture = model?.pictures.find((p) => p.id === id);
    if (picture === undefined) return;
    picPop.hidden = true;
    const target = pictureFor;
    pictureFor = null;
    if (target !== null) {
      const edit = tourPictureEdit(area.value, target, id);
      current = -1;
      apply(edit);
      deps.say(`Put in the tour's picture ${picture.label}.`);
      return;
    }
    // A tour file carries no description: its name's words, selected, to
    // type over.
    const alt = id.replace(/[-_.]+/g, " ").trim() || "picture";
    const edit = insertBlock(
      area.value,
      area.selectionStart,
      `![${alt}](asset:${id})`,
    );
    const at = edit.text.indexOf("![") + 2;
    apply({ ...edit, select: [at, at + alt.length] });
    deps.say(
      `Picture ${picture.label} added. The words in [ ] describe it for visitors who cannot see it.`,
    );
  }

  function goToPart(index: number): void {
    const part = parts[index];
    if (part === undefined) return;
    // Focus first: its caret handler reads the old caret, and would choose
    // the part there.
    area.focus();
    current = index;
    area.setSelectionRange(part.from, part.to);
    drawMirror();
    drawCallout();
    const span = mirror.querySelector<HTMLElement>(
      `[data-i="${String(index)}"]`,
    );
    if (span !== null) {
      const top = span.offsetTop - 50;
      if (
        top < area.scrollTop ||
        top > area.scrollTop + area.clientHeight - 80
      ) {
        area.scrollTop = Math.max(0, top);
      }
      mirror.scrollTop = area.scrollTop;
    }
    deps.onShow?.(part.from, part.to, area.value);
  }

  function stepPart(step: 1 | -1): void {
    const shown = parts.map((p, i) => [p, i] as const).filter(([p]) => !p.kept);
    if (shown.length === 0) return;
    let k = shown.findIndex(([, i]) => i === current);
    k = (k + step + shown.length) % shown.length;
    const next = shown[k];
    if (next !== undefined) goToPart(next[1]);
  }

  function setKept(part: TypedPart, kept: boolean): void {
    if (model === null) return;
    deps.kept.set(model.blockId, part.key, kept);
    current = -1;
    drawAll();
  }

  function chooseView(id: LongTextSegment): void {
    if (model === null) return;
    const picker = viewPickerModel({
      view: model.view,
      hasNarration: model.hasNarration,
    });
    const segment = picker.segments.find((s) => s.id === id);
    if (segment === undefined) return;
    if (segment.dimmed) {
      asked = id;
      drawView();
      return;
    }
    asked = null;
    if (model.view !== id) deps.writeView(model.blockId, id);
    drawView();
  }

  function openNarration(focus: boolean): void {
    narrHead.setAttribute("aria-expanded", "true");
    narrHead.classList.add("open");
    narrBody.hidden = false;
    if (focus) {
      narrHead.focus();
      narrHead.scrollIntoView?.({ block: "nearest" });
    }
  }

  // --- events ------------------------------------------------------------------
  area.addEventListener("input", changed);
  area.addEventListener("scroll", () => {
    mirror.scrollTop = area.scrollTop;
  });
  for (const type of ["keyup", "click", "focus", "select"]) {
    area.addEventListener(type, onCaret);
  }
  area.addEventListener("blur", () => {
    commit(true);
  });
  area.addEventListener("keydown", (event) => {
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    const run = (edit: WriterEdit | null) => {
      event.preventDefault();
      event.stopPropagation();
      if (edit !== null) apply(edit);
    };
    // A key while an input method composes is the method's (its Esc ends
    // the composition): neither the writer's nor the page's.
    if (event.isComposing) {
      event.stopPropagation();
      return;
    }
    const { selectionStart: a, selectionEnd: b, value } = area;
    if (event.key === "Escape") {
      // The writer's own: the page's Esc would deselect the item.
      event.stopPropagation();
      escForTab = true;
      closePops();
      return;
    }
    if (MODIFIER_KEYS.has(event.key)) return;
    if (mod && !event.shiftKey && key === "b")
      return run(wrapInline(value, a, b, "**"));
    if (mod && !event.shiftKey && key === "i")
      return run(wrapInline(value, a, b, "*"));
    if (mod && !event.shiftKey && key === "k") {
      run(null);
      openLink();
      return;
    }
    if (mod && event.shiftKey && event.code === "Digit8")
      return run(toggleList(value, a, b, "bullet"));
    if (mod && event.shiftKey && event.code === "Digit7")
      return run(toggleList(value, a, b, "number"));
    if (event.key === "Tab" && !mod && !event.altKey) {
      // Esc, then Tab: the writer is left.
      if (escForTab) {
        escForTab = false;
        return;
      }
      if (touchesList(value, a, b)) {
        run(indentLines(value, a, b, event.shiftKey ? "out" : "in"));
      }
      return;
    }
    escForTab = false;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !mod &&
      !event.altKey &&
      !event.isComposing &&
      a === b
    ) {
      const edit = continueList(value, a);
      if (edit !== null) run(edit);
    }
  });

  linkUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addLink();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      linkRow.hidden = true;
      area.focus();
    }
  });

  // A toolbar button keeps the selection in the text area.
  tools.addEventListener("mousedown", (event) => {
    if ((event.target as Element).closest(".lw-wb") !== null)
      event.preventDefault();
  });

  seg.addEventListener("keydown", (event) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = (event.target as HTMLElement)
      .closest<HTMLElement>("[data-lw^='view:']")
      ?.dataset["lw"]?.slice("view:".length) as LongTextSegment | undefined;
    const next = stepSegment(from ?? "reading", step);
    chooseView(next);
    segButtons.get(next)?.focus();
  });

  node.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-lw]");
    if (target === null || model === null) return;
    const act = target.dataset["lw"] ?? "";
    const { selectionStart: a, selectionEnd: b } = area;
    const value = area.value;
    const edit = (e: WriterEdit | null) => {
      if (e !== null) apply(e);
    };
    if (act.startsWith("view:")) {
      chooseView(act.slice("view:".length) as LongTextSegment);
      return;
    }
    if (act.startsWith("pic:")) {
      insertPicture(act.slice("pic:".length));
      return;
    }
    if (act.startsWith("part:")) {
      goToPart(Number(act.slice("part:".length)));
      return;
    }
    if (act.startsWith("unkeep:")) {
      const part = parts[Number(act.slice("unkeep:".length))];
      if (part !== undefined) setKept(part, false);
      return;
    }
    switch (act) {
      case "bold":
        return edit(wrapInline(value, a, b, "**"));
      case "italic":
        return edit(wrapInline(value, a, b, "*"));
      case "h2":
        return edit(toggleHeading(value, a, b, 2));
      case "h3":
        return edit(toggleHeading(value, a, b, 3));
      case "ul":
        return edit(toggleList(value, a, b, "bullet"));
      case "ol":
        return edit(toggleList(value, a, b, "number"));
      case "indent":
      case "outdent": {
        if (!touchesList(value, a, b)) {
          deps.say(
            "Indent moves list lines in and out. Put the cursor in a list first.",
          );
          area.focus();
          return;
        }
        return edit(indentLines(value, a, b, act === "indent" ? "in" : "out"));
      }
      case "link":
        return openLink();
      case "link-add":
        return addLink();
      case "link-cancel":
        linkRow.hidden = true;
        area.focus();
        return;
      case "picture":
        return openPictures(null);
      case "pic-cancel":
        picPop.hidden = true;
        pictureFor = null;
        area.focus();
        return;
      case "help": {
        const show = help.hidden;
        closePops();
        help.hidden = !show;
        helpButton.setAttribute("aria-expanded", String(show));
        return;
      }
      case "part-fix": {
        const part = parts[current];
        if (part === undefined || !hasPlainTextFix(value, part)) return;
        const fix = plainTextEdit(value, part);
        current = -1;
        apply({ ...fix, select: [fix.text.length, fix.text.length] });
        deps.say(
          `${TYPED_PART_TEXT[part.kind].title} is plain text now. Ctrl+Z in the text undoes it.`,
        );
        return;
      }
      case "part-picture": {
        const part = parts[current];
        if (part !== undefined) openPictures(part);
        return;
      }
      case "part-keep": {
        const part = parts[current];
        if (part === undefined) return;
        setKept(part, true);
        deps.say(
          'Kept as typed. It stays listed under "Kept as typed" below the writer.',
        );
        return;
      }
      case "part-prev":
        return stepPart(-1);
      case "part-next":
        return stepPart(1);
      case "parts":
        list.hidden = !list.hidden;
        drawStat();
        return;
      case "add-narration":
        asked = null;
        drawView();
        openNarration(true);
        return;
      case "narration": {
        const opened = narrHead.getAttribute("aria-expanded") === "true";
        narrHead.setAttribute("aria-expanded", String(!opened));
        narrHead.classList.toggle("open", !opened);
        narrBody.hidden = opened;
        return;
      }
    }
  });

  function releaseThumbs(): void {
    for (const url of thumbs.values()) revokeUrl(url);
    thumbs.clear();
    thumbsGen++;
  }

  return {
    node,
    area,
    update(next) {
      if (next === null) {
        commit(true);
        model = null;
        releaseThumbs();
        narration?.update(null);
        return;
      }
      // Thumbnails are kept by picture path only while the tour's pictures
      // (their ids and paths) stay the same: any change releases them all,
      // so a picture given another file is read again.
      if (model !== null && picturesKey(model) !== picturesKey(next)) {
        releaseThumbs();
      }
      narration?.update({
        blockId: next.blockId,
        body: next.body,
        key: next.narrationKey,
      });
      const other = model?.blockId !== next.blockId;
      if (other) {
        commit(true);
        closePops();
        list.hidden = true;
        asked = null;
        current = -1;
        narrHead.setAttribute("aria-expanded", "false");
        narrHead.classList.remove("open");
        narrBody.hidden = true;
        model = next;
        known = norm(next.body);
        const kept = refused.get(next.blockId);
        const again = kept !== undefined && kept.base === known;
        if (!again) refused.delete(next.blockId);
        area.value = again ? kept.text : next.body;
        save.textContent = again ? "Not saved" : "Saved";
        drawAll();
        return;
      }
      model = next;
      const body = norm(next.body);
      if (body !== known) {
        known = body;
        // The tour's text changed from outside (its undo, a write taking
        // spaces off): shown, unless it is this writer's own write.
        if (!committing && !same(area.value, next.body)) {
          area.value = next.body;
          refused.delete(next.blockId);
          save.textContent = "Saved";
        }
      }
      drawAll();
    },
    flush() {
      commit(true);
    },
    destroy() {
      if (saveTimer !== null) win.clearTimeout(saveTimer);
      saveTimer = null;
      releaseThumbs();
      node.remove();
    },
  };
}
