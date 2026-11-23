/**
 * Station-tied scene content that stands as a root of a deferred anchor
 * (`gps-plus-slam-app-framework/ar/deferred-anchors`): a pose-free wrapper
 * group whose local matrix the anchor owns, its content (with its own
 * poses) inside it. The story figure shares its station's key
 * (`scene-stage.ts`), the walk's beacon and ring have one of their own
 * (`walk-focus-cues.ts`).
 *
 * @see anchor-root.ts.md
 */

import type { Object3D } from "three";
import { deferredAnchor } from "gps-plus-slam-app-framework/ar/deferred-anchors";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";

const log = createLogger("AnchorRoot");

/** A wrapper standing as a root of one deferred anchor's key. */
export interface AnchoredRoot {
  /** The anchor parent it stands under (the AR world group). */
  readonly parent: Object3D;
  /** The wrapper: identity until the anchor places it, never posed by
   *  the code that made it. */
  readonly root: Object3D;
  /** A part was added, removed or swapped under the wrapper. */
  boundsChanged(): void;
  /** Leave the anchor and the parent; the content stays in the wrapper. */
  release(): void;
}

/**
 * Stand `root` (a pose-free wrapper, its content already in it, so the
 * anchor's first bounds see it) as a root of key `key` under `parent`.
 * Null when it cannot (no alignment binding yet, a root nested in another
 * anchor): logged, and the caller stands its content on the scene root.
 * `onCommit` runs in the pass that places the key, so camera-relative
 * work can follow in that frame. `warn: false` skips the log, for a
 * caller that asks again after a refusal it already logged.
 */
export function anchorRoot(
  parent: Object3D,
  key: string,
  root: Object3D,
  onCommit?: () => void,
  { warn = true }: { readonly warn?: boolean } = {},
): AnchoredRoot | null {
  try {
    const anchor = deferredAnchor(parent, key);
    anchor.add(root, onCommit === undefined ? {} : { onCommit });
    return {
      parent,
      root,
      boundsChanged: () => {
        anchor.boundsChanged();
      },
      release: () => {
        anchor.remove(root);
        root.removeFromParent();
      },
    };
  } catch (error: unknown) {
    if (warn) log.warn(`"${key}" could not stand as an anchor`, error);
    root.removeFromParent();
    return null;
  }
}
