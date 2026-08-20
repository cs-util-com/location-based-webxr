import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildBlog } from "./build-blog.mjs";

// Why this test matters: this is the step between "the owner flipped a wiki
// page to published" and "it is on gps.csutil.com". Its failure modes are the
// quiet ones — an empty /blog/ deployed over a working one, a draft leaking
// into the output — so each is asserted here rather than trusted.

/** @returns {{ wikiDir: string, outDir: string }} */
function tempDirs() {
  const root = mkdtempSync(join(tmpdir(), "blog-build-"));
  const wikiDir = join(root, "wiki");
  const outDir = join(root, "out");
  mkdirSync(wikiDir);
  mkdirSync(outDir);
  return { wikiDir, outDir };
}

const published = (title) =>
  `<!--\nblog-meta\nstatus: published\ndate: 2026-08-20\ndescription: A description.\n-->\n# ${title}\n\nBody text.\n`;

describe("buildBlog", () => {
  it("emits an index, a page per published post, and a sitemap", () => {
    const { wikiDir, outDir } = tempDirs();
    writeFileSync(join(wikiDir, "First-post.md"), published("First post"));
    writeFileSync(join(wikiDir, "Second-post.md"), published("Second post"));
    writeFileSync(join(wikiDir, "Home.md"), "# Home\n\nWelcome.\n");

    const result = buildBlog({
      wikiDir,
      outDir,
      origin: "https://gps.csutil.com",
    });

    expect(result.published).toBe(2);
    expect(result.drafts).toBe(1);
    expect(readFileSync(join(outDir, "blog", "index.html"), "utf8")).toContain(
      "First post",
    );
    expect(
      readFileSync(join(outDir, "blog", "first-post", "index.html"), "utf8"),
    ).toContain('<link rel="canonical"');
    expect(readFileSync(join(outDir, "blog", "sitemap.xml"), "utf8")).toContain(
      "/blog/second-post/",
    );
  });

  it("never writes a page for a draft", () => {
    const { wikiDir, outDir } = tempDirs();
    writeFileSync(join(wikiDir, "Ready.md"), published("Ready"));
    writeFileSync(
      join(wikiDir, "Not-ready.md"),
      "<!--\nblog-meta\nstatus: draft\ndate: 2026-08-20\n-->\n# Not ready\n\nWIP.\n",
    );

    buildBlog({ wikiDir, outDir, origin: "https://gps.csutil.com" });

    expect(() =>
      readFileSync(join(outDir, "blog", "not-ready", "index.html"), "utf8"),
    ).toThrow();
    expect(
      readFileSync(join(outDir, "blog", "sitemap.xml"), "utf8"),
    ).not.toContain("not-ready");
  });

  it("fails loudly when the wiki directory is missing", () => {
    const { outDir } = tempDirs();

    // The D19 corollary: a failed wiki clone must stop the build, never
    // deploy a site whose /blog/ is empty over one that had posts.
    expect(() =>
      buildBlog({
        wikiDir: join(outDir, "does-not-exist"),
        outDir,
        origin: "https://gps.csutil.com",
      }),
    ).toThrow(/wiki/i);
  });

  it("fails loudly when the wiki contains no markdown at all", () => {
    const { wikiDir, outDir } = tempDirs();
    writeFileSync(join(wikiDir, "README.txt"), "not markdown");

    expect(() =>
      buildBlog({ wikiDir, outDir, origin: "https://gps.csutil.com" }),
    ).toThrow(/no markdown/i);
  });

  it("reports draft reasons so the owner can see why a page stayed hidden", () => {
    const { wikiDir, outDir } = tempDirs();
    writeFileSync(join(wikiDir, "Ready.md"), published("Ready"));
    writeFileSync(join(wikiDir, "Home.md"), "# Home\n");

    const lines = [];
    buildBlog({
      wikiDir,
      outDir,
      origin: "https://gps.csutil.com",
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toMatch(/home.*no blog-meta block/i);
  });
});
