/**
 * Why these tests matter: `downloadBlob` is published API, and the save
 * dialog's cancel rule it carries is being shared with the apps' own save
 * dialogs. These tests pin what it does TODAY in every branch - a
 * dismissed dialog, a write that fails after the pick, a missing or
 * refusing picker - so the sharing cannot change its behaviour unseen.
 * They were written against the unchanged code and are kept unchanged
 * across that move as its proof.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, PDF_FILE_TYPE, ZIP_FILE_TYPE } from './zip-export';

interface Stage {
  /** Every anchor the fallback clicked, by its download name. */
  readonly clicked: string[];
  readonly writable: {
    write: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  readonly createWritable: ReturnType<typeof vi.fn>;
}

/** A page with an anchor fallback that records its clicks, and a picked
 *  file whose write does `write`. */
function stage(
  win: object,
  write: () => Promise<void> = () => Promise.resolve()
): Stage {
  const clicked: string[] = [];
  const writable = {
    write: vi.fn(write),
    close: vi.fn(() => Promise.resolve()),
    abort: vi.fn(() => Promise.resolve()),
  };
  const createWritable = vi.fn(() => Promise.resolve(writable));
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: () => {
      const link = {
        href: '',
        download: '',
        style: {},
        click: () => clicked.push(link.download),
      };
      return link;
    },
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  });
  return { clicked, writable, createWritable };
}

function pickerGiving(handle: () => Promise<unknown>) {
  return { showSaveFilePicker: vi.fn(handle) };
}

/** A stage whose save dialog picks a file that writes with `write`. */
function pickedStage(write?: () => Promise<void>) {
  const s = stage({}, write);
  const win = pickerGiving(() =>
    Promise.resolve({ createWritable: s.createWritable })
  );
  vi.stubGlobal('window', win);
  return { s, win };
}

const blob = new Blob(['bytes']);

describe('downloadBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the picked file, filtered to the file type, and downloads nothing', async () => {
    const { s, win } = pickedStage();
    expect(await downloadBlob(blob, 'codes.pdf', PDF_FILE_TYPE)).toBe(true);
    expect(win.showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'codes.pdf',
      types: [
        {
          description: 'PDF Document',
          accept: { 'application/pdf': ['.pdf'] },
        },
      ],
    });
    expect(s.writable.close).toHaveBeenCalledTimes(1);
    expect(s.clicked).toEqual([]);
  });

  it('returns false and writes nothing when the user dismisses the dialog', async () => {
    const win = pickerGiving(() =>
      Promise.reject(new DOMException('dismissed', 'AbortError'))
    );
    const s = stage(win);
    expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(false);
    expect(s.createWritable).not.toHaveBeenCalled();
    expect(s.clicked).toEqual([]);
  });

  // Recorded as it is: the dismissal is read by the error's NAME alone, so
  // a plain Error named AbortError is a dismissal too. A rule that asked
  // for a DOMException would download here instead.
  it('returns false for any error named AbortError, not only a DOMException', async () => {
    const win = pickerGiving(() =>
      Promise.reject(
        Object.assign(new Error('named so'), { name: 'AbortError' })
      )
    );
    const s = stage(win);
    expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(false);
    expect(s.createWritable).not.toHaveBeenCalled();
    expect(s.clicked).toEqual([]);
  });

  // Recorded as it is, not as it might be: a write that fails after the
  // pick is aborted (nothing partial committed) and the file is then
  // DOWNLOADED as well, reported as started.
  it('falls back to the download when the write after the pick fails', async () => {
    const { s } = pickedStage(() => Promise.reject(new Error('disk full')));
    expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(true);
    expect(s.writable.abort).toHaveBeenCalledTimes(1);
    expect(s.writable.close).not.toHaveBeenCalled();
    expect(s.clicked).toEqual(['tour.zip']);
  });

  // Recorded as it is: the write's failure is read by its name alone, so a
  // write that fails with an AbortError ends like a dismissed dialog.
  it('returns false without a download when the write fails with an AbortError', async () => {
    const { s } = pickedStage(() =>
      Promise.reject(new DOMException('aborted', 'AbortError'))
    );
    expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(false);
    expect(s.clicked).toEqual([]);
  });

  it('downloads through the anchor when there is no save dialog', async () => {
    const s = stage({});
    expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(true);
    expect(s.clicked).toEqual(['tour.zip']);
  });

  it('downloads through the anchor when the dialog is refused, rejected or thrown', async () => {
    const failures: (() => Promise<unknown>)[] = [
      () => Promise.reject(new DOMException('no click', 'SecurityError')),
      () => Promise.reject(new DOMException('busy', 'NotAllowedError')),
      () => Promise.reject(new TypeError('not here')),
      () => {
        throw new TypeError('thrown, not rejected');
      },
    ];
    for (const failure of failures) {
      const s = stage(pickerGiving(failure));
      expect(await downloadBlob(blob, 'tour.zip', ZIP_FILE_TYPE)).toBe(true);
      expect(s.createWritable).not.toHaveBeenCalled();
      expect(s.clicked).toEqual(['tour.zip']);
      vi.unstubAllGlobals();
    }
  });
});
