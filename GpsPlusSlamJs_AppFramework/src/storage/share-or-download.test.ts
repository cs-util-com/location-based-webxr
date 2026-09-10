/**
 * Why these tests matter: this module decides what the user is TOLD
 * happened to their file, and the two facts it reports are the ones an app
 * cannot recover any other way. Three of the four outcomes are invisible to
 * an e2e run (a headless browser has no share sheet), and the one that
 * bites hardest in the field - a share the user backs out of - looks
 * identical in the API to a share that failed. So every outcome is driven
 * here, through the injected seam, including the two that must NOT be
 * reported as errors.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  canShareFilesOfType,
  prefersFileShare,
  shareOrDownloadBlob,
} from './share-or-download.js';
import { PDF_FILE_TYPE } from './zip-export.js';

const ZIP: { description: string; mimeType: string; extension: string } = {
  description: 'ZIP Archive',
  mimeType: 'application/zip',
  extension: '.zip',
};

const BLOB = new Blob([new Uint8Array([1, 2, 3])], {
  type: 'application/zip',
});

function abortError(): Error {
  const err = new Error('Share canceled');
  err.name = 'AbortError';
  return err;
}

describe('shareOrDownloadBlob', () => {
  it('takes the share route and reports delivery when the sheet resolves', async () => {
    const share = vi.fn((_data: { files: File[] }) => Promise.resolve());
    const download = vi.fn(() => Promise.resolve(true));
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      canShare: () => true,
      coarsePointer: () => true,
      share,
      download,
    });
    expect(result).toEqual({ route: 'share', delivered: true });
    expect(download).not.toHaveBeenCalled();
    // The file carries the caller's name and the type's MIME - what the
    // target app uses to decide how to handle it.
    const shared = share.mock.calls[0]?.[0].files[0];
    expect(shared?.name).toBe('tour.zip');
    expect(shared?.type).toBe('application/zip');
  });

  it('reports a cancelled or failed share as NOT delivered, and does not fall back', async () => {
    // Why: an AbortError means the file did not leave, and the algorithm
    // uses the same error for a user cancelling and for the share failing.
    // Falling back to a download here would drop a file into Downloads
    // that the user just declined to send anywhere.
    const download = vi.fn(() => Promise.resolve(true));
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      canShare: () => true,
      coarsePointer: () => true,
      share: () => Promise.reject(abortError()),
      download,
    });
    expect(result).toEqual({ route: 'share', delivered: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to download when the share throws anything else', async () => {
    const download = vi.fn(() => Promise.resolve(true));
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      canShare: () => true,
      coarsePointer: () => true,
      share: () => Promise.reject(new Error('NotAllowedError-ish')),
      download,
    });
    expect(result).toEqual({ route: 'download', delivered: true });
    expect(download).toHaveBeenCalledOnce();
  });

  it('takes the download route when the browser cannot share files', async () => {
    const share = vi.fn(() => Promise.resolve());
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      canShare: () => false,
      share,
      download: () => Promise.resolve(true),
    });
    expect(result).toEqual({ route: 'download', delivered: true });
    expect(share).not.toHaveBeenCalled();
  });

  it('reports a dismissed save picker as NOT delivered', async () => {
    // Why: `downloadBlob` already returns false for this, and the Tour
    // Viewer's finish branches on it (button stays live, "not saved").
    // Collapsing it into the route would have deleted that.
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      canShare: () => false,
      download: () => Promise.resolve(false),
    });
    expect(result).toEqual({ route: 'download', delivered: false });
  });

  it('re-asks canShare with the REAL file, not only the wire-time probe', async () => {
    // Why: the label probe uses a one-byte dummy, and a platform may refuse
    // a specific file (size, type) while allowing the type in general. A
    // module that trusted the probe would call share() and take the
    // AbortError as "the user cancelled".
    const seen: File[] = [];
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      coarsePointer: () => true,
      canShare: (data) => {
        seen.push(data.files[0]);
        return data.files[0].size > 100_000; // refuses this blob
      },
      share: () => Promise.resolve(),
      download: () => Promise.resolve(true),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].size).toBe(BLOB.size);
    expect(result.route).toBe('download');
  });

  it('falls back to download when canShare THROWS on the real file', async () => {
    // Why this test matters: the wire-time probe already guarded this, and
    // the re-ask with the real file did not - so on a browser whose
    // canShare throws for a specific file, the module rejected instead of
    // downloading. Its own contract says it never rejects for a share
    // problem, only for a failing download, and that sentence was false on
    // exactly one line.
    const download = vi.fn(() => Promise.resolve(true));
    const result = await shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
      coarsePointer: () => true,
      canShare: (data) => {
        if (data.files[0].size > 0) throw new TypeError('nope');
        return true;
      },
      share: () => Promise.resolve(),
      download,
    });
    expect(result).toEqual({ route: 'download', delivered: true });
    expect(download).toHaveBeenCalledOnce();
  });

  it('rejects when the DOWNLOAD fails, keeping downloadBlob’s contract', async () => {
    await expect(
      shareOrDownloadBlob(BLOB, 'tour.zip', ZIP, {
        canShare: () => false,
        download: () => Promise.reject(new Error('disk full')),
      })
    ).rejects.toThrow('disk full');
  });
});

describe('canShareFilesOfType', () => {
  it('probes with a file of the right type without sharing anything', () => {
    const seen: File[] = [];
    const answer = canShareFilesOfType(PDF_FILE_TYPE, {
      canShare: (data) => {
        seen.push(data.files[0]);
        return true;
      },
      share: () => Promise.resolve(),
    });
    expect(answer).toBe(true);
    expect(seen[0].type).toBe('application/pdf');
    expect(seen[0].name.endsWith('.pdf')).toBe(true);
  });

  it('is false when the browser answers false, and when there is no share at all', () => {
    // Why: the label is chosen from this. A browser exposing canShare for
    // text but not files answers false for files, and must be labelled
    // "download" - which is the majority desktop case.
    expect(
      canShareFilesOfType(PDF_FILE_TYPE, {
        canShare: () => false,
        share: () => Promise.resolve(),
      })
    ).toBe(false);
    // A browser with canShare but NO share at all. Driven by stubbing the
    // global rather than by reading it: the previous version of this
    // assertion computed its expectation from the same condition the
    // implementation tests, so it could not fail.
    vi.stubGlobal('navigator', {});
    try {
      expect(canShareFilesOfType(PDF_FILE_TYPE, { canShare: () => true })).toBe(
        false
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is false where there is no navigator and no File - the node case the seams rely on', () => {
    // Why: the sidecar advertises node-safety as the reason a seam layer
    // may call this during boot, and nothing tested it. A throw here would
    // take down the whole page's wiring, not just the button's label.
    vi.stubGlobal('navigator', undefined);
    try {
      expect(canShareFilesOfType(PDF_FILE_TYPE)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('File', undefined);
    try {
      expect(
        canShareFilesOfType(PDF_FILE_TYPE, {
          canShare: () => true,
          share: () => Promise.resolve(),
        })
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is false rather than throwing when the probe itself throws', () => {
    expect(
      canShareFilesOfType(PDF_FILE_TYPE, {
        canShare: () => {
          throw new TypeError('nope');
        },
        share: () => Promise.resolve(),
      })
    ).toBe(false);
  });
});

describe('prefersFileShare - the policy, not the raw capability', () => {
  /**
   * Why this matters more than the capability: Windows Chrome and macOS
   * Safari CAN share files, and their share sheets have no "save to disk".
   * A creator finishing on a desktop would be handed a sheet offering Mail
   * and Nearby Share, while the very next instruction tells them to upload
   * the file over the one in their cloud folder - a file that never
   * reached their disk. The save picker is the right hand-off there, so
   * the capability alone is the wrong question.
   */
  const CAN = {
    canShare: () => true,
    share: () => Promise.resolve(),
  };

  it('needs BOTH the capability and a coarse pointer', () => {
    expect(
      prefersFileShare(PDF_FILE_TYPE, { ...CAN, coarsePointer: () => true })
    ).toBe(true);
    // The desktop that can share and should not.
    expect(
      prefersFileShare(PDF_FILE_TYPE, { ...CAN, coarsePointer: () => false })
    ).toBe(false);
    // The phone whose browser cannot share files.
    expect(
      prefersFileShare(PDF_FILE_TYPE, {
        canShare: () => false,
        share: () => Promise.resolve(),
        coarsePointer: () => true,
      })
    ).toBe(false);
  });

  it('is the SAME decision the hand-off takes, so the label cannot lie', async () => {
    // Why this is the load-bearing one: the button's word is chosen from
    // `prefersFileShare` at wire time, and the mechanism is chosen inside
    // `shareOrDownloadBlob`. If those two asked different questions, a
    // desktop would read "Download" and get a share sheet. They must agree
    // for every combination, not just the common one.
    for (const canShare of [true, false]) {
      for (const coarsePointer of [true, false]) {
        const deps = {
          canShare: () => canShare,
          share: () => Promise.resolve(),
          coarsePointer: () => coarsePointer,
          download: () => Promise.resolve(true),
        };
        const labelledShare = prefersFileShare(ZIP, deps);
        const { route } = await shareOrDownloadBlob(
          BLOB,
          'tour.zip',
          ZIP,
          deps
        );
        expect(
          route === 'share',
          `canShare=${String(canShare)} coarse=${String(coarsePointer)}`
        ).toBe(labelledShare);
      }
    }
  });
});
