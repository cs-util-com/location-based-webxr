# storage/file-picker.ts

## Purpose

One check for whether this browser has the File System Access file picker
(`showOpenFilePicker`), shared by the setup page's line about the editor
(`have-tour.ts` `editorPitch`) and the editor's fine print
(`editor/save-target.ts` `saveFinePrint`). It lives outside `editor/`
because viewer modules may not import the editor's
(`config/.dependency-cruiser.cjs`, viewer-not-to-editor); before (M4a review
#8) each module carried its own copy.

Moved from the Tour Viewer's desktop editor together with the other save modules, so other apps can share them (plan: `GpsPlusSlamJs_Docs/docs/2026-10-27-1850-editor-on-the-full-globe-plan.md`); deep import `gps-plus-slam-app-framework/storage/file-picker`, not in a barrel. Its users: the Tour Viewer's `have-tour.ts` and `editor/save-target.ts`. The paths named below are the Tour Viewer's.

## Public API

- `hasFilePicker(win: object): boolean` - true when
  `win.showOpenFilePicker` is a function.

## Invariants & assumptions

- Structural: any object is accepted, read through `Reflect.get`, so the
  unit tests need no DOM. A picker that exists but refuses (an iframe) is
  still "has": the editor's `pickTourFile` falls back to its file input
  then.

## Examples

```ts
hasFilePicker(window); // true in Chromium on a desktop
```

## Tests

`file-picker.test.ts`: a function, a missing member and a non-function.
