/**
 * The pages' one way to open a draft namespace in this origin's private
 * file system (M6 E2c, the E2c plan review #4; lifted from `main.ts`): the
 * phone's creator draft and the desktop editor's both open through it.
 *
 * OPFS, not a file handle: the File System Access pickers do not exist on
 * Chrome for Android, which is the only device the creator's AR session
 * runs on - and the editor's draft lives in the same store, under its own
 * namespace (`editor/editor-draft.ts`).
 *
 * @see draft-store-root.ts.md
 */

import {
  openDraftNamespace,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";

/** The part of `navigator` the root needs. */
export interface DraftStoreNavigator {
  readonly storage?: {
    readonly getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
}

/**
 * Open (creating if needed) the draft namespace `key`, or resolve
 * undefined where there is no persistence: no OPFS, blocked site data, a
 * quota wall. Never rejects.
 */
export async function openDraftStore(
  nav: DraftStoreNavigator | undefined,
  key: string,
): Promise<DraftFileStore | undefined> {
  try {
    // `getDirectory()` can REJECT rather than simply be absent - a
    // private window, an embedded WebView, a non-secure origin.
    // `openDraftNamespace` carries its own try/catch precisely so a caller
    // never sees a throw, but this call sits outside it, and the rejection
    // would land in a `void`-ed continuation with no handler.
    const root = await nav?.storage?.getDirectory?.();
    return root === undefined ? undefined : await openDraftNamespace(root, key);
  } catch {
    return undefined;
  }
}
