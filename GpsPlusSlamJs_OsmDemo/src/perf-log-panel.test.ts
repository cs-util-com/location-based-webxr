// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COPY_PERF_LOG_LABELS,
  mountPerfLogPanel,
  readPerfDevice,
  type PerfDeviceEnv,
} from "./perf-log-panel.js";

/**
 * The `?perf=1` "Copy perf log" button: a phone tester's only way to get
 * the log out, so both outcomes must say what happened (the async-UI rule),
 * and a clipboard the phone refuses must still leave the text reachable.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(write: ((text: string) => Promise<void>) | undefined) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const panel = mountPerfLogPanel(container, () => "THE REPORT", { write });
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="perf-log-copy"]',
  );
  if (button === null) throw new Error("no button");
  return { container, panel, button };
}

describe("mountPerfLogPanel", () => {
  it("copies the report, showing busy and then the confirmation", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const { button, container } = mount((text) => {
      written.push(text);
      return Promise.resolve();
    });
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.idle);
    button.click();
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.busy);
    expect(button.disabled).toBe(true);
    await flush();
    expect(written).toEqual(["THE REPORT"]);
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.done);
    expect(button.disabled).toBe(false);
    expect(
      container.querySelector('[data-testid="perf-log-fallback"]'),
    ).toBeNull();
    // The confirmation is brief: the idle label returns for the next copy.
    vi.advanceTimersByTime(3000);
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.idle);
  });

  // Some phones deny the clipboard: the text must still get out, selectable,
  // with a line saying why the copy failed.
  it("shows the report in a selectable box when the clipboard refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { button, container } = mount(() =>
      Promise.reject(new Error("denied")),
    );
    button.click();
    await flush();
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.failed);
    expect(button.disabled).toBe(false);
    const box = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="perf-log-fallback"]',
    );
    expect(box?.value).toBe("THE REPORT");
    expect(box?.readOnly).toBe(true);
    expect(
      container.querySelector('[data-testid="perf-log-error"]')?.textContent,
    ).toMatch(/clipboard/i);
    warn.mockRestore();
  });

  it("falls back the same way where there is no clipboard at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { button, container } = mount(undefined);
    button.click();
    await flush();
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.failed);
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '[data-testid="perf-log-fallback"]',
      )?.value,
    ).toBe("THE REPORT");
    warn.mockRestore();
  });

  it("clears an older fallback after a copy that worked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail = true;
    const { button, container } = mount(() =>
      fail ? Promise.reject(new Error("denied")) : Promise.resolve(),
    );
    button.click();
    await flush();
    fail = false;
    button.click();
    await flush();
    expect(
      container.querySelector('[data-testid="perf-log-fallback"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="perf-log-error"]'),
    ).toBeNull();
    warn.mockRestore();
  });

  // The 3D pane picks on pointer events; a tap on the button must not also
  // select a building under it.
  it("keeps its pointer events from the pane under it", () => {
    const { container, button } = mount(() => Promise.resolve());
    const onPane = vi.fn();
    container.addEventListener("pointerdown", onPane);
    container.addEventListener("pointerup", onPane);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onPane).not.toHaveBeenCalled();
  });

  it("removes itself on dispose", () => {
    const { container, panel } = mount(() => Promise.resolve());
    panel.dispose();
    expect(container.children).toHaveLength(0);
  });

  // The fallback is only useful if the text is ready to copy at once: on a
  // phone, focused and fully selected, with the reason announced.
  it("focuses and selects the whole fallback text, and announces the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { button, container } = mount(undefined);
    button.click();
    await flush();
    const box = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="perf-log-fallback"]',
    );
    expect(document.activeElement).toBe(box);
    expect(box?.selectionStart).toBe(0);
    expect(box?.selectionEnd).toBe("THE REPORT".length);
    expect(
      container
        .querySelector('[data-testid="perf-log-error"]')
        ?.getAttribute("role"),
    ).toBe("alert");
    warn.mockRestore();
  });

  // A second copy restarts the confirmation: the first copy's timer must
  // not turn the second "Copied" back to idle early.
  it("restarts the confirmation on a second copy", async () => {
    vi.useFakeTimers();
    const { button } = mount(() => Promise.resolve());
    button.click();
    await flush();
    vi.advanceTimersByTime(2000);
    button.click();
    await flush();
    vi.advanceTimersByTime(1000);
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.done);
    vi.advanceTimersByTime(2000);
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.idle);
  });

  it("clears its confirmation timer on dispose", async () => {
    vi.useFakeTimers();
    const { button, panel } = mount(() => Promise.resolve());
    button.click();
    await flush();
    panel.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(button.textContent).toBe(COPY_PERF_LOG_LABELS.done);
  });

  // A report that throws must not leave an older fallback box standing,
  // whose stale text would read as the current log; the failure is shown.
  it("clears an older fallback and shows the error when the report throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let broken = false;
    mountPerfLogPanel(
      container,
      () => {
        if (broken) throw new Error("no timeline");
        return "THE REPORT";
      },
      { write: undefined },
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="perf-log-copy"]',
    );
    button?.click();
    await flush();
    expect(
      container.querySelector('[data-testid="perf-log-fallback"]'),
    ).not.toBeNull();
    broken = true;
    button?.click();
    await flush();
    expect(button?.textContent).toBe("Perf log failed");
    expect(
      container.querySelector('[data-testid="perf-log-fallback"]'),
    ).toBeNull();
    const error = container.querySelector('[data-testid="perf-log-error"]');
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain("no timeline");
    warn.mockRestore();
  });
});

function env(overrides: Partial<PerfDeviceEnv> = {}): PerfDeviceEnv {
  return {
    navigator: {
      userAgent: "UA",
      hardwareConcurrency: 8,
      deviceMemory: 4,
    },
    screen: { width: 400, height: 800 },
    devicePixelRatio: 2.5,
    canvas: { clientWidth: 400, clientHeight: 600, width: 1000, height: 1500 },
    gl: {
      RENDERER: 1,
      VENDOR: 2,
      getExtension: () => ({
        UNMASKED_RENDERER_WEBGL: 10,
        UNMASKED_VENDOR_WEBGL: 11,
      }),
      getParameter: (p: number) =>
        p === 10 ? "Real GPU" : p === 11 ? "Real Vendor" : "Masked",
    },
    matchMedia: (query) => ({ matches: query === "(pointer: coarse)" }),
    ...overrides,
  };
}

describe("readPerfDevice", () => {
  it("reads the device, the unmasked GPU and the pointer kind", () => {
    expect(readPerfDevice(env())).toEqual({
      userAgent: "UA",
      devicePixelRatio: 2.5,
      screenCss: { width: 400, height: 800 },
      screenDevice: { width: 1000, height: 2000 },
      canvasCss: { width: 400, height: 600 },
      canvasDevice: { width: 1000, height: 1500 },
      hardwareConcurrency: 8,
      deviceMemoryGb: 4,
      gpuRenderer: "Real GPU",
      gpuVendor: "Real Vendor",
      pointer: "coarse",
    });
  });

  // The debug extension is absent in some browsers and may throw in others;
  // the report must still be built, with the masked names or none.
  it("falls back to the masked names, and to null when WebGL throws", () => {
    const masked = readPerfDevice(
      env({ gl: { ...env().gl!, getExtension: () => null } }),
    );
    expect(masked.gpuRenderer).toBe("Masked");
    const broken = readPerfDevice(
      env({
        gl: {
          RENDERER: 1,
          VENDOR: 2,
          getExtension: () => {
            throw new Error("lost");
          },
          getParameter: () => {
            throw new Error("lost");
          },
        },
      }),
    );
    expect(broken.gpuRenderer).toBeNull();
    expect(broken.gpuVendor).toBeNull();
  });

  it("reads what a browser hides as null", () => {
    const device = readPerfDevice(
      env({
        navigator: { userAgent: "UA" },
        gl: null,
        canvas: null,
        matchMedia: () => ({ matches: false }),
      }),
    );
    expect(device.hardwareConcurrency).toBeNull();
    expect(device.deviceMemoryGb).toBeNull();
    expect(device.gpuRenderer).toBeNull();
    expect(device.canvasCss).toBeNull();
    expect(device.pointer).toBe("none");
  });

  it("reads a zero core count as hidden", () => {
    const device = readPerfDevice(
      env({ navigator: { userAgent: "UA", hardwareConcurrency: 0 } }),
    );
    expect(device.hardwareConcurrency).toBeNull();
  });
});
