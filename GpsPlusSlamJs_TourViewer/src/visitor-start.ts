/**
 * What the visitor's start page shows about the tour (polish round M4a:
 * the owner's V4 - the tour's name large, one line under it, one cover
 * photo - D-R12/D-R14). Pure: the page writes it and loads the photo.
 *
 * @see visitor-start.ts.md
 */

import { tourCoverEntry } from "gps-plus-slam-app-framework/ar/tour-details";
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { NOT_FINISHED, tourUnfinished } from "./tour-unfinished.js";

export interface VisitorStartView {
  /** The tour's name; "An AR tour" when it has none (yet). */
  title: string;
  /** "3 places to discover" (its stations), "This tour is not finished
   *  yet." for a zip without tour.json or a tour without stations, or null
   *  with no tour open. */
  subline: string | null;
  /** The tour's description (W2 of the tour editor plan), trimmed; null
   *  for none. */
  description: string | null;
  /** The cover: the one the creator chose (W2), else the tour's first
   *  placed photo, as an archive path; or null - never a debug camera
   *  capture. */
  coverPath: string | null;
  /** The tab's title, which a shared link's title shows too: the tour's
   *  name, else the app's. */
  pageTitle: string;
}

/** The page's own title (`index.html`), for a tour without a name. */
const APP_TITLE = "Tour Viewer";

/** A tour without a name still reads as a tour. */
const UNNAMED = "An AR tour";

/** "N places to discover": a tour counts its stations (the pins and photos
 *  they show are not places of their own; since version 3 every pin and
 *  photo is in one). A tour without stations is not finished yet. */
function sublineFor(manifest: TourManifest): string {
  if (tourUnfinished(manifest)) return NOT_FINISHED;
  const count = manifest.stations.length;
  return `${String(count)} ${count === 1 ? "place" : "places"} to discover`;
}

/** No tour open: the page's defaults, nothing said about a tour. */
const NO_TOUR: VisitorStartView = {
  title: UNNAMED,
  subline: null,
  description: null,
  coverPath: null,
  pageTitle: APP_TITLE,
};

/** The chosen cover, else the first placed photo; never a debug camera
 *  capture (a visitor never sees one). */
function coverPathOf(manifest: TourManifest): string | null {
  const items = tourObjects(manifest);
  const chosen = tourCoverEntry({
    objects: items,
    assets: manifest.assets,
    ...(manifest.cover === undefined ? {} : { cover: manifest.cover }),
  });
  if (chosen !== null) return chosen;
  for (const object of items) {
    if (object.kind === "picture" && object.imageAsset !== undefined)
      return object.imageAsset.path;
  }
  return null;
}

/** What the start page shows for an open tour: `manifest` is its
 *  `tour.json`, null for a zip without one (a tour not finished yet). */
export function visitorStartView(
  manifest: TourManifest | null,
): VisitorStartView {
  if (manifest === null) return { ...NO_TOUR, subline: NOT_FINISHED };
  const name = manifest.title?.trim() ?? "";
  const description = manifest.description?.trim() ?? "";
  return {
    title: name === "" ? UNNAMED : name,
    subline: sublineFor(manifest),
    description: description === "" ? null : description,
    coverPath: coverPathOf(manifest),
    pageTitle: name === "" ? APP_TITLE : name,
  };
}

/** The start page's parts this module writes (structural, so the unit
 *  tests run in node with plain objects). */
export interface VisitorStartDom {
  title: Pick<HTMLElement, "textContent">;
  subline: Pick<HTMLElement, "textContent" | "hidden">;
  description: Pick<HTMLElement, "textContent" | "hidden">;
  /** The document, for its title. */
  page: { title: string };
  /** The cover's frame, hidden while there is no photo. */
  cover: Pick<HTMLElement, "hidden">;
  /** Decorative (`alt=""` in the markup): the title names the tour. */
  coverImage: { src: string };
}

export interface VisitorStart {
  /** Show this tour (`manifest` null: a zip without tour.json): the name
   *  and the subline at once, the cover once it is read from the zip
   *  (`loadImage` takes the manifest's archive path). */
  present(
    manifest: TourManifest | null,
    loadImage: (path: string) => Promise<Blob>,
  ): void;
  /** No tour: the defaults, no photo, its object URL released. */
  clear(): void;
}

export function wireVisitorStart(deps: {
  dom: VisitorStartDom;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  /** The page's picture check (`pictureProblem`): a reason, or null. */
  checkPicture: (blob: Blob) => Promise<string | null>;
}): VisitorStart {
  const { dom } = deps;
  /** Bumped per present/clear: a cover read for an older tour is dropped. */
  let generation = 0;
  let coverUrl: string | null = null;

  function releaseCover(): void {
    dom.cover.hidden = true;
    dom.coverImage.src = "";
    if (coverUrl !== null) deps.revokeObjectUrl(coverUrl);
    coverUrl = null;
  }

  function write(view: VisitorStartView): void {
    dom.title.textContent = view.title;
    dom.subline.textContent = view.subline ?? "";
    dom.subline.hidden = view.subline === null;
    dom.description.textContent = view.description ?? "";
    dom.description.hidden = view.description === null;
    dom.page.title = view.pageTitle;
  }

  async function showCover(
    path: string,
    loadImage: (path: string) => Promise<Blob>,
    own: number,
  ): Promise<void> {
    const blob = await loadImage(path);
    if (own !== generation) return;
    if ((await deps.checkPicture(blob)) !== null || own !== generation) return;
    const url = deps.createObjectUrl(blob);
    coverUrl = url;
    dom.coverImage.src = url;
    dom.cover.hidden = false;
  }

  return {
    present(manifest, loadImage) {
      const own = ++generation;
      releaseCover();
      const view = visitorStartView(manifest);
      write(view);
      if (view.coverPath === null) return;
      // A photo that cannot be read shows no cover; the page stays usable.
      showCover(view.coverPath, loadImage, own).catch(() => undefined);
    },
    clear() {
      generation += 1;
      releaseCover();
      write(NO_TOUR);
    },
  };
}
