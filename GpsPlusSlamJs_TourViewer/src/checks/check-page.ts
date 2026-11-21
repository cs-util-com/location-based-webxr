/**
 * The one check page (`check.html?view=<name>`): a registry of the
 * prototype-parity views and the start that picks one by the URL. Each
 * view's module is loaded only when its view is asked for, so a view pays
 * for its own scene alone. See `check-page.ts.md`.
 */
import { guardSlidersIn } from "gps-plus-slam-app-framework/utils/slider-scroll-guard";

/** Where a view draws: the full-page root, and the screen host the
 *  visitor page keeps for its narration card (used by `then-now`). */
export interface CheckHosts {
  readonly root: HTMLElement;
  readonly cardHost: HTMLElement;
}

interface CheckView {
  /** The page's title while the view is shown. */
  readonly title: string;
  /** Loads the view's module and starts it in `hosts`. */
  readonly start: (hosts: CheckHosts) => Promise<void>;
}

/** The views, by the name `?view=` takes. */
export const CHECK_VIEWS = {
  lectern: {
    title: "Reading stand check",
    start: async ({ root }) =>
      (await import("./lectern-check.js")).startLecternCheck(root),
  },
  "long-text": {
    title: "Reading sheet check",
    start: async ({ root }) =>
      (await import("./long-text-check.js")).startLongTextCheck(root),
  },
  "then-now": {
    title: "Then and now check",
    // Its Swipe line is a range input: a vertical swipe that starts on it
    // must scroll the page, as on every page with a slider.
    start: async ({ root, cardHost }) => {
      guardSlidersIn(root.ownerDocument);
      (await import("./then-now-check.js")).startThenNowCheck(root, cardHost);
    },
  },
  "travelling-box": {
    title: "Travelling box check",
    start: async ({ root }) =>
      (await import("./travelling-box-check.js")).startTravellingBoxCheck(root),
  },
  "model-views": {
    title: "Model views check",
    start: async ({ root }) => {
      await import("../model-visitor.css");
      (await import("./model-views-check.js")).startModelViewsCheck(root);
    },
  },
  "character-views": {
    title: "Character views check",
    start: async ({ root }) =>
      (await import("./character-views-check.js")).startCharacterViewsCheck(
        root,
      ),
  },
} as const satisfies Readonly<Record<string, CheckView>>;

export type CheckViewName = keyof typeof CHECK_VIEWS;

/** The view the URL's `search` names with `view=`, or null for none or
 *  a name the registry does not have. */
export function checkViewOf(search: string): CheckViewName | null {
  const name = new URLSearchParams(search).get("view");
  return name !== null && Object.hasOwn(CHECK_VIEWS, name)
    ? (name as CheckViewName)
    : null;
}

/**
 * Starts the view `search` names: the body carries it as `data-view` (the
 * page's CSS gives each view its backdrop) and the title is the view's.
 * Without a known view the root lists the views as links, so a person who
 * opens the bare page can pick one. Rejects when the view's module fails
 * to load or start.
 */
export async function startCheckPage(
  doc: Document,
  search: string,
  hosts: CheckHosts,
): Promise<CheckViewName | null> {
  const name = checkViewOf(search);
  if (name === null) {
    doc.title = "Check pages";
    const list = doc.createElement("ul");
    list.className = "check-index";
    for (const key of Object.keys(CHECK_VIEWS)) {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      link.href = `?view=${key}`;
      link.textContent = key;
      item.append(link);
      list.append(item);
    }
    hosts.root.replaceChildren(list);
    return null;
  }
  const view = CHECK_VIEWS[name];
  doc.body.dataset["view"] = name;
  doc.title = view.title;
  await view.start(hosts);
  return name;
}
