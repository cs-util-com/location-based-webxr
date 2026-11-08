import { describe, expect, it } from 'vitest';

import { TOUR_MARKDOWN_MAX_PICTURES } from './tour-markdown.js';

import { blockBodyAssets, bodyPictureAssets } from './tour-body-assets.js';

describe("the pictures a long text's body shows", () => {
  // Why this test matters: the view switch asks whether a body SHOWS a
  // picture (a lectern shows none), and a body shows its pictures only as
  // picture blocks inside its Markdown, at any depth. A picture missed
  // here lets a lectern hide it; one counted that never shows refuses the
  // lectern for nothing.
  it('lists every picture block at any depth, in order, each once', () => {
    expect(bodyPictureAssets('Just words.')).toEqual([]);
    expect(
      bodyPictureAssets(
        [
          'Intro.',
          '![The gate](asset:gate)',
          '- one\n\n  ![The mill](asset:mill)',
          '> ![The bell](asset:bell)',
          '![The gate again](asset:gate)',
        ].join('\n\n')
      )
    ).toEqual(['gate', 'mill', 'bell']);
  });

  // Why this test matters: an inline picture shows its alt text only (the
  // Markdown subset, design 5.3), so a lectern (which shows no pictures)
  // may still hold this text.
  it('lists no inline picture', () => {
    expect(bodyPictureAssets('Look ![x](asset:a) here.')).toEqual([]);
  });
});

describe("the assets a long text's body names", () => {
  // Why this test matters: a write keeps the assets a body NAMES, shown or
  // not. An inline picture (words on its line) and one past the parser's
  // cap show their alt text, but the body still names them: when the
  // creator moves the picture to a line of its own, or removes an earlier
  // one, it shows again. Keeping only shown pictures deleted their files
  // at a Finish. A plain link to `asset:` and the bare words are no
  // picture and name nothing.
  it('names inline pictures, pictures past the cap and shown ones, in order, once; no link or word', () => {
    const capped = Array.from(
      { length: TOUR_MARKDOWN_MAX_PICTURES + 1 },
      (_, i) => `p${String(i)}`
    );
    const body = [
      'Look ![x](asset:inline) here, and *see ![y](asset:deep)*.',
      ...capped.map((id) => `![${id}](asset:${id})`),
      '> ## A ![z](asset:heading) heading',
      'A [link](asset:linked), asset:word, ![again](asset:inline).',
    ].join('\n\n');
    expect(blockBodyAssets({ body })).toEqual([
      'inline',
      'deep',
      ...capped,
      'heading',
    ]);
    expect(bodyPictureAssets(body)).toEqual(
      capped.slice(0, TOUR_MARKDOWN_MAX_PICTURES)
    );
  });
});
