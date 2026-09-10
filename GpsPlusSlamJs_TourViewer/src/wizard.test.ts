import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  launchHrefFromPrintedUrl,
  parseWizardStep,
  remapLegacyStep,
  STARTER_LABELS,
  visitorLaunchHref,
  wizardStepKey,
  WIZARD_STEPS,
  stepStoreOrUndefined,
  wireWizard,
  type WizardDom,
  type WizardStep,
} from "./wizard";

/** The default hand-off for tests that are not about it: the save route,
 *  file delivered. Named rather than inlined so the shape lives in ONE
 *  place - it grew a route field when the finish gained a share sheet. */
const savedDownload = () =>
  Promise.resolve({ route: "download" as const, delivered: true });

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
      measure: step("measure"),
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
      download: savedDownload,
    });
    expect(creator.dom.steps.host?.open).toBe(true);
    expect(creator.dom.visitorLink.hidden).toBe(true);

    const visitor = fakeDom();
    wireWizard({
      mode: "visitor",
      dom: visitor.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
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
            download: savedDownload,
          });
          for (const step of sequence) wizard.openStep(step);
          const last = sequence.at(-1);
          const openNames = Object.entries(dom.steps)
            .filter(([, node]) => node.open)
            .map(([name]) => name);
          expect(openNames).toEqual([last]);
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
      download: savedDownload,
    });
    wizard.presentTour("https://example.com/t.zip?x=1");
    expect(dom.steps.print?.open).toBe(true);
    expect(dom.steps.host?.open).toBe(false);
    expect(dom.visitorLink.hidden).toBe(false);
    expect(dom.visitorLink.href).toBe(
      visitorLaunchHref("https://example.com/t.zip?x=1"),
    );
    click("hang");
    expect(dom.steps.measure?.open).toBe(true);
    expect(dom.steps.hang?.open).toBe(false);
  });

  it("scrolls the AR section into view when step 4 opens, and a step opened BY HAND closes the others", () => {
    // Why this matters (M2 review #12): opening step 4 from the bottom of
    // step 3 would otherwise leave the creator looking at a summary row;
    // and a second summary tap used to leave two steps open, against the
    // one-open rule.
    const { dom, click, scrolls } = fakeDom();
    wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
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
      download: savedDownload,
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
      download: () => Promise<{
        route: "share" | "download";
        delivered: boolean;
      }>,
      canShare = false,
    ) => {
      const { dom, click } = fakeDom();
      wireWizard({
        mode: "creator",
        dom,
        packStarter,
        download,
        canShare: () => canShare,
        setTimeout: (fn) => timers.push(fn),
      });
      const idle = canShare ? STARTER_LABELS.idleShare : STARTER_LABELS.idle;
      expect(dom.starterButton.textContent).toBe(idle);
      click("starter");
      expect(dom.starterButton.disabled).toBe(true);
      // One busy word on both routes: the button is packing the zip here.
      expect(dom.starterButton.textContent).toBe(STARTER_LABELS.busy);
      await vi.waitFor(() => expect(dom.starterButton.disabled).toBe(false));
      const settled = dom.starterButton.textContent;
      for (const t of timers.splice(0)) t();
      expect(dom.starterButton.textContent).toBe(idle);
      return settled;
    };
    const blob = () => Promise.resolve(new Blob(["z"]));
    const saved = { route: "download" as const, delivered: true };
    const dismissed = { route: "download" as const, delivered: false };
    await expect(run(blob, () => Promise.resolve(saved))).resolves.toBe(
      STARTER_LABELS.done,
    );
    await expect(run(blob, () => Promise.resolve(dismissed))).resolves.toBe(
      STARTER_LABELS.cancelled,
    );
    await expect(
      run(
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve(saved),
      ),
    ).resolves.toBe(STARTER_LABELS.failed);
  });

  it("labels and reports the SHARE route with words that are true of it", async () => {
    // Why this test matters: the starter zip is the file a creator has to
    // get INTO their cloud folder to finish step 1, so on a phone the
    // button hands it straight to that app. "Downloaded" would then be
    // simply false - nothing went to Downloads - and a button reading
    // "download" would describe the wrong action before it is even
    // pressed. Both halves are asserted, because the label is decided at
    // WIRE time from the capability and the copy at settle time from the
    // route actually taken.
    const timers: (() => void)[] = [];
    const run = async (delivered: boolean) => {
      const { dom, click } = fakeDom();
      wireWizard({
        mode: "creator",
        dom,
        packStarter: () => Promise.resolve(new Blob(["z"])),
        download: () => Promise.resolve({ route: "share" as const, delivered }),
        canShare: () => true,
        setTimeout: (fn) => timers.push(fn),
      });
      expect(dom.starterButton.textContent).toBe(STARTER_LABELS.idleShare);
      click("starter");
      await vi.waitFor(() => expect(dom.starterButton.disabled).toBe(false));
      const settled = dom.starterButton.textContent;
      for (const t of timers.splice(0)) t();
      // The REVERT, which is where this went wrong: it re-labelled the
      // button with the download wording three seconds after a successful
      // share, under a button that opens a share sheet. The settle text was
      // asserted and the revert was not, so the one line that was wrong ran
      // in every test and was checked by none (M2 review #2).
      expect(dom.starterButton.textContent).toBe(STARTER_LABELS.idleShare);
      return settled;
    };
    expect(await run(true)).toBe(STARTER_LABELS.doneShare);
    // Not "cancelled": a dismissed share sheet and a failed share are the
    // same error in the Web Share API, so the copy must not say which.
    expect(await run(false)).toBe(STARTER_LABELS.notShared);
    expect(STARTER_LABELS.notShared).not.toContain("cancel");
  });
});

