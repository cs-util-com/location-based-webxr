/**
 * The long text's preview over the 3D view: a phone, 390 by 844 CSS
 * pixels scaled to fit the room left of the inspector, holding the
 * visitor's own reading sheet (`createLongTextSheet`) in a frame of its
 * own, so the sheet's phone layout (its media queries) is the one a
 * visitor sees. It follows the writer as the creator types, keeps its
 * scroll place while it does, and flashes the words a part shown as typed
 * stands for when the writer goes to it.
 *
 * @see long-text-preview.ts.md
 */
import sheetCss from "../../long-text-sheet.css?inline";
import {
  createLongTextSheet,
  type LongTextSheet,
  type LongTextSheetContent,
} from "../../long-text-sheet.js";
import { shellIcon } from "../editor-shell/shell-icons.js";

/** The phone's size in CSS pixels (a common phone held upright). */
export const PHONE_W = 390;
export const PHONE_H = 844;
/** The tallest the phone is drawn. */
export const PHONE_MAX_H = 760;
/** The narrowest the phone is drawn. */
export const PHONE_MIN_W = 180;
/** How long the flashed words stay lit. */
const FLASH_MS = 1400;
/** How long typing pauses before the preview follows. */
const PREVIEW_FOLLOW_MS = 140;
/** What a tap on a link in the preview says. */
const LINK_NOT_FOLLOWED =
  "Links open in the visitor's browser; not followed in the preview.";
/** The highlight's name in the frame. */
const FLASH_HIGHLIGHT = "lw-flash";

/**
 * The phone's drawn size: as tall as the room allows (at most
 * `PHONE_MAX_H`), narrowed to the room's width, never under
 * `PHONE_MIN_W`. `height` is the room's height under the head, `width`
 * its width. Bad numbers give the narrowest phone.
 */
export function phoneSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number; readonly scale: number } {
  const w0 = Number.isFinite(width) ? width : 0;
  const h0 = Number.isFinite(height) ? height : 0;
  let h = Math.min(h0, PHONE_MAX_H);
  let w = (h * PHONE_W) / PHONE_H;
  w = Math.max(Math.min(w, w0), PHONE_MIN_W);
  h = (w * PHONE_H) / PHONE_W;
  return { width: w, height: h, scale: w / PHONE_W };
}

/**
 * Where to find a part's words in the formatted text: its first line
 * without marks around it (at most 60 letters) and how often those words
 * come before it in the body (so the same words further on are not lit
 * instead). Null for a part with no words.
 */
export function flashTarget(
  body: string,
  from: number,
  to: number,
): { readonly needle: string; readonly nth: number } | null {
  if (typeof body !== "string") return null;
  const a = Math.max(0, Math.min(from, body.length));
  const b = Math.max(a, Math.min(to, body.length));
  const line = body.slice(a, b).split("\n")[0] ?? "";
  const needle = line.trim().slice(0, 60).trim();
  if (needle === "") return null;
  let nth = 0;
  let at = body.indexOf(needle);
  while (at !== -1 && at < a) {
    nth++;
    at = body.indexOf(needle, at + 1);
  }
  return { needle, nth };
}

/**
 * The `nth` place `needle` stands in `root`'s text, as a range; null when
 * it is not there as often (the formatted text dropped it).
 */
export function findText(
  root: Node,
  needle: string,
  nth: number,
): Range | null {
  const doc = root.ownerDocument;
  if (doc === null || needle === "") return null;
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    nodes.push(n as Text);
  }
  const all = nodes.map((t) => t.data).join("");
  let at = -1;
  for (let k = 0; k <= nth; k++) {
    at = all.indexOf(needle, at + 1);
    if (at === -1) {
      // Fewer than asked: the last one there is the best guess.
      if (k === 0) return null;
      at = all.lastIndexOf(needle);
      break;
    }
  }
  // A start on a boundary between two pieces is the next piece's first
  // letter, an end there the earlier piece's last.
  const place = (offset: number, end: boolean): [Text, number] | null => {
    let base = 0;
    for (const t of nodes) {
      const last = base + t.data.length;
      if (end ? offset <= last : offset < last) return [t, offset - base];
      base = last;
    }
    return null;
  };
  const start = place(at, false);
  const end = place(at + needle.length, true);
  if (start === null || end === null) return null;
  const range = doc.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  return range;
}

