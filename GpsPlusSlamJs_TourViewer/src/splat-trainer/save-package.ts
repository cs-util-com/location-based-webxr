/**
 * The file the splat trainer page saves: a zip with a manifest,
 * `splat-package.json`, and one splat per stretch that goes into the file.
 * While the page runs the practice trainer there are no splats, and the
 * manifest says plainly that the file is a placeholder. The manifest
 * carries the walk's numbers and each stretch's verdict, never a file
 * name of the recording.
 *
 * @see save-package.ts.md
 */

import {
  packFilesAsZip,
  type ZipEntryInput,
} from "gps-plus-slam-app-framework/storage";

import {
  stretchNo,
  type TrainerPageState,
  windowsInFile,
} from "./trainer-page-slice.js";

const PACKAGE_MANIFEST = "splat-package.json";
const PACKAGE_FORMAT = "splat-package";
/** 0 while the format is a placeholder; the first real format is 1. */
const PACKAGE_VERSION = 0;

/** `<recording name>-splat.zip`, from a name a person chose: kept to safe characters. */
export function packageFileName(recordingName: string): string {
  const base = recordingName
    .replace(/\.zip$/i, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base === "" ? "recording" : base}-splat.zip`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const round1 = (x: number): number => Math.round(x * 10) / 10;

function packageManifest(
  state: TrainerPageState,
  splats: ReadonlyMap<string, Blob>,
): Record<string, unknown> {
  const census = state.recording?.census ?? null;
  const placeholder = windowsInFile(state).every((w) => !splats.has(w.id));
  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    placeholder,
    ...(placeholder
      ? { note: "A placeholder from a practice run: it holds no splat." }
      : {}),
    walk:
      census === null
        ? null
        : {
            photos: census.frames,
            lengthM: round1(census.pathM),
            photoWidth: census.frameWidth,
            photoHeight: census.frameHeight,
          },
    stretches: windowsInFile(state).map((w) => ({
      number: stretchNo(w),
      fromM: round1(w.fromM),
      toM: round1(w.toM),
      photos: w.frames,
      attempts: w.attempt,
      verdict: w.judgement?.verdict ?? null,
      marked: w.judgement?.verdict !== "good",
      reasons: w.judgement?.reasons ?? [],
      atCameraDb: w.metrics?.atCameraDb ?? null,
      heldOutDb: w.metrics?.heldOutDb ?? null,
      splat: splats.has(w.id) ? `stretches/${pad2(stretchNo(w))}.ply` : null,
    })),
  };
}

export function buildPackage(
  state: TrainerPageState,
  splats: ReadonlyMap<string, Blob>,
): Promise<Blob> {
  const entries: ZipEntryInput[] = [
    {
      path: PACKAGE_MANIFEST,
      data: `${JSON.stringify(packageManifest(state, splats), null, 2)}\n`,
    },
  ];
  for (const w of windowsInFile(state)) {
    const ply = splats.get(w.id);
    if (ply !== undefined) {
      entries.push({ path: `stretches/${pad2(stretchNo(w))}.ply`, data: ply });
    }
  }
  return packFilesAsZip(entries);
}
