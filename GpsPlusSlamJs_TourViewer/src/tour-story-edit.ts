/**
 * A station's stories changed as folders, pure: a story added, renamed or
 * taken out, a child added to one or taken out of it. Works on anything
 * that holds children (a station, a creator's frame of one) and never
 * changes the rest of it. Each answers null for what it cannot do: an
 * unknown id, a title the format refuses. The document's reducers are the
 * only callers (`tour-document.ts`).
 *
 * @see tour-story-edit.ts.md
 */
import { checkTourBlockText } from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  isTourStory,
  TOUR_STORY_TITLE_RULE,
  type TourStationChild,
  type TourStory,
  type TourStoryChild,
} from "gps-plus-slam-app-framework/ar/tour-story";

interface Holder {
  readonly children: readonly TourStationChild[];
}

/** `title` as a story keeps it: trimmed; null when the format refuses it. */
function storyTitle(title: string): string | null {
  const text = title.trim();
  return checkTourBlockText(TOUR_STORY_TITLE_RULE, text).ok ? text : null;
}

/** An empty story; null for a title the format refuses. */
export function newStory(id: string, title: string): TourStory | null {
  const text = storyTitle(title);
  return text === null
    ? null
    : { id, kind: "story", title: text, children: [] };
}

/** `holder` with `story` after its stories, before its free blocks: where
 *  the writer lists it. */
export function withStory<H extends Holder>(holder: H, story: TourStory): H {
  const after = holder.children.reduce(
    (at, child, i) => (isTourStory(child) ? i + 1 : at),
    0,
  );
  return {
    ...holder,
    children: [
      ...holder.children.slice(0, after),
      story,
      ...holder.children.slice(after),
    ],
  };
}

/** `holder` with its story `id` given by `change`; null when it has none. */
function withStoryChanged<H extends Holder>(
  holder: H,
  id: string,
  change: (story: TourStory) => TourStory,
): H | null {
  if (!holder.children.some((c) => isTourStory(c) && c.id === id)) return null;
  return {
    ...holder,
    children: holder.children.map((c) =>
      isTourStory(c) && c.id === id ? change(c) : c,
    ),
  };
}

/** `holder` with the story `id` titled `title`; null for an unknown story
 *  or a title the format refuses. */
export function withStoryTitle<H extends Holder>(
  holder: H,
  id: string,
  title: string,
): H | null {
  const text = storyTitle(title);
  return text === null
    ? null
    : withStoryChanged(holder, id, (story) => ({ ...story, title: text }));
}

/** `holder` without the story `id`; null when it has none. */
export function withoutStory<H extends Holder>(
  holder: H,
  id: string,
): H | null {
  return holder.children.some((c) => isTourStory(c) && c.id === id)
    ? { ...holder, children: holder.children.filter((c) => c.id !== id) }
    : null;
}

/** `holder` with `child` at the end of its story `id`; null when it has
 *  none. */
export function withStoryChild<H extends Holder>(
  holder: H,
  id: string,
  child: TourStoryChild,
): H | null {
  return withStoryChanged(holder, id, (story) => ({
    ...story,
    children: [...story.children, child],
  }));
}

/** `child` with no `goto` naming `gone` (the answer goes on to the next
 *  child), and how many it dropped. */
function withoutGoto(
  child: TourStoryChild,
  gone: string,
): { readonly child: TourStoryChild; readonly answers: number } {
  if (child.kind !== "choice") return { child, answers: 0 };
  const named = child.options.filter((o) => o.goto === gone).length;
  if (named === 0) return { child, answers: 0 };
  return {
    child: {
      ...child,
      options: child.options.map((option) => {
        if (option.goto !== gone) return option;
        const { goto: _gone, ...rest } = option;
        return rest;
      }),
    },
    answers: named,
  };
}

/** `holder` without the story child `id`, the `goto`s naming it gone, and
 *  how many answers that changed; null for an id no story holds. */
export function withoutStoryChild<H extends Holder>(
  holder: H,
  id: string,
): { readonly frame: H; readonly answers: number } | null {
  const story = holder.children
    .filter(isTourStory)
    .find((s) => s.children.some((c) => c.id === id));
  if (story === undefined) return null;
  const kept = story.children
    .filter((c) => c.id !== id)
    .map((c) => withoutGoto(c, id));
  const frame = withStoryChanged(holder, story.id, (s) => ({
    ...s,
    children: kept.map((k) => k.child),
  }));
  if (frame === null) return null;
  return { frame, answers: kept.reduce((sum, k) => sum + k.answers, 0) };
}