export interface LongTextPreviewDeps {
  readonly document: Document;
  /** The 3D view's box: the preview is drawn over it. */
  readonly box: HTMLElement;
  /** The inspector: the preview stands left of it. */
  readonly inspector: HTMLElement;
  /** The tree: the preview stays right of it while it shows. */
  readonly tree: HTMLElement | null;
  /** A tour file by its asset id (the sheet's pictures). */
  readonly loadAsset: (assetId: string) => Promise<Blob>;
  /** A passing line (the page's toast). */
  readonly say: (text: string) => void;
  /** The creator opened or closed the preview. */
  readonly onOpen: (open: boolean) => void;
}

export interface LongTextPreview {
  readonly element: HTMLElement;
  /** The text shown; `now`: at once, else after a pause in typing. */
  show(content: LongTextSheetContent, now?: boolean): void;
  /** Lights the words of `[from, to)` of `body`, scrolled into view. */
  flash(from: number, to: number, body: string): void;
  /** Names the text's view in the head ("Reading sign" until told). */
  setView(name: string): void;
  /** Shows or hides the phone (the "Preview" button shows instead). */
  setOpen(open: boolean): void;
  /** Places and sizes the phone for the room there is now. */
  layout(): void;
  destroy(): void;
}

/** The frame's page: a camera's grey sky and ground, the sheet over it. */
const PAGE_CSS = `
html,body{margin:0;height:100%;overflow:hidden}
body{background:linear-gradient(180deg,#b5c5d2 0,#e3e8eb 470px,#c3beb5 470px,#a39e94 100%);font-family:system-ui,sans-serif}
.lt-close{display:none!important}
::highlight(${FLASH_HIGHLIGHT}){background-color:rgba(242,180,90,.55);color:#fff}
`;

