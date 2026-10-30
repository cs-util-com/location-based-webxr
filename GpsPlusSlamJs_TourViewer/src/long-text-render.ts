/**
 * A long text's body on the page: the tree `parseTourMarkdown` reads (the
 * framework's `ar/tour-markdown`) built into DOM nodes from a fixed list
 * of elements and attributes, with `createElement` and text nodes only -
 * never an HTML string, so no body can put markup of its own into the
 * page, by construction rather than by a sanitizer's settings.
 *
 * Links carry the attributes a visitor can trust and show their host
 * beside their text; a tap is handed to the caller (`createLinkGuard`
 * asks before one leaves an AR session). Pictures are not loaded here:
 * each stands in a holder showing its alt text, which
 * `long-text-pictures.ts` fills while it is near the view and within the
 * decode budget.
 *
 * @see long-text-render.ts.md
 */

import type {
  TourMarkdown,
  TourMdBlock,
  TourMdInline,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

/**
 * Every element the renderer makes, with the attributes it may carry
 * (the design §5.5; `span`, with none, is the alt text box of a picture
 * that cannot show, which the list there has no element for).
 */
export const LONG_TEXT_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  p: [],
  h3: [],
  h4: [],
  h5: [],
  ul: [],
  ol: ["start"],
  li: [],
  blockquote: [],
  em: [],
  strong: [],
  a: ["href", "target", "rel", "referrerpolicy"],
  img: ["src", "alt", "loading"],
  br: [],
  span: [],
};

/** A link the visitor tapped: its parsed target and the host shown. */
export interface LongTextLink {
  readonly href: string;
  readonly host: string;
}

/** A picture of the body, waiting in its holder (a `p` showing its alt
 *  text in a `span` until it is decoded). */
export interface LongTextPictureSlot {
  readonly asset: string;
  readonly alt: string;
  readonly holder: HTMLElement;
}

export interface RenderedLongText {
  readonly fragment: DocumentFragment;
  /** The body's pictures in document order (at most the parser's 20). */
  readonly pictures: readonly LongTextPictureSlot[];
}

export interface LongTextRenderDeps {
  readonly document: Document;
  /** A tap on a link; the caller decides whether it opens
   *  (`createLinkGuard`). */
  onLinkTap(event: MouseEvent, link: LongTextLink): void;
}

/** The text of an alt box: the alt text, or a word for a picture with
 *  none, so the box is never empty. */
export function altBoxText(alt: string): string {
  return alt === "" ? "picture" : alt;
}

/**
 * Builds a body's tree as DOM nodes. Never throws: a value that is not a
 * tree renders nothing. Headings render one level below the sheet's own
 * title (`#` as `h3`).
 */
export function renderLongText(
  doc: TourMarkdown,
  deps: LongTextRenderDeps,
): RenderedLongText {
  const d = deps.document;
  const pictures: LongTextPictureSlot[] = [];

  function inlines(parent: Node, list: readonly TourMdInline[]): void {
    for (const inline of list) parent.appendChild(inlineNode(inline));
  }

  function inlineNode(inline: TourMdInline): Node {
    switch (inline.kind) {
      case "text":
        return d.createTextNode(inline.text);
      case "softBreak":
        return d.createTextNode(" ");
      case "hardBreak":
        return d.createElement("br");
      case "pictureAlt": {
        const box = d.createElement("span");
        box.textContent = altBoxText(inline.alt);
        return box;
      }
      case "emphasis":
      case "strong": {
        const el = d.createElement(inline.kind === "strong" ? "strong" : "em");
        inlines(el, inline.children);
        return el;
      }
      case "link":
        return linkNode(inline.href, inline.host, inline.children);
    }
  }

  function linkNode(
    href: string,
    host: string,
    children: readonly TourMdInline[],
  ): Node {
    const a = d.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("referrerpolicy", "no-referrer");
    inlines(a, children);
    // A phone cannot hover: where the link goes is shown with its text.
    a.appendChild(d.createTextNode(` (${host})`));
    a.addEventListener("click", (event) => {
      deps.onLinkTap(event, { href, host });
    });
    return a;
  }

  function block(b: TourMdBlock): Node {
    switch (b.kind) {
      case "paragraph": {
        const p = d.createElement("p");
        inlines(p, b.inlines);
        return p;
      }
      case "heading": {
        const h = d.createElement(`h${String(b.level + 2)}`);
        inlines(h, b.inlines);
        return h;
      }
      case "list": {
        const list = d.createElement(b.ordered ? "ol" : "ul");
        if (b.ordered && b.start !== 1) {
          list.setAttribute("start", String(b.start));
        }
        for (const item of b.items) {
          const li = d.createElement("li");
          for (const child of item) li.appendChild(block(child));
          list.appendChild(li);
        }
        return list;
      }
      case "quote": {
        const q = d.createElement("blockquote");
        for (const child of b.blocks) q.appendChild(block(child));
        return q;
      }
      case "picture": {
        const holder = d.createElement("p");
        const box = d.createElement("span");
        box.textContent = altBoxText(b.alt);
        holder.appendChild(box);
        pictures.push({ asset: b.asset, alt: b.alt, holder });
        return holder;
      }
    }
  }

  const fragment = d.createDocumentFragment();
  const given: unknown = (doc as TourMarkdown | null | undefined)?.blocks;
  const blocks: readonly TourMdBlock[] = Array.isArray(given)
    ? (given as readonly TourMdBlock[])
    : [];
  for (const b of blocks) fragment.appendChild(block(b));
  return { fragment, pictures };
}

/** The question asked before a link leaves an AR session (design §5.3). */
export function leaveArQuestion(host: string): string {
  return `Open ${host}? You may lose your place in the AR view.`;
}

export interface LinkGuardDeps {
  /** An AR session runs now. */
  arActive(): boolean;
  /** Asks `leaveArQuestion(host)`; resolves true on yes. */
  ask(host: string): Promise<boolean>;
  /** Opens the page in a new tab, with no opener and no referrer. */
  open(href: string): void;
}

/**
 * The link tap handler: outside AR the link opens by itself (its own
 * `target` and `rel`); during an AR session the tap is held, the visitor
 * asked, and the page opened only on yes. A question that fails opens
 * nothing.
 */
export function createLinkGuard(
  deps: LinkGuardDeps,
): (event: MouseEvent, link: LongTextLink) => void {
  return (event, link) => {
    if (!deps.arActive()) return;
    event.preventDefault();
    deps.ask(link.host).then(
      (yes) => {
        if (yes) deps.open(link.href);
      },
      () => undefined,
    );
  };
}