describe("step 4 during an AR session (M3 review #2)", () => {
  it("stays open whatever anyone asks for, because it holds the overlay root (property)", () => {
    // Why this matters, and why it is a property rather than one case:
    // step 4's body contains `#ar-root`, the element WebXR composites over
    // the camera. A collapsed <details> renders nothing, so closing step 4
    // mid-session blanks the overlay - the creator is left looking at a
    // camera feed with no controls, and nothing in CI can see it.
    //
    // Hiding the summary stops a tap and the keyboard. It does NOT stop
    // the several places that assign `open` directly: the print panel does
    // it on `beforeprint`, so pressing Ctrl+P was enough to reach
    // `openStep("print")` through the wizard's own toggle listener. The
    // rule therefore lives here, and the property is "no sequence of
    // openStep calls can close it".
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<WizardStep>(...WIZARD_STEPS), {
          minLength: 1,
          maxLength: 10,
        }),
        (sequence) => {
          const { dom } = fakeDom();
          let sessionActive = false;
          const wizard = wireWizard({
            mode: "creator",
            dom,
            packStarter: () => Promise.resolve(new Blob()),
            download: savedDownload,
            arSessionActive: () => sessionActive,
          });
          wizard.openStep("measure");
          sessionActive = true;
          for (const step of sequence) wizard.openStep(step);
          expect(dom.steps.measure?.open).toBe(true);
        },
      ),
    );
  });

  it("is forced open even if another step is open when the session starts", () => {
    // The rule has to hold whatever the page looked like a moment earlier,
    // because `open` is assigned from several places that know nothing
    // about sessions (the print panel's `beforeprint`, its print button,
    // its presentTour). This pins the recovery rather than trusting that
    // step 4 always happens to be open already.
    const { dom } = fakeDom();
    let sessionActive = false;
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      arSessionActive: () => sessionActive,
    });
    wizard.openStep("print");
    sessionActive = true;
    wizard.openStep("print");
    expect(dom.steps.measure?.open).toBe(true);
    // Nothing else was disturbed: the page under the overlay is not the
    // creator's concern while a session runs.
    expect(dom.steps.print?.open).toBe(true);
  });
});

