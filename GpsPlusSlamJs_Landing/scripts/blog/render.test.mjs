import { describe, expect, it } from "vitest";

import { renderIndex, renderPost } from "./render.mjs";

// Why this test matters: these pages are the canonical copies of every
// article (plan decision D6). If the canonical link, the title or the
// description is wrong, the syndicated copies on dev.to and the indexable
// GitHub wiki copy win the search result instead — which is the specific
// failure the whole canonical-home decision exists to avoid.

const ORIGIN = "https://gps.csutil.com";

/** @param {Partial<import('./post-meta.mjs').Post>} [overrides] */
const post = (overrides = {}) => ({
  slug: "why-outdoor-webxr-drifts",
  title: "Why outdoor WebXR drifts",
  status: /** @type {const} */ ("published"),
  date: "2026-08-20",
  description: "Sparse features, and what actually fixes them.",
  tags: ["webxr", "gps"],
  body: "## The short answer\n\nGPS is noisy.\n",
  ...overrides,
});

describe("renderPost", () => {
  it("points the canonical link at the blog URL for this slug", () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain(
      `<link rel="canonical" href="${ORIGIN}/blog/why-outdoor-webxr-drifts/" />`,
    );
    expect(html).toContain(
      `<meta property="og:url" content="${ORIGIN}/blog/why-outdoor-webxr-drifts/" />`,
    );
  });

  it("carries the title and description search engines will show", () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain("<title>Why outdoor WebXR drifts</title>");
    expect(html).toContain(
      '<meta name="description" content="Sparse features, and what actually fixes them." />',
    );
  });

  it("renders the markdown body to HTML", () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain("The short answer");
    expect(html).toContain("<h2");
    expect(html).toContain("<p>GPS is noisy.</p>");
  });

  it("escapes metadata so a quote in a title cannot break the head", () => {
    const html = renderPost(
      post({
        title: 'The "sub-meter" claim & what it means',
        description: 'Quotes " and ampersands & in a description.',
      }),
      { origin: ORIGIN },
    );

    expect(html).toContain(
      "<title>The &quot;sub-meter&quot; claim &amp; what it means</title>",
    );
    expect(html).toContain(
      'content="Quotes &quot; and ampersands &amp; in a description."',
    );
    // The raw quote would have terminated the attribute early.
    expect(html).not.toContain('content="Quotes " and');
  });

  it("ships a social card image, because it declares a large-image card", () => {
    // `summary_large_image` with no image renders WORSE than `summary` would:
    // a bare text card, on exactly the channels this blog exists to feed. The
    // asset already ships at the site root for the landing page.
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain(
      `<meta property="og:image" content="${ORIGIN}/og-card.png" />`,
    );
    expect(html).toContain(
      `<meta name="twitter:image" content="${ORIGIN}/og-card.png" />`,
    );
  });

  it("states the publication date in a machine-readable form", () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toContain('datetime="2026-08-20"');
  });

  it("links back to the site so a search visitor can reach the project", () => {
    const html = renderPost(post(), { origin: ORIGIN });

    expect(html).toMatch(/href="\/"/);
  });

  it("refuses to render a draft, which is the D14 gate’s last line", () => {
    // Defence in depth: selection filters drafts, but a future caller that
    // forgets must fail loudly rather than publish.
    expect(() =>
      renderPost(post({ status: "draft", draftReason: "no date" }), {
        origin: ORIGIN,
      }),
    ).toThrow(/draft/i);
  });
});

describe("renderIndex", () => {
  it("lists posts newest first and links each one", () => {
    const html = renderIndex(
      [
        post({ slug: "older", title: "Older", date: "2026-08-01" }),
        post({ slug: "newer", title: "Newer", date: "2026-08-19" }),
      ],
      { origin: ORIGIN },
    );

    expect(html.indexOf("Newer")).toBeLessThan(html.indexOf("Older"));
    expect(html).toContain('href="/blog/newer/"');
    expect(html).toContain('href="/blog/older/"');
  });

  it("says so plainly when there is nothing published yet", () => {
    const html = renderIndex([], { origin: ORIGIN });

    expect(html).toContain("<title>");
    expect(html).toMatch(/no posts|nothing published|coming soon/i);
  });

  it("gives the index its own canonical link", () => {
    const html = renderIndex([post()], { origin: ORIGIN });

    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/blog/" />`);
  });
});

describe("a post body is untrusted input", () => {
  // Why these tests matter: the blog's source is the project's GitHub WIKI, and
  // a wiki on a public repo is world-writable unless "Restrict edits to
  // collaborators only" is ticked — a setting the build cannot see, the REST API
  // does not expose, and an admin can untick later without touching this code.
  // The first version of render.mjs passed raw HTML through on the strength of
  // that assumption. These pin the two rules that replaced it, and they are
  // written as ATTACKS rather than as "renders markdown correctly", because the
  // property that matters is what does NOT come out.
  //
  // The D14 publication gate is not a second line of defence here: it guards the
  // meta block, so it stops an unpublished page going live and does nothing
  // about the body of a page that is already published.

  /** @param {string} body */
  const render = (body) => renderPost(post({ body }), { origin: ORIGIN });

  it("drops a script tag rather than shipping it to the site", () => {
    const html = render("Intro\n\n<script>alert(document.cookie)</script>\n");

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("document.cookie");
  });

  it("drops inline HTML too, not just block-level", () => {
    // Block and inline raw HTML are different token types in marked; an
    // implementation that only handled the block case would pass the test above
    // and still ship `<img onerror=...>` in the middle of a sentence.
    const html = render(
      'A sentence <img src=x onerror="alert(1)"> continues.\n',
    );

    expect(html).not.toContain("onerror");
    expect(html).toContain("A sentence");
    expect(html).toContain("continues.");
  });

  it("neutralises a javascript: link written in pure markdown", () => {
    // Dropping HTML alone would close one door and leave this one open —
    // `[text](javascript:…)` needs no HTML at all.
    const html = render("[click me](javascript:alert(1))\n");

    expect(html).not.toContain("javascript:");
    // The words survive; only the link is removed. Deleting the text would
    // silently rewrite the author's sentence.
    expect(html).toContain("click me");
  });

  it("is not fooled by control characters inside the scheme", () => {
    // Browsers resolve `java\tscript:` and `java\nscript:` as `javascript:`, so
    // a prefix test on the raw string is bypassable in one keystroke.
    const html = render(
      "[x](java\tscript:alert(1)) [y](java\nscript:alert(1))\n",
    );

    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("blocks a data: URL in an image", () => {
    const html = render(
      "![alt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)\n",
    );

    expect(html).not.toContain("data:text/html");
    expect(html).toContain("alt");
  });

  it("still renders the links and images a real post needs", () => {
    // The guard has to be narrow enough to leave ordinary writing alone,
    // otherwise it will be removed the first time it is inconvenient.
    const html = render(
      "[docs](https://gps.csutil.com/docs) and [home](/) and " +
        "[mail](mailto:code@csutil.com) and [top](#intro)\n\n" +
        "![shot](/img/shot.png)\n",
    );

    expect(html).toContain('href="https://gps.csutil.com/docs"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="mailto:code@csutil.com"');
    expect(html).toContain('href="#intro"');
    expect(html).toContain('src="/img/shot.png"');
  });

  it("still renders ordinary markdown structure", () => {
    const html = render("## Heading\n\n- one\n- two\n\n`code`\n");

    expect(html).toContain("<h2");
    expect(html).toContain("<li>");
    expect(html).toContain("<code>");
  });
});
