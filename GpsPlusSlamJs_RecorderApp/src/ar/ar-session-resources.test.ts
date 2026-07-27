import { describe, it, expect } from 'vitest';
import {
  createArSessionResources,
  type ArSessionResources,
} from './ar-session-resources';

describe('createArSessionResources', () => {
  // Why this matters: every slot must start empty so a re-entered AR session
  // never inherits a disposed object from the previous one. A newly added
  // slot that forgets its `null` initializer would read as `undefined` and
  // silently skip the `?.` guards its consumers rely on.
  it('starts with every slot empty', () => {
    const resources = createArSessionResources();
    const slots = Object.keys(resources) as Array<keyof ArSessionResources>;
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(resources[slot], `${slot} must start as null`).toBeNull();
    }
  });

  // Why this matters: this is the whole reason the record exists. Consumers
  // (per-frame callbacks, tracking callbacks) are built BEFORE the resources
  // they use are created, so they must read through the shared record at fire
  // time. A refactor that copied slots into locals, or handed out a clone,
  // would pass the test above and still break every late-wired resource.
  it('lets a reader built before wiring observe a later write', () => {
    const resources = createArSessionResources();
    const readAtFireTime = () => resources.statsOverlay;

    expect(readAtFireTime()).toBeNull();

    const overlay = { update: () => {}, dispose: () => {} };
    resources.statsOverlay = overlay as ArSessionResources['statsOverlay'];
    expect(readAtFireTime()).toBe(overlay);

    // ...and teardown nulls the slot back out for the same reader.
    resources.statsOverlay = null;
    expect(readAtFireTime()).toBeNull();
  });

  // Why this matters: the record is reused across AR sessions, but each call
  // must hand back independent state so tests (and a future multi-surface
  // app) cannot leak resources between them.
  it('returns an independent record per call', () => {
    const a = createArSessionResources();
    const b = createArSessionResources();
    a.qrProducer = {} as ArSessionResources['qrProducer'];
    expect(b.qrProducer).toBeNull();
  });
});
