# tour-markdown.ts

**Purpose:** the body of a station's long text, read. A small Markdown
subset goes in; out come a typed tree to show, the plain text `P` a
narrator reads (with the range each paragraph or heading covers in it),
and the hash of `P` that tells a recorded read-along timing whether it
still fits its text. Pure TypeScript: no DOM, no renderer, no I/O; the hash
is the only asynchronous part. Not exported from `src/ar/index.ts`; it is a
per-file dist entry, deep-imported as `gps-plus-slam-app-framework/ar/tour-markdown`.

## The subset

- **Accepted, with its CommonMark meaning:**
  - paragraphs, with soft breaks and hard breaks (two spaces or a
    backslash at the line end);
  - ATX headings `#`, `##`, `###` (closing hashes allowed);
  - bullet lists with `-` or `*`, ordered lists with `1.`, nested at most
    two levels deep;
  - one level of `>` quotes;
  - `*em*`, `_em_`, `**strong**`, `__strong__`;
  - inline links `[text](https://...)`;
  - pictures `![alt](asset:<id>)`, each on a line of its own (a paragraph
    whose every line holds one such picture and nothing else but spaces
    and tabs becomes picture blocks, at most `TOUR_MARKDOWN_MAX_PICTURES`
    = 20 per body);
  - backslash escapes of ASCII punctuation.
- **Shown as the characters typed** (never a failure, never hidden):
  - raw HTML, code spans, fenced code, entity and numeric references,
    autolinks, reference links and definitions, link titles, tables,
    strikethrough, footnotes;
  - setext headings and thematic breaks (the line stays text);
  - headings deeper than `###`, a third list level, a nested quote, `+`
    bullets and `1)` lists;
  - indented code reads as an ordinary paragraph (its indent dropped).
- **Pictures that cannot stand where they are** - inside a paragraph, two
  on one line, with a target other than `asset:<id>`, or past the
  twentieth - become a
  `pictureAlt` inline: the alt text, meant to be shown in a box.
- **A link whose target fails `checkTourLink`** keeps its text and loses
  the link.
- **Emphasis nested deeper than 16** is read as its content.
- **NUL** reads as U+FFFD, as in CommonMark.

## Public API

- Types: `TourMdInline` (`text`, `emphasis`, `strong`,
  `link {href, host, children}`, `softBreak`, `hardBreak`,
  `pictureAlt {alt}`), `TourMdParagraph`, `TourMdHeading {level: 1|2|3}`,
  `TourMdList {ordered, start, items}`, `TourMdQuote`,
  `TourMdPicture {alt, asset}`, `TourMdBlock`, `TourMarkdown {blocks}`,
  `TourMdLeaf {block, from, to}`, `TourPlainText {text, leaves}`,
  `TourLinkCheck`.
- `TOUR_MARKDOWN_MAX_PICTURES = 20`.
- `parseTourMarkdown(body): TourMarkdown` - never throws; a value that is
  not a string reads as an empty body.
- `plainTextOf(doc): TourPlainText` - `P` and its leaves:
  - each paragraph and heading at any depth is a leaf, in document order;
  - a soft break is a space, a hard break is `"\n"`, a link is its text,
    `pictureAlt` and picture blocks add nothing, emphasis adds nothing;
  - each leaf is trimmed of spaces, tabs and newlines at its ends, and an
    empty leaf is dropped;
  - leaves are joined with `"\n\n"`; `[from, to)` are UTF-16 code unit
    offsets into `P`.
- `escapeTourMarkdown(text): string` - plain text as a body whose `P` is
  that text, normalised: every ASCII punctuation character escaped, each
  line trimmed of spaces and tabs, a line break kept as a hard break, one
  or more empty lines as one paragraph break. A non-string gives `''`.
- `checkTourLink(target): TourLinkCheck` - accepted when the URL parser
  reads it, the scheme is `https:`, it has a host, and it carries no user
  name or password; `href` and the ASCII (`xn--`) `host` are the parser's.
- `__tourMarkdownWalkStepsForTests(body): number` - `@internal`, a testing
  seam named as the package names them; not part of reading: how many
  iterations the loops that walk the parser's own stacks, lists and trees
  and the block parser's line scans took (plus one per inline step) while
  reading `body` and its `P`. Exact and deterministic, so the linearity
  test can bound it tightly where timings are too noisy. It is on the
  deep-import surface only because the dist entry is per file.
- `textHashOf(plain): Promise<string>` - `"sha256:"` plus the lowercase hex
  SHA-256 of `P`'s UTF-8 bytes, through `utils/sha256-hex.ts`. Rejects for
  a non-string, and when WebCrypto is unavailable. A lone surrogate is
  encoded as U+FFFD (as `TextEncoder` does), so two texts that differ only
  there hash alike; offsets are unaffected, one code unit either way.

## Invariants & assumptions

- **Agreement with CommonMark inside the subset.** The block parser is the
  reference implementation's line-by-line container algorithm and the
  inline parser its delimiter and bracket stacks, cut down to the subset;
  a property test holds the two to the same tree, within its generators'
  alphabets.
