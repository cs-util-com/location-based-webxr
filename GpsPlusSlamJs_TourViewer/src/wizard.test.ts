import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  launchHrefFromPrintedUrl,
  parseWizardStep,
  STARTER_LABELS,
  visitorLaunchHref,
  wizardStepKey,
  WIZARD_STEPS,
  wireWizard,
  type WizardDom,
  type WizardStep,
} from "./wizard";

/**
 * Why these tests matter: the setup is the creator's only guidance, and a
 * wizard that opens two steps at once or none reads as broken on a phone.
 * The one-open-step invariant is pinned as a property over every step; the
 * flow's advances (tour opened → print, code hung → measure) are pinned as
 * the events; the starter button's async cycle follows the async-UI rule
 * on both outcomes and the cancelled picker.
 */

function fakeDom() {
  const listeners: Record<string, (() => void)[]> = {};
  const clickable = (key: string) => ({
    addEventListener: (_type: "click", fn: () => void) => {
      (listeners[key] ??= []).push(fn);
    },
  });
  /** A step whose `toggle` the test can fire, as a real <details> would
   *  after a summary tap. */
  const step = (key: string) => ({
    open: false,
    addEventListener: (_type: "toggle", fn: () => void) => {
      (listeners[`toggle:${key}`] ??= []).push(fn);
    },
  });
  const scrolls: unknown[] = [];
  const dom: WizardDom = {
    steps: {
      host: step("host"),
      print: step("print"),
      hang: step("hang"),
      finish: step("finish"),
      replace: step("replace"),
    },
    measureSection: {
      scrollIntoView: (options) => {
        scrolls.push(options);
      },
    },
    hangDone: clickable("hang"),
    starterButton: {
      ...clickable("starter"),
      disabled: false,
      textContent: STARTER_LABELS.idle,
    },
    visitorLink: { href: "", hidden: false },
  };
  const click = (key: string) => {
    for (const fn of listeners[key] ?? []) fn();
  };
  return { dom, click, scrolls };
}

describe("wireWizard", () => {
  it("opens the host step for a creator, nothing for a visitor, and hides the launch link until a tour opens", () => {
    const creator = fakeDom();
    wireWizard({
      mode: "creator",
      dom: creator.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
    });
    expect(creator.dom.steps.host?.open).toBe(true);
    expect(creator.dom.visitorLink.hidden).toBe(true);

    const visitor = fakeDom();
    wireWizard({
      mode: "visitor",
      dom: visitor.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
    });
    expect(Object.values(visitor.dom.steps).some((s) => s.open)).toBe(false);
  });

  it("keeps exactly one collapsible step open, whichever is opened (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<WizardStep>(...WIZARD_STEPS), {
          minLength: 1,
          maxLength: 10,
        }),
        (sequence) => {
          const { dom } = fakeDom();
          const wizard = wireWizard({
            mode: "creator",
            dom,
            packStarter: () => Promise.resolve(new Blob()),
            download: () => Promise.resolve(true),
          });
          for (const step of sequence) wizard.openStep(step);
          const last = sequence.at(-1);
          const openNames = Object.entries(dom.steps)
            .filter(([, node]) => node.open)
            .map(([name]) => name);
          // `measure` has no collapsible node: opening it collapses all.
          expect(openNames).toEqual(last === "measure" ? [] : [last]);
        },
      ),
    );
  });

  it("advances to print when a tour opens (with the launch link) and to measure when the code is hung", () => {
    const { dom, click } = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
    });
    wizard.presentTour("https://example.com/t.zip?x=1");
    expect(dom.steps.print?.open).toBe(true);
    expect(dom.steps.host?.open).toBe(false);
    expect(dom.visitorLink.hidden).toBe(false);
    expect(dom.visitorLink.href).toBe(
      visitorLaunchHref("https://example.com/t.zip?x=1"),
    );
    click("hang");
    expect(Object.values(dom.steps).some((s) => s.open)).toBe(false);
  });

  it("scrolls the AR section into view when step 4 opens, and a step opened BY HAND closes the others", () => {
    // Why this matters (M2 review #12): step 4 has nothing to open, so the
    // page only got shorter after "It hangs - continue"; and a second
    // summary tap used to leave two steps open, against the one-open rule.
    const { dom, click, scrolls } = fakeDom();
    wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
    });
    click("hang");
    expect(scrolls).toEqual([{ block: "start" }]);
    // The creator taps step 3's summary: the element opens itself, then
    // fires toggle - the wizard closes the rest.
    dom.steps.host!.open = true;
    dom.steps.hang!.open = true;
    click("toggle:hang");
    expect(dom.steps.host?.open).toBe(false);
    expect(dom.steps.hang?.open).toBe(true);
  });

  it("re-points the launch link at the PRINTED payload once a code is generated", () => {
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
    });
    wizard.presentTour("https://example.com/t.zip");
    wizard.presentLaunchUrl("https://gps.csutil.com/?qr=~ABC&n=2");
    expect(dom.visitorLink.href).toBe("?qr=~ABC&n=2");
    // Not a launch link: ignored, the previous href stands.
    wizard.presentLaunchUrl("https://gps.csutil.com/");
    expect(dom.visitorLink.href).toBe("?qr=~ABC&n=2");
  });

  it("the starter button: busy while packing, then downloaded / not saved / failed, then idle again", async () => {
    const timers: (() => void)[] = [];
    const run = async (
      packStarter: () => Promise<Blob>,
      download: () => Promise<boolean>,
    ) => {
      const { dom, click } = fakeDom();
      wireWizard({
        mode: "creator",
        dom,
        packStarter,
        download,
        setTimeout: (fn) => timers.push(fn),
      });
      click("starter");
      expect(dom.starterButton.disabled).toBe(true);
      expect(dom.starterButton.textContent).toBe(STARTER_LABELS.busy);
      await vi.waitFor(() => expect(dom.starterButton.disabled).toBe(false));
      const settled = dom.starterButton.textContent;
      for (const t of timers.splice(0)) t();
      expect(dom.starterButton.textContent).toBe(STARTER_LABELS.idle);
      return settled;
    };
    const blob = () => Promise.resolve(new Blob(["z"]));
    await expect(run(blob, () => Promise.resolve(true))).resolves.toBe(
      STARTER_LABELS.done,
    );
    await expect(run(blob, () => Promise.resolve(false))).resolves.toBe(
      STARTER_LABELS.cancelled,
    );
    await expect(
      run(
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve(true),
      ),
    ).resolves.toBe(STARTER_LABELS.failed);
  });
});

