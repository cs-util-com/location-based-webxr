/**
 * The long text's part of the editor's inspector, put together: the
 * writer (`long-text-writer.ts`) the inspector shows while a long text is
 * selected, the preview (`long-text-preview.ts`) over the 3D view, the
 * inspector's "Wider" width and the preview's own open state. The shell
 * asks it for the writer's node on each draw (`sync`) and hands it the
 * inspector's head buttons it owns (`act`).
 *
 * @see long-text-dock.ts.md
 */
import type { InspectorLongText } from "../editor-shell/inspector-model.js";
import type { TypedEditOutcome } from "../editor-shell/editor-shell.js";
import type { KeptStore } from "./kept-store.js";
import {
  createLongTextPreview,
  type LongTextPreview,
} from "./long-text-preview.js";
import {
  createLongTextWriter,
  type LongTextWriter,
} from "./long-text-writer.js";

/** The inspector's head buttons the long text owns. */
export const LONG_TEXT_ACTS = ["lt-preview", "lt-wide"] as const;
export type LongTextAct = (typeof LONG_TEXT_ACTS)[number];

export interface LongTextDockDeps {
  readonly document: Document;
  /** The 3D view's box (the preview is drawn over it). */
  readonly box: HTMLElement;
  /** The inspector's dock (it is made wider). */
  readonly inspectorRoot: HTMLElement;
  /** The tree (the preview keeps right of it). */
  readonly treeRoot: HTMLElement | null;
  readonly kept: KeptStore;
  readonly writeBody: (blockId: string, body: string) => TypedEditOutcome;
  readonly writeView: (blockId: string, view: string) => TypedEditOutcome;
  /** A tour file by its path. */
  readonly loadPicture: (path: string) => Promise<Blob>;
  readonly say: (text: string) => void;
  /** The dock's state changed outside a draw (the preview's own buttons). */
  readonly changed: () => void;
}

export interface LongTextDockState {
  readonly preview: boolean;
  readonly wide: boolean;
}

export interface LongTextDock {
  /** Follows the inspector's long text (null: none); the writer's node to
   *  show, or null. */
  sync(model: InspectorLongText | null): HTMLElement | null;
  state(): LongTextDockState;
  /** Runs a head button's act; false when it is not the long text's. */
  act(name: string): boolean;
  /** Text typed and not yet written goes into the tour now. */
  flush(): void;
}

export function createLongTextDock(deps: LongTextDockDeps): LongTextDock {
  let model: InspectorLongText | null = null;
  /** What the writer was last given (the shell draws 5 times a second). */
  let lastKey = "null";
  let preview: LongTextPreview | null = null;
  let previewOpen = true;
  let wide = false;
  let assets: readonly InspectorLongText["pictures"][number][] = [];

  const loadAsset = (id: string): Promise<Blob> => {
    const picture = assets.find((p) => p.id === id);
    return picture === undefined
      ? Promise.reject(new Error(`no tour file ${id}`))
      : deps.loadPicture(picture.path);
  };

  const content = (m: InspectorLongText, body: string) => ({
    over: m.over,
    title: m.title,
    body,
  });

  const ensurePreview = (): LongTextPreview => {
    if (preview === null) {
      preview = createLongTextPreview({
        document: deps.document,
        box: deps.box,
        inspector: deps.inspectorRoot,
        tree: deps.treeRoot,
        loadAsset,
        say: deps.say,
        onOpen: (open) => {
          previewOpen = open;
          deps.changed();
        },
      });
    }
    return preview;
  };

  const writer: LongTextWriter = createLongTextWriter({
    document: deps.document,
    kept: deps.kept,
    writeBody: deps.writeBody,
    writeView: deps.writeView,
    loadPicture: deps.loadPicture,
    say: deps.say,
    onText: (body) => {
      if (model !== null) preview?.show(content(model, body));
    },
    onShow: (from, to, body) => {
      preview?.flash(from, to, body);
    },
  });

  const relayout = () => {
    deps.inspectorRoot.classList.toggle("lw", model !== null);
    deps.inspectorRoot.classList.toggle("lw-wide", model !== null && wide);
    preview?.layout();
    // The inspector's width eases; the phone follows once it has.
    const win = deps.document.defaultView ?? globalThis;
    win.setTimeout(() => preview?.layout(), 200);
  };

  return {
    sync(next) {
      const key = JSON.stringify(next);
      if (key === lastKey) return next === null ? null : writer.node;
      lastKey = key;
      const was = model;
      model = next;
      writer.update(next);
      if (next === null) {
        if (was !== null) {
          preview?.destroy();
          preview = null;
          relayout();
        }
        return null;
      }
      assets = next.pictures;
      const p = ensurePreview();
      if (was === null) {
        p.setOpen(previewOpen);
        relayout();
      }
      p.show(content(next, writer.area.value), was?.blockId !== next.blockId);
      return writer.node;
    },
    state() {
      return { preview: previewOpen, wide };
    },
    act(name) {
      if (name === "lt-preview") {
        previewOpen = !previewOpen;
        preview?.setOpen(previewOpen);
        return true;
      }
      if (name === "lt-wide") {
        wide = !wide;
        relayout();
        return true;
      }
      return false;
    },
    flush() {
      writer.flush();
    },
  };
}
