# video-poster.ts

## Purpose

Mints a video's poster when the video is brought into the tour: the frame
just after the start (0.1 s, or half a very short video), as a JPEG, so a
phone can show the item before any of the video loads. The editor page
hands it to the session as `fileReaders.posterOf` (`edit-main.ts`), and
`readTourFile` turns the picture into an image asset of its own.

## Public API

- `videoPosterOf(blob, options?): Promise<Blob | null>` - never rejects.
  Null for a video the browser refuses (`error`), one that does not load
  and seek within `timeoutMs` (default 10 s), one with no picture
  (`videoWidth` 0), or a canvas that gives nothing.
- `VideoPosterOptions` (for tests): `createVideo`, `draw(video, w, h)`,
  `objectUrl { create, revoke }`, `timeoutMs`.
- `PosterVideo` - the parts of a video element it uses.

## Invariants & assumptions

- The poster's longest side is at most 1920 px, scaled to keep the
  aspect; a smaller frame keeps its size.
- The video is muted and inline, so reading it never plays sound.
- The object URL is always revoked and the element's source let go,
  whatever the outcome.
- The real decoder is only exercised in a browser; the unit tests drive a
  stand-in element.

## Examples

```ts
const poster = await videoPosterOf(file); // Blob (image/jpeg) or null
```

## Tests

`video-poster.test.ts`: a frame drawn at the video's size after a seek, no
poster for a refused, stalled or picture-less video (URL revoked each
time), and a 4K frame scaled to 1920 x 1080.
