/**
 * Why this corpus matters: the plain text P of a body, and its hash, are
 * stored next to recorded audio and its word timings, so a change to how
 * any of these bodies reads would mark every such recording stale. The
 * expected P values were written by hand from the subset's rules, and the
 * hashes computed with Node's crypto rather than with textHashOf; both are
 * frozen. A change here is a change to stored data, never a test fix.
 */

import { describe, expect, it } from 'vitest';

import { parseTourMarkdown, plainTextOf, textHashOf } from './tour-markdown';

/** [name, body, P, hash of P] */
const GOLDEN: readonly (readonly [string, string, string, string])[] = [
  [
    'one sentence',
    'Hello world.',
    'Hello world.',
    'sha256:aa3ec16e6acc809d8b2818662276256abfd2f1b441cb51574933f3d4bd115d11',
  ],
  [
    'a soft break',
    'Line one\nline two',
    'Line one line two',
    'sha256:51ce2e1b98a7630be984823b7492236dd6fb38eba39e4f6a53539ba7f963dbc8',
  ],
  [
    'a hard break by two spaces',
    'Line one  \nline two',
    'Line one\nline two',
    'sha256:a8fee84835e9d41ff98f4551d53842aedc9179becd34b23ac9d846fcbed25b50',
  ],
  [
    'a hard break by backslash',
    'Line one\\\nline two',
    'Line one\nline two',
    'sha256:a8fee84835e9d41ff98f4551d53842aedc9179becd34b23ac9d846fcbed25b50',
  ],
  [
    'two paragraphs',
    'First paragraph.\n\nSecond paragraph.',
    'First paragraph.\n\nSecond paragraph.',
    'sha256:8b3fc5d6135a0b4d6ab515fb6ce3cc503984845fc4ff38a4a91a2dc2e9adec0f',
  ],
  [
    'blank lines between paragraphs',
    'a\n\n\n\nb',
    'a\n\nb',
    'sha256:38022fd2b8dbc5cb3d2cee74e083edbf59e3d4e13d067ebcb5db633d4cff4d8c',
  ],
  [
    'a heading and a paragraph',
    '# The mill\n\nBuilt in 1820.',
    'The mill\n\nBuilt in 1820.',
    'sha256:5c397395a99d53141f7ad54bab0bb7437946940d1ccbde086d21b90e3a70c4ac',
  ],
  [
    'a heading with emphasis and closing hashes',
    '## Water *and* stone ##',
    'Water and stone',
    'sha256:2be39eb5a3227a279d2266dd6cc14676a76d10ace0ba11cbdf6f512b55c8bae9',
  ],
  [
    'a fourth heading level',
    '#### Too deep',
    '#### Too deep',
    'sha256:049695b25ee6663d3af72df81c1ea4be1503dea0e9abde0e61e476526407aac0',
  ],
  [
    'a hash without a space',
    '#No space',
    '#No space',
    'sha256:fa44496049b281d4d17c4d747d8da8ba0ad4269019e6d3e931bbf29a61ee2522',
  ],
  [
    'a bullet list',
    '- apples\n- pears\n* plums',
    'apples\n\npears\n\nplums',
    'sha256:04bdc6de3097561631b8b2fcfee0df4e03e7b00c7e24d5682bf7f4c163bb70a5',
  ],
  [
    'an ordered list from 3',
    '3. third\n4. fourth',
    'third\n\nfourth',
    'sha256:871470008c40a8059282aa63fae4dee1e80178c961504d12f1b7f5775c75fb79',
  ],
  [
    'a loose ordered list',
    '1. one\n\n2. two',
    'one\n\ntwo',
    'sha256:f1687a1c91e7dabb67da04e90073a106ff7ad470212e3c98986afd56472abef8',
  ],
  [
    'a nested list',
    '- outer\n  - inner',
    'outer\n\ninner',
    'sha256:11daa7414a265e095ab745317a84b2a2d5a0f67f441cbbd67ca04e5d8e8c5198',
  ],
  [
    'a third list level',
    '- a\n  - b\n    - c',
    'a\n\nb - c',
    'sha256:15ab374c31e659a73bf0972b540cee315b022eec4cec02514e835668b765834c',
  ],
  [
    'a plus bullet',
    '+ plus bullet',
    '+ plus bullet',
    'sha256:c94ce710b9b9ee89745ab2608b61eb76c95aac8af2fe5152decc09b542b60e79',
  ],
  [
    'a paren list',
    '1) paren',
    '1) paren',
    'sha256:97d85c7c4945110133e373fbe9c913a7cf3288cebe42405446b4d4f861fb31e7',
  ],
  [
    'a task box',
    '- [ ] task',
    '[ ] task',
    'sha256:92efcf1984fe4a65506426eb5bee8a429397405aac418b34ce14af10b8dc6106',
  ],
  [
    'a quote over two lines',
    '> A quote\n> continues',
    'A quote continues',
    'sha256:112363add790ee9ecf008e88d9bd7b9b4ca06768b085d6d2c440137866b6a2d1',
  ],
  [
    'a nested quote',
    '> > nested',
    '> nested',
    'sha256:3152e766638e8738c9f0932976ba486a6aa5a057618aa7cec269260638e8baa1',
  ],
  [
    'emphasis of every kind',
    '**Bold** and _em_ and __strong__ and *it*',
    'Bold and em and strong and it',
    'sha256:4be1899815e95363614e4b45a94538f5aeb1e3e3e44637bb142c4ea662195e69',
  ],
  [
    'unclosed emphasis',
    '*open',
    '*open',
    'sha256:344596c20ff384d97d1c5b69e95637f0eff89b123ae132959da1cecb54feeee5',
  ],
  [
    'a spaced star',
    'Price: 5 * 3 = 15',
    'Price: 5 * 3 = 15',
    'sha256:1e9a74415f6eee294c20c7654e2fdc5d77ffc2abd0b34ba3929f45092bd76c6a',
  ],
  [
    'intraword underscores',
    'snake_case_name',
    'snake_case_name',
    'sha256:3c9c0f3e56cb2ddb579cdf6eb0107583927f23cee01afa3845c1458ef32303ba',
  ],
  [
    'escaped stars',
    '\\*not emphasis\\*',
    '*not emphasis*',
    'sha256:a5a2b26c8b479698fc7e7e7399e697aee2d5f9fedf03361329c18014b0d40d2b',
  ],
  [
    'a backslash ending a paragraph',
    'end\\',
    'end\\',
    'sha256:c98815a9bf17d4a746e7716c77eb9a189900937339bc9ddfe2d0a91546323d11',
  ],
  [
    'a link',
    'See [the archive](https://example.org/a) today.',
    'See the archive today.',
    'sha256:aacd97107037a7764fb53a026f0324a7b9456d251eb136173e5e975abe836b22',
  ],
  [
    'a link with strong text',
    '[**big** news](https://example.org)',
    'big news',
    'sha256:dc67d43857d7ea562153ca6ec6890da5339728e8c87a5b3046ee71bd2a0eedb3',
  ],
  [
    'an IDN link',
    '[Bücher](https://bücher.example/)',
    'Bücher',
    'sha256:a74462dfa46630c61e668daa16e10424544370b39403a3e61a670559a1fa4b61',
  ],
  [
    'a refused http link',
    '[plain](http://example.org)',
    'plain',
    'sha256:a116c9ed46d6207734a43317d30fd88f52ac8634c37d904bbf4e41d865f90475',
  ],
  [
    'a picture line',
    '![A tree](asset:tree_1)',
    '',
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ],
  [
    'a picture inside text',
    'Look ![a tree](asset:tree_1) here',
    'Look  here',
    'sha256:47a2235e57a46db5bfd96e3f9c204bd98efd6a32eb0f27914b4c7bc96643eaf1',
  ],
  [
    'a thematic break line',
    '---',
    '---',
    'sha256:cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b',
  ],
  [
    'indented code',
    '    indented code',
    'indented code',
    'sha256:c23550f2b76a12a713b32f1fcffaab50eb6ad97bd19687bda611757f3d61b95e',
  ],
  [
    'code, html and entities',
    '`code` <b>x</b> &amp;',
    '`code` <b>x</b> &amp;',
    'sha256:9f28465b0b7e97ec7edf06d16274939a5e2b32c0f4278b596f3f59407dd9068e',
  ],
  [
    'non-ASCII text',
    'Café, naïve, 中文, 😀',
    'Café, naïve, 中文, 😀',
    'sha256:9b669df7eb033514b62faa3f799e8d539b1c6960b1d9030847c1b646c16493b7',
  ],
  [
    'CRLF line endings',
    'a\r\nb\r\n\r\nc',
    'a b\n\nc',
    'sha256:6fd15da2b2c1db77735710a989b9c9310603496a6cc0bcf14031319265390e3a',
  ],
  [
    'a NUL character',
    'NUL\u0000here',
    'NUL�here',
    'sha256:abc90f539f8da11afd8cd3b16e4e67bf49e396771b019d37f63aa5137f9c152e',
  ],
  [
    'only whitespace',
    '   \n\n\t\n',
    '',
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ],
  [
    'trailing spaces before a blank line',
    'trailing spaces   \n\nnext',
    'trailing spaces\n\nnext',
    'sha256:82edc5f3f1e53ebdda4d0d17b36c6edba3e3f6e2c4b99e54ecaf7d0912683ef0',
  ],
  [
    'a whole station text',
    '# Title\n\nIntro *text*.\n\n- point one\n- point two\n\n> A quote.\n\n![x](asset:a)\n\nEnd.',
    'Title\n\nIntro text.\n\npoint one\n\npoint two\n\nA quote.\n\nEnd.',
    'sha256:ba4d9eb268b8fde3d87cb2dd27cf923c690ff4f9ee99352ab33b3b2f6d8f4138',
  ],
];

describe('tour markdown golden corpus', () => {
  for (const [name, body, plain, hash] of GOLDEN) {
    it(`reads ${name}`, async () => {
      expect(plainTextOf(parseTourMarkdown(body)).text).toBe(plain);
      expect(await textHashOf(plain)).toBe(hash);
    });
  }
});
