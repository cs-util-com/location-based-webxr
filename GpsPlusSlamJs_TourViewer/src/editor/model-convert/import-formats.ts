import { tourMediaTypeOf } from "gps-plus-slam-app-framework/ar/tour-media";

/**
 * What a dropped or picked file is to the model import:
 * - `primary`: a model file the editor converts into a tour model;
 * - `container`: a zip that may hold a model and its parts;
 * - `companion`: a part a model file names (its data, its materials, a
 *   picture format the tour does not take) and that means nothing alone;
 * - `picture`: a tour picture, which a model dropped with it may name;
 * - `plain`: any other tour file, taken as it is.
 */
export type ImportRole =
  | "primary"
  | "container"
  | "companion"
  | "picture"
  | "plain";

const PRIMARY: ReadonlySet<string> = new Set(["gltf"]);
const CONTAINER: ReadonlySet<string> = new Set(["zip"]);
const COMPANION: ReadonlySet<string> = new Set(["bin", "mtl", "tga", "bmp"]);

/** The extensions the import adds to a file picker, each with its dot. */
export const IMPORT_ACCEPT: string = [...PRIMARY, ...CONTAINER, ...COMPANION]
  .map((ext) => `.${ext}`)
  .join(",");

/** The lower-case extension of a file name's last path part, or null when
 *  the part has no stem or no extension. */
function extensionOf(name: string): string | null {
  const base = name.slice(
    Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1,
  );
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/** The role of a file by its name, in any letter case, or null when the
 *  import and the tour know nothing of it. */
export function importRoleOf(name: string): ImportRole | null {
  if (typeof name !== "string") return null;
  const ext = extensionOf(name);
  if (ext === null) return null;
  if (PRIMARY.has(ext)) return "primary";
  if (CONTAINER.has(ext)) return "container";
  if (COMPANION.has(ext)) return "companion";
  const tour = tourMediaTypeOf(ext);
  if (tour === null) return null;
  return tour.kind === "image" ? "picture" : "plain";
}
