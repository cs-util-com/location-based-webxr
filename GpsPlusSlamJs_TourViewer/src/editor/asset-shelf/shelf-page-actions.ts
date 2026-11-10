/**
 * The page's side of the shelf's commands: "Add files..." (the picker,
 * then each file read and listed), the delete of a file in use and
 * "Replace everywhere" - each with its busy toast while it reads, its
 * outcome said, a failure said and nothing left half done. The page
 * (`edit-main.ts`) hands in its toasts, picker and Undo offer; the
 * session (`editor-session.ts`) does the edits.
 *
 * @see shelf-page-actions.ts.md
 */
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { FILE_ADD_FAILED, FILE_NOT_KEPT } from "../add-file-item.js";
import type { EditorSession } from "../editor-session.js";

/** The session as the shelf's page commands use it. */
export type ShelfPageSession = Pick<
  EditorSession,
  "addFile" | "assetOf" | "deleteFileAndUses" | "replaceFile"
>;

/** Said for a file the shelf no longer holds. */
export const NOT_ON_SHELF = "That file is no longer on the shelf.";

export interface ShelfPageDeps {
  /** The session open now; another one once the tour changed. */
  readonly current: () => unknown;
  /** A toast, with a button when `action` is given (an Undo). */
  readonly toast: (
    text: string,
    action?: { readonly label: string; readonly run: () => void },
  ) => void;
  /** A toast that stays until removed (a busy state), with its test id. */
  readonly busy: (text: string, testId: string) => { remove(): void };
  readonly pick: (kind: TourAssetKind) => Promise<File | null>;
  readonly pickMany: () => Promise<File[]>;
  /** Brings the file's card into sight. */
  readonly reveal: (id: string) => void;
  /** After an edit: the page redrawn. */
  readonly refresh: () => void;
  /** Ends an open Undo offer (a new step comes). */
  readonly endUndo: () => void;
  /** The toast `said` of the step just made, with its Undo. */
  readonly offerUndo: (said: string) => void;
  /** After a delete: the selection gone, the page redrawn and `said` with
   *  its Undo, or the refusal said. */
  readonly deleted: (
    outcome: { readonly kind: "refused"; readonly reason: string } | object,
    said: string,
  ) => void;
  /** The shelf card's name of the file `id`. */
  readonly nameOf: (id: string) => string | undefined;
}

export interface ShelfPageActions {
  /** "Add files...": the picker, then `addToShelf`; a picker failure said. */
  addFiles(open: ShelfPageSession): Promise<void>;
  /** Files put on the shelf, used nowhere yet. */
  addToShelf(open: ShelfPageSession, files: readonly File[]): Promise<void>;
  /** The delete of the file `id` in use, after its confirm. */
  deleteInUse(open: ShelfPageSession, id: string): void;
  /** "Replace everywhere" of the file `id`; settled once all is said. */
  replaceEverywhere(open: ShelfPageSession, id: string): Promise<void>;
}

export function createShelfPageActions(deps: ShelfPageDeps): ShelfPageActions {
  const { toast } = deps;

  async function addToShelf(
    open: ShelfPageSession,
    files: readonly File[],
  ): Promise<void> {
    if (deps.current() !== open || files.length === 0) return;
    let added: string | null = null;
    let count = 0;
    let backedUp = true;
    // While the files are read, a toast says so (the async-UI rule).
    const shown = deps.busy(
      files.length === 1
        ? `Adding "${files[0]?.name ?? ""}"...`
        : `Adding ${String(files.length)} files...`,
      "shelf-add-busy",
    );
    try {
      for (const file of files) {
        let outcome: Awaited<ReturnType<ShelfPageSession["addFile"]>>;
        try {
          outcome = await open.addFile(file, file.name);
        } catch {
          outcome = { kind: "refused", reason: FILE_ADD_FAILED };
        }
        if (deps.current() !== open) return;
        if (outcome.kind === "refused") {
          toast(`${file.name}: ${outcome.reason}`);
          continue;
        }
        added = outcome.asset.id;
        count += 1;
        if (!outcome.backedUp) backedUp = false;
      }
    } finally {
      shown.remove();
    }
    if (added === null) return;
    deps.reveal(added);
    toast(
      count === 1
        ? "The file is on the shelf."
        : `${String(count)} files are on the shelf.`,
    );
    if (!backedUp) toast(FILE_NOT_KEPT);
  }

  return {
    async addFiles(open) {
      let files: File[];
      try {
        files = await deps.pickMany();
      } catch {
        toast(FILE_ADD_FAILED);
        return;
      }
      await addToShelf(open, files);
    },
    addToShelf,
    deleteInUse(open, id) {
      if (deps.current() !== open) return;
      deps.endUndo();
      const name = deps.nameOf(id) ?? "The file";
      const outcome = open.deleteFileAndUses(id);
      if (outcome.kind === "deleted" && outcome.undo !== undefined) {
        // Nothing of the tour used it after all: no step was made, only
        // its card went, and the card's own Undo brings it back, as the
        // plain delete's does.
        deps.refresh();
        toast(`Deleted ${name}.`, { label: "Undo", run: outcome.undo });
        return;
      }
      // The confirm said what goes; the toast names the file, with its
      // Undo.
      deps.deleted(outcome, `Deleted ${name}.`);
    },
    async replaceEverywhere(open, id) {
      const asset = open.assetOf(id);
      if (asset === undefined) {
        toast(NOT_ON_SHELF);
        return;
      }
      let picked: File | null;
      try {
        picked = await deps.pick(asset.kind);
      } catch {
        toast(FILE_ADD_FAILED);
        return;
      }
      if (picked === null || deps.current() !== open) return;
      const shown = deps.busy(
        `Reading "${picked.name}"...`,
        "replace-everywhere-busy",
      );
      deps.endUndo();
      let outcome: Awaited<ReturnType<ShelfPageSession["replaceFile"]>>;
      try {
        outcome = await open.replaceFile(id, picked, picked.name);
      } catch {
        outcome = { kind: "refused", reason: FILE_ADD_FAILED };
      } finally {
        shown.remove();
      }
      if (deps.current() !== open) return;
      deps.refresh();
      if (outcome.kind === "refused") {
        toast(outcome.reason);
        return;
      }
      const n = outcome.items;
      deps.offerUndo(
        `"${picked.name}" is used in ${String(n)} place${n === 1 ? "" : "s"} now.`,
      );
      if (!outcome.backedUp) toast(FILE_NOT_KEPT);
    },
  };
}
