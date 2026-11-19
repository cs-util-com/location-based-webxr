/**
 * The tour editor's Characters list: the characters in this tour (each
 * with Remove, and Undo after it), the characters kept on this device by
 * the character maker (each with "Add to tour"), a banner for the ones
 * that are new since the list last looked, "Make a character" and "Import
 * character...". The maker opens over the editor in a full-screen dialog
 * (the maker's own page in a same-origin frame).
 *
 * The only hand-off between the maker and the editor is the library on
 * this device: the list looks into it again when it opens, when the
 * maker's dialog closes, and when this tab comes back to the front (the
 * maker may have run in another tab). Adding copies a character's two
 * pictures into the tour, so the tour keeps it even if it is later
 * deleted from this device. The tour gives the character an id of its
 * own; the device's id (which tells when he was made) never enters the
 * tour. A device character counts as in the tour when the tour holds his
 * four poses (the same file, named by its bytes: `fileId`).
 *
 * The add menu's "Character" goes through `makeForTour`: the maker opens
 * on a new character, and once it closes the newest character saved
 * while it was open is added to the tour and handed back to be placed.
 *
 * @see characters-panel.ts.md
 */
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import { escapeHtml as esc } from "gps-plus-slam-app-framework/utils/escape-html";
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";

import { createImportFlow } from "../characters/character-import.js";
import type { CharacterLibrary } from "../characters/character-library.js";
import type { CharacterRecord } from "../characters/character-record.js";
import { cropThumb, whenMade } from "../characters/character-thumb.js";
import { busy, offerUndo } from "../characters/maker-ui.js";

type Refused = { readonly kind: "refused"; readonly reason: string };

/** What the list needs of the open tour (the editor session's). */
export interface CharactersPanelTour {
  characters(): readonly TourCharacter[];
  /** Brings both pictures in and declares the character under an id the
   *  tour mints: one step. Resolves with the declared character. */
  declare(input: {
    readonly name: string;
    readonly image: Blob;
    readonly frames: Blob;
  }): Promise<
    { readonly kind: "declared"; readonly character: TourCharacter } | Refused
  >;
  /** The id the tour gives a file's bytes (its assets are named by them). */
  fileId(file: Blob): Promise<string>;
  remove(id: string): { readonly kind: "removed" } | Refused;
  /** Declares again a character just removed (its pictures still held). */
  restore(character: TourCharacter): { readonly kind: "declared" } | Refused;
  /** A declared character's picture, for its thumbnail. */
  image(id: string): Promise<Blob | undefined>;
  /** The tour's name, for the maker's top bar. */
  title(): string;
}

/** Which library ids the editor has shown before, kept per browser. */
export interface SeenStore {
  read(): readonly string[] | null;
  write(ids: readonly string[]): void;
}

export interface CharactersPanelDom {
  readonly panel: HTMLDialogElement;
  readonly close: HTMLButtonElement;
  readonly tourList: HTMLUListElement;
  readonly tourCount: HTMLElement;
  readonly pickup: HTMLElement;
  readonly libList: HTMLUListElement;
  readonly libStatus: HTMLElement;
  readonly make: HTMLButtonElement;
  readonly importButton: HTMLButtonElement;
  readonly importFile: HTMLInputElement;
  readonly importError: HTMLElement;
  readonly importAsk: HTMLElement;
  readonly manage: HTMLButtonElement;
  readonly toasts: HTMLElement;
  readonly undoBox: HTMLElement;
  readonly maker: HTMLDialogElement;
  readonly makerFrame: HTMLIFrameElement;
  readonly makerBack: HTMLButtonElement;
  readonly makerTour: HTMLElement;
}

export interface CharactersPanelDeps {
  readonly dom: CharactersPanelDom;
  readonly tour: () => CharactersPanelTour | null;
  readonly library: () => Promise<CharacterLibrary>;
  /** The maker page, without a query ("./characters.html"). */
  readonly makerUrl: string;
  /** A passing line on the page, while the list is closed. */
  readonly say: (text: string) => void;
  readonly seen?: SeenStore;
  readonly now?: () => Date;
  /** The maker covers the page (true) or no longer does (false): the
   *  editor stops drawing its 3D view meanwhile. */
  readonly makerShown?: (shown: boolean) => void;
}

/** What `makeForTour` tells its caller on the way. */
interface MakeForTourHooks {
  /** The maker closed: shows `text` while the new character is looked
   *  for and added, and returns what takes it down again, which
   *  `makeForTour` calls once that settled, whatever the outcome. */
  readonly hold?: (text: string) => () => void;
}

