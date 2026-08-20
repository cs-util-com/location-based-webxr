# `post-meta.mjs`

**Purpose:** parse one GitHub-wiki markdown page into a blog post, and decide
whether it may be published. This module _is_ the D14 publication gate.

## Public API

- `parsePost(fileName: string, source: string): Post`
  - `fileName` — the wiki file name, e.g. `Why-outdoor-webxr-drifts.md`.
  - `source` — the file's full markdown text.
  - Returns `{ slug, title, status, draftReason?, date, description, tags, body }`.
  - Throws `TypeError` when either argument is not a string. Never throws on
    malformed _content_ — malformed content is a draft, so one bad page cannot
    take a whole build down with it.

## The marker

An HTML comment, not YAML front matter, because the same file is read by humans
in the wiki UI where an HTML comment renders as nothing:

```markdown
<!--
blog-meta
status: published
date: 2026-08-20
description: Sparse features, and what actually fixes them.
tags: webxr, gps
slug: why-outdoor-webxr-drifts
-->

# Why outdoor WebXR drifts
```

## Invariants & assumptions

- **The gate is one-directional.** Anything not fully understood is a draft. A
  missed publication is an inconvenience; an accidental one is public and
  irreversible.
- A post is published **only** when: a `blog-meta` block exists, `status`
  trims/lowercases to exactly `published`, `date` is a real `YYYY-MM-DD`
  calendar day (`2026-02-31` is rejected — `Date` would roll it into March),
  and the slug is non-empty.
- **Every draft carries a `draftReason`**; a silent draft is unactionable.
- `title` is the first `#` heading, else the humanised page name; that heading
  is stripped from `body` so it cannot render twice.
- `description` falls back to the first prose paragraph (fenced code, headings
  and list markers skipped), capped at 200 characters.
- `slug` is lowercase `[a-z0-9-]+`, from `slug:` if given, else the page name.

## Examples

```js
const post = parsePost('Home.md', '# Home\n\nWelcome.\n');
// → { status: 'draft', draftReason: 'no blog-meta block', … }
```

## Tests

- `post-meta.test.mjs` — every gate rule by example, including the near-miss
  keywords (`publish`, `published tomorrow`) and the calendar-invalid date.
- `post-meta.property.test.mjs` — invariants under arbitrary input: never
  throws, publishes only on the exact keyword, always reports a reason, and
  only ever publishes something safe to put in a URL. The published-branch
  property **builds** its input rather than generating it free-form: a random
  string never contains a valid meta block, so the free-form version asserted
  nothing at all. Building the input is what surfaced the empty-slug defect.
