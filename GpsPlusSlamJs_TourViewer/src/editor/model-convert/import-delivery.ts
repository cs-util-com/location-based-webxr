/**
 * Where a converted model goes (`ImportDelivery` of
 * `model-import-runner.ts`): into the tour's files first, then where its
 * drop was made - the shelf for a drop on no row, else the item whose file
 * field it was dropped on, or a new item of the station or story whose
 * row it was dropped on. The page lends the edits and the words.
 *
 * @see import-delivery.ts.md
 */
import { FILE_ADD_FAILED } from "../add-file-item.js";
import type { FileDropTarget } from "../file-drop.js";
import type { ImportDelivery } from "./model-import-runner.js";

export interface ImportDeliveryDeps {
  /** Whether the tour the drop was made in is still open. */
  readonly open: () => boolean;
  /** The session's `addFile` for a model. */
  readonly addFile: (file: File) => Promise<
    | {
        readonly kind: "added";
        readonly asset: { readonly id: string };
        readonly backedUp: boolean;
      }
    | { readonly kind: "refused"; readonly reason: string }
  >;
  /** The file `assetId` used at `target` (one step), said by the page;
   *  a refusal there is said too, the model staying on the shelf. */
  readonly use: (
    target: FileDropTarget,
    assetId: string,
    fileName: string,
  ) => void;
  /** The file `assetId` is on the shelf, used nowhere yet: said, with
   *  the count of its conversion's notes (read on its card). */
  readonly shelved: (assetId: string, fileName: string, notes: number) => void;
  /** The draft could not keep a copy of it: said. */
  readonly notKept: () => void;
}

/** The delivery for a drop at `target` (null: on no row). */
export function importDelivery(
  target: FileDropTarget | null,
  deps: ImportDeliveryDeps,
): ImportDelivery {
  return async (file, about) => {
    if (!deps.open()) return { kind: "stopped" };
    let added: Awaited<ReturnType<ImportDeliveryDeps["addFile"]>>;
    try {
      added = await deps.addFile(file);
    } catch {
      added = { kind: "refused", reason: FILE_ADD_FAILED };
    }
    if (!deps.open()) return { kind: "stopped" };
    if (added.kind === "refused") return added;
    const id = added.asset.id;
    if (target === null) deps.shelved(id, file.name, about.notes.length);
    else deps.use(target, id, file.name);
    if (!added.backedUp) deps.notKept();
    return { kind: "added", id };
  };
}
