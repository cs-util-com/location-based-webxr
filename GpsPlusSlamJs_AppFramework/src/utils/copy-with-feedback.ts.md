# copy-with-feedback.ts

## Purpose

The one "copy to the clipboard from a button, and say how it went"
sequence (Tour Viewer follow-up F7; root `CLAUDE.md` DEC-H3 and its
async-UI rule): busy and disabled before the write, the real outcome after,
the button usable again in every case.

## Public API

- `copyWithFeedback(button, text, write, labels) → Promise<boolean>` -
  `write` is normally `navigator.clipboard.writeText` (undefined where the
  page has none); `labels` is `{ busy, done, failed, onDone?, onFailed? }`.
  Resolves `true` when copied, `false` otherwise. A failed write never
  rejects it; a hook that throws does (the button is enabled again either
  way), so the hooks stay plain assignments.
- `CopyButton` - `{ disabled, textContent }`, structural so unit tests pass
  a plain object.
- `CopyFeedback` - the labels and the two hooks.

## Invariants & assumptions

- **The write runs inside the promise chain** (a microtask after the
  call): a write that throws before it returns a promise - no clipboard on
  an http page, some in-app browsers - ends in `failed`, never stuck at
  `busy` (Tour Viewer M4 review #1 found exactly that).
- The busy label is set synchronously, before the write starts.
- The hooks run after their label: `onDone` (e.g. clear older advice),
  `onFailed(error)` (e.g. put advice on the page's error line, or set the
  label back to idle).
- The button is enabled again in `finally`, whatever happened.
- Deep-import it; never through the `/utils` barrel (DEC-H3).

## Examples

```ts
import { copyWithFeedback } from 'gps-plus-slam-app-framework/utils/copy-with-feedback';

void copyWithFeedback(button, location.href, seams.copyText, {
  busy: 'Copying…',
  done: 'Link copied',
  failed: 'Copy link',
  onFailed: () => {
    errorBox.textContent = 'Could not copy the link.';
  },
});
```

## Tests

`copy-with-feedback.test.ts`: busy then done; a rejecting write; a write
that throws at once; no write at all; the done hook after its label; and a
property that every kind of write ends enabled on one of the two outcome
labels.

## Users

The Tour Viewer's visitor "Copy link" (`ar-entry.ts`) and the creator's
Drive address copy (`creator-handoff.ts`). The copies in the AnchorStarter,
the OsmDemo, the QrTrackingDemo and the RecorderApp's timing page are filed
to move onto it (follow-up F15).