- **Where the reference and the spec differ, this parser follows the
  spec.** Each such place is pinned by a unit test, and the differential
  skips the bodies that reach it by name. Known today (`commonmark`
  0.31.2):
  - beside a `*` or `_` run a character is classified by code point, so an
    emoji is a symbol; the reference looks at one UTF-16 unit and reads half
    a surrogate pair as neither punctuation nor whitespace (`a*😀*a` is
    emphasis there, text here);
  - a paragraph or heading is trimmed of spaces and tabs only; the
    reference trims every Unicode space, so a no-break space at a line's
    end or an ideographic space opening a paragraph is kept in `P` here and
    dropped there;
  - a form feed does not make a line blank (a line `- ` followed by a form
    feed after a paragraph line opens a list here and continues the
    paragraph there; the generators produce no form feed);
  - a link destination ends at any ASCII control character (U+0000 to
    U+001F, U+007F), so such brackets stay text; the reference lets the
    character through and percent-encodes it;
  - spaces and tabs (with up to one line end) may stand around a
    destination; the reference skips spaces only.
- **A link's href is the URL parser's reading of the unescaped
  destination** (the design's rule, not a spec matter). The reference
  percent-encodes the destination first, so a backslash, `|` and `^` read
  differently: a destination `https://x.org/a` + backslash + `b` is
  `https://x.org/a/b` here and `https://x.org/a%5Cb` there. The shown host
  and the real target agree in both readings. No generated destination
  holds those characters.
- **Totality and linear time.** Any string reads. The bracket stack's
  "no links inside links" rule is a floor index, link destinations are
  scanned with a precomputed parenthesis index, and adjacent literal text
  is appended to one node, so no input shape rescans what was read.
  The walk steps per character are the same at 8 k and 128 k characters
  on every adversarial shape in the linearity test. The count includes
  the block parser's line scans (indentation, blank and thematic break
  checks, digit runs), which run once per block a line tries to open: they
  stay linear only because the nesting limits cap those attempts at a few
  per line, and a raised limit would show in the count. Scans that only
  move forward or run once per block (text runs, delimiter runs, trims)
  are not counted. Measured on a desktop
  (not a phone): a realistic 32 k body parses in about 3.5 ms and 1 MB in
  about 140 ms. The time per character steps up about threefold between
  256 k and 1 M characters on bracket-heavy shapes and is flat from there
  to 4 M (allocation, not rescanning; the reference shows the same step).
- **Memory.** Reading a paragraph that holds a `](` builds the
  destination index: four `Int32Array`s of the paragraph's length, about
  16 bytes per character at the peak (some 16 MB for a 1 MB paragraph).
  The reader sets no length cap; a cap belongs to the format.
- **`P` is stable under formatting**: removing emphasis or changing a
  heading's level never changes it; that is what lets a creator restyle a
  text without invalidating a recording.
- **`P` is frozen data.** A recorded timing stores `textHashOf(P)`, so a
  change to how any body reads is a change to stored data; the golden
  corpus pins it. No normalisation step: a decomposed character stays
  decomposed.
- **`P` depends on the engine's Unicode tables.** Flanking reads the
  Unicode P, S and Zs categories through the engine's regular
  expressions, so a character newer than an engine's tables (a recent
  emoji) is unassigned there and may change whether a `_` beside it is
  emphasis, and so `P`. The reference shares this; a bundled range table
  for one Unicode version would remove it.

## Examples

```ts
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from 'gps-plus-slam-app-framework/ar/tour-markdown';

const doc = parseTourMarkdown('# The mill\n\nBuilt in *1820*.');
const { text, leaves } = plainTextOf(doc);
// text === 'The mill\n\nBuilt in 1820.'
// leaves[1] covers text.slice(10, 24)
const hash = await textHashOf(text); // 'sha256:...'
```

## Tests

- `tour-markdown.test.ts` - every accepted construct, the "as typed"
  table, pictures and their cap, links and their refusals, the escaper,
  hash vectors computed with Node's crypto, defensive input, and the
  CommonMark edge cases (tab columns, list padding, flanking, the rule of
  three, links in links, destinations) that a scoped mutation pass showed
  were otherwise unpinned. The surviving mutants are equivalent: they
  differ only on lone surrogates, on characters the block parser never
  passes on (a carriage return, spaces after a line break), on unreachable
  defensive defaults, in the walk-step counter, or in work rather than
  result (merging literal text, dropping closers that cannot open).
- `tour-markdown.property.test.ts` - the differential against `commonmark`
  (a devDependency only) on generated subset bodies and on filtered
  arbitrary strings, short (up to about 10 pieces, with no-break and
  ideographic spaces at line ends) and long (up to 300 pieces; the bodies
  compared average about 130 characters), skipping by name the bodies that
  reach a spec departure above; totality up to 1 MB; `P` invariants under
  removed formatting and through the escaper.
- `tour-markdown.golden.test.ts` - 43 bodies with hand-written `P` and
  hashes from Node's crypto, frozen.
- `tour-markdown.linearity.test.ts` - walk steps per character at 8 k
  against 128 k characters on adversarial shapes (deterministic; timings
  on a loaded machine spread too widely to bound).
