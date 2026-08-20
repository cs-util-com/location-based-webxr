import { describe, expect, it } from "vitest";

import {
  blueskyRecord,
  devToArticle,
  mastodonStatus,
  mediumImportSteps,
  xComposerUrl,
} from "./syndicate.mjs";

// Why this test matters: syndicated copies exist to send readers and search
// engines back to the canonical article. A copy that loses its canonical link
// competes with the original — which is the exact failure the whole
// canonical-home decision (D6) exists to prevent, and it is invisible until
// the wrong URL starts outranking the right one.
//
// The length limits get the same attention. A marketing post silently
// truncated mid-sentence is worse than one that failed to send, so every
// builder refuses rather than trims.

const ORIGIN = "https://gps.csutil.com";

const post = (overrides = {}) => ({
  slug: "why-outdoor-webxr-drifts",
  title: "Why outdoor WebXR drifts",
  description: "Which layer actually drifts, and which layer fixes it.",
  tags: ["webxr", "ar", "gps", "threejs"],
  body: "## The short answer\n\nGPS is noisy.\n",
  ...overrides,
});

const CREATED_AT = "2026-08-20T21:40:00.000Z";

describe("devToArticle", () => {
  it("carries the canonical URL back to the blog", () => {
    const payload = devToArticle(post(), { origin: ORIGIN });

    expect(payload.article.canonical_url).toBe(
      `${ORIGIN}/blog/why-outdoor-webxr-drifts/`,
    );
    expect(payload.article.title).toBe("Why outdoor WebXR drifts");
    expect(payload.article.body_markdown).toContain("GPS is noisy.");
  });

  it("publishes rather than drafting, because approval already happened", () => {
    // The review gate is upstream: an item only reaches here once approved.
    expect(devToArticle(post(), { origin: ORIGIN }).article.published).toBe(
      true,
    );
  });

  it("refuses more than four tags, which dev.to rejects", () => {
    expect(() =>
      devToArticle(post({ tags: ["a", "b", "c", "d", "e"] }), {
        origin: ORIGIN,
      }),
    ).toThrow(/four tags/i);
  });

  it("strips tag punctuation dev.to will not accept", () => {
    const payload = devToArticle(post({ tags: ["three.js", "web-xr"] }), {
      origin: ORIGIN,
    });

    expect(payload.article.tags).toEqual(["threejs", "webxr"]);
  });

  it("refuses two tags that normalise to the same token", () => {
    // Why this test matters: normalisation is lossy, so "three.js" and
    // "threejs" both become "threejs" and Forem rejects the article for a
    // duplicate tag. Before this guard the payload was built happily and the
    // rejection only showed up as an API error on a real publish — the failure
    // mode this module's header explicitly argues against.
    expect(() =>
      devToArticle(post({ tags: ["three.js", "threejs"] }), {
        origin: ORIGIN,
      }),
    ).toThrow(/both normalise/i);
  });

  it("refuses a post with no slug rather than producing a bare-origin canonical", () => {
    expect(() => devToArticle(post({ slug: "" }), { origin: ORIGIN })).toThrow(
      /slug/i,
    );
  });
});

describe("xComposerUrl", () => {
  it("prefills text and link into the composer", () => {
    const url = new URL(
      xComposerUrl({ text: "A post about drift", url: `${ORIGIN}/blog/x/` }),
    );

    expect(url.origin + url.pathname).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe("A post about drift");
    expect(url.searchParams.get("url")).toBe(`${ORIGIN}/blog/x/`);
  });

  it("refuses text that would exceed the limit once the link is counted", () => {
    // A link costs a fixed allowance regardless of its real length, and a
    // composer that opens pre-truncated wastes the human's click.
    expect(() =>
      xComposerUrl({ text: "x".repeat(280), url: `${ORIGIN}/blog/x/` }),
    ).toThrow(/too long/i);
  });
});

describe("blueskyRecord", () => {
  it("builds a post record with the link as a facet", () => {
    const record = blueskyRecord({
      text: "Read this: https://gps.csutil.com/blog/x/",
      url: `${ORIGIN}/blog/x/`,
      createdAt: CREATED_AT,
    });

    expect(record.$type).toBe("app.bsky.feed.post");
    expect(record.text).toContain("https://gps.csutil.com/blog/x/");
    // Without a facet the URL renders as plain text and is not clickable.
    const [facet] = record.facets;
    expect(facet.features[0].uri).toBe(`${ORIGIN}/blog/x/`);
    expect(facet.index.byteEnd).toBeGreaterThan(facet.index.byteStart);
  });

  it("stamps the createdAt the lexicon requires", () => {
    // Why this test matters: app.bsky.feed.post REQUIRES createdAt, and
    // com.atproto.repo.createRecord rejects a record without it. It used to be
    // absent from the returned record and optional in the annotation, so
    // drip.mjs handed the operator a pack labelled "Post this record:" that
    // could not be posted.
    const record = blueskyRecord({
      text: "Read this",
      url: `${ORIGIN}/blog/x/`,
      createdAt: CREATED_AT,
    });

    expect(record.createdAt).toBe(CREATED_AT);
  });

  it("refuses to guess a createdAt, because it has no clock", () => {
    // The module is deliberately clock-free (its output has to be reproducible
    // in tests). Defaulting to Date.now() here would make that quietly untrue,
    // so the omission has to fail loudly at the seam instead.
    expect(() =>
      // @ts-expect-error deliberately omitting the required field
      blueskyRecord({ text: "Read this", url: `${ORIGIN}/blog/x/` }),
    ).toThrow(/createdAt/i);
  });

  it("measures the limit in BYTES, not characters", () => {
    // Bluesky's cap is on UTF-8 bytes; an emoji-heavy post that looks short
    // can exceed it, and that is exactly the post nobody tests.
    const emoji = "🛰️".repeat(120);
    expect(() =>
      blueskyRecord({
        text: emoji,
        url: `${ORIGIN}/blog/x/`,
        createdAt: CREATED_AT,
      }),
    ).toThrow(/too long/i);
  });

  it("accepts a post that is long in characters but small in bytes", () => {
    const record = blueskyRecord({
      text: "a".repeat(280),
      url: `${ORIGIN}/blog/x/`,
      createdAt: CREATED_AT,
    });

    expect(record.text).toHaveLength(280);
  });
});

describe("mastodonStatus", () => {
  it("builds a status with the link appended once", () => {
    const status = mastodonStatus({
      text: "A post about drift",
      url: `${ORIGIN}/blog/x/`,
    });

    expect(status.status).toBe(`A post about drift\n\n${ORIGIN}/blog/x/`);
  });

  it("does not append a link the text already contains", () => {
    const status = mastodonStatus({
      text: `Read ${ORIGIN}/blog/x/ today`,
      url: `${ORIGIN}/blog/x/`,
    });

    expect(status.status.match(/blog\/x\//g)).toHaveLength(1);
  });
});

describe("mediumImportSteps", () => {
  it("produces manual steps, because Medium closed its API to new integrations", () => {
    const steps = mediumImportSteps(post(), { origin: ORIGIN });

    expect(steps.canonicalUrl).toBe(`${ORIGIN}/blog/why-outdoor-webxr-drifts/`);
    expect(steps.steps.join(" ")).toMatch(/import/i);
    // The import tool sets the canonical link itself — that is the whole
    // reason this route is acceptable rather than merely tolerable.
    expect(steps.steps.join(" ")).toMatch(/canonical/i);
  });
});
