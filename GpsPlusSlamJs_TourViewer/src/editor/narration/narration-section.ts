/**
 * The long text's Narration section in the writer (the "in the
 * inspector" prototype's, `public/prototypes/longtext-editor-1-in-the-
 * inspector/`): the voice (add, replace, remove; a file may be dropped on
 * it), the timing (import a subtitle file or a word list), why a timing
 * no longer fits an edited text with "Line the voice up again", and what
 * an import or a lining up did, until the creator folds it away. Every
 * action is async and shows it: its button is disabled and says what runs
 * until the tour holds the result, and a failure is said and leaves the
 * section as it was. The words and rules are `narration-status.ts`'s; the
 * edits are the session's (`editNarration`), each one undo step.
 *
 * @see narration-section.ts.md
 */
import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";
import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import { clockText } from "../../read-along.js";
import type { NarrationChange, NarrationFacts } from "../editor-session.js";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import { shellIcon } from "../editor-shell/shell-icons.js";
import {
  importResult,
  lineUpResult,
  narrationStatus,
  plural,
  type NarrationNote,
  type NarrationResult,
  type NarrationStatus,
} from "./narration-status.js";
import { lineUpAgain } from "./re-anchor.js";
import { TimingFileError } from "./timing-file.js";
import { importTiming } from "./timing-import.js";

/** The largest timing file the section reads (the prototype's limit). */
const TIMING_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** What the section reads and writes through the page. */
export interface NarrationSectionDeps {
  readonly document: Document;
  /** The text's narration as it stands (`EditorSession.narration`). */
  readonly read: (
    blockId: string,
  ) => Promise<
    NarrationFacts | { readonly kind: "refused"; readonly reason: string }
  >;
  /** One change of it (`EditorSession.editNarration`): a refusal is said
   *  by the page. */
  readonly edit: (
    blockId: string,
    change: NarrationChange,
  ) => Promise<TypedEditOutcome>;
  /** A passing line (the page's toast). */
  readonly say: (text: string) => void;
  /** The head's line changed (`NarrationStatus.summary`). */
  readonly onSummary: (summary: string, tone: "" | "ok" | "amber") => void;
  /** A "Show" link: the words `[from, to)` of the plain text `plain`. */
  readonly onShow?: (from: number, to: number, plain: string) => void;
  /** A voice file's length in ms (none: unknown); default: the browser's
   *  audio element reads it. */
  readonly durationOf?: (file: Blob) => Promise<number | undefined>;
  /** The text's language, for its sentences. */
  readonly lang?: string;
}

/** What the section follows: the selected text, as the tour holds it. */
interface NarrationSectionInput {
  readonly blockId: string;
  /** Its body, the tour's (a timing is lined up with what was written). */
  readonly body: string;
  /** Changes whenever its narration may have: a new key re-reads it. */
  readonly key: string;
}

export interface NarrationSection {
  /** The section's body, the same across draws. */
  readonly node: HTMLElement;
  update(input: NarrationSectionInput | null): void;
  /** Settles once the read and the drawing asked for so far are done. */
  settled(): Promise<void>;
  /** Take dropped or chosen files (a voice, a timing). */
  takeFiles(files: readonly File[]): Promise<void>;
}

/** What a running action says on its button. */
type Busy = "voice" | "remove" | "timing" | "untime" | "lineup";

/** A voice file by its name: one of the tour's allowlisted sound types. */
const VOICE_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
/** A timing file by its name. */
const TIMING_FILE = /\.(vtt|json|txt)$/i;

/** The browser's own reading of a sound file's length. */
function audioDuration(doc: Document, file: Blob): Promise<number | undefined> {
  const win = doc.defaultView;
  if (win === null || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const audio = doc.createElement("audio");
    const url = URL.createObjectURL(file);
    let done = false;
    const end = (ms: number | undefined) => {
      if (done) return;
      done = true;
      win.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = win.setTimeout(() => {
      end(undefined);
    }, 5000);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      const s = audio.duration;
      end(Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : undefined);
    });
    audio.addEventListener("error", () => {
      end(undefined);
    });
    audio.src = url;
  });
}

