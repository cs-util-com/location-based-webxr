import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  STARTER_LABELS,
  visitorLaunchHref,
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
  const dom: WizardDom = {
    steps: {
      host: { open: false },
      print: { open: false },
      hang: { open: false },
      finish: { open: false },
      replace: { open: false },
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
  return { dom, click };
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

describe("visitorLaunchHref", () => {
  it("round-trips any URL through the qr parameter (property)", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const href = visitorLaunchHref(url);
        expect(new URLSearchParams(href).get("qr")).toBe(url);
      }),
    );
  });
});
