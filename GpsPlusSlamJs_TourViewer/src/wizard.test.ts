import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  launchHrefFromPrintedUrl,
  parseWizardStep,
  STARTER_LABELS,
  visitorLaunchHref,
  wizardStepKey,
  WIZARD_STEPS,
  stepStoreOrUndefined,
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

    // A throwing store (blocked site data) leaves the flow intact.
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

  it("parses only known steps (property), and the real inputs: null, case, whitespace, a prototype name", () => {
    // Why this matters (M6 review #9): the store hands back null for an
    // unknown key and any string a device once wrote; the parser is the
    // only thing between that and `openStep`. The property pins "never an
    // unknown step"; the table pins the inputs a mirror of the
    // implementation would not.
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...WIZARD_STEPS)),
        (v) => {
          const parsed = parseWizardStep(v);
          expect(parsed === null || WIZARD_STEPS.includes(parsed)).toBe(true);
        },
      ),
    );
    expect(parseWizardStep(null)).toBeNull();
    for (const bad of ["Print", " print", "", "__proto__", "constructor"])
      expect(parseWizardStep(bad)).toBeNull();
    expect(parseWizardStep("hang")).toBe("hang");
  });

  it("keys the step by the hosted url: another tour starts at step 2 (M6 review #10)", () => {
    // Why this matters: one shared key would land tour B on tour A's step.
    const store = new Map<string, string>();
    const stepStore = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    const a = fakeDom();
    const wizardA = wireWizard({
      mode: "creator",
      dom: a.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore,
    });
    wizardA.presentTour("https://h/a.zip");
    wizardA.openStep("replace");
    const b = fakeDom();
    const wizardB = wireWizard({
      mode: "creator",
      dom: b.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore,
    });
    wizardB.presentTour("https://h/b.zip");
    expect(b.dom.steps.print?.open).toBe(true);
    expect(b.dom.steps.replace?.open).toBe(false);
    // The last opened url is what the link input is prefilled with.
    expect(wizardB.rememberedTourUrl()).toBe("https://h/b.zip");
  });

  it("a remembered step 5 resumes at step 4: the rebuilt zip did not survive the reload (M6 review #3)", () => {
    const store = new Map<string, string>([
      [wizardStepKey("https://h/t.zip"), "finish"],
    ]);
    const { dom } = fakeDom();
    wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    }).presentTour("https://h/t.zip");
    expect(dom.steps.finish?.open).toBe(false);
    expect(dom.steps.host?.open).toBe(false);
    expect(dom.steps.print?.open).toBe(false);
  });

  it("a visitor page never writes a creator's key, and never reads one (M6 review #11)", () => {
    const writes: string[] = [];
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "visitor",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: () => Promise.resolve(true),
      stepStore: {
        getItem: () => "replace",
        setItem: (k: string) => {
          writes.push(k);
        },
      },
    });
    wizard.presentTour("https://h/t.zip");
    wizard.openStep("hang");
    expect(writes).toEqual([]);
    expect(dom.steps.replace?.open).toBe(false);
  });

  it("stepStoreOrUndefined survives a throwing localStorage getter (M6 review #1)", () => {
    // Why this matters: `typeof localStorage` still runs the getter, and
    // with site data blocked the throw at module top level blanked the
    // page for a visitor who had just scanned a printed code.
    expect(
      stepStoreOrUndefined(() => {
        throw new Error("SecurityError: access denied");
      }),
    ).toBeUndefined();
    expect(stepStoreOrUndefined(() => undefined)).toBeUndefined();
    const store = { getItem: () => null, setItem: () => undefined };
    expect(stepStoreOrUndefined(() => store)).toBe(store);
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
