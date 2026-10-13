/**
 * What the visitor's start page shows about the tour (polish round M4a:
 * the owner's V4 - the tour's name large, one line under it, one cover
 * photo - D-R12/D-R14). Pure: the page writes it and loads the photo.
 *
 * @see visitor-start.ts.md
 */

import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";

export interface VisitorStartView {
  /** The tour's name; "An AR tour" when it has none (yet). */
  title: string;
  /** "3 places to discover" (its stations, else its objects and recorded photos), or
   *  null for a tour with nothing placed. */
  subline: string | null;
  /** The cover: the tour's first placed photo, else its first recorded
   *  photo (a baked capture spot), as an archive path; or null. */
  coverPath: string | null;
}

/** A tour without a name still reads as a tour. */
const UNNAMED = "An AR tour";

/** "N places to discover": a tour of stations counts its stations (the
 *  objects they show are not places of their own - M4 review #10); any
 *  other tour its objects and recorded photos. */
function sublineFor(manifest: TourManifest): string | null {
  const count =
    manifest.stations.length > 0
      ? manifest.stations.length
      : manifest.objects.length + (manifest.captureSpots?.captures.length ?? 0);
  if (count === 0) return null;
  return `${String(count)} ${count === 1 ? "place" : "places"} to discover`;
}

/** The first placed photo, else the first recorded one. */
function coverPathOf(manifest: TourManifest): string | null {
  for (const object of manifest.objects) {
    if (object.kind === "photo") return object.image;
  }
  return manifest.captureSpots?.captures[0]?.image ?? null;
}

export function visitorStartView(
  manifest: TourManifest | null,
): VisitorStartView {
  if (manifest === null) {
    return { title: UNNAMED, subline: null, coverPath: null };
  }
  const name = manifest.title?.trim() ?? "";
  return {
    title: name === "" ? UNNAMED : name,
    subline: sublineFor(manifest),
    coverPath: coverPathOf(manifest),
  };
}

/** The start page's parts this module writes (structural, so the unit
 *  tests run in node with plain objects). */
export interface VisitorStartDom {
  title: Pick<HTMLElement, "textContent">;
  subline: Pick<HTMLElement, "textContent" | "hidden">;
  /** The cover's frame, hidden while there is no photo. */
  cover: Pick<HTMLElement, "hidden">;
  /** Decorative (`alt=""` in the markup): the title names the tour. */
  coverImage: { src: string };
}

export interface VisitorStart {
  /** Show this tour: the name and the subline at once, the cover once it
   *  is read from the zip (`loadImage` takes the manifest's archive path). */
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
      write(visitorStartView(null));
    },
  };
}
