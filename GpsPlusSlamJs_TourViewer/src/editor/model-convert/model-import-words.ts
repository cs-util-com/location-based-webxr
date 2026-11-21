/**
 * Every sentence a creator reads when a model file is converted for a
 * tour: the refusals (nothing is added) and the notes (the model is added,
 * with something left out). One place, so the wording stays consistent and
 * the tests can name the exact sentence a case must produce.
 *
 * File names are quoted as given; numbers are written for people (MB with
 * at most one decimal).
 *
 * @see model-import-words.ts.md
 */

const MB = 1024 * 1024;

/** `bytes` in MB for a sentence: one decimal below 10 MB, whole above. */
function megabytes(bytes: number): string {
  const mb = bytes / MB;
  return mb < 10 ? String(Math.round(mb * 10) / 10) : String(Math.round(mb));
}

/** The compression families a tour cannot open, by the glTF extension
 *  that declares them. */
const COMPRESSION_OF: ReadonlyMap<string, string> = new Map([
  ["KHR_draco_mesh_compression", "Draco"],
  ["EXT_meshopt_compression", "meshopt"],
  ["KHR_meshopt_compression", "meshopt"],
  ["KHR_texture_basisu", "KTX2 pictures"],
]);

/** The creator's name for the compression `extension` declares, or null
 *  when it is no compression a tour refuses. */
export function compressionOf(extension: unknown): string | null {
  return typeof extension === "string"
    ? (COMPRESSION_OF.get(extension) ?? null)
    : null;
}

/** Sentences that refuse a conversion: the model is not added. */
export const refusal = {
  missingFile: (model: string, needed: string): string =>
    `"${model}" needs "${needed}", which was not among the files. Drop the model's folder or a zip of it, or choose all its files together.`,
  outsideFolder: (model: string, needed: string): string =>
    `"${model}" needs "${needed}" from outside the files it came with. Drop the folder that holds both, or a zip of it.`,
  otherComputer: (model: string, needed: string): string =>
    `"${model}" points to "${needed}" in a file on another computer. Drop that file with the model, in its folder or a zip of it.`,
  remotePart: (model: string): string =>
    `"${model}" loads a part from the internet. A tour never fetches anything: download that file and drop it with the model.`,
  compressed: (kind: string): string =>
    `This model is compressed with ${kind}, which a tour cannot open. Export it again without that compression.`,
  unreadable: (model: string): string =>
    `"${model}" could not be read as a glTF model. Is the file complete?`,
  notVersion2: (model: string): string =>
    `"${model}" is not a glTF 2.0 model. Export it again as glTF 2.0, or as .glb.`,
  partTooShort: (model: string, part: string): string =>
    `"${model}" says "${part}" is longer than that file is. Is the file complete?`,
  brokenPart: (model: string): string =>
    `"${model}" carries data inside its text that could not be decoded. Is the file complete?`,
  tooLarge: (model: string, bytes: number, cap: number): string =>
    `"${model}" is too large to convert here (${megabytes(bytes)} MB; at most ${megabytes(cap)} MB).`,
  textTooLarge: (model: string, bytes: number, cap: number): string =>
    `"${model}" holds ${megabytes(bytes)} MB of text, more than the ${megabytes(cap)} MB a model's description may have. Export it again as .glb, or with its data in a separate .bin file.`,
  pictureTooLarge: (model: string, picture: string, why: string): string =>
    `The picture "${picture}" of "${model}" cannot go into a tour: ${why}. Make it smaller and drop the model again.`,
  notInert: (model: string, why: string): string =>
    `"${model}" could not be made into a tour model: ${why}.`,
} as const;

/** Sentences that tell what a conversion left out: the model is added. */
export const note = {
  missingPicture: (picture: string): string =>
    `Made without its picture "${picture}" (not among the files). To have it, drop the model again with that picture.`,
  remotePicture: (picture: string): string =>
    `Made without its picture "${picture}", which is on the internet: a tour never fetches anything. Download it and drop the model again with it.`,
  unsupportedPicture: (picture: string, shown: string): string =>
    `Made without its picture "${picture}": a tour shows ${shown} pictures here. Save it as PNG or JPEG and drop the model again with it.`,
  brokenPicture: (picture: string): string =>
    `Made without its picture "${picture}": it could not be decoded. Save it again as PNG or JPEG and drop the model again with it.`,
  otherComputerPicture: (picture: string): string =>
    `Made without its picture "${picture}": the model points to a file on another computer. To have it, drop the model again with that picture.`,
  otherPictureShown: (picture: string): string =>
    `Without "${picture}", the model shows another picture it carries in its place.`,
  stoodIn: (named: string, used: string): string =>
    `The model names "${named}", which was not among the files as written; "${used}" was used for it.`,
} as const;
