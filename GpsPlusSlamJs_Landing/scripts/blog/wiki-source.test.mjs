import { describe, expect, it, vi } from "vitest";

import { WIKI_REPO_URL, resolveWikiDir } from "./wiki-source.mjs";

// Why this test matters: the site is built in two very different places — a
// developer machine that has the wiki checked out beside the repo, and a CDN
// build host that has never heard of it. Getting the precedence wrong means
// either the deploy silently uses a stale local copy, or a local build
// unexpectedly clones over the network. Both are confusing in a way that only
// shows up as "the blog is out of date".

const deps = ({ existing = [], clone = vi.fn() } = {}) => ({
  exists: (dir) => existing.includes(dir),
  clone,
});

describe("resolveWikiDir", () => {
  it("prefers an explicit BLOG_WIKI_DIR", () => {
    const clone = vi.fn();
    const dir = resolveWikiDir({
      envDir: "/explicit",
      siblingDir: "/sibling",
      cloneDir: "/tmp/clone",
      ...deps({ existing: ["/explicit", "/sibling"], clone }),
    });

    expect(dir).toBe("/explicit");
    expect(clone).not.toHaveBeenCalled();
  });

  it("uses the sibling checkout when no env var is set", () => {
    const clone = vi.fn();
    const dir = resolveWikiDir({
      envDir: undefined,
      siblingDir: "/sibling",
      cloneDir: "/tmp/clone",
      ...deps({ existing: ["/sibling"], clone }),
    });

    expect(dir).toBe("/sibling");
    expect(clone).not.toHaveBeenCalled();
  });

  it("clones the public wiki when nothing local exists", () => {
    const clone = vi.fn();
    const dir = resolveWikiDir({
      envDir: undefined,
      siblingDir: "/sibling",
      cloneDir: "/tmp/clone",
      ...deps({ existing: [], clone }),
    });

    expect(clone).toHaveBeenCalledWith(WIKI_REPO_URL, "/tmp/clone");
    expect(dir).toBe("/tmp/clone");
  });

  it("fails loudly when an explicitly configured directory does not exist", () => {
    // Silently falling through to a clone would hide a typo in the env var
    // and quietly publish from a different source than the operator intended.
    expect(() =>
      resolveWikiDir({
        envDir: "/typo",
        siblingDir: "/sibling",
        cloneDir: "/tmp/clone",
        ...deps({ existing: ["/sibling"] }),
      }),
    ).toThrow(/typo/);
  });

  it("surfaces a clone failure instead of continuing without content", () => {
    const clone = vi.fn(() => {
      throw new Error("fatal: could not read from remote repository");
    });

    expect(() =>
      resolveWikiDir({
        envDir: undefined,
        siblingDir: "/sibling",
        cloneDir: "/tmp/clone",
        ...deps({ existing: [], clone }),
      }),
    ).toThrow(/remote repository/);
  });

  it("points at the public wiki repo, which needs no credentials", () => {
    expect(WIKI_REPO_URL).toBe(
      "https://github.com/cs-util-com/location-based-webxr.wiki.git",
    );
  });
});
