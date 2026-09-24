// Comparison-only normalization. Native APIs remain distinct in each model.
import { createCommands } from '../a-commands/model.ts';
import { createConfiguration } from '../b-configuration/model.ts';
import { createSnapshotHost } from '../c-snapshot/model.ts';

export type Driver = ReturnType<typeof createCommands>;
export const variants = ['a', 'b', 'c'] as const;
export type Variant = typeof variants[number];
export function createDriver(variant: Variant, now = () => Date.now()): Driver {
  if (variant === 'a') return createCommands(now);
  if (variant === 'b') {
    const model = createConfiguration(now);
    return {
      setInputs: model.configure,
      setLocationSource: (location) => model.configure({ ...model.configuration(), location }),
      setTimeSource: (time) => model.configure({ ...model.configuration(), time }),
      setGpsPosition: model.ingestGps, getState: model.read, getInputs: model.configuration,
      refresh: model.refresh, clearLiveLocation: model.clearLive,
      subscribe: model.subscribe, dispose: model.dispose,
    };
  }
  const host = createSnapshotHost(now);
  return {
    setInputs: host.replaceSelection,
    setLocationSource: (location) => host.replaceSelection({ ...host.inputs(), location }),
    setTimeSource: (time) => host.replaceSelection({ ...host.inputs(), time }),
    setGpsPosition: host.acceptGps, getState: host.read, getInputs: host.inputs,
    refresh: host.refresh, clearLiveLocation: host.clearLive,
    subscribe: host.subscribe, dispose: host.dispose,
  };
}
