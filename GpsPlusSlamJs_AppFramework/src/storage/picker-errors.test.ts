/**
 * Why these tests matter: three save paths (the framework's download, the
 * apps' save dialogs and the Recorder's folder dialog) read a picker's
 * rejection through this one rule. A dismissal must stop the save without
 * a second way of saving; anything else must let the caller save another
 * way. The rule is `downloadBlob`'s published one - an error named
 * `AbortError`, by its name - so sharing it changed nothing published.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyPickerRejection } from './picker-errors';

describe('classifyPickerRejection', () => {
  it('reads an error named AbortError as a dismissal, by its name', () => {
    for (const err of [
      new DOMException('dismissed', 'AbortError'),
      Object.assign(new Error('named so'), { name: 'AbortError' }),
      { name: 'AbortError' },
    ]) {
      expect(classifyPickerRejection(err)).toBe('cancelled');
    }
  });

  it('reads every refusal, other error or non-error as unavailable', () => {
    for (const err of [
      new DOMException('no click', 'SecurityError'),
      new DOMException('busy', 'NotAllowedError'),
      new TypeError('not here'),
      new Error('AbortError'),
      'AbortError',
      undefined,
      null,
      42,
    ]) {
      expect(classifyPickerRejection(err)).toBe('unavailable');
    }
  });

  it('is cancelled exactly when the name is AbortError, for an error of any kind', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constant('AbortError')),
        fc.string(),
        fc.boolean(),
        (name, message, dom) => {
          const err = dom
            ? new DOMException(message, name)
            : Object.assign(new Error(message), { name });
          expect(classifyPickerRejection(err)).toBe(
            name === 'AbortError' ? 'cancelled' : 'unavailable'
          );
        }
      )
    );
  });

  // Why: callers read the classifier inside their own catch block, so a
  // throw from it would escape as a new, unexplained error in place of the
  // picker's. A rejection is untrusted data; one whose `name` getter throws
  // (a Proxy, a hostile object) is read as unavailable instead.
  it('reads an object whose name getter throws as unavailable, without throwing', () => {
    const hostile = {
      get name(): string {
        throw new Error('no name for you');
      },
    };
    expect(classifyPickerRejection(hostile)).toBe('unavailable');
  });
});
