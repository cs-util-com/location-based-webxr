import { describe, expect, it } from 'vitest';

import { normalizeShareUrl } from './share-link.js';

/**
 * Why these tests matter: users paste the share link their cloud service put
 * on the clipboard, not the provider's raw download URL. Each rewrite here is
 * the difference between a working range-read and an HTML preview page
 * reaching a zip/archive parser as "corrupt". Equally load-bearing: anything
 * that is not a recognized share page must pass through byte-identical, or
 * this layer would corrupt direct URLs and proxy URLs that already work.
 */

describe('normalizeShareUrl — Dropbox', () => {
  it('rewrites an scl share link to the content host and drops dl=', () => {
    expect(
      normalizeShareUrl(
        'https://www.dropbox.com/scl/fi/abc123/tour.zip?rlkey=k42&st=xy&dl=0'
      )
    ).toBe(
      'https://dl.dropboxusercontent.com/scl/fi/abc123/tour.zip?rlkey=k42&st=xy'
    );
  });

  it('rewrites a legacy /s/ share link', () => {
    expect(
      normalizeShareUrl('https://www.dropbox.com/s/abc/tour.zip?dl=0')
    ).toBe('https://dl.dropboxusercontent.com/s/abc/tour.zip');
  });

  it('leaves a Dropbox folder link untouched (no single-file raw form)', () => {
    const folder = 'https://www.dropbox.com/scl/fo/abc/folder?rlkey=k';
    expect(normalizeShareUrl(folder)).toBe(folder);
  });
});

describe('normalizeShareUrl — GitHub', () => {
  it('rewrites a blob page to raw.githubusercontent.com', () => {
    expect(
      normalizeShareUrl('https://github.com/user/repo/blob/main/a/tour.zip')
    ).toBe('https://raw.githubusercontent.com/user/repo/main/a/tour.zip');
  });

  it('rewrites a /raw/ link the same way', () => {
    expect(
      normalizeShareUrl('https://github.com/user/repo/raw/main/tour.zip')
    ).toBe('https://raw.githubusercontent.com/user/repo/main/tour.zip');
  });
});

describe('normalizeShareUrl — Google Drive', () => {
  it('uses the Range+CORS-capable drive/v3 URL when an API key is given', () => {
    expect(
      normalizeShareUrl(
        'https://drive.google.com/file/d/ID42/view?usp=sharing',
        {
          googleDriveApiKey: 'KEY',
        }
      )
    ).toBe('https://www.googleapis.com/drive/v3/files/ID42?alt=media&key=KEY');
  });

  it('uses the usercontent confirm=t form without a key (Range + CORS, no interstitial)', () => {
    expect(normalizeShareUrl('https://drive.google.com/open?id=ID42')).toBe(
      'https://drive.usercontent.google.com/download?id=ID42&export=download&confirm=t'
    );
  });

  it('extracts the id from a uc?id= link too', () => {
    expect(
      normalizeShareUrl('https://drive.google.com/uc?id=ID42&export=view')
    ).toBe(
      'https://drive.usercontent.google.com/download?id=ID42&export=download&confirm=t'
    );
  });
});

describe('normalizeShareUrl — OneDrive', () => {
  it('maps a new-style (SPO-migrated) link to the personal-content download form', () => {
    expect(
      normalizeShareUrl(
        'https://1drv.ms/u/c/339942fd8b9cbd18/IQCDKvutg2sUSrRXTHO738kbAQTMt--zQW5kalp0hBIEYwA?e=TIPQpU'
      )
    ).toBe(
      'https://my.microsoftpersonalcontent.com/personal/339942fd8b9cbd18/_layouts/15/download.aspx?share=IQCDKvutg2sUSrRXTHO738kbAQTMt--zQW5kalp0hBIEYwA'
    );
  });

  it('wraps a legacy share link in the shares-API content URL', () => {
    const share = 'https://1drv.ms/u/s!AbCdEf';
    const out = normalizeShareUrl(share);
    expect(out).toMatch(
      /^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u![A-Za-z0-9_-]+\/root\/content$/
    );
    // The token is base64url of the original link — decode and verify.
    const token = /u!([A-Za-z0-9_-]+)\//.exec(out)![1]!;
    expect(atob(token.replaceAll('-', '+').replaceAll('_', '/'))).toBe(share);
  });
});

describe('normalizeShareUrl — passthrough', () => {
  it.each([
    'https://raw.githubusercontent.com/u/r/main/tour.zip',
    'https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip?rlkey=k',
    'https://my-worker.workers.dev/?u=https%3A%2F%2Fexample.com%2Ftour.zip',
    '/tour-proxy?u=https%3A%2F%2Fexample.com%2Ftour.zip',
    'http://127.0.0.1:4173/ranges-ok/tour.zip',
    'not a url at all',
  ])('returns %s byte-identical', (url) => {
    expect(normalizeShareUrl(url)).toBe(url);
  });
});
