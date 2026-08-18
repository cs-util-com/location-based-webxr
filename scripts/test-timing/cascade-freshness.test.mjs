// Why this test matters: DEC-G3 (one full cascade per session, before the PR)
// is the only part of the 2026-08-15 gate change with no natural feedback —
// skipping it produces no error, just a branch published on less evidence than
// claimed. This check is what turns it into a rule, so its edge cases have to
// be right: too strict and it fires on the summary-doc commits every session
// ends with, at which point it gets overridden habitually and stops meaning
// anything; too loose and it passes on exactly the code change it exists for.
import { describe, it, expect } from 'vitest';

import {
  assessCascadeFreshness,
  newestCascadeSha,
} from './cascade-freshness.mjs';

const SHA = 'b2977d49';

describe('assessCascadeFreshness', () => {
  it('is fresh when the cascade ran on HEAD', () => {
    const result = assessCascadeFreshness({
      cascadeSha: SHA,
      shaKnown: true,
      changedSince: [],
    });
    expect(result.fresh).toBe(true);
  });

  it('is STALE when code changed since the cascade', () => {
    const result = assessCascadeFreshness({
      cascadeSha: SHA,
      shaKnown: true,
      changedSince: ['GpsPlusSlamJs_Osm/src/spatial/resolutions.ts'],
    });
    expect(result.fresh).toBe(false);
    expect(result.reason).toContain('resolutions.ts');
  });

  it('is fresh when ONLY markdown changed since the cascade', () => {
    // The session-end shape: cascade runs, then the summary and decision docs
    // are written and committed. Failing here would make the check fire every
    // single session and train everyone to bypass it.
    const result = assessCascadeFreshness({
      cascadeSha: SHA,
      shaKnown: true,
      changedSince: [
        'GpsPlusSlamJs_Docs/docs/2026-08-15-1550-summary-and-followups.md',
        'README.md',
      ],
    });
    expect(result.fresh).toBe(true);
  });

  it('is STALE when even one non-markdown file rides along with docs', () => {
    // The dangerous middle case: a docs commit that also touches a config or a
    // source file. Counting "mostly markdown" as fresh is how the exemption
    // would become a hole.
    const result = assessCascadeFreshness({
      cascadeSha: SHA,
      shaKnown: true,
      changedSince: ['docs/notes.md', 'scripts/test-timing/projects.mjs'],
    });
    expect(result.fresh).toBe(false);
    expect(result.reason).toContain('projects.mjs');
  });

  it('is STALE when no cascade has ever been recorded', () => {
    expect(
      assessCascadeFreshness({
        cascadeSha: null,
        shaKnown: false,
        changedSince: [],
      }).fresh
    ).toBe(false);
  });

  it('is STALE when the recorded cascade is not in this history', () => {
    // A cascade recorded on another branch or another machine says nothing
    // about what is about to be pushed, even though a row exists.
    const result = assessCascadeFreshness({
      cascadeSha: SHA,
      shaKnown: false,
      changedSince: [],
    });
    expect(result.fresh).toBe(false);
    expect(result.reason).toContain('not in this branch');
  });

  it('treats uppercase .MD as markdown', () => {
    expect(
      assessCascadeFreshness({
        cascadeSha: SHA,
        shaKnown: true,
        changedSince: ['docs/NOTES.MD'],
      }).fresh
    ).toBe(true);
  });
});

describe('newestCascadeSha', () => {
  it('reads the newest total row’s SHA', () => {
    const md = `# Test Timings
\`\`\`json
{
  "stages": {
    "test:unit": { "history": [ {"ts":"x","git":"deadbeef"} ] },
    "total": { "history": [
      {"ts":"2026-08-15T10:00:00Z","durationMs":1360100,"git":"${SHA}"},
      {"ts":"2026-08-14T10:00:00Z","durationMs":1400000,"git":"older123"}
    ] }
  }
}
\`\`\``;
    expect(newestCascadeSha(md)).toBe(SHA);
  });

  it('returns null when there is no total history', () => {
    expect(newestCascadeSha('# nothing here')).toBeNull();
  });
});