describe("opening a tour from step 4 (M3 review #1)", () => {
  it("stays on step 4 instead of jumping the creator back to step 2", () => {
    // Why this matters: step 4 asks for the tour link when the device does
    // not have one (a creator who walked to the poster with their phone).
    // The open runs the same path as step 1's, which ends in presentTour -
    // and presentTour's default is "a tour just opened, go to step 2".
    // Without the preference the form would answer the creator by
    // collapsing the very step they are standing in.
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
    });
    wizard.presentTour("https://h/t.zip", { prefer: "measure" });
    expect(dom.steps.measure?.open).toBe(true);
    expect(dom.steps.print?.open).toBe(false);
  });

  it("still yields to a step this creator actually reached with this tour", () => {
    // The preference says where the creator is standing; a remembered step
    // says where they got to. The second is the stronger evidence.
    const store = new Map<string, string>([
      [wizardStepKey("https://h/t.zip"), "hang"],
    ]);
    const { dom } = fakeDom();
    wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      stepStore: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    }).presentTour("https://h/t.zip", { prefer: "measure" });
    expect(dom.steps.hang?.open).toBe(true);
    expect(dom.steps.measure?.open).toBe(false);
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
      download: savedDownload,
      stepStore,
    });
    wizard.presentTour("https://h/t.zip");
    expect(first.dom.steps.print?.open).toBe(true);
    wizard.openStep("hang");
    expect(store.get(wizardStepKey("https://h/t.zip"))).toBe("hang");

    // A reload: the same tour opens at the remembered step.
    const second = fakeDom();
    wireWizard({
      mode: "creator",
      dom: second.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      stepStore,
    }).presentTour("https://h/t.zip");
    expect(second.dom.steps.hang?.open).toBe(true);

    // A throwing store (blocked site data) leaves the flow intact.
    const third = fakeDom();
    wireWizard({
      mode: "creator",
      dom: third.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
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
      download: savedDownload,
      stepStore,
    });
    wizardA.presentTour("https://h/a.zip");
    wizardA.openStep("hang");
    const b = fakeDom();
    const wizardB = wireWizard({
      mode: "creator",
      dom: b.dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      stepStore,
    });
    wizardB.presentTour("https://h/b.zip");
    expect(b.dom.steps.print?.open).toBe(true);
    expect(b.dom.steps.hang?.open).toBe(false);
    // The last opened url is what the link input is prefilled with.
    expect(wizardB.rememberedTourUrl()).toBe("https://h/b.zip");
  });

  it("a step 5 or 6 stored by an older version resumes at step 4, not at step 2 (M3 review #3)", () => {
    // Why this matters twice over. The rebuilt zip lives only in the page
    // that made it, so after a reload there is nothing to download and
    // measuring again is the honest place to resume (M6 review #3). And
    // since the flow rework those two steps no longer EXIST, so a creator
    // who had reached them carries a name this version cannot parse - the
    // remap has to run before the parse, or they silently restart at
    // step 2 with the setup apparently undone.
    for (const stored of ["finish", "replace"]) {
      const store = new Map<string, string>([
        [wizardStepKey("https://h/t.zip"), stored],
      ]);
      const { dom } = fakeDom();
      wireWizard({
        mode: "creator",
        dom,
        packStarter: () => Promise.resolve(new Blob()),
        download: savedDownload,
        stepStore: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          },
        },
      }).presentTour("https://h/t.zip");
      expect(dom.steps.measure?.open, stored).toBe(true);
      expect(dom.steps.print?.open, stored).toBe(false);
      expect(dom.steps.host?.open, stored).toBe(false);
    }
  });

  it("remapLegacyStep leaves every live step alone and moves only the retired two (property)", () => {
    // The remap must be a no-op on anything the parser would accept, or a
    // future step name could be silently rewritten to `measure`.
    fc.assert(
      fc.property(fc.constantFrom<WizardStep>(...WIZARD_STEPS), (step) => {
        expect(remapLegacyStep(step)).toBe(step);
      }),
    );
    expect(remapLegacyStep("finish")).toBe("measure");
    expect(remapLegacyStep("replace")).toBe("measure");
    expect(remapLegacyStep(null)).toBeNull();
    // A name nobody ever stored passes through and is rejected by the
    // parser, which is where unknown values belong.
    expect(parseWizardStep(remapLegacyStep("nonsense"))).toBeNull();
  });

  it("a visitor page never writes a creator's key, and never reads one (M6 review #11)", () => {
    const writes: string[] = [];
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "visitor",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      stepStore: {
        getItem: () => "hang",
        setItem: (k: string) => {
          writes.push(k);
        },
      },
    });
    // The store would hand back "hang" for any key. A visitor's
    // presentTour must ignore it: the setup steps are not their page.
    wizard.presentTour("https://h/t.zip");
    expect(dom.steps.hang?.open).toBe(false);
    // And nothing a visitor does writes a creator's key.
    wizard.openStep("print");
    expect(writes).toEqual([]);
  });

  it("a visitor page registers no toggle listeners, so opening step 4 does not scroll the consent copy away (M3 review #10)", () => {
    // Why this matters: `visitor-screen.ts` opens step 4 to make the AR
    // section the screen. With a listener attached that toggle becomes
    // `openStep("measure")`, whose scroll pulls #step-measure to the top -
    // taking the "it needs the camera, and your location, nothing is
    // uploaded" screen, the one thing a visitor must read, off the page
    // before they have seen it.
    const { dom, click, scrolls } = fakeDom();
    wireWizard({
      mode: "visitor",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
    });
    dom.steps.measure!.open = true;
    click("toggle:measure");
    expect(scrolls).toEqual([]);
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
      download: savedDownload,
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

describe("revealStep (M3 milestone review #2)", () => {
  it("opens a step without closing the one the creator is reading", () => {
    // Why this exists at all: AR refuses to start when the printed size is
    // empty. The reason appears in step 4's status line, and the field that
    // fixes it is in step 2 - so step 2 has to open WITHOUT step 4 closing,
    // or the explanation disappears at the moment it is needed and the
    // creator is left with a Start button that does nothing.
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
    });
    wizard.openStep("measure");
    wizard.revealStep("print");
    expect(dom.steps.measure?.open).toBe(true);
    expect(dom.steps.print?.open).toBe(true);
  });

  it("does not remember the step it revealed", () => {
    // The creator did not go there, they were sent. Remembering it would
    // land the next reload on step 2 with the setup apparently undone.
    const store = new Map<string, string>();
    const { dom } = fakeDom();
    const wizard = wireWizard({
      mode: "creator",
      dom,
      packStarter: () => Promise.resolve(new Blob()),
      download: savedDownload,
      stepStore: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
    wizard.presentTour("https://h/t.zip", { prefer: "measure" });
    store.clear();
    wizard.revealStep("print");
    expect([...store.keys()]).toEqual([]);
  });
});
