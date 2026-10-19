/**
 * The tour's contact under a visitor's error message (tour editor plan
 * 2026-10-17-1816, W2, D15): when something goes wrong with a tour that
 * names a contact, the visitor is told who to ask, as a link (the words
 * in front of it are `index.html`'s). Pure; the page writes it
 * (`main.ts`).
 *
 * @see tour-contact.ts.md
 */

import { tourContactHref } from "gps-plus-slam-app-framework/ar/tour-details";

/** What the line shows: the link and its text. */
export interface ContactLink {
  readonly href: string;
  /** The address or link as the visitor reads it (no `mailto:`). */
  readonly label: string;
}

/** The contact as a link, or null without one a visitor may follow (the
 *  framework's check: an e-mail address or an http(s) link). */
export function contactLink(contact: string | undefined): ContactLink | null {
  if (contact === undefined) return null;
  const href = tourContactHref(contact);
  if (href === null) return null;
  return {
    href,
    // A web link is shown as the link it leads to (M4a review #4): the
    // visitor reads the very address they open.
    label: href.startsWith("mailto:")
      ? contact.trim().replace(/^mailto:/i, "")
      : href,
  };
}

/** The line's elements (structural, so the unit tests run in node). */
export interface TourContactDom {
  line: Pick<HTMLElement, "hidden">;
  link: Pick<HTMLAnchorElement, "href" | "textContent">;
}

/**
 * Show the contact while an error is said: `error` is the error box's
 * text (empty when no error shows), `contact` the open tour's.
 */
export function renderTourContact(
  dom: TourContactDom,
  error: string,
  contact: string | undefined,
): void {
  const link = error.trim() === "" ? null : contactLink(contact);
  dom.line.hidden = link === null;
  dom.link.href = link?.href ?? "";
  dom.link.textContent = link?.label ?? "";
}
