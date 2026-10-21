// Repo-meta test: every NOTICE file in this repo that links a cs-util-com
// GitHub repository links THIS one, the public repository the framework's
// `package.json` names in its `repository` field.
//
// WHY THIS EXISTS. A NOTICE is what a reader of a published package or a
// deployed app is told to follow to find the source. The framework's NOTICE
// linked a repository a public reader cannot open (a 404), while its own
// `package.json` named the public one, and nothing compared the two. The
// NOTICE ships in the npm tarball, so the wrong link reached every install.
//
// WHAT IT CANNOT SEE. Only tracked files whose name is NOTICE or NOTICE.txt
// are read, and only links of the form https://github.com/cs-util-com/<repo>.
// A third-party library's own NOTICE (shipped verbatim beside its licence)
// names no cs-util-com repository, so it is unaffected.

import { describe, it, expect } from 'vitest';
import { readTracked, trackedFiles } from './tracked-tree.js';

const OWN_REPO_LINK = /https:\/\/github\.com\/cs-util-com\/[A-Za-z0-9._-]+/g;

/** The public repository URL, from the framework manifest (".git" dropped). */
function publicRepoUrl() {
  const manifest = JSON.parse(readTracked('GpsPlusSlamJs_AppFramework/package.json'));
  const url = manifest.repository?.url;
  if (typeof url !== 'string') throw new Error('the framework names no repository url');
  return url.replace(/\.git$/, '');
}

const isNotice = (path) => /(^|\/)NOTICE(\.txt)?$/.test(path);

describe('NOTICE links', () => {
  // Why this test matters: it is the only check that the source link a
  // NOTICE gives a stranger is one they can open. Two NOTICE files exist
  // today (the framework's and the Tour Viewer's); the guard must find both,
  // or it passes by reading nothing.
  it('finds the NOTICE files it guards', () => {
    const notices = trackedFiles().filter(isNotice);
    expect(notices).toContain('GpsPlusSlamJs_AppFramework/NOTICE');
    expect(notices).toContain('GpsPlusSlamJs_TourViewer/NOTICE');
  });

  // Why this test matters: a link to a repository the reader cannot open
  // reads as correct to everyone who can, which is how it shipped.
  it('links only the public repository the framework manifest names', () => {
    const expected = publicRepoUrl();
    const wrong = trackedFiles()
      .filter(isNotice)
      .flatMap((path) =>
        [...readTracked(path).matchAll(OWN_REPO_LINK)]
          .map((m) => m[0])
          .filter((link) => link !== expected)
          .map((link) => `${path}: ${link}`)
      );
    expect(wrong).toEqual([]);
  });
});
