# `editor/kind-panels/video-preview.ts` - a free video's preview in the inspector

## Purpose

The clip in the item inspector, like the video prototype's asset row: the
clip as a thumbnail (its poster before it plays), its length and file size,
Play and Pause, a scrub bar, and "Use current frame", which makes the frame
shown the video's poster. With it a creator can check the file and pick the
poster without leaving the editor.

## Public API

- `videoPreview(doc, clipPath, posterPath, deps)` -> `{ root, dispose() }`.
- `VideoPreviewDeps`:
  - `load(path)` - a tour file as a blob (the page's `readContent`);
  - `usePoster(image)` - makes the grabbed frame the poster; resolves true
    once written, false when refused (the page has said why);
  - `grab(video)` (optional) - the frame shown, as a JPEG. The default draws
    it through a canvas at the clip's own size (quality 0.85). It gives null
    when the clip shows no picture or the canvas refuses;
  - `objectUrl` (optional) - `create` / `revoke`, for tests.
- `dispose()` stops the clip and revokes every object URL it made.

## Invariants & assumptions

- The clip and its poster are read by path. A clip that cannot be read
  says "The clip could not be read.", and its "Use current frame" stays
  disabled. A poster that cannot be read leaves the first frame showing.
- "Use current frame" is disabled until the clip's length is known. While
  it works it reads "Saving the poster..." and is disabled. It is restored
  whether the frame was written, refused or could not be taken:
  - a written frame says "This frame is the poster now.";
  - a frame that could not be taken says so;
  - a refusal is the page's toast.
- Play and Pause follow the clip's own `play` and `pause` events, so if the
  browser refuses to play, the button stays at Play.
- Its buttons respond through their own listeners, not through the shell's
  `data-act`. The node is kept across the dock's draws (`KindPanelDraw.kept`),
  so playing and scrubbing survive those draws.
- A clip recorded in a browser states no length (`Infinity`). The preview
  then seeks far past its end (`FAR_PAST_THE_END_S`, shared with
  `video-poster.ts`), so the browser reads the length and reports it in
  `durationchange`, and goes back to 0. A length that never arrives keeps
  "Use current frame" disabled.
- Nothing reaches the page as HTML: the facts are text.

## Examples

```ts
const preview = videoPreview(document, "content/v.mp4", null, {
  load: readContent,
  usePoster: async (image) => (await edits.poster("clip", image)) === "written",
});
inspector.append(preview.root);
// ... on another selection:
preview.dispose();
```

## Tests

- `video-preview.test.ts` (jsdom) covers:
  - the poster, length and size shown;
  - play, pause and scrub;
  - "Use current frame" busy while it works and restored after, with the
    grabbed blob handed over;
  - no frame, and a refused edit;
  - an unreadable clip;
  - object URLs revoked on dispose.
- `video-panel.test.ts` checks that one preview is kept per clip across draws.
