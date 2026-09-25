/**
 * @vitest-environment jsdom
 *
 * `restore-authoring-draft.ts` durability (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC10 — the redesigned,
 * narrower version: direct `opfs-storage.ts` calls, no `recording` slice, no
 * persistence middleware, so a durable draft never also captures unrelated
 * telemetry actions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOPFSMocks } from "gps-plus-slam-app-framework/test-utils/browser-mocks";
import { resetOpfsStorage } from "gps-plus-slam-app-framework/storage/opfs-storage";

import {
  beginDurableAuthoringSession,
  discardDraft,
  findResumableDraft,
  restoreAuthoringDraft,
} from "./restore-authoring-draft.js";

let cleanup: () => void;

beforeEach(() => {
  resetOpfsStorage();
  ({ cleanup } = installOPFSMocks());
});

afterEach(() => {
  cleanup();
});

describe("findResumableDraft", () => {
  it("returns null when no session exists", async () => {
    expect(await findResumableDraft()).toBeNull();
  });

  it("returns the most recently created session's name", async () => {
    const first = await beginDurableAuthoringSession();
    const second = await beginDurableAuthoringSession();

    expect(await findResumableDraft()).toBe(second.sessionName);
    expect(second.sessionName).not.toBe(first.sessionName);
  });

  it("resolves null (never throws) when OPFS is unsupported", async () => {
    cleanup();
    vi.stubGlobal("navigator", {});

    expect(await findResumableDraft()).toBeNull();
  });
});

describe("beginDurableAuthoringSession — write side", () => {
  it("writes only authoring/* actions, not other action types", async () => {
    const session = await beginDurableAuthoringSession();
    const dispatched: unknown[] = [];
    const wrapped = session.wrapDispatch((action: unknown) => {
      dispatched.push(action);
    });

    wrapped({ type: "authoring/setTourMeta", payload: { name: "A" } });
    wrapped({ type: "gpsData/recordGpsEvent", payload: {} });
    wrapped({ type: "authoring/addWaypoint", payload: { id: "wp-1" } });
    await session.flush();

    const replayed: unknown[] = [];
    await restoreAuthoringDraft(
      (action: unknown) => replayed.push(action),
      session.sessionName,
    );

    expect(replayed).toEqual([
      { type: "authoring/setTourMeta", payload: { name: "A" } },
      { type: "authoring/addWaypoint", payload: { id: "wp-1" } },
    ]);
    // the base dispatch still ran for every action, unfiltered
    expect(dispatched).toHaveLength(3);
  });

  it("continues appending at the correct index when resuming an existing session", async () => {
    const first = await beginDurableAuthoringSession();
    first.wrapDispatch(() => {})({
      type: "authoring/setTourMeta",
      payload: { name: "A" },
    });
    await first.flush();

    const resumed = await beginDurableAuthoringSession(first.sessionName);
    resumed.wrapDispatch(() => {})({
      type: "authoring/addWaypoint",
      payload: { id: "wp-1" },
    });
    await resumed.flush();

    const replayed: unknown[] = [];
    await restoreAuthoringDraft(
      (action: unknown) => replayed.push(action),
      first.sessionName,
    );

    expect(replayed).toEqual([
      { type: "authoring/setTourMeta", payload: { name: "A" } },
      { type: "authoring/addWaypoint", payload: { id: "wp-1" } },
    ]);
  });

  it("degrades to a no-op, passthrough session when OPFS is unsupported", async () => {
    cleanup();
    vi.stubGlobal("navigator", {});

    const session = await beginDurableAuthoringSession();
    expect(session.sessionName).toBe("");

    const dispatched: unknown[] = [];
    const wrapped = session.wrapDispatch((action: unknown) =>
      dispatched.push(action),
    );
    wrapped({ type: "authoring/setTourMeta", payload: {} });

    await expect(session.flush()).resolves.toBeUndefined();
    await expect(session.discard()).resolves.toBeUndefined();
    expect(dispatched).toHaveLength(1);
  });
});

describe("discardDraft", () => {
  it("removes the session directory so it is no longer resumable", async () => {
    const session = await beginDurableAuthoringSession();
    expect(await findResumableDraft()).toBe(session.sessionName);

    await discardDraft(session.sessionName);

    expect(await findResumableDraft()).toBeNull();
  });

  it("is a no-op (does not throw) for a session name that doesn't exist", async () => {
    await expect(discardDraft("no-such-session")).resolves.toBeUndefined();
  });
});
