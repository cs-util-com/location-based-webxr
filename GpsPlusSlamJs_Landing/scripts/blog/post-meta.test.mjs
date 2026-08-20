import { describe, expect, it } from 'vitest';

import { parsePost } from './post-meta.mjs';

// Why this test matters: this parser is the D14 publication gate. Every rule
// here exists because the alternative is a half-written wiki page appearing on
// gps.csutil.com with no way to take it back. The bias is deliberate and
// one-directional — anything the parser does not fully understand is a DRAFT.

const META = (body) => `<!--\nblog-meta\n${body}\n-->\n`;

describe('parsePost — the publication gate', () => {
  it('publishes a page whose meta block is complete and explicit', () => {
    const post = parsePost(
      'Why-outdoor-webxr-drifts.md',
      `${META('status: published\ndate: 2026-08-20\ndescription: Sparse features, and what actually fixes them.\ntags: webxr, gps')}# Why outdoor WebXR drifts\n\nOpen fields are visually uniform.\n`
    );

    expect(post.status).toBe('published');
    expect(post.draftReason).toBeUndefined();
    expect(post.slug).toBe('why-outdoor-webxr-drifts');
    expect(post.title).toBe('Why outdoor WebXR drifts');
    expect(post.date).toBe('2026-08-20');
    expect(post.description).toBe(
      'Sparse features, and what actually fixes them.'
    );
    expect(post.tags).toEqual(['webxr', 'gps']);
    // The H1 became the title, so leaving it in the body would render twice.
    expect(post.body).not.toContain('# Why outdoor WebXR drifts');
    expect(post.body).toContain('Open fields are visually uniform.');
  });

  it('treats a page with no meta block as a draft', () => {
    const post = parsePost('Home.md', '# Home\n\nWelcome.\n');

    expect(post.status).toBe('draft');
    expect(post.draftReason).toMatch(/meta/i);
  });

  it.each([
    ['publish', 'a near-miss of the keyword'],
    ['', 'an empty value'],
    ['draft', 'an explicit draft'],
    ['published tomorrow', 'a value that merely contains the keyword'],
  ])('treats status %j as a draft (%s)', (status) => {
    const post = parsePost(
      'A-page.md',
      `${META(`status: ${status}\ndate: 2026-08-20`)}# A page\n\nBody.\n`
    );

    expect(post.status).toBe('draft');
  });

  it('accepts the keyword regardless of case and padding', () => {
    const post = parsePost(
      'A-page.md',
      `${META('status:   PUBLISHED  \ndate: 2026-08-20')}# A page\n\nBody.\n`
    );

    expect(post.status).toBe('published');
  });

  it('refuses to publish without a date, because the feed and sitemap need one', () => {
    const post = parsePost(
      'A-page.md',
      `${META('status: published')}# A page\n\nBody.\n`
    );

    expect(post.status).toBe('draft');
    expect(post.draftReason).toMatch(/date/i);
  });

  it('refuses to publish a date it cannot trust', () => {
    const post = parsePost(
      'A-page.md',
      `${META('status: published\ndate: last Tuesday')}# A page\n\nBody.\n`
    );

    expect(post.status).toBe('draft');
    expect(post.draftReason).toMatch(/date/i);
  });

  it('refuses a calendar-invalid date that still looks well-formed', () => {
    const post = parsePost(
      'A-page.md',
      `${META('status: published\ndate: 2026-02-31')}# A page\n\nBody.\n`
    );

    expect(post.status).toBe('draft');
    expect(post.draftReason).toMatch(/date/i);
  });

  it('falls back to the wiki page name when the body has no heading', () => {
    const post = parsePost(
      'The-VPS-free-positioning-model.md',
      `${META('status: published\ndate: 2026-08-20')}Body without a heading.\n`
    );

    expect(post.title).toBe('The VPS free positioning model');
    expect(post.slug).toBe('the-vps-free-positioning-model');
  });

  it('lets the meta block override the slug so a wiki rename cannot break links', () => {
    const post = parsePost(
      'Renamed-page.md',
      `${META('status: published\ndate: 2026-08-20\nslug: original-url')}# Renamed page\n\nBody.\n`
    );

    expect(post.slug).toBe('original-url');
  });

  it('derives a description from the first paragraph when none is given', () => {
    const post = parsePost(
      'A-page.md',
      `${META('status: published\ndate: 2026-08-20')}# A page\n\nGPS alone is too coarse for AR.\n\nSecond paragraph.\n`
    );

    expect(post.description).toBe('GPS alone is too coarse for AR.');
  });

  it('rejects a non-string source rather than guessing', () => {
    expect(() => parsePost('A-page.md', undefined)).toThrow(TypeError);
    expect(() => parsePost(undefined, '# x')).toThrow(TypeError);
  });
});