describe("the remembered step (M6)", () => {
  it("lands on the step the creator reached with this tour, and step 2 for a new one; a broken store is harmless", () => {
    // Why this matters (plan §2.7): the AR session and the print dialog
    // both leave the page; a creator coming back to step 1 every time
    // would redo the setup from the top.
    const store = new Map<string, string>();
    const stepStore = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    const first = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom: first.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore,
    });
    wizard.presentTour("https://h/t.zip");
    expect(first.dom.steps.print?.open).toBe(true);
    wizard.openStep("replace");
    expect(store.get(wizardStepKey("https://h/t.zip"))).toBe("replace");

    // A reload: the same tour opens at the remembered step.
    const second = fakeDom();
    wireWizard({
      mode: "creator",
      dom: second.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore,
    }).presentTour("https://h/t.zip");
    expect(second.dom.steps.replace?.open).toBe(true);

    // A throwing store (private window) leaves the flow intact.
    const third = fakeDom();
    wireWizard({
      mode: "creator",
      dom: third.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    }).presentTour("https://h/t.zip");
    expect(third.dom.steps.print?.open).toBe(true);
  });

  it("parses only known steps (property)", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...WIZARD_STEPS)),
        (v) => {
          const parsed = parseWizardStep(v);
          expect(parsed === null || WIZARD_STEPS.includes(parsed)).toBe(true);
          expect(parsed).toBe(
            WIZARD_STEPS.includes(v as WizardStep) ? v : null,
          );
        },
      ),
    );
  });
});

describe("the starter button's revert timer", () => {
  it("is cancelled by a re-click so the first run's revert cannot overwrite the second run's label (M2 review #13)", async () => {
    const timers: { fn: () => void; cleared: boolean }[] = [];
    const { dom, click } = fakeDom();
    const scheduled = (fn: () => void) => {
      const t = { fn, cleared: false };
      timers.push(t);
      return t;
    };
    wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob(["z"])),
      download: () => Promise.resolve(true),
      setTimeout: scheduled,
      clearTimeout: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    });
    click("starter");
    await vi.waitFor(() => expect(dom.starterButton.disabled).toBe(false));
    expect(timers).toHaveLength(1);
    click("starter"); // the revert of run 1 is still pending
    expect(timers[0]?.cleared).toBe(true);
    expect(dom.starterButton.textContent).toBe(STARTER_LABELS.busy);
    await vi.waitFor(() => expect(dom.starterButton.disabled).toBe(false));
    expect(timers).toHaveLength(2);
  });
});

describe("visitorLaunchHref / launchHrefFromPrintedUrl", () => {
  it("round-trips any URL through the qr parameter (property)", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const href = visitorLaunchHref(url);
        expect(new URLSearchParams(href).get("qr")).toBe(url);
      }),
    );
  });

  it("keeps the printed URL's whole query, and yields null without a qr parameter (property)", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string({ minLength: 1 }), (base, payload) => {
        const printed = new URL(base);
        printed.search = "";
        printed.searchParams.set("qr", payload);
        const href = launchHrefFromPrintedUrl(printed.toString());
        expect(href).not.toBeNull();
        expect(new URLSearchParams(href ?? "").get("qr")).toBe(payload);
        expect(launchHrefFromPrintedUrl(base.split("?")[0] ?? base)).toBeNull();
      }),
    );
  });
});
