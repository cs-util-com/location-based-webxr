/**
 * Why these tests matter: a tour's details are text and a reference a
 * creator types into the editor and a visitor's page shows - from a file
 * anyone can edit by hand. Each rule here is what keeps a broken or
 * hostile value off the visitor's page without costing them the tour: the
 * contact is shown as a link, so only an e-mail address or an http(s) link
 * may become one; the cover must be one of the tour's own images; and a
 * value that fails is dropped with a reason, never thrown.
 */

import { describe, expect, it } from 'vitest';

import {
  checkTourContact,
  checkTourCover,
  checkTourDescription,
  parseTourDetails,
  TOUR_CONTACT_MAX_CHARS,
  TOUR_DESCRIPTION_MAX_CHARS,
  tourContactHref,
  tourCoverEntry,
  tourImageIds,
} from './tour-details';

const IMAGES = new Set(['f1', 'cover-art']);

describe('checkTourDescription', () => {
  it('keeps text trimmed, with its line breaks', () => {
    expect(checkTourDescription('  A walk.\nTwo hours.  ')).toEqual({
      ok: true,
      value: 'A walk.\nTwo hours.',
    });
  });

  it('refuses a blank, a non-string and an over-long text, saying why', () => {
    expect(checkTourDescription('   ')).toMatchObject({ ok: false });
    expect(checkTourDescription(42)).toEqual({
      ok: false,
      reason: '"description" must be text',
    });
    expect(
      checkTourDescription('x'.repeat(TOUR_DESCRIPTION_MAX_CHARS))
    ).toMatchObject({ ok: true });
    expect(
      checkTourDescription('x'.repeat(TOUR_DESCRIPTION_MAX_CHARS + 1))
    ).toEqual({
      ok: false,
      reason: `"description" is longer than ${String(TOUR_DESCRIPTION_MAX_CHARS)} characters`,
    });
  });

  it('counts characters, not UTF-16 units: an emoji is one', () => {
    // A cap in code units would refuse a German or emoji-rich text the
    // editor's own counter called short enough.
    expect(
      checkTourDescription('🙂'.repeat(TOUR_DESCRIPTION_MAX_CHARS))
    ).toMatchObject({ ok: true });
  });
});

describe('checkTourContact', () => {
  it('keeps an e-mail address, bare or as mailto:, and an http(s) link', () => {
    for (const contact of [
      'guide@example.org',
      'mailto:guide@example.org',
      'MAILTO:guide@example.org',
      'tour.guide+castle@sub.example.co.uk',
      'info@müller-touren.de',
      'https://example.org/tours/castle',
      'http://example.org',
    ]) {
      expect(checkTourContact(` ${contact} `)).toEqual({
        ok: true,
        value: contact,
      });
    }
  });

  it('refuses anything a visitor could not safely follow as a link', () => {
    for (const contact of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://example.org/x',
      'www.example.org',
      'call me',
      'guide@example',
      'guide@@example.org',
      'mailto:guide@example.org?subject=x',
      'https://user@evil.example/',
      'https://user:pw@example.org/',
      'guide example@example.org',
    ]) {
      expect(checkTourContact(contact), contact).toMatchObject({ ok: false });
    }
  });

  it('refuses an over-long contact and a non-string', () => {
    const long = `${'a'.repeat(TOUR_CONTACT_MAX_CHARS)}@example.org`;
    expect(checkTourContact(long)).toMatchObject({ ok: false });
    expect(checkTourContact(null)).toMatchObject({ ok: false });
  });
});

describe('checkTourCover', () => {
  it("keeps one of the tour's image ids, and nothing else", () => {
    expect(checkTourCover('f1', IMAGES)).toEqual({ ok: true, value: 'f1' });
    expect(checkTourCover('gone', IMAGES)).toEqual({
      ok: false,
      reason: '"cover" names no image of this tour',
    });
    expect(checkTourCover('../f1', IMAGES)).toMatchObject({ ok: false });
    expect(checkTourCover(7, IMAGES)).toMatchObject({ ok: false });
  });
});

