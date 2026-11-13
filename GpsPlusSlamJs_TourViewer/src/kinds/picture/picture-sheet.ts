/**
 * A picture's details sheet: what a tap on a picture in the world opens on
 * the page's screen (`WorldScreen`). The whole caption, the year, the
 * credit and, for a framed print, the picture itself; a cut-out's sheet is
 * its text only (the picture already stands in front of the visitor). The
 * sheet is where a picture's words are read: the plate and the tag in the
 * world are labels of it (`plate.ts`).
 *
 * A dialog by role, named by the picture's title (else "Picture"),
 * closed by its Close button, a tap on the dimmed backdrop or Escape.
 *
 * @see picture-sheet.ts.md
 */

/** What the sheet shows. */
export interface PictureSheetContent {
  readonly title?: string | undefined;
  readonly year?: string | undefined;
  readonly caption?: string | undefined;
  readonly credit?: string | undefined;
  /** The picture's plain description, the image's alternative text. */
  readonly alt?: string | undefined;
  /** The picture to show (an object URL); null: the text only. */
  readonly imageUrl: string | null;
}

/** Text that is there: not absent, not only blanks. */
function shown(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== "";
}

/**
 * Builds the sheet into `host` and returns its clean-up (the screen's
 * contract: run when the sheet goes). `close` is asked when the visitor
 * closes it.
 */
export function buildPictureSheet(
  host: HTMLElement,
  content: PictureSheetContent,
  close: () => void,
): () => void {
  const doc = host.ownerDocument;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const sheet = make("div", "picture-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute(
    "aria-label",
    shown(content.title) ? content.title.trim() : "Picture",
  );
  sheet.dataset["textOnly"] = String(content.imageUrl === null);
  const scrim = make("div", "picture-sheet-scrim");
  scrim.addEventListener("click", close);
  const card = make("div", "picture-sheet-card");
  const shut = make("button", "picture-sheet-close", "Close");
  shut.type = "button";
  shut.addEventListener("click", close);
  card.append(shut);
  if (content.imageUrl !== null) {
    const img = make("img", "picture-sheet-image");
    img.src = content.imageUrl;
    img.alt = shown(content.alt)
      ? content.alt
      : shown(content.caption)
        ? content.caption
        : "";
    card.append(img);
  }
  const meta = make("div", "picture-sheet-meta");
  if (shown(content.year))
    meta.append(make("div", "picture-sheet-year", content.year));
  if (shown(content.title))
    meta.append(make("h2", "picture-sheet-title", content.title));
  if (shown(content.caption))
    meta.append(make("p", "picture-sheet-caption", content.caption));
  if (shown(content.credit))
    meta.append(make("p", "picture-sheet-credit", content.credit));
  card.append(meta);
  sheet.append(scrim, card);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  doc.addEventListener("keydown", onKey);
  host.append(sheet);
  shut.focus();
  return () => {
    doc.removeEventListener("keydown", onKey);
    sheet.remove();
  };
}
