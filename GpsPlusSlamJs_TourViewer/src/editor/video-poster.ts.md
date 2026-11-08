# video-poster.ts

## Purpose

Mints a video's poster when the video is brought into the tour: the frame
just after the start (0.1 s, or half a very short video; the first frame,
once loaded, of a video whose length is 0 or NaN), as a JPEG, so a
phone can show the item before any of the video loads. The editor page
hands it to the session as `fileReaders.posterOf` (`edit-main.ts`), and
`readTourFile` turns the picture into an image asset of its own.

## Public API

- `videoPosterOf(blob, options?): Promise<Blob | null>` - never rejects.
  Null for a video the browser refuses (`error`), one that does not load
  and seek within `timeoutMs` (default 10 s), one with no picture
  (`videoWidth` 0), or a canvas that gives nothing.
- `VideoPosterOptions` (for tests): `createVideo`, `draw(video, w, h)`,
  `objectUrl { create, revoke }`, `timeoutMs`, `lengthTimeoutMs` (default
  2 s, how long a recorded clip's length is waited for).
- `PosterVideo` - the parts of a video element it uses.

## Invariants & assumptions

- The poster's longest side is at most 1920 px, scaled to keep the
  aspect; a smaller frame keeps its size.
- The video is muted and inline, so reading it never plays sound.
- The object URL is always revoked and the element's source let go,
  whatever the outcome.
- A recorded clip reports a length of Infinity (MediaRecorder, Chrome):
  a seek far past its end (1e9 s) makes the browser read the length
  (`durationchange`, or a `seeked` with a finite length), and the frame
  just after the start is then taken like any other video's (the first
  frame is often black). A length that does not come within
  `lengthTimeoutMs` leaves the first frame (a seek back to 0), and the
  frame showing is taken once as long again has passed even when that
  seek never answers: no poster is lost to a clip that goes quiet.
  That second wait is set before the seek, so a seek that answers at
  once (the clip still at its start) clears it and no timer outlives the
  poster.
- A video whose length is 0 or NaN is not seeked: a seek to
  where it already is (its start) fires no `seeked`, so it would wait the
  whole timeout. Its first frame is drawn at `loadeddata` instead.
- The real decoder is only exercised in a browser; the unit tests drive a
  stand-in element.

## Examples

```ts
const poster = await videoPosterOf(file); // Blob (image/jpeg) or null
```

## Tests

`video-poster.test.ts`: no timer left when the fallback's seek answers at
once (seen red), a frame drawn at the video's size after a seek, no
poster for a refused, stalled or picture-less video (URL revoked each
time), the first frame of a video of length 0 or NaN without a seek, a
recorded clip's (Infinity) length read first and its frame at 0.1 s taken
(seen red: the first frame), its first frame when the length never comes
(over three waits), a frame even when no seek ever answers (over three
waits, seen red: no poster), and a 4K frame scaled to 1920 x 1080.
