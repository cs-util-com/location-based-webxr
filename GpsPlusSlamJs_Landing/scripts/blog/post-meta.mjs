// @ts-check
/**
 * post-meta.mjs — parses one project-wiki markdown page into a blog post.
 *
 * This module IS the publication gate (plan decision D14): the site build
 * renders only what this parser reports as `published`, and the parser is
 * deliberately biased in one direction — anything it does not fully
 * understand is a draft. A missed publication is an inconvenience; an
 * accidental one is public and irreversible.
 *
 * The marker is an HTML comment rather than YAML front matter because the
 * same file is read by humans in the GitHub wiki UI, where an HTML comment
 * renders as nothing at all:
 *
 *     <!--
 *     blog-meta
 *     status: published
 *     date: 2026-08-20
 *     description: Sparse features, and what actually fixes them.
 *     tags: webxr, gps
 *     slug: why-outdoor-webxr-drifts
 *     -->
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/**
 * @typedef {object} Post
 * @property {string} slug URL segment under /blog/
 * @property {string} title rendered as the page's H1 and <title>
 * @property {'published' | 'draft'} status D14 gate result
 * @property {string} [draftReason] why it is a draft, for the build log
 * @property {string} date ISO calendar date (`YYYY-MM-DD`), '' when absent
 * @property {string} description meta description / card subtitle
 * @property {string[]} tags free-form topic tags
 * @property {string} body markdown body, meta block and title heading removed
 */

const META_BLOCK_RE = /<!--\s*blog-meta\s*\n([\s\S]*?)-->/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TITLE_RE = /^#\s+(.+?)\s*$/m;
const DESCRIPTION_MAX = 200;

/**
 * @param {string} value
 * @returns {string} lowercase, dash-separated, safe as a single URL segment
 */
function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A date is trustworthy only if it is ISO-shaped AND a real calendar day —
 * `2026-02-31` satisfies the pattern but does not exist, and Date would
 * silently roll it forward into March.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isCalendarDate(value) {
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  );
}

/**
 * @param {string} block raw text between the meta comment delimiters
 * @returns {Record<string, string>} lowercase keys → trimmed values
 */
function parseMetaBlock(block) {
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key === '') {
      continue;
    }
    meta[key] = line.slice(separator + 1).trim();
  }
  return meta;
}

/**
 * First prose paragraph, flattened to one line — used when the author gave no
 * explicit description. Fenced code, headings and list markers make poor
 * search-result subtitles, so they are skipped rather than truncated.
 *
 * @param {string} body markdown with the title heading already removed
 * @returns {string}
 */
function firstParagraph(body) {
  const withoutFences = body.replace(/```[\s\S]*?```/g, '');
  for (const block of withoutFences.split(/\n\s*\n/)) {
    const text = block.trim().replace(/\s+/g, ' ');
    if (text === '' || /^[#>\-*+|]/.test(text)) {
      continue;
    }
    return text.length > DESCRIPTION_MAX
      ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`
      : text;
  }
  return '';
}

/**
 * Parse a wiki page into a {@link Post}.
 *
 * Never throws on malformed *content* — malformed content is simply a draft,
 * because a parser that throws on the twenty-ninth page fails the whole build
 * and takes the twenty-eight good ones down with it. It DOES throw on
 * malformed *arguments*, which is a programming error in the caller.
 *
 * @param {string} fileName wiki file name, e.g. `Why-outdoor-webxr-drifts.md`
 * @param {string} source the file's full markdown text
 * @returns {Post}
 */
export function parsePost(fileName, source) {
  if (typeof fileName !== 'string') {
    throw new TypeError('parsePost: fileName must be a string');
  }
  if (typeof source !== 'string') {
    throw new TypeError('parsePost: source must be a string');
  }

  const pageName = fileName.replace(/\.md$/i, '');
  const metaMatch = META_BLOCK_RE.exec(source);
  const meta = metaMatch?.[1] ? parseMetaBlock(metaMatch[1]) : undefined;

  const withoutMeta = metaMatch ? source.replace(META_BLOCK_RE, '') : source;
  const titleMatch = TITLE_RE.exec(withoutMeta);
  const title = titleMatch?.[1] ?? pageName.replace(/[-_]+/g, ' ').trim();
  const body = (titleMatch ? withoutMeta.replace(TITLE_RE, '') : withoutMeta)
    .replace(/^\s*\n/, '')
    .trimEnd();

  const slugSource = meta?.['slug'] ? meta['slug'] : pageName;
  const date = meta?.['date'] ?? '';
  const description = meta?.['description']
    ? meta['description']
    : firstParagraph(body);
  const tags = (meta?.['tags'] ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const slug = slugify(slugSource);

  /** @type {string | undefined} */
  let draftReason;
  if (!meta) {
    draftReason = 'no blog-meta block';
  } else if ((meta['status'] ?? '').trim().toLowerCase() !== 'published') {
    draftReason = `status is ${JSON.stringify(meta['status'] ?? '')}`;
  } else if (date === '') {
    draftReason = 'no date';
  } else if (!isCalendarDate(date)) {
    draftReason = `date ${JSON.stringify(date)} is not a real YYYY-MM-DD day`;
  } else if (slug === '') {
    // A page named only of punctuation (or an empty `slug:` override) leaves
    // nothing to build a URL from, and would publish to `/blog//`.
    draftReason = `page name ${JSON.stringify(slugSource)} yields an empty slug`;
  }

  return {
    slug,
    title,
    status: draftReason ? 'draft' : 'published',
    ...(draftReason ? { draftReason } : {}),
    date,
    description,
    tags,
    body,
  };
}
