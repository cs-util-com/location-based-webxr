// @vitest-environment jsdom
/**
 * Why these tests matter: a long text's body is written by whoever made
 * the tour, so the sheet that shows it is the one place a tour file puts
 * its own structure into the page. The renderer builds that structure
 * from a fixed list of elements and attributes and never from an HTML
 * string; these pin the list, the link element a visitor can trust (the
 * host shown beside the text, no referrer, a new tab), the question asked
 * before a link leaves an AR session, and where the pictures wait for
 * their decode.
 */
import { describe, expect, it, vi } from "vitest";

import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import {
  LONG_TEXT_ALLOWED,
  createLinkGuard,
  leaveArQuestion,
  renderLongText,
} from "./long-text-render.js";

function render(body: string, onLinkTap = vi.fn()) {
  return renderLongText(parseTourMarkdown(body), { document, onLinkTap });
}

function html(body: string): string {
  const host = document.createElement("div");
  host.append(render(body).fragment);
  return host.innerHTML;
}

describe("renderLongText", () => {
  it("renders headings one step below the sheet's title", () => {
    expect(html("# Mill\n\n## Wheel\n\n### Stone")).toBe(
      "<h3>Mill</h3><h4>Wheel</h4><h5>Stone</h5>",
    );
  });

  it("renders paragraphs, emphasis, strong and both breaks", () => {
    expect(html("A *small* and **big**\nline  \nend")).toBe(
      "<p>A <em>small</em> and <strong>big</strong> line<br>end</p>",
    );
  });

  it("renders nested lists, an ordered list's start and a quote", () => {
    expect(html("3. one\n4. two\n   - leaf\n\n> said")).toBe(
      '<ol start="3"><li><p>one</p></li><li><p>two</p><ul><li><p>leaf</p></li></ul></li></ol>' +
        "<blockquote><p>said</p></blockquote>",
    );
  });

  it("keeps markup characters as text, never as markup", () => {
    const out = html('<img src=x onerror="alert(1)"> &amp; `code`');
    expect(out).toBe(
      '<p>&lt;img src=x onerror="alert(1)"&gt; &amp;amp; `code`</p>',
    );
  });

  it("gives a link the safe attributes and shows its host beside its text", () => {
    const host = document.createElement("div");
    host.append(
      render("See [Town archive](https://archive.example/a?b=1).").fragment,
    );
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://archive.example/a?b=1");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(a?.textContent).toBe("Town archive (archive.example)");
    expect(a?.getAttributeNames().sort()).toEqual([
      "href",
      "referrerpolicy",
      "rel",
      "target",
    ]);
  });

  it("shows a look-alike host in its ASCII form", () => {
    const host = document.createElement("div");
    host.append(render("[Bank](https://bänk.example/)").fragment);
    expect(host.querySelector("a")?.textContent).toMatch(
      /^Bank \(xn--[a-z0-9-]+\.example\)$/,
    );
  });

  it("hands every link tap to the caller with its href and host", () => {
    const onLinkTap = vi.fn();
    const host = document.createElement("div");
    host.append(render("[Map](https://maps.example/x)", onLinkTap).fragment);
    const a = host.querySelector("a");
    a?.addEventListener("click", (e) => {
      e.preventDefault(); // jsdom would try to navigate
    });
    a?.click();
    expect(onLinkTap).toHaveBeenCalledTimes(1);
    expect(onLinkTap.mock.calls[0]?.[1]).toEqual({
      href: "https://maps.example/x",
      host: "maps.example",
    });
  });

  it("puts each picture in a holder showing its alt text until it is decoded", () => {
    const out = render("Before\n\n![The old mill](asset:mill)\n\nAfter");
    const host = document.createElement("div");
    host.append(out.fragment);
    expect(host.innerHTML).toBe(
      "<p>Before</p><p><span>The old mill</span></p><p>After</p>",
    );
    expect(out.pictures).toHaveLength(1);
    expect(out.pictures[0]?.asset).toBe("mill");
    expect(out.pictures[0]?.alt).toBe("The old mill");
    expect(out.pictures[0]?.holder).toBe(host.children[1]);
  });

  it("shows a picture that cannot stand where it is as its alt text in a box", () => {
    expect(html("Look ![a cat](https://x.example/c.png) here")).toBe(
      "<p>Look <span>a cat</span> here</p>",
    );
    expect(html("Look ![](asset:x) here")).toBe(
      "<p>Look <span>picture</span> here</p>",
    );
  });

  it("emits only the allowlisted elements and attributes for a mixed body", () => {
    const host = document.createElement("div");
    host.append(
      render(
        "# A\n\n- *b* [c](https://c.example)\n  - d\n\n![e](asset:e)\n\n> f\\\ng",
      ).fragment,
    );
    for (const el of host.querySelectorAll("*")) {
      const name = el.localName;
      expect(Object.keys(LONG_TEXT_ALLOWED)).toContain(name);
      for (const attr of el.getAttributeNames()) {
        expect(LONG_TEXT_ALLOWED[name]).toContain(attr);
      }
    }
  });

  it("reads a value that is not a tree as an empty body", () => {
    const out = renderLongText(null as never, { document, onLinkTap: vi.fn() });
    expect(out.fragment.childNodes).toHaveLength(0);
    expect(out.pictures).toEqual([]);
  });
});

describe("createLinkGuard", () => {
  function tap() {
    const event = new MouseEvent("click", { cancelable: true });
    return event;
  }

  it("lets a link open by itself outside AR", () => {
    const ask = vi.fn();
    const open = vi.fn();
    const guard = createLinkGuard({ arActive: () => false, ask, open });
    const event = tap();
    guard(event, { href: "https://a.example/", host: "a.example" });
    expect(event.defaultPrevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("asks first during an AR session and opens only on yes", async () => {
    const open = vi.fn();
    const guard = createLinkGuard({
      arActive: () => true,
      ask: () => Promise.resolve(true),
      open,
    });
    const event = tap();
    guard(event, { href: "https://a.example/", host: "a.example" });
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith("https://a.example/");
  });

  it("opens nothing on no, nor when the question fails", async () => {
    const open = vi.fn();
    for (const answer of [
      Promise.resolve(false),
      Promise.reject(new Error("closed")),
    ]) {
      const guard = createLinkGuard({
        arActive: () => true,
        ask: () => answer,
        open,
      });
      guard(tap(), { href: "https://a.example/", host: "a.example" });
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("asks in the design's words, naming the host", () => {
    expect(leaveArQuestion("archive.example")).toBe(
      "Open archive.example? You may lose your place in the AR view.",
    );
  });
});
