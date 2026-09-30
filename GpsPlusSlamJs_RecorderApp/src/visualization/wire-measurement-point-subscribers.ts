import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { StoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';
import type { MeasurementPointVisualizer } from './measurement-point-visualizer';

const log = createLogger('MeasurementPointWire');

export function wireMeasurementPointSubscribers(
  storeRef: StoreRef<RecorderStore>,
  visualizer: MeasurementPointVisualizer
): () => void {
  let unsubscribeFromStore: (() => void) | undefined;

  const handleNewStore = (store: RecorderStore) => {
    if (unsubscribeFromStore) {
      unsubscribeFromStore();
    }
    unsubscribeFromStore = store.subscribe(() => {
      try {
        visualizer.update(store.getState());
      } catch (err) {
        log.error('Measurement visualizer update failed', err);
      }
    });
  };

  handleNewStore(storeRef.get());
  const unsubscribeFromRef = storeRef.subscribe(handleNewStore);

  return () => {
    if (unsubscribeFromStore) unsubscribeFromStore();
    unsubscribeFromRef();
  };
}
