/**
 * "Import character...": reads a character file (the exchange PNG, or a
 * bare sheet), refuses it in words where it cannot be a character, and
 * asks for a name where none came with it. One flow for the maker's
 * library and the tour editor's Characters list, so both refuse the same
 * files with the same words.
 *
 * @see character-import.ts.md
 */
import { escapeHtml as esc } from "gps-plus-slam-app-framework/utils/escape-html";

import {
  checkSheetPixels,
  ImportRefusal,
  inspectExchange,
} from "./character-exchange.js";
import { CUT_SETTINGS } from "./cut-settings.js";
import { decodePicture } from "./decode-picture.js";
import { canvasOf, pngOf } from "./maker-preview.js";
import type { RgbaImage } from "./rgba-image.js";

/** A file taken as a character, with the name it will carry. */
export interface AcceptedCharacter {
  readonly name: string;
  readonly steady: boolean;
  readonly describedAs: string;
  /** The four poses, the file's bytes as they came. */
  readonly framesBlob: Blob;
  /** The first pose as a picture of its own. */
  readonly imageBlob: Blob;
}

/** What `readCharacterFile` found: the character, and a note on what did
 *  not come with it (shown when a name is asked for). */
export type ReadCharacter = AcceptedCharacter & { readonly note: string };

/** The first pose of a sheet, as its own picture. */
function firstCell(img: RgbaImage): Promise<Blob> {
  const cellW = Math.floor(img.width / 4);
  const c = document.createElement("canvas");
  c.width = cellW;
  c.height = img.height;
  c.getContext("2d")?.drawImage(
    canvasOf(img),
    0,
    0,
    cellW,
    img.height,
    0,
    0,
    cellW,
    img.height,
  );
  return pngOf(c);
}

/** Reads `file` as a character; throws an `ImportRefusal` in words. */
export async function readCharacterFile(file: Blob): Promise<ReadCharacter> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = inspectExchange(bytes, file.type);
  let img: RgbaImage;
  try {
    // The bytes are a checked PNG by now; a file the system gave no type
    // (or the wrong one) is still decoded as what it is.
    img = await decodePicture(
      new Blob([bytes], { type: "image/png" }),
      CUT_SETTINGS,
    );
  } catch {
    throw new ImportRefusal(
      "This picture could not be opened",
      "The file may be damaged. Ask for it again.",
    );
  }
  checkSheetPixels(img);
  return {
    name: info.name,
    steady: info.steady,
    describedAs: info.describedAs,
    note: info.note,
    framesBlob: new Blob([bytes], { type: "image/png" }),
    imageBlob: await firstCell(img),
  };
}

export interface ImportFlowDeps {
  /** Where a refusal is drawn. */
  readonly errBox: HTMLElement;
  /** Where the name is asked for. */
  readonly askBox: HTMLElement;
  /** "Choose another file" in the refusal card. */
  readonly chooseAgain: () => void;
  readonly toast: (message: string, error?: boolean) => void;
  /** Reads the file (`readCharacterFile`; a stand-in in tests). */
  readonly read?: (file: Blob) => Promise<ReadCharacter>;
}

function child<T extends HTMLElement>(root: HTMLElement, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`the card has no ${sel}`);
  return el;
}

/**
 * The flow for one file at a time: a refusal is drawn into the error card
 * (and toasted), a file without a name asks for one. Resolves to the
 * accepted file, or null (refused, or the question cancelled). A second
 * file while a question is open cancels that question.
 */
export function createImportFlow(
  deps: ImportFlowDeps,
): (file: Blob) => Promise<AcceptedCharacter | null> {
  const { errBox, askBox } = deps;
  const read = deps.read ?? readCharacterFile;
  let pendingAsk: ((v: AcceptedCharacter | null) => void) | null = null;
  return async (file) => {
    pendingAsk?.(null);
    errBox.hidden = true;
    askBox.hidden = true;
    let r: ReadCharacter;
    try {
      r = await read(file);
    } catch (e) {
      const known = e instanceof ImportRefusal;
      const title = known ? e.title : "This file did not work";
      const words = known
        ? e.words
        : "Something unexpected went wrong while reading it. Try again, or choose another file.";
      errBox.innerHTML = `<h3>${esc(title)}</h3><p>${esc(words)}</p><p class="small dim">Nothing was added.</p><div class="row"><button class="btn small" type="button" data-again>Choose another file</button><button class="link small" type="button" data-dismiss>Close</button></div>`;
      errBox.hidden = false;
      child(errBox, "[data-dismiss]").addEventListener(
        "click",
        () => (errBox.hidden = true),
      );
      child(errBox, "[data-again]").addEventListener("click", deps.chooseAgain);
      errBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
      deps.toast(`Not imported: ${title.toLowerCase()}`, true);
      return null;
    }
    if (r.name) return r;
    const url = URL.createObjectURL(r.imageBlob);
    askBox.innerHTML = `<div class="ask-head"><img class="thumb" alt="" src="${url}" /><div><b>This character has no name inside</b><p class="small dim">${esc(r.note || "The file is a good sheet, but its name did not come with it.")} What is it called?</p></div></div>
    <label class="field">Name<input type="text" maxlength="40" placeholder="For example: Ranger Rita" data-name /></label>
    <p class="field-msg" data-msg hidden>Give it a name first, at least one letter.</p>
    <div class="row"><button class="btn primary small" type="button" data-keep>Import it</button><button class="btn small" type="button" data-cancel>Cancel</button></div>`;
    askBox.hidden = false;
    const input = child<HTMLInputElement>(askBox, "[data-name]");
    input.focus({ preventScroll: true });
    askBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return new Promise((resolve) => {
      const done = (v: AcceptedCharacter | null): void => {
        if (pendingAsk === done) pendingAsk = null;
        askBox.hidden = true;
        URL.revokeObjectURL(url);
        resolve(v);
      };
      const keep = (): void => {
        const n = input.value.trim();
        if (!n) {
          child(askBox, "[data-msg]").hidden = false;
          input.focus();
          return;
        }
        done({ ...r, name: n });
      };
      pendingAsk = done;
      child(askBox, "[data-keep]").addEventListener("click", keep);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") keep();
      });
      child(askBox, "[data-cancel]").addEventListener("click", () => {
        done(null);
        deps.toast("Not imported");
      });
    });
  };
}