export function createLongTextPreview(
  deps: LongTextPreviewDeps,
): LongTextPreview {
  const doc = deps.document;
  const win = doc.defaultView ?? globalThis;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (className !== "") e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const element = el("section", "lw-pv");
  element.setAttribute("aria-label", "Preview on a phone");
  element.dataset["testid"] = "long-text-preview";
  const head = el("div", "lw-pvhead");
  const close = el("button", "ib");
  close.type = "button";
  close.title = "Close the preview";
  close.setAttribute("aria-label", "Close the preview");
  close.append(shellIcon("close"));
  const viewName = el("span", "lw-vn", "Reading sign");
  head.append(
    el("span", "lw-ttlh", "Preview"),
    viewName,
    el("span", "sp"),
    close,
  );
  const note = el(
    "div",
    "lw-pvnote",
    "What a visitor sees after tapping the sign.",
  );
  const phone = el("div", "lw-phone");
  const frame = el("iframe");
  frame.title = "The text as a visitor reads it";
  frame.setAttribute("tabindex", "-1");
  frame.width = String(PHONE_W);
  frame.height = String(PHONE_H);
  phone.append(frame);
  element.append(head, note, phone);

  const openButton = el("button", "lw-pv-open");
  openButton.type = "button";
  openButton.dataset["testid"] = "long-text-preview-open";
  openButton.append(shellIcon("eye"), "Preview");
  openButton.hidden = true;

  deps.box.append(element, openButton);

  let sheet: LongTextSheet | null = null;
  let mounted: Document | null = null;
  let content: LongTextSheetContent | null = null;
  let shown: LongTextSheetContent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let open = true;

  /** The sheet, mounted in the frame's page (again, when it was replaced). */
  function mount(): LongTextSheet | null {
    const d = frame.contentDocument;
    if (d === null) return null;
    if (sheet !== null && mounted === d) return sheet;
    sheet?.dispose();
    sheet = null;
    // Marked as mounted before it is written: a browser fires the frame's
    // load event inside `close()`, and the load handler must not mount a
    // second sheet into the page this call is still building.
    mounted = d;
    d.open();
    d.write(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    );
    d.close();
    // No link is followed from the preview: outside AR the visitor's
    // sheet lets a link open by itself, so the tap is held here.
    d.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest?.("a[href]") == null) return;
        event.preventDefault();
        deps.say(LINK_NOT_FOLLOWED);
      },
      true,
    );
    const style = d.createElement("style");
    style.textContent = `${sheetCss}\n${PAGE_CSS}`;
    d.head.append(style);
    shown = null;
    sheet = createLongTextSheet({
      host: d.body,
      loadAsset: (id) => deps.loadAsset(id),
      arActive: () => false,
      openLink: () => {
        deps.say(LINK_NOT_FOLLOWED);
      },
      // The sheet closed (Esc in the frame): a visitor would tap the sign
      // again, so it opens again.
      onClose: () => {
        win.setTimeout(() => {
          render(true);
        }, 0);
      },
    });
    return sheet;
  }

  function render(force = false): void {
    if (timer !== null) {
      win.clearTimeout(timer);
      timer = null;
    }
    if (!open || content === null) return;
    const s = mount();
    if (s === null) return;
    if (
      !force &&
      shown !== null &&
      shown.body === content.body &&
      shown.title === content.title &&
      shown.over === content.over &&
      s.isOpen()
    ) {
      return;
    }
    const wrap = mounted?.querySelector<HTMLElement>(".lt-wrap") ?? null;
    const keep = shown !== null && wrap !== null ? wrap.scrollTop : 0;
    s.show(content);
    shown = content;
    const after = mounted?.querySelector<HTMLElement>(".lt-wrap") ?? null;
    if (after !== null) after.scrollTop = keep;
  }

  frame.addEventListener("load", () => {
    if (frame.contentDocument !== mounted) render(true);
  });

  function setView(name: string): void {
    if (viewName.textContent !== name) viewName.textContent = name;
  }

  function setOpen(next: boolean): void {
    open = next;
    element.hidden = !next;
    openButton.hidden = next;
    if (next) {
      layout();
      render(true);
    }
  }

  close.addEventListener("click", () => {
    setOpen(false);
    deps.onOpen(false);
  });
  openButton.addEventListener("click", () => {
    setOpen(true);
    deps.onOpen(true);
  });

  function layout(): void {
    const box = deps.box.getBoundingClientRect();
    const insp = deps.inspector.getBoundingClientRect();
    const right = insp.width > 0 ? Math.max(0, box.right - insp.left) + 14 : 14;
    const tree = deps.tree?.getBoundingClientRect();
    const left =
      tree !== undefined && tree.width > 0
        ? Math.max(0, tree.right - box.left) + 10
        : 12;
    const top = 10;
    const headH = head.offsetHeight + note.offsetHeight + 12;
    const size = phoneSize(
      box.width - right - left,
      box.height - 2 * top - headH,
    );
    element.style.right = `${String(right)}px`;
    element.style.top = `${String(top)}px`;
    element.style.width = `${String(size.width)}px`;
    phone.style.width = `${String(size.width)}px`;
    phone.style.height = `${String(size.height)}px`;
    phone.style.setProperty("--lw-k", String(size.scale));
    frame.style.transform = `scale(${String(size.scale)})`;
    openButton.style.right = `${String(right)}px`;
    openButton.style.top = `${String(top)}px`;
  }

  const Observer = (win as { ResizeObserver?: typeof ResizeObserver })
    .ResizeObserver;
  const observer =
    Observer === undefined
      ? null
      : new Observer(() => {
          layout();
        });
  observer?.observe(deps.box);
  observer?.observe(deps.inspector);
  if (deps.tree !== null) observer?.observe(deps.tree);

  return {
    element,
    show(next, now = false) {
      content = next;
      if (now) {
        render();
        return;
      }
      if (timer !== null) win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        timer = null;
        render();
      }, PREVIEW_FOLLOW_MS);
    },
    flash(from, to, body) {
      if (!open) return;
      if (content !== null && content.body !== body) {
        content = { ...content, body };
      }
      render();
      const target = flashTarget(body, from, to);
      const d = mounted;
      const fw = d?.defaultView as
        | (Window & {
            Highlight?: new (...r: Range[]) => unknown;
            CSS?: { highlights?: Map<string, unknown> };
          })
        | null
        | undefined;
      const article = d?.querySelector(".lt-text") ?? null;
      if (target === null || article === null || fw == null) return;
      const range = findText(article, target.needle, target.nth);
      if (range === null) return;
      const registry = fw.CSS?.highlights;
      if (registry !== undefined && fw.Highlight !== undefined) {
        registry.set(FLASH_HIGHLIGHT, new fw.Highlight(range));
        if (flashTimer !== null) win.clearTimeout(flashTimer);
        flashTimer = win.setTimeout(() => {
          flashTimer = null;
          registry.delete(FLASH_HIGHLIGHT);
        }, FLASH_MS);
      }
      const wrap = d?.querySelector<HTMLElement>(".lt-wrap") ?? null;
      if (wrap !== null) {
        const r = range.getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        wrap.scrollTop = Math.max(
          0,
          wrap.scrollTop + r.top - w.top - wrap.clientHeight * 0.3,
        );
      }
    },
    setView,
    setOpen,
    layout,
    destroy() {
      if (timer !== null) win.clearTimeout(timer);
      if (flashTimer !== null) win.clearTimeout(flashTimer);
      observer?.disconnect();
      sheet?.dispose();
      sheet = null;
      element.remove();
      openButton.remove();
    },
  };
}
