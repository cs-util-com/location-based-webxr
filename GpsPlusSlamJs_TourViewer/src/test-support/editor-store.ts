/**
 * A store an editor session runs on (`EditorSessionStore`): the tour
 * viewer's, with the editor's own slices. Test-only.
 */
import {
  EDITOR_SESSION_SLICES,
  type EditorSessionStore,
} from "../editor/editor-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";

export function editorStore(): EditorSessionStore {
  return createTourViewerStore(undefined, EDITOR_SESSION_SLICES);
}
