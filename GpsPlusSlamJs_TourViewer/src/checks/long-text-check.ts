/**
 * The reading sheet's check page (`long-text-check.html`): one long text
 * open in the production reading sheet (`long-text-sheet.ts`), with no
 * AR session, so the sheet can be put side by side with the narrated-text
 * prototype's "sound off" sheet and the layout e2e can pin where its parts
 * land. Linked from nothing. The e2e and the side-by-side check drive it
 * through `window.__longTextCheck`, which is always installed.
 *
 * `?text=rich` opens a body with headings, a nested list, a link and two
 * pictures served from files made in the page; `?ar=1` makes the sheet
 * behave as during an AR session (a link asks before it opens).
 *
 * @see long-text-check.ts.md
 */
import {
  createLongTextSheet,
  LONG_TEXT_MARK,
  type LongTextSheetContent,
  type LongTextSheetState,
} from "../long-text-sheet.js";
import { CHECK_TEXT } from "./lectern-check-text.js";

/** A part's box on the page (CSS px). */
interface PartRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The parts the layout e2e measures, by their `data-testid`. */
const PARTS = {
  sheet: "long-text-sheet",
  head: "long-text-head",
  over: "long-text-over",
  title: "long-text-title",
  meta: "long-text-meta",
  close: "long-text-close",
  wrap: "long-text-wrap",
  text: "long-text-text",
  foot: "long-text-foot",
  bar: "long-text-bar",
  prev: "long-text-prev",
  next: "long-text-next",
  position: "long-text-position",
  credit: "long-text-credit",
} as const;

type PartName = keyof typeof PARTS;

interface LongTextCheckState {
  readonly sheet: LongTextSheetState;
  readonly parts: Readonly<Record<PartName, PartRect | null>>;
  /** The text's first paragraph, as rendered. */
  readonly firstParagraph: PartRect | null;
  /** The space between its first and second paragraphs (px), or null. */
  readonly paragraphGap: number | null;
  readonly fontSize: number;
  readonly lineHeight: number;
  /** The reading mark is registered with the browser. */
  readonly highlightRegistered: boolean;
}

interface LongTextCheck {
  /** Open the sheet on a text (the prototype's by default). */
  show(content?: Partial<LongTextSheetContent>): void;
  goTo(i: number): void;
  state(): LongTextCheckState;
  /** The first line box of the marked sentence, or null. */
  markRect(): PartRect | null;
  /** Behave as during an AR session, or not (`?ar=1` starts it on). */
  setArActive(on: boolean): void;
  /** The links the sheet opened (only ever after a yes in AR). */
  opened(): readonly string[];
}

declare global {
  interface Window {
    __longTextCheck?: LongTextCheck;
  }
}

/** The check page's line above the title, as the prototype's. */
const CHECK_OVER = "Old market square · Station 1";

/** The picture assets of the rich text, by id. */
const CHECK_PICTURES = { mill: "#7b8f5a", bell: "#a0623c" } as const;

/**
 * The rich text (`?text=rich`): a heading, a nested list and a link on the
 * first screen; the two pictures several screens below it, so they are
 * decoded only once the sheet is scrolled near them.
 */
export const CHECK_RICH_BODY = [
  "# The square",
  "",
  "What stands here, **from the oldest**:",
  "",
  "- The keep",
  "  - its broken wall",
  "  - its first-floor door",
  "- The guild house",
  "",
  "See [the town map](https://town.example/map) for the way on.",
  "",
  CHECK_TEXT.body,
  "",
  CHECK_TEXT.body,
  "",
  "![The mill](asset:mill)",
  "",
  "## The hall",
  "",
  CHECK_TEXT.body,
  "",
  "![The bell](asset:bell)",
].join("\n");

/** What the page's query asks for. */
export function longTextCheckOptions(search: string): {
  readonly rich: boolean;
  readonly ar: boolean;
} {
  const query = new URLSearchParams(search);
  return { rich: query.get("text") === "rich", ar: query.get("ar") === "1" };
}

/** A small picture file of one colour, made in the page. */
function pictureFile(colour: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("the picture could not be made"));
      else resolve(blob);
    }, "image/png");
  });
}

/** The rich text's picture by asset id; refuses any other id. */
function loadCheckPicture(asset: string): Promise<Blob> {
  const colour = (CHECK_PICTURES as Record<string, string | undefined>)[asset];
  return colour === undefined
    ? Promise.reject(new Error(`the check page has no picture "${asset}"`))
    : pictureFile(colour);
}

function box(r: DOMRect | undefined): PartRect | null {
  return r === undefined
    ? null
    : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function rectOf(element: Element | null): PartRect | null {
  if (element === null || element.getClientRects().length === 0) return null;
  return box(element.getBoundingClientRect());
}

/** The browser's highlight registry, where it has one. */
function registry(): HighlightRegistry | undefined {
  return (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)
    ?.highlights;
}

export function startLongTextCheck(host: HTMLElement): void {
  const options = longTextCheckOptions(window.location.search);
  let arActive = options.ar;
  const opened: string[] = [];
  const sheet = createLongTextSheet({
    host,
    loadAsset: loadCheckPicture,
    arActive: () => arActive,
    openLink: (href) => {
      opened.push(href);
      window.open(href, "_blank", "noopener,noreferrer");
    },
  });
  const part = (name: PartName): Element | null =>
    sheet.element.dataset["testid"] === PARTS[name]
      ? sheet.element
      : sheet.element.querySelector(`[data-testid="${PARTS[name]}"]`);
  const show = (content: Partial<LongTextSheetContent> = {}): void => {
    sheet.show({
      over: content.over ?? CHECK_OVER,
      title: content.title ?? CHECK_TEXT.title,
      body: content.body ?? (options.rich ? CHECK_RICH_BODY : CHECK_TEXT.body),
      lang: content.lang ?? "en",
    });
  };
  window.__longTextCheck = {
    show,
    goTo: (i) => {
      sheet.goTo(i);
    },
    state() {
      const parts = Object.fromEntries(
        (Object.keys(PARTS) as PartName[]).map((name) => [
          name,
          rectOf(part(name)),
        ]),
      ) as Record<PartName, PartRect | null>;
      const text = part("text");
      const style = text === null ? null : getComputedStyle(text);
      const [first, second] = text?.querySelectorAll("p") ?? [];
      const gap =
        first === undefined || second === undefined
          ? null
          : second.getBoundingClientRect().top -
            first.getBoundingClientRect().bottom;
      return {
        sheet: sheet.state(),
        parts,
        firstParagraph: rectOf(first ?? null),
        paragraphGap: gap,
        fontSize: style === null ? 0 : parseFloat(style.fontSize),
        lineHeight: style === null ? 0 : parseFloat(style.lineHeight),
        highlightRegistered: registry()?.has(LONG_TEXT_MARK) ?? false,
      };
    },
    markRect() {
      const mark = registry()?.get(LONG_TEXT_MARK);
      const range = mark === undefined ? undefined : [...mark][0];
      return range instanceof Range ? box(range.getClientRects()[0]) : null;
    },
    setArActive: (on) => {
      arActive = on;
    },
    opened: () => [...opened],
  };
  show();
}
