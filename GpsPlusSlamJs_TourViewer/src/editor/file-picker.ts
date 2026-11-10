/**
 * The editor's file picker for one kind of file: one hidden file input,
 * opened by `pick`, which settles with the chosen file, or null once the
 * picker was closed without one (the input's `cancel` event). A second
 * `pick` while one is open settles the first with null. `pickMany` takes
 * several files of every kind a tour takes (the shelf's "Add files...").
 *
 * @see file-picker.ts.md
 */
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  TOUR_MEDIA_EXTENSIONS,
  tourMediaTypeOf,
} from "gps-plus-slam-app-framework/ar/tour-media";

/** The input's `accept` for `kind`: every extension a tour takes for it
 *  (the media allowlist), each with its dot. */
export function acceptFor(kind: TourAssetKind): string {
  return TOUR_MEDIA_EXTENSIONS.filter(
    (ext) => tourMediaTypeOf(ext)?.kind === kind,
  )
    .map((ext) => `.${ext}`)
    .join(",");
}

export interface FilePicker {
  /** Open the picker for `kind`; the chosen file, or null. */
  pick(kind: TourAssetKind): Promise<File | null>;
  /** Open the picker for several files of any kind a tour takes; none on
   *  a cancel. */
  pickMany(): Promise<File[]>;
}

/** A picker whose input lives in `host` (`data-testid="add-file-input"`). */
export function createFilePicker(host: HTMLElement): FilePicker {
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;
  input.dataset["testid"] = "add-file-input";
  host.append(input);
  let settle: ((files: File[]) => void) | null = null;
  const end = (files: File[]): void => {
    const done = settle;
    settle = null;
    done?.(files);
  };
  input.addEventListener("change", () => {
    end(Array.from(input.files ?? []));
  });
  input.addEventListener("cancel", () => {
    end([]);
  });
  const open = (accept: string, multiple: boolean): Promise<File[]> => {
    end([]);
    input.accept = accept;
    input.multiple = multiple;
    input.value = "";
    return new Promise<File[]>((resolve) => {
      settle = resolve;
      input.click();
    });
  };
  return {
    async pick(kind) {
      return (await open(acceptFor(kind), false))[0] ?? null;
    },
    pickMany() {
      return open(
        TOUR_MEDIA_EXTENSIONS.filter((ext) => tourMediaTypeOf(ext) !== null)
          .map((ext) => `.${ext}`)
          .join(","),
        true,
      );
    },
  };
}