describe('tourContactHref', () => {
  it('leads an e-mail address to mailto:, a link to itself', () => {
    expect(tourContactHref('guide@example.org')).toBe(
      'mailto:guide@example.org'
    );
    expect(tourContactHref('mailto:guide@example.org')).toBe(
      'mailto:guide@example.org'
    );
    expect(tourContactHref(' https://example.org/x ')).toBe(
      'https://example.org/x'
    );
  });

  it('leads nowhere for a value the check refuses', () => {
    expect(tourContactHref('javascript:alert(1)')).toBeNull();
    expect(tourContactHref('')).toBeNull();
  });
});

describe('parseTourDetails', () => {
  it('reads the three details', () => {
    expect(
      parseTourDetails(
        {
          description: ' Up to the castle. ',
          cover: 'cover-art',
          contact: 'guide@example.org',
        },
        { imageIds: IMAGES }
      )
    ).toEqual({
      details: {
        description: 'Up to the castle.',
        cover: 'cover-art',
        contact: 'guide@example.org',
      },
      dropped: [],
    });
  });

  it('reads a document without details as none, dropping nothing', () => {
    expect(parseTourDetails({ title: 'x' }, { imageIds: IMAGES })).toEqual({
      details: {},
      dropped: [],
    });
  });

  it('drops each value that fails, with its reason, and keeps the rest', () => {
    // A visitor must still get the tour: a deleted cover photo or a
    // hand-edited contact costs the detail, never the tour.
    const read = parseTourDetails(
      { description: 'Fine.', cover: 'gone', contact: 'javascript:alert(1)' },
      { imageIds: IMAGES }
    );
    expect(read.details).toEqual({ description: 'Fine.' });
    expect(read.dropped.map((d) => d.field)).toEqual(['cover', 'contact']);
    expect(read.dropped[0]?.reason).toMatch(/names no image/);
  });
});

describe('a mailto: link escapes what would start a query', () => {
  it('keeps an RFC address with & or ? in it, and escapes them in the link', () => {
    // Why: RFC 5322 allows them before the @, and an unescaped ? would
    // turn the rest of the address into a mail header in the visitor's
    // mail app.
    expect(checkTourContact('a&b?c@example.org')).toMatchObject({ ok: true });
    expect(tourContactHref('a&b?c@example.org')).toBe(
      'mailto:a%26b%3Fc@example.org'
    );
  });
});

describe('tourImageIds and tourCoverEntry', () => {
  // Why: which ids a cover may name, and which archive entry it shows, is
  // one rule for the reader, the editor's cover choices and the visitor's
  // start page. A pin, an audio or a model asset is never a cover.
  const tour = {
    objects: [
      { id: 'p1', kind: 'pin' as const },
      { id: 'f1', kind: 'photo' as const, image: 'content/f1.jpg' },
    ],
    assets: [
      { id: 'art', kind: 'image' as const, path: 'content/art.png' },
      { id: 'song', kind: 'audio' as const, path: 'content/song.mp3' },
    ],
  };

  it("names the placed photos' and the image assets' ids, nothing else", () => {
    expect([...tourImageIds(tour)].sort()).toEqual(['art', 'f1']);
  });

  it("leads a cover to its image's entry, and nowhere for a missing or non-image one", () => {
    expect(tourCoverEntry({ ...tour, cover: 'f1' })).toBe('content/f1.jpg');
    expect(tourCoverEntry({ ...tour, cover: 'art' })).toBe('content/art.png');
    expect(tourCoverEntry({ ...tour, cover: 'song' })).toBeNull();
    expect(tourCoverEntry({ ...tour, cover: 'p1' })).toBeNull();
    expect(tourCoverEntry({ ...tour, cover: 'gone' })).toBeNull();
    expect(tourCoverEntry(tour)).toBeNull();
  });
});