export function createNarrationSection(
  deps: NarrationSectionDeps,
): NarrationSection {
  const doc = deps.document;
  const lang = deps.lang ?? "en";
  const durationOf = deps.durationOf ?? ((f: Blob) => audioDuration(doc, f));

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
  const button = (className: string, act: string, text: string) => {
    const b = el("button", className, text);
    b.type = "button";
    b.dataset["ln"] = act;
    return b;
  };

  const node = el("div", "ln-sec");
  node.dataset["testid"] = "narration-section";
  const voiceInput = el("input");
  voiceInput.type = "file";
  voiceInput.accept = "audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac";
  voiceInput.hidden = true;
  voiceInput.dataset["testid"] = "narration-voice-file";
  const timingInput = el("input");
  timingInput.type = "file";
  timingInput.accept = ".vtt,.json,.txt,text/vtt,application/json";
  timingInput.hidden = true;
  timingInput.dataset["testid"] = "narration-timing-file";
  const view = el("div");
  node.append(view, voiceInput, timingInput);

  // --- state -----------------------------------------------------------------
  let input: NarrationSectionInput | null = null;
  let facts: NarrationFacts | null = null;
  let refusal: string | null = null;
  let status: NarrationStatus | null = null;
  let busy: Busy | null = null;
  let importError: { fileName: string; message: string } | null = null;
  let last: NarrationResult | null = null;
  let notesOpen = false;
  /** The voice and timing files' names chosen here, by text. */
  const voiceNames = new Map<string, string>();
  const timingNames = new Map<string, string>();
  /** Each read gets a number: an older one landing late draws nothing. */
  let reads = 0;
  let pending: Promise<void> = Promise.resolve();

  function refresh(): void {
    const at = input;
    const n = ++reads;
    pending = (async () => {
      if (at === null) return;
      const read = await deps.read(at.blockId);
      if (n !== reads) return;
      if (read.kind === "refused") {
        refusal = read.reason;
        facts = null;
        status = null;
      } else {
        refusal = null;
        facts = read;
        status = read.timingUnread
          ? {
              summary: "The timing does not read",
              tone: "amber",
              timing: null,
              problem:
                "The tour's timing for this text could not be read. Import a new timing; the voice still plays.",
              stale: null,
              unvoiced: [],
            }
          : await narrationStatus(
              at.body,
              {
                hasVoice: read.hasVoice,
                durationMs: read.durationMs,
                timingText: read.timingText,
              },
              lang,
            );
        if (n !== reads) return;
      }
      draw();
    })().catch(() => {
      if (n !== reads) return;
      refusal = "The narration could not be read.";
      draw();
    });
  }

  // --- drawing ---------------------------------------------------------------
  function noteList(notes: readonly NarrationNote[]): HTMLUListElement {
    const ul = el("ul", "ln-ul");
    for (const note of notes) {
      const li = el(
        "li",
        note.kind === "file"
          ? "ln-fl"
          : note.kind === "unvoiced"
            ? "ln-vo"
            : "",
        note.text,
      );
      if (note.from !== null && note.to !== null && note.to > note.from) {
        const show = button("lw-lnk", "show", "Show");
        show.dataset["from"] = String(note.from);
        show.dataset["to"] = String(note.to);
        li.append(" ", show);
      }
      ul.append(li);
    }
    return ul;
  }

  function busyButton(
    className: string,
    act: string,
    idle: string,
    working: string,
    which: Busy,
  ): HTMLButtonElement {
    const b = button(className, act, busy === which ? working : idle);
    b.disabled = busy !== null;
    if (busy === which) b.setAttribute("aria-busy", "true");
    return b;
  }

  function draw(): void {
    node.setAttribute("aria-busy", String(busy !== null));
    if (input === null) {
      view.replaceChildren();
      return;
    }
    if (refusal !== null) {
      view.replaceChildren(el("div", "note", refusal));
      deps.onSummary("", "");
      return;
    }
    if (facts === null || status === null) {
      view.replaceChildren(el("div", "note", "Reading the narration..."));
      return;
    }
    deps.onSummary(status.summary, status.tone);
    const id = input.blockId;
    const parts: HTMLElement[] = [];

    // The voice.
    const vrow = el("div", "ln-row");
    vrow.append(el("div", "ln-k", "Voice"));
    if (facts.hasVoice) {
      const file = el("div", "ln-file");
      file.append(
        shellIcon("note"),
        el("span", "ln-fn", voiceNames.get(id) ?? "The voice of this text"),
        el(
          "span",
          "ln-du",
          facts.durationMs === null ? "" : clockText(facts.durationMs),
        ),
      );
      const acts = el("div", "ln-acts");
      acts.append(
        busyButton(
          "lw-lnk",
          "voice-pick",
          "Replace",
          "Adding the voice...",
          "voice",
        ),
        busyButton("lw-lnk", "voice-remove", "Remove", "Removing...", "remove"),
      );
      vrow.append(file, acts);
    } else {
      const drop = el(
        "div",
        "ln-drop",
        "A recording, or a voice made with a speech tool (MP3, M4A, OGG or WAV). You can also drop the file here.",
      );
      const acts = el("div", "ln-acts");
      const add = busyButton(
        "lw-btn",
        "voice-pick",
        "Add a voice file",
        "Adding the voice...",
        "voice",
      );
      add.prepend(shellIcon("plus"));
      acts.append(add);
      drop.append(acts);
      vrow.append(drop);
    }
    parts.push(vrow);

    // The timing.
    const trow = el("div", "ln-row");
    const tk = el("div", "ln-k", "Timing");
    tk.append(" ", el("span", "ln-h", "which words are spoken when"));
    trow.append(tk);
    const timing = status.timing;
    const named = facts.timingText !== null || facts.timingUnread;
    if (named) {
      const file = el("div", "ln-file");
      file.append(
        shellIcon("text"),
        el("span", "ln-fn", timingNames.get(id) ?? "The read-along timing"),
        el(
          "span",
          "ln-du",
          timing === null
            ? ""
            : timing.granularity === "word"
              ? "word list"
              : "subtitle file",
        ),
      );
      trow.append(file);
    } else {
      trow.append(
        el(
          "div",
          "note",
          facts.hasVoice
            ? "No timing yet: the voice plays, but no words light up."
            : "No timing yet: add a voice first, then its timing.",
        ),
      );
    }
    const tacts = el("div", "ln-acts");
    const pick = busyButton(
      "lw-btn",
      "timing-pick",
      named ? "Import a new timing..." : "Import timing...",
      "Importing...",
      "timing",
    );
    if (!facts.hasVoice) pick.disabled = true;
    pick.prepend(shellIcon("folder"));
    tacts.append(pick);
    if (named) {
      tacts.append(
        busyButton(
          "lw-lnk",
          "timing-remove",
          "Remove timing",
          "Removing...",
          "untime",
        ),
      );
    }
    trow.append(
      tacts,
      el(
        "div",
        "note",
        "A subtitle file (.vtt) or a word list (.json) that a speech tool exports. Importing never changes your text.",
      ),
    );
    parts.push(trow);

    if (importError !== null) {
      const err = el("div", "ln-err");
      err.setAttribute("role", "alert");
      err.append(
        "Could not use ",
        el("b", "", importError.fileName),
        `: ${importError.message} Your text and the current timing are unchanged.`,
      );
      parts.push(err);
    }

    if (status.problem !== null) {
      parts.push(el("div", "ln-err", status.problem));
    }

    if (status.stale !== null) {
      const n = status.stale.count;
      const notice = el("div", "ln-notice");
      notice.dataset["testid"] = "narration-stale";
      const nt = el("div", "ln-nt");
      nt.append(
        shellIcon("pencil"),
        "You edited the text after the voice was lined up",
      );
      notice.append(
        nt,
        el(
          "div",
          "ln-nd",
          `${n === 0 ? "The voice no longer lines up with the text." : `The voice no longer lines up with ${String(n)} ${plural(n, "sentence")}.`} Until it does, visitors see this text without the words lighting up; the voice still plays.`,
        ),
        noteList(status.stale.items),
      );
      const row = el("div", "ln-row2");
      row.append(
        busyButton(
          "lw-btn lw-pri",
          "lineup",
          "Line the voice up again",
          "Lining up...",
          "lineup",
        ),
        el("span", "note", "Your text stays exactly as it is."),
      );
      notice.append(row);
      parts.push(notice);
    } else if (timing !== null) {
      if (last !== null) {
        const card = el(
          "div",
          last.partial ? "ln-result ln-part" : "ln-result",
        );
        card.dataset["testid"] = "narration-result";
        const nt = el("div", "ln-nt");
        nt.append(shellIcon(last.partial ? "note" : "check"), last.title);
        card.append(nt, el("div", "ln-nd", last.text));
        const notes = [...last.notes, ...status.unvoiced];
        if (notes.length > 0) card.append(noteList(notes));
        const row = el("div", "ln-row2");
        row.append(button("lw-lnk", "last-ok", "OK, fold this away"));
        card.append(row);
        parts.push(card);
      } else if (status.unvoiced.length > 0) {
        const box = el("div", "ln-notes");
        const head = button(
          "",
          "notes",
          `${String(status.unvoiced.length)} ${plural(status.unvoiced.length, "note")} about this narration`,
        );
        head.prepend(shellIcon("right"));
        head.setAttribute("aria-expanded", String(notesOpen));
        box.append(head);
        if (notesOpen) box.append(noteList(status.unvoiced));
        parts.push(box);
      }
    }
    view.replaceChildren(...parts);
  }

  // --- actions ---------------------------------------------------------------
  /** `work` as the section's one running action: drawn as running, and
   *  drawn again from what the tour holds once it ends. */
  async function running(
    which: Busy,
    work: () => Promise<void>,
  ): Promise<void> {
    if (busy !== null || input === null) return;
    busy = which;
    draw();
    try {
      await work();
    } finally {
      busy = null;
      refresh();
      await pending;
    }
  }

  async function addVoice(file: File): Promise<void> {
    const at = input;
    if (at === null) return;
    if (!VOICE_FILE.test(file.name)) {
      deps.say(
        `${file.name} is not a sound file a tour can carry (MP3, M4A, OGG, WAV and the like).`,
      );
      return;
    }
    await running("voice", async () => {
      const ms = await durationOf(file).catch(() => undefined);
      const done = await deps.edit(at.blockId, {
        kind: "voice",
        file,
        fileName: file.name,
        ...(ms === undefined ? {} : { durationMs: ms }),
      });
      if (done !== "written") return;
      voiceNames.set(at.blockId, file.name);
      deps.say(`Voice ${file.name} added. Save to keep it in the tour.`);
    });
  }

  async function removeVoice(): Promise<void> {
    const at = input;
    if (at === null) return;
    await running("remove", async () => {
      const done = await deps.edit(at.blockId, { kind: "removeVoice" });
      if (done !== "written") return;
      voiceNames.delete(at.blockId);
      timingNames.delete(at.blockId);
      last = null;
      deps.say("Voice removed, with its timing. Ctrl+Z brings both back.");
    });
  }

  async function removeTiming(): Promise<void> {
    const at = input;
    if (at === null) return;
    await running("untime", async () => {
      const done = await deps.edit(at.blockId, { kind: "removeTiming" });
      if (done !== "written") return;
      timingNames.delete(at.blockId);
      last = null;
      deps.say(
        "Timing removed: the voice plays without the words lighting up. Ctrl+Z brings it back.",
      );
    });
  }

  async function importFile(file: File): Promise<void> {
    const at = input;
    if (at === null) return;
    if (facts?.hasVoice !== true) {
      deps.say(
        "Add the voice file first: a timing says when it reads each word.",
      );
      return;
    }
    await running("timing", async () => {
      const fail = (message: string) => {
        importError = { fileName: file.name, message };
        deps.say(`Could not use ${file.name}: ${message}`);
      };
      if (file.size > TIMING_FILE_MAX_BYTES) {
        fail("the file is over 20 MB.");
        return;
      }
      let done;
      try {
        done = await importTiming(at.body, await file.text(), lang);
      } catch (err) {
        fail(
          err instanceof TimingFileError
            ? err.message
            : "it could not be read.",
        );
        return;
      }
      if (done.timing === null) {
        fail("nothing of it is in your text.");
        return;
      }
      const written = await deps.edit(at.blockId, {
        kind: "timing",
        text: JSON.stringify(done.timing),
      });
      if (written !== "written") return;
      importError = null;
      timingNames.set(at.blockId, file.name);
      last = importResult(file.name, done);
      deps.say(
        done.mismatches.length > 0
          ? `${file.name}: ${String(done.mismatches.length)} ${plural(done.mismatches.length, "part")} of the file do not match your text. They are listed under Narration.`
          : `${file.name}: it lines up with your text.`,
      );
    });
  }

  async function lineUp(): Promise<void> {
    const at = input;
    const timing: TourTiming | null = status?.timing ?? null;
    if (at === null || timing === null) return;
    await running("lineup", async () => {
      const done = await lineUpAgain(timing, at.body, lang);
      if (done.timing === null) {
        deps.say(
          "None of the voice is in the text any more: record it again and import its timing.",
        );
        return;
      }
      const written = await deps.edit(at.blockId, {
        kind: "timing",
        text: JSON.stringify(done.timing),
      });
      if (written !== "written") return;
      last = lineUpResult(done);
      const missing = done.unvoiced.length;
      deps.say(
        missing > 0
          ? `Lined up again: ${String(done.sentences - missing)} of ${String(done.sentences)} sentences have their voice. ${String(missing)} could not be matched; see Narration.`
          : "Lined up again: every sentence has its voice.",
      );
    });
  }

  async function takeFiles(files: readonly File[]): Promise<void> {
    for (const file of files) {
      if (VOICE_FILE.test(file.name) || file.type.startsWith("audio/")) {
        await addVoice(file);
      } else if (TIMING_FILE.test(file.name)) {
        await importFile(file);
      } else {
        importError = {
          fileName: file.name,
          message: "it is neither a voice file nor a timing file.",
        };
        draw();
      }
    }
  }

  // --- events ------------------------------------------------------------------
  node.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-ln]");
    if (target === null || input === null) return;
    switch (target.dataset["ln"]) {
      case "voice-pick":
        voiceInput.click();
        return;
      case "voice-remove":
        void removeVoice();
        return;
      case "timing-pick":
        timingInput.click();
        return;
      case "timing-remove":
        void removeTiming();
        return;
      case "lineup":
        void lineUp();
        return;
      case "last-ok":
        last = null;
        notesOpen = false;
        draw();
        return;
      case "notes":
        notesOpen = !notesOpen;
        draw();
        return;
      case "show": {
        const from = Number(target.dataset["from"]);
        const to = Number(target.dataset["to"]);
        const plain = plainTextOf(parseTourMarkdown(input.body)).text;
        deps.onShow?.(from, to, plain);
        return;
      }
    }
  });
  for (const field of [voiceInput, timingInput]) {
    field.addEventListener("change", () => {
      const files = [...(field.files ?? [])];
      field.value = "";
      void takeFiles(files);
    });
  }
  node.addEventListener("dragover", (event) => {
    if ([...(event.dataTransfer?.types ?? [])].includes("Files")) {
      event.preventDefault();
      node.classList.add("ln-hot");
    }
  });
  node.addEventListener("dragleave", () => {
    node.classList.remove("ln-hot");
  });
  node.addEventListener("drop", (event) => {
    event.preventDefault();
    node.classList.remove("ln-hot");
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void takeFiles(files);
  });

  return {
    node,
    update(next) {
      const was = input;
      input = next;
      if (next === null) {
        reads++;
        draw();
        return;
      }
      if (was?.blockId !== next.blockId) {
        facts = null;
        status = null;
        refusal = null;
        importError = null;
        last = null;
        notesOpen = false;
        draw();
      } else if (was.key === next.key && was.body === next.body) {
        return;
      }
      refresh();
    },
    settled: () => pending,
    takeFiles,
  };
}