/** What the page holds up from the maker's close until the add settled. */
const ADDING_CHARACTER = "Adding the character to the tour...";

export interface CharactersPanel {
  /** Shows the list and looks into the library. */
  open(): void;
  isOpen(): boolean;
  /** The maker or the list shows: the editor's keys stay out of it. */
  dialogOpen(): boolean;
  /** Opens the maker on a new character; once it closes, adds the newest
   *  character saved meanwhile to the tour and resolves with it (null:
   *  none was saved, or adding it was refused - said either way). */
  makeForTour(hooks?: MakeForTourHooks): Promise<TourCharacter | null>;
}

/** Where the editor remembers which characters it has shown. */
const SEEN_KEY = "characters:seen-in-editor";

/** `localStorage` as the seen store; nothing kept where it is blocked. */
function localSeenStore(storage: () => Storage = () => localStorage) {
  return {
    read(): readonly string[] | null {
      try {
        const raw = storage().getItem(SEEN_KEY);
        const ids: unknown = raw === null ? null : JSON.parse(raw);
        return Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : null;
      } catch {
        return null;
      }
    },
    write(ids: readonly string[]): void {
      try {
        storage().setItem(SEEN_KEY, JSON.stringify(ids));
      } catch {
        // private mode: every character reads as seen next time
      }
    },
  } satisfies SeenStore;
}

/** Why the list looked again, said with the time it did. */
type RelistReason = "open" | "closed" | "back" | "import";

const RELIST_WORDS: Readonly<Record<RelistReason, string>> = {
  open: "looked when this list opened, ",
  closed: "looked again when the maker closed, ",
  back: "looked again when you came back, ",
  import: "looked again after the import, ",
};

const ERROR_LINGER_MS = 9000;

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

const reasonOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export function createCharactersPanel(
  deps: CharactersPanelDeps,
): CharactersPanel {
  const { dom } = deps;
  const now = deps.now ?? (() => new Date());
  const seenStore = deps.seen ?? localSeenStore();
  const panelToast = createToast(dom.toasts);
  let seen: Set<string> | null = (() => {
    const ids = seenStore.read();
    return ids === null ? null : new Set(ids);
  })();
  let entries: CharacterRecord[] = [];
  /** Whether `entries` holds a finished look: before the first one the
   *  list cannot say the device has none. */
  let looked = false;
  /** The last look failed: with none finished, the list says so (the
   *  error toast fades, and a blank list says nothing). */
  let lookFailed = false;
  /** New on this device, offered in the banner. */
  let pending: CharacterRecord[] = [];
  const libThumbs = new Map<string, Promise<string>>();
  const tourThumbs = new Map<string, Promise<string>>();
  /** The maker's close, awaited by `makeForTour`. */
  let makerClosed: (() => void) | null = null;

  const isOpen = (): boolean => dom.panel.open;

  function toast(message: string, error = false): void {
    if (!isOpen()) {
      deps.say(message);
      return;
    }
    panelToast.show(
      message,
      error ? { className: "toast err", lingerMs: ERROR_LINGER_MS } : {},
    );
  }

  /** Each device character's four poses as the tour would name them,
   *  learnt once per character (his files never change once saved); null
   *  where they could not be read. A character not in it yet cannot be
   *  told in the tour or not, so his row offers no "Add to tour". */
  const sheetOf = new Map<string, string | null>();
  async function learnSheets(list: readonly CharacterRecord[]): Promise<void> {
    const tour = deps.tour();
    const todo = list.filter((e) => !sheetOf.has(e.libraryId));
    if (tour === null || todo.length === 0) return;
    const lib = await deps.library();
    for (const e of todo) {
      try {
        const files = await lib.files(e.libraryId);
        sheetOf.set(e.libraryId, await tour.fileId(files.frames));
      } catch {
        // Unread: shown as not in the tour; adding him says what failed.
        sheetOf.set(e.libraryId, null);
      }
    }
  }

  /** The tour's character made from the device's `libraryId`, if any. */
  const inTourAs = (libraryId: string): TourCharacter | undefined => {
    const sheet = sheetOf.get(libraryId);
    return sheet === undefined || sheet === null
      ? undefined
      : deps
          .tour()
          ?.characters()
          .find((c) => c.frames === sheet);
  };
  const inTour = (libraryId: string): boolean =>
    inTourAs(libraryId) !== undefined;

  function remember(): void {
    seenStore.write([...(seen ?? [])]);
  }

  /** The thumbnail of `key`, made once ("" where it cannot be). A
   *  failure is not kept: the next drawing of the row tries again. */
  function thumbOf(
    cache: Map<string, Promise<string>>,
    key: string,
    blob: () => Promise<Blob | undefined>,
  ): Promise<string> {
    let url = cache.get(key);
    if (url === undefined) {
      const made = (async () => {
        try {
          const b = await blob();
          return b === undefined ? "" : await cropThumb(b);
        } catch {
          return ""; // no thumbnail: the row shows the name only
        }
      })();
      url = made;
      cache.set(key, made);
      void made.then((got) => {
        if (got === "" && cache.get(key) === made) cache.delete(key);
      });
    }
    return url;
  }

  const THUMB_IMG = '<img class="thumb" alt="" />';

  /** Gives the row's thumbnail its picture once it is made. The rows never
   *  wait for it: cutting one from the full picture took seconds on a busy
   *  page, and a list that waited kept showing what it showed before. */
  function fillThumb(
    li: HTMLElement,
    cache: Map<string, Promise<string>>,
    key: string,
    blob: () => Promise<Blob | undefined>,
  ): void {
    void thumbOf(cache, key, blob).then((url) => {
      if (url) li.querySelector("img.thumb")?.setAttribute("src", url);
    });
  }

  function renderTour(): void {
    const tour = deps.tour();
    const chars = tour?.characters() ?? [];
    dom.tourCount.textContent =
      chars.length === 0
        ? ""
        : chars.length === 1
          ? "1 character"
          : `${String(chars.length)} characters`;
    if (tour === null || chars.length === 0) {
      dom.tourList.innerHTML =
        '<li class="empty-line">No character in this tour yet. Add one from this device below, or make one.</li>';
      return;
    }
    const rows = chars.map((c) => {
      const li = document.createElement("li");
      li.dataset["id"] = c.id;
      li.innerHTML = `${THUMB_IMG}<div class="who"><b>${esc(c.name)}</b><span class="meta"><span class="state">In this tour</span></span></div><div class="acts"><button class="btn small" type="button" data-remove>Remove</button></div>`;
      li.querySelector("[data-remove]")?.addEventListener("click", () => {
        removeFromTour(c);
      });
      fillThumb(li, tourThumbs, c.image, () => tour.image(c.id));
      return li;
    });
    dom.tourList.replaceChildren(...rows);
  }

  function renderLib(): void {
    if (entries.length === 0) {
      // Before the first look the status line says it is looking.
      dom.libList.innerHTML = looked
        ? '<li class="empty-line">No characters on this device yet.</li>'
        : lookFailed
          ? '<li class="empty-line">Could not look on this device.</li>'
          : "";
      return;
    }
    const fresh = new Set(pending.map((p) => p.libraryId));
    const rows = entries.map((e) => {
      const li = document.createElement("li");
      li.dataset["id"] = e.libraryId;
      if (fresh.has(e.libraryId)) li.classList.add("fresh");
      const state = inTour(e.libraryId)
        ? '<span class="state">In this tour</span>'
        : fresh.has(e.libraryId)
          ? '<span class="state info">New</span>'
          : e.autoName
            ? '<span class="state warn">No name yet</span>'
            : "";
      li.innerHTML = `${THUMB_IMG}<div class="who"><b>${esc(e.name)}</b><span class="meta">${state}<span>${esc(whenMade(e.createdAtIso, now()))}</span></span></div><div class="acts"></div>`;
      if (
        sheetOf.has(e.libraryId) &&
        !inTour(e.libraryId) &&
        deps.tour() !== null
      ) {
        const b = document.createElement("button");
        b.className = "btn small";
        b.type = "button";
        b.dataset["add"] = "";
        b.textContent = "Add to tour";
        b.addEventListener("click", () => void addToTour(e, b));
        li.querySelector(".acts")?.append(b);
      }
      fillThumb(
        li,
        libThumbs,
        e.libraryId,
        async () => (await (await deps.library()).files(e.libraryId)).image,
      );
      return li;
    });
    dom.libList.replaceChildren(...rows);
  }

  function renderPickup(): void {
    const box = dom.pickup;
    pending = pending.filter(
      (p) =>
        !inTour(p.libraryId) &&
        entries.some((e) => e.libraryId === p.libraryId),
    );
    box.hidden = pending.length === 0 || deps.tour() === null;
    if (box.hidden) return;
    const names = pending.map((p) => esc(p.name));
    const one = pending.length === 1;
    box.innerHTML = `<p><b>New on this device: ${listed(names)}.</b> ${one ? "Add it to this tour?" : "Add them to this tour?"}</p><div class="row"><button class="btn primary small" type="button" data-all>${one ? `Add ${names[0] ?? ""} to the tour` : `Add all ${String(pending.length)} to the tour`}</button><button class="btn small" type="button" data-later>Not now</button></div>`;
    const all = box.querySelector<HTMLButtonElement>("[data-all]");
    all?.addEventListener("click", () => void addAll(all));
    box.querySelector("[data-later]")?.addEventListener("click", () => {
      pending = [];
      renderAll();
    });
  }

  function renderAll(): void {
    renderTour();
    renderPickup();
    renderLib();
  }

  let relisting: Promise<void> | null = null;
  /** Looks into the library again: what is new since the last look joins
   *  the banner (on the first look ever, nothing is new). A call while a
   *  look runs joins it, unless `afresh`: then it looks again once that
   *  one is done (an import's save is newer than a look begun before it). */
  function relist(
    reason: RelistReason,
    quiet = false,
    afresh = false,
  ): Promise<void> {
    if (afresh && relisting !== null) {
      return relisting.then(() => relist(reason, quiet, true));
    }
    relisting ??= (async () => {
      dom.libStatus.textContent = "Looking on this device...";
      try {
        const res = await (await deps.library()).list();
        entries = [...res.entries];
        looked = true;
        lookFailed = false;
        // The rows show now, the thumbnails and the poses following: a
        // row whose poses are not known yet offers no "Add to tour".
        renderLib();
        await learnSheets(entries);
        const first = seen === null;
        const known = seen ?? new Set<string>();
        seen = known;
        const fresh = entries.filter(
          (e) => !known.has(e.libraryId) && !inTour(e.libraryId),
        );
        if (!first) {
          for (const f of fresh) {
            if (!pending.some((p) => p.libraryId === f.libraryId)) {
              pending.push(f);
            }
          }
        }
        for (const e of entries) known.add(e.libraryId);
        remember();
        const t = now().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        dom.libStatus.textContent = `${RELIST_WORDS[reason]}${t}`;
        renderAll();
        if (reason === "closed" && fresh.length === 0 && !quiet) {
          toast("Nothing new on this device");
        }
      } catch (e) {
        dom.libStatus.textContent = "";
        lookFailed = true;
        renderLib();
        toast(
          `The characters on this device could not be read: ${reasonOf(e)}`,
          true,
        );
      }
    })().finally(() => {
      relisting = null;
    });
    return relisting;
  }

  /** The newest character saved since the library held `before`, added
   *  to the tour (or the one the tour holds already); null where none was
   *  saved or the add was refused (said). */
  async function addMadeMeanwhile(
    before: ReadonlySet<string>,
  ): Promise<TourCharacter | null> {
    let made: CharacterRecord | undefined;
    try {
      const listing = await (await deps.library()).list();
      made = listing.entries
        .filter((e) => !before.has(e.libraryId))
        .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))[0];
    } catch (e) {
      toast(
        `The characters on this device could not be read: ${reasonOf(e)}`,
        true,
      );
      return null;
    }
    if (made === undefined) {
      toast("No new character was saved, so nothing was added");
      return null;
    }
    (seen ??= new Set()).add(made.libraryId);
    remember();
    await learnSheets([made]);
    return inTourAs(made.libraryId) ?? (await addToTour(made, null, true));
  }

  /** Adds a library character to the tour; the button (if any) shows the
   *  work. Resolves with the declared character, or null (said); `quiet`
   *  leaves the success to the caller to say. */
  async function addToTour(
    e: CharacterRecord,
    button: HTMLButtonElement | null,
    quiet = false,
  ): Promise<TourCharacter | null> {
    return busy(button, "Adding...", async () => {
      const tour = deps.tour();
      if (tour === null) return null;
      try {
        const files = await (await deps.library()).files(e.libraryId);
        const out = await tour.declare({
          name: e.name,
          image: files.image,
          frames: files.frames,
        });
        if (out.kind === "refused") {
          toast(`${e.name} was not added: ${out.reason}`, true);
          return null;
        }
        if (out.character.frames !== undefined) {
          sheetOf.set(e.libraryId, out.character.frames);
        }
        pending = pending.filter((p) => p.libraryId !== e.libraryId);
        renderAll();
        if (!quiet) toast(`${e.name} is in this tour now`);
        return out.character;
      } catch (err) {
        toast(`Adding did not work: ${reasonOf(err)}. Try again.`, true);
        return null;
      }
    });
  }

  async function addAll(button: HTMLButtonElement): Promise<void> {
    const list = [...pending];
    await busy(button, "Adding...", async () => {
      for (const e of list) await addToTour(e, null);
    });
  }

  function removeFromTour(c: TourCharacter): void {
    const tour = deps.tour();
    if (tour === null) return;
    const out = tour.remove(c.id);
    if (out.kind === "refused") {
      toast(out.reason, true);
      return;
    }
    renderAll();
    offerUndo(
      dom.undoBox,
      `${c.name} is no longer in this tour. It stays on this device.`,
      () => {
        const back = deps.tour()?.restore(c);
        if (back?.kind === "refused") toast(back.reason, true);
        renderAll();
      },
    );
  }

  // ---------------------------------------------------------- the maker

  function openMaker(startNew: boolean): Promise<void> {
    dom.makerFrame.src = `${deps.makerUrl}?in=editor${startNew ? "&start=new" : ""}`;
    dom.makerTour.textContent = deps.tour()?.title() ?? "";
    dom.maker.showModal();
    deps.makerShown?.(true);
    return new Promise((resolve) => {
      makerClosed = resolve;
    });
  }
  dom.make.addEventListener("click", () => {
    void openMaker(true);
  });
  dom.manage.addEventListener("click", () => {
    void openMaker(false);
  });
  dom.makerBack.addEventListener("click", () => {
    dom.maker.close();
  });
  // A key pressed in the maker goes to the frame's own document, so the
  // dialog's Escape never sees it: Escape there leaves like "Back to the
  // tour", unless the maker used the key itself.
  dom.makerFrame.addEventListener("load", () => {
    let inner: Document | null;
    try {
      inner = dom.makerFrame.contentDocument;
    } catch {
      inner = null;
    }
    inner?.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && dom.maker.open) {
        dom.maker.close();
      }
    });
  });
  dom.maker.addEventListener("close", () => {
    dom.makerFrame.src = "about:blank";
    deps.makerShown?.(false);
    const waiting = makerClosed;
    makerClosed = null;
    waiting?.();
    if (isOpen()) void relist("closed");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isOpen() && !dom.maker.open) {
      void relist("back");
    }
  });

  // ------------------------------------------------- "Import character..."

  const importFlow = createImportFlow({
    errBox: dom.importError,
    askBox: dom.importAsk,
    chooseAgain: () => dom.importFile.click(),
    toast,
    during: (phase, work) =>
      busy(
        dom.importButton,
        phase === "reading" ? "Reading the file..." : "Waiting for a name...",
        work,
      ),
  });
  // A name question left open would keep Import disabled for good.
  dom.panel.addEventListener("close", () => {
    importFlow.cancel();
  });
  dom.importButton.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", () => {
    const f = dom.importFile.files?.[0];
    dom.importFile.value = "";
    if (f) void importCharacter(f);
  });

  async function importCharacter(file: Blob): Promise<void> {
    const button = dom.importButton;
    const r = await importFlow(file);
    if (r === null) return;
    await busy(button, "Importing...", async () => {
      try {
        const lib = await deps.library();
        const rec = await lib.save({
          name: r.name,
          steady: r.steady,
          describedAs: r.describedAs,
          frames: r.framesBlob,
          image: r.imageBlob,
        });
        (seen ??= new Set()).add(rec.libraryId);
        remember();
        entries = [...(await lib.list()).entries];
        looked = true;
        const added = await addToTour(rec, null, true);
        if (added !== null) {
          toast(
            `Imported ${rec.name}: it is in this tour, and kept on this device`,
          );
        }
      } catch (e) {
        toast(`Importing did not work: ${reasonOf(e)}`, true);
      }
    });
    await relist("import", false, true);
  }

  dom.close.addEventListener("click", () => {
    dom.panel.close();
  });

  return {
    open() {
      if (!isOpen()) dom.panel.showModal();
      importFlow.cancel();
      dom.importError.hidden = true;
      dom.importAsk.hidden = true;
      renderAll();
      void relist("open");
    },
    isOpen,
    dialogOpen: () => isOpen() || dom.maker.open,
    async makeForTour(hooks) {
      if (deps.tour() === null) return null;
      let before: Set<string>;
      try {
        const listing = await (await deps.library()).list();
        before = new Set(listing.entries.map((e) => e.libraryId));
      } catch (e) {
        toast(
          `The characters on this device could not be read: ${reasonOf(e)}`,
          true,
        );
        return null;
      }
      await openMaker(true);
      const release = hooks?.hold?.(ADDING_CHARACTER) ?? (() => {});
      try {
        return await addMadeMeanwhile(before);
      } catch (e) {
        toast(`The character was not added: ${reasonOf(e)}`, true);
        return null;
      } finally {
        release();
      }
    },
  };
}
