/**
 * Whether this browser has the File System Access file picker
 * (`showOpenFilePicker`): where it does, the desktop editor saves a chosen
 * file into itself; elsewhere Save gives a new copy. The one check behind
 * the setup page's line about the editor (`have-tour.ts`) and the editor's
 * own fine print (`editor/save-target.ts`) - kept outside `editor/`, which
 * viewer modules may not import (`config/.dependency-cruiser.cjs`), so the
 * two never disagree (M4a review #8).
 *
 * @see file-picker.ts.md
 */

/** True when `win.showOpenFilePicker` is a function. Structural, so a
 *  test passes a plain object. */
export function hasFilePicker(win: object): boolean {
  return typeof Reflect.get(win, "showOpenFilePicker") === "function";
}
