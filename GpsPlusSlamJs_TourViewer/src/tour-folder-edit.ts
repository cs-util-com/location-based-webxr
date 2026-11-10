/**
 * The plain folders of a station's frame as the editor changes them: a
 * folder added, changed, taken out (its folders lifted into its holder,
 * or dropped with it), and the refusals a page says before it asks the
 * tour document. A frame's folders hold no blocks (`tour-content.ts`
 * `frameChildren`): the items are the document's objects, each naming
 * the folders it stands in, so every function here works on the folder
 * tree alone and keeps every folder's place in the world.
 */
import { checkTourBlockText } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { composeTourFolderPose } from "gps-plus-slam-app-framework/ar/tour-folder-pose";
import {
  isTourFolder,
  TOUR_FOLDER_TITLE_RULE,
  type TourFolder,
  type TourStationChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

/** Why a folder edit is not possible where it was asked. */
export type FolderRefusal =
  /** A story stays at its station's top: never inside a folder. */
  | "storyIntoFolder"
  /** A story holds blocks only, never a folder. */
  | "folderIntoStory"
  /** A folder cannot hold itself, or a folder inside it. */
  | "folderIntoItself"
  /** The editor groups one level deep: no folder inside a folder. */
  | "oneLevel"
  /** Items of several stations, or something that is no item. */
  | "notHere"
  /** An item would stand past the format's 10 km bound in its folder. */
  | "tooFar"
  /** A folder's item stays in its station (a folder belongs to one). */
  | "staysInStation"
  /** The folder is no longer in the tour (an undo since it was picked). */
  | "gone";

/** What a page says for a refused folder edit. */
export const FOLDER_NOT_POSSIBLE = "Not possible here";

const REASONS: Readonly<Record<FolderRefusal, string>> = {
  storyIntoFolder: "a story stays at its station's top.",
  folderIntoStory: "a story holds no folders.",
  folderIntoItself: "a folder cannot go into itself.",
  oneLevel:
    "folders hold items, not other folders. Take the items out of their folder first.",
  notHere: "a folder holds items of one station.",
  tooFar: "an item would stand more than 10 km from its folder.",
  staysInStation:
    "an item in a folder stays in its station. Take it out of its folder first.",
  gone: "that folder is no longer in the tour.",
};

/** The line a page shows for `reason`: "Not possible here" and why. */
export function folderRefusalLine(reason: FolderRefusal): string {
  return `${FOLDER_NOT_POSSIBLE}: ${REASONS[reason]}`;
}

/** A folder's title as written (trimmed), or null for one the format
 *  refuses: blank, or over `TOUR_FOLDER_TITLE_RULE`'s cap. */
export function folderTitle(title: string): string | null {
  const text = title.trim();
  return checkTourBlockText(TOUR_FOLDER_TITLE_RULE, text).ok ? text : null;
}

/** `children` with the plain folder `id`, at any depth, changed by
 *  `change`; the same array when none is. */
export function withFolder(
  children: readonly TourStationChild[],
  id: string,
  change: (folder: TourFolder) => TourFolder,
): TourStationChild[] {
  let hit = false;
  const next = children.map((child): TourStationChild => {
    if (!isTourFolder(child)) return child;
    if (child.id === id) {
      hit = true;
      return change(child);
    }
    const inner = withFolder(child.children, id, change);
    if (inner === child.children) return child;
    hit = true;
    return { ...child, children: inner as TourFolder["children"] };
  });
  return hit ? next : (children as TourStationChild[]);
}

/** `children` with `folder` added at the end of the folder `into` (at
 *  any depth), or of `children` themselves when `into` is absent; the
 *  same array when `into` names no folder there. */
export function withFolderAdded(
  children: readonly TourStationChild[],
  folder: TourFolder,
  into?: string,
): TourStationChild[] {
  if (into === undefined) return [...children, folder];
  return withFolder(children, into, (holder) => ({
    ...holder,
    children: [...holder.children, folder],
  }));
}

/**
 * `children` without the plain folder `id` (at any depth). With `lift`,
 * its own folders take its place in its holder, each at the pose that
 * keeps it where it stood (its pose composed with the removed folder's);
 * without, they go with it. The same array when no folder has the id.
 */
export function withoutFolder(
  children: readonly TourStationChild[],
  id: string,
  lift: boolean,
): TourStationChild[] {
  let hit = false;
  const next = children.flatMap((child): TourStationChild[] => {
    if (!isTourFolder(child)) return [child];
    if (child.id === id) {
      hit = true;
      if (!lift) return [];
      return child.children.filter(isTourFolder).map((inner) =>
        child.pose === undefined
          ? inner
          : {
              ...inner,
              pose: composeTourFolderPose(child, inner.pose ?? IDENTITY_POSE),
            },
      );
    }
    const inner = withoutFolder(child.children, id, lift);
    if (inner === child.children) return [child];
    hit = true;
    return [{ ...child, children: inner as TourFolder["children"] }];
  });
  return hit ? next : (children as TourStationChild[]);
}

const IDENTITY_POSE = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
} as const satisfies TourFolder["pose"];
